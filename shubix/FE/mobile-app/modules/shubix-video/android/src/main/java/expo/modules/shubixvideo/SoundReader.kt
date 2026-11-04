package expo.modules.shubixvideo

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** A file's sound for the engine, decoded by the phone: 8 bytes (sample rate, channels: little-endian Int32), then the
 * samples as little-endian Float32, the channels side by side. `started` runs once a sound track and decoder are open, so
 * a file without sound fails before any byte. */
internal fun readSound(file: File, out: OutputStream, started: () -> Unit) {
  val source = MediaExtractor().apply { setDataSource(file.path) }
  var codec: MediaCodec? = null
  try {
    val track = (0 until source.trackCount).firstOrNull { source.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
      ?: throw IllegalArgumentException("no sound track")
    source.selectTrack(track)
    val format = source.getTrackFormat(track)
    val c = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!).also { codec = it }
    c.configure(format, null, null, 0)
    c.start()
    started()
    val info = MediaCodec.BufferInfo()
    var inputDone = false; var outputDone = false; var head = false; var encoding = AudioFormat.ENCODING_PCM_16BIT
    var chunk = ByteBuffer.allocate(256 * 1024).order(ByteOrder.LITTLE_ENDIAN)
    fun writeHead(f: MediaFormat) {
      if (head) return
      head = true
      encoding = if (f.containsKey(MediaFormat.KEY_PCM_ENCODING)) f.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
      val top = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
      top.putInt(f.getInteger(MediaFormat.KEY_SAMPLE_RATE)); top.putInt(f.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
      out.write(top.array())
    }
    while (!outputDone) {
      if (!inputDone) {
        val i = c.dequeueInputBuffer(5_000)
        if (i >= 0) {
          val size = source.readSampleData(c.getInputBuffer(i)!!, 0)
          if (size < 0) { c.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
          else { c.queueInputBuffer(i, 0, size, source.sampleTime, 0); source.advance() }
        }
      }
      val o = c.dequeueOutputBuffer(info, 5_000)
      if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) { writeHead(c.outputFormat); continue }
      if (o < 0) continue
      if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
      if (info.size > 0) {
        writeHead(c.outputFormat)
        val pcm = c.getOutputBuffer(o)!!.order(ByteOrder.LITTLE_ENDIAN); pcm.position(info.offset); pcm.limit(info.offset + info.size)
        val samples = if (encoding == AudioFormat.ENCODING_PCM_FLOAT) info.size / 4 else info.size / 2
        if (chunk.capacity() < samples * 4) chunk = ByteBuffer.allocate(samples * 4).order(ByteOrder.LITTLE_ENDIAN)
        chunk.clear()
        repeat(samples) { chunk.putFloat(if (encoding == AudioFormat.ENCODING_PCM_FLOAT) pcm.getFloat() else pcm.getShort() / 32768f) }
        out.write(chunk.array(), 0, samples * 4)
      }
      c.releaseOutputBuffer(o, false)
    }
    out.flush()
  } finally {
    try { codec?.stop() } catch (_: Exception) {}
    codec?.release()
    source.release()
  }
}
