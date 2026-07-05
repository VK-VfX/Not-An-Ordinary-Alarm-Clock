package com.notanordinaryalarmclock.util

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import kotlin.math.sin

/**
 * Synthesizes a harsh, sweeping siren tone directly on the ALARM stream instead of
 * bundling a licensed audio asset. The frequency sweep (600Hz-1400Hz) is deliberately
 * piercing so it cuts through sleep and ambient noise.
 */
class AlarmSoundPlayer {

    @Volatile private var playing = false
    private var audioTrack: AudioTrack? = null
    private var playThread: Thread? = null

    fun start() {
        if (playing) return
        playing = true
        playThread = Thread(::playSiren, "AlarmSirenThread").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        playing = false
        playThread?.join(500)
        playThread = null
        audioTrack?.let {
            runCatching { it.stop() }
            runCatching { it.release() }
        }
        audioTrack = null
    }

    private fun playSiren() {
        val sampleRate = 44100
        val minBuffer = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(4096)

        val track = AudioTrack(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
            AudioFormat.Builder()
                .setSampleRate(sampleRate)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build(),
            minBuffer,
            AudioTrack.MODE_STREAM,
            AudioManager.AUDIO_SESSION_ID_GENERATE
        )
        audioTrack = track
        track.play()

        val buffer = ShortArray(minBuffer / 2)
        var phase = 0.0
        var sweepPhase = 0.0
        val sweepSpeed = 2.0 * Math.PI * 0.6 / sampleRate

        while (playing) {
            val freq = 1000.0 + 400.0 * sin(sweepPhase)
            for (i in buffer.indices) {
                phase += 2.0 * Math.PI * freq / sampleRate
                buffer[i] = (Short.MAX_VALUE * 0.95 * sin(phase)).toInt().toShort()
                sweepPhase += sweepSpeed
            }
            track.write(buffer, 0, buffer.size)
        }

        runCatching { track.stop() }
        runCatching { track.release() }
    }
}
