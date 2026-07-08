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

    /** "Today — Jul 9" / "Tomorrow — Jul 10" / "Thu, Jul 11" for a one-time alarm's date. */
    fun formatOneTimeDate(context: Context, triggerMillis: Long): String {
        val now = Calendar.getInstance()
        val target = Calendar.getInstance().apply { timeInMillis = triggerMillis }
        val dayGap = daysBetween(now, target)
        val dateOnly = SimpleDateFormat("MMM d", Locale.getDefault()).format(target.time)
        return when (dayGap) {
            0 -> context.getString(com.notanordinaryalarmclock.R.string.date_preview_today, dateOnly)
            1 -> context.getString(com.notanordinaryalarmclock.R.string.date_preview_tomorrow, dateOnly)
            else -> SimpleDateFormat("EEE, MMM d", Locale.getDefault()).format(target.time)
        }
    }

    private fun daysBetween(from: Calendar, to: Calendar): Int {
        val start = from.clone() as Calendar
        start.set(Calendar.HOUR_OF_DAY, 0)
        start.set(Calendar.MINUTE, 0)
        start.set(Calendar.SECOND, 0)
        start.set(Calendar.MILLISECOND, 0)
        val end = to.clone() as Calendar
        end.set(Calendar.HOUR_OF_DAY, 0)
        end.set(Calendar.MINUTE, 0)
        end.set(Calendar.SECOND, 0)
        end.set(Calendar.MILLISECOND, 0)
        val diffMillis = end.timeInMillis - start.timeInMillis
        return (diffMillis / (24 * 60 * 60 * 1000L)).toInt()
    }
}
