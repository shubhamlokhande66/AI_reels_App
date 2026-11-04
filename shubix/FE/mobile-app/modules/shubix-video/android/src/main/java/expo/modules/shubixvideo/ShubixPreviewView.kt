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

/** The editor's one player (Media3's CompositionPlayer): the same Composition the export writes
 * (ShubixVideoModule.buildComposition), drawn on the GPU, playing, paused or on a scrubbed frame.
 * Events: onTime { time, playing } ten times a second, onEnded, onError { message }. Everything runs on the main thread. */
@UnstableApi
class ShubixPreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val surface = SurfaceView(context).also { addView(it, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)) }
  private val onTime by EventDispatcher()
  private val onEnded by EventDispatcher()
  private val onError by EventDispatcher()
  private val main = Handler(Looper.getMainLooper())
  private var player: CompositionPlayer? = null
  private var reel: Composition? = null   // kept for when this view comes back to the screen
  private var volume = 1f
  private val tick = object : Runnable {
    override fun run() {
      val p = player ?: return
      onTime(mapOf("time" to p.currentPosition / 1000.0, "playing" to p.isPlaying))
      main.postDelayed(this, 100)
    }
  }

  private fun make() = CompositionPlayer.Builder(context).build().also { p ->
    p.setVideoSurfaceView(surface)
    p.volume = volume
    p.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_ENDED) onEnded(mapOf<String, Any>()) }
      override fun onPlayerError(error: PlaybackException) { onError(mapOf("message" to (error.message ?: "The preview could not play."))) }
    })
    player = p
    main.removeCallbacks(tick); main.post(tick)
  }

  /** the Reel (first time, or after a change): the same player takes it, at `at` seconds, and keeps playing or paused */
  fun load(composition: Composition, at: Double) {
    reel = composition
    val p = player ?: make()
    p.setComposition(composition, (at.coerceAtLeast(0.0) * 1000).toLong())
    p.prepare()
  }
  fun play() { player?.play() }
  fun pause() { player?.pause() }
  fun seek(at: Double) { player?.seekTo((at.coerceAtLeast(0.0) * 1000).toLong()) }
  fun setMuted(muted: Boolean) { volume = if (muted) 0f else 1f; player?.volume = volume }
  fun release() {
    main.removeCallbacks(tick)
    player?.let { it.clearVideoSurfaceView(surface); it.release() }
    player = null
  }

  // off the screen it holds no decoders; back on the screen it is the same Reel, at the same time, paused
  private var resumeAt = 0.0
  override fun onDetachedFromWindow() { resumeAt = (player?.currentPosition ?: 0L) / 1000.0; release(); super.onDetachedFromWindow() }
  override fun onAttachedToWindow() { super.onAttachedToWindow(); if (player == null) reel?.let { load(it, resumeAt) } }
}
