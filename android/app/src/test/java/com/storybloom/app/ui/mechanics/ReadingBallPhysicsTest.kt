package com.storybloom.app.ui.mechanics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class ReadingBallPhysicsTest {
    @Test
    fun measuredWordsAreGroupedByTheirActualWrappedYPositions() {
        val rows = groupMeasuredWordRows(
            mapOf(
                0 to WordBounds(0f, 16f, 30f, 20f),
                1 to WordBounds(36f, 17f, 44f, 20f),
                2 to WordBounds(0f, 58f, 38f, 20f),
            ),
        )

        assertEquals(listOf(0, 2), rows.rowStarts)
        assertEquals(mapOf(0 to 0, 1 to 0, 2 to 1), rows.rowByWord)
    }

    @Test
    fun targetsMeasuredWordCenterAndSettlesAboveIt() {
        val ball = ReadingBallPhysics()
        val word = WordBounds(x = 80f, y = 140f, width = 40f, height = 30f)
        ball.target(wordIndex = 2, rowIndex = 1, bounds = word)

        repeat(360) { ball.step(1f / 60f) }
        val (x, y) = ball.basePosition()

        assertEquals(84f, x, 0.3f)
        assertEquals(102f, y, 0.3f)
        assertEquals(
            ReadingBallPhysics.Arrival(wordIndex = 2, rowIndex = 1),
            ball.drainArrivals().last(),
        )
    }

    @Test
    fun newTargetAddsAnUpwardBallisticArc() {
        val ball = ReadingBallPhysics()
        val word = WordBounds(x = 60f, y = 120f, width = 50f, height = 28f)
        ball.target(0, 0, word)
        ball.step(0.13f)

        assertTrue(ball.pose().y < ball.basePosition().second)
    }

    @Test
    fun dragUsesTrueBallCenterToChooseNearestWord() {
        val ball = ReadingBallPhysics()
        val words = mapOf(
            0 to WordBounds(10f, 80f, 35f, 26f),
            1 to WordBounds(100f, 80f, 35f, 26f),
        )
        ball.target(0, 0, words.getValue(0))
        repeat(240) { ball.step(1f / 60f) }
        ball.beginDrag()
        ball.dragBy(88f, 38f)

        assertEquals(1, ball.endDrag(words))
    }

    @Test
    fun draggingStopsBounceFromFightingTheFinger() {
        val ball = ReadingBallPhysics()
        ball.target(0, 0, WordBounds(20f, 100f, 40f, 24f))
        repeat(180) { ball.step(1f / 60f) }
        ball.beginDrag()
        val before = ball.pose()
        ball.dragBy(12f, -7f)
        val after = ball.pose()

        assertEquals(12f, after.x - before.x, 0.001f)
        assertEquals(-7f, after.y - before.y, 0.001f)
        assertTrue(abs(after.scaleX - 1.16f) < 0.001f)
        assertTrue(abs(after.scaleY - 0.82f) < 0.001f)
    }
}
