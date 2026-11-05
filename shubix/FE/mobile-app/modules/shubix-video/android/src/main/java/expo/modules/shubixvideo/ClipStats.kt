package expo.modules.shubixvideo

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** One frame of a clip as plain numbers, on the phone: the same as the website's frameStats (brain/edit.ts): light, motion, sharpness,
 * what stands out, what moves by itself, and a histogram to spot a change of scene. scripts/clip-parity.mjs compares the two.
 * Nothing here needs Android. `small`: RGBA of SW x SH; `big`: RGBA of 128 x 72; `prev`: the light of the frame before. */
const val CLIP_SW = 48
const val CLIP_SH = 27
const val CLIP_FEAT = 64 + 16 + 40

class FrameRow(val m: Double, val b: Double, val cx: Double, val sh: Double, val sx: Double, val sy: Double, val sw: Double, val gx: Double, val gy: Double, val ax: Double, val ay: Double, val aw: Double)
class FrameStats(val lum: FloatArray, val hist: FloatArray, val row: FrameRow)

private fun u(d: ByteArray, i: Int) = d[i].toInt() and 255

fun colorHist(d: ByteArray): FloatArray {
  val h = FloatArray(CLIP_FEAT); val gs = FloatArray(40); var n = 0
  var i = 0
  while (i < d.size) {
    val r = u(d, i); val g = u(d, i + 1); val b = u(d, i + 2)
    h[((r shr 6) shl 4) or ((g shr 6) shl 2) or (b shr 6)]++
    val y = 0.299 * r + 0.587 * g + 0.114 * b
    h[64 + min(15, y.toInt() shr 4)]++
    val p = i shr 2; val x = p % CLIP_SW; val yy = p / CLIP_SW
    val gi = min(4, yy * 5 / CLIP_SH) * 8 + min(7, x * 8 / CLIP_SW)
    h[80 + gi] = (h[80 + gi] + y / 255).toFloat(); gs[gi]++
    n++; i += 4
  }
  for (k in 0 until 80) h[k] = (h[k].toDouble() / n).toFloat()
  for (k in 0 until 40) h[80 + k] = (h[80 + k].toDouble() / max(1f, gs[k])).toFloat()
  return h
}

private class Point(val x: Double, val y: Double, val w: Double, val gx: Double = 0.0, val gy: Double = 0.0)

private fun saliency(d: ByteArray): Point {
  val n = CLIP_SW * CLIP_SH; val L = FloatArray(n); val A = FloatArray(n); val B = FloatArray(n); var mL = 0.0; var mA = 0.0; var mB = 0.0
  for (i in 0 until n) {
    val r = u(d, i * 4) / 255.0; val g = u(d, i * 4 + 1) / 255.0; val b = u(d, i * 4 + 2) / 255.0
    L[i] = (0.3 * r + 0.59 * g + 0.11 * b).toFloat(); A[i] = (r - g).toFloat(); B[i] = (0.5 * (r + g) - b).toFloat()
    mL += L[i]; mA += A[i]; mB += B[i]
  }
  mL /= n; mA /= n; mB /= n
  val s = FloatArray(n); var sm = 0.0; var sq = 0.0
  for (i in 0 until n) {
    val p = 0.6 * (L[i] - mL); val q = 1.6 * (A[i] - mA); val t = 1.6 * (B[i] - mB); val v = sqrt(p * p + q * q + t * t)
    s[i] = v.toFloat(); sm += v; sq += v * v
  }
  val mean = sm / n; val sd = sqrt(max(0.0, sq / n - mean * mean)); val th = mean + 1.5 * sd
  var w = 0.0; var x = 0.0; var y = 0.0; var xx = 0.0; var yy = 0.0
  for (i in 0 until n) {
    val r = s[i] - th
    if (r > 0) { val px = (i % CLIP_SW + 0.5) / CLIP_SW; val py = (i / CLIP_SW + 0.5) / CLIP_SH; w += r; x += r * px; y += r * py; xx += r * px * px; yy += r * py * py }
  }
  if (w < 1e-4 || sd < 0.03) return Point(0.5, 0.5, 0.0)
  x /= w; y /= w
  val spread = sqrt(max(0.0, xx / w - x * x + yy / w - y * y))
  return Point(x, y, min(1.0, sd / 0.12) * max(0.0, 1 - spread / 0.25))
}

private fun subjectMotion(prev: FloatArray, cur: FloatArray): Point {
  val R = 3; var best = Double.POSITIVE_INFINITY; var bdx = 0; var bdy = 0
  for (dy in -R..R) for (dx in -R..R) {
    var s = 0.0
    for (y in R until CLIP_SH - R) { val o = y * CLIP_SW; val op = (y - dy) * CLIP_SW - dx; for (x in R until CLIP_SW - R) s += abs(cur[o + x].toDouble() - prev[op + x]) }
    s += 0.002 * (dx * dx + dy * dy) * CLIP_SW * CLIP_SH
    if (s < best) { best = s; bdx = dx; bdy = dy }
  }
  var w = 0.0; var x = 0.0; var y = 0.0; var xx = 0.0; var yy = 0.0; var n = 0
  for (y0 in R until CLIP_SH - R) for (x0 in R until CLIP_SW - R) {
    val r = abs(cur[y0 * CLIP_SW + x0].toDouble() - prev[(y0 - bdy) * CLIP_SW + x0 - bdx]) - 0.05; n++
    if (r > 0) { val px = (x0 + 0.5) / CLIP_SW; val py = (y0 + 0.5) / CLIP_SH; w += r; x += r * px; y += r * py; xx += r * px * px; yy += r * py * py }
  }
  if (w < 1e-3) return Point(0.5, 0.5, 0.0, bdx.toDouble(), bdy.toDouble())
  x /= w; y /= w
  val spread = sqrt(max(0.0, xx / w - x * x + yy / w - y * y)); val conc = max(0.0, 1 - spread / 0.32)
  return Point(x, y, min(1.0, w / n * 25) * conc, bdx.toDouble(), bdy.toDouble())
}

fun frameStats(small: ByteArray, big: ByteArray, prev: FloatArray?): FrameStats {
  val n = CLIP_SW * CLIP_SH; val lum = FloatArray(n); var b = 0.0
  for (i in 0 until n) { val y = (u(small, i * 4) * 0.3 + u(small, i * 4 + 1) * 0.59 + u(small, i * 4 + 2) * 0.11) / 255; lum[i] = y.toFloat(); b += y }
  val hist = colorHist(small); val sal = saliency(small)
  var m = 0.0; var mx = 0.0
  if (prev != null) for (i in 0 until n) { val df = abs(lum[i].toDouble() - prev[i]); m += df; mx += df * (i % CLIP_SW + 0.5) / CLIP_SW }
  val sub = prev?.let { subjectMotion(it, lum) }
  val L2 = FloatArray(128 * 72)
  for (i in L2.indices) L2[i] = (u(big, i * 4) * 0.3 + u(big, i * 4 + 1) * 0.59 + u(big, i * 4 + 2) * 0.11).toFloat()
  var sm = 0.0; var sq = 0.0; var c = 0
  for (y in 1 until 71) for (x in 1 until 127) { val i = y * 128 + x; val lap = 4.0 * L2[i] - L2[i - 1] - L2[i + 1] - L2[i - 128] - L2[i + 128]; sm += lap; sq += lap * lap; c++ }
  val sh = sq / c - (sm / c) * (sm / c)
  return FrameStats(lum, hist, FrameRow(if (prev != null) m / n else 0.0, b / n, if (m > 1e-6) mx / m else 0.5, sh, sub?.x ?: -1.0, sub?.y ?: -1.0, sub?.w ?: 0.0, sub?.gx ?: 0.0, sub?.gy ?: 0.0, sal.x, sal.y, sal.w))
}
