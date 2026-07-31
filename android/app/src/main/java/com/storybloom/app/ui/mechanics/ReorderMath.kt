package com.storybloom.app.ui.mechanics

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

object ReorderMath {
    const val ThumbnailSize = 96f
    const val GridGap = 12f
    const val PageListGap = 12f
    const val PageHysteresis = 10f
    const val FallbackPageHeight = 100f

    fun gridTargetIndex(
        index: Int,
        translationX: Float,
        translationY: Float,
        columns: Int,
        totalCount: Int,
        horizontalSlot: Float,
        verticalSlot: Float,
    ): Int {
        if (totalCount <= 0) return -1
        val safeColumns = max(1, columns)
        val column = index % safeColumns
        val row = index / safeColumns
        val targetColumn = (
            column + translationX / horizontalSlot
            ).roundToInt().coerceIn(0, safeColumns - 1)
        val targetRow = max(0, (row + translationY / verticalSlot).roundToInt())
        return (targetRow * safeColumns + targetColumn).coerceIn(0, totalCount - 1)
    }

    fun gridSiblingDeltaSlots(index: Int, from: Int, to: Int): Int {
        if (from < 0 || to < 0 || index == from) return 0
        return when {
            to > from && index in (from + 1)..to -> -1
            to < from && index in to until from -> 1
            else -> 0
        }
    }

    fun verticalTargetIndex(
        index: Int,
        translationY: Float,
        heights: List<Float>,
        currentTarget: Int,
        gap: Float = PageListGap,
        hysteresis: Float = PageHysteresis,
    ): Int {
        if (heights.isEmpty()) return -1
        val myHeight = heights.getOrNull(index).orUsable(FallbackPageHeight)
        fun heightOf(slot: Int): Float = heights.getOrNull(slot).orUsable(myHeight)

        var cumulative = 0f
        repeat(index.coerceAtMost(heights.size)) { slot ->
            cumulative += heightOf(slot) + gap
        }
        val centerY = cumulative + translationY + myHeight / 2f

        if (currentTarget in heights.indices) {
            var currentStart = 0f
            repeat(currentTarget) { slot ->
                currentStart += heightOf(slot) + gap
            }
            val currentSlot = heightOf(currentTarget) + gap
            if (
                centerY >= currentStart - hysteresis &&
                centerY < currentStart + currentSlot + hysteresis
            ) {
                return currentTarget
            }
        }

        var accumulated = 0f
        for (slot in heights.indices) {
            val slotHeight = heightOf(slot) + gap
            if (centerY < accumulated + slotHeight) return slot
            accumulated += slotHeight
        }
        return max(0, heights.lastIndex)
    }

    /**
     * Natural layout delta from the old slot to the new one. Rebase the
     * dragged item's translation by subtracting this value on commit, so its
     * absolute position remains continuous across the reorder layout pass.
     */
    fun verticalSettleOffset(
        from: Int,
        to: Int,
        heights: List<Float>,
        gap: Float = PageListGap,
    ): Float {
        if (from !in heights.indices || to !in heights.indices || from == to) return 0f
        val myHeight = heights[from].orUsable(FallbackPageHeight)
        fun heightOf(slot: Int): Float = heights.getOrNull(slot).orUsable(myHeight)

        var oldOffset = 0f
        repeat(from) { slot -> oldOffset += heightOf(slot) + gap }

        var newOffset = 0f
        var newSlot = 0
        var oldIndex = 0
        while (oldIndex < heights.size && newSlot < to) {
            if (oldIndex != from) {
                newOffset += heightOf(oldIndex) + gap
                newSlot++
            }
            oldIndex++
        }
        return newOffset - oldOffset
    }

    fun verticalSiblingShift(
        index: Int,
        from: Int,
        to: Int,
        heights: List<Float>,
        gap: Float = PageListGap,
    ): Float {
        if (from !in heights.indices || index !in heights.indices || index == from) return 0f
        val draggedHeight = heights[from]
            .orUsable(heights[index].orUsable(FallbackPageHeight)) + gap
        return when {
            to > from && index in (from + 1)..to -> -draggedHeight
            to < from && index in to until from -> draggedHeight
            else -> 0f
        }
    }

    fun <T> moved(items: List<T>, from: Int, to: Int): List<T> {
        if (from !in items.indices || to !in items.indices || from == to) return items
        val result = items.toMutableList()
        val item = result.removeAt(from)
        result.add(to, item)
        return result
    }

    private fun Float?.orUsable(fallback: Float): Float =
        if (this != null && this > 0f) this else fallback
}
