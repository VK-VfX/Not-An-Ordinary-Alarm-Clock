package com.notanordinaryalarmclock.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "alarms")
data class Alarm(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val hour: Int,
    val minute: Int,
    val label: String = "",
    /** Bitmask, bit0=Monday .. bit6=Sunday. 0 means a one-time alarm. */
    val repeatDays: Int = 0,
    val enabled: Boolean = true,
    val vibrate: Boolean = true
)
