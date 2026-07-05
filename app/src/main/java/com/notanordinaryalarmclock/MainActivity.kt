package com.notanordinaryalarmclock

import android.Manifest
import android.app.AlarmManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.notanordinaryalarmclock.data.Alarm
import com.notanordinaryalarmclock.data.AlarmDatabase
import com.notanordinaryalarmclock.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: AlarmAdapter
    private val dao by lazy { AlarmDatabase.getInstance(this).alarmDao() }

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)

        adapter = AlarmAdapter(
            onToggle = ::onToggleAlarm,
            onClick = { alarm -> openEditor(alarm.id) },
            onDelete = ::onDeleteAlarm
        )
        binding.alarmList.layoutManager = LinearLayoutManager(this)
        binding.alarmList.adapter = adapter

        binding.addAlarmFab.setOnClickListener { openEditor(-1) }

        lifecycleScope.launch {
            dao.getAllFlow().collect { alarms ->
                adapter.submitList(alarms)
                binding.emptyView.isVisible = alarms.isEmpty()
            }
        }

        requestNecessaryPermissions()
    }

    private fun openEditor(alarmId: Int) {
        startActivity(Intent(this, AddEditAlarmActivity::class.java).apply {
            putExtra(AlarmScheduler.EXTRA_ALARM_ID, alarmId)
        })
    }

    private fun onToggleAlarm(alarm: Alarm, enabled: Boolean) {
        lifecycleScope.launch(Dispatchers.IO) {
            val updated = alarm.copy(enabled = enabled)
            dao.upsert(updated)
            if (enabled) AlarmScheduler.schedule(this@MainActivity, updated)
            else AlarmScheduler.cancel(this@MainActivity, updated)
        }
    }

    private fun onDeleteAlarm(alarm: Alarm) {
        lifecycleScope.launch(Dispatchers.IO) {
            AlarmScheduler.cancel(this@MainActivity, alarm)
            dao.delete(alarm)
        }
    }

    private fun requestNecessaryPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            if (granted != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val alarmManager = getSystemService(ALARM_SERVICE) as AlarmManager
            if (!alarmManager.canScheduleExactAlarms()) {
                startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM))
            }
        }

        val powerManager = getSystemService(POWER_SERVICE) as PowerManager
        if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
            try {
                startActivity(
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                )
            } catch (_: ActivityNotFoundException) {
                // Some OEM builds omit this settings screen; the alarm still works without it.
            }
        }
    }
}
