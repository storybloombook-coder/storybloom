package com.storybloom.app.audio

import android.content.Context
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt

data class RecordedClip(
    val fileUri: String,
    val durationMs: Long,
)

class AudioRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var output: File? = null
    private var startedAtElapsedRealtimeMs = 0L

    val isRecording: Boolean
        get() = recorder != null

    /**
     * Live recorder metering for the editor waveform. MediaRecorder reports
     * a 16-bit peak since the previous call; square-root scaling keeps quiet
     * speech visible without pretending it is decoded PCM.
     */
    fun amplitude(): Float {
        val peak = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)
        return sqrt((peak / 32_767f).coerceIn(0f, 1f))
    }

    fun start() {
        check(recorder == null) { "A recording is already in progress." }
        val directory = File(context.filesDir, "recordings").apply { mkdirs() }
        val file = File(directory, "recording-${System.currentTimeMillis()}.m4a")
        val next = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
        next.apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioEncodingBitRate(128_000)
            setAudioSamplingRate(44_100)
            setOutputFile(file.absolutePath)
            prepare()
            start()
        }
        startedAtElapsedRealtimeMs = SystemClock.elapsedRealtime()
        output = file
        recorder = next
    }

    fun stop(): RecordedClip? {
        val active = recorder ?: return null
        val file = output
        val elapsedDurationMs = if (startedAtElapsedRealtimeMs > 0L) {
            (SystemClock.elapsedRealtime() - startedAtElapsedRealtimeMs)
                .coerceAtLeast(0L)
        } else {
            0L
        }
        recorder = null
        output = null
        startedAtElapsedRealtimeMs = 0L
        val successful = runCatching {
            active.stop()
            true
        }.getOrDefault(false)
        active.reset()
        active.release()
        if (!successful || file == null || !file.exists() || file.length() == 0L) {
            file?.delete()
            return null
        }
        return RecordedClip(
            fileUri = Uri.fromFile(file).toString(),
            durationMs = resolveRecordedDuration(
                containerDurationMs = duration(file),
                elapsedDurationMs = elapsedDurationMs,
            ),
        )
    }

    fun cancel() {
        val file = output
        runCatching { recorder?.stop() }
        recorder?.reset()
        recorder?.release()
        recorder = null
        output = null
        startedAtElapsedRealtimeMs = 0L
        file?.delete()
    }

    private fun duration(file: File): Long = runCatching {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(file.absolutePath)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLong() ?: 0L
        } finally {
            retriever.release()
        }
    }.getOrDefault(0L)
}

/**
 * MediaRecorder timestamps are usually the best description of an AAC file,
 * but Android's emulator microphone can advance its audio clock several times
 * faster than the monotonic device clock. That makes a three-second capture
 * look like a 17-second clip and corrupts every trim/fade calculation.
 *
 * Keep the container value when it plausibly agrees with the user's actual
 * recording interval. Otherwise the monotonic interval is authoritative and
 * playback is bounded to the portion the user really recorded.
 */
internal fun resolveRecordedDuration(
    containerDurationMs: Long,
    elapsedDurationMs: Long,
): Long {
    val container = containerDurationMs.coerceAtLeast(0L)
    val elapsed = elapsedDurationMs.coerceAtLeast(0L)
    if (elapsed == 0L) return container
    if (container == 0L) return elapsed
    val tolerance = max(500L, (elapsed * .18f).toLong())
    return if (abs(container - elapsed) <= tolerance) container else elapsed
}
