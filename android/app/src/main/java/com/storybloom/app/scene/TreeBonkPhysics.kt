package com.storybloom.app.scene

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sqrt

/**
 * State and motion shared by finger-driven and Kolobok-driven tree bonks.
 *
 * A tree reaches its displaced pose quickly, stays there while Kolobok is
 * touching it (or a finger is holding it), then settles with a clipped
 * spring. Clipping keeps it from swinging through Kolobok on the rebound.
 */
internal data class TreeBonkState(
    var elapsedSeconds: Float = -1f,
    var directionX: Float = 0f,
    var directionZ: Float = 1f,
    var held: Boolean = false,
)

internal data class TreeBonkPose(
    val pushDistance: Float,
    val tiltDegrees: Float,
    val directionX: Float,
    val directionZ: Float,
    val intensity: Float,
    val active: Boolean,
)

internal object TreeBonkPhysics {
    const val PUSH_MAX = .22f
    const val PUSH_RISE_SECONDS = .12f
    const val MAX_TILT_DEGREES = 9f
    const val DURATION_SECONDS = 1.1f
    const val STRETCH_Y = .16f
    const val STRETCH_XZ = .08f

    /*
     * Native tree placement keeps the three roadside trees about .72 world
     * units from Kolobok's path. This radius includes both visible bodies so
     * those intentional near-path trees reliably bonk as he rolls by.
     */
    const val NATIVE_COLLISION_RADIUS = .80f

    private const val DECAY = 6f
    private const val FREQUENCY = 2.5f

    fun springEnvelope(seconds: Float): Float {
        if (seconds < 0f) return 0f
        if (seconds < PUSH_RISE_SECONDS) return seconds / PUSH_RISE_SECONDS
        val decayTime = seconds - PUSH_RISE_SECONDS
        return (
            exp(-decayTime * DECAY) *
                cos(decayTime * FREQUENCY * PI.toFloat() * 2f)
            ).coerceAtLeast(0f)
    }

    fun hold(
        state: TreeBonkState,
        directionX: Float,
        directionZ: Float,
    ) {
        val normalized = normalize(directionX, directionZ)
        state.directionX = normalized.first
        state.directionZ = normalized.second
        state.elapsedSeconds = -1f
        state.held = true
    }

    fun release(state: TreeBonkState) {
        if (!state.held) return
        state.held = false
        state.elapsedSeconds = PUSH_RISE_SECONDS
    }

    fun kick(
        state: TreeBonkState,
        directionX: Float,
        directionZ: Float,
    ) {
        val normalized = normalize(directionX, directionZ)
        state.directionX = normalized.first
        state.directionZ = normalized.second
        state.held = false
        state.elapsedSeconds = PUSH_RISE_SECONDS
    }

    fun advance(
        state: TreeBonkState,
        deltaSeconds: Float,
        treeX: Float,
        treeZ: Float,
        kolobokX: Float,
        kolobokZ: Float,
    ): TreeBonkPose {
        var spring = 0f
        var active = false

        if (state.held) {
            spring = 1.15f
            active = true
        } else {
            val deltaX = treeX - kolobokX
            val deltaZ = treeZ - kolobokZ
            val overlapping =
                deltaX * deltaX + deltaZ * deltaZ <
                    NATIVE_COLLISION_RADIUS * NATIVE_COLLISION_RADIUS

            if (overlapping) {
                val normalized = normalize(deltaX, deltaZ)
                state.directionX = normalized.first
                state.directionZ = normalized.second
                state.elapsedSeconds = (
                    if (state.elapsedSeconds < 0f) deltaSeconds
                    else state.elapsedSeconds + deltaSeconds
                    ).coerceAtMost(PUSH_RISE_SECONDS)
                spring = springEnvelope(state.elapsedSeconds)
                active = true
            } else if (state.elapsedSeconds >= 0f) {
                state.elapsedSeconds += deltaSeconds
                if (state.elapsedSeconds >= DURATION_SECONDS) {
                    state.elapsedSeconds = -1f
                } else {
                    spring = springEnvelope(state.elapsedSeconds)
                    active = true
                }
            }
        }

        return TreeBonkPose(
            pushDistance = PUSH_MAX * spring,
            tiltDegrees = MAX_TILT_DEGREES * spring,
            directionX = state.directionX,
            directionZ = state.directionZ,
            intensity = spring,
            active = active,
        )
    }

    private fun normalize(x: Float, z: Float): Pair<Float, Float> {
        val length = sqrt(x * x + z * z)
        return if (length <= .001f) {
            0f to 1f
        } else {
            x / length to z / length
        }
    }
}
