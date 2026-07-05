package com.notanordinaryalarmclock

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.notanordinaryalarmclock.data.AlarmDatabase
import com.notanordinaryalarmclock.databinding.ActivityAlarmRingBinding
import com.notanordinaryalarmclock.util.MathChallenge
import com.notanordinaryalarmclock.util.MathProblem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AlarmRingActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAlarmRingBinding
    private var currentProblem: MathProblem = MathChallenge.generate()
    private var problemsSolved = 0
    private var snoozesLeft = 2
    private val problemsRequired = 3
    private var alarmId = -1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()

        binding = ActivityAlarmRingBinding.inflate(layoutInflater)
        setContentView(binding.root)

        alarmId = intent.getIntExtra(AlarmScheduler.EXTRA_ALARM_ID, -1)

        binding.answerInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                checkAnswer()
                true
            } else {
                false
            }
        }
        binding.submitButton.setOnClickListener { checkAnswer() }
        binding.snoozeButton.setOnClickListener { snooze() }
        binding.dismissDirectButton.setOnClickListener { finishAlarm() }

        lifecycleScope.launch {
            val alarm = withContext(Dispatchers.IO) {
                AlarmDatabase.getInstance(this@AlarmRingActivity).alarmDao().getById(alarmId)
            }
            binding.labelText.text = alarm?.label?.takeIf { it.isNotBlank() } ?: getString(R.string.wake_up)
            binding.snoozeButton.isVisible = alarm?.snoozeEnabled != false

            if (alarm?.mathChallenge == false) {
                binding.challengeGroup.isVisible = false
                binding.dismissDirectButton.isVisible = true
            } else {
                showNextProblem()
            }
        }
    }

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.addFlags(
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        )
        val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        keyguardManager.requestDismissKeyguard(this, null)
    }

    private fun showNextProblem() {
        currentProblem = MathChallenge.generate()
        binding.questionText.text = getString(R.string.solve_to_dismiss, currentProblem.question)
        binding.answerInput.text?.clear()
        binding.progressText.text = getString(R.string.problem_progress, problemsSolved + 1, problemsRequired)
    }

    private fun checkAnswer() {
        val input = binding.answerInput.text?.toString()?.toIntOrNull()
        if (input != null && input == currentProblem.answer) {
            problemsSolved++
            if (problemsSolved >= problemsRequired) {
                finishAlarm()
            } else {
                showNextProblem()
            }
        } else {
            binding.answerInput.text?.clear()
            binding.answerInput.error = getString(R.string.try_again)
        }
    }

    private fun snooze() {
        if (snoozesLeft <= 0 || alarmId == -1) return
        snoozesLeft--
        AlarmScheduler.scheduleSnooze(this, alarmId, minutesFromNow = 5)
        stopService(Intent(this, AlarmService::class.java))
        finishAndRemoveTask()
    }

    private fun finishAlarm() {
        stopService(Intent(this, AlarmService::class.java))
        finishAndRemoveTask()
    }

    @Suppress("OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        // Intentionally blocked: the alarm can only be dismissed via the challenge/buttons.
    }
}
