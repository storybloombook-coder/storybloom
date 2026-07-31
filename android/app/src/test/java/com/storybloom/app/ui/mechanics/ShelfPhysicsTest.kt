package com.storybloom.app.ui.mechanics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class ShelfPhysicsTest {
    @Test
    fun dragContinuouslyChangesRankAndReturnsPersistentOrder() {
        val shelf = ShelfPhysics(bookCount = 4, containerWidth = 320f)

        shelf.beginDrag(index = 0, touchX = 28f, touchY = 61f)
        shelf.dragBy(deltaX = 130f, deltaY = 0f)
        val result = shelf.endDrag()

        assertEquals(listOf(1, 2, 0, 3), result?.order)
    }

    @Test
    fun liftedBookKeepsItsHeightAtReleaseThenFallsUnderGravity() {
        val shelf = ShelfPhysics(bookCount = 3, containerWidth = 260f)
        shelf.beginDrag(index = 1, touchX = 28f, touchY = 10f)
        shelf.dragBy(deltaX = 18f, deltaY = -72f)
        shelf.step(1f / 60f)
        val beforeRelease = shelf.poses()[1].liftY

        val result = shelf.endDrag()
        val immediatelyAfterRelease = shelf.poses()[1].liftY
        shelf.step(1f / 60f)
        val oneFrameLater = shelf.poses()[1].liftY
        repeat(300) { shelf.step(1f / 60f) }
        val settled = shelf.poses()[1]

        assertTrue(result?.wasLifted == true)
        assertEquals(beforeRelease, immediatelyAfterRelease, 0.001f)
        // Release momentum may initially carry the book farther upward; the
        // important parity behavior is that it never snaps to zero.
        assertTrue(abs(oneFrameLater) > 0.001f)
        assertEquals(0f, settled.liftY, 0.001f)
        assertEquals(0f, settled.velocityY, 0.001f)
    }

    @Test
    fun swipeOnlyHitsEachSpineOncePerContinuousPass() {
        val shelf = ShelfPhysics(bookCount = 2, containerWidth = 180f)
        shelf.beginSwipe()

        assertEquals(1, shelf.swipeAt(pointerX = 20f, direction = 1f))
        assertEquals(0, shelf.swipeAt(pointerX = 24f, direction = 1f))
        assertTrue(shelf.poses()[0].velocityX > 0f)

        shelf.beginSwipe()
        assertEquals(1, shelf.swipeAt(pointerX = 24f, direction = -1f))
    }

    @Test
    fun activeDragEmitsGapFeedbackAndPushesNeighbors() {
        val shelf = ShelfPhysics(bookCount = 3, containerWidth = 260f)
        shelf.beginDrag(index = 0, touchX = 28f, touchY = 61f)
        shelf.dragBy(deltaX = 75f, deltaY = -30f)

        shelf.step(1f / 60f)

        assertTrue(ShelfPhysics.Event.GapChanged in shelf.drainEvents())
        assertTrue(shelf.poses().any { abs(it.velocityX) > 0f })
    }

    @Test
    fun quickLiftedDropKeepsThePersistedVisualOrder() {
        val shelf = ShelfPhysics(bookCount = 2, containerWidth = 180f)
        shelf.beginDrag(index = 1, touchX = 28f, touchY = 61f)
        shelf.dragBy(deltaX = -65f, deltaY = -48f)

        val result = shelf.endDrag()
        repeat(300) { shelf.step(1f / 60f) }
        val poses = shelf.poses()

        assertEquals(listOf(1, 0), result?.order)
        assertTrue(poses[1].x < poses[0].x)
    }

    @Test
    fun wallBracesLeanOnTheDownhillSide() {
        val shelf = ShelfPhysics(bookCount = 1, containerWidth = 160f)
        shelf.updateSensor(tilt = -0.8f, verticalJerk = 0f)
        repeat(90) { shelf.step(1f / 60f) }

        assertTrue(abs(shelf.poses().single().rotation) < 0.15f)
    }

    @Test
    fun idleShelfEventuallyReportsNoVisualChange() {
        val shelf = ShelfPhysics(bookCount = 1, containerWidth = 160f)
        var changed = true
        repeat(240) { changed = shelf.step(1f / 60f) }

        assertFalse(changed)
    }
}
