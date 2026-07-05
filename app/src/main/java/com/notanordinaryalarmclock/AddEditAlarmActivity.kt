package com.notanordinaryalarmclock

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.google.android.material.chip.Chip
import com.notanordinaryalarmclock.data.Alarm
import com.notanordinaryalarmclock.data.AlarmDatabase
import com.notanordinaryalarmclock.databinding.ActivityAddEditAlarmBinding
import com.notanordinaryalarmclock.util.AlarmSoundPlayer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AddEditAlarmActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAddEditAlarmBinding
    private val dao by lazy { AlarmDatabase.getInstance(this).alarmDao() }
    private var editingAlarm: Alarm? = null
    private var testPlayer: AlarmSoundPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAddEditAlarmBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.timePicker.setIs24HourView(true)

        val alarmId = intent.getIntExtra(AlarmScheduler.EXTRA_ALARM_ID, -1)
        if (alarmId != -1) {
            binding.deleteButton.isVisible = true
            lifecycleScope.launch {
                editingAlarm = withContext(Dispatchers.IO) { dao.getById(alarmId) }
                editingAlarm?.let { populate(it) }
            }
        }

        binding.saveButton.setOnClickListener { save() }
        binding.deleteButton.setOnClickListener { delete() }
        binding.testSoundButton.setOnClickListener { toggleTestSound() }
    }

    private fun dayChips(): List<Chip> = listOf(
        binding.chipMon, binding.chipTue, binding.chipWed, binding.chipThu,
        binding.chipFri, binding.chipSat, binding.chipSun
    )

    private fun populate(alarm: Alarm) {
        binding.timePicker.hour = alarm.hour
        binding.timePicker.minute = alarm.minute
        binding.labelInput.setText(alarm.label)
        binding.vibrateSwitch.isChecked = alarm.vibrate
        binding.mathChallengeSwitch.isChecked = alarm.mathChallenge
        binding.snoozeSwitch.isChecked = alarm.snoozeEnabled
        val chips = dayChips()
        for (i in chips.indices) {
            chips[i].isChecked = (alarm.repeatDays and (1 shl i)) != 0
        }
    }

    private fun collectRepeatMask(): Int {
        val chips = dayChips()
        var mask = 0
        for (i in chips.indices) if (chips[i].isChecked) mask = mask or (1 shl i)
        return mask
    }

    private fun save() {
        val alarm = Alarm(
            id = editingAlarm?.id ?: 0,
            hour = binding.timePicker.hour,
            minute = binding.timePicker.minute,
            label = binding.labelInput.text?.toString().orEmpty(),
            repeatDays = collectRepeatMask(),
            enabled = true,
            vibrate = binding.vibrateSwitch.isChecked,
            mathChallenge = binding.mathChallengeSwitch.isChecked,
            snoozeEnabled = binding.snoozeSwitch.isChecked
        )
        lifecycleScope.launch(Dispatchers.IO) {
            val newId = dao.upsert(alarm)
            val saved = if (alarm.id == 0) alarm.copy(id = newId.toInt()) else alarm
            AlarmScheduler.schedule(this@AddEditAlarmActivity, saved)
            withContext(Dispatchers.Main) { finish() }
        }
    }

    private fun delete() {
        val alarm = editingAlarm ?: return
        lifecycleScope.launch(Dispatchers.IO) {
            AlarmScheduler.cancel(this@AddEditAlarmActivity, alarm)
            dao.delete(alarm)
            withContext(Dispatchers.Main) { finish() }
        }
    }

    private fun toggleTestSound() {
        val running = testPlayer
        if (running == null) {
            testPlayer = AlarmSoundPlayer().also { it.start() }
            binding.testSoundButton.setText(R.string.stop_test)
        } else {
            running.stop()
            testPlayer = null
            binding.testSoundButton.setText(R.string.test_sound)
        }
    }

    override fun onDestroy() {
        testPlayer?.stop()
        super.onDestroy()
    }
}
