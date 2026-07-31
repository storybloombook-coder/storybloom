package com.storybloom.app.scene

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneCameraOcclusionTest {
    @Test
    fun `cloud intersecting camera shell is hidden`() {
        assertEquals(0f, SceneCameraOcclusion.cloudAlpha(9.5f), .0001f)
    }

    @Test
    fun `cloud visibility eases through camera shell`() {
        val alpha = SceneCameraOcclusion.cloudAlpha(12.5f)

        assertTrue(alpha > 0f)
        assertTrue(alpha < 1f)
        assertEquals(.5f, alpha, .0001f)
    }

    @Test
    fun `distant cloud keeps authored opacity`() {
        assertEquals(1f, SceneCameraOcclusion.cloudAlpha(15.5f), .0001f)
    }

    @Test
    fun `cloud centered behind scene heading yields completely`() {
        assertEquals(
            0f,
            SceneCameraOcclusion.headerSafeAlpha(.55f, .075f),
            .0001f,
        )
    }

    @Test
    fun `cloud clears scene heading through a soft shoulder`() {
        val alpha = SceneCameraOcclusion.headerSafeAlpha(.55f, .16f)

        assertTrue(alpha > 0f)
        assertTrue(alpha < 1f)
    }

    @Test
    fun `cloud outside scene heading stays visible`() {
        assertEquals(
            1f,
            SceneCameraOcclusion.headerSafeAlpha(.05f, .08f),
            .0001f,
        )
    }

    @Test
    fun `camera boom comes in front of actor`() {
        val distance = SceneCameraOcclusion.clampDistanceForCircle(
            heroX = 0f,
            heroZ = 0f,
            desiredCameraX = 0f,
            desiredCameraZ = 5f,
            desiredDistance = 5.5f,
            blockerX = .1f,
            blockerZ = 3.2f,
            blockerRadius = .8f,
        )

        assertTrue(distance >= 2.4f)
        assertTrue(distance < 5.5f)
    }

    @Test
    fun `camera boom stops before solid landmark`() {
        val distance = SceneCameraOcclusion.clampDistanceForRect(
            heroX = 0f,
            heroZ = 4f,
            desiredCameraX = 0f,
            desiredCameraZ = 8f,
            desiredDistance = 5.5f,
            minX = -1.5f,
            maxX = 1.5f,
            minZ = 4.8f,
            maxZ = 7.7f,
        )

        assertTrue(distance >= 2.4f)
        assertTrue(distance < 5.5f)
    }

    @Test
    fun `camera boom stays full length when landmark is off ray`() {
        val distance = SceneCameraOcclusion.clampDistanceForRect(
            heroX = 0f,
            heroZ = 4f,
            desiredCameraX = -5.5f,
            desiredCameraZ = 4f,
            desiredDistance = 5.5f,
            minX = -1.5f,
            maxX = 1.5f,
            minZ = 4.8f,
            maxZ = 7.7f,
        )

        assertEquals(5.5f, distance, .0001f)
    }

    @Test
    fun `tree on follow sightline fades`() {
        val alpha = SceneCameraOcclusion.treeAlpha(
            heroX = 0f,
            heroZ = 0f,
            cameraX = 0f,
            cameraZ = 6f,
            treeX = .1f,
            treeZ = 3f,
            treeRadius = .8f,
        )

        assertEquals(.16f, alpha, .0001f)
    }

    @Test
    fun `trees outside finite sightline remain solid`() {
        val behindHero = SceneCameraOcclusion.treeAlpha(
            0f,
            0f,
            0f,
            6f,
            0f,
            -1f,
            .8f,
        )
        val beyondCamera = SceneCameraOcclusion.treeAlpha(
            0f,
            0f,
            0f,
            6f,
            0f,
            7f,
            .8f,
        )

        assertEquals(1f, behindHero, .0001f)
        assertEquals(1f, beyondCamera, .0001f)
    }

    @Test
    fun `occlusion shoulder eases instead of popping`() {
        val alpha = SceneCameraOcclusion.treeAlpha(
            heroX = 0f,
            heroZ = 0f,
            cameraX = 0f,
            cameraZ = 6f,
            treeX = 1.05f,
            treeZ = 3f,
            treeRadius = .8f,
        )

        assertTrue(alpha > .16f)
        assertTrue(alpha < 1f)
    }

    @Test
    fun `animal on follow sightline yields without shortening camera boom`() {
        val alpha = SceneCameraOcclusion.sightlineAlpha(
            heroX = 0f,
            heroZ = 0f,
            cameraX = 0f,
            cameraZ = 6f,
            blockerX = .12f,
            blockerZ = 3.1f,
            blockerRadius = .82f,
            minimumAlpha = .08f,
            shoulderWidth = .65f,
        )

        assertEquals(.08f, alpha, .0001f)
    }
}
