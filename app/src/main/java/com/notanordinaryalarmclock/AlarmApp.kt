package com.notanordinaryalarmclock

import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager

class AlarmApp : Application() {

    override fun onCreate() {
        super.onCreate()
        val channel = NotificationChannel(
            ALARM_CHANNEL_ID,
            getString(R.string.alarm_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = getString(R.string.alarm_channel_desc)
            enableVibration(true)
            setBypassDnd(true)
            setSound(null, null)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        const val ALARM_CHANNEL_ID = "alarm_channel"
    }
}
