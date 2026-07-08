package com.notanordinaryalarmclock.util

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import kotlin.math.sin

/**
 * Synthesizes a harsh, sweeping siren tone directly on the ALARM stream instead of
 * bundling a licensed audio asset. A fundamental sweep (550Hz-1450Hz) is layered with a
 * quieter x1.5 overtone and soft-clipped, which makes the tone read as buzzy/piercing
 * rather than a clean tone — deliberately unpleasant so it cuts through sleep.
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
        val sweepSpeed = 2.0 * Math.PI * 0.8 / sampleRate

        while (playing) {
            val freq = 1000.0 + 450.0 * sin(sweepPhase)
            for (i in buffer.indices) {
                phase += 2.0 * Math.PI * freq / sampleRate
                val fundamental = sin(phase)
                val overtone = sin(phase * 1.5)
                val mixed = (0.72 * fundamental + 0.34 * overtone).coerceIn(-1.0, 1.0)
                buffer[i] = (Short.MAX_VALUE * mixed).toInt().toShort()
                sweepPhase += sweepSpeed
            }
            track.write(buffer, 0, buffer.size)
        }

        runCatching { track.stop() }
        runCatching { track.release() }
    }
}
