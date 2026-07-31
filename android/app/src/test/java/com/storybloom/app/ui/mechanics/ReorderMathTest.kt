package com.storybloom.app.ui.mechanics

import org.junit.Assert.assertEquals
import org.junit.Test

class ReorderMathTest {
    @Test
    fun gridTargetTracksRowsAndColumns() {
        assertEquals(
            5,
            ReorderMath.gridTargetIndex(
                index = 0,
                translationX = 220f,
                translationY = 110f,
                columns = 3,
                totalCount = 8,
                horizontalSlot = 108f,
                verticalSlot = 108f,
            ),
        )
    }

    @Test
    fun gridSiblingSlotsOpenOneLiveGap() {
        assertEquals(-1, ReorderMath.gridSiblingDeltaSlots(1, from = 0, to = 3))
        assertEquals(-1, ReorderMath.gridSiblingDeltaSlots(3, from = 0, to = 3))
        assertEquals(0, ReorderMath.gridSiblingDeltaSlots(4, from = 0, to = 3))
        assertEquals(1, ReorderMath.gridSiblingDeltaSlots(1, from = 3, to = 0))
    }

    @Test
    fun verticalTargetUsesMeasuredVariableHeights() {
        val heights = listOf(80f, 180f, 110f)
        assertEquals(
            1,
            ReorderMath.verticalTargetIndex(
                index = 0,
                translationY = 230f,
                heights = heights,
                currentTarget = 0,
            ),
        )
    }

    @Test
    fun verticalTargetSticksInsideHysteresisBand() {
        val heights = listOf(100f, 100f, 100f)
        assertEquals(
            1,
            ReorderMath.verticalTargetIndex(
                index = 0,
                translationY = 59f,
                heights = heights,
                currentTarget = 1,
            ),
        )
    }

    @Test
    fun settleOffsetAccountsForEveryVariableHeightCrossed() {
        val heights = listOf(80f, 140f, 120f, 90f)
        assertEquals(
            284f,
            ReorderMath.verticalSettleOffset(
                from = 0,
                to = 2,
                heights = heights,
            ),
            0.001f,
        )
        assertEquals(
            -244f,
            ReorderMath.verticalSettleOffset(
                from = 2,
                to = 0,
                heights = heights,
            ),
            0.001f,
        )
    }

    @Test
    fun movedPreservesEveryOtherItemsOrder() {
        assertEquals(
            listOf("b", "c", "a", "d"),
            ReorderMath.moved(listOf("a", "b", "c", "d"), 0, 2),
        )
    }
}
