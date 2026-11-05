package expo.modules.shubixvideo

import android.content.Context
import android.opengl.GLES20
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import org.json.JSONArray
import org.json.JSONObject

/** The studio's GPU passes on the phone: the website's own shader text (Shared/core/src/lib/shaders.ts), sent by the
 * phone's JS in the spec ("shaders"), so both engines run one program. A website texture's row 0 is the picture's top,
 * a Media3 texture's is its bottom: one #define turns every texture read over, the shader itself stays the website's. */
internal class StudioShaders(val vert: String, val pic: String, val grade: String, val adj: String?, val key: String?, val main: String?, val beauty: String?) {
  companion object {
    private const val FLIP = "#define texture2D(s, c) texture2D(s, vec2((c).x, 1.0 - (c).y))\n"
    fun of(spec: JSONObject): StudioShaders? {
      val s = spec.optJSONObject("shaders") ?: return null
      val vert = s.optString("vert"); val pic = s.optString("pic"); val grade = s.optString("grade")
      if (vert.isBlank() || pic.isBlank() || grade.isBlank()) return null
      val opt = { k: String -> s.optString(k).takeIf { it.isNotBlank() }?.let { FLIP + it } }
      return StudioShaders(vert, FLIP + pic, FLIP + grade, opt("adj"), opt("key"), opt("main"), opt("beauty"))
    }
  }
}

/** One full-frame pass of a studio shader over a clip. `local(t)`: the shot's own time for a frame `t` seconds into
 * this item (a speed-ramp slice starts `offset` seconds into its shot); `set` puts the uniforms for that moment. */
@UnstableApi
private class StudioPass(private val vert: String, private val frag: String, private val set: (GlProgram, Float, Float, Double) -> Unit) : GlEffect {
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = object : BaseGlShaderProgram(useHdr, 1) {
    private val program = GlProgram(vert, frag)
    private var w = 1f; private var h = 1f
    override fun configure(inputWidth: Int, inputHeight: Int): Size { w = inputWidth.toFloat(); h = inputHeight.toFloat(); return Size(inputWidth, inputHeight) }
    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
      program.use()
      program.setSamplerTexIdUniform("T", inputTexId, 0)
      program.setBufferAttribute("a", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
      program.bindAttributesAndUniforms()
      set(program, w, h, presentationTimeUs / 1_000_000.0)   // after: arrays (M[5], H[8]) go straight to GL
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
      GlUtil.checkGlError()
    }
    override fun release() { super.release(); program.delete() }
  }
}

/** a clip's studio passes from its spec: "pic" { kind (PIC_FX), amt } and "grade" { cv, hsl }; `offset` = where this
 * item starts in its shot, `len` = the shot's length (seconds), both on the output's clock */
@UnstableApi
internal fun studioStabilizer(clip: JSONObject): androidx.media3.effect.MatrixTransformation? {
  val path = clip.optJSONObject("stabPath") ?: return null
  val amount = clip.optJSONObject("cs")?.optDouble("stab", 0.0)?.takeIf { it.isFinite() && it > 0.0 } ?: return null
  val ts = path.optJSONArray("t") ?: return null; val xs = path.optJSONArray("dx") ?: return null; val ys = path.optJSONArray("dy") ?: return null
  if (ts.length() < 2 || xs.length() != ts.length() || ys.length() != ts.length()) return null
  val start = clip.optDouble("start", 0.0); val speed = clip.optDouble("speed", 1.0).takeIf { it.isFinite() && it > 0.0 } ?: 1.0
  val zoom = (1 + 0.12 * amount).toFloat()
  fun at(list: JSONArray, i: Int, j: Int, f: Double) = list.optDouble(i) + (list.optDouble(j) - list.optDouble(i)) * f
  return androidx.media3.effect.MatrixTransformation { us ->
    val t = start + us / 1_000_000.0 * speed
    var hi = 1
    while (hi < ts.length() - 1 && ts.optDouble(hi) < t) hi++
    val lo = hi - 1
    val f = ((t - ts.optDouble(lo)) / maxOf(1e-6, ts.optDouble(hi) - ts.optDouble(lo))).coerceIn(0.0, 1.0)
    // the frame is 2 wide in these units; up on screen is positive
    android.graphics.Matrix().apply { setScale(zoom, zoom); postTranslate((2 * at(xs, lo, hi, f) * amount).toFloat(), (-2 * at(ys, lo, hi, f) * amount).toFloat()) }
  }
}

internal fun studioPasses(sh: StudioShaders?, clip: JSONObject, offset: Double, len: Double): List<GlEffect> {
  if (sh == null) return emptyList()
  val out = mutableListOf<GlEffect>()
  // Adjust (the shot's cs: bri con sat warm hi sh hue sharp vig), with its keyframes (cs.kx, as the website's kxAt)
  val cs = clip.optJSONObject("cs")
  if (sh.adj != null && cs != null) {
    val base = ADJ.associateWith { cs.optDouble(it, 0.0).takeIf { v -> v.isFinite() } ?: 0.0 }
    val keys = cs.optJSONArray("kx")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) }.filter { it.has("t") }.sortedBy { it.optDouble("t") } } ?: emptyList()
    if (base.values.any { it != 0.0 } || keys.any { k -> ADJ.any { k.has(it) } }) out += StudioPass(sh.vert, sh.adj) { p, w, h, t ->
      val v = kxAt(base, keys, offset + t)
      GLES20.glUniform2f(p.getUniformLocation("res"), w, h)
      GLES20.glUniform4f(p.getUniformLocation("ad"), v.getValue("bri"), v.getValue("con"), v.getValue("sat"), v.getValue("warm"))
      GLES20.glUniform4f(p.getUniformLocation("ad2"), v.getValue("hi"), v.getValue("sh"), v.getValue("hue"), v.getValue("sharp"))
      GLES20.glUniform1f(p.getUniformLocation("vig"), v.getValue("vig") * 0.9f)
    }
  }
  val g = clip.optJSONObject("grade")
  if (g != null) {
    val curve = { k: String -> val a = g.optJSONObject("cv")?.optJSONArray(k); FloatArray(5) { i -> (a?.optDouble(i, i / 4.0) ?: (i / 4.0)).toFloat().coerceIn(0f, 1f) } }
    val bands = listOf("red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta")
    val hsl = g.optJSONObject("hsl")
    val H = FloatArray(24) { i -> (hsl?.optJSONArray(bands[i / 3])?.optDouble(i % 3, 0.0) ?: 0.0).toFloat().coerceIn(-1f, 1f) }
    val m = curve("m"); val r = curve("r"); val gg = curve("g"); val b = curve("b"); val useH = if (hsl != null) 1f else 0f
    out += StudioPass(sh.vert, sh.grade) { p, _, _, _ ->
      for ((n, a) in listOf("M" to m, "R" to r, "G" to gg, "B" to b)) GLES20.glUniform1fv(p.getUniformLocation(n), 5, a, 0)
      GLES20.glUniform3fv(p.getUniformLocation("H"), 8, H, 0); GLES20.glUniform1f(p.getUniformLocation("useH"), useH)
    }
  }
  val f = clip.optJSONObject("pic")
  val kind = f?.optInt("kind", 0) ?: 0
  if (kind in 1..12) {
    val amt = f!!.optDouble("amt", 1.0).coerceIn(0.0, 1.0)
    out += StudioPass(sh.vert, sh.pic) { p, w, h, t ->
      val local = offset + t
      // in over 0.25 s, out over the shot's last 0.15 s; 3D zoom (12) runs the whole shot on its progress (as the website)
      val ramp = if (kind == 12) 1.0 else minOf(1.0, local / 0.25, maxOf(0.0, len - local) / 0.15)
      GLES20.glUniform2f(p.getUniformLocation("res"), w, h)
      GLES20.glUniform1f(p.getUniformLocation("time"), (if (kind == 12) local / maxOf(0.1, len) else local).toFloat())
      GLES20.glUniform1f(p.getUniformLocation("kind"), kind.toFloat())
      GLES20.glUniform1f(p.getUniformLocation("amt"), (maxOf(0.0, ramp) * amt).toFloat())
    }
  }
  // skin smoothing (cs.beauty), the formula of the website's shot renderer
  val beauty = cs?.optDouble("beauty", 0.0)?.takeIf { it.isFinite() && it > 0.0 }
  if (sh.beauty != null && beauty != null) out += StudioPass(sh.vert, sh.beauty) { p, w, h, _ ->
    GLES20.glUniform2f(p.getUniformLocation("res"), w, h); GLES20.glUniform1f(p.getUniformLocation("be"), beauty.toFloat())
  }
  // chroma key (cs.ck: c, tol, bg), after the picture effects as on the website (shotKey)
  val ck = cs?.optJSONObject("ck")
  if (sh.key != null && ck != null && ck.optString("c").length == 7) {
    val key = rgb(ck.optString("c")); val bg = rgb(ck.optString("bg", "#000000")); val tol = ck.optDouble("tol", 0.35).toFloat().coerceIn(0.05f, 0.9f)
    out += StudioPass(sh.vert, sh.key) { p, _, _, _ ->
      GLES20.glUniform3f(p.getUniformLocation("key"), key[0], key[1], key[2]); GLES20.glUniform3f(p.getUniformLocation("bg"), bg[0], bg[1], bg[2])
      GLES20.glUniform1f(p.getUniformLocation("tol"), tol)
    }
  }
  return out
}

private fun rgb(hex: String): FloatArray { val n = hex.removePrefix("#").toLongOrNull(16) ?: 0L; return floatArrayOf(((n shr 16) and 255) / 255f, ((n shr 8) and 255) / 255f, (n and 255) / 255f) }

/** a shot's mask (cs.mk) drawn as the website's maskPath()/shotMask(): the same shapes and sizes (on the frame's width),
 * the colour outside it (or inside, inverted), a soft edge; its keyframes (kx: mk x y w h a f) move it. A full-frame
 * bitmap over the shot, drawn again only when the mask moves. */
@UnstableApi
internal fun studioMask(clip: JSONObject, offset: Double, w: Int, h: Int): androidx.media3.effect.TextureOverlay? {
  val cs = clip.optJSONObject("cs") ?: return null
  val mk = cs.optJSONObject("mk") ?: return null
  val keys = cs.optJSONArray("kx")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) }.filter { it.has("t") && it.has("mk") }.sortedBy { it.optDouble("t") } } ?: emptyList()
  val base = MK.associateWith { mk.optDouble(it, MK_D.getValue(it)) }
  val mkKeys = keys.map { JSONObject(it.optJSONObject("mk")!!.toString()).put("t", it.optDouble("t")).put("ez", it.optString("ez", "inOut")) }
  val shape = mk.optString("s", "circle"); val inv = mk.optBoolean("inv"); val col = android.graphics.Color.parseColor(mk.optString("c", "#000000").takeIf { it.length == 7 } ?: "#000000")
  return object : androidx.media3.effect.BitmapOverlay() {
    // two in turn: Media3 uploads an overlay again only when it is given another bitmap
    private val bufs = Array(2) { android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888) }
    private var cur = 0
    private var last: Map<String, Float>? = null
    override fun getBitmap(presentationTimeUs: Long): android.graphics.Bitmap {
      val m = kxAt(base, mkKeys, offset + presentationTimeUs / 1_000_000.0)
        .mapValues { Math.round(it.value * 1000f) / 1000f }
      if (m != last) { cur = 1 - cur; drawMask(bufs[cur], m, shape, inv, col); last = m }
      return bufs[cur]
    }
  }
}
private val MK = listOf("x", "y", "w", "h", "a", "f")
private val MK_D = mapOf("x" to 0.5, "y" to 0.5, "w" to 0.7, "h" to 0.7, "a" to 0.0, "f" to 0.04)
private fun drawMask(b: android.graphics.Bitmap, m: Map<String, Float>, shape: String, inv: Boolean, col: Int) {
  val W = b.width.toFloat(); val H = b.height.toFloat(); val w = m.getValue("w") * W; val hh = m.getValue("h") * W; val R = Math.hypot(W.toDouble(), H.toDouble()).toFloat() * 2
  val c = android.graphics.Canvas(b); b.eraseColor(if (inv) android.graphics.Color.TRANSPARENT else col)
  val path = android.graphics.Path(); val s = w / 2
  when (shape) {
    "rect" -> path.addRect(-w / 2, -hh / 2, w / 2, hh / 2, android.graphics.Path.Direction.CW)
    "heart" -> { path.moveTo(0f, s * 0.9f); path.cubicTo(-s * 1.7f, -s * 0.15f, -s * 0.65f, -s * 1.35f, 0f, -s * 0.45f); path.cubicTo(s * 0.65f, -s * 1.35f, s * 1.7f, -s * 0.15f, 0f, s * 0.9f); path.close() }
    "star" -> { for (k in 0 until 10) { val r = if (k % 2 == 1) w * 0.21f else w / 2; val a = -Math.PI / 2 + k * Math.PI / 5; val x = (Math.cos(a) * r).toFloat(); val y = (Math.sin(a) * r).toFloat(); if (k == 0) path.moveTo(x, y) else path.lineTo(x, y) }; path.close() }
    "split" -> path.addRect(-R, 0f, R, R, android.graphics.Path.Direction.CW)
    "film" -> path.addRect(-R, -hh / 2, R, hh / 2, android.graphics.Path.Direction.CW)
    else -> path.addOval(-w / 2, -hh / 2, w / 2, hh / 2, android.graphics.Path.Direction.CW)
  }
  val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
  val f = m.getValue("f"); if (f > 0.005f) paint.maskFilter = android.graphics.BlurMaskFilter(maxOf(1f, f * W * 0.4f), android.graphics.BlurMaskFilter.Blur.NORMAL)
  if (inv) paint.color = col else paint.xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.CLEAR)
  c.save(); c.translate(m.getValue("x") * W, m.getValue("y") * H); c.rotate(m.getValue("a")); c.drawPath(path, paint); c.restore()
}

private val ADJ = listOf("bri", "con", "sat", "warm", "hi", "sh", "hue", "sharp", "vig")
private fun ease(name: String, x: Double): Double = when (name) {
  "lin" -> x; "outCubic" -> 1 - Math.pow(1 - x, 3.0); "outExpo" -> if (x >= 1) 1.0 else 1 - Math.pow(2.0, -10 * x)
  "outBack" -> { val c1 = 1.70158; val c3 = c1 + 1; 1 + c3 * Math.pow(x - 1, 3.0) + c1 * Math.pow(x - 1, 2.0) }
  "inQuad" -> x * x; else -> -(Math.cos(Math.PI * x) - 1) / 2
}
/** a shot's values at `l` seconds into it: between its two keys, eased (a field a key leaves out is the shot's own), as
 * the website's kxAt (engine.ts) */
private fun kxAt(base: Map<String, Double>, keys: List<JSONObject>, l: Double): Map<String, Float> {
  if (keys.isEmpty()) return base.mapValues { it.value.toFloat() }
  var a = keys.first(); var b = a; var p = 0.0
  if (l >= keys.last().optDouble("t")) { a = keys.last(); b = a }
  else if (l > keys.first().optDouble("t")) for (k in 1 until keys.size) if (l <= keys[k].optDouble("t")) {
    a = keys[k - 1]; b = keys[k]; val ta = a.optDouble("t"); val tb = b.optDouble("t")
    p = ease(b.optString("ez", "inOut"), ((l - ta) / maxOf(1e-6, tb - ta)).coerceIn(0.0, 1.0)); break
  }
  return base.mapValues { (n, d) -> val x = if (a.has(n)) a.optDouble(n, d) else d; val y = if (b.has(n)) b.optDouble(n, d) else d; (x + (y - x) * p).toFloat() }
}
