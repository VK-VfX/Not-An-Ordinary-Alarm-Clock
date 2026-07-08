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
import android.view.Menu
import android.view.MenuItem
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import com.notanordinaryalarmclock.data.Alarm
import com.notanordinaryalarmclock.data.AlarmDatabase
import com.notanordinaryalarmclock.databinding.ActivityMainBinding
import com.notanordinaryalarmclock.util.TimeFormat
import com.notanordinaryalarmclock.widget.AlarmWidgetProvider
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
            onClick = { alarm -> openEditor(alarm.id) }
        )
        binding.alarmList.layoutManager = LinearLayoutManager(this)
        binding.alarmList.adapter = adapter
        attachSwipeToDelete()

        lifecycleScope.launch {
            dao.getAllFlow().collect { alarms ->
                adapter.submitList(alarms)
                binding.emptyView.isVisible = alarms.isEmpty()
                updateNextAlarmCard(alarms)
            }
        }

        requestNecessaryPermissions()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.menu_main, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        when (item.itemId) {
            R.id.action_add -> openEditor(-1)
            R.id.action_settings -> startActivity(Intent(this, SettingsActivity::class.java))
            R.id.action_tips -> showTipsDialog()
            else -> return super.onOptionsItemSelected(item)
        }
        return true
    }

    private fun showTipsDialog() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.tips_title)
            .setMessage(R.string.tips_body)
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }

    private fun attachSwipeToDelete() {
        val callback = object : ItemTouchHelper.SimpleCallback(0, ItemTouchHelper.START or ItemTouchHelper.END) {
            override fun onMove(
                recyclerView: RecyclerView,
                viewHolder: RecyclerView.ViewHolder,
                target: RecyclerView.ViewHolder
            ) = false

            override fun onSwiped(viewHolder: RecyclerView.ViewHolder, direction: Int) {
                val position = viewHolder.bindingAdapterPosition
                if (position == RecyclerView.NO_POSITION) return
                val alarm = adapter.currentList[position]
                deleteWithUndo(alarm)
            }
        }
        ItemTouchHelper(callback).attachToRecyclerView(binding.alarmList)
    }

    private fun deleteWithUndo(alarm: Alarm) {
        lifecycleScope.launch(Dispatchers.IO) {
            AlarmScheduler.cancel(this@MainActivity, alarm)
            dao.delete(alarm)
            AlarmWidgetProvider.requestUpdate(this@MainActivity)
        }
        Snackbar.make(binding.root, R.string.alarm_deleted, Snackbar.LENGTH_LONG)
            .setAction(R.string.undo) {
                lifecycleScope.launch(Dispatchers.IO) {
                    val restoredId = dao.upsert(alarm.copy(id = 0))
                    val restored = alarm.copy(id = restoredId.toInt())
                    if (restored.enabled) AlarmScheduler.schedule(this@MainActivity, restored)
                    AlarmWidgetProvider.requestUpdate(this@MainActivity)
                }
            }
            .show()
    }

    private fun updateNextAlarmCard(alarms: List<Alarm>) {
        val next = alarms.filter { it.enabled }.minByOrNull { AlarmScheduler.nextTriggerMillis(it) }
        if (next == null) {
            binding.nextAlarmCard.isVisible = false
            return
        }
        val triggerMillis = AlarmScheduler.nextTriggerMillis(next)
        binding.nextAlarmCard.isVisible = true
        binding.nextAlarmTime.text = TimeFormat.formatClockTime(this, triggerMillis)
        val countdown = TimeFormat.formatCountdown(this, triggerMillis)
        val days = TimeFormat.formatDayLabels(next.repeatDays)
        binding.nextAlarmSubtitle.text = if (days.isEmpty()) countdown else "$countdown · $days"
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
            AlarmWidgetProvider.requestUpdate(this@MainActivity)
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
