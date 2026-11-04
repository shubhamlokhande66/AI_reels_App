package expo.modules.shubixvideo

import android.graphics.Bitmap
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Typeface
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/** The studio's texts on the phone, drawn as the website's drawOverlay() (engine.ts): its 11 styles, entrances, exits,
 * loops, keyframes (uk), place (x, y in the safe area) and focus. Google fonts are not on the phone: each one is drawn in
 * the nearest Android family (condensed, serif, script, casual). One renderer for the whole Reel, two full-frame bitmaps
 * in turn (Media3 uploads an overlay again only when it is given another bitmap). */
@UnstableApi
internal class StudioTextRenderer(texts: JSONArray, private val w: Int, private val h: Int, private val person: PersonMask? = null) {
  private val list = (0 until texts.length()).mapNotNull { texts.optJSONObject(it) }.filter { it.optString("text").isNotBlank() }
  private val bufs = arrayOf(Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888), Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888))
  private var turn = 0
  private var behindBuf: Bitmap? = null
  private val blank = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)

  @Synchronized fun at(t: Double): Bitmap {
    val on = list.filter { t >= it.optDouble("start") && t < it.optDouble("end") }
    if (on.isEmpty()) return blank
    turn = 1 - turn; val b = bufs[turn]; b.eraseColor(Color.TRANSPARENT)
    val c = Canvas(b)
    // text behind the person: drawn on its own, the person cut out of it, then put under the other texts
    val back = if (person != null) on.filter { it.optBoolean("behind") } else emptyList()
    if (back.isNotEmpty()) {
      person!!.want(t)
      val under = behindBuf ?: Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { behindBuf = it }
      under.eraseColor(Color.TRANSPARENT)
      val cut = Canvas(under); for (ov in back) draw(cut, ov, t)
      person.latest?.let { mask ->
        // the mask of the whole frame, placed as the shot fills the Reel (cover)
        val scale = max(w.toFloat() / mask.width, h.toFloat() / mask.height)
        val place = Matrix().apply { setScale(scale, scale); postTranslate((w - mask.width * scale) / 2, (h - mask.height * scale) / 2) }
        cut.drawBitmap(mask, place, Paint(Paint.FILTER_BITMAP_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OUT) })
      }
      c.drawBitmap(under, 0f, 0f, null)
    }
    for (ov in on) if (ov !in back) draw(c, ov, t)
    return b
  }

  fun overlay(offset: Double) = object : BitmapOverlay() {
    override fun getBitmap(presentationTimeUs: Long): Bitmap = at(offset + presentationTimeUs / 1_000_000.0)
  }

  private fun col(s: String, d: Int = Color.WHITE) = try { Color.parseColor(s) } catch (_: Exception) { d }
  private fun dark(c: Int) = Color.red(c) * 0.299 + Color.green(c) * 0.587 + Color.blue(c) * 0.114 < 140
  private fun face(font: String, clean: Boolean): Typeface = when (font) {
    "anton", "bebas", "oswald" -> Typeface.create("sans-serif-condensed", Typeface.BOLD)
    "playfair", "rozha", "yatra" -> Typeface.create(Typeface.SERIF, Typeface.BOLD)
    "pacifico", "dancing", "lobster", "caveat", "kalam" -> Typeface.create("cursive", Typeface.BOLD)
    "marker", "bangers" -> Typeface.create("casual", Typeface.BOLD)
    else -> if (clean) Typeface.create("sans-serif-medium", Typeface.NORMAL) else Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
  }

  private fun draw(g: Canvas, ov: JSONObject, t: Double) {
    val W = w.toFloat(); val H = h.toFloat(); val a = ov.optDouble("start"); val b = ov.optDouble("end")
    val emoji = ov.optBoolean("emoji"); val style = ov.optString("style", "bold"); val anim = ov.optString("anim", "pop")
    val out = ov.optString("out", "none"); val loop = ov.optString("loop", "none"); val color = col(ov.optString("color", "#FFFFFF"))
    val size = ov.optDouble("size", 36.0) / 36.0   // the phone keeps the studio's size x 36
    val base = min(W, H * 0.5625f); val since = t - a; val left = b - t
    val fs = Math.round(base.toDouble() * (if (emoji) 0.16 else 0.075) * size).toFloat()
    var blurPx = 0f; var spin = 0.0; var glitchPx = 0f; var alpha = if (out != "none") 1.0 else min(1.0, left / 0.15); var sc = 1.0; var dy = 0.0
    var txt = ov.optString("text")
    when (anim) {
      "pop" -> { val q = min(1.0, since / 0.22); sc = 0.6 + 0.4 * outBack(q); alpha *= min(1.0, since / 0.08) }
      "fade" -> alpha *= min(1.0, since / 0.35)
      "slide" -> { val q = min(1.0, since / 0.3); dy = (1 - outCubic(q)) * fs * 1.2; alpha *= q }
      "type" -> { val n = max(1, Math.ceil(since / 0.05).toInt()); txt = txt.codePoints().toArray().take(n).joinToString("") { String(Character.toChars(it)) } }
      "zoom" -> { val q = min(1.0, since / 0.3); sc = 2.4 - 1.4 * outCubic(q); alpha *= q }
      "drop" -> { val q = min(1.0, since / 0.45); dy = -(1 - outBack(q)) * fs * 3; alpha *= min(1.0, since / 0.1) }
      "blur" -> { val q = min(1.0, since / 0.4); blurPx = ((1 - q) * fs * 0.4).toFloat(); alpha *= q }
      "spin" -> { val q = min(1.0, since / 0.4); spin = (1 - outCubic(q)) * -180; sc = 0.3 + 0.7 * outCubic(q); alpha *= q }
      "flicker" -> if (since < 0.5) alpha *= listOf(1.0, 0.0, 1.0, 0.2, 1.0, 0.0, 1.0).getOrElse(floor(since / 0.07).toInt()) { 1.0 }
      "glitch" -> if (since < 0.45) { val j = floor(since * 40).toInt(); dy = ((j * 37) % 7 - 3) * fs * 0.04; glitchPx = (((j * 53) % 9 - 4) * fs * 0.05).toFloat() }
    }
    val q2 = max(0.0, 1 - left / 0.3)
    if (out != "none" && q2 > 0) when (out) {
      "fade" -> alpha *= 1 - q2
      "pop" -> { sc *= 1 - 0.7 * inOut(q2); alpha *= 1 - q2 }
      "slide" -> { dy += q2 * q2 * fs * 1.5; alpha *= 1 - q2 }
      "zoom" -> { sc *= 1 + 1.6 * q2 * q2; alpha *= 1 - q2 }
      "blur" -> { blurPx += (q2 * fs * 0.4).toFloat(); alpha *= 1 - q2 }
      "spin" -> { spin += q2 * q2 * 180; sc *= 1 - 0.7 * q2; alpha *= 1 - q2 }
    }
    if (emoji) sc *= 1 + 0.05 * sin(t * 6)
    var lx = 0.0; var ly = 0.0; var lr = 0.0
    val wv = since * PI * 2
    when (loop) {
      "bounce" -> ly = -abs(sin(wv * 0.9)) * fs * 0.35
      "spin" -> lr = since * 240
      "wiggle" -> lr = sin(wv * 2.2) * 12
      "pulse" -> sc *= 1 + 0.12 * abs(sin(wv * 1.1))
      "float" -> { ly = sin(wv * 0.5) * fs * 0.18; lx = cos(wv * 0.35) * fs * 0.12 }
      "swing" -> lr = sin(wv * 0.8) * 18
      "shake" -> { lx = sin(since * 97) * fs * 0.06; ly = cos(since * 71) * fs * 0.05 }
    }
    val u = ukAt(ov.optJSONArray("uk") ?: ov.optJSONArray("keyframes"), since)
    if (u != null) { sc *= max(0.01, u[3]); alpha *= u[5].coerceIn(0.0, 1.0) }
    if (alpha <= 0.001) return
    val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = fs; typeface = if (emoji) Typeface.DEFAULT else face(ov.optString("font"), style == "clean"); textAlign = Paint.Align.CENTER; strokeJoin = Paint.Join.ROUND }
    if (blurPx > 0.5f) p.maskFilter = BlurMaskFilter(blurPx, BlurMaskFilter.Blur.NORMAL)
    val lines = if (emoji) listOf(txt) else wrap(p, txt, W * 0.82f); val lh = fs * 1.18f
    val tw = max(lines.maxOf { p.measureText(it) }, fs * 0.6f); val th = lh * lines.size
    val top = H * (220f / 1920f) + th / 2 + fs * 0.3f; val bot = H * (1 - 450f / 1920f) - th / 2 - fs * 0.3f
    var cx = max(tw / 2 + W * 0.05f, min(W - tw / 2 - W * 0.05f, (ov.optDouble("x", 0.5) * W).toFloat()))
    var cy = (max(top, min(bot, (ov.optDouble("y", 0.4) * H).toFloat())) + dy).toFloat()
    if (u != null) { cx += (u[1] * W).toFloat(); cy += (u[2] * H).toFloat() }
    val focus = ov.optDouble("focus", Double.NaN); val fx = if (focus.isFinite()) ((focus - 0.5) * tw).toFloat() else 0f
    val baseline = { k: Int -> (k - (lines.size - 1) / 2f) * lh - (p.ascent() + p.descent()) / 2 }   // "middle" as the canvas's textBaseline
    val layer = g.saveLayerAlpha(null, (alpha.coerceIn(0.0, 1.0) * 255).toInt())
    g.translate((cx + lx + fx).toFloat(), (cy + ly).toFloat())
    val rot = (u?.get(4) ?: 0.0) + lr + spin; if (rot != 0.0) g.rotate(rot.toFloat())
    g.scale(sc.toFloat(), sc.toFloat()); if (fx != 0f) g.translate(-fx, 0f)
    val fill = { c: Int, dx: Float, dyy: Float -> p.style = Paint.Style.FILL; p.color = c; lines.forEachIndexed { k, l -> g.drawText(l, dx, baseline(k) + dyy, p) } }
    val stroke = { c: Int, wd: Float -> p.style = Paint.Style.STROKE; p.strokeWidth = wd; p.color = c; lines.forEachIndexed { k, l -> g.drawText(l, 0f, baseline(k), p) } }
    if (glitchPx != 0f) { val a0 = p.alpha; p.alpha = 153; fill(Color.rgb(255, 42, 109), glitchPx, 0f); fill(Color.rgb(5, 217, 232), -glitchPx, 0f); p.alpha = a0 }
    val contrast = if (dark(color)) Color.WHITE else Color.rgb(17, 17, 17)
    when {
      emoji -> fill(color, 0f, 0f)
      style == "box" || style == "tag" -> { val tag = style == "tag"; val pw = tw + fs * (if (tag) 1.05f else 0.6f); val ph = th + fs * 0.36f; val r = if (tag) fs * 0.5f else fs * 0.2f
        val bp = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }; g.drawRoundRect(RectF(-pw / 2, -ph / 2, pw / 2, ph / 2), r, r, bp)
        if (tag) { bp.color = contrast; g.drawCircle(-pw / 2 + fs * 0.36f, 0f, fs * 0.1f, bp); g.translate(fs * 0.24f, 0f) }
        fill(contrast, 0f, fs * 0.03f) }
      style == "cutout" -> { g.restoreToCount(layer); cutout(g, ov, lines, p, cx + lx.toFloat() + fx, cy + ly.toFloat(), rot, sc, fx, lh, baseline, color, alpha); return }
      style == "neon" -> { p.setShadowLayer(fs * 0.6f, 0f, 0f, color); fill(Color.WHITE, 0f, 0f); fill(Color.WHITE, 0f, 0f); p.clearShadowLayer(); stroke(color, fs * 0.04f) }
      style == "outline" -> { p.setShadowLayer(fs * 0.12f, 0f, 0f, Color.argb(128, 0, 0, 0)); stroke(color, fs * 0.07f) }
      style == "shadow" -> { val off = fs * 0.09f; fill(contrast, off, off); fill(color, 0f, 0f) }
      style == "bubble" -> { val pw = tw + fs * 0.9f; val ph = th + fs * 0.6f; val r = fs * 0.45f; val bp = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
        g.drawRoundRect(RectF(-pw / 2, -ph / 2, pw / 2, ph / 2), r, r, bp)
        val tail = android.graphics.Path().apply { moveTo(-pw * 0.22f, ph / 2 - 2); lineTo(-pw * 0.34f, ph / 2 + fs * 0.5f); lineTo(-pw * 0.06f, ph / 2 - 2); close() }; g.drawPath(tail, bp)
        fill(contrast, 0f, fs * 0.03f) }
      style == "glow" -> { p.setShadowLayer(fs * 0.9f, 0f, 0f, color); fill(color, 0f, 0f); p.setShadowLayer(fs * 0.3f, 0f, 0f, color); fill(Color.WHITE, 0f, 0f) }
      style == "stack" -> { stroke(Color.rgb(17, 17, 17), fs * 0.34f); stroke(color, fs * 0.18f); fill(Color.WHITE, 0f, 0f) }
      style == "clean" -> { p.setShadowLayer(fs * 0.25f, 0f, 0f, Color.argb(140, 0, 0, 0)); fill(color, 0f, 0f) }
      else -> { stroke(if (dark(color)) Color.argb(230, 255, 255, 255) else Color.argb(224, 0, 0, 0), fs * 0.16f); p.setShadowLayer(fs * 0.18f, 0f, 0f, Color.argb(102, 0, 0, 0)); fill(color, 0f, 0f) }
    }
    g.restoreToCount(layer)
  }

  /** "Video in letters": the colour fills the frame, the shot shows through the letters (cut out of it) */
  private fun cutout(g: Canvas, ov: JSONObject, lines: List<String>, p: Paint, x: Float, y: Float, rot: Double, sc: Double, fx: Float, lh: Float, baseline: (Int) -> Float, color: Int, alpha: Double) {
    val layer = g.saveLayerAlpha(null, (alpha.coerceIn(0.0, 1.0) * 255).toInt())
    g.drawColor(color)
    g.translate(x, y); if (rot != 0.0) g.rotate(rot.toFloat()); g.scale(sc.toFloat(), sc.toFloat()); if (fx != 0f) g.translate(-fx, 0f)
    p.style = Paint.Style.FILL; p.xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
    lines.forEachIndexed { k, l -> g.drawText(l, 0f, baseline(k), p) }
    p.xfermode = null; g.restoreToCount(layer)
  }

  private fun wrap(p: Paint, text: String, maxW: Float): List<String> {
    val out = mutableListOf<String>()
    for (para in text.replace("\r", "").split("\n")) { var line = ""
      for (word in para.split(" ").filter { it.isNotEmpty() }) { val next = if (line.isEmpty()) word else "$line $word"
        if (line.isNotEmpty() && p.measureText(next) > maxW) { out += line; line = word } else line = next }
      out += line }
    return out.take(8)
  }

  /** the creator's keyframes on a text (uk: t, x, y, s, r, o, ez), as the website's uAt: [t, x, y, s, r, o] */
  private fun ukAt(list: JSONArray?, l: Double): DoubleArray? {
    if (list == null || list.length() == 0) return null
    val ks = (0 until list.length()).mapNotNull { list.optJSONObject(it) }.sortedBy { it.optDouble("t") }; if (ks.isEmpty()) return null
    val v = { k: JSONObject -> doubleArrayOf(k.optDouble("t"), k.optDouble("x", 0.0), k.optDouble("y", 0.0), k.optDouble("s", 1.0), k.optDouble("r", 0.0), k.optDouble("o", 1.0)) }
    if (l <= ks[0].optDouble("t")) return v(ks[0])
    for (i in 1 until ks.size) if (l <= ks[i].optDouble("t")) {
      val a = v(ks[i - 1]); val b = v(ks[i]); val pr = easeOf(ks[i].optString("ez", "inOut"), (l - a[0]) / max(1e-6, b[0] - a[0]))
      return DoubleArray(6) { a[it] + (b[it] - a[it]) * pr }
    }
    return v(ks.last())
  }
}

private fun outCubic(x: Double) = 1 - (1 - x).pow(3)
private fun inOut(x: Double) = -(cos(PI * x) - 1) / 2
private fun outBack(x: Double): Double { val c1 = 1.70158; val c3 = c1 + 1; return 1 + c3 * (x - 1).pow(3) + c1 * (x - 1).pow(2) }
private fun easeOf(n: String, x: Double) = when (n) { "lin" -> x; "outCubic" -> outCubic(x); "outBack" -> outBack(x); "inQuad" -> x * x
  "outExpo" -> if (x >= 1) 1.0 else 1 - 2.0.pow(-10 * x); else -> inOut(x) }
