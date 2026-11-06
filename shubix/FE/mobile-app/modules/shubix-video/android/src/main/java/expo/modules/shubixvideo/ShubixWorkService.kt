package expo.modules.shubixvideo

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/** Keeps the Reel being made while the person is away: the screen off, another app. A notification says so as long as the
 * work runs, and the phone may not stop the app or put its processor to sleep meanwhile. Started while the app is on screen. */
class ShubixWorkService : Service() {
  private var cpu: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      val note = notice(intent?.getStringExtra(TITLE) ?: "Shubix is working on your Reel")
      when {
        Build.VERSION.SDK_INT >= 35 -> startForeground(NOTE, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING)
        Build.VERSION.SDK_INT >= 29 -> startForeground(NOTE, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else -> startForeground(NOTE, note)
      }
      if (cpu == null) cpu = (getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "shubix:work").apply { setReferenceCounted(false); acquire(MAX_MS) }
    } catch (_: Exception) { stopSelf() } // the phone refused: the work goes on as long as the app is on screen
    return START_NOT_STICKY
  }

  /** Android's limit for this kind of work has passed */
  override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }

  override fun onDestroy() {
    runCatching { if (cpu?.isHeld == true) cpu?.release() }; cpu = null
    super.onDestroy()
  }

  private fun notice(title: String): Notification {
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val build = if (Build.VERSION.SDK_INT >= 26) {
      val all = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (all.getNotificationChannel(CHANNEL) == null) all.createNotificationChannel(NotificationChannel(CHANNEL, "Reels being made", NotificationManager.IMPORTANCE_LOW))
      Notification.Builder(this, CHANNEL)
    } else @Suppress("DEPRECATION") Notification.Builder(this)
    return build.setContentTitle(title).setSmallIcon(android.R.drawable.stat_sys_upload).setOngoing(true).setContentIntent(open).build()
  }

  companion object {
    private const val NOTE = 4711; private const val CHANNEL = "shubix-work"; private const val TITLE = "title"
    private const val MAX_MS = 2 * 60 * 60 * 1000L
    fun start(context: Context, title: String) {
      val intent = Intent(context, ShubixWorkService::class.java).putExtra(TITLE, title)
      runCatching { if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent) }
    }
    fun stop(context: Context) { runCatching { context.stopService(Intent(context, ShubixWorkService::class.java)) } }
  }
}
