package com.storybloom.app.ui.mechanics

import org.junit.Assert.assertEquals
import org.junit.Test

class WaveformTrimMathTest {
    @Test
    fun trimHandlesNeverCrossTheirTwentyFourPixelGap() {
        assertEquals(
            4.4f,
            WaveformTrimMath.startFromPointer(
                pointerX = 190f,
                endX = 200f,
                width = 200f,
                duration = 5f,
            ),
            0.001f,
        )
        assertEquals(
            1.6f,
            WaveformTrimMath.endFromPointer(
                pointerX = 20f,
                startX = 40f,
                width = 200f,
                duration = 5f,
            ),
            0.001f,
        )
    }

    @Test
    fun waveformBucketingPreservesARealPeak() {
        val bars = WaveformTrimMath.bucket(
            raw = listOf(.1f, .2f, .9f, 1f),
            bars = 2,
        )
        assertEquals(.15f, bars[0], 0.001f)
        assertEquals(.95f, bars[1], 0.001f)
    }
}
