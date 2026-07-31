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

    private val cuesByWordIndex = script.indices.associateWith { index ->
        val word = script[index]
        cues.filter { cue ->
            cue.isActive &&
                cue.soundId != null &&
                cue.charStart != null &&
                cue.charEnd != null &&
                word.charStart < cue.charEnd &&
                word.charEnd > cue.charStart
        }
    }.filterValues(List<Cue>::isNotEmpty)

    private var cursor = -1
    private var utteranceWordsConsumed = 0
    private val firedCueIds = mutableSetOf<String>()

    fun onPartial(text: String): List<AlignmentUpdate> {
        val words = Regex("""[\p{L}\p{N}'’-]+""")
            .findAll(text)
            .map { normalizeSpeechWord(it.value) }
            .filter(String::isNotBlank)
            .toList()
        val alreadyConsumed = minOf(utteranceWordsConsumed, words.size)
        utteranceWordsConsumed = words.size
        return align(
            words.drop(alreadyConsumed).map { RecognizedWord(it, 1f) },
            checkConfidence = false,
        )
    }

    fun onFinal(words: List<RecognizedWord>): List<AlignmentUpdate> {
        val alreadyConsumed = minOf(utteranceWordsConsumed, words.size)
        val updates = align(words.drop(alreadyConsumed), checkConfidence = true)
        utteranceWordsConsumed = 0
        return updates
    }

    fun onFinalText(text: String): List<AlignmentUpdate> {
        val words = Regex("""[\p{L}\p{N}'’-]+""").findAll(text).map {
                RecognizedWord(normalizeSpeechWord(it.value), 1f)
            }.toList()
        val alreadyConsumed = minOf(utteranceWordsConsumed, words.size)
        val updates = align(
            words.drop(alreadyConsumed),
            checkConfidence = false,
        )
        utteranceWordsConsumed = 0
        return updates
    }

    fun moveManually(wordIndex: Int) {
        val target = wordIndex.coerceIn(-1, script.lastIndex)
        if (target < 0) {
            cursor = -1
            firedCueIds.clear()
            return
        }

        if (target <= cursor) {
            // Rewinding to a word puts the speech cursor at that word's
            // START. Its cue, and every cue after it, may fire again.
            val rewoundCueIds = cuesByWordIndex
                .filterKeys { it >= target }
                .values
                .flatten()
                .map(Cue::id)
                .toSet()
            firedCueIds.removeAll(rewoundCueIds)
        } else {
            // A manual forward jump silently consumes only the words it
            // skipped over. The destination remains fresh so saying it next
            // still aligns and can fire its own cue.
            for (index in (cursor + 1).coerceAtLeast(0) until target) {
                cuesByWordIndex[index].orEmpty().forEach { cue ->
                    firedCueIds += cue.id
                }
            }
        }

        // align() searches from cursor + 1. Keeping this one word behind
        // mirrors the predecessor's character cursor at target.charStart.
        cursor = target - 1
    }

    fun currentWordIndex(): Int = cursor

    fun reset() {
        cursor = -1
        utteranceWordsConsumed = 0
        firedCueIds.clear()
    }

    private fun align(
        recognized: List<RecognizedWord>,
        checkConfidence: Boolean,
    ): List<AlignmentUpdate> {
        val updates = mutableListOf<AlignmentUpdate>()
        for (heard in recognized) {
            val normalized = normalizeSpeechWord(heard.word)
            if (normalized.length < MIN_ALIGNMENT_WORD_LENGTH) continue
            if (checkConfidence && heard.confidence < MIN_CONFIDENCE) continue

            val startIndex = (cursor + 1).coerceAtLeast(0)
            val fromChar = if (cursor >= 0) script[cursor].charEnd else 0
            val match = findMatch(
                heard = normalized,
                startIndex = startIndex,
                windowEndChar = fromChar + LOOKAHEAD_CHARACTERS,
            ) ?: continue
            val ambiguous = findMatch(
                heard = normalized,
                startIndex = match + 1,
                windowEndChar = fromChar + LOOKAHEAD_CHARACTERS,
            ) != null

            val fireFromIndex = if (ambiguous) match else startIndex
            val cuesToFire = (fireFromIndex..match)
                .flatMap { cuesByWordIndex[it].orEmpty() }
                .filter { firedCueIds.add(it.id) }

            cursor = maxOf(cursor, match)
            if (cuesToFire.isEmpty()) {
                updates += AlignmentUpdate(match, null)
            } else {
                cuesToFire.forEach { updates += AlignmentUpdate(match, it) }
            }

            // A single recognition is not enough evidence to choose between
            // two nearby identical words. Land on the first and wait for the
            // next partial/final update before advancing again.
            if (ambiguous) break
        }
        return updates
    }

    private fun findMatch(
        heard: String,
        startIndex: Int,
        windowEndChar: Int,
    ): Int? {
        if (script.isEmpty() || startIndex !in script.indices) return null
        val candidates = (startIndex..script.lastIndex)
            .takeWhile { script[it].charStart <= windowEndChar }
        for (index in candidates) {
            if (script[index].value == heard) return index
        }
        var bestIndex: Int? = null
        var bestDistance = Int.MAX_VALUE
        for (index in candidates) {
            val expected = script[index].value
            if (expected.length < MIN_ALIGNMENT_WORD_LENGTH) continue
            val threshold = if (heard.length <= 5) 1 else 2
            if (kotlin.math.abs(expected.length - heard.length) > threshold) continue
            val distance = levenshtein(heard, expected)
            if (distance <= threshold && distance < bestDistance) {
                bestDistance = distance
                bestIndex = index
            }
        }
        return bestIndex
    }

    companion object {
        const val LOOKAHEAD_CHARACTERS = 60
        const val MIN_ALIGNMENT_WORD_LENGTH = 3
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
