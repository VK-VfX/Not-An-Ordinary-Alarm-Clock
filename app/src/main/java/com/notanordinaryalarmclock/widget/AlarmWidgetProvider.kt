package com.notanordinaryalarmclock.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.RemoteViews
import com.notanordinaryalarmclock.AlarmScheduler
import com.notanordinaryalarmclock.MainActivity
import com.notanordinaryalarmclock.R
import com.notanordinaryalarmclock.data.AlarmDatabase
import com.notanordinaryalarmclock.util.TimeFormat
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Home-screen widget showing the live time and the next scheduled alarm. Refreshed both by
 * the system's periodic schedule and on-demand via [requestUpdate] whenever alarms change.
 */
class AlarmWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val pendingResult = goAsync()
        Thread {
            try {
                refreshAll(context)
            } finally {
                pendingResult.finish()
            }
        }.start()
    }

    companion object {
        private const val TAG = "AlarmWidgetProvider"

        /** Safe to call from any background thread; does its own blocking DB read. */
        fun requestUpdate(context: Context) = refreshAll(context)

        private fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, AlarmWidgetProvider::class.java))
            if (ids.isEmpty()) return

            val views = buildViews(context)
            ids.forEach { id ->
                runCatching { manager.updateAppWidget(id, views) }
                    .onFailure { Log.w(TAG, "Failed to update widget $id", it) }
            }
        }

        private fun buildViews(context: Context): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_alarm_clock)
            views.setTextViewText(
                R.id.widgetDate,
                SimpleDateFormat("EEE, MMM d", Locale.getDefault()).format(System.currentTimeMillis())
            )
            views.setTextViewText(R.id.widgetTime, TimeFormat.formatClockTime(context, System.currentTimeMillis()))

            val nextAlarmText = runCatching {
                val alarms = AlarmDatabase.getInstance(context).alarmDao().getAllBlocking()
                val next = alarms.filter { it.enabled }.minByOrNull { AlarmScheduler.nextTriggerMillis(it) }
                if (next != null) {
                    val triggerMillis = AlarmScheduler.nextTriggerMillis(next)
                    context.getString(R.string.next_alarm) + " " + TimeFormat.formatClockTime(context, triggerMillis)
                } else {
                    context.getString(R.string.widget_no_alarms)
                }
            }.getOrElse {
                Log.w(TAG, "Failed to read alarms for widget", it)
                context.getString(R.string.widget_no_alarms)
            }
            views.setTextViewText(R.id.widgetNextAlarm, nextAlarmText)

            val openAppIntent = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widgetRoot, openAppIntent)
            return views
        }
    }
}
