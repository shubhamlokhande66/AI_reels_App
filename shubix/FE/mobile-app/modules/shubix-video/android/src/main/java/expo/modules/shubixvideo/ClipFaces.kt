package expo.modules.shubixvideo

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Where faces are in a clip, on the phone: the website's faceScanner and blazeFaces (engine.ts) with BlazeFace short range. The answer
 * is its looks, [{ t, rects: [{ x, y, s }] }], which the brain's trackFaces follows through the clip. Nothing here needs Android. */
const val FACE_MODEL = "/api/studio/model/face_detection_short_range.onnx"
private const val SIDE = 128

class FaceRect(val x: Double, val y: Double, val s: Double)
class FaceLook(val t: Double, val rects: List<FaceRect>)

fun faceTimes(dur: Double): DoubleArray {
  val step = min(1.5, max(0.4, dur / 60)); val out = ArrayList<Double>(); var t = 0.1
  while (t < dur) { out += t; t += step }
  return out.toDoubleArray()
}

private val ANCHORS: FloatArray = run {
  val a = ArrayList<Float>()
  for ((g, n) in listOf(16 to 2, 8 to 6)) for (y in 0 until g) for (x in 0 until g) repeat(n) { a += (x + 0.5f) / g; a += (y + 0.5f) / g }
  a.toFloatArray()
}

/** a region of the frame as the model's input: floats from -1 to 1, black outside the frame */
fun faceSquare(rgba: ByteArray, fw: Int, fh: Int, W: Double, H: Double, rx: Double, ry: Double, rs: Double): FloatArray {
  val out = FloatArray(SIDE * SIDE * 3); val toFrameX = fw / W; val toFrameY = fh / H; val back = -1f
  for (y in 0 until SIDE) for (x in 0 until SIDE) {
    val i = (y * SIDE + x) * 3
    val sx = (rx + (x + 0.5) * rs / SIDE) * toFrameX - 0.5; val sy = (ry + (y + 0.5) * rs / SIDE) * toFrameY - 0.5
    if (sx < -0.5 || sy < -0.5 || sx > fw - 0.5 || sy > fh - 0.5) { out[i] = back; out[i + 1] = back; out[i + 2] = back; continue }
    val x0 = floor(sx).toInt().coerceIn(0, fw - 1); val y0 = floor(sy).toInt().coerceIn(0, fh - 1); val x1 = min(fw - 1, x0 + 1); val y1 = min(fh - 1, y0 + 1)
    val ax = (sx - x0).coerceIn(0.0, 1.0); val ay = (sy - y0).coerceIn(0.0, 1.0)
    for (c in 0 until 3) {
      fun at(q: Int, p: Int) = (rgba[(q * fw + p) * 4 + c].toInt() and 255).toDouble()
      val v = (at(y0, x0) * (1 - ax) + at(y0, x1) * ax) * (1 - ay) + (at(y1, x0) * (1 - ax) + at(y1, x1) * ax) * ay
      out[i + c] = (v / 255 * 2 - 1).toFloat()
    }
  }
  return out
}

/** the model's answer as [score, cx, cy, w] in the square's fractions */
fun faceRows(reg: FloatArray, cls: FloatArray): List<DoubleArray> {
  val found = ArrayList<DoubleArray>()
  for (k in 0 until 896) {
    val sc = 1 / (1 + exp(-max(-80.0, min(80.0, cls[k].toDouble())))); if (sc < 0.55) continue
    val r = k * 16
    found += doubleArrayOf(sc, reg[r].toDouble() / 128 + ANCHORS[k * 2], reg[r + 1].toDouble() / 128 + ANCHORS[k * 2 + 1], reg[r + 2].toDouble() / 128)
  }
  return found
}

/** one look at a frame: the whole of it, and thirds of a long frame; the same face found twice counts once; at most four */
fun lookForFaces(rgba: ByteArray, fw: Int, fh: Int, W: Double, H: Double, model: (FloatArray) -> List<DoubleArray>): List<FaceRect> {
  val L = max(W, H); val S = min(W, H); val regions = arrayListOf(doubleArrayOf((W - L) / 2, (H - L) / 2, L))
  if (L / S > 1.3) for (f in doubleArrayOf(0.0, 0.5, 1.0)) { val o = (L - S) * f; regions += if (W >= H) doubleArrayOf(o, 0.0, S) else doubleArrayOf(0.0, o, S) }
  class Hit(val sc: Double, val x: Double, val y: Double, val s: Double)
  val all = ArrayList<Hit>()
  for (r in regions) for (row in model(faceSquare(rgba, fw, fh, W, H, r[0], r[1], r[2]))) all += Hit(row[0], (r[0] + row[1] * r[2]) / W, (r[1] + row[2] * r[2]) / H, row[3] * r[2] / W)
  val keep = ArrayList<Hit>()
  for (f in all.sortedByDescending { it.sc }) {
    if (f.s < 0.03 || f.x < 0 || f.x > 1 || f.y < 0 || f.y > 1) continue
    if (keep.any { hypot((it.x - f.x) * W, (it.y - f.y) * H) < 0.5 * max(it.s, f.s) * W }) continue
    keep += f
  }
  return keep.take(4).map { FaceRect(it.x, it.y, it.s) }
}

fun List<FaceLook>.facesToJson(): JSONArray = JSONArray(map { l -> JSONObject().put("t", l.t).put("rects", JSONArray(l.rects.map { JSONObject().put("x", it.x).put("y", it.y).put("s", it.s) })) })

/** a frame's size for reading faces: at most 480 on its long side, even */
fun faceFrameSize(W: Int, H: Int): Pair<Int, Int> { val k = min(1.0, 480.0 / max(W, H)); return Pair(max(2, (W * k / 2).roundToInt() * 2), max(2, (H * k / 2).roundToInt() * 2)) }
