package expo.modules.shubixvideo

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Reading a whole clip on the phone: its samples and its scene changes, as the website's scanMotion and findScenes (brain/pure.ts).
 * Frames come from `frames` and `at`, so a computer can run this too (scripts/clip-parity.mjs). */
class ScanSample(val t: Double, var m: Double, val row: FrameRow) { var sw = row.sw; var cut = false }
class Scene(var t0: Double, var t1: Double, var kind: String, var tc: Double? = null, var white: Boolean? = null)
class ClipScanResult(val samples: List<ScanSample>, val scenes: List<Scene>)

fun colourD(a: FloatArray, b: FloatArray): Double { var c = 0.0; for (k in 0 until 64) c += abs(a[k].toDouble() - b[k]); return c / 2 }
fun histD(a: FloatArray, b: FloatArray): Double {
  var c = 0.0; var l = 0.0; var ca = 0.0; var cb = 0.0; var g = 0.0
  for (k in 0 until 64) c += abs(a[k].toDouble() - b[k])
  for (k in 64 until 80) { ca += a[k]; cb += b[k]; l += abs(ca - cb) }
  for (k in 80 until CLIP_FEAT) g += abs(a[k].toDouble() - b[k])
  return maxOf(c / 2, min(1.0, 2.5 * l / 15), min(1.0, 2.5 * g / 40))
}
private fun nearestS(S: List<ScanSample>, t: Double): Int {
  var lo = 0; var hi = S.size - 1
  while (lo < hi) { val m = (lo + hi) shr 1; if (S[m].t < t) lo = m + 1 else hi = m }
  return if (lo > 0 && abs(S[lo - 1].t - t) < abs(S[lo].t - t)) lo - 1 else lo
}

fun findScenes(S: List<ScanSample>, H: List<FloatArray>, LM: List<FloatArray>, grabHist: (Double) -> FloatArray?): List<Scene> {
  val n = S.size; val out = ArrayList<Scene>()
  if (n < 3) return out
  val c = FloatArray(n); for (i in 1 until n) c[i] = histD(H[i - 1], H[i]).toFloat()
  val isCut = BooleanArray(n)
  for (i in 1 until n) {
    var s = 0.0; var k = 0
    for (j in max(1, i - 5)..min(n - 1, i + 5)) if (abs(j - i) > 1) { s += c[j]; k++ }
    val local = if (k > 0) s / k else 0.0
    if (c[i] < 0.28 || c[i] < 2.6 * local + 0.08) continue
    if (c[i] < c[i - 1] || (i + 1 < n && c[i] < c[i + 1])) continue
    var back = false
    var j = i + 1
    while (j < n && S[j].t <= S[i].t + 0.5) { if (histD(H[i - 1], H[j]) < 0.45 * c[i]) { back = true; break }; j++ }
    if (back) continue
    val pre = nearestS(S, S[i - 1].t - 0.45); val post = nearestS(S, S[i].t + 0.35)
    if (histD(H[pre], H[post]) < 0.5 * c[i]) continue
    isCut[i] = true
  }
  for (i in 1 until n) if (isCut[i]) {
    var lo = S[i - 1].t; var hi = S[i].t; val hA = H[i - 1]; val hB = H[i]
    var it = 0
    while (it < 8 && hi - lo > 1.0 / 60) {
      val mid = (lo + hi) / 2; val h = grabHist(mid) ?: break
      if (histD(h, hA) <= histD(h, hB)) lo = mid else hi = mid
      it++
    }
    out += Scene(lo, hi, "cut")
  }
  val gap = if (n > 1) (S[n - 1].t - S[0].t) / (n - 1) else 0.2
  run {
    var i = 1
    while (i < n - 1) {
      val dark = S[i].row.b < 0.05; val flat = dark || S[i].row.b > 0.96
      if (!flat) { i++; continue }
      fun same(j: Int) = if (dark) S[j].row.b < 0.05 else S[j].row.b > 0.96
      var a = i; while (a > 0 && same(a - 1)) a--
      var b = i; while (b < n - 1 && same(b + 1)) b++
      if (a > 0 && b < n - 1) {
        fun sl(j: Int, k: Int) = if (dark) S[j].row.b > S[k].row.b + 0.004 else S[j].row.b < S[k].row.b - 0.004
        var a2 = a - 1; while (a2 > 0 && sl(a2 - 1, a2) && S[a].t - S[a2 - 1].t < 2) a2--
        var b2 = b + 1; while (b2 < n - 1 && sl(b2 + 1, b2) && S[b2 + 1].t - S[b].t < 2) b2++
        val pre = nearestS(S, S[a2].t - 0.2); val post = nearestS(S, S[b2].t + 0.2)
        val changes = (if (dark) histD(H[pre], H[post]) else colourD(H[pre], H[post])) > 0.3; val long = dark && S[b].t - S[a].t >= 0.1
        if (changes || long) out += Scene(S[a2].t - gap, S[b2].t + gap, "fade", (S[a].t + S[b].t) / 2, !dark)
      }
      i = b + 1
    }
  }
  val cs = c.drop(1).map { it.toDouble() }.sorted(); val base = cs.getOrElse(cs.size shr 1) { 0.0 }; val thr = max(0.03, 2.5 * base); val calmTh = max(0.06, 1.5 * base)
  fun settledBefore(a: Int): Boolean { val v = listOf(a, a - 1).filter { it in 0 until n }.map { c[it].toDouble() }; return v.isEmpty() || v.sum() / v.size < calmTh }
  fun settledAfter(b: Int): Boolean { val v = listOf(b + 1, b + 2).filter { it in 0 until n }.map { c[it].toDouble() }; return v.isEmpty() || v.sum() / v.size < calmTh }
  run {
    var i = 1
    while (i < n) {
      if (c[i] <= thr) { i++; continue }
      var j = i; while (j + 1 < n && c[j + 1] > thr) j++
      val a = i - 1; val b = j; val dur = S[b].t - S[a].t
      if (dur >= 0.25 && dur <= 2.2 && histD(H[a], H[b]) >= 0.35) {
        val m = (a + b) shr 1; val A = LM[a]; val B = LM[b]; val M = LM[m]
        var dA = 0.0; var dB = 0.0
        for (k in M.indices) { dA += abs(M[k].toDouble() - A[k]); dB += abs(M[k].toDouble() - B[k]) }
        var be = Double.POSITIVE_INFINITY; var al = 0.05
        while (al < 0.96) { var e = 0.0; for (k in M.indices) e += abs(M[k] - (al * A[k] + (1 - al) * B[k])); be = min(be, e); al += 0.05 }
        if (be < 0.5 * min(dA, dB)) out += Scene(S[a].t - gap, S[b].t + gap, "dissolve")
        else if (dur <= 0.5 && settledBefore(a) && settledAfter(b)) out += Scene(S[a].t, S[b].t, "cut")
      } else if (dur > 0.05 && dur < 0.25 && histD(H[a], H[b]) >= 0.35 && settledBefore(a) && settledAfter(b) && out.none { it.t1 >= S[a].t - 0.05 && it.t0 <= S[b].t + 0.05 }) {
        out += Scene(S[a].t, S[b].t, "cut")
      }
      i = j + 1
    }
  }
  val merged = ArrayList<Scene>()
  for (o in out.sortedBy { it.t0 }) {
    val l = merged.lastOrNull()
    if (l != null && o.t0 <= l.t1 + 0.05) { l.t1 = max(l.t1, o.t1); if (l.kind == "cut") { l.kind = o.kind; if (o.tc != null) { l.tc = o.tc; l.white = o.white } } }
    else merged += Scene(o.t0, o.t1, o.kind, o.tc, o.white)
  }
  return merged
}

/** the times to read: a frame every 1/30 s for short clips, sparser for long ones (at most every 0.2 s), rounded as the website rounds them */
fun scanTimes(dur: Double): DoubleArray {
  val step = max(1.0 / 30, min(12.0, max(2.0, dur / 6)) / 60); val out = ArrayList<Double>()
  var t = 0.0
  while (t < dur - 0.02) { out += Math.round(t * 10000) / 10000.0; t += step }
  return out.toDoubleArray()
}

/** `frames`: for each time, RGBA of 48 x 27 and of 128 x 72, or null when there is none */
fun scanClip(times: DoubleArray, frames: (emit: (Int, ByteArray?, ByteArray?) -> Unit) -> Unit, grabHist: (Double) -> FloatArray?, onProgress: (Double) -> Unit = {}): ClipScanResult {
  val rows = ArrayList<ScanSample>(); val hists = ArrayList<FloatArray>(); val lums = ArrayList<FloatArray>(); var prev: FloatArray? = null
  frames { k, small, big ->
    if (small != null && big != null) { val f = frameStats(small, big, prev); prev = f.lum; rows += ScanSample(times[k], f.row.m, f.row); hists += f.hist; lums += f.lum }
    if (k % 8 == 7) onProgress(k.toDouble() / times.size)
  }
  if (rows.isEmpty()) throw IllegalStateException("no frames could be read")
  if (rows.size > 1) rows[0].m = rows[1].m
  val scenes = findScenes(rows, hists, lums, grabHist)
  for (sc in scenes) rows.forEachIndexed { i, s ->
    if (s.t >= sc.t0 - 0.01 && s.t <= sc.t1 + 0.3) { val a = rows.getOrNull(i - 2) ?: rows.getOrNull(i + 2) ?: s; s.m = min(s.m, a.m); s.sw = 0.0; s.cut = true }
  }
  val smooth = rows.indices.map { i -> (rows[max(0, i - 1)].m + rows[i].m + rows[min(rows.size - 1, i + 1)].m) / 3 }
  rows.forEachIndexed { i, s -> s.m = smooth[i] }
  return ClipScanResult(rows, scenes)
}

fun ClipScanResult.toJson(): JSONObject = JSONObject()
  .put("samples", JSONArray(samples.map { s ->
    val w = s.row
    JSONObject().put("t", s.t).put("m", s.m).put("b", w.b).put("cx", w.cx).put("sh", w.sh).put("sx", w.sx).put("sy", w.sy).put("sw", s.sw).put("gx", w.gx).put("gy", w.gy).put("ax", w.ax).put("ay", w.ay).put("aw", w.aw).also { if (s.cut) it.put("cut", true) }
  }))
  .put("scenes", JSONArray(scenes.map { c -> JSONObject().put("t0", c.t0).put("t1", c.t1).put("kind", c.kind).also { o -> c.tc?.let { o.put("tc", it) }; c.white?.let { o.put("white", it) } } }))

/** RGBA of 128 x 72 made small for the numbers above: each small pixel the average of the pixels it covers */
fun shrinkRgba(big: ByteArray, bw: Int, bh: Int, w: Int, h: Int): ByteArray {
  val out = ByteArray(w * h * 4)
  for (y in 0 until h) for (x in 0 until w) {
    val x0 = x * bw / w; val x1 = max(x0 + 1, (x + 1) * bw / w); val y0 = y * bh / h; val y1 = max(y0 + 1, (y + 1) * bh / h)
    var r = 0; var g = 0; var b = 0; var n = 0
    for (q in y0 until y1) for (p in x0 until x1) { val i = (q * bw + p) * 4; r += big[i].toInt() and 255; g += big[i + 1].toInt() and 255; b += big[i + 2].toInt() and 255; n++ }
    val o = (y * w + x) * 4; out[o] = (r / n).toByte(); out[o + 1] = (g / n).toByte(); out[o + 2] = (b / n).toByte(); out[o + 3] = -1
  }
  return out
}
