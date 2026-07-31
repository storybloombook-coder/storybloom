package com.storybloom.app.ui.mechanics

object SwipeRevealMath {
    const val RevealFraction = 0.20f
    const val ActivationDistance = 12f
    const val RevealDelayMillis = 140L

    fun clamp(translation: Float, rowWidth: Float): Float {
        val reveal = rowWidth.coerceAtLeast(0f) * RevealFraction
        return translation.coerceIn(-reveal, 0f)
    }

    fun settleTarget(translation: Float, rowWidth: Float): Float {
        val reveal = rowWidth.coerceAtLeast(0f) * RevealFraction
        return if (translation <= -reveal / 2f) -reveal else 0f
    }
}
