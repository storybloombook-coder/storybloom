package com.storybloom.app.reader

import com.storybloom.app.data.Cue
import com.storybloom.app.data.CueReviewState
import com.storybloom.app.data.CueType
import com.storybloom.app.speech.RecognizedWord
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReaderAlignerTest {
    @Test
    fun cumulativePartialsOnlyAdvanceForNewWords() {
        val aligner = ReaderAligner("The quick brown fox", emptyList())

        val first = aligner.onPartial("the quick")
        val second = aligner.onPartial("the quick brown")

        assertEquals(listOf(0, 1), first.map { it.wordIndex })
        assertEquals(listOf(2), second.map { it.wordIndex })
    }

    @Test
    fun lowConfidenceFinalWordDoesNotAdvance() {
        val aligner = ReaderAligner("little rabbit jumped", emptyList())

        val updates = aligner.onFinal(
            listOf(
                RecognizedWord("little", .91f),
                RecognizedWord("rabbit", .31f),
                RecognizedWord("jumped", .88f),
            ),
        )

        assertEquals(listOf(0, 2), updates.map { it.wordIndex })
    }

    @Test
    fun fuzzyMatchToleratesSmallRecognitionError() {
        val aligner = ReaderAligner("beautiful butterfly", emptyList())
        val update = aligner.onFinalText("beautful")
        assertEquals(0, update.single().wordIndex)
    }

    @Test
    fun repeatedWordFiresOnlyItsOwnCueOnce() {
        val text = "The bell was quiet, then the bell rang."
        val first = text.indexOf("bell")
        val second = text.lastIndexOf("bell")
        val cues = listOf(
            cue("first", first, first + 4),
            cue("second", second, second + 4),
        )
        val aligner = ReaderAligner(text, cues)

        val early = aligner.onFinalText("the bell")
        val late = aligner.onFinalText("was quiet then the bell")
        val duplicate = aligner.onFinalText("bell")

        assertEquals("first", early.last().cue?.id)
        assertEquals("second", late.last().cue?.id)
        assertTrue(duplicate.all { it.cue == null })
    }

    private fun cue(id: String, start: Int, end: Int) = Cue(
        id = id,
        pageId = "page",
        type = CueType.KEYWORD,
        triggerText = "bell",
        contextPhrase = null,
        charStart = start,
        charEnd = end,
        soundId = "fx_bell",
        candidateSoundIds = listOf("fx_bell"),
        characterName = null,
        intensity = null,
        emotion = null,
        reviewState = CueReviewState.CONFIRMED,
        soundStartMs = null,
        soundEndMs = null,
        fadeInMs = null,
        fadeOutMs = null,
    )
}
