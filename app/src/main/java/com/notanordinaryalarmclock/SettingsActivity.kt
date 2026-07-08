package com.notanordinaryalarmclock

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.notanordinaryalarmclock.databinding.ActivitySettingsBinding
import com.notanordinaryalarmclock.util.AppSettings

class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)
        binding.toolbar.setNavigationOnClickListener { finish() }

        binding.mathChallengeSwitch.isChecked = AppSettings.isMathChallengeRequired(this)
        binding.mathChallengeSwitch.setOnCheckedChangeListener { _, checked ->
            AppSettings.setMathChallengeRequired(this, checked)
        }

        binding.versionText.text = getString(
            R.string.about_version_format,
            BuildConfig.VERSION_NAME,
            BuildConfig.VERSION_CODE
        )

        binding.checkForUpdatesRow.setOnClickListener {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(RELEASES_URL))
            startActivity(intent)
        }
    }

    companion object {
        private const val RELEASES_URL = "https://github.com/VK-VfX/Not-An-Ordinary-Alarm-Clock/releases"
    }
}
