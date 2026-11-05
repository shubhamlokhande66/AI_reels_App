package expo.modules.shubixvideo

import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Arrays
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.ln1p
import kotlin.math.log10
import kotlin.math.log2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** The song as the editor hears it, on the phone: the same steps and numbers as the website's songAnalysis (Shared/core
 * engine/studio/song.ts). scripts/song-parity.mjs compares the two. Nothing here needs Android, so a computer can run it. */
class SongOptions(val beats: List<Double>? = null, val forceBeats: List<Double>? = null, val forceSource: String? = null, val altFast: Double = 0.55)

class JudgeResult(val accent: Double, val steady: Double, val score: Double)
class BeatJudge(val own: JudgeResult, val ai: JudgeResult, var alt: Double? = null)

class SongResult(
  val period: Double, val phase: Double, val hopSec: Double, val rmsF: FloatArray, val onEnv: DoubleArray, val onFps: Double, val onOff: Double,
  val hitsRaw: List<Double>, val hitsStr: List<Double>, val pfArr: FloatArray, val beats: List<Double>, val cuts: List<Double>, val cutType: List<String>,
  val cutFx: List<String>, val peaks: List<Double>, val peakS: List<Double>, val barOff: Double, val beatSource: String, val beatJudge: BeatJudge?,
)

/** the answer as the website's songAnalysis returns it */
fun SongResult.toJson(): JSONObject {
  fun judge(j: JudgeResult) = JSONObject().put("accent", j.accent).put("steady", j.steady).put("score", j.score)
  val out = JSONObject().put("period", period).put("phase", phase).put("hopSec", hopSec).put("onFps", onFps).put("onOff", onOff).put("barOff", barOff).put("beatSource", beatSource)
    .put("beats", JSONArray(beats)).put("cuts", JSONArray(cuts)).put("cutType", JSONArray(cutType)).put("cutFx", JSONArray(cutFx)).put("peaks", JSONArray(peaks)).put("peakS", JSONArray(peakS))
    .put("hitsRaw", JSONArray(hitsRaw)).put("hitsStr", JSONArray(hitsStr)).put("rmsF", JSONArray(rmsF.map { it.toDouble() })).put("pfArr", JSONArray(pfArr.map { it.toDouble() })).put("onEnv", JSONArray(onEnv.toList()))
  out.put("beatJudge", beatJudge?.let { j -> JSONObject().put("own", judge(j.own)).put("ai", judge(j.ai)).also { o -> j.alt?.let { a -> o.put("alt", a) } } } ?: JSONObject.NULL)
  return out
}

/** A request's body: 4 bytes (little endian) with the length of the JSON options { sr, beats, forceBeats, forceSource, altFast }, then the song as floats. */
fun songFromRequest(body: ByteArray): JSONObject {
  val all = ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN); val headLength = all.int
  val o = JSONObject(String(body, 4, headLength))
  fun list(k: String) = o.optJSONArray(k)?.let { x -> (0 until x.length()).map { x.getDouble(it) } }
  val mono = FloatArray((body.size - 4 - headLength) / 4)
  ByteBuffer.wrap(body, 4 + headLength, mono.size * 4).slice().order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(mono)
  return songAnalysis(mono, o.getInt("sr"), SongOptions(list("beats"), list("forceBeats"), o.optString("forceSource").ifEmpty { null }, o.optDouble("altFast", 0.55))).toJson()
}

private const val DRUM_MIN = 0.7
private fun rnd(x: Double): Int = Math.round(x).toInt()
private fun Double.orOne() = if (this == 0.0 || isNaN()) 1.0 else this

private class Fft(private val n: Int) {
  private val rev = IntArray(n); private val cs = DoubleArray(n / 2); private val sn = DoubleArray(n / 2)
  init {
    val lev = Integer.numberOfTrailingZeros(n)
    for (i in 0 until n) { var r = 0; var x = i; repeat(lev) { r = (r shl 1) or (x and 1); x = x shr 1 }; rev[i] = r }
    for (i in 0 until n / 2) { cs[i] = cos(2 * Math.PI * i / n); sn[i] = -sin(2 * Math.PI * i / n) }
  }
  fun run(re: DoubleArray, im: DoubleArray) {
    for (i in 0 until n) { val j = rev[i]; if (j > i) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t } }
    var size = 2
    while (size <= n) {
      val half = size shr 1; val step = n / size
      var i = 0
      while (i < n) {
        var k = 0
        for (j in 0 until half) {
          val a = i + j; val b = a + half
          val tr = re[b] * cs[k] - im[b] * sn[k]; val ti = re[b] * sn[k] + im[b] * cs[k]
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
          k += step
        }
        i += size
      }
      size = size shl 1
    }
  }
}

private class Est(var q: Double, val i0: Int, val i1: Int, val strength: Double)
private class Tracked(val beats: List<Int>, val period: Double)
private class Level(val on: Double, val alt: Double, val mid: Double)

private fun at(a: DoubleArray, i: Int) = if (i in a.indices) a[i] else 0.0
private fun nearestLevel(q: Double, p: Double): Double {
  var b = q
  for (x in doubleArrayOf(q / 2, q, 2 * q)) if (abs(ln(x / p)) < abs(ln(b / p))) b = x
  return b
}

private fun trackBeats(env: DoubleArray, bodyEnv: DoubleArray, fps: Double, kickEnv: DoubleArray): Tracked {
  val n = env.size
  if (n < fps * 2) return Tracked(emptyList(), fps * 0.5)
  fun mean(a: DoubleArray): Double { var s = 0.0; for (v in a) s += v; return s / max(1, a.size) }
  fun sd(a: DoubleArray, m: Double): Double { var s = 0.0; for (v in a) s += (v - m) * (v - m); return sqrt(s / max(1, a.size)).orOne() }
  val em = mean(env); val es = sd(env, em)
  val E = DoubleArray(n) { env[it] / es }; val Z = DoubleArray(n) { (env[it] - em) / es }
  fun acAt(a: DoubleArray, L: Int, i0: Int, i1: Int): Double { var s = 0.0; var c = 0; var i = i0; while (i + L < i1) { s += a[i] * a[i + L]; c++; i++ }; return if (c > 0) s / c else 0.0 }
  val lmin = max(2, floor(60 * fps / 240).toInt()); val lmax = min(n - 2, ceil(60 * fps / 40).toInt())
  fun bpmOf(q: Double) = 60 * fps / q
  fun levelStats(a: DoubleArray, q: Double, i0: Int, i1: Int): Level {
    var best = -1.0; var res: Level? = null
    var ph = 0.0
    while (ph < q) {
      var ev = 0.0; var od = 0.0; var mid = 0.0; var ce = 0; var co = 0; var k = 0
      var x = i0 + ph
      while (x < i1) {
        val v = at(a, rnd(x)); val m = at(a, rnd(x + q / 2))
        if (k % 2 != 0) { od += v; co++ } else { ev += v; ce++ }
        mid += m; x += q; k++
      }
      ev /= max(1, ce); od /= max(1, co); mid /= max(1, ce + co)
      val on = (ev + od) / 2
      if (on > best) { best = on; res = Level(on, min(ev, od) / maxOf(ev, od, 1e-9), mid / max(on, 1e-9)) }
      ph += 0.5
    }
    return res ?: Level(0.0, 1.0, 0.0)
  }
  fun tempoIn(i0: Int, i1: Int): Est {
    val ac = DoubleArray(lmax + 2)
    for (L in lmin - 1..lmax + 1) if (L in ac.indices) ac[L] = acAt(Z, L, i0, i1)
    var L0 = lmin; var bv = Double.NEGATIVE_INFINITY
    for (L in lmin..lmax) { val w = ac[L] * exp(-0.5 * (log2(bpmOf(L.toDouble()) / 115) / 1.0).pow(2)); if (w > bv) { bv = w; L0 = L } }
    val y0 = at(ac, L0 - 1); val y1 = at(ac, L0); val y2 = at(ac, L0 + 1); val d = y0 - 2 * y1 + y2
    val q = L0 + (if (d != 0.0) max(-0.5, min(0.5, 0.5 * (y0 - y2) / d)) else 0.0)
    return Est(q, i0, i1, max(0.0, bv))
  }
  val wl = rnd(8 * fps); val est = ArrayList<Est>()
  if (n <= wl * 1.25) est += tempoIn(0, n)
  else { var c = 0; val hop = rnd(2 * fps); while (c + wl <= n) { est += tempoIn(c, c + wl); c += hop } }
  val qs = est.filter { it.strength > 0 }.map { it.q }.sorted()
  var P = if (qs.isNotEmpty()) qs[qs.size / 2] else tempoIn(0, n).q
  for (e in est) e.q = nearestLevel(e.q, P)
  run {
    var alt = 0.0; var mid = 0.0; var c = 0
    for (e in est) { val s = levelStats(bodyEnv, e.q, e.i0, e.i1); alt += s.alt; mid += s.mid; c++ }
    alt /= max(1, c); mid /= max(1, c)
    var f = 1.0
    if (bpmOf(2 * P) >= 55 && alt < 0.38) f = 2.0
    else if (bpmOf(P / 2) <= 200 && mid > 0.42) f = 0.5
    if (f != 1.0) { P *= f; for (e in est) e.q *= f }
  }
  val step = rnd(2 * fps); val cen = ArrayList<Double>(); val value = ArrayList<Double>()
  if (n <= wl * 1.25) { cen += n / 2.0; value += P }
  else est.forEachIndexed { k, e -> cen += (k * step + wl / 2.0); value += nearestLevel(e.q, P) }
  val sm = DoubleArray(value.size) { k -> val v = value[k]; val w = doubleArrayOf(value.getOrElse(k - 1) { v }, v, value.getOrElse(k + 1) { v }); w.sort(); w[1] }
  val per = DoubleArray(n)
  run {
    var k = 0
    for (i in 0 until n) {
      while (k + 1 < cen.size && cen[k + 1] <= i) k++
      per[i] = if (i <= cen[0]) sm[0] else if (k + 1 >= cen.size) sm[sm.size - 1]
      else { val w2 = (i - cen[k]) / (cen[k + 1] - cen[k]); sm[k] * (1 - w2) + sm[k + 1] * w2 }
    }
  }
  val bm = mean(bodyEnv); val bs = sd(bodyEnv, bm); val km = mean(kickEnv); val ks = sd(kickEnv, km)
  val S = DoubleArray(n) { 0.25 * E[it] + 0.5 * bodyEnv[it] / bs + 1.2 * kickEnv[it] / ks }
  val score = DoubleArray(n); val back = IntArray(n) { -1 }; val tight = 1600.0
  for (i in 0 until n) {
    val p = per[i]; val a0 = max(0, i - rnd(2 * p)); val a1 = i - max(1, rnd(p / 2))
    var b = Double.NEGATIVE_INFINITY; var bi = -1
    var j = a0
    while (j <= a1) { val r = ln((i - j) / p); val v = score[j] - tight * r * r; if (v > b) { b = v; bi = j }; j++ }
    score[i] = S[i] + (if (bi >= 0) max(b, 0.0) else 0.0); back[i] = if (bi >= 0 && b > 0) bi else -1
  }
  var end = n - 1
  run { val p = per[n - 1]; var b = Double.NEGATIVE_INFINITY; for (i in max(0, n - 1 - rnd(p * 1.5)) until n) if (score[i] > b) { b = score[i]; end = i } }
  val out = ArrayList<Int>()
  run { var i = end; while (i >= 0) { out += i; if (back[i] < 0) break; i = back[i] } }
  out.reverse()
  while (out.isNotEmpty() && out[0] - per[out[0]] > per[out[0]] * 0.3) {
    val f = out[0] - per[out[0]]; var bf = rnd(f); var best = -1.0
    for (j in max(0, rnd(f - 3))..min(n - 1, rnd(f + 3))) if (S[j] > best) { best = S[j]; bf = j }
    if (bf >= out[0]) break
    out.add(0, bf)
  }
  val ints = ArrayList<Int>(); for (i in 1 until out.size) ints += out[i] - out[i - 1]; ints.sort()
  return Tracked(out, if (ints.isNotEmpty()) ints[ints.size / 2].toDouble() else P)
}

private fun trimNoPulse(bt: List<Double>, strength: (Double) -> Double): List<Double> {
  if (bt.size < 12) return bt
  val v = bt.map(strength); val s2 = v.sorted(); val med = s2[s2.size shr 1]
  if (med <= 0) return bt
  fun weak(i: Int): Boolean { var w = 0; for (j in i until min(bt.size, i + 3)) if (v[j] < 0.3 * med) w++; return w >= 2 }
  var a = 0; while (a < bt.size - 8 && weak(a)) a++
  var b = bt.size; while (b > a + 8 && weak(max(0, b - 3))) b--
  if (a < 4) a = 0
  if (bt.size - b < 4) b = bt.size
  return bt.subList(a, b).toList()
}

private fun refineBeats(bt: List<Double>, periodSec: Double, mono: FloatArray, sr: Double): List<Double> {
  if (bt.isEmpty()) return bt
  val fN = 512; val fH = 128; val len = mono.size; val nF = max(1, floor((len - fN).toDouble() / fH).toInt() + 1); val half = fN / 2
  val fft = Fft(fN); val re = DoubleArray(fN); val im = DoubleArray(fN); val win = DoubleArray(fN) { 0.5 - 0.5 * cos(2 * Math.PI * it / (fN - 1)) }; val prev = DoubleArray(half)
  val kLow = max(2, rnd(200.0 * fN / sr)); val kTop = min(half, rnd(12000.0 * fN / sr))
  val fe = FloatArray(nF)
  for (f in 0 until nF) {
    val o = f * fH
    for (i in 0 until fN) { val j = o + i; re[i] = (if (j < len) mono[j].toDouble() else 0.0) * win[i]; im[i] = 0.0 }
    fft.run(re, im); var s = 0.0
    for (k in 1 until kTop) { val m = ln1p(100 * sqrt(re[k] * re[k] + im[k] * im[k])); val d = m - prev[k]; if (d > 0 && f > 0) s += if (k < kLow) 0.5 * d else d; prev[k] = m }
    fe[f] = s.toFloat()
  }
  val fps2 = sr / fH; val off = (fN / 2) / sr
  fun tOf(i: Double) = i / fps2 + off
  fun idx(t: Double) = (t - off) * fps2
  val g = FloatArray(nF)
  for (i in 0 until nF) { var s2 = 0.0; var ws = 0.0; for (j in -3..3) { val q = i + j; if (q in 0 until nF) { val ww = exp(-0.5 * (j / 1.5).pow(2)); s2 += ww * fe[q]; ws += ww } }; g[i] = (s2 / ws).toFloat() }
  fun gAt(t: Double): Double { val x = idx(t); val i = floor(x).toInt(); if (i < 0 || i >= nF - 1) return 0.0; return g[i] + (g[i + 1].toDouble() - g[i]) * (x - i) }
  val P = periodSec; val maxS = 0.12 * P; val stepS = 1 / fps2
  val shift = bt.indices.map { k ->
    var best = 0.0; var bv = Double.NEGATIVE_INFINITY
    var d = -maxS
    while (d <= maxS + 1e-9) {
      var sc = 0.0
      for (j in max(0, k - 4)..min(bt.size - 1, k + 4)) sc += gAt(bt[j] + d) * (if (j == k) 1.5 else 1.0)
      sc *= exp(-0.5 * (d / (0.3 * P)).pow(2))
      if (sc > bv) { bv = sc; best = d }
      d += stepS
    }
    best
  }
  val shiftS = shift.indices.map { k -> val w = shift.subList(max(0, k - 2), min(shift.size, k + 3)).sorted(); w[w.size shr 1] }
  val grid = bt.indices.map { bt[it] + shiftS[it] }
  fun levelAt(i: Int): Double {
    val a = max(0, i - rnd(0.4 * fps2)); val b = min(nF - 1, i + rnd(0.4 * fps2)); val v = ArrayList<Double>()
    var j = a; while (j <= b) { v += fe[j].toDouble(); j += 3 }
    v.sort(); return v.getOrElse(v.size shr 1) { 0.0 }
  }
  val w = min(0.04, 0.1 * P)
  val raw: List<Double?> = grid.map { b ->
    val i0 = max(1, floor(idx(b - w)).toInt()); val i1 = min(nF - 2, ceil(idx(b + w)).toInt())
    var best = -1; var bv = 0.0
    for (i in i0..i1) { val v = fe[i]; if (v >= fe[i - 1] && v > fe[i + 1]) { val gg = exp(-0.5 * ((tOf(i.toDouble()) - b) / 0.02).pow(2)); val sc = v * gg; if (sc > bv) { bv = sc; best = i } } }
    if (best < 0 || fe[best] < 1.6 * levelAt(best)) null
    else {
      val y0 = fe[best - 1].toDouble(); val y1 = fe[best].toDouble(); val y2 = fe[best + 1].toDouble(); val d = y0 - 2 * y1 + y2
      tOf(best + (if (d != 0.0) max(-0.5, min(0.5, 0.5 * (y0 - y2) / d)) else 0.0)) - b
    }
  }
  return grid.indices.map { k ->
    val b = grid[k]; val near = ArrayList<Double>()
    for (j in max(0, k - 4)..min(grid.size - 1, k + 4)) raw[j]?.let { near += it }
    val rk = raw[k]
    if (near.size < 3) (if (rk != null) b + max(-0.025, min(0.025, rk)) else b)
    else { near.sort(); val med = near[near.size shr 1]; val own = rk ?: med; b + med + max(-0.025, min(0.025, own - med)) }
  }
}

private fun median2(a: List<Double>) = a.sorted().let { it.getOrElse(it.size shr 1) { Double.NaN } }

/** `mono`: the song in one channel. */
fun songAnalysis(mono: FloatArray, sampleRate: Int, opts: SongOptions = SongOptions()): SongResult {
  val sr = sampleRate.toDouble(); val N = 1024; val H = 512; val nb = N / 2; val len = mono.size; val duration = len / sr
  val frames = max(1, floor((len - N).toDouble() / H).toInt() + 1)
  val win = DoubleArray(N) { 0.5 - 0.5 * cos(2 * Math.PI * it / (N - 1)) }
  val fft = Fft(N); val re = DoubleArray(N); val im = DoubleArray(N)
  val B = min(257, nb); val Mag = FloatArray(frames * B)
  for (f in 0 until frames) {
    val o = f * H
    for (i in 0 until N) { val j = o + i; re[i] = (if (j < len) mono[j].toDouble() else 0.0) * win[i]; im[i] = 0.0 }
    fft.run(re, im)
    for (k in 0 until B) Mag[f * B + k] = sqrt(re[k] * re[k] + im[k] * im[k]).toFloat()
  }
  val hw = 8; val tmp = FloatArray(2 * hw + 1); val Hm = FloatArray(frames * B); val Pm = FloatArray(frames * B)
  for (k in 0 until B) for (f in 0 until frames) {
    for (j in -hw..hw) { val ff = (f + j).coerceIn(0, frames - 1); tmp[j + hw] = Mag[ff * B + k] }
    Arrays.sort(tmp); Hm[f * B + k] = tmp[hw]
  }
  for (f in 0 until frames) for (k in 0 until B) {
    for (j in -hw..hw) { val kk = (k + j).coerceIn(0, B - 1); tmp[j + hw] = Mag[f * B + kk] }
    Arrays.sort(tmp); Pm[f * B + k] = tmp[hw]
  }
  val pfArr = FloatArray(frames)
  val flux = DoubleArray(frames); val fLow = DoubleArray(frames); val fHi = DoubleArray(frames); val fBody = DoubleArray(frames); val fKick = DoubleArray(frames); val fMid = DoubleArray(frames); val fTop = DoubleArray(frames)
  val prev = DoubleArray(B); val prevF = DoubleArray(B)
  val kSplit = rnd(300.0 * N / sr); val kBody = rnd(800.0 * N / sr); val kKick = max(2, rnd(150.0 * N / sr)); val kMid = rnd(4000.0 * N / sr)
  for (f in 0 until frames) {
    var s = 0.0; var sl = 0.0; var sh = 0.0; var pn = 0.0; var pdn = 0.0; var sb = 0.0; var sk = 0.0; var sm2 = 0.0; var st2 = 0.0
    for (k in 1 until B) {
      val i = f * B + k; val mg = Mag[i].toDouble(); val p2 = Pm[i].toDouble() * Pm[i]; val h2 = Hm[i].toDouble() * Hm[i]
      val m = ln1p(100 * mg * p2 / (p2 + h2 + 1e-12)); val e2 = mg * mg
      pn += e2 * p2 / (p2 + h2 + 1e-12); pdn += e2
      val d = m - prev[k]
      if (d > 0 && f > 0) { s += d; if (k < kBody) sb += d else if (k < kMid) sm2 += d else st2 += d; if (k <= kKick) sk += d }
      prev[k] = m
      val mf = ln1p(100 * mg); val df = mf - prevF[k]
      if (df > 0 && f > 0) { if (k < kSplit) sl += df else sh += df }
      prevF[k] = mf
    }
    flux[f] = s; fLow[f] = sl; fHi[f] = sh; fBody[f] = sb; fKick[f] = sk; fMid[f] = sm2; fTop[f] = st2; pfArr[f] = (if (pdn > 0) pn / pdn else 0.0).toFloat()
  }
  val W = 8
  fun localMean(a: DoubleArray): DoubleArray {
    val c = DoubleArray(frames + 1); for (i in 0 until frames) c[i + 1] = c[i] + a[i]
    return DoubleArray(frames) { i -> val lo = max(0, i - W); val hi = min(frames, i + W + 1); max(0.0, a[i] - (c[hi] - c[lo]) / (hi - lo)) }
  }
  val env = localMean(flux)
  val rmsF = FloatArray(frames)
  for (f in 0 until frames) { var s = 0.0; val o = f * H; var i = 0; while (i < N) { val j = o + i; val v = if (j < len) mono[j].toDouble() else 0.0; s += v * v; i += 2 }; rmsF[f] = sqrt(s / (N / 2)).toFloat() }
  val fps = sr / H
  val bodyEnv = localMean(fBody); val kickEnv = localMean(fKick)
  val trk = trackBeats(env, bodyEnv, fps, kickEnv)
  val half = (N / 2) / sr
  var own: List<Double> = trk.beats.map { it / fps + half }; var ownPeriod = trk.period / fps
  var beatSource = "own"; var beatJudge: BeatJudge? = null
  val force = opts.forceBeats?.takeIf { it.size >= 4 }; val theirs = opts.beats?.takeIf { it.size >= 8 }
  fun gaps(bt: List<Double>) = (1 until bt.size).map { bt[it] - bt[it - 1] }
  if (force != null) {
    own = force.toList(); median2(gaps(own)).let { if (!it.isNaN() && it != 0.0) ownPeriod = it }; beatSource = opts.forceSource ?: "own"
  } else if (theirs != null) {
    val A = DoubleArray(frames)
    for ((a, wt) in listOf(fKick to 1.0, fBody to 1.0, fMid to 1.0, fTop to 0.5)) { var m = 0.0; for (v in a) m += v; m = (m / max(1, a.size)).orOne(); val q = wt / m; for (i in 0 until frames) A[i] += q * a[i] }
    var Am = 0.0; for (v in A) Am += v; Am = (Am / frames).orOne()
    fun accAt(t: Double): Double { val f = rnd((t - half) * fps); var m = 0.0; for (j in f - 3..f + 3) if (j in 0 until frames && A[j] > m) m = A[j]; return m }
    fun medIbi(bt: List<Double>) = median2(gaps(bt)).let { if (it.isNaN() || it == 0.0) 1.0 else it }
    fun judge(bt: List<Double>): JudgeResult {
      var s2 = 0.0; var c = 0; for (t in bt) { s2 += accAt(t); c++ }
      val ibi = gaps(bt); var steady = 0
      ibi.forEachIndexed { i, d -> val w = ibi.subList(max(0, i - 4), min(ibi.size, i + 5)).sorted(); val med = w[w.size shr 1]; if (abs(d - med) <= 0.15 * med) steady++ }
      val reg = steady.toDouble() / max(1, ibi.size); val accent = s2 / max(1, c) / Am
      return JudgeResult(accent, reg, accent * reg * reg)
    }
    val jo = judge(own); val jn = judge(theirs)
    beatJudge = BeatJudge(jo, jn)
    var pickAi = jn.score > jo.score
    val r = medIbi(own) / medIbi(theirs)
    if (abs(log2(r)) > 0.85 && abs(log2(r)) < 1.15 && jo.steady > 0.8 && jn.steady > 0.8) {
      val fast = if (r > 1) theirs else own; val slow = if (r > 1) own else theirs; val tol = 0.25 * medIbi(fast)
      var on = 0.0; var no = 0; var mid = 0.0; var nm = 0
      for (t in fast) { if (slow.any { abs(it - t) < tol }) { on += accAt(t); no++ } else { mid += accAt(t); nm++ } }
      val alt = (mid / max(1, nm)) / max(1e-9, on / max(1, no))
      beatJudge.alt = alt
      pickAi = (alt > opts.altFast) == (r > 1)
    }
    if (pickAi) { ownPeriod = median2(gaps(theirs)); own = theirs.toList(); beatSource = "ai" }
  }
  val beatsDP = if (force != null) own.toList() else trimNoPulse(refineBeats(own, ownPeriod, mono, sr)) { t -> val f = rnd((t - half) * fps); var m = 0.0; for (j in f - 3..f + 3) if (j in 0 until frames && env[j] > m) m = env[j]; m }
  val period = ownPeriod; val phase = beatsDP.firstOrNull() ?: 0.0; val hopSec = H / sr
  fun detrend(a: DoubleArray): DoubleArray {
    val o = localMean(a); val s = o.sortedArray(); val p98 = s.getOrElse(floor(s.size * 0.98).toInt()) { 1.0 }.orOne()
    for (i in 0 until frames) o[i] /= p98
    return o
  }
  val e1 = detrend(flux); val e2 = detrend(fLow); val e3 = detrend(fHi)
  val onEnv = DoubleArray(frames) { e1[it] + e2[it] + 0.5 * e3[it] }; val onFps = fps; val onOff = half
  // hits and peaks
  val peaks = ArrayList<Double>(); val peakS = ArrayList<Double>(); val hitsRaw = ArrayList<Double>(); val hitsStr = ArrayList<Double>()
  run {
    val e = onEnv; val n = e.size; val wide = rnd(onFps * 0.4)
    val c1 = DoubleArray(n + 1); for (i in 0 until n) c1[i + 1] = c1[i] + e[i]
    val gmean = c1[n] / n
    for (i in 1 until n - 1) { if (e[i] <= gmean * 0.6) continue; var mx = true; for (j in max(0, i - 3)..min(n - 1, i + 3)) if (e[j] > e[i]) { mx = false; break }; if (mx) { peaks += i / onFps + onOff; peakS += e[i] / gmean } }
    var last = -1.0
    for (i in 1 until n - 1) {
      if (e[i] <= 0) continue
      var isMax = true; for (j in max(0, i - 4)..min(n - 1, i + 4)) if (e[j] > e[i]) { isMax = false; break }
      if (!isMax) continue
      val a = max(0, i - wide); val b = min(n, i + wide + 1); val m = (c1[b] - c1[a]) / (b - a)
      if (e[i] > 2.4 * m && e[i] > gmean * 1.2) { val t = i / onFps + onOff; if (t - last > 0.06) { hitsRaw += t; hitsStr += e[i] / gmean; last = t } }
    }
  }
  fun drumness(t: Double): Double { val c = rnd((t - onOff) * onFps); var m = 0.0; for (j in c - 2..c + 4) if (j in pfArr.indices && pfArr[j] > m) m = pfArr[j].toDouble(); return m }
  // the cuts
  val beats = beatsDP.filter { it >= 0 && it < duration - 0.02 }
  val first = beats.firstOrNull() ?: 0.0
  val hop = rnd(0.005 * sr); val wn = rnd(0.02 * sr)
  val nF = max(1, floor((len - wn).toDouble() / hop).toInt() + 1); val L = DoubleArray(nF); val lt = DoubleArray(nF)
  for (f in 0 until nF) {
    var s = 0.0; val o = f * hop; var k = 0
    while (k < wn) { val j = o + k; val v = if (j < len) mono[j].toDouble() else Double.NaN; s += v * v; k += 2 }
    L[f] = 10 * log10(s / (wn / 2) + 1e-10); lt[f] = (o + wn / 2) / sr
  }
  val kk = 12; val rise = DoubleArray(nF); val drop = DoubleArray(nF)
  for (f in 0 until nF) { var mn = Double.POSITIVE_INFINITY; var mx = Double.NEGATIVE_INFINITY; for (j in max(0, f - kk)..f) { if (L[j] < mn) mn = L[j]; if (L[j] > mx) mx = L[j] }; rise[f] = L[f] - mn; drop[f] = mx - L[f] }
  class Ev(val t: Double, val s: Double)
  fun events(sig: DoubleArray, th: Double, isUp: Boolean): List<Ev> {
    val out = ArrayList<Ev>(); var f = 0
    while (f < nF) {
      if (sig[f] >= th) {
        var g = f; while (g < nF && sig[g] >= th * 0.5) g++
        var m = f; for (q in f until g) if (sig[q] > sig[m]) m = q
        val st = max(1, m - kk); var best = st
        for (q in st..m) { val d = L[q] - L[q - 1]; if (if (isUp) d > L[best] - L[best - 1] else d < L[best] - L[best - 1]) best = q }
        out += Ev(lt[best], sig[m]); f = g
      } else f++
    }
    return out
  }
  fun pct(a: List<Ev>, q: Double): Double { val s = a.map { it.s }.sorted(); return if (s.isNotEmpty()) s[floor((s.size - 1) * q).toInt()] else 0.0 }
  var ups = events(rise, 4.0, true); var downs = events(drop, 5.0, false)
  val pu = pct(ups.filter { it.t > 0.1 }, 0.9); val pd = pct(downs.filter { it.t < duration - 0.3 }, 0.75)
  ups = ups.filter { it.s >= max(6.0, 0.5 * pu) }
  val upsNow = ups
  downs = downs.filter { d -> d.s >= max(6.0, 0.5 * pd) && d.t < duration - 0.15 && !upsNow.any { it.t - d.t >= 0 && it.t - d.t <= 0.15 } }
  val sm = rnd(0.75 / 0.005); val cL = DoubleArray(nF + 1); for (f in 0 until nF) cL[f + 1] = cL[f] + L[f]
  fun avg(a0: Int, b0: Int): Double { val a = max(0, a0); val b = min(nF, b0); return if (b > a) (cL[b] - cL[a]) / (b - a) else -100.0 }
  val smooth = DoubleArray(nF) { avg(it - sm, it + sm) }; val sortedS = smooth.sortedArray()
  fun fIdx(t: Double) = rnd((t - 0.01) / 0.005).coerceIn(0, nF - 1)
  fun intensity(t: Double): Double { val v = smooth[fIdx(t)]; var lo = 0; var hi = sortedS.size; while (lo < hi) { val m = (lo + hi) shr 1; if (sortedS[m] < v) lo = m + 1 else hi = m }; return lo.toDouble() / sortedS.size }
  val s1s = rnd(1 / 0.005); val s03 = rnd(0.3 / 0.005); val pU = pct(ups, 0.85)
  class Cut(val t: Double, val ty: String, val s: Double = 0.0)
  var forced = ArrayList<Cut>()
  for (u in ups) { val f = fIdx(u.t); if (u.s >= max(8.0, pU) && drumness(u.t) >= DRUM_MIN && avg(f, f + s1s) - avg(f - s1s, f) >= 3) forced += Cut(u.t, "drop", u.s) }
  for (d in downs) { val f = fIdx(d.t); if (d.s >= 8 && avg(f, f + s03) <= avg(f - s03, f) - 6) forced += Cut(d.t, "break", d.s) }
  val pH = 0.35 * pct(ups.filter { it.t > 0.1 }, 0.9)
  for (u in ups) if (u.s >= max(7.0, pH) && drumness(u.t) >= DRUM_MIN && !forced.any { abs(it.t - u.t) < 0.05 }) forced += Cut(u.t, "hit", u.s)
  forced = ArrayList(forced.sortedBy { it.t })
  run {
    fun rank(x: Cut) = if (x.ty == "hit") x.s else 100 + x.s
    val keep = ArrayList<Cut>()
    for (x in forced.sortedByDescending { rank(it) }) if (keep.all { abs(it.t - x.t) >= 0.25 }) keep += x
    forced = ArrayList(keep.sortedBy { it.t })
  }
  fun onGrid(t: Double): Boolean { var lo = 0; var hi = beats.size; while (lo < hi) { val m = (lo + hi) shr 1; if (beats[m] < t) lo = m + 1 else hi = m }; return (lo < beats.size && abs(beats[lo] - t) < 0.05) || (lo > 0 && abs(beats[lo - 1] - t) < 0.05) }
  class Cand(val t: Double, val sc: Double)
  val cands0 = ArrayList<Cand>()
  peaks.forEachIndexed { k, pt -> val c = Cand(pt, peakS[k] * (if (onGrid(pt)) 1.4 else 1.0)); if (drumness(c.t) >= DRUM_MIN - 0.1) cands0 += c }
  for (u in ups) if (drumness(u.t) >= DRUM_MIN - 0.1) cands0 += Cand(u.t, u.s / 4 + (if (onGrid(u.t)) 1 else 0))
  val cands = cands0.sortedBy { it.t }
  fun beatsFor(i: Double) = if (i < 0.3) 4 else if (i < 0.75) 2 else 1
  val out = ArrayList<Cut>(); var fi = 0
  var cur = if (ups.isNotEmpty()) min(ups[0].t, forced.firstOrNull()?.t ?: Double.POSITIVE_INFINITY) else first
  out += Cut(cur, if (forced.isNotEmpty() && abs(forced[0].t - cur) < 0.01) forced[0].ty else "cut")
  while (fi < forced.size && forced[fi].t <= cur + 0.01) fi++
  while (cur < duration - 0.3) {
    while (fi < forced.size && forced[fi].t - cur < 0.2) fi++
    val nbeats = beatsFor(intensity(cur)); val target = cur + nbeats * period; val w = min(1.0, nbeats / 2.0) * period
    if (fi < forced.size && forced[fi].t < target + w && forced[fi].t - cur >= 0.2) { cur = forced[fi].t; out += Cut(cur, forced[fi].ty); fi++; continue }
    var best: Double? = null; var bs = -1.0
    for (c in cands) { if (c.t < target - w || c.t > target + w || c.t - cur < 0.25) continue; val sc = c.sc * (1 - 0.35 * abs(c.t - target) / w); if (sc > bs) { bs = sc; best = c.t } }
    if (best == null) {
      val nx = cands.firstOrNull { it.t > target + w }; val nf = if (fi < forced.size) forced[fi].t else Double.POSITIVE_INFINITY
      if (nx == null && nf == Double.POSITIVE_INFINITY) break
      if (nf <= (nx?.t ?: Double.POSITIVE_INFINITY)) { cur = nf; out += Cut(cur, forced[fi].ty); fi++; continue }
      best = nx!!.t
    }
    if (best >= duration - 0.15) break
    cur = best; out += Cut(cur, "cut")
  }
  val cuts = ArrayList<Double>(); val cutType = ArrayList<String>()
  for (c in out.sortedBy { it.t }) { val last = cuts.size - 1; if (last >= 0 && c.t - cuts[last] < 0.15) { if (c.ty != "cut") { cuts[last] = c.t; cutType[last] = c.ty }; continue }; cuts += c.t; cutType += c.ty }
  val cutFx = cuts.indices.map { k ->
    val ty = cutType[k]; val length = (if (k + 1 < cuts.size) cuts[k + 1] else duration) - cuts[k]
    if (ty == "drop") "Best shot · flash + zoom-in" else if (ty == "break") "Slow-mo / freeze / text" else if (length < 0.3) "Fast cut · shake" else if (ty == "hit") "Zoom punch" else if (length > 1.6) "Long shot · smooth pan" else "Hard cut"
  }
  return SongResult(period, phase, hopSec, rmsF, onEnv, onFps, onOff, hitsRaw, hitsStr, pfArr, beats, cuts, cutType, cutFx, peaks, peakS, 0.0, beatSource, beatJudge)
}
