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
    fun finalDoesNotReprocessWordsAlreadyConsumedAsPartials() {
        val aligner = ReaderAligner("little rabbit jumped", emptyList())

        assertEquals(
            listOf(0, 1),
            aligner.onPartial("little rabbit").map { it.wordIndex },
        )
        assertTrue(
            aligner.onFinal(
                listOf(
                    RecognizedWord("little", .95f),
                    RecognizedWord("rabbit", .95f),
                ),
            ).isEmpty(),
        )
    }

    @Test
    fun revisedPartialDoesNotTreatReplacementWordsAsNewSpeech() {
        val aligner = ReaderAligner("bright blue bird", emptyList())

        aligner.onPartial("bright red")
        val revision = aligner.onPartial("bright blue")

        assertTrue(revision.isEmpty())
        assertEquals(0, aligner.currentWordIndex())
    }

    @Test
    fun oneBatchCannotJumpAcrossNearbyDuplicateWords() {
        val aligner = ReaderAligner("bell softly and then bell", emptyList())

        val firstBatch = aligner.onFinalText("bell bell")
        val nextUtterance = aligner.onFinalText("bell")

        assertEquals(0, firstBatch.last().wordIndex)
        assertEquals(4, nextUtterance.last().wordIndex)
    }

    @Test
    fun lookaheadIsSixtyCharactersNotSixtyWords() {
        val longGap = "x".repeat(61)
        val aligner = ReaderAligner("start $longGap butterfly", emptyList())

        val updates = aligner.onFinalText("butterfly")

        assertTrue(updates.isEmpty())
        assertEquals(-1, aligner.currentWordIndex())
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

        val early = aligner.onFinalText("bell")
        aligner.onFinalText("was quiet then the bell")
        val late = aligner.onFinalText("the bell")
        val duplicate = aligner.onFinalText("bell")

        assertEquals("first", early.last().cue?.id)
        assertEquals("second", late.mapNotNull { it.cue?.id }.lastOrNull())
        assertTrue(duplicate.all { it.cue == null })
    }

    @Test
    fun manualRewindLeavesDestinationWordFresh() {
        val text = "The bell rang softly"
        val start = text.indexOf("bell")
        val aligner = ReaderAligner(
            text,
            listOf(cue("bell-cue", start, start + 4)),
        )

        assertEquals(
            "bell-cue",
            aligner.onFinalText("the bell").mapNotNull { it.cue?.id }.single(),
        )

        aligner.moveManually(1)
        val reread = aligner.onFinalText("bell")

        assertEquals(1, reread.single().wordIndex)
        assertEquals("bell-cue", reread.single().cue?.id)
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
