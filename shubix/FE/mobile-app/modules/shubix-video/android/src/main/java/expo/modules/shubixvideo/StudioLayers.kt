package expo.modules.shubixvideo

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.media.MediaMetadataRetriever
import android.os.Build
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread
import kotlin.math.min

/** The studio's overlay layers in the live player: photos and videos placed on the frame as the website's drawLayers()
 * (engine.ts): place, size, turn, flip, crop, fades, round corners and the shape masks. Not drawn here yet: chroma key,
 * blend modes, the linear / mirror / luma masks and following a face (the export draws them, in the engine page). A video
 * layer shows the newest frame its worker has decoded, so it can look less smooth here than in the export. */
@UnstableApi
internal class StudioLayerRenderer(layers: JSONArray, private val w: Int, private val h: Int) {
  private class Layer(val spec: JSONObject, val feed: () -> Bitmap?, val ask: (Double) -> Unit)
  private val list = (0 until layers.length()).mapNotNull { layers.optJSONObject(it) }.filter { File(it.optString("path")).isFile }.map { spec ->
    if (spec.optString("kind") == "video") VideoFeed(spec.optString("path"), maxOf(w, h)).let { f -> Layer(spec, { f.latest }, { f.want(it) }) }
    else { val pic by lazy { photo(spec.optString("path"), maxOf(w, h)) }; Layer(spec, { pic }, {}) }
  }
  private val bufs = arrayOf(Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888), Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888))
  private var turn = 0
  private val blank = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)

  @Synchronized fun at(t: Double): Bitmap {
    val on = list.filter { t >= it.spec.optDouble("t0") && t < it.spec.optDouble("t1") }
    if (on.isEmpty()) return blank
    turn = 1 - turn; val b = bufs[turn]; b.eraseColor(Color.TRANSPARENT)
    val c = Canvas(b)
    for (layer in on) {
      layer.ask(layer.spec.optDouble("in", 0.0) + t - layer.spec.optDouble("t0"))
      layer.feed()?.let { draw(c, layer.spec, it, t) }
    }
    return b
  }

  fun overlay(offset: Double) = object : BitmapOverlay() {
    override fun getBitmap(presentationTimeUs: Long): Bitmap = at(offset + presentationTimeUs / 1_000_000.0)
  }

  private fun draw(g: Canvas, L: JSONObject, pic: Bitmap, t: Double) {
    val W = w.toFloat(); val H = h.toFloat()
    val crop = L.optJSONObject("crop")
    fun cut(k: String) = crop?.optDouble(k, 0.0) ?: 0.0
    val from = Rect((pic.width * cut("l")).toInt(), (pic.height * cut("t")).toInt(), (pic.width * (1 - cut("r"))).toInt(), (pic.height * (1 - cut("b"))).toInt())
    if (from.width() < 2 || from.height() < 2) return
    val dw = maxOf(2f, L.optDouble("s", 0.5).toFloat() * W); val dh = dw * from.height() / from.width()
    val fadeIn = L.optDouble("fin", 0.0); val fadeOut = L.optDouble("fout", 0.0)
    val fade = min(if (fadeIn > 0) min(1.0, (t - L.optDouble("t0")) / fadeIn) else 1.0, if (fadeOut > 0) min(1.0, (L.optDouble("t1") - t) / fadeOut) else 1.0)
    val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG).apply { alpha = (L.optDouble("op", 1.0) * fade * 255).toInt().coerceIn(0, 255) }
    g.save()
    g.translate(L.optDouble("x", 0.5).toFloat() * W, L.optDouble("y", 0.5).toFloat() * H)
    g.rotate(L.optDouble("r", 0.0).toFloat())
    g.scale(if (L.optBoolean("fh")) -1f else 1f, if (L.optBoolean("fv")) -1f else 1f)
    val box = RectF(-dw / 2, -dh / 2, dw / 2, dh / 2)
    shape(L, dw, dh)?.let { (path, inside) -> if (inside) g.clipPath(path) else g.clipOutPath(path) }
    val round = L.optDouble("rad", 0.0).toFloat() * min(dw, dh) / 2
    if (round > 0) g.clipPath(Path().apply { addRoundRect(box, round, round, Path.Direction.CW) })
    g.drawBitmap(pic, from, box, paint)
    g.restore()
  }

  /** the layer's mask as a path around its centre, and whether its inside is what shows */
  private fun shape(L: JSONObject, dw: Float, dh: Float): Pair<Path, Boolean>? {
    val m = L.optJSONObject("mk") ?: JSONObject()
    val mw = m.optDouble("w", 0.8).toFloat() * dw; val mh = m.optDouble("h", 0.8).toFloat() * dh
    val box = RectF(-mw / 2, -mh / 2, mw / 2, mh / 2); val path = Path()
    when (L.optString("mask")) {
      "circle", "radial", "oval", "ellipse" -> path.addOval(box, Path.Direction.CW)
      "rect", "rectangle" -> path.addRect(box, Path.Direction.CW)
      "polygon" -> {
        val pts = m.optJSONArray("points") ?: return null
        for (i in 0 until pts.length()) {
          val p = pts.optJSONArray(i) ?: continue
          val x = (p.optDouble(0) - 0.5).toFloat() * dw; val y = (p.optDouble(1) - 0.5).toFloat() * dh
          if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        path.close()
      }
      else -> return null
    }
    path.transform(Matrix().apply { setRotate(m.optDouble("a", 0.0).toFloat()) })
    return Pair(path, !m.optBoolean("inv"))
  }

  private fun photo(path: String, side: Int): Bitmap? = try {
    if (Build.VERSION.SDK_INT >= 28) ImageDecoder.decodeBitmap(ImageDecoder.createSource(File(path))) { d, info, _ ->
      d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
      val scale = min(1f, side.toFloat() / maxOf(info.size.width, info.size.height))
      d.setTargetSize(maxOf(1, (info.size.width * scale).toInt()), maxOf(1, (info.size.height * scale).toInt()))
    } else BitmapFactory.decodeFile(path)
  } catch (_: Exception) { null }

  /** a video layer's frames: a worker decodes the time asked last and keeps the newest picture; it stops by itself when
   * nothing has asked for a moment (the layer is over, or the player paused), and starts again when asked */
  private class VideoFeed(private val path: String, private val side: Int) {
    @Volatile var latest: Bitmap? = null
    @Volatile private var wanted = 0.0
    @Volatile private var askedAt = 0L
    private var running = false
    @Synchronized fun want(seconds: Double) {
      wanted = seconds; askedAt = System.currentTimeMillis()
      if (running) return
      running = true
      thread(isDaemon = true, name = "shubix-layer") { work() }
    }
    private fun work() {
      val reader = MediaMetadataRetriever()
      try {
        reader.setDataSource(path)
        var last = -1.0
        while (System.currentTimeMillis() - askedAt < 2_000) {
          val t = wanted
          if (t == last) { Thread.sleep(10); continue }
          last = t
          val at = (t * 1_000_000).toLong()
          val frame = if (Build.VERSION.SDK_INT >= 27) reader.getScaledFrameAtTime(at, MediaMetadataRetriever.OPTION_CLOSEST, side / 2, side / 2) else reader.getFrameAtTime(at, MediaMetadataRetriever.OPTION_CLOSEST)
          if (frame != null) latest = frame
        }
      } catch (_: Exception) {
      } finally {
        reader.release()
        synchronized(this) { running = false }
      }
    }
  }
}
