package expo.modules.shubixvideo

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.Brightness
import androidx.media3.effect.Contrast
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.RgbAdjustment
import androidx.media3.effect.RgbFilter
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.effect.SpeedChangeEffect
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import com.google.common.collect.ImmutableList
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File

/** The phone's video engine (lib/video.ts): the Reel as JSON in, the MP4 out. The clips one after another, each
 * trimmed, at its speed, turned, mirrored, filled or fitted into the frame, with its filter and the texts over it; the
 * song under them. Progress as "onProgress" events (0…1). */
@UnstableApi
class ShubixVideoModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private class ActiveExport(val promise: Promise) {
    var transformer: Transformer? = null
    var settled: Boolean = false
    var cancelRequested: Boolean = false
    var progressTask: Runnable? = null
    var output: File? = null
  }

  private var activeExport: ActiveExport? = null
  private var files: FileServer? = null

  /** Settle the JS Promise once. A cancelled export keeps the native busy lock until Media3 calls back. */
  private fun settleExport(session: ActiveExport, error: Throwable? = null, result: Map<String, Any>? = null) {
    if (session.settled) return
    session.settled = true
    session.progressTask?.let(main::removeCallbacks)
    session.progressTask = null
    if (error != null) {
      session.promise.reject(
        if (error is ExportCancelledException) "E_EXPORT_CANCELLED" else "E_EXPORT",
        error.message ?: "The Reel could not be made.",
        error
      )
    } else {
      session.promise.resolve(result)
    }
  }

  private fun releaseExport(session: ActiveExport) {
    session.progressTask?.let(main::removeCallbacks)
    session.progressTask = null
    if (activeExport === session) activeExport = null
  }

  private class ExportCancelledException : Exception("Export was cancelled.")

  private fun cancelActiveExport() {
    val session = activeExport ?: return
    if (session.cancelRequested) return
    session.cancelRequested = true
    // Keep activeExport locked until Media3 confirms termination in onError/onCompleted.
    try {
      session.transformer?.cancel()
      settleExport(session, ExportCancelledException())
    } catch (_: Exception) {
      settleExport(session, ExportCancelledException())
      releaseExport(session)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("ShubixVideo")
    Events("onProgress")

    AsyncFunction("exportReel") { specJson: String, promise: Promise ->
      main.post {
        try { start(JSONObject(specJson), promise) } catch (e: Exception) { promise.reject("E_EXPORT", e.message ?: "The Reel could not be made.", e) }
      }
    }
    AsyncFunction("cancel") { main.post { cancelActiveExport() } }
    // the engine page's way to the app's files (FileServer): started once, its port and key
    Function("fileServer") {
      val c = appContext.reactContext ?: throw IllegalStateException("No app")
      val s = files ?: FileServer(listOf(c.filesDir, c.cacheDir), File(c.cacheDir, "engine-out")).also { files = it }
      mapOf("port" to s.port, "key" to s.key)
    }
    OnDestroy {
      main.post { cancelActiveExport() }
      files?.close()
      files = null
    }
  }

  private fun start(spec: JSONObject, promise: Promise) {
    if (activeExport != null) {
      promise.reject("E_EXPORT_BUSY", "A Reel is already being exported. Wait for it to finish or cancel it.", null)
      return
    }
    val context = appContext.reactContext ?: throw IllegalStateException("No app")
    val w = spec.getInt("width"); val h = spec.getInt("height")
    val clips = spec.getJSONArray("clips"); val texts = spec.optJSONArray("texts")
    val song = spec.optJSONObject("audio")
    val items = mutableListOf<EditedMediaItem>()
    var at = 0.0 // where this clip starts in the Reel (seconds)
    for (i in 0 until clips.length()) {
      val c = clips.getJSONObject(i)
      val image = c.optString("kind") == "image"
      val speed = c.optDouble("speed", 1.0).toFloat()
      val startMs = (c.optDouble("start", 0.0) * 1000).toLong(); val endMs = (c.optDouble("end", 5.0) * 1000).toLong()
      val item = MediaItem.Builder().setUri(Uri.parse(c.getString("uri"))).apply {
        if (image) setImageDurationMs(endMs - startMs)
        else setClippingConfiguration(MediaItem.ClippingConfiguration.Builder().setStartPositionMs(startMs).setEndPositionMs(endMs).build())
      }.build()
      val len = (endMs - startMs) / 1000.0 / (if (image) 1f else speed)
      val video = mutableListOf<Effect>()
      val audio = mutableListOf<AudioProcessor>()
      if (!image && speed != 1f) { video += SpeedChangeEffect(speed); audio += SonicAudioProcessor().apply { setSpeed(speed); setPitch(speed) } }
      val turn = c.optDouble("rotation", 0.0).toFloat()
      val mirror = c.optBoolean("mirror"); val flip = c.optBoolean("flip")
      if (turn != 0f || mirror || flip) video += ScaleAndRotateTransformation.Builder().setRotationDegrees(-turn).setScale(if (mirror) -1f else 1f, if (flip) -1f else 1f).build()
      video += Presentation.createForWidthAndHeight(w, h, if (c.optString("fit") == "contain") Presentation.LAYOUT_SCALE_TO_FIT else Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP)
      video += filter(c.optString("filter"))
      if (texts != null && texts.length() > 0) {
        val overlays = (0 until texts.length()).map { index -> TimedText(texts.getJSONObject(index), at, w, h) }
        video += OverlayEffect(ImmutableList.copyOf(overlays))
      }
      val muted = c.optBoolean("muted")
      items += EditedMediaItem.Builder(item).setRemoveAudio(muted).setEffects(Effects(audio, video)).apply { if (image) setFrameRate(30) }.build()
      at += len
    }
    val sequences = mutableListOf(EditedMediaItemSequence.Builder(items).experimentalSetForceAudioTrack(true).build())
    if (song != null) {
      val music = MediaItem.Builder().setUri(Uri.parse(song.getString("uri")))
        .setClippingConfiguration(MediaItem.ClippingConfiguration.Builder().setStartPositionMs((song.optDouble("start", 0.0) * 1000).toLong()).setEndPositionMs(((song.optDouble("start", 0.0) + at) * 1000).toLong()).build()).build()
      sequences += EditedMediaItemSequence.Builder(listOf(EditedMediaItem.Builder(music).setRemoveVideo(true).build())).build()
    }
    val out = File(spec.getString("output")).apply { parentFile?.mkdirs(); delete() }
    val session = ActiveExport(promise).also { it.output = out }
    activeExport = session
    val transformer = try {
      Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, result: ExportResult) {
            if (activeExport !== session) return
            if (session.cancelRequested) {
              session.output?.let { if (it.exists()) it.delete() }
              if (!session.settled) settleExport(session, ExportCancelledException())
              releaseExport(session)
              return
            }
            settleExport(session, result = mapOf("uri" to Uri.fromFile(out).toString(), "size" to out.length(), "duration" to at))
            releaseExport(session)
          }
          override fun onError(composition: Composition, result: ExportResult, exception: ExportException) {
            if (activeExport !== session) return
            if (session.cancelRequested) {
              session.output?.let { if (it.exists()) it.delete() }
              if (!session.settled) settleExport(session, ExportCancelledException())
            } else {
              settleExport(session, exception)
            }
            releaseExport(session)
          }
        }).build()
    } catch (error: Exception) {
      settleExport(session, error)
      releaseExport(session)
      return
    }
    session.transformer = transformer
    try {
      transformer.start(Composition.Builder(sequences).build(), out.absolutePath)
    } catch (error: Exception) {
      settleExport(session, error)
      releaseExport(session)
      return
    }
    val holder = ProgressHolder()
    val progressTask = object : Runnable {
      override fun run() {
        if (activeExport !== session || session.settled) return
        if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
          sendEvent("onProgress", mapOf("progress" to holder.progress / 100.0))
        }
        main.postDelayed(this, 250)
      }
    }
    session.progressTask = progressTask
    main.post(progressTask)
  }

  /** The website's filters, as colour changes (Original: none). */
  private fun filter(name: String): List<Effect> = when (name) {
    "Noir" -> listOf(RgbFilter.createGrayscaleFilter(), Contrast(0.25f))
    "Golden" -> listOf(RgbAdjustment.Builder().setRedScale(1.12f).setGreenScale(1.04f).setBlueScale(0.86f).build())
    "Film" -> listOf(RgbAdjustment.Builder().setRedScale(1.05f).setBlueScale(0.95f).build(), Contrast(-0.08f))
    "Soft" -> listOf(Brightness(0.05f), Contrast(-0.12f))
    "Vivid" -> listOf(Contrast(0.18f), RgbAdjustment.Builder().setRedScale(1.06f).setGreenScale(1.06f).setBlueScale(1.06f).build())
    "Cinematic" -> listOf(Contrast(0.22f), RgbAdjustment.Builder().setRedScale(1.04f).setGreenScale(0.98f).setBlueScale(1.08f).build())
    else -> emptyList()
  }

  /** One independent text layer. OverlayEffect composites every active layer, including overlapping captions. */
  private class TimedText(private val text: JSONObject, private val offset: Double, private val w: Int, private val h: Int) : BitmapOverlay() {
    private val blank = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
    private val start = text.optDouble("start")
    private val end = text.optDouble("end")
    private val bitmap by lazy { draw() }

    override fun getBitmap(presentationTimeUs: Long): Bitmap {
      val t = offset + presentationTimeUs / 1_000_000.0
      return if (t >= start && t <= end) bitmap else blank
    }

    override fun getOverlaySettings(presentationTimeUs: Long) =
      StaticOverlaySettings.Builder().setBackgroundFrameAnchor(0f, -0.45f).build()

    private fun draw(): Bitmap {
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = try { Color.parseColor(text.optString("color", "#FFFFFF")) } catch (_: Exception) { Color.WHITE }
        textSize = text.optDouble("size", 36.0).toFloat() * w / 540f
        typeface = Typeface.DEFAULT_BOLD
        setShadowLayer(textSize / 8, 0f, textSize / 14, Color.argb(160, 0, 0, 0))
      }
      val content = text.optString("text").replace("\\r", "")
      val pad = (paint.textSize / 3).toInt().coerceAtLeast(4)
      val maxTextWidth = (w * 0.9f - pad * 2).coerceAtLeast(1f)
      val lines = mutableListOf<String>()
      content.split("\\n").forEach { paragraph ->
        var line = ""
        paragraph.split(Regex("\\s+")).filter { it.isNotEmpty() }.forEach { word ->
          val candidate = if (line.isEmpty()) word else "$line $word"
          if (paint.measureText(candidate) <= maxTextWidth) {
            line = candidate
          } else {
            if (line.isNotEmpty()) lines += line
            // Keep long URLs/words visible instead of drawing beyond the bitmap edge.
            var part = ""
            word.forEach { char ->
              val next = part + char
              if (part.isNotEmpty() && paint.measureText(next) > maxTextWidth) {
                lines += part
                part = char.toString()
              } else part = next
            }
            line = part
          }
        }
        if (line.isNotEmpty() || paragraph.isEmpty()) lines += line
      }
      val safeLines = lines.ifEmpty { listOf("") }
      val textWidth = safeLines.maxOf { paint.measureText(it) }.toInt().coerceAtMost(maxTextWidth.toInt())
      val width = (textWidth + pad * 2).coerceIn(2, w)
      val lineHeight = paint.fontSpacing
      val height = (lineHeight * safeLines.size + pad * 2).toInt().coerceAtLeast(2)
      return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { bitmap ->
        val canvas = Canvas(bitmap)
        safeLines.forEachIndexed { index, line ->
          canvas.drawText(line, pad.toFloat(), pad - paint.ascent() + index * lineHeight, paint)
        }
      }
    }
  }
}
