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
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin

/** The studio's 44 transitions on the phone, as the website draws them (engine.ts drawFrameGL): the outgoing shot's
 * last frame (the website holds it too) and the incoming shot, through the studio's own renderer MAIN_FRAG.
 * KeepLast copies each finished frame of a shot into `held` (the last one stays); the next shot's Transition draws
 * both while its transition runs, then passes its picture on unchanged. Both run in the sequence's one GL context. */
internal class HeldFrame { var tex = 0; var w = 0; var h = 0; var has = false }

@UnstableApi
internal class KeepLast(private val vert: String, private val held: HeldFrame) : GlEffect {
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = object : BaseGlShaderProgram(useHdr, 1) {
    private val copy = GlProgram(vert, COPY)
    private var w = 1; private var h = 1
    override fun configure(inputWidth: Int, inputHeight: Int): Size { w = inputWidth; h = inputHeight; return Size(w, h) }
    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
      draw(copy, inputTexId)
      if (held.tex == 0 || held.w != w || held.h != h) {
        if (held.tex != 0) GlUtil.deleteTexture(held.tex)
        held.tex = GlUtil.createTexture(w, h, false); held.w = w; held.h = h
      }
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, held.tex)
      GLES20.glCopyTexSubImage2D(GLES20.GL_TEXTURE_2D, 0, 0, 0, 0, 0, w, h)   // the frame just drawn, kept
      held.has = true
    }
    override fun release() { super.release(); copy.delete() }
  }
}

@UnstableApi
internal class Transition(private val vert: String, private val main: String, private val held: HeldFrame, private val id: String, private val dur: Double, private val offset: Double) : GlEffect {
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = object : BaseGlShaderProgram(useHdr, 1) {
    private val copy = GlProgram(vert, COPY)
    private val prog = GlProgram(vert, main)
    private var w = 1f; private var h = 1f
    override fun configure(inputWidth: Int, inputHeight: Int): Size { w = inputWidth.toFloat(); h = inputHeight.toFloat(); return Size(inputWidth, inputHeight) }
    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
      val local = offset + presentationTimeUs / 1_000_000.0
      val p = if (dur > 0) (local / dur).coerceIn(0.0, 1.0) else 1.0
      if (p >= 1.0 || (!held.has && id != "fadein")) { draw(copy, inputTexId); return }
      val s = stateOf(id, p, w, h, held.has)
      prog.use()
      // Media3 binds every sampler itself: each must be named here, before bindAttributesAndUniforms
      prog.setSamplerTexIdUniform("tB", if (s.swap) held.tex else inputTexId, 0)
      prog.setSamplerTexIdUniform("tA", if (held.has) held.tex else inputTexId, 1)
      prog.setSamplerTexIdUniform("tL", inputTexId, 2)
      prog.setBufferAttribute("a", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
      prog.bindAttributesAndUniforms()
      val u = { n: String -> prog.getUniformLocation(n) }
      val f1 = { n: String, v: Float -> GLES20.glUniform1f(u(n), v) }
      val f2 = { n: String, a: Float, b: Float -> GLES20.glUniform2f(u(n), a, b) }
      val f3 = { n: String, a: Float, b: Float, c: Float -> GLES20.glUniform3f(u(n), a, b, c) }
      val f4 = { n: String, a: FloatArray -> GLES20.glUniform4f(u(n), a[0], a[1], a[2], a[3]) }
      f2("res", w, h)
      for ((k, L) in listOf("A" to s.a, "B" to s.b)) {
        f4("r$k", L.rect); f1("rot$k", L.rot); f1("zb$k", L.zb); f2("db$k", L.dbx, L.dby); f1("rgb$k", L.rgb); f1("ex$k", L.expo); f1("br$k", 1f)
        f2("off$k", 0f, 0f); f1("cl$k", L.clip); f4("tf$k", floatArrayOf(1f, 0f, 0f, 1f)); f4("bg$k", floatArrayOf(0f, 0f, 0f, -1f)); f4("bgr$k", floatArrayOf(0f, 0f, 1f, 1f))
        f4("bd$k", FloatArray(4)); f4("ad$k", FloatArray(4)); f4("ad2$k", FloatArray(4)); f1("be$k", 0f); f1("al$k", 1f)
      }
      f1("hasA", if (s.hasA) 1f else 0f); f1("mode", s.mode); f1("prog", s.prog); f1("mixv", s.mix); f2("irisC", w / 2, h / 2)
      f1("time", local.toFloat()); f1("snap", 0f); f4("bgR", floatArrayOf(0f, 0f, 1f, 1f)); f1("bgDark", 0f); f4("frR", floatArrayOf(0f, 0f, w, h)); f1("border", 0f)
      // the look is the shot's own (done before this pass): a neutral grade here, so it is not given twice
      f1("con", 1f); f1("sat", 1f); f1("bri", 1f); f1("teal", 0f); f1("mono", 0f); f1("vig", 0f); f1("grain", 0f); f1("warm", 0f); f1("lift", 0f)
      f4("tsh", floatArrayOf(0.5f, 0.5f, 0.5f, 0f)); f4("thi", floatArrayOf(0.5f, 0.5f, 0.5f, 0f))
      f1("flash", s.flash); f3("leak", s.leak[0], s.leak[1], s.leak[2]); f1("loopMix", 0f)
      f4("mz", FloatArray(4)); f1("mzc", 1f); f4("mg", floatArrayOf(0f, 0f, 0f, 1f)); f4("shp", FloatArray(4)); f4("shq", FloatArray(4))
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
      GlUtil.checkGlError()
    }
    override fun release() { super.release(); copy.delete(); prog.delete() }
  }
}

private const val COPY = "precision mediump float; varying vec2 v; uniform sampler2D T; void main(){ gl_FragColor = texture2D(T, vec2(v.x, 1.0 - v.y)); }"
private fun draw(p: GlProgram, tex: Int) {
  p.use(); p.setSamplerTexIdUniform("T", tex, 0)
  p.setBufferAttribute("a", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
  p.bindAttributesAndUniforms(); GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
}

/** one shot in the transition: its rect on the frame (x, y, w, h in pixels, y down), turn (radians), blurs, colour split, light */
private class Layer(var rect: FloatArray, var rot: Float = 0f, var zb: Float = 0f, var dbx: Float = 0f, var dby: Float = 0f, var rgb: Float = 0f, var expo: Float = 0f, var clip: Float = 0f)
private class TrState(val a: Layer, var b: Layer, var hasA: Boolean, var mode: Float = 0f, var prog: Float = 0f, var mix: Float = 1f, var flash: Float = 0f, var leak: FloatArray = FloatArray(3), var swap: Boolean = false)

private fun outCubic(x: Double) = 1 - (1 - x).pow(3)
private fun inOut(x: Double) = -(cos(PI * x) - 1) / 2
private fun outExpo(x: Double) = if (x >= 1) 1.0 else 1 - 2.0.pow(-10 * x)
private fun outBack(x: Double): Double { val c1 = 1.70158; val c3 = c1 + 1; return 1 + c3 * (x - 1).pow(3) + c1 * (x - 1).pow(2) }

/** the website's drawFrameGL switch (engine.ts), for a full-frame picture: the same modes, progress and moves */
private fun stateOf(id: String, p: Double, W: Float, H: Float, hasA: Boolean): TrState {
  val q = outCubic(p)
  fun L(scale: Double = 1.0, dx: Double = 0.0, dy: Double = 0.0, rot: Double = 0.0, zb: Double = 0.0, dbx: Double = 0.0, dby: Double = 0.0, rgb: Double = 0.0) =
    Layer(floatArrayOf((W / 2 - W * scale / 2 + dx).toFloat(), (H / 2 - H * scale / 2 + dy).toFloat(), (W * scale).toFloat(), (H * scale).toFloat()), (rot * PI / 180).toFloat(), zb.toFloat(), dbx.toFloat(), dby.toFloat(), rgb.toFloat())
  val s = TrState(L(), L(), hasA, prog = p.toFloat())
  fun set(a: Layer, b: Layer, mode: Int, mix: Double = 1.0) { s.a.rect = a.rect; s.a.rot = a.rot; s.a.zb = a.zb; s.a.dbx = a.dbx; s.a.dby = a.dby; s.a.clip = a.clip; s.b = b; s.mode = mode.toFloat(); s.mix = mix.toFloat() }
  when (id) {
    "whip" -> { val bl = 0.09 * W * sin(PI * q); set(L(dx = -q * W, dbx = bl), L(dx = (1 - q) * W, dbx = bl), 3) }
    "zoom" -> set(L(scale = 1 + 0.9 * p * p, zb = 1.2), L(scale = 1.6 - 0.6 * q, zb = 1 - q), 1, q)
    "spin" -> set(L(rot = 90 * p * p, scale = 1 + 0.5 * p, zb = 0.8), L(rot = -90 * (1 - q), scale = 1.5 - 0.5 * q, zb = 1 - q), 1, q)
    "glitch" -> { s.b = L(rgb = 22 * (1 - p)); s.mode = 5f }
    "iris" -> s.mode = 6f
    "wipe" -> s.mode = 7f
    "bars" -> s.mode = 8f
    "diamond" -> s.mode = 9f
    "heart" -> s.mode = 10f
    "star" -> s.mode = 11f
    "dip" -> { s.mode = 2f; s.prog = inOut(p).toFloat() }
    "slideleft", "slideright" -> { val sg = if (id == "slideleft") -1 else 1; set(L(dx = sg * q * W), L(dx = -sg * (1 - q) * W), 3) }
    "slideup", "slidedown" -> { val sg = if (id == "slideup") -1 else 1; set(L(dy = sg * q * H), L(dy = -sg * (1 - q) * H), 3) }
    "swipeup" -> { val k = outExpo(p); val bl = 0.08 * H * sin(PI * p); set(L(dy = -k * H, dby = bl), L(dy = (1 - k) * H, dby = bl), 3) }
    "zoomout" -> set(L(scale = 1 - 0.45 * p, zb = 0.6 * p), L(scale = 1.3 - 0.3 * q), 1, q)
    "blur" -> set(L(zb = 2.2 * p), L(zb = 2.2 * (1 - q)), 1, inOut(p))
    "flip" -> { val first = p < 0.5; val k = if (first) 1 - 2 * p else 2 * p - 1
      val x = L(); x.rect = floatArrayOf((W / 2 - W / 2 * k).toFloat(), 0f, max(1.0, W * k).toFloat(), H); x.clip = 1f
      s.b = x; s.hasA = false; s.mode = 0f; s.swap = first }   // the first half turns the old shot away, the second turns the new one in
    "luma" -> { s.mode = 12f; s.prog = inOut(p).toFloat() }
    "pixelate" -> s.mode = 13f
    "clock" -> { s.mode = 14f; s.prog = inOut(p).toFloat() }
    "doors" -> { s.mode = 15f; s.prog = outCubic(p).toFloat() }
    "ripple" -> s.mode = 16f
    "burn" -> { s.mode = 1f; s.mix = inOut(p).toFloat(); s.leak = floatArrayOf(W * 0.55f, H * 0.4f, (1.5 * sin(PI * p)).toFloat()); s.flash = (0.25 * sin(PI * p)).toFloat() }
    "dropin" -> set(L(), L(dy = -(1 - outBack(p)) * H), 3)
    "stripes", "blinds", "checker", "dots", "noise", "splith", "wave", "dipwhite", "chroma", "tiles" -> {
      s.mode = mapOf("stripes" to 17f, "blinds" to 18f, "checker" to 19f, "dots" to 20f, "noise" to 21f, "splith" to 22f, "wave" to 23f, "dipwhite" to 24f, "chroma" to 25f, "tiles" to 26f).getValue(id)
      s.prog = inOut(p).toFloat() }
    "zoomblur" -> set(L(scale = 1 + 1.2 * p * p, zb = 2.5 * p), L(scale = 1 + 0.8 * (1 - q) * (1 - q), zb = 2.5 * (1 - q)), 1, inOut(p))
    "shake" -> { val j = sin(PI * p) * 0.05 * W; val sx = sin(p * 90) * j; val sy = cos(p * 70) * j; set(L(dx = sx, dy = sy), L(dx = -sx, dy = -sy), 1, inOut(p)) }
    "squeeze" -> { val k = inOut(p); val a = L(); a.rect = floatArrayOf(0f, 0f, max(1.0, W * (1 - k)).toFloat(), H); a.clip = 1f
      val b = L(); b.rect = floatArrayOf((W * (1 - k)).toFloat(), 0f, max(1.0, W * k).toFloat(), H); b.clip = 1f; set(a, b, 3) }
    "rotatein" -> set(L(scale = 1 - 0.3 * p, zb = 0.6 * p), L(rot = -180 * (1 - q) * (1 - q), scale = 0.4 + 0.6 * q), 1, inOut(p))
    "dissolve" -> { s.mode = 1f; s.mix = inOut(p).toFloat() }
    "fadein" -> { s.mode = 1f; s.mix = q.toFloat() }
    "flash" -> { s.flash = (0.85 * (1 - p).pow(2)).toFloat(); s.b.expo = max(0.0, 1 - p * 1.6).toFloat() }
  }
  return s
}
