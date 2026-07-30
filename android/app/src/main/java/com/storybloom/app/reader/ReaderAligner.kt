package com.storybloom.app.reader

import com.storybloom.app.data.Cue
import com.storybloom.app.speech.RecognizedWord
import com.storybloom.app.speech.normalizeSpeechWord

data class ScriptWord(
    val display: String,
    val value: String,
    val charStart: Int,
    val charEnd: Int,
)

data class AlignmentUpdate(
    val wordIndex: Int,
    val cue: Cue?,
)

class ReaderAligner(
    text: String,
    cues: List<Cue>,
) {
    val script: List<ScriptWord> = Regex("""[\p{L}\p{N}'’-]+""")
        .findAll(text)
        .map { match ->
            ScriptWord(
                display = match.value,
                value = normalizeSpeechWord(match.value),
                charStart = match.range.first,
                charEnd = match.range.last + 1,
            )
        }
        .filter { it.value.isNotBlank() }
        .toList()

    private val cueByWordIndex = script.indices.associateWith { index ->
        val word = script[index]
        cues.firstOrNull { cue ->
            cue.isActive &&
                cue.soundId != null &&
                cue.charStart != null &&
                cue.charEnd != null &&
                word.charStart < cue.charEnd &&
                word.charEnd > cue.charStart
        }
    }.filterValues { it != null }.mapValues { requireNotNull(it.value) }

    private var cursor = -1
    private var lastPartial: List<String> = emptyList()
    private val firedCueIds = mutableSetOf<String>()

    fun onPartial(text: String): List<AlignmentUpdate> {
        val words = Regex("""[\p{L}\p{N}'’-]+""")
            .findAll(text)
            .map { normalizeSpeechWord(it.value) }
            .filter(String::isNotBlank)
            .toList()
        val common = commonPrefixLength(lastPartial, words)
        lastPartial = words
        return align(words.drop(common).map { RecognizedWord(it, 1f) }, checkConfidence = false)
    }

    fun onFinal(words: List<RecognizedWord>): List<AlignmentUpdate> {
        lastPartial = emptyList()
        return align(words, checkConfidence = true)
    }

    fun onFinalText(text: String): List<AlignmentUpdate> {
        lastPartial = emptyList()
        return align(
            Regex("""[\p{L}\p{N}'’-]+""").findAll(text).map {
                RecognizedWord(normalizeSpeechWord(it.value), 1f)
            }.toList(),
            checkConfidence = false,
        )
    }

    fun moveManually(wordIndex: Int) {
        cursor = wordIndex.coerceIn(-1, script.lastIndex)
        val allowedCueIds = cueByWordIndex
            .filterKeys { it <= cursor }
            .values
            .map(Cue::id)
            .toSet()
        firedCueIds.retainAll(allowedCueIds)
    }

    fun currentWordIndex(): Int = cursor

    fun reset() {
        cursor = -1
        lastPartial = emptyList()
        firedCueIds.clear()
    }

    private fun align(
        recognized: List<RecognizedWord>,
        checkConfidence: Boolean,
    ): List<AlignmentUpdate> {
        val updates = mutableListOf<AlignmentUpdate>()
        recognized.forEach { heard ->
            val normalized = normalizeSpeechWord(heard.word)
            if (normalized.isBlank()) return@forEach
            if (checkConfidence && heard.confidence < MIN_CONFIDENCE) return@forEach
            val match = findMatch(normalized) ?: return@forEach
            cursor = maxOf(cursor, match)
            val cue = cueByWordIndex[match]?.takeIf { firedCueIds.add(it.id) }
            updates += AlignmentUpdate(match, cue)
        }
        return updates
    }

    private fun findMatch(heard: String): Int? {
        if (script.isEmpty()) return null
        val start = (cursor + 1).coerceAtLeast(0)
        val end = minOf(script.lastIndex, start + LOOKAHEAD)
        for (index in start..end) {
            if (script[index].value == heard) return index
        }
        if (heard.length < MIN_FUZZY_WORD_LENGTH) return null
        var bestIndex: Int? = null
        var bestDistance = Int.MAX_VALUE
        for (index in start..end) {
            val expected = script[index].value
            if (expected.length < MIN_FUZZY_WORD_LENGTH) continue
            val distance = levenshtein(heard, expected)
            val threshold = when {
                maxOf(heard.length, expected.length) <= 5 -> 1
                else -> 2
            }
            if (distance <= threshold && distance < bestDistance) {
                bestDistance = distance
                bestIndex = index
            }
        }
        return bestIndex
    }

    companion object {
        const val LOOKAHEAD = 60
        const val MIN_FUZZY_WORD_LENGTH = 3
        const val MIN_CONFIDENCE = 0.5f
    }
}

internal fun levenshtein(a: String, b: String): Int {
    if (a == b) return 0
    if (a.isEmpty()) return b.length
    if (b.isEmpty()) return a.length
    var previous = IntArray(b.length + 1) { it }
    var current = IntArray(b.length + 1)
    for (i in a.indices) {
        current[0] = i + 1
        for (j in b.indices) {
            val substitution = if (a[i] == b[j]) 0 else 1
            current[j + 1] = minOf(
                current[j] + 1,
                previous[j + 1] + 1,
                previous[j] + substitution,
            )
        }
        val swap = previous
        previous = current
        current = swap
    }
    return previous[b.length]
}

private fun commonPrefixLength(a: List<String>, b: List<String>): Int {
    val size = minOf(a.size, b.size)
    for (index in 0 until size) {
        if (a[index] != b[index]) return index
    }
    return size
}
