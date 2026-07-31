package com.storybloom.app.ui.mechanics

import org.junit.Assert.assertEquals
import org.junit.Test

class SwipeRevealMathTest {
    @Test
    fun rowClampsToTwentyPercentAndNeverMovesRight() {
        assertEquals(-60f, SwipeRevealMath.clamp(-500f, 300f), 0.001f)
        assertEquals(0f, SwipeRevealMath.clamp(20f, 300f), 0.001f)
    }

    @Test
    fun halfRevealIsTheStickyOpenThreshold() {
        assertEquals(0f, SwipeRevealMath.settleTarget(-29f, 300f), 0.001f)
        assertEquals(-60f, SwipeRevealMath.settleTarget(-30f, 300f), 0.001f)
    }
}
