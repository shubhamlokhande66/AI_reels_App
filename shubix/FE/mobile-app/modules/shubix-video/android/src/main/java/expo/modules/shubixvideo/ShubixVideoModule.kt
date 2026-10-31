package expo.modules.shubixvideo

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Matrix
import android.graphics.Typeface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.GainProcessor
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.Brightness
import androidx.media3.effect.Contrast
import androidx.media3.effect.GaussianBlur
import androidx.media3.effect.HslAdjustment
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.MatrixTransformation
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
  private var running: Transformer? = null
  private var files: FileServer? = null

  override fun definition() = ModuleDefinition {
    Name("ShubixVideo")
    Events("onProgress")

    AsyncFunction("exportReel") { specJson: String, promise: Promise ->
      main.post {
        try { start(JSONObject(specJson), promise) } catch (e: Exception) { promise.reject("E_EXPORT", e.message ?: "The Reel could not be made.", e) }
      }
    }
    AsyncFunction("cancel") { main.post { running?.cancel(); running = null } }
    // the engine page's way to the app's files (FileServer): started once, its port and key
    Function("fileServer") {
      val c = appContext.reactContext ?: throw IllegalStateException("No app")
      val s = files ?: FileServer(listOf(c.filesDir, c.cacheDir), File(c.cacheDir, "engine-out")).also { files = it }
      mapOf("port" to s.port, "key" to s.key)
    }
    OnDestroy { files?.close(); files = null }
  }

  private fun start(spec: JSONObject, promise: Promise) {
    val context = appContext.reactContext ?: throw IllegalStateException("No app")
    val w = spec.getInt("width"); val h = spec.getInt("height")
    val clips = spec.getJSONArray("clips"); val texts = spec.optJSONArray("texts")
    val song = spec.optJSONObject("audio")
    val items = mutableListOf<EditedMediaItem>()
    val clipAudioRanges = mutableListOf<Pair<Double, Double>>()
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
      val sourceDuration = (endMs - startMs).coerceAtLeast(1L) / 1000.0
      val ramp = if (!image) speedRampSlices(c.optJSONArray("speedRamp"), sourceDuration, speed.toDouble()) else emptyList()
      val slices = if (ramp.isEmpty()) listOf(RampSlice(0.0, sourceDuration, speed.toDouble())) else ramp
      val clipVolume = c.optDouble("volume", 1.0).toFloat().coerceIn(0f, 1f)
      val turn = c.optDouble("rotation", 0.0).toFloat()
      val mirror = c.optBoolean("mirror"); val flip = c.optBoolean("flip")
      val muted = c.optBoolean("muted")
      val clipTimelineStart = at
      var clipOutputDuration = 0.0
      for (slice in slices) {
        val sliceStartMs = startMs + (slice.start * 1000).toLong()
        val sliceEndMs = startMs + (slice.end * 1000).toLong()
        val segmentItem = MediaItem.Builder().setUri(Uri.parse(c.getString("uri"))).apply {
          if (image) setImageDurationMs((slice.end - slice.start).times(1000).toLong())
          else setClippingConfiguration(MediaItem.ClippingConfiguration.Builder().setStartPositionMs(sliceStartMs).setEndPositionMs(sliceEndMs).build())
        }.build()
        val segmentSpeed = if (image) 1f else slice.speed.toFloat().coerceIn(0.25f, 4f)
        val segmentDuration = (slice.end - slice.start) / segmentSpeed
        val video = mutableListOf<Effect>()
        val audio = mutableListOf<AudioProcessor>()
        if (!image && segmentSpeed != 1f) { video += SpeedChangeEffect(segmentSpeed); audio += SonicAudioProcessor().apply { setSpeed(segmentSpeed); setPitch(segmentSpeed) } }
        if (!image && clipVolume != 1f) audio += gainProcessor(clipVolume)
        if (turn != 0f || mirror || flip) video += ScaleAndRotateTransformation.Builder().setRotationDegrees(-turn).setScale(if (mirror) -1f else 1f, if (flip) -1f else 1f).build()
        val keyframes = c.optJSONArray("keyframes")
        if (keyframes != null && keyframes.length() > 0) video += keyframeTransform(keyframes, clipOutputDuration)
        video += Presentation.createForWidthAndHeight(w, h, if (c.optString("fit") == "contain") Presentation.LAYOUT_SCALE_TO_FIT else Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP)
        video += filter(c.optString("filter"))
        if (texts != null && texts.length() > 0) video += OverlayEffect(mutableListOf<androidx.media3.effect.TextureOverlay>(TimedTexts(texts, at + clipOutputDuration, w, h)))
        items += EditedMediaItem.Builder(segmentItem).setRemoveAudio(muted).setEffects(Effects(audio, video)).apply { if (image) setFrameRate(30) }.build()
        clipOutputDuration += segmentDuration
      }
      if (!image && !muted && clipVolume > 0f && clipOutputDuration > 0.0) clipAudioRanges += Pair(clipTimelineStart, clipTimelineStart + clipOutputDuration)
      at += clipOutputDuration
    }
    val sequences = mutableListOf(EditedMediaItemSequence.Builder(items).experimentalSetForceAudioTrack(true).build())
    if (song != null) {
      val music = MediaItem.Builder().setUri(Uri.parse(song.getString("uri")))
        .setClippingConfiguration(MediaItem.ClippingConfiguration.Builder().setStartPositionMs((song.optDouble("start", 0.0) * 1000).toLong()).setEndPositionMs(((song.optDouble("start", 0.0) + at) * 1000).toLong()).build()).build()
      val musicVolume = song.optDouble("volume", 1.0).toFloat().coerceIn(0f, 1f)
      val fadeIn = song.optDouble("fadeIn", 0.0).coerceIn(0.0, 10.0)
      val fadeOut = song.optDouble("fadeOut", 0.0).coerceIn(0.0, 10.0)
      val ducking = song.optBoolean("ducking", false)
      val duckLevel = song.optDouble("duckLevel", 0.35).toFloat().coerceIn(0.1f, 1f)
      val musicAudio: List<AudioProcessor> = if (musicVolume == 1f && fadeIn == 0.0 && fadeOut == 0.0 && (!ducking || clipAudioRanges.isEmpty())) emptyList()
        else listOf(gainProcessor(musicVolume, at, fadeIn, fadeOut, if (ducking) clipAudioRanges else emptyList(), duckLevel))
      sequences += EditedMediaItemSequence.Builder(listOf(EditedMediaItem.Builder(music).setRemoveVideo(true).setEffects(Effects(musicAudio, emptyList())).build())).build()
    }
    val out = File(spec.getString("output")).apply { parentFile?.mkdirs(); delete() }
    val transformer = Transformer.Builder(context)
      .setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC)
      .addListener(object : Transformer.Listener {
        override fun onCompleted(composition: Composition, result: ExportResult) { running = null; promise.resolve(mapOf("uri" to Uri.fromFile(out).toString(), "size" to out.length(), "duration" to at)) }
        override fun onError(composition: Composition, result: ExportResult, exception: ExportException) { running = null; promise.reject("E_EXPORT", exception.message ?: "The Reel could not be made.", exception) }
      }).build()
    running = transformer
    transformer.start(Composition.Builder(sequences).build(), out.absolutePath)
    val holder = ProgressHolder()
    main.post(object : Runnable {
      override fun run() {
        if (running !== transformer) return
        if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) sendEvent("onProgress", mapOf("progress" to holder.progress / 100.0))
        main.postDelayed(this, 250)
      }
    })
  }

  private data class RampPoint(val time: Double, val speed: Double, val easing: String)
  private data class RampSlice(val start: Double, val end: Double, val speed: Double)

  private fun rampEase(value: Double, easing: String): Double {
    val t = value.coerceIn(0.0, 1.0)
    return when (easing) {
      "hold" -> 0.0
      "in", "inQuad" -> t * t
      "out" -> 1.0 - (1.0 - t) * (1.0 - t)
      "outCubic" -> 1.0 - Math.pow(1.0 - t, 3.0)
      "inOut" -> if (t < 0.5) 2.0 * t * t else 1.0 - Math.pow(-2.0 * t + 2.0, 2.0) / 2.0
      "outExpo" -> if (t >= 1.0) 1.0 else 1.0 - Math.pow(2.0, -10.0 * t)
      "outBack" -> { val c1 = 1.70158; val c3 = c1 + 1.0; 1.0 + c3 * Math.pow(t - 1.0, 3.0) + c1 * Math.pow(t - 1.0, 2.0) }
      "bezier" -> {
        var low = 0.0; var high = 1.0; var x = t
        repeat(18) {
          val u = 1.0 - x
          val at = 3.0 * u * u * x * 0.25 + 3.0 * u * x * x * 0.25 + x * x * x
          if (kotlin.math.abs(at - t) < 1e-5) return@repeat
          if (at < t) low = x else high = x
          x = (low + high) / 2.0
        }
        val u = 1.0 - x
        3.0 * u * u * x * 0.1 + 3.0 * u * x * x * 1.0 + x * x * x
      }
      else -> t
    }
  }

  /** Apply the clip's shared transform keyframes per rendered frame (translation, scale and rotation). */
  private fun keyframeTransform(frames: org.json.JSONArray, timelineOffsetSeconds: Double): MatrixTransformation {
    return MatrixTransformation { presentationTimeUs ->
      val time = timelineOffsetSeconds + presentationTimeUs / 1_000_000.0
      val x = keyframeValue(frames, time, "x", 0.0)
      val y = keyframeValue(frames, time, "y", 0.0)
      val scale = keyframeValue(frames, time, "s", 1.0).coerceIn(0.05, 8.0)
      val rotation = keyframeValue(frames, time, "r", 0.0)
      Matrix().apply {
        postScale(scale.toFloat(), scale.toFloat())
        postRotate(rotation.toFloat())
        postTranslate((x * 2.0).toFloat(), (-y * 2.0).toFloat())
      }
    }
  }

  private fun keyframeValue(frames: org.json.JSONArray, time: Double, property: String, fallback: Double): Double {
    val points = (0 until frames.length()).mapNotNull { index ->
      val frame = frames.optJSONObject(index) ?: return@mapNotNull null
      val t = frame.optDouble("t", Double.NaN)
      val value = frame.optDouble(property, Double.NaN)
      if (!t.isFinite() || !value.isFinite()) null else Triple(t, value, frame)
    }.sortedBy { it.first }
    if (points.isEmpty()) return fallback
    if (time <= points.first().first) return points.first().second
    if (time >= points.last().first) return points.last().second
    val rightIndex = points.indexOfFirst { it.first >= time }.coerceAtLeast(1)
    val left = points[rightIndex - 1]
    val right = points[rightIndex]
    val span = (right.first - left.first).coerceAtLeast(0.000001)
    var progress = ((time - left.first) / span).coerceIn(0.0, 1.0)
    val easing = right.third.optString("ez", "inOut")
    progress = when (easing) {
      "hold" -> 0.0
      "ease-in", "in", "inQuad" -> progress * progress
      "ease-out", "out" -> 1.0 - (1.0 - progress) * (1.0 - progress)
      "ease-in-out", "inOut" -> if (progress < 0.5) 2.0 * progress * progress else 1.0 - Math.pow(-2.0 * progress + 2.0, 2.0) / 2.0
      "outCubic" -> 1.0 - Math.pow(1.0 - progress, 3.0)
      "outExpo" -> if (progress >= 1.0) 1.0 else 1.0 - Math.pow(2.0, -10.0 * progress)
      "outBack" -> { val c1 = 1.70158; val c3 = c1 + 1.0; 1.0 + c3 * Math.pow(progress - 1.0, 3.0) + c1 * Math.pow(progress - 1.0, 2.0) }
      "bezier" -> {
        val curve = right.third.optJSONArray("bezier")
        val x1 = curve?.optDouble(0, 0.25) ?: 0.25
        val y1 = curve?.optDouble(1, 0.1) ?: 0.1
        val x2 = curve?.optDouble(2, 0.25) ?: 0.25
        val y2 = curve?.optDouble(3, 1.0) ?: 1.0
        var lo = 0.0; var hi = 1.0; var t = progress
        repeat(18) {
          val u = 1.0 - t
          val at = 3.0 * u * u * t * x1 + 3.0 * u * t * t * x2 + t * t * t
          if (kotlin.math.abs(at - progress) < 0.00001) return@repeat
          if (at < progress) lo = t else hi = t
          t = (lo + hi) / 2.0
        }
        val u = 1.0 - t
        3.0 * u * u * t * y1 + 3.0 * u * t * t * y2 + t * t * t
      }
      else -> progress
    }
    return left.second + (right.second - left.second) * progress
  }

  /** Build bounded constant-rate Media3 slices from source-time speed keyframes. */
  private fun speedRampSlices(points: org.json.JSONArray?, duration: Double, fallback: Double): List<RampSlice> {
    if (points == null || points.length() == 0 || duration <= 0.0) return emptyList()
    val sorted = (0 until points.length()).mapNotNull { index ->
      val point = points.optJSONObject(index) ?: return@mapNotNull null
      val time = point.optDouble("time", Double.NaN)
      val rate = point.optDouble("speed", Double.NaN)
      if (!time.isFinite() || !rate.isFinite()) null
      else RampPoint(time.coerceIn(0.0, duration), rate.coerceIn(0.25, 4.0), point.optString("easing", "linear"))
    }.sortedBy { it.time }
    if (sorted.isEmpty()) return emptyList()
    val unique = mutableListOf<RampPoint>()
    sorted.forEach { point ->
      if (unique.isNotEmpty() && kotlin.math.abs(unique.last().time - point.time) < 0.001) unique[unique.lastIndex] = point
      else unique += point
    }
    if (unique.first().time > 0.0) unique.add(0, RampPoint(0.0, unique.first().speed, "linear"))
    if (unique.last().time < duration) unique += RampPoint(duration, unique.last().speed, "linear")
    val result = mutableListOf<RampSlice>()
    for (index in 0 until unique.lastIndex) {
      val left = unique[index]; val right = unique[index + 1]
      val count = kotlin.math.ceil((right.time - left.time) / 0.2).toInt().coerceIn(1, 240)
      for (part in 0 until count) {
        val start = left.time + (right.time - left.time) * part / count
        val end = left.time + (right.time - left.time) * (part + 1) / count
        val midpoint = (start + end) / 2.0
        val raw = ((midpoint - left.time) / (right.time - left.time).coerceAtLeast(0.000001)).coerceIn(0.0, 1.0)
        val progress = rampEase(raw, right.easing)
        val rate = left.speed + (right.speed - left.speed) * progress
        result += RampSlice(start, end, rate.coerceIn(0.25, 4.0))
      }
    }
    return result.take(1200)
  }

  /** Constant PCM gain shared by the clip and music sequences. Media3 expects a 0..1 gain factor. */
  private fun gainProcessor(level: Float, durationSeconds: Double? = null, fadeInSeconds: Double = 0.0, fadeOutSeconds: Double = 0.0, duckRanges: List<Pair<Double, Double>> = emptyList(), duckLevel: Float = 0.35f): GainProcessor {
    val gain = level.coerceIn(0f, 1f)
    return GainProcessor(object : GainProcessor.GainProvider {
      override fun getGainFactorAtSamplePosition(samplePosition: Long, sampleRate: Int): Float {
        val seconds = samplePosition.toDouble() / sampleRate.coerceAtLeast(1)
        val fadeIn = if (fadeInSeconds > 0.0) (seconds / fadeInSeconds).coerceIn(0.0, 1.0) else 1.0
        val fadeOut = if (fadeOutSeconds > 0.0 && durationSeconds != null) ((durationSeconds - seconds) / fadeOutSeconds).coerceIn(0.0, 1.0) else 1.0
        val duck = if (duckRanges.isEmpty()) 1.0 else {
          var envelope = 1.0
          val attack = 0.12
          val release = 0.28
          for ((start, end) in duckRanges) {
            val levelAtRange = duckLevel.toDouble().coerceIn(0.1, 1.0)
            val candidate = when {
              seconds >= start && seconds <= end -> levelAtRange
              seconds < start && seconds >= start - attack -> 1.0 - (1.0 - levelAtRange) * ((seconds - (start - attack)) / attack).coerceIn(0.0, 1.0)
              seconds > end && seconds <= end + release -> levelAtRange + (1.0 - levelAtRange) * ((seconds - end) / release).coerceIn(0.0, 1.0)
              else -> 1.0
            }
            envelope = minOf(envelope, candidate)
          }
          envelope
        }
        return (gain * minOf(fadeIn, fadeOut, duck)).toFloat()
      }
      override fun isUnityUntil(samplePosition: Long, sampleRate: Int): Long =
        if (gain == 1f && fadeInSeconds == 0.0 && fadeOutSeconds == 0.0 && duckRanges.isEmpty()) C.TIME_END_OF_SOURCE else C.TIME_UNSET
    })
  }

  /** The website's filters, as colour changes (Original: none). */
  private fun filter(name: String): List<Effect> = when (name) {
    "Noir" -> listOf(RgbFilter.createGrayscaleFilter(), Contrast(0.25f))
    "Golden" -> listOf(RgbAdjustment.Builder().setRedScale(1.12f).setGreenScale(1.04f).setBlueScale(0.86f).build())
    "Film" -> listOf(RgbAdjustment.Builder().setRedScale(1.05f).setBlueScale(0.95f).build(), Contrast(-0.08f))
    "Soft" -> listOf(Brightness(0.05f), Contrast(-0.12f))
    "Vivid" -> listOf(Contrast(0.18f), RgbAdjustment.Builder().setRedScale(1.06f).setGreenScale(1.06f).setBlueScale(1.06f).build())
    "Cinematic" -> listOf(Contrast(0.22f), RgbAdjustment.Builder().setRedScale(1.04f).setGreenScale(0.98f).setBlueScale(1.08f).build())
    "Warm" -> listOf(Brightness(0.025f), RgbAdjustment.Builder().setRedScale(1.12f).setGreenScale(1.04f).setBlueScale(0.88f).build())
    "Cool" -> listOf(RgbAdjustment.Builder().setRedScale(0.9f).setGreenScale(1.02f).setBlueScale(1.14f).build())
    "Teal & Orange" -> listOf(Contrast(0.2f), RgbAdjustment.Builder().setRedScale(1.12f).setGreenScale(1.02f).setBlueScale(0.92f).build())
    "Sepia" -> listOf(RgbAdjustment.Builder().setRedScale(1.14f).setGreenScale(1.0f).setBlueScale(0.76f).build(), Contrast(-0.06f))
    "Matte" -> listOf(Brightness(0.06f), Contrast(-0.18f))
    "High Contrast" -> listOf(Contrast(0.38f))
    "Faded" -> listOf(Brightness(0.08f), Contrast(-0.22f), RgbAdjustment.Builder().setRedScale(1.03f).setGreenScale(1.03f).setBlueScale(1.03f).build())
    "Vintage" -> listOf(Contrast(-0.12f), RgbAdjustment.Builder().setRedScale(1.08f).setGreenScale(0.98f).setBlueScale(0.82f).build())
    "Pastel" -> listOf(Brightness(0.035f), Contrast(-0.1f), RgbAdjustment.Builder().setRedScale(1.04f).setGreenScale(1.04f).setBlueScale(1.04f).build())
    "Cyberpunk" -> listOf(Contrast(0.18f), RgbAdjustment.Builder().setRedScale(1.15f).setGreenScale(0.9f).setBlueScale(1.2f).build())
    "Dreamy" -> listOf(Brightness(0.09f), Contrast(-0.14f))
    "Black & White" -> listOf(RgbFilter.createGrayscaleFilter(), Contrast(0.16f))
    "Soft Focus" -> listOf(GaussianBlur(2.4f), Brightness(0.035f), Contrast(-0.04f))
    "Color Pop" -> listOf(HslAdjustment.Builder().adjustSaturation(28f).build(), Contrast(0.12f))
    "Muted" -> listOf(HslAdjustment.Builder().adjustSaturation(-24f).build(), Contrast(-0.04f))
    "Sunset" -> listOf(HslAdjustment.Builder().adjustHue(12f).adjustSaturation(12f).adjustLightness(2f).build(), RgbAdjustment.Builder().setRedScale(1.08f).setBlueScale(0.92f).build())
    "Arctic" -> listOf(HslAdjustment.Builder().adjustHue(-12f).adjustSaturation(8f).build(), RgbAdjustment.Builder().setRedScale(0.92f).setBlueScale(1.1f).build())
    else -> emptyList()
  }

  /** The Reel's texts over one clip: each drawn while the Reel's time is within its start and end (`offset`: where the
   * clip starts in the Reel), white and bold with a shadow, in the lower middle as on the website. */
  private class TimedTexts(private val texts: org.json.JSONArray, private val offset: Double, private val w: Int, private val h: Int) : BitmapOverlay() {
    private val blank = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
    private val drawn = HashMap<Int, Bitmap>()
    override fun getBitmap(presentationTimeUs: Long): Bitmap {
      val t = offset + presentationTimeUs / 1_000_000.0
      for (i in 0 until texts.length()) {
        val x = texts.getJSONObject(i)
        if (t >= x.optDouble("start") && t <= x.optDouble("end")) return drawn.getOrPut(i) { draw(x) }
      }
      return blank
    }
    override fun getOverlaySettings(presentationTimeUs: Long) = StaticOverlaySettings.Builder().setBackgroundFrameAnchor(0f, -0.45f).build()
    private fun draw(x: JSONObject): Bitmap {
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = try { Color.parseColor(x.optString("color", "#FFFFFF")) } catch (_: Exception) { Color.WHITE }
        textSize = x.optDouble("size", 36.0).toFloat() * w / 540f; typeface = Typeface.DEFAULT_BOLD
        setShadowLayer(textSize / 8, 0f, textSize / 14, Color.argb(160, 0, 0, 0))
      }
      val words = x.optString("text")
      val pad = (paint.textSize / 3).toInt()
      val width = (paint.measureText(words).toInt() + pad * 2).coerceIn(2, w)
      val height = (paint.fontSpacing.toInt() + pad * 2).coerceAtLeast(2)
      return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { Canvas(it).drawText(words, pad.toFloat(), pad - paint.ascent(), paint) }
    }
  }
}
