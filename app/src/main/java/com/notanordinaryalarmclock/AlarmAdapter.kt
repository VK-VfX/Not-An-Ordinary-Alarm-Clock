package com.notanordinaryalarmclock

import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.notanordinaryalarmclock.data.Alarm
import com.notanordinaryalarmclock.databinding.ItemAlarmBinding
import com.notanordinaryalarmclock.util.TimeFormat

class AlarmAdapter(
    private val onToggle: (Alarm, Boolean) -> Unit,
    private val onClick: (Alarm) -> Unit
) : ListAdapter<Alarm, AlarmAdapter.ViewHolder>(DIFF) {

    inner class ViewHolder(val binding: ItemAlarmBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemAlarmBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val alarm = getItem(position)
        val binding = holder.binding
        val context = binding.root.context

        binding.timeText.text = TimeFormat.formatClockTime(context, alarm.hour, alarm.minute)
        binding.timeText.alpha = if (alarm.enabled) 1f else 0.4f
        binding.labelText.text = alarm.label
        binding.labelText.isVisible = alarm.label.isNotBlank()

        if (alarm.repeatDays == 0) {
            binding.oneTimeDateText.isVisible = true
            binding.dayRow.isVisible = false
            val triggerMillis = AlarmScheduler.nextTriggerMillis(alarm)
            binding.oneTimeDateText.text = TimeFormat.formatOneTimeDate(context, triggerMillis)
        } else {
            binding.oneTimeDateText.isVisible = false
            binding.dayRow.isVisible = true
            bindDayRow(binding, alarm.repeatDays)
        }

        binding.enabledSwitch.setOnCheckedChangeListener(null)
        binding.enabledSwitch.isChecked = alarm.enabled
        binding.enabledSwitch.setOnCheckedChangeListener { _, checked -> onToggle(alarm, checked) }

        binding.root.setOnClickListener { onClick(alarm) }
    }

    /** bit0=Monday .. bit6=Sunday; the row itself is displayed Sunday-first, Sunday always accented. */
    private fun bindDayRow(binding: ItemAlarmBinding, repeatDays: Int) {
        val context = binding.root.context
        val accent = ContextCompat.getColor(context, R.color.brand_primary)
        val active = ContextCompat.getColor(context, R.color.app_on_surface)
        val inactive = ContextCompat.getColor(context, R.color.app_on_surface_variant)

        val cells: List<Pair<TextView, Int>> = listOf(
            binding.daySun to 6,
            binding.dayMon to 0,
            binding.dayTue to 1,
            binding.dayWed to 2,
            binding.dayThu to 3,
            binding.dayFri to 4,
            binding.daySat to 5
        )
        for ((view, bit) in cells) {
            val isOn = (repeatDays and (1 shl bit)) != 0
            val isSunday = bit == 6
            view.setTextColor(
                when {
                    isSunday -> accent
                    isOn -> active
                    else -> inactive
                }
            )
            view.alpha = if (isOn || isSunday) 1f else 0.5f
        }
    }

    companion object {
        val DIFF = object : DiffUtil.ItemCallback<Alarm>() {
            override fun areItemsTheSame(oldItem: Alarm, newItem: Alarm) = oldItem.id == newItem.id
            override fun areContentsTheSame(oldItem: Alarm, newItem: Alarm) = oldItem == newItem
        }
    }
}
