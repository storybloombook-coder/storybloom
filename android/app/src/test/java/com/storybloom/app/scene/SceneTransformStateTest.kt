package com.storybloom.app.scene

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneTransformStateTest {
    @Test
    fun oneFingerOrbitChangesOnlyCameraTransform() {
        val state = SceneTransformState()
        val before = state.snapshot()

        state.orbitBy(yawDegrees = 18f, pitchDegrees = -7f)
        val after = state.snapshot()

        assertNotEquals(before.cameraYaw, after.cameraYaw)
        assertNotEquals(before.cameraPitch, after.cameraPitch)
        assertEquals(before.cameraDistance, after.cameraDistance)
        assertEquals(before.sceneRotation, after.sceneRotation)
        assertEquals(before.kolobokRotation, after.kolobokRotation)
        assertEquals(before.storyTime, after.storyTime)
    }

    @Test
    fun sceneAndModelAnimationNeverMutateCameraOrbit() {
        val state = SceneTransformState()
        state.orbitBy(31f, 9f)
        state.setSceneRotationEnabled(true)
        val camera = state.snapshot()

        repeat(300) { state.advance(1f / 60f) }
        val animated = state.snapshot()

        assertEquals(camera.cameraYaw, animated.cameraYaw)
        assertEquals(camera.cameraPitch, animated.cameraPitch)
        assertEquals(camera.cameraDistance, animated.cameraDistance)
        assertNotEquals(camera.sceneRotation, animated.sceneRotation)
        assertNotEquals(camera.kolobokRotation, animated.kolobokRotation)
        assertTrue(animated.storyTime > camera.storyTime)
    }

    @Test
    fun disablingSceneRotationDoesNotPauseCharacterOrCamera() {
        val state = SceneTransformState()
        state.setSceneRotationEnabled(false)
        state.orbitBy(4f, 3f)
        repeat(80) { state.advance(.05f) }
        val before = state.snapshot()
        state.advance(.05f)
        val after = state.snapshot()

        assertEquals(before.sceneRotation, after.sceneRotation)
        assertNotEquals(before.kolobokRotation, after.kolobokRotation)
        assertEquals(before.cameraYaw, after.cameraYaw)
        assertEquals(before.cameraPitch, after.cameraPitch)
    }

    @Test
    fun kolobokWaitsForTheIntroThenRollsWithoutSliding() {
        val state = SceneTransformState()

        repeat(80) { state.advance(.05f) }
        assertEquals(0f, state.snapshot().kolobokRotation)

        state.advance(.05f)
        assertEquals(
            SceneMotion.rollDegreesPerSecond * .05f,
            state.snapshot().kolobokRotation,
            .001f,
        )
    }

    @Test
    fun orbitNeverMovesCameraBelowTheField() {
        val state = SceneTransformState()

        state.orbitBy(yawDegrees = 0f, pitchDegrees = -500f)

        assertEquals(14f, state.snapshot().cameraPitch)
    }

    @Test
    fun followModeMovesCloserWithoutOwningTheWorldRotation() {
        val state = SceneTransformState()
        val before = state.snapshot()

        state.setFollowKolobok(true)
        val following = state.snapshot()
        state.zoomBy(1.12f)
        val adjustedFollowDistance = state.snapshot().cameraDistance
        state.setFollowKolobok(true)
        state.setSceneRotationEnabled(true)
        state.advance(.1f)
        val animated = state.snapshot()

        assertTrue(following.followKolobok)
        assertTrue(following.cameraDistance < before.cameraDistance)
        assertEquals(adjustedFollowDistance, animated.cameraDistance)
        assertTrue(animated.followKolobok)
        assertNotEquals(following.sceneRotation, animated.sceneRotation)

        state.setFollowKolobok(false)
        val restored = state.snapshot()
        assertTrue(!restored.followKolobok)
        assertEquals(before.cameraYaw, restored.cameraYaw)
        assertEquals(before.cameraPitch, restored.cameraPitch)
        assertEquals(before.cameraDistance, restored.cameraDistance)
    }
}
