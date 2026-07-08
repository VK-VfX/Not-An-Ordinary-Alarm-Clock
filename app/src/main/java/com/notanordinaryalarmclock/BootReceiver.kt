package com.notanordinaryalarmclock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.notanordinaryalarmclock.data.AlarmDatabase
import com.notanordinaryalarmclock.widget.AlarmWidgetProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val dao = AlarmDatabase.getInstance(context).alarmDao()
                dao.getAll().filter { it.enabled }.forEach { AlarmScheduler.schedule(context, it) }
                AlarmWidgetProvider.requestUpdate(context)
            } finally {
                pendingResult.finish()
            }
        }
    }
}
