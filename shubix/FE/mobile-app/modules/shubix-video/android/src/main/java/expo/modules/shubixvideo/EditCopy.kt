package expo.modules.shubixvideo

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** A heavy clip's edit copy (10-bit HDR, high frame rate, very large), made by the phone's hardware: H.264, normal colours,
 * the size and frame rate asked for. Blocks until it is done, and throws when it could not be made. */
@UnstableApi
internal fun makeEditCopy(context: Context, from: File, to: File, width: Int, height: Int, fps: Float, bitrate: Int) {
  val worker = HandlerThread("shubix-copy").apply { start() }
  val done = CountDownLatch(1)
  var failure: Exception? = null
  var running: Transformer? = null
  val part = File(to.path + ".part").apply { delete() }
  Handler(worker.looper).post {
    try {
      val video = listOf(Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_SCALE_TO_FIT), FrameDropEffect.createDefaultFrameDropEffect(fps))
      val item = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(from))).setEffects(Effects(emptyList(), video)).build()
      val reel = Composition.Builder(EditedMediaItemSequence.Builder(listOf(item)).build()).setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL).build()
      running = Transformer.Builder(context)
        .setLooper(worker.looper)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .setEncoderFactory(DefaultEncoderFactory.Builder(context).setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(bitrate).build()).build())
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) { done.countDown() }
          override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) { failure = exportException; done.countDown() }
        })
        .build().also { it.start(reel, part.path) }
    } catch (e: Exception) { failure = e; done.countDown() }
  }
  try {
    if (!done.await(10, TimeUnit.MINUTES)) { Handler(worker.looper).post { running?.cancel() }; throw IllegalStateException("the copy took too long") }
    failure?.let { throw it }
    if (!part.renameTo(to)) throw IllegalStateException("the copy could not be kept")
  } finally {
    part.delete()
    worker.quitSafely()
  }
}
