package expo.modules.shubixvideo

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.SurfaceView
import android.view.ViewGroup
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.CompositionPlayer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** The Reel playing live on the phone (Media3's CompositionPlayer): the same Composition the export writes
 * (ShubixVideoModule.buildComposition), drawn on the GPU while it plays, so what plays is what the export makes.
 * Events: onTime { time, playing } ten times a second, onEnded, onError { message }. Everything runs on the main thread. */
@UnstableApi
class ShubixPreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val surface = SurfaceView(context).also { addView(it, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)) }
  private val onTime by EventDispatcher()
  private val onEnded by EventDispatcher()
  private val onError by EventDispatcher()
  private val main = Handler(Looper.getMainLooper())
  private var player: CompositionPlayer? = null
  private val tick = object : Runnable {
    override fun run() {
      val p = player ?: return
      onTime(mapOf("time" to p.currentPosition / 1000.0, "playing" to p.isPlaying))
      main.postDelayed(this, 100)
    }
  }

  /** a new Reel: the old player goes, a new one is made for it, paused at `at` seconds */
  fun load(composition: Composition, at: Double) {
    release()
    val p = CompositionPlayer.Builder(context).build()
    p.setVideoSurfaceView(surface)
    p.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_ENDED) onEnded(mapOf<String, Any>()) }
      override fun onPlayerError(error: PlaybackException) { onError(mapOf("message" to (error.message ?: "The preview could not play."))) }
    })
    p.setComposition(composition)
    p.prepare()
    if (at > 0) p.seekTo((at * 1000).toLong())
    player = p
    main.removeCallbacks(tick); main.post(tick)
  }
  fun play() { player?.play() }
  fun pause() { player?.pause() }
  fun seek(at: Double) { player?.seekTo((at.coerceAtLeast(0.0) * 1000).toLong()) }
  fun setMuted(muted: Boolean) { player?.volume = if (muted) 0f else 1f }
  fun release() {
    main.removeCallbacks(tick)
    player?.let { it.clearVideoSurfaceView(surface); it.release() }
    player = null
  }

  override fun onDetachedFromWindow() { super.onDetachedFromWindow(); release() }
}
