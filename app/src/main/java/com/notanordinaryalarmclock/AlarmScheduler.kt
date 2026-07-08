package com.notanordinaryalarmclock

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.notanordinaryalarmclock.data.Alarm
import java.util.Calendar

object AlarmScheduler {

    const val EXTRA_ALARM_ID = "extra_alarm_id"

    fun schedule(context: Context, alarm: Alarm) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val triggerAt = nextTriggerMillis(alarm)
        val pendingIntent = buildPendingIntent(context, alarm.id)
        alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, pendingIntent), pendingIntent)
    }

    fun cancel(context: Context, alarm: Alarm) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarmManager.cancel(buildPendingIntent(context, alarm.id))
    }

    private fun buildPendingIntent(context: Context, alarmId: Int): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            putExtra(EXTRA_ALARM_ID, alarmId)
        }
        return PendingIntent.getBroadcast(
            context,
            alarmId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /**
     * Repeat-day bitmask uses bit0=Monday .. bit6=Sunday, so it must be converted
     * from java.util.Calendar's Sunday-indexed DAY_OF_WEEK constants.
     */
    fun nextTriggerMillis(alarm: Alarm): Long {
        val now = Calendar.getInstance()
        val target = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, alarm.hour)
            set(Calendar.MINUTE, alarm.minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        if (alarm.repeatDays == 0) {
            if (!target.after(now)) target.add(Calendar.DAY_OF_YEAR, 1)
            return target.timeInMillis
        }

        for (offset in 0..7) {
            val candidate = target.clone() as Calendar
            candidate.add(Calendar.DAY_OF_YEAR, offset)
            val bit = calendarDayToBit(candidate.get(Calendar.DAY_OF_WEEK))
            val repeatsOnThisDay = (alarm.repeatDays and (1 shl bit)) != 0
            if (repeatsOnThisDay && candidate.after(now)) {
                return candidate.timeInMillis
            }
        }
        return target.timeInMillis
    }

    private fun calendarDayToBit(calendarDay: Int): Int = when (calendarDay) {
        Calendar.MONDAY -> 0
        Calendar.TUESDAY -> 1
        Calendar.WEDNESDAY -> 2
        Calendar.THURSDAY -> 3
        Calendar.FRIDAY -> 4
        Calendar.SATURDAY -> 5
        else -> 6 // Calendar.SUNDAY
    }
}
