package com.storybloom.app.scene

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneSolarAndPerformanceTest {
    @Test
    fun `solar position follows day and night at the equator`() {
        val noon = sceneSolarPosition(
            latitude = 0.0,
            longitude = 0.0,
            epochMillis = Instant.parse("2024-03-20T12:00:00Z").toEpochMilli(),
        )
        val midnight = sceneSolarPosition(
            latitude = 0.0,
            longitude = 0.0,
            epochMillis = Instant.parse("2024-03-20T00:00:00Z").toEpochMilli(),
        )

        assertTrue(noon.elevationDegrees > 85f)
        assertTrue(midnight.elevationDegrees < -85f)
        assertTrue(noon.azimuthDegrees in 0f..<360f)
        assertTrue(midnight.azimuthDegrees in 0f..<360f)
    }

    @Test
    fun `adaptive quality remains sharp when frame pacing is healthy`() {
        val quality = SceneAdaptiveQualityController()
        var suggestion: Float? = null
        repeat(310) {
            suggestion = quality.recordFrame(16.67f) ?: suggestion
        }

        assertNull(suggestion)
        assertEquals(.88f, quality.initialScale, .001f)
    }

    @Test
    fun `adaptive quality settles after at most two slow windows`() {
        val quality = SceneAdaptiveQualityController()
        var first: Float? = null
        repeat(130) {
            quality.recordFrame(40f)?.let { first = it }
        }
        assertEquals(.76f, first ?: 0f, .001f)

        var second: Float? = null
        repeat(130) {
            quality.recordFrame(40f)?.let { second = it }
        }
        assertEquals(.66f, second ?: 0f, .001f)

        repeat(500) {
            assertNull(quality.recordFrame(80f))
        }
    }
}
