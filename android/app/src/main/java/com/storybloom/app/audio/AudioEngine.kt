package com.storybloom.app.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.SoundPool
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.storybloom.app.data.TrimEnvelope
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.min

class AudioEngine(private val context: Context) {
    private val handler = Handler(Looper.getMainLooper())
    private val soundPool = SoundPool.Builder()
        .setMaxStreams(8)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
        )
        .build()
    private val loadedSounds = ConcurrentHashMap<String, Int>()
    private val readySamples = ConcurrentHashMap.newKeySet<Int>()
    private val pendingPlay = ConcurrentHashMap<Int, Float>()
    private val customPlayers = ConcurrentHashMap.newKeySet<MediaPlayer>()

    @Volatile
    private var ambientPlayer: MediaPlayer? = null
    private var ambientGeneration = 0L
    private var ambientBaseVolume = 1f
    private var ambientFullVolume = 1f

    init {
        soundPool.setOnLoadCompleteListener { pool, sampleId, status ->
            if (status == 0) {
                readySamples += sampleId
                pendingPlay.remove(sampleId)?.let { volume ->
                    pool.play(sampleId, volume, volume, 2, 0, 1f)
                }
            }
        }
    }

    fun prewarm(soundIds: Collection<String>) {
        soundIds.asSequence()
            .filterNot {
                it.startsWith(CUSTOM_PREFIX) ||
                    it.startsWith("amb_") ||
                    it == "fx_animal_frog" ||
                    it == "fx_animal_whale"
            }
            .forEach(::ensureLoaded)
    }

    fun playEffect(
        envelope: TrimEnvelope,
        onComplete: (() -> Unit)? = null,
    ) {
        val soundId = envelope.soundId
        val adjustedEnvelope = if (
            soundId == "fx_animal_frog" &&
            envelope.startMs == null &&
            envelope.endMs == null
        ) {
            envelope.copy(startMs = 520L)
        } else {
            envelope
        }
        if (soundId == "fx_animal_whale") {
            playMediaRange(adjustedEnvelope, loop = false, onComplete = onComplete)
            return
        }
        if (
            !soundId.startsWith(CUSTOM_PREFIX) &&
            adjustedEnvelope.startMs == null &&
            adjustedEnvelope.endMs == null
        ) {
            val sampleId = ensureLoaded(soundId)
            val volume = SoundLibrary.effectGain(soundId)
            if (sampleId != null) {
                if (sampleId in readySamples) {
                    soundPool.play(sampleId, volume, volume, 2, 0, 1f)
                    onComplete?.let { handler.postDelayed(it, 1_500L) }
                } else {
                    pendingPlay[sampleId] = volume
                    onComplete?.let { handler.postDelayed(it, 1_500L) }
                }
            }
            return
        }
        playMediaRange(adjustedEnvelope, loop = false, onComplete = onComplete)
    }

    fun preview(soundId: String, onComplete: (() -> Unit)? = null) {
        playEffect(TrimEnvelope(soundId), onComplete)
    }

    fun playAmbient(
        envelope: TrimEnvelope?,
        gainOverride: Float? = null,
    ) {
        stopAmbient(immediate = true)
        if (envelope == null) return
        val generation = ++ambientGeneration
        runCatching {
            val player = buildMediaPlayer(envelope.soundId)
            ambientPlayer = player
            ambientFullVolume =
                gainOverride?.coerceIn(0f, 1f) ?: SoundLibrary.ambientGain(envelope.soundId)
            ambientBaseVolume = 0f
            player.isLooping = envelope.startMs == null && envelope.endMs == null
            player.setVolume(0f, 0f)
            player.setOnPreparedListener {
                if (generation != ambientGeneration) {
                    it.release()
                    return@setOnPreparedListener
                }
                envelope.startMs?.let { start -> it.seekTo(start.toInt()) }
                it.start()
                fadeAmbientTo(ambientFullVolume, envelope.fadeInMs ?: 600L, generation)
                if (envelope.endMs != null) {
                    scheduleTrimLoop(it, envelope, generation)
                }
            }
            player.prepareAsync()
        }
    }

    fun duckAmbient(durationMs: Long = 1_400L) {
        val generation = ambientGeneration
        fadeAmbientTo(ambientFullVolume * .18f, 350L, generation)
        handler.postDelayed(
            {
                if (generation == ambientGeneration) {
                    fadeAmbientTo(ambientFullVolume, 350L, generation)
                }
            },
            durationMs,
        )
    }

    fun stopAmbient(immediate: Boolean = false) {
        val player = ambientPlayer ?: return
        ambientPlayer = null
        val generation = ++ambientGeneration
        if (immediate) {
            runCatching { player.stop() }
            player.release()
            return
        }
        val startVolume = ambientBaseVolume
        val started = System.currentTimeMillis()
        fun tick() {
            val fraction = ((System.currentTimeMillis() - started) / 500f).coerceIn(0f, 1f)
            val volume = startVolume * (1f - fraction)
            runCatching { player.setVolume(volume, volume) }
            if (fraction < 1f && generation == ambientGeneration) {
                handler.postDelayed(::tick, 32L)
            } else {
                runCatching { player.stop() }
                player.release()
            }
        }
        tick()
    }

    fun release() {
        ambientGeneration += 1
        ambientPlayer?.release()
        ambientPlayer = null
        customPlayers.forEach(MediaPlayer::release)
        customPlayers.clear()
        soundPool.release()
        handler.removeCallbacksAndMessages(null)
    }

    private fun ensureLoaded(soundId: String): Int? {
        loadedSounds[soundId]?.let { return it }
        val path = SoundLibrary.assetPath(soundId) ?: return null
        return runCatching {
            context.assets.openFd(path).use { descriptor ->
                soundPool.load(descriptor, 1).also { loadedSounds[soundId] = it }
            }
        }.getOrNull()
    }

    private fun playMediaRange(
        envelope: TrimEnvelope,
        loop: Boolean,
        onComplete: (() -> Unit)?,
    ) {
        runCatching {
            val player = buildMediaPlayer(envelope.soundId)
            customPlayers += player
            player.isLooping = loop && envelope.endMs == null
            player.setOnPreparedListener {
                envelope.startMs?.let { start -> it.seekTo(start.toInt()) }
                val fadeIn = envelope.fadeInMs ?: 30L
                if (fadeIn > 0) it.setVolume(0f, 0f)
                it.start()
                fadePlayer(it, 0f, 1f, fadeIn)
                val end = envelope.endMs
                if (end != null) scheduleRangeEnd(it, envelope, onComplete)
            }
            player.setOnCompletionListener {
                customPlayers -= it
                it.release()
                onComplete?.invoke()
            }
            player.prepareAsync()
        }.onFailure { onComplete?.invoke() }
    }

    private fun scheduleRangeEnd(
        player: MediaPlayer,
        envelope: TrimEnvelope,
        onComplete: (() -> Unit)?,
    ) {
        val end = requireNotNull(envelope.endMs)
        val fadeOut = envelope.fadeOutMs ?: 120L
        fun check() {
            if (player !in customPlayers || !player.isPlaying) return
            val remaining = end - player.currentPosition
            when {
                remaining <= 0 -> {
                    customPlayers -= player
                    runCatching { player.stop() }
                    player.release()
                    onComplete?.invoke()
                }
                remaining <= fadeOut -> {
                    val volume = (remaining.toFloat() / max(1L, fadeOut)).coerceIn(0f, 1f)
                    player.setVolume(volume, volume)
                    handler.postDelayed(::check, 25L)
                }
                else -> handler.postDelayed(::check, min(50L, remaining - fadeOut))
            }
        }
        check()
    }

    private fun scheduleTrimLoop(
        player: MediaPlayer,
        envelope: TrimEnvelope,
        generation: Long,
    ) {
        val end = requireNotNull(envelope.endMs)
        fun check() {
            if (generation != ambientGeneration || player !== ambientPlayer) return
            if (player.currentPosition >= end) {
                player.seekTo((envelope.startMs ?: 0L).toInt())
            }
            handler.postDelayed(::check, 40L)
        }
        check()
    }

    private fun buildMediaPlayer(soundId: String): MediaPlayer {
        val player = MediaPlayer()
        player.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build(),
        )
        if (soundId.startsWith(CUSTOM_PREFIX)) {
            val raw = soundId.removePrefix(CUSTOM_PREFIX)
            val uri = if (raw.startsWith("file:", ignoreCase = true) || raw.contains("://")) {
                Uri.parse(raw)
            } else {
                Uri.fromFile(File(raw))
            }
            if (uri.scheme == "file") {
                player.setDataSource(requireNotNull(uri.path))
            } else {
                player.setDataSource(context, uri)
            }
        } else {
            val path = SoundLibrary.assetPath(soundId)
                ?: error("Unknown sound: $soundId")
            context.assets.openFd(path).use { descriptor ->
                player.setDataSource(
                    descriptor.fileDescriptor,
                    descriptor.startOffset,
                    descriptor.length,
                )
            }
        }
        return player
    }

    private fun fadeAmbientTo(target: Float, durationMs: Long, generation: Long) {
        val player = ambientPlayer ?: return
        val from = ambientBaseVolume
        val started = System.currentTimeMillis()
        fun tick() {
            if (generation != ambientGeneration || player !== ambientPlayer) return
            val fraction = if (durationMs <= 0) 1f else {
                ((System.currentTimeMillis() - started).toFloat() / durationMs).coerceIn(0f, 1f)
            }
            ambientBaseVolume = from + (target - from) * fraction
            runCatching { player.setVolume(ambientBaseVolume, ambientBaseVolume) }
            if (fraction < 1f) handler.postDelayed(::tick, 32L)
        }
        tick()
    }

    private fun fadePlayer(player: MediaPlayer, from: Float, to: Float, durationMs: Long) {
        if (durationMs <= 0) {
            player.setVolume(to, to)
            return
        }
        val started = System.currentTimeMillis()
        fun tick() {
            if (player !in customPlayers) return
            val fraction =
                ((System.currentTimeMillis() - started).toFloat() / durationMs).coerceIn(0f, 1f)
            val volume = from + (to - from) * fraction
            runCatching { player.setVolume(volume, volume) }
            if (fraction < 1f) handler.postDelayed(::tick, 25L)
        }
        tick()
    }

    companion object {
        const val CUSTOM_PREFIX = "custom:"
    }
}
