package com.storybloom.app.ui.mechanics

import kotlin.math.abs
import kotlin.math.max

data class WordBounds(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
) {
    val centerX: Float get() = x + width / 2f
    val centerY: Float get() = y + height / 2f
}

data class WordRows(
    val rowByWord: Map<Int, Int>,
    val rowStarts: List<Int>,
)

fun groupMeasuredWordRows(
    words: Map<Int, WordBounds>,
    yTolerance: Float = 4f,
): WordRows {
    val rowByWord = mutableMapOf<Int, Int>()
    val starts = mutableListOf<Int>()
    var lastY: Float? = null
    var row = -1
    words.entries.sortedBy { it.key }.forEach { (index, bounds) ->
        val previousY = lastY
        if (previousY == null || abs(bounds.y - previousY) > yTolerance) {
            row++
            starts += index
            lastY = bounds.y
        }
        rowByWord[index] = row
    }
    return WordRows(rowByWord = rowByWord, rowStarts = starts)
}

/**
 * Density-independent physics for the reader's Kolobok cursor. Its spring,
 * ballistic hop, idle bounce, squash/stretch and drop hit-testing are kept
 * outside Compose so visual layout and speech state can retarget the same
 * continuous object without restarting canned animations.
 */
class ReadingBallPhysics {
    data class Pose(
        val x: Float,
        val y: Float,
        val opacity: Float,
        val scaleX: Float,
        val scaleY: Float,
        val isDragging: Boolean,
    )

    data class Arrival(
        val wordIndex: Int,
        val rowIndex: Int,
    )

    private var x = 0f
    private var y = 0f
    private var velocityX = 0f
    private var velocityY = 0f
    private var targetX = 0f
    private var targetY = 0f
    private var targetWord = -1
    private var targetRow = -1
    private var targetGeneration = 0
    private var arrivedGeneration = -1
    private var opacity = 0f
    private var opacityTarget = 0f
    private var bounceElapsed = 0f
    private var arcElapsed = ARC_DURATION
    private var dragging = false
    private val arrivals = ArrayDeque<Arrival>()

    fun reset() {
        x = 0f
        y = 0f
        velocityX = 0f
        velocityY = 0f
        targetX = 0f
        targetY = 0f
        targetWord = -1
        targetRow = -1
        targetGeneration++
        arrivedGeneration = -1
        opacity = 0f
        opacityTarget = 0f
        bounceElapsed = 0f
        arcElapsed = ARC_DURATION
        dragging = false
        arrivals.clear()
    }

    fun hide() {
        targetWord = -1
        targetRow = -1
        opacityTarget = 0f
    }

    fun target(wordIndex: Int, rowIndex: Int, bounds: WordBounds) {
        val isNewWord = wordIndex != targetWord
        val destinationChanged = isNewWord || rowIndex != targetRow
        targetWord = wordIndex
        targetRow = rowIndex
        targetX = bounds.centerX - BALL_SIZE / 2f
        targetY = bounds.y - BALL_SIZE - WORD_CLEARANCE
        if (destinationChanged) {
            targetGeneration++
        }
        if (isNewWord) {
            arcElapsed = 0f
        }
        opacityTarget = 1f
    }

    fun beginDrag() {
        if (opacity <= 0f) return
        dragging = true
        bounceElapsed = 0f
        arcElapsed = ARC_DURATION
        velocityX = 0f
        velocityY = 0f
    }

    fun dragBy(deltaX: Float, deltaY: Float) {
        if (!dragging) return
        x += deltaX
        y += deltaY
    }

    /**
     * Resolves to the nearest measured word using the ball's true center.
     * The caller updates the speech cursor immediately, then calls [target]
     * with the returned word's current row/bounds.
     */
    fun endDrag(words: Map<Int, WordBounds>): Int {
        if (!dragging) return -1
        dragging = false
        bounceElapsed = 0f
        if (words.isEmpty()) return targetWord
        val centerX = x + BALL_SIZE / 2f
        val centerY = y + BALL_SIZE / 2f
        return words.minByOrNull { (_, bounds) ->
            val dx = bounds.centerX - centerX
            val dy = bounds.centerY - centerY
            dx * dx + dy * dy
        }?.key ?: targetWord
    }

    fun cancelDrag() {
        dragging = false
        bounceElapsed = 0f
    }

    fun step(rawDeltaSeconds: Float): Boolean {
        val dt = rawDeltaSeconds.coerceIn(0f, MAX_DT)
        if (dt <= 0f) return false

        val oldX = x
        val oldY = y
        val oldOpacity = opacity
        val oldBounce = bounceElapsed
        val oldArc = arcElapsed

        if (!dragging && targetWord >= 0) {
            val accelerationX =
                (-SPRING_STIFFNESS * (x - targetX) - SPRING_DAMPING * velocityX) /
                    SPRING_MASS
            val accelerationY =
                (-SPRING_STIFFNESS * (y - targetY) - SPRING_DAMPING * velocityY) /
                    SPRING_MASS
            velocityX += accelerationX * dt
            velocityY += accelerationY * dt
            x += velocityX * dt
            y += velocityY * dt

            if (
                arrivedGeneration != targetGeneration &&
                abs(y - targetY) < POSITION_EPSILON &&
                abs(velocityY) < VELOCITY_EPSILON
            ) {
                y = targetY
                velocityY = 0f
                arrivedGeneration = targetGeneration
                arrivals += Arrival(targetWord, targetRow)
            }
        }

        val opacityStep = dt / OPACITY_DURATION
        opacity = when {
            opacity < opacityTarget -> minOf(opacityTarget, opacity + opacityStep)
            opacity > opacityTarget -> maxOf(opacityTarget, opacity - opacityStep)
            else -> opacity
        }

        if (!dragging) {
            bounceElapsed = (bounceElapsed + dt) % BOUNCE_DURATION
            if (arcElapsed < ARC_DURATION) arcElapsed = minOf(ARC_DURATION, arcElapsed + dt)
        }

        return abs(oldX - x) > 0.0001f ||
            abs(oldY - y) > 0.0001f ||
            abs(oldOpacity - opacity) > 0.0001f ||
            oldBounce != bounceElapsed ||
            oldArc != arcElapsed
    }

    fun pose(): Pose {
        val bounce = if (dragging) 0f else bounceValue()
        val arc = if (dragging) 0f else arcValue()
        return Pose(
            x = x,
            y = y - bounce * BOB_AMPLITUDE - arc * ARC_HEIGHT,
            opacity = opacity.coerceIn(0f, 1f),
            scaleX = 1.16f + (0.94f - 1.16f) * bounce,
            scaleY = 0.82f + (1.08f - 0.82f) * bounce,
            isDragging = dragging,
        )
    }

    fun basePosition(): Pair<Float, Float> = x to y

    fun currentTargetWord(): Int = targetWord

    fun drainArrivals(): List<Arrival> = buildList {
        while (arrivals.isNotEmpty()) add(arrivals.removeFirst())
    }

    private fun bounceValue(): Float {
        val half = BOUNCE_DURATION / 2f
        return if (bounceElapsed <= half) {
            bounceElapsed / half
        } else {
            1f - (bounceElapsed - half) / half
        }
    }

    private fun arcValue(): Float {
        if (arcElapsed >= ARC_DURATION) return 0f
        val half = ARC_DURATION / 2f
        return if (arcElapsed <= half) {
            // Easing.out(quad)
            val t = arcElapsed / half
            1f - (1f - t) * (1f - t)
        } else {
            // The second half is 1 -> 0 with Easing.in(quad).
            val t = (arcElapsed - half) / half
            1f - t * t
        }
    }

    companion object {
        const val BALL_SIZE = 32f
        const val WORD_CLEARANCE = 6f
        private const val BOB_AMPLITUDE = 12f * 0.85f * 0.8f
        private const val ARC_HEIGHT = 26f
        private const val ARC_DURATION = 0.260f
        private const val BOUNCE_DURATION = 0.640f
        private const val OPACITY_DURATION = 0.150f
        private const val SPRING_DAMPING = 16f
        private const val SPRING_STIFFNESS = 180f
        private const val SPRING_MASS = 0.85f
        private const val POSITION_EPSILON = 0.25f
        private const val VELOCITY_EPSILON = 1f
        private const val MAX_DT = 0.032f
    }
}
