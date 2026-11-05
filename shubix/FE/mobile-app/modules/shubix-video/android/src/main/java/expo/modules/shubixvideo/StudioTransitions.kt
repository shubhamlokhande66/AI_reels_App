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
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
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
      drawMain(prog, if (s.swap) held.tex else inputTexId, if (held.has) held.tex else inputTexId, inputTexId, w, h, s.a, s.b, s.hasA, s.mode, s.prog, s.mix, local.toFloat(), s.flash, s.leak)
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

/** the studio's main shader, one draw (its uniforms as the website's renderer sets them; the look is the shot's own, done before this pass) */
private fun drawMain(prog: GlProgram, texB: Int, texA: Int, texL: Int, w: Float, h: Float, a: Layer, b: Layer, hasA: Boolean, mode: Float, progress: Float, mix: Float, time: Float, flash: Float, leak: FloatArray,
                     shp: FloatArray = FloatArray(4), shq: FloatArray = FloatArray(4), mono: Float = 0f, con: Float = 1f) {
  prog.use()
  // Media3 binds every sampler itself: each must be named here, before bindAttributesAndUniforms
  prog.setSamplerTexIdUniform("tB", texB, 0)
  prog.setSamplerTexIdUniform("tA", texA, 1)
  prog.setSamplerTexIdUniform("tL", texL, 2)
  prog.setBufferAttribute("a", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
  prog.bindAttributesAndUniforms()
  val u = { n: String -> prog.getUniformLocation(n) }
  val f1 = { n: String, v: Float -> GLES20.glUniform1f(u(n), v) }
  val f2 = { n: String, x: Float, y: Float -> GLES20.glUniform2f(u(n), x, y) }
  val f3 = { n: String, x: Float, y: Float, z: Float -> GLES20.glUniform3f(u(n), x, y, z) }
  val f4 = { n: String, v: FloatArray -> GLES20.glUniform4f(u(n), v[0], v[1], v[2], v[3]) }
  f2("res", w, h)
  for ((k, L) in listOf("A" to a, "B" to b)) {
    f4("r$k", L.rect); f1("rot$k", L.rot); f1("zb$k", L.zb); f2("db$k", L.dbx, L.dby); f1("rgb$k", L.rgb); f1("ex$k", L.expo); f1("br$k", 1f)
    f2("off$k", 0f, 0f); f1("cl$k", L.clip); f4("tf$k", floatArrayOf(1f, 0f, 0f, 1f)); f4("bg$k", floatArrayOf(0f, 0f, 0f, -1f)); f4("bgr$k", floatArrayOf(0f, 0f, 1f, 1f))
    f4("bd$k", FloatArray(4)); f4("ad$k", FloatArray(4)); f4("ad2$k", FloatArray(4)); f1("be$k", 0f); f1("al$k", 1f)
  }
  f1("hasA", if (hasA) 1f else 0f); f1("mode", mode); f1("prog", progress); f1("mixv", mix); f2("irisC", w / 2, h / 2)
  f1("time", time); f1("snap", 0f); f4("bgR", floatArrayOf(0f, 0f, 1f, 1f)); f1("bgDark", 0f); f4("frR", floatArrayOf(0f, 0f, w, h)); f1("border", 0f)
  f1("con", con); f1("sat", 1f); f1("bri", 1f); f1("teal", 0f); f1("mono", mono); f1("vig", 0f); f1("grain", 0f); f1("warm", 0f); f1("lift", 0f)
  f4("tsh", floatArrayOf(0.5f, 0.5f, 0.5f, 0f)); f4("thi", floatArrayOf(0.5f, 0.5f, 0.5f, 0f))
  f1("flash", flash); f3("leak", leak[0], leak[1], leak[2]); f1("loopMix", 0f)
  f4("mz", FloatArray(4)); f1("mzc", 1f); f4("mg", floatArrayOf(0f, 0f, 0f, 1f)); f4("shp", shp); f4("shq", shq)
  GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
  GlUtil.checkGlError()
}

/** A shot's beat effect, as the website's shapeAt / beatFxOf (brain/core.ts, brain/pure.ts) with the same shader: a shape that steps on the
 * shot's beats, or an RGB split, blur or strobe on them. A shape's centre is the frame's: the website's follows the subject. */
private val SHAPE_K = mapOf("boxgrow" to 1, "grid" to 2, "strips" to 3, "circle" to 4, "heartbeat" to 5, "starbeat" to 6, "frame" to 7, "mirror" to 8, "kaleido" to 9, "triple" to 10, "vhs" to 11)
internal val BEAT_EFFECTS = SHAPE_K.keys + setOf("strobe", "rgbpulse", "blurpulse")

@UnstableApi
internal class BeatFx(private val vert: String, private val main: String, private val id: String, beatsIn: List<Double>, private val length: Double) : GlEffect {
  private val beats = beatsIn.filter { it > 0.08 && it < length - 0.05 }.ifEmpty { generateSequence(0.6) { it + 0.6 }.takeWhile { it < length - 0.1 }.toList() }
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = object : BaseGlShaderProgram(useHdr, 1) {
    private val prog = GlProgram(vert, main)
    private var w = 1f; private var h = 1f
    override fun configure(inputWidth: Int, inputHeight: Int): Size { w = inputWidth.toFloat(); h = inputHeight.toFloat(); return Size(inputWidth, inputHeight) }
    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
      val t = presentationTimeUs / 1_000_000.0
      val past = beats.filter { t >= it }; val n = past.size; val since = if (n > 0) t - past.last() else t
      val bump = if (n > 0) exp(-since / 0.12) else 0.0
      fun step(levels: List<Double>): Double { val x = levels[min(n, levels.size - 1)]; val from = if (n > 0) levels[min(n - 1, levels.size - 1)] else x * 0.7; return from + (x - from) * outBack(min(1.0, since / 0.16)) }
      val k = SHAPE_K[id] ?: 0; var cells = 0
      val level = when (k) {
        1 -> step(listOf(0.4, 0.62, 0.84, 1.0))
        2 -> { cells = if (length > 2.4 && beats.size >= 6) 3 else 2; min((cells * cells).toDouble(), 1.0 + n) }
        3 -> { cells = 3; min(3.0, 1.0 + n) }
        4 -> 0.5 * (1 + 0.14 * bump)
        5 -> 0.36 * (1 + 0.16 * bump)
        6 -> 0.42 * (1 + 0.16 * bump)
        7 -> 0.8 * (1 + 0.035 * bump)
        10 -> min(3.0, 1.0 + n)
        else -> 1.0
      }
      var pulse = 0.0
      for (b in beats) { val d = t - b; if (d >= 0 && d < 0.4) pulse = max(pulse, exp(-d / 0.09)) }
      val picture = Layer(floatArrayOf(0f, 0f, w, h))
      when (id) { "rgbpulse" -> picture.rgb = (18 * pulse).toFloat(); "blurpulse" -> picture.zb = (1.4 * pulse).toFloat(); "vhs" -> picture.rgb = (5 + 3 * abs(sin(t * 7))).toFloat() }
      val strobe = id == "strobe" && n > 0 && since < 0.1
      drawMain(prog, inputTexId, inputTexId, inputTexId, w, h, Layer(floatArrayOf(0f, 0f, w, h)), picture, false, 0f, 1f, 1f, t.toFloat(),
        if (strobe) (0.3 * (1 - since / 0.1)).toFloat() else 0f, FloatArray(3),
        floatArrayOf(k.toFloat(), level.toFloat(), w / 2, h / 2), floatArrayOf(cells.toFloat(), 0f, 0f, 0f), if (strobe) 1f else 0f, if (strobe) 1.25f else 1f)
    }
    override fun release() { super.release(); prog.delete() }
  }
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
