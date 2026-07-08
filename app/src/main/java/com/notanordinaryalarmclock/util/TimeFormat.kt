package com.notanordinaryalarmclock.util

import android.content.Context
import android.text.format.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

object TimeFormat {

    fun formatClockTime(context: Context, hour: Int, minute: Int): String {
        val calendar = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
        }
        val pattern = if (DateFormat.is24HourFormat(context)) "HH:mm" else "h:mm a"
        return SimpleDateFormat(pattern, Locale.getDefault()).format(calendar.time)
    }

    fun formatClockTime(context: Context, epochMillis: Long): String {
        val pattern = if (DateFormat.is24HourFormat(context)) "HH:mm" else "h:mm a"
        return SimpleDateFormat(pattern, Locale.getDefault()).format(epochMillis)
    }

    fun formatDayLabels(mask: Int): String {
        if (mask == 0) return ""
        val names = listOf("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
        return names.filterIndexed { index, _ -> (mask and (1 shl index)) != 0 }.joinToString(" · ")
    }

    fun formatCountdown(context: Context, triggerMillis: Long): String {
        val diffMinutes = ((triggerMillis - System.currentTimeMillis()).coerceAtLeast(0)) / 60_000
        val hours = diffMinutes / 60
        val minutes = diffMinutes % 60
        return if (hours > 0) {
            context.getString(com.notanordinaryalarmclock.R.string.rings_in_hours_minutes, hours.toInt(), minutes.toInt())
        } else {
            context.getString(com.notanordinaryalarmclock.R.string.rings_in_minutes, minutes.toInt())
        }
    }
}
