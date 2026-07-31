package com.storybloom.app.scene

/**
 * One-time native equivalent of the predecessor's adaptive DPR pass.
 *
 * The controller observes two five-second windows at most. It can lower the
 * GL surface scale, but never oscillates it while the user is interacting.
 */
internal class SceneAdaptiveQualityController(
    val initialScale: Float = .88f,
) {
    private var phase = 0
    private var elapsedMs = 0f
    private var totalFrameMs = 0f
    private var frames = 0
    private var settled = false

    fun recordFrame(frameMs: Float): Float? {
        if (settled || !frameMs.isFinite() || frameMs <= 0f) return null
        elapsedMs += frameMs
        totalFrameMs += frameMs
        frames += 1
        if (elapsedMs < WINDOW_MS) return null

        val average = totalFrameMs / frames.coerceAtLeast(1)
        return if (phase == 0 && average > TARGET_FRAME_MS) {
            phase = 1
            resetWindow()
            FIRST_FALLBACK_SCALE
        } else {
            settled = true
            if (phase == 1 && average > TARGET_FRAME_MS) {
                SECOND_FALLBACK_SCALE
            } else {
                null
            }
        }
    }

    private fun resetWindow() {
        elapsedMs = 0f
        totalFrameMs = 0f
        frames = 0
    }

    private companion object {
        const val WINDOW_MS = 5_000f
        const val TARGET_FRAME_MS = 34f
        const val FIRST_FALLBACK_SCALE = .76f
        const val SECOND_FALLBACK_SCALE = .66f
    }
}
