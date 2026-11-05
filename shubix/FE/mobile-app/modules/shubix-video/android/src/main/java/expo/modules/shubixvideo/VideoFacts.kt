package expo.modules.shubixvideo

import android.media.MediaCodecInfo.CodecProfileLevel as P
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File

/** What a clip is, read from its container (nothing decoded): what decides whether it needs an edit copy. `times`: when its
 * first frames play, in seconds, in the file's order (they say whether its frame rate varies). */
internal class VideoFacts(val fps: Double, val hdr: Boolean, val tenBit: Boolean, val chroma422: Boolean, val times: List<Double>)

internal fun videoFacts(file: File): VideoFacts {
  val x = MediaExtractor()
  try {
    x.setDataSource(file.path)
    val track = (0 until x.trackCount).firstOrNull { x.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true } ?: return VideoFacts(0.0, false, false, false, emptyList())
    val f = x.getTrackFormat(track)
    fun int(k: String) = if (f.containsKey(k)) f.getInteger(k) else -1
    val mime = f.getString(MediaFormat.KEY_MIME) ?: ""
    val transfer = int(MediaFormat.KEY_COLOR_TRANSFER); val profile = int(MediaFormat.KEY_PROFILE)
    val hdr = transfer == MediaFormat.COLOR_TRANSFER_ST2084 || transfer == MediaFormat.COLOR_TRANSFER_HLG || mime == MediaFormat.MIMETYPE_VIDEO_DOLBY_VISION
    val tenBit = when (mime) {
      MediaFormat.MIMETYPE_VIDEO_HEVC -> profile == P.HEVCProfileMain10 || profile == P.HEVCProfileMain10HDR10 || profile == P.HEVCProfileMain10HDR10Plus
      MediaFormat.MIMETYPE_VIDEO_AVC -> profile == P.AVCProfileHigh10 || profile == P.AVCProfileHigh422 || profile == P.AVCProfileHigh444
      MediaFormat.MIMETYPE_VIDEO_VP9 -> profile == P.VP9Profile2 || profile == P.VP9Profile3 || profile == P.VP9Profile2HDR || profile == P.VP9Profile3HDR
      MediaFormat.MIMETYPE_VIDEO_AV1 -> profile == P.AV1ProfileMain10 || profile == P.AV1ProfileMain10HDR10 || profile == P.AV1ProfileMain10HDR10Plus
      else -> false
    }
    val chroma422 = mime == MediaFormat.MIMETYPE_VIDEO_AVC && (profile == P.AVCProfileHigh422 || profile == P.AVCProfileHigh444)
    x.selectTrack(track)
    val times = ArrayList<Double>(240)
    while (times.size < 240) { val t = x.sampleTime; if (t < 0) break; times.add(t / 1_000_000.0); if (!x.advance()) break }
    val rate = int(MediaFormat.KEY_FRAME_RATE).toDouble()
    return VideoFacts(if (rate > 0) rate else fpsOf(times), hdr, tenBit, chroma422, times)
  } catch (_: Exception) { return VideoFacts(0.0, false, false, false, emptyList()) } finally { x.release() }
}

/** The frame rate from the gaps between frames, when the container does not say. */
private fun fpsOf(times: List<Double>): Double {
  val gaps = times.sorted().zipWithNext { a, b -> b - a }.filter { it > 1e-4 }.sorted()
  return if (gaps.size < 5) 0.0 else 1 / gaps[gaps.size / 2]
}
