package com.storybloom.app.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalCueAnalyzerTest {
    @Test
    fun matchesEnglishEffectsAndAmbientInReadingOrder() {
        val result = LocalCueAnalyzer.analyze(
            "Deep in the forest, a puppy barked. Then somebody knocked on the door.",
        )

        assertEquals("amb_forest", result.ambientSoundId)
        assertTrue(result.cues.any { it.soundId == "fx_animal_dog" })
        assertTrue(result.cues.any { it.soundId == "fx_knock" })
        assertTrue(result.cues.zipWithNext().all { (a, b) ->
            (a.charStart ?: 0) <= (b.charStart ?: Int.MAX_VALUE)
        })
    }

    @Test
    fun matchesCyrillicUsingUnicodeWordBoundaries() {
        val result = LocalCueAnalyzer.analyze(
            "Ночью собака сказала гав, а за окном гремел гром.",
        )

        assertEquals("amb_night", result.ambientSoundId)
        assertTrue(result.cues.any { it.soundId == "fx_animal_dog" })
        assertTrue(result.cues.any { it.soundId == "fx_thunder" })
    }

    @Test
    fun doesNotMatchInsideAnotherWord() {
        assertEquals(-1, LocalCueAnalyzer.wordIndex("an orange rolled", "ran"))
        assertEquals(-1, LocalCueAnalyzer.wordIndex("громкий голос", "гром"))
        assertEquals(4, LocalCueAnalyzer.wordIndex("the barking dog", "bark"))
    }

    @Test
    fun capsAutomaticKeywordCuesAtFive() {
        val result = LocalCueAnalyzer.analyze(
            "A dog barked, a cat meowed, a cow mooed, a duck quacked, " +
                "a frog croaked, a bell rang, thunder crashed and a door slammed.",
        )
        val keywords = result.cues.filter { it.type == com.storybloom.app.data.CueType.KEYWORD }
        assertEquals(5, keywords.size)
    }
}
