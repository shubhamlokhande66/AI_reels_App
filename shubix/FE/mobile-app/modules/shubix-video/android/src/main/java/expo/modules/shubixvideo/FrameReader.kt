package expo.modules.shubixvideo

import android.graphics.ImageFormat
import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import java.io.File
import java.io.OutputStream

/** A clip's frames for the engine (motion, scenes, faces, the AI's look), decoded by the phone's hardware decoder.
 * Each answer is 1 byte (1: a frame, 0: none at that time), then with a frame w*h*4 bytes of RGBA. A frame is the first
 * one at or after the time asked. `started` runs once the decoder is open, so a clip it cannot read fails before any byte. */
internal fun readFrames(file: File, w: Int, h: Int, times: DoubleArray, out: OutputStream, started: () -> Unit) {
  val rotation = MediaMetadataRetriever().let { r ->
    try { r.setDataSource(file.path); r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0 } finally { r.release() }
  }
  val source = MediaExtractor().apply { setDataSource(file.path) }
  var codec: MediaCodec? = null
  try {
    val track = (0 until source.trackCount).firstOrNull { source.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true }
      ?: throw IllegalArgumentException("no video track")
    source.selectTrack(track)
    val format = source.getTrackFormat(track)
    format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
    val first = source.sampleTime.coerceAtLeast(0L)
    val c = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!).also { codec = it }
    c.configure(format, null, null, 0)
    c.start()
    started()
    val info = MediaCodec.BufferInfo(); val rgba = ByteArray(w * h * 4)
    var inputDone = false; var outputDone = false; var lastPts = -1L
    for (seconds in times) {
      val want = first + (seconds * 1_000_000).toLong()
      // back in time, or far ahead: from the key frame before it; near: decoding on is quicker
      if (lastPts >= 0 && (want < lastPts || want - lastPts > 2_000_000)) {
        source.seekTo(want, MediaExtractor.SEEK_TO_PREVIOUS_SYNC); c.flush(); inputDone = false; outputDone = false
      }
      var got = false
      while (!got && !outputDone) {
        if (!inputDone) {
          val i = c.dequeueInputBuffer(5_000)
          if (i >= 0) {
            val size = source.readSampleData(c.getInputBuffer(i)!!, 0)
            if (size < 0) { c.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
            else { c.queueInputBuffer(i, 0, size, source.sampleTime, 0); source.advance() }
          }
        }
        val o = c.dequeueOutputBuffer(info, 5_000)
        if (o < 0) continue
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
        if (info.size > 0) {
          lastPts = info.presentationTimeUs
          if (info.presentationTimeUs + 8_000 >= want) {   // 8 ms: rounding of the time asked
            val image = c.getOutputImage(o) ?: throw IllegalStateException("no picture")
            image.use { toRgba(it, rotation, w, h, rgba) }
            got = true
          }
        }
        c.releaseOutputBuffer(o, false)
      }
      out.write(if (got) 1 else 0)
      if (got) out.write(rgba)
    }
    out.flush()
  } finally {
    try { codec?.stop() } catch (_: Exception) {}
    codec?.release()
    source.release()
  }
}

/** Frames as they are decoded: each answer of readFrames handed over instead of written */
private class FrameSink(private val size: Int, private val onFrame: (Int, ByteArray?) -> Unit) : OutputStream() {
  private var k = 0
  override fun write(b: Int) { if (b == 0) onFrame(k++, null) }
  override fun write(b: ByteArray, off: Int, len: Int) { if (len == size) onFrame(k++, b) }
}

/** A whole clip read on the phone (ClipScan.kt) */
internal fun scanFile(file: File, dur: Double, onProgress: (Double) -> Unit): ClipScanResult {
  val w = 128; val h = 72; val times = scanTimes(dur)
  return scanClip(times, { emit ->
    readFrames(file, w, h, times, FrameSink(w * h * 4) { k, rgba -> if (rgba == null) emit(k, null, null) else emit(k, shrinkRgba(rgba, w, h, CLIP_SW, CLIP_SH), rgba) }) {}
  }, { t ->
    var hist: FloatArray? = null
    readFrames(file, w, h, doubleArrayOf(t), FrameSink(w * h * 4) { _, rgba -> if (rgba != null) hist = colorHist(shrinkRgba(rgba, w, h, CLIP_SW, CLIP_SH)) }) {}
    hist
  }, onProgress)
}

/** Frames as JPEGs (quality 72, as the page's), each base64, in the order of the times */
internal fun jpegsOfFile(file: File, w: Int, h: Int, times: DoubleArray): org.json.JSONArray {
  val out = org.json.JSONArray(); val pixels = IntArray(w * h)
  readFrames(file, w, h, times, FrameSink(w * h * 4) { _, rgba ->
    if (rgba == null) out.put(org.json.JSONObject.NULL)
    else {
      for (i in pixels.indices) { val o = i * 4; pixels[i] = (255 shl 24) or ((rgba[o].toInt() and 255) shl 16) or ((rgba[o + 1].toInt() and 255) shl 8) or (rgba[o + 2].toInt() and 255) }
      val pic = android.graphics.Bitmap.createBitmap(pixels, w, h, android.graphics.Bitmap.Config.ARGB_8888); val b = java.io.ByteArrayOutputStream()
      pic.compress(android.graphics.Bitmap.CompressFormat.JPEG, 72, b); pic.recycle()
      out.put(android.util.Base64.encodeToString(b.toByteArray(), android.util.Base64.NO_WRAP))
    }
  }) {}
  return out
}

/** Where faces are in a whole clip, on the phone's own decoder and model (ClipFaces.kt) */
internal fun facesOfFile(file: File, dur: Double, W: Int, H: Int, models: Models): List<FaceLook> {
  val (w, h) = faceFrameSize(W, H); val times = faceTimes(dur); val looks = ArrayList<FaceLook>()
  models.fetch(FACE_MODEL) {}
  readFrames(file, w, h, times, FrameSink(w * h * 4) { k, rgba ->
    if (rgba != null) looks += FaceLook(times[k], lookForFaces(rgba, w, h, W.toDouble(), H.toDouble()) { square ->
      val o = models.runFloats(FACE_MODEL, "input", square, longArrayOf(1, 128, 128, 3)); faceRows(o.getValue("regressors"), o.getValue("classificators"))
    })
  }) {}
  return looks
}

/** a decoded picture as small RGBA, turned as the clip is shown (BT.601; close enough for reading a clip) */
private fun toRgba(image: Image, rotation: Int, w: Int, h: Int, rgba: ByteArray) {
  if (image.format != ImageFormat.YUV_420_888) throw IllegalArgumentException("picture format ${image.format}")
  val (yP, uP, vP) = image.planes.let { Triple(it[0], it[1], it[2]) }
  val y = yP.buffer; val u = uP.buffer; val v = vP.buffer
  val crop = image.cropRect; val cw = crop.width(); val ch = crop.height()
  var at = 0
  for (dy in 0 until h) for (dx in 0 until w) {
    val sx: Int; val sy: Int
    when (rotation) {
      90 -> { sx = dy * cw / h; sy = (w - 1 - dx) * ch / w }
      180 -> { sx = (w - 1 - dx) * cw / w; sy = (h - 1 - dy) * ch / h }
      270 -> { sx = (h - 1 - dy) * cw / h; sy = dx * ch / w }
      else -> { sx = dx * cw / w; sy = dy * ch / h }
    }
    val px = crop.left + sx; val py = crop.top + sy
    val l = 298 * ((y.get(py * yP.rowStride + px * yP.pixelStride).toInt() and 255) - 16)
    val cb = (u.get((py / 2) * uP.rowStride + (px / 2) * uP.pixelStride).toInt() and 255) - 128
    val cr = (v.get((py / 2) * vP.rowStride + (px / 2) * vP.pixelStride).toInt() and 255) - 128
    rgba[at] = ((l + 409 * cr + 128) shr 8).coerceIn(0, 255).toByte()
    rgba[at + 1] = ((l - 100 * cb - 208 * cr + 128) shr 8).coerceIn(0, 255).toByte()
    rgba[at + 2] = ((l + 516 * cb + 128) shr 8).coerceIn(0, 255).toByte()
    rgba[at + 3] = -1
    at += 4
  }
}
