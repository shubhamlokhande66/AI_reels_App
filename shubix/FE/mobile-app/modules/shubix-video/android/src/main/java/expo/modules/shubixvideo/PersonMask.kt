package expo.modules.shubixvideo

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import kotlin.concurrent.thread

/** a shot on the Reel's clock, for finding who is in its picture */
internal class ShotTime(val path: String, val image: Boolean, val at: Double, val length: Double, val start: Double, val rate: Double)

/** Where the person is in the live player's picture (ML Kit's selfie model, on the phone), for text behind the person.
 * A worker reads a small frame of the shot at the time asked last and keeps the newest mask, so the mask can trail the
 * picture a little in the preview. It stops by itself when nothing asks for a moment. `latest`: white and solid where the
 * person is, null until the first answer. */
internal class PersonMask(private val shots: List<ShotTime>, private val exact: Boolean = false) {
  @Volatile var latest: Bitmap? = null
  @Volatile private var doneFor = -1.0

  /** the mask for time `t`: the player goes on with the newest one it has; the export waits for this frame's (for a moment) */
  fun ready(t: Double) {
    want(t)
    if (!exact) return
    val until = System.currentTimeMillis() + 2_000
    while (doneFor != t && System.currentTimeMillis() < until) Thread.sleep(3)
  }
  @Volatile private var wanted = 0.0
  @Volatile private var askedAt = 0L
  private var running = false

  @Synchronized fun want(t: Double) {
    wanted = t; askedAt = System.currentTimeMillis()
    if (running) return
    running = true
    thread(isDaemon = true, name = "shubix-person") { work() }
  }

  private fun work() {
    val model = Segmentation.getClient(SelfieSegmenterOptions.Builder().setDetectorMode(SelfieSegmenterOptions.SINGLE_IMAGE_MODE).build())
    var reader: MediaMetadataRetriever? = null; var open = ""
    try {
      var last = -1.0
      while (System.currentTimeMillis() - askedAt < 2_000) {
        val t = wanted
        if (t == last) { Thread.sleep(15); continue }
        last = t
        val shot = shots.lastOrNull { t >= it.at } ?: continue
        val frame = if (shot.image) BitmapFactory.decodeFile(shot.path, BitmapFactory.Options().apply { inSampleSize = 4 }) else {
          if (open != shot.path) { reader?.release(); reader = MediaMetadataRetriever().apply { setDataSource(shot.path) }; open = shot.path }
          val us = ((shot.start + (t - shot.at).coerceIn(0.0, shot.length) * shot.rate) * 1_000_000).toLong()
          if (Build.VERSION.SDK_INT >= 27) reader!!.getScaledFrameAtTime(us, if (exact) MediaMetadataRetriever.OPTION_CLOSEST else MediaMetadataRetriever.OPTION_CLOSEST_SYNC, if (exact) 640 else 320, if (exact) 640 else 320) else reader!!.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        } ?: continue
        val soft = if (frame.config == Bitmap.Config.ARGB_8888) frame else frame.copy(Bitmap.Config.ARGB_8888, false)
        val mask = Tasks.await(model.process(InputImage.fromBitmap(soft, 0)))
        val data = mask.buffer.apply { rewind() }.asFloatBuffer(); val w = mask.width; val h = mask.height
        val pixels = IntArray(w * h) { ((data.get(it) * 255).toInt().coerceIn(0, 255) shl 24) or 0xFFFFFF }
        latest = Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888); doneFor = t
      }
    } catch (_: Exception) {
    } finally {
      reader?.release(); model.close()
      synchronized(this) { running = false }
    }
  }

  companion object { fun pathOf(uri: String) = Uri.parse(uri).path ?: uri }
}
