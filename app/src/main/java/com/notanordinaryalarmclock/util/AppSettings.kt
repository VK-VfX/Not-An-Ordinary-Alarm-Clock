package com.notanordinaryalarmclock.util

import android.content.Context

/** Small SharedPreferences wrapper for app-wide (not per-alarm) preferences. */
object AppSettings {

    private const val PREFS_NAME = "naoac_settings"
    private const val KEY_REQUIRE_MATH_CHALLENGE = "require_math_challenge"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Whether ringing alarms require solving a math problem to dismiss. Defaults to true. */
    fun isMathChallengeRequired(context: Context): Boolean =
        prefs(context).getBoolean(KEY_REQUIRE_MATH_CHALLENGE, true)

    fun setMathChallengeRequired(context: Context, required: Boolean) {
        prefs(context).edit().putBoolean(KEY_REQUIRE_MATH_CHALLENGE, required).apply()
    }
}
