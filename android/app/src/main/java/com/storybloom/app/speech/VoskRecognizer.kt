package com.storybloom.app.speech

import com.storybloom.app.data.BookLanguage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.util.concurrent.atomic.AtomicBoolean

data class RecognizedWord(
    val word: String,
    val confidence: Float,
)

interface SpeechCallbacks {
    fun onPartial(text: String)
    fun onResult(text: String, words: List<RecognizedWord>)
    fun onError(message: String)
}

class VoskRecognizer(private val modelManager: ModelManager) {
    private var model: Model? = null
    private var recognizer: Recognizer? = null
    private var service: SpeechService? = null
    private val running = AtomicBoolean(false)

    suspend fun start(
        language: BookLanguage,
        vocabulary: Collection<String> = emptyList(),
        callbacks: SpeechCallbacks,
    ) = withContext(Dispatchers.IO) {
        stopInternal()
        val loadedModel = modelManager.load(language)
        val grammar = vocabulary
            .asSequence()
            .map(::normalizeSpeechWord)
            .filter(String::isNotBlank)
            .distinct()
            .plus("[unk]")
            .toList()
        val nativeRecognizer = if (grammar.size > 1) {
            Recognizer(loadedModel, SAMPLE_RATE, JSONArray(grammar).toString())
        } else {
            Recognizer(loadedModel, SAMPLE_RATE)
        }
        nativeRecognizer.setWords(true)
        val speechService = SpeechService(nativeRecognizer, SAMPLE_RATE)
        val listener = object : RecognitionListener {
            override fun onPartialResult(hypothesis: String) {
                val text = runCatching { JSONObject(hypothesis).optString("partial") }
                    .getOrDefault("")
                if (text.isNotBlank()) callbacks.onPartial(text)
            }

            override fun onResult(hypothesis: String) {
                val parsed = parseResult(hypothesis)
                if (parsed.first.isNotBlank()) callbacks.onResult(parsed.first, parsed.second)
            }

            override fun onFinalResult(hypothesis: String) {
                val parsed = parseResult(hypothesis)
                if (parsed.first.isNotBlank()) callbacks.onResult(parsed.first, parsed.second)
            }

            override fun onError(exception: Exception) {
                callbacks.onError(exception.message ?: "Speech recognition failed.")
            }

            override fun onTimeout() {
                callbacks.onError("Speech recognition timed out.")
            }
        }
        check(speechService.startListening(listener)) {
            "The microphone recognizer could not start."
        }
        model = loadedModel
        recognizer = nativeRecognizer
        service = speechService
        running.set(true)
    }

    suspend fun stop() = withContext(Dispatchers.IO) {
        stopInternal()
    }

    fun isRunning(): Boolean = running.get()

    fun closeNow() {
        stopInternal()
    }

    private fun stopInternal() {
        running.set(false)
        runCatching { service?.stop() }
        runCatching { service?.shutdown() }
        service = null
        runCatching { recognizer?.close() }
        recognizer = null
        runCatching { model?.close() }
        model = null
    }

    private fun parseResult(json: String): Pair<String, List<RecognizedWord>> =
        runCatching {
            val objectValue = JSONObject(json)
            val text = objectValue.optString("text")
            val array = objectValue.optJSONArray("result")
            val words = buildList {
                if (array != null) {
                    for (index in 0 until array.length()) {
                        val item = array.getJSONObject(index)
                        add(
                            RecognizedWord(
                                word = item.optString("word"),
                                confidence = item.optDouble("conf", 0.0).toFloat(),
                            ),
                        )
                    }
                }
            }
            text to words
        }.getOrDefault("" to emptyList())

    companion object {
        private const val SAMPLE_RATE = 16_000f
    }
}

fun normalizeSpeechWord(value: String): String = value
    .lowercase()
    .replace(Regex("""[^\p{L}\p{N}'’-]+"""), "")
    .trim('\'', '’', '-')

fun speechWords(text: String): List<String> = Regex("""[\p{L}\p{N}'’-]+""")
    .findAll(text.lowercase())
    .map { normalizeSpeechWord(it.value) }
    .filter(String::isNotBlank)
    .toList()
