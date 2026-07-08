package com.notanordinaryalarmclock

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.IBinder
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import com.notanordinaryalarmclock.data.AlarmDatabase
import com.notanordinaryalarmclock.util.AlarmSoundPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class AlarmService : Service() {

    private val serviceScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private var wakeLock: PowerManager.WakeLock? = null
    private var soundPlayer: AlarmSoundPlayer? = null
    private var vibrator: Vibrator? = null
    private var volumeEscalationJob: Job? = null
    private var alarmId: Int = -1
    private var audioFocusRequest: AudioFocusRequest? = null

    override fun onCreate() {
        super.onCreate()
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "NotAnOrdinaryAlarmClock:AlarmWakeLock"
        ).apply { acquire(10 * 60 * 1000L) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        alarmId = intent?.getIntExtra(AlarmScheduler.EXTRA_ALARM_ID, -1) ?: -1
        startForeground(NOTIFICATION_ID, buildNotification())

        val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        audioManager.setStreamVolume(AudioManager.STREAM_ALARM, maxVolume, 0)
        requestAudioFocus(audioManager)

        serviceScope.launch(Dispatchers.IO) {
            val vibrate = alarmId.takeIf { it != -1 }
                ?.let { AlarmDatabase.getInstance(applicationContext).alarmDao().getById(it) }
                ?.vibrate ?: true
            if (vibrate) startVibration()
        }

        soundPlayer = AlarmSoundPlayer().also { it.start() }
        escalateVolume(audioManager, maxVolume)

        return START_STICKY
    }

    /**
     * STREAM_ALARM already plays regardless of ringer mode, but grabbing transient focus
     * signals other apps (music, podcasts) to duck or pause, so the siren isn't competing
     * with whatever the phone was already playing.
     */
    private fun requestAudioFocus(audioManager: AudioManager) {
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(attributes)
            .setWillPauseWhenDucked(false)
            .build()
        audioFocusRequest = request
        audioManager.requestAudioFocus(request)
    }

    private fun buildNotification(): Notification {
        val fullScreenIntent = Intent(this, AlarmRingActivity::class.java).apply {
            putExtra(AlarmScheduler.EXTRA_ALARM_ID, alarmId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION
        }
        val fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            alarmId,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, AlarmApp.ALARM_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_alarm)
            .setContentTitle(getString(R.string.wake_up))
            .setContentText(getString(R.string.alarm_ringing))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setContentIntent(fullScreenPendingIntent)
            .setOngoing(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
    }

    /**
     * Tight, max-amplitude pulses rather than a gentle buzz-pause-buzz — the short gaps and
     * forced full amplitude make this read as an insistent, hard vibration.
     */
    private fun startVibration() {
        vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        val timings = longArrayOf(0, 350, 120, 350, 120, 350, 500)
        val amplitudes = intArrayOf(0, 255, 0, 255, 0, 255, 0)
        vibrator?.vibrate(VibrationEffect.createWaveform(timings, amplitudes, 0))
    }

    /**
     * Starts loud (65% of max) rather than a gentle ramp from near-silent, since the goal is
     * a guaranteed wake-up, then climbs to full volume within ~10 seconds.
     */
    private fun escalateVolume(audioManager: AudioManager, maxVolume: Int) {
        volumeEscalationJob = serviceScope.launch {
            var current = (maxVolume * 0.65f).toInt().coerceAtLeast(1)
            audioManager.setStreamVolume(AudioManager.STREAM_ALARM, current, 0)
            while (isActive && current < maxVolume) {
                delay(2000)
                current = (current + 1).coerceAtMost(maxVolume)
                audioManager.setStreamVolume(AudioManager.STREAM_ALARM, current, 0)
            }
        }
    }

    override fun onDestroy() {
        volumeEscalationJob?.cancel()
        soundPlayer?.stop()
        vibrator?.cancel()
        wakeLock?.let { if (it.isHeld) it.release() }
        audioFocusRequest?.let {
            (getSystemService(Context.AUDIO_SERVICE) as AudioManager).abandonAudioFocusRequest(it)
        }
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val NOTIFICATION_ID = 42
    }
}
