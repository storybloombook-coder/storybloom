package com.storybloom.app.scene

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TreeBonkPhysicsTest {
    @Test
    fun `finger hold reaches full bonk and release settles`() {
        val state = TreeBonkState()
        TreeBonkPhysics.hold(state, 1f, 0f)

        val held = TreeBonkPhysics.advance(state, .016f, 2f, 2f, -4f, -4f)
        assertTrue(held.active)
        assertEquals(TreeBonkPhysics.PUSH_MAX * 1.15f, held.pushDistance, .0001f)
        assertEquals(1f, held.directionX, .0001f)

        TreeBonkPhysics.release(state)
        val released = TreeBonkPhysics.advance(state, .016f, 2f, 2f, -4f, -4f)
        assertTrue(released.active)

        repeat(90) {
            TreeBonkPhysics.advance(state, 1f / 60f, 2f, 2f, -4f, -4f)
        }
        val settled = TreeBonkPhysics.advance(state, .016f, 2f, 2f, -4f, -4f)
        assertFalse(settled.active)
        assertEquals(0f, settled.pushDistance, .0001f)
    }

    @Test
    fun `Kolobok overlap holds tree away until he clears`() {
        val state = TreeBonkState()

        repeat(12) {
            TreeBonkPhysics.advance(state, 1f / 60f, 0f, 0f, .4f, 0f)
        }
        val touching = TreeBonkPhysics.advance(state, .016f, 0f, 0f, .4f, 0f)
        assertTrue(touching.active)
        assertTrue(touching.pushDistance > TreeBonkPhysics.PUSH_MAX * .9f)
        assertTrue(touching.directionX < 0f)

        val clearing = TreeBonkPhysics.advance(state, .05f, 0f, 0f, 3f, 0f)
        assertTrue(clearing.active)
        assertTrue(clearing.pushDistance >= 0f)
    }

    @Test
    fun `spring never reverses through the character`() {
        var seconds = 0f
        while (seconds <= TreeBonkPhysics.DURATION_SECONDS) {
            assertTrue(TreeBonkPhysics.springEnvelope(seconds) >= 0f)
            seconds += .01f
        }
    }
}
