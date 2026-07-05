package com.notanordinaryalarmclock

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.view.isVisible
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.notanordinaryalarmclock.data.Alarm
import com.notanordinaryalarmclock.databinding.ItemAlarmBinding
import java.util.Locale

class AlarmAdapter(
    private val onToggle: (Alarm, Boolean) -> Unit,
    private val onClick: (Alarm) -> Unit,
    private val onDelete: (Alarm) -> Unit
) : ListAdapter<Alarm, AlarmAdapter.ViewHolder>(DIFF) {

    inner class ViewHolder(val binding: ItemAlarmBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemAlarmBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val alarm = getItem(position)
        val binding = holder.binding

        binding.timeText.text = String.format(Locale.getDefault(), "%02d:%02d", alarm.hour, alarm.minute)
        binding.labelText.text = alarm.label
        binding.labelText.isVisible = alarm.label.isNotBlank()
        binding.daysText.text = formatDays(alarm.repeatDays)

        binding.enabledSwitch.setOnCheckedChangeListener(null)
        binding.enabledSwitch.isChecked = alarm.enabled
        binding.enabledSwitch.setOnCheckedChangeListener { _, checked -> onToggle(alarm, checked) }

        binding.root.setOnClickListener { onClick(alarm) }
        binding.deleteButton.setOnClickListener { onDelete(alarm) }
    }

    private fun formatDays(mask: Int): String {
        if (mask == 0) return "One time"
        val names = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
        return names.filterIndexed { index, _ -> (mask and (1 shl index)) != 0 }.joinToString(" ")
    }

    companion object {
        val DIFF = object : DiffUtil.ItemCallback<Alarm>() {
            override fun areItemsTheSame(oldItem: Alarm, newItem: Alarm) = oldItem.id == newItem.id
            override fun areContentsTheSame(oldItem: Alarm, newItem: Alarm) = oldItem == newItem
        }
    }
}
