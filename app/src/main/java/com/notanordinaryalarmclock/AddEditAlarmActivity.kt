package com.notanordinaryalarmclock

import android.os.Bundle
import android.widget.NumberPicker
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.google.android.material.chip.Chip
import com.notanordinaryalarmclock.data.Alarm
import com.notanordinaryalarmclock.data.AlarmDatabase
import com.notanordinaryalarmclock.databinding.ActivityAddEditAlarmBinding
import com.notanordinaryalarmclock.util.AlarmSoundPlayer
import com.notanordinaryalarmclock.util.TimeFormat
import com.notanordinaryalarmclock.widget.AlarmWidgetProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Calendar

class AddEditAlarmActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAddEditAlarmBinding
    private val dao by lazy { AlarmDatabase.getInstance(this).alarmDao() }
    private var editingAlarm: Alarm? = null
    private var testPlayer: AlarmSoundPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAddEditAlarmBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setUpPickers()

        val alarmId = intent.getIntExtra(AlarmScheduler.EXTRA_ALARM_ID, -1)
        if (alarmId != -1) {
            binding.deleteButton.isVisible = true
            lifecycleScope.launch {
                editingAlarm = withContext(Dispatchers.IO) { dao.getById(alarmId) }
                editingAlarm?.let { populate(it) }
                updateDatePreview()
            }
        } else {
            setPickersToCurrentTime()
            updateDatePreview()
        }

        binding.saveButton.setOnClickListener { save() }
        binding.deleteButton.setOnClickListener { delete() }
        binding.testSoundRow.setOnClickListener { toggleTestSound() }

        val onPickerChanged = NumberPicker.OnValueChangeListener { _, _, _ -> updateDatePreview() }
        binding.hourPicker.setOnValueChangedListener(onPickerChanged)
        binding.minutePicker.setOnValueChangedListener(onPickerChanged)
        binding.amPmPicker.setOnValueChangedListener(onPickerChanged)
        for (chip in dayChips()) {
            chip.setOnCheckedChangeListener { _, _ -> updateDatePreview() }
        }
    }

    private fun setUpPickers() {
        binding.hourPicker.minValue = 1
        binding.hourPicker.maxValue = 12

        binding.minutePicker.minValue = 0
        binding.minutePicker.maxValue = 59
        binding.minutePicker.setFormatter { String.format("%02d", it) }

        binding.amPmPicker.minValue = 0
        binding.amPmPicker.maxValue = 1
        binding.amPmPicker.displayedValues = arrayOf("AM", "PM")
    }

    private fun setPickersToCurrentTime() {
        val now = Calendar.getInstance()
        applyHour24(now.get(Calendar.HOUR_OF_DAY))
        binding.minutePicker.value = now.get(Calendar.MINUTE)
    }

    private fun dayChips(): List<Chip> = listOf(
        binding.chipMon, binding.chipTue, binding.chipWed, binding.chipThu,
        binding.chipFri, binding.chipSat, binding.chipSun
    )

    private fun populate(alarm: Alarm) {
        applyHour24(alarm.hour)
        binding.minutePicker.value = alarm.minute
        binding.labelInput.setText(alarm.label)
        binding.vibrateSwitch.isChecked = alarm.vibrate
        val chips = dayChips()
        for (i in chips.indices) {
            chips[i].isChecked = (alarm.repeatDays and (1 shl i)) != 0
        }
    }

    /** Splits a 24-hour value across the 1-12 hour picker and the AM/PM picker. */
    private fun applyHour24(hour24: Int) {
        val isPm = hour24 >= 12
        val hour12 = when {
            hour24 == 0 -> 12
            hour24 > 12 -> hour24 - 12
            else -> hour24
        }
        binding.hourPicker.value = hour12
        binding.amPmPicker.value = if (isPm) 1 else 0
    }

    /** Combines the 1-12 hour picker and AM/PM picker back into a 24-hour value. */
    private fun currentHour24(): Int {
        val hour12 = binding.hourPicker.value
        val isPm = binding.amPmPicker.value == 1
        return when {
            hour12 == 12 && !isPm -> 0
            hour12 == 12 && isPm -> 12
            isPm -> hour12 + 12
            else -> hour12
        }
    }

    private fun collectRepeatMask(): Int {
        val chips = dayChips()
        var mask = 0
        for (i in chips.indices) if (chips[i].isChecked) mask = mask or (1 shl i)
        return mask
    }

    private fun updateDatePreview() {
        val previewAlarm = Alarm(
            hour = currentHour24(),
            minute = binding.minutePicker.value,
            repeatDays = collectRepeatMask()
        )
        val triggerMillis = AlarmScheduler.nextTriggerMillis(previewAlarm)
        binding.datePreviewText.text = TimeFormat.formatOneTimeDate(this, triggerMillis)
    }

    private fun save() {
        val alarm = Alarm(
            id = editingAlarm?.id ?: 0,
            hour = currentHour24(),
            minute = binding.minutePicker.value,
            label = binding.labelInput.text?.toString().orEmpty(),
            repeatDays = collectRepeatMask(),
            enabled = true,
            vibrate = binding.vibrateSwitch.isChecked
        )
        lifecycleScope.launch(Dispatchers.IO) {
            val newId = dao.upsert(alarm)
            val saved = if (alarm.id == 0) alarm.copy(id = newId.toInt()) else alarm
            AlarmScheduler.schedule(this@AddEditAlarmActivity, saved)
            AlarmWidgetProvider.requestUpdate(this@AddEditAlarmActivity)
            withContext(Dispatchers.Main) { finish() }
        }
    }

    private fun delete() {
        val alarm = editingAlarm ?: return
        lifecycleScope.launch(Dispatchers.IO) {
            AlarmScheduler.cancel(this@AddEditAlarmActivity, alarm)
            dao.delete(alarm)
            AlarmWidgetProvider.requestUpdate(this@AddEditAlarmActivity)
            withContext(Dispatchers.Main) { finish() }
        }
    }

    private fun toggleTestSound() {
        val running = testPlayer
        if (running == null) {
            testPlayer = AlarmSoundPlayer().also { it.start() }
            binding.soundDescText.setText(R.string.stop_test)
        } else {
            running.stop()
            testPlayer = null
            binding.soundDescText.setText(R.string.sound_row_desc)
        }
    }

    override fun onDestroy() {
        testPlayer?.stop()
        super.onDestroy()
    }
}
