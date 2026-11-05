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
 * (engine.ts): place, size, turn, flip, crop, fades, round corners and the masks. A mask's soft edge is not drawn. In the export
 * (`exact`): chroma key, the luma mask, following a face, and blend modes (LayerBlend, StudioPasses.kt). In the player a video
 * layer shows the newest frame its worker has decoded; in the export it waits for the right one. */
@UnstableApi
internal class StudioLayerRenderer(layers: JSONArray, private val w: Int, private val h: Int, private val exact: Boolean = false) {
  private class Layer(val spec: JSONObject, val feed: () -> Bitmap?, val ask: (Double) -> Unit, val done: () -> Unit = {})
  private val list = (0 until layers.length()).mapNotNull { layers.optJSONObject(it) }.filter { File(it.optString("path")).isFile }.map { spec ->
    if (spec.optString("kind") == "video" && exact) ExactFeed(spec.optString("path"), maxOf(w, h)).let { f -> Layer(spec, { f.latest }, { f.at(it) }, { f.close() }) }
    else if (spec.optString("kind") == "video") VideoFeed(spec.optString("path"), maxOf(w, h)).let { f -> Layer(spec, { f.latest }, { f.want(it) }) }
    else { val pic by lazy { photo(spec.optString("path"), maxOf(w, h)) }; Layer(spec, { pic }, {}) }
  }
  private val bufs = arrayOf(Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888), Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888))
  private var turn = 0
  private val blank = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)

  @Synchronized fun at(t: Double): Bitmap {
    list.filter { t >= it.spec.optDouble("t1") }.forEach { it.done() }
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
    val place = followed(L, t)
    val crop = L.optJSONObject("crop")
    fun cut(k: String) = crop?.optDouble(k, 0.0) ?: 0.0
    val from = Rect((pic.width * cut("l")).toInt(), (pic.height * cut("t")).toInt(), (pic.width * (1 - cut("r"))).toInt(), (pic.height * (1 - cut("b"))).toInt())
    if (from.width() < 2 || from.height() < 2) return
    val dw = maxOf(2f, L.optDouble("s", 0.5).toFloat() * W); val dh = dw * from.height() / from.width()
    val fadeIn = L.optDouble("fin", 0.0); val fadeOut = L.optDouble("fout", 0.0)
    val fade = min(if (fadeIn > 0) min(1.0, (t - L.optDouble("t0")) / fadeIn) else 1.0, if (fadeOut > 0) min(1.0, (L.optDouble("t1") - t) / fadeOut) else 1.0)
    val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG).apply { alpha = (L.optDouble("op", 1.0) * fade * 255).toInt().coerceIn(0, 255) }
    g.save()
    g.translate(place.first * W, place.second * H)
    g.rotate(L.optDouble("r", 0.0).toFloat())
    g.scale(if (L.optBoolean("fh")) -1f else 1f, if (L.optBoolean("fv")) -1f else 1f)
    val box = RectF(-dw / 2, -dh / 2, dw / 2, dh / 2)
    shape(L, dw, dh)?.let { (path, inside) -> if (inside) g.clipPath(path) else g.clipOutPath(path) }
    val round = L.optDouble("rad", 0.0).toFloat() * min(dw, dh) / 2
    if (round > 0) g.clipPath(Path().apply { addRoundRect(box, round, round, Path.Direction.CW) })
    val keyed = if (exact) pixelMasks(L, pic, from, dw.toInt(), dh.toInt()) else null
    if (keyed != null) { g.drawBitmap(keyed, null, box, paint); keyed.recycle() } else g.drawBitmap(pic, from, box, paint)
    g.restore()
  }

  /** where the layer is: its place, or the face it follows at this time (samples from the studio: t, x, y) */
  private fun followed(L: JSONObject, t: Double): Pair<Float, Float> {
    val path = L.optJSONArray("followPath")
    if (path != null && path.length() > 0) {
      var best = path.optJSONArray(0)
      for (i in 1 until path.length()) { val p = path.optJSONArray(i) ?: continue; if (kotlin.math.abs(p.optDouble(0) - t) < kotlin.math.abs(best.optDouble(0) - t)) best = p }
      return Pair(best.optDouble(1).toFloat(), best.optDouble(2).toFloat())
    }
    return Pair(L.optDouble("x", 0.5).toFloat(), L.optDouble("y", 0.5).toFloat())
  }

  /** chroma key and the luma mask, pixel by pixel as the website's chromaKey() and layerMask(); null: the layer has neither */
  private fun pixelMasks(L: JSONObject, pic: Bitmap, from: Rect, dw: Int, dh: Int): Bitmap? {
    val key = L.optJSONObject("key")?.takeIf { it.optBoolean("on") }; val luma = L.optString("mask") == "luma"
    if (key == null && !luma) return null
    val out = Bitmap.createBitmap(maxOf(2, dw), maxOf(2, dh), Bitmap.Config.ARGB_8888)
    Canvas(out).drawBitmap(pic, from, Rect(0, 0, out.width, out.height), Paint(Paint.FILTER_BITMAP_FLAG))
    val px = IntArray(out.width * out.height); out.getPixels(px, 0, out.width, 0, 0, out.width, out.height)
    if (key != null) {
      val c = try { Color.parseColor(key.optString("c", "#00FF00")) } catch (_: Exception) { Color.GREEN }
      val kr = Color.red(c).toDouble(); val kg = Color.green(c).toDouble(); val kb = Color.blue(c).toDouble()
      val tol = 40 + key.optDouble("tol", 0.35) * 180; val soft = 40.0; val top = maxOf(kr, kg, kb); val dom = if (kg == top) 1 else if (kb == top) 2 else 0
      for (i in px.indices) {
        val v = px[i]; val r = Color.red(v); val gr = Color.green(v); val b = Color.blue(v)
        val dist = Math.sqrt((r - kr) * (r - kr) + (gr - kg) * (gr - kg) + (b - kb) * (b - kb))
        if (dist < tol) px[i] = 0
        else if (dist < tol + soft) {
          val a = (Color.alpha(v) * (dist - tol) / soft).toInt()
          px[i] = if (dom == 1 && gr > maxOf(r, b)) Color.argb(a, r, maxOf(r, b), b) else if (dom == 2 && b > maxOf(r, gr)) Color.argb(a, r, gr, maxOf(r, gr)) else Color.argb(a, r, gr, b)
        }
      }
    }
    if (luma) {
      val m = L.optJSONObject("mk") ?: JSONObject(); val th = m.optDouble("th", 0.5).coerceIn(0.0, 1.0); val sf = m.optDouble("f", 0.12).coerceIn(0.015, 0.5)
      val lo = maxOf(0.0, th - sf); val hi = minOf(1.0, th + sf); val inv = m.optBoolean("inv")
      for (i in px.indices) {
        val v = px[i]; val lum = (0.2126 * Color.red(v) + 0.7152 * Color.green(v) + 0.0722 * Color.blue(v)) / 255
        val x = ((lum - lo) / maxOf(0.0001, hi - lo)).coerceIn(0.0, 1.0); var mask = x * x * (3 - 2 * x); if (inv) mask = 1 - mask
        px[i] = Color.argb((Color.alpha(v) * mask).toInt(), Color.red(v), Color.green(v), Color.blue(v))
      }
    }
    out.setPixels(px, 0, out.width, 0, 0, out.width, out.height)
    return out
  }

  /** the layer's mask as a path around its centre, and whether its inside is what shows */
  private fun shape(L: JSONObject, dw: Float, dh: Float): Pair<Path, Boolean>? {
    val m = L.optJSONObject("mk") ?: JSONObject()
    val mw = m.optDouble("w", 0.8).toFloat() * dw; val mh = m.optDouble("h", 0.8).toFloat() * dh
    val box = RectF(-mw / 2, -mh / 2, mw / 2, mh / 2); val path = Path()
    when (L.optString("mask")) {
      "circle", "radial", "oval", "ellipse" -> path.addOval(box, Path.Direction.CW)
      "rect", "rectangle" -> path.addRect(box, Path.Direction.CW)
      "line" -> { val R = Math.hypot(dw.toDouble(), dh.toDouble()).toFloat(); path.addRect(RectF(-R, -R, R, (m.optDouble("h", 0.8).toFloat() - 0.5f) * dh), Path.Direction.CW) }
      "mirror" -> { val R = Math.hypot(dw.toDouble(), dh.toDouble()).toFloat(); path.addRect(RectF(-R, -mh / 2, R, mh / 2), Path.Direction.CW) }
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

  /** a video layer's frames for the export: the frame of the time asked, read at once; the reader closes when the layer is over */
  private class ExactFeed(private val path: String, private val side: Int) {
    var latest: Bitmap? = null
    private var reader: MediaMetadataRetriever? = null
    private var closed = false
    fun at(seconds: Double) {
      if (closed) return
      val r = reader ?: MediaMetadataRetriever().also { it.setDataSource(path); reader = it }
      val us = (seconds * 1_000_000).toLong()
      val frame = if (Build.VERSION.SDK_INT >= 27) r.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST, side / 2, side / 2) else r.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST)
      if (frame != null) { latest?.recycle(); latest = frame }
    }
    fun close() { if (closed) return; closed = true; runCatching { reader?.release() }; reader = null }
  }

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
