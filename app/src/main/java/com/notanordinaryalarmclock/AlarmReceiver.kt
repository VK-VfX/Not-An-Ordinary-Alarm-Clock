package com.notanordinaryalarmclock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.notanordinaryalarmclock.data.AlarmDatabase
import com.notanordinaryalarmclock.widget.AlarmWidgetProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val alarmId = intent.getIntExtra(AlarmScheduler.EXTRA_ALARM_ID, -1)
        if (alarmId == -1) return

        val serviceIntent = Intent(context, AlarmService::class.java).apply {
            putExtra(AlarmScheduler.EXTRA_ALARM_ID, alarmId)
        }
        context.startForegroundService(serviceIntent)

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val dao = AlarmDatabase.getInstance(context).alarmDao()
                val alarm = dao.getById(alarmId)
                if (alarm != null && alarm.enabled && alarm.repeatDays != 0) {
                    AlarmScheduler.schedule(context, alarm)
                }
                AlarmWidgetProvider.requestUpdate(context)
            } finally {
                pendingResult.finish()
            }
        }
    }
}
