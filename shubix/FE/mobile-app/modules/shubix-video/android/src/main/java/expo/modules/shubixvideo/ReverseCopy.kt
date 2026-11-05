package expo.modules.shubixvideo

import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.os.Build
import java.io.File
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** A part of a clip played backwards, as its own silent H.264 file: each frame read at its time, last one first, and encoded
 * with the phone's hardware. The sound of a Studio Reel comes from the studio's mix. Blocks, and throws when it fails. */
internal fun makeReverseCopy(from: String, to: File, start: Double, end: Double, fps: Int = 30, bitrate: Int = 12_000_000, longSide: Int = 1920) {
  require(end > start) { "Nothing to reverse." }
  val reader = MediaMetadataRetriever()
  val part = File(to.path + ".part").apply { delete() }
  var codec: MediaCodec? = null
  var muxer: MediaMuxer? = null
  var started = false
  try {
    reader.setDataSource(from)
    fun frameAt(seconds: Double, w: Int, h: Int): Bitmap? {
      val at = (seconds * 1_000_000).toLong()
      val got = if (Build.VERSION.SDK_INT >= 27) reader.getScaledFrameAtTime(at, MediaMetadataRetriever.OPTION_CLOSEST, w, h) else reader.getFrameAtTime(at, MediaMetadataRetriever.OPTION_CLOSEST)
      return got?.let { if (it.width == w && it.height == h) it else Bitmap.createScaledBitmap(it, w, h, true).also { s -> if (s !== it) it.recycle() } }
    }
    val probe = reader.getFrameAtTime((start * 1_000_000).toLong(), MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: throw IllegalStateException("The clip has no picture.")
    val scale = min(1f, longSide.toFloat() / max(probe.width, probe.height))
    val w = (probe.width * scale / 2).roundToInt() * 2; val h = (probe.height * scale / 2).roundToInt() * 2
    probe.recycle()
    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
      setInteger(MediaFormat.KEY_BIT_RATE, bitrate); setInteger(MediaFormat.KEY_FRAME_RATE, fps); setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    val enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC).also { codec = it }
    enc.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE); enc.start()
    val mux = MediaMuxer(part.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4).also { muxer = it }
    val count = max(1, ((end - start) * fps).roundToInt())
    val info = MediaCodec.BufferInfo(); val pixels = IntArray(w * h)
    var track = -1; var fed = 0; var last: Bitmap? = null; var finished = false
    while (!finished) {
      if (fed <= count) {
        val slot = enc.dequeueInputBuffer(10_000)
        if (slot >= 0) {
          if (fed == count) { enc.queueInputBuffer(slot, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); fed++ }
          else {
            // the last frame of the part first; a frame that cannot be read repeats the one before it
            val pic = frameAt(max(start, end - (fed + 1.0) / fps), w, h)
            if (pic != null) { last?.recycle(); last = pic }
            val shown = last ?: throw IllegalStateException("A frame of the clip could not be read.")
            shown.getPixels(pixels, 0, w, 0, 0, w, h)
            val image = enc.getInputImage(slot) ?: throw IllegalStateException("The encoder gave no picture to fill.")
            fillYuv(image, pixels, w, h)
            enc.queueInputBuffer(slot, 0, w * h * 3 / 2, fed * 1_000_000L / fps, 0); fed++
          }
        }
      }
      val out = enc.dequeueOutputBuffer(info, 10_000)
      if (out == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) { track = mux.addTrack(enc.outputFormat); mux.start(); started = true }
      else if (out >= 0) {
        val data = enc.getOutputBuffer(out)
        if (data != null && info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
          check(started) { "The encoder wrote before it was ready." }
          data.position(info.offset); data.limit(info.offset + info.size); mux.writeSampleData(track, data, info)
        }
        finished = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
        enc.releaseOutputBuffer(out, false)
      }
    }
    last?.recycle()
    enc.stop(); mux.stop(); started = false
    mux.release(); muxer = null
    if (!part.renameTo(to)) throw IllegalStateException("The reversed clip could not be kept.")
  } finally {
    runCatching { codec?.release() }
    runCatching { if (started) muxer?.stop(); muxer?.release() }
    runCatching { reader.release() }
    part.delete()
  }
}

// ARGB pixels into the encoder's planes, whatever their layout (BT.601, the range H.264 encoders expect)
private fun fillYuv(image: android.media.Image, argb: IntArray, w: Int, h: Int) {
  val (py, pu, pv) = image.planes
  val yb = py.buffer; val ub = pu.buffer; val vb = pv.buffer
  for (row in 0 until h) for (col in 0 until w) {
    val c = argb[row * w + col]; val r = (c shr 16) and 255; val g = (c shr 8) and 255; val b = c and 255
    yb.put(row * py.rowStride + col * py.pixelStride, (((66 * r + 129 * g + 25 * b + 128) shr 8) + 16).toByte())
    if (row % 2 == 0 && col % 2 == 0) {
      val cr = row / 2; val cc = col / 2
      ub.put(cr * pu.rowStride + cc * pu.pixelStride, (((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128).toByte())
      vb.put(cr * pv.rowStride + cc * pv.pixelStride, (((112 * r - 94 * g - 18 * b + 128) shr 8) + 128).toByte())
    }
  }
}
