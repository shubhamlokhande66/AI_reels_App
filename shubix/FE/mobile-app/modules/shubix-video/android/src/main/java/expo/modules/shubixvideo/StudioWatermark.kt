package expo.modules.shubixvideo

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import kotlin.math.min
import kotlin.math.roundToInt

/** The Shubix watermark on an exported Reel, placed as the website's drawWatermark() (engine.ts): bottom right, at 85%. */
@UnstableApi
internal class StudioWatermark(context: Context, w: Int, h: Int) : BitmapOverlay() {
  private val frame: Bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { out ->
    val mark = context.assets.open("engine/brand/shubix-gold-sm.webp").use { BitmapFactory.decodeStream(it) }
      ?: throw IllegalStateException("The watermark could not be read.")
    val width = (min(w.toFloat(), h * 0.5625f) * 0.24f).roundToInt()
    val height = (width.toFloat() * mark.height / mark.width).roundToInt()
    val margin = (min(w, h) * 0.035f).roundToInt()
    val left = (w - width - margin).toFloat(); val top = h - height - margin * 1.6f
    Canvas(out).drawBitmap(mark, null, RectF(left, top, left + width, top + height), Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG).apply { alpha = 217 })
    mark.recycle()
  }
  override fun getBitmap(presentationTimeUs: Long): Bitmap = frame
}
