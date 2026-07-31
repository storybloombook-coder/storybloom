package com.storybloom.app.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class AudioRecorderTest {
    @Test
    fun emulatorAudioClockCannotInflateTheVisibleDuration() {
        assertEquals(
            3_040L,
            resolveRecordedDuration(
                containerDurationMs = 16_951L,
                elapsedDurationMs = 3_040L,
            ),
        )
    }

    @Test
    fun plausibleContainerDurationKeepsCodecPaddingAccuracy() {
        assertEquals(
            3_112L,
            resolveRecordedDuration(
                containerDurationMs = 3_112L,
                elapsedDurationMs = 3_025L,
            ),
        )
    }

    @Test
    fun eitherClockCanProvideTheOnlyAvailableDuration() {
        assertEquals(2_400L, resolveRecordedDuration(0L, 2_400L))
        assertEquals(2_350L, resolveRecordedDuration(2_350L, 0L))
    }
}
