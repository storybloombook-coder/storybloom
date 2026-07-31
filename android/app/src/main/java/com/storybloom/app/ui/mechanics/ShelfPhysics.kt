package com.storybloom.app.ui.mechanics

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sign
import kotlin.math.sin

/**
 * The native counterpart of the predecessor's physical bookshelf.
 *
 * Coordinates are kept in density-independent pixels. Compose converts only
 * at the rendering/input boundary, which preserves the original tuning on
 * phones and emulators with different display densities.
 */
class ShelfPhysics(
    bookCount: Int,
    containerWidth: Float,
) {
    data class Pose(
        val x: Float,
        val liftY: Float,
        val rotation: Float,
        val bounceY: Float,
        val velocityX: Float,
        val velocityY: Float,
        val rotationVelocity: Float,
        val isDragged: Boolean,
        val isLifted: Boolean,
    )

    enum class Event {
        GapChanged,
        SwipeHit,
    }

    data class DragResult(
        val order: List<Int>,
        val wasLifted: Boolean,
    )

    private val count = bookCount
    private var width = containerWidth
    private val xs = FloatArray(count) { index -> WALL_WIDTH + index * SLOT }
    private val velocities = FloatArray(count)
    private val rotations = FloatArray(count)
    private val rotationVelocities = FloatArray(count)
    private val liftYs = FloatArray(count)
    private val liftVelocities = FloatArray(count)
    private val order = MutableList(count) { it }
    private val swiped = mutableSetOf<Int>()
    private val pendingEvents = ArrayDeque<Event>()

    private var draggingIndex = -1
    private var dragStartX = 0f
    private var dragTranslationX = 0f
    private var dragTranslationY = 0f
    private var lastDragX = 0f
    private var lastDragLiftY = 0f
    private var grabOffsetFraction = 0f
    private var grabOffsetX = 0f
    private var grabOffsetY = 0f
    private var gapLeft = -1
    private var gapRight = -1

    private var tiltX = 0f
    private var jerkY = 0f
    private var bounceY = 0f
    private var bounceVelocityY = 0f

    fun updateContainerWidth(containerWidth: Float) {
        width = containerWidth
        clampToWalls()
    }

    fun updateSensor(tilt: Float, verticalJerk: Float) {
        tiltX = tilt
        jerkY = verticalJerk
    }

    fun beginDrag(index: Int, touchX: Float, touchY: Float): Boolean {
        if (index !in 0 until count) return false
        draggingIndex = index
        dragStartX = xs[index]
        dragTranslationX = 0f
        dragTranslationY = 0f
        lastDragX = xs[index]
        liftYs[index] = 0f
        liftVelocities[index] = 0f
        lastDragLiftY = 0f
        grabOffsetFraction = ((touchY - VISIBLE_HEIGHT / 2f) / (VISIBLE_HEIGHT / 2f))
            .coerceIn(-1f, 1f)
        grabOffsetX = touchX - SPINE_WIDTH / 2f
        grabOffsetY = touchY - VISIBLE_HEIGHT / 2f
        return true
    }

    fun dragBy(deltaX: Float, deltaY: Float) {
        val index = draggingIndex
        if (index !in 0 until count) return
        dragTranslationX += deltaX
        dragTranslationY += deltaY
        xs[index] = (dragStartX + dragTranslationX).coerceIn(WALL_WIDTH, maxX())
        reorderForDraggedBook(index, xs[index])
        liftYs[index] = dragTranslationY.coerceIn(LIFT_MIN, LIFT_MAX)
    }

    fun cancelDrag(): DragResult? = finishDrag()

    fun endDrag(): DragResult? = finishDrag()

    private fun finishDrag(): DragResult? {
        val index = draggingIndex
        if (index !in 0 until count) return null
        stabilizePhysicalOrder()
        val result = DragResult(
            order = order.toList(),
            wasLifted = abs(liftYs[index]) > LIFT_THRESHOLD,
        )
        draggingIndex = -1
        return result
    }

    /**
     * A lifted book is allowed to overlap the shelf while it is in the air.
     * If it is released immediately after crossing a neighbor, both books can
     * therefore have the same x coordinate. Kotlin's stable sort would then
     * put the original array index first during collision resolution, undoing
     * the visible order even though the new order was already persisted.
     *
     * Preserve the exact occupied coordinates, but assign them in the live
     * rank order and break ties by a sub-pixel amount. Collision resolution
     * can then make the landing physical without silently reversing the drop.
     */
    private fun stabilizePhysicalOrder() {
        if (count < 2) return
        val rankedPositions = xs.sorted().toMutableList()
        for (rank in 1 until rankedPositions.size) {
            rankedPositions[rank] = max(
                rankedPositions[rank],
                rankedPositions[rank - 1] + RELEASE_ORDER_EPSILON,
            )
        }
        val overflow = rankedPositions.last() - maxX()
        if (overflow > 0f) {
            for (rank in rankedPositions.indices) {
                rankedPositions[rank] -= overflow
            }
        }
        order.forEachIndexed { rank, bookIndex ->
            xs[bookIndex] = rankedPositions[rank]
        }
    }

    fun beginSwipe() {
        swiped.clear()
    }

    /**
     * Gives each crossed spine one impulse per continuous swipe, matching the
     * predecessor's simultaneous shelf gesture.
     */
    fun swipeAt(pointerX: Float, direction: Float): Int {
        if (draggingIndex != -1 || direction == 0f) return 0
        val impulseDirection = sign(direction)
        var hits = 0
        for (index in 0 until count) {
            if (index in swiped) continue
            if (pointerX < xs[index] || pointerX > xs[index] + SPINE_WIDTH) continue
            velocities[index] += impulseDirection * SWIPE_IMPULSE
            rotationVelocities[index] += impulseDirection * SWIPE_WIGGLE
            swiped += index
            pendingEvents += Event.SwipeHit
            hits++
        }
        return hits
    }

    fun isDragging(): Boolean = draggingIndex >= 0

    fun orderedIndices(): List<Int> = order.toList()

    fun poses(): List<Pose> = List(count) { index ->
        Pose(
            x = xs[index],
            liftY = liftYs[index],
            rotation = rotations[index],
            bounceY = bounceY,
            velocityX = velocities[index],
            velocityY = liftVelocities[index],
            rotationVelocity = rotationVelocities[index],
            isDragged = index == draggingIndex,
            isLifted = abs(liftYs[index]) > LIFT_THRESHOLD,
        )
    }

    fun drainEvents(): List<Event> = buildList {
        while (pendingEvents.isNotEmpty()) add(pendingEvents.removeFirst())
    }

    /**
     * Advances the shelf by one display frame. Returns true when the rendered
     * pose may have changed.
     */
    fun step(rawDeltaSeconds: Float): Boolean {
        if (count == 0) return false
        val dt = rawDeltaSeconds.coerceIn(0f, MAX_DT)
        if (dt <= 0f) return false

        val oldBounce = bounceY
        val bounceSpring = -bounceY * BOUNCE_STIFFNESS
        val bounceDamping = -bounceVelocityY * BOUNCE_DAMPING
        bounceVelocityY += (bounceSpring + bounceDamping + jerkY * BOUNCE_STRENGTH) * dt
        bounceY = (bounceY + bounceVelocityY * dt).coerceIn(-BOUNCE_MAX, BOUNCE_MAX)

        // Translation by tilt remains deliberately disabled, as in the last
        // web release. Sensor tilt still drives visible lean and vertical jerk.
        val gravity = 0f
        if (
            draggingIndex == -1 &&
            gravity == 0f &&
            abs(tiltX) <= TILT_DEADZONE &&
            abs(oldBounce - bounceY) < SETTLED_BOUNCE_EPSILON &&
            isSettled()
        ) {
            return false
        }

        val nextXs = xs.copyOf()
        val nextVelocities = velocities.copyOf()
        val nextRotations = rotations.copyOf()
        val nextRotationVelocities = rotationVelocities.copyOf()
        val nextLiftYs = liftYs.copyOf()
        val nextLiftVelocities = liftVelocities.copyOf()
        val maxX = maxX()

        val draggedVelocity = if (draggingIndex >= 0) {
            (xs[draggingIndex] - lastDragX) / dt
        } else {
            0f
        }
        if (draggingIndex >= 0) lastDragX = xs[draggingIndex]

        val draggedLiftVelocity = if (draggingIndex >= 0) {
            (liftYs[draggingIndex] - lastDragLiftY) / dt
        } else {
            0f
        }
        if (draggingIndex >= 0) lastDragLiftY = liftYs[draggingIndex]

        val draggedLifted = draggingIndex >= 0 &&
            abs(liftYs[draggingIndex]) > LIFT_THRESHOLD

        updateGapReaction(nextVelocities, nextRotationVelocities)

        for (index in 0 until count) {
            val isDragged = index == draggingIndex
            val isLifted = abs(liftYs[index]) > LIFT_THRESHOLD
            var restTarget = 0f

            if (isDragged && isLifted) {
                val cornerHang = atan2(grabOffsetX, grabOffsetY) * (180f / PI.toFloat())
                val tiltLean = if (abs(tiltX) > TILT_DEADZONE) {
                    tiltX * TILT_LEAN_DEGREES_PER_UNIT
                } else {
                    0f
                }
                restTarget = (
                    cornerHang * CORNER_HANG_STRENGTH + tiltLean
                    ).coerceIn(-FALL_ROTATION_DEGREES, FALL_ROTATION_DEGREES)
            } else if (!isDragged && abs(tiltX) > TILT_DEADZONE) {
                val atLeftWall = nextXs[index] <= WALL_WIDTH + 0.5f
                val atRightWall = nextXs[index] >= maxX - 0.5f
                val bracedByWall = (tiltX < 0f && atLeftWall) ||
                    (tiltX > 0f && atRightWall)
                if (!bracedByWall) {
                    restTarget = sign(tiltX) * min(
                        MAX_LEAN_DEGREES,
                        abs(tiltX) * TILT_LEAN_DEGREES_PER_UNIT,
                    )
                }
            }

            val torque = if (isDragged) {
                grabOffsetFraction * draggedVelocity * ROTATION_TORQUE
            } else {
                0f
            }
            val rotationSpring =
                -(nextRotations[index] - restTarget) * ROTATION_STIFFNESS
            val rotationDamping = -nextRotationVelocities[index] * ROTATION_DAMPING
            nextRotationVelocities[index] +=
                (rotationSpring + rotationDamping + torque) * dt
            val rotationLimit = if (isDragged && !isLifted) {
                ROTATION_MAX
            } else {
                FALL_ROTATION_DEGREES
            }
            nextRotations[index] = (
                nextRotations[index] + nextRotationVelocities[index] * dt
                ).coerceIn(-rotationLimit, rotationLimit)

            if (isDragged) {
                nextLiftVelocities[index] = draggedLiftVelocity
            } else {
                val liftDamping = -nextLiftVelocities[index] * DAMPING
                nextLiftVelocities[index] += (liftDamping + LIFT_GRAVITY) * dt
                nextLiftYs[index] += nextLiftVelocities[index] * dt
                when {
                    nextLiftYs[index] > 0f -> {
                        nextLiftYs[index] = 0f
                        nextLiftVelocities[index] = 0f
                    }

                    nextLiftYs[index] < LIFT_MIN -> {
                        nextLiftYs[index] = LIFT_MIN
                        if (nextLiftVelocities[index] < 0f) {
                            nextLiftVelocities[index] = 0f
                        }
                    }
                }
            }

            if (isDragged) {
                nextVelocities[index] = draggedVelocity
            } else {
                val dampingForce = -nextVelocities[index] * DAMPING
                nextVelocities[index] += (dampingForce + gravity) * dt
                nextXs[index] += nextVelocities[index] * dt
            }
        }

        resolveCollisions(
            nextXs = nextXs,
            nextVelocities = nextVelocities,
            nextRotations = nextRotations,
            nextRotationVelocities = nextRotationVelocities,
            draggedVelocity = draggedVelocity,
            draggedLifted = draggedLifted,
        )

        for (index in 0 until count) {
            when {
                nextXs[index] < WALL_WIDTH -> {
                    nextXs[index] = WALL_WIDTH
                    if (nextVelocities[index] < 0f) nextVelocities[index] = 0f
                }

                nextXs[index] > maxX -> {
                    nextXs[index] = maxX
                    if (nextVelocities[index] > 0f) nextVelocities[index] = 0f
                }
            }
        }

        nextXs.copyInto(xs)
        nextVelocities.copyInto(velocities)
        nextRotations.copyInto(rotations)
        nextRotationVelocities.copyInto(rotationVelocities)
        nextLiftYs.copyInto(liftYs)
        nextLiftVelocities.copyInto(liftVelocities)
        return true
    }

    private fun reorderForDraggedBook(bookIndex: Int, x: Float) {
        val currentRank = order.indexOf(bookIndex)
        val targetRank = ((x - WALL_WIDTH) / SLOT)
            .roundToInt()
            .coerceIn(0, count - 1)
        if (targetRank == currentRank) return
        order.removeAt(currentRank)
        order.add(targetRank, bookIndex)
    }

    private fun updateGapReaction(
        nextVelocities: FloatArray,
        nextRotationVelocities: FloatArray,
    ) {
        if (draggingIndex >= 0) {
            val rank = order.indexOf(draggingIndex)
            val newLeft = if (rank > 0) order[rank - 1] else -1
            val newRight = if (rank < order.lastIndex) order[rank + 1] else -1
            if (newLeft != gapLeft || newRight != gapRight) {
                gapLeft = newLeft
                gapRight = newRight
                if (newLeft >= 0) {
                    nextVelocities[newLeft] -= GAP_NUDGE_KICK
                    nextRotationVelocities[newLeft] -= GAP_WIGGLE_KICK
                }
                if (newRight >= 0) {
                    nextVelocities[newRight] += GAP_NUDGE_KICK
                    nextRotationVelocities[newRight] += GAP_WIGGLE_KICK
                }
                pendingEvents += Event.GapChanged
            }
        } else if (gapLeft != -1 || gapRight != -1) {
            gapLeft = -1
            gapRight = -1
        }
    }

    private fun resolveCollisions(
        nextXs: FloatArray,
        nextVelocities: FloatArray,
        nextRotations: FloatArray,
        nextRotationVelocities: FloatArray,
        draggedVelocity: Float,
        draggedLifted: Boolean,
    ) {
        val rightReach = FloatArray(count)
        val leftReach = FloatArray(count)
        for (index in 0 until count) {
            val rotation = nextRotations[index]
            val pivotFraction = min(1f, abs(rotation) / FALL_ROTATION_DEGREES)
            val radians = abs(rotation) * PI.toFloat() / 180f
            val sweep = sin(radians) * VISIBLE_HEIGHT * pivotFraction
            rightReach[index] = SPINE_WIDTH / 2f + if (rotation > 0f) sweep else 0f
            leftReach[index] = SPINE_WIDTH / 2f + if (rotation < 0f) sweep else 0f
        }

        repeat(COLLISION_PASSES) {
            val sorted = (0 until count).sortedBy { nextXs[it] }
            for (rank in 0 until sorted.lastIndex) {
                val left = sorted[rank]
                val right = sorted[rank + 1]
                val overlap =
                    nextXs[left] - nextXs[right] + rightReach[left] + leftReach[right]
                if (overlap <= 0f) continue
                val leftDragged = left == draggingIndex
                val rightDragged = right == draggingIndex
                if ((leftDragged || rightDragged) && draggedLifted) continue

                when {
                    leftDragged && !rightDragged -> {
                        nextXs[right] += overlap
                        nextVelocities[right] +=
                            overlap * BUMP + max(0f, draggedVelocity) * 0.5f
                        nextRotationVelocities[left] +=
                            grabOffsetFraction * overlap * COLLISION_ROTATION_KICK
                    }

                    rightDragged && !leftDragged -> {
                        nextXs[left] -= overlap
                        nextVelocities[left] -=
                            overlap * BUMP + max(0f, -draggedVelocity) * 0.5f
                        nextRotationVelocities[right] -=
                            grabOffsetFraction * overlap * COLLISION_ROTATION_KICK
                    }

                    !leftDragged && !rightDragged -> {
                        nextXs[left] -= overlap / 2f
                        nextXs[right] += overlap / 2f
                        nextVelocities[left] -= overlap * BUMP / 2f
                        nextVelocities[right] += overlap * BUMP / 2f
                    }
                }
            }
        }
    }

    private fun clampToWalls() {
        val maximum = maxX()
        for (index in 0 until count) {
            xs[index] = xs[index].coerceIn(WALL_WIDTH, maximum)
        }
    }

    private fun maxX(): Float = max(WALL_WIDTH, width - SPINE_WIDTH - WALL_WIDTH)

    private fun isSettled(): Boolean = (0 until count).all { index ->
        abs(velocities[index]) <= 0.5f &&
            abs(rotations[index]) <= 0.2f &&
            abs(rotationVelocities[index]) <= 0.5f &&
            abs(liftYs[index]) <= 0.5f &&
            abs(liftVelocities[index]) <= 0.5f
    }

    companion object {
        const val SHELF_HEIGHT = 130f
        const val SPINE_GAP = 4f
        const val SPINE_WIDTH = 56f
        const val VISIBLE_HEIGHT = SHELF_HEIGHT - 8f
        const val WALL_WIDTH = 6f
        const val SLOT = SPINE_WIDTH + SPINE_GAP
        const val LIFT_THRESHOLD = 20f

        private const val ROTATION_MAX = 22f
        private const val ROTATION_STIFFNESS = 32f
        private const val ROTATION_DAMPING = 20f
        private const val ROTATION_TORQUE = 0.16f
        private const val CORNER_HANG_STRENGTH = 0.12f
        private const val COLLISION_ROTATION_KICK = 1f
        private const val TILT_LEAN_DEGREES_PER_UNIT = 11f
        private const val MAX_LEAN_DEGREES = 7f
        private const val FALL_ROTATION_DEGREES = 78f
        private const val DAMPING = 22f
        private const val BUMP = 1.6f
        private const val MAX_DT = 0.032f
        private const val SWIPE_IMPULSE = 160f
        private const val SWIPE_WIGGLE = 100f
        private const val GAP_NUDGE_KICK = 50f
        private const val GAP_WIGGLE_KICK = 35f
        private const val LIFT_MIN = -120f
        private const val LIFT_MAX = 24f
        private const val LIFT_GRAVITY = 1500f
        private const val TILT_DEADZONE = 0.12f
        private const val BOUNCE_STIFFNESS = 260f
        private const val BOUNCE_DAMPING = 22f
        private const val BOUNCE_STRENGTH = 650f
        private const val BOUNCE_MAX = 26f
        private const val COLLISION_PASSES = 2
        private const val SETTLED_BOUNCE_EPSILON = 0.001f
        private const val RELEASE_ORDER_EPSILON = 0.05f
    }
}
