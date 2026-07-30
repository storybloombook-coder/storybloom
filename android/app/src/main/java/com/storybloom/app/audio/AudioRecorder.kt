package com.storybloom.app.audio

import android.content.Context
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import java.io.File

data class RecordedClip(
    val fileUri: String,
    val durationMs: Long,
)

class AudioRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var output: File? = null

    val isRecording: Boolean
        get() = recorder != null

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
        output = file
        recorder = next
    }

    fun stop(): RecordedClip? {
        val active = recorder ?: return null
        val file = output
        recorder = null
        output = null
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
            durationMs = duration(file),
        )
    }

    fun cancel() {
        val file = output
        runCatching { recorder?.stop() }
        recorder?.reset()
        recorder?.release()
        recorder = null
        output = null
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
