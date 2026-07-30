package com.storybloom.app.scene

data class SceneFrame(
    val cameraYaw: Float = 180f,
    val cameraPitch: Float = 24f,
    val cameraDistance: Float = 13.2f,
    val followKolobok: Boolean = false,
    val sceneRotation: Float = 0f,
    val kolobokRotation: Float = 0f,
    val storyTime: Float = 0f,
    val storyPlaying: Boolean = true,
    val sceneRotationEnabled: Boolean = false,
)

/**
 * Thread-safe transform state shared by the UI/touch thread and GL thread.
 * Camera, world and character transforms are intentionally distinct fields.
 */
class SceneTransformState {
    private var frame = SceneFrame()
    private var yawBeforeFollow = frame.cameraYaw
    private var pitchBeforeFollow = frame.cameraPitch
    private var distanceBeforeFollow = frame.cameraDistance

    @Synchronized
    fun orbitBy(yawDegrees: Float, pitchDegrees: Float) {
        frame = frame.copy(
            cameraYaw = (frame.cameraYaw + yawDegrees) % 360f,
            cameraPitch = (frame.cameraPitch + pitchDegrees)
                .coerceIn(MIN_CAMERA_PITCH, MAX_CAMERA_PITCH),
        )
    }

    @Synchronized
    fun zoomBy(scale: Float) {
        frame = frame.copy(
            cameraDistance = (frame.cameraDistance * scale).coerceIn(5.8f, 18f),
        )
    }

    @Synchronized
    fun resetCamera() {
        frame = frame.copy(
            cameraYaw = 180f,
            cameraPitch = if (frame.followKolobok) FOLLOW_CAMERA_PITCH else 24f,
            cameraDistance = if (frame.followKolobok) FOLLOW_CAMERA_DISTANCE else 13.2f,
        )
    }

    @Synchronized
    fun setFollowKolobok(enabled: Boolean) {
        if (frame.followKolobok == enabled) return
        if (enabled) {
            yawBeforeFollow = frame.cameraYaw
            pitchBeforeFollow = frame.cameraPitch
            distanceBeforeFollow = frame.cameraDistance
            frame = frame.copy(
                followKolobok = true,
                cameraYaw = 180f,
                cameraPitch = maxOf(frame.cameraPitch, FOLLOW_CAMERA_PITCH),
                cameraDistance = minOf(frame.cameraDistance, FOLLOW_CAMERA_DISTANCE),
            )
        } else {
            frame = frame.copy(
                followKolobok = false,
                cameraYaw = yawBeforeFollow,
                cameraPitch = pitchBeforeFollow,
                cameraDistance = distanceBeforeFollow,
            )
        }
    }

    @Synchronized
    fun setStoryPlaying(playing: Boolean) {
        frame = frame.copy(storyPlaying = playing)
    }

    @Synchronized
    fun toggleStory() {
        frame = frame.copy(storyPlaying = !frame.storyPlaying)
    }

    @Synchronized
    fun setSceneRotationEnabled(enabled: Boolean) {
        frame = frame.copy(sceneRotationEnabled = enabled)
    }

    @Synchronized
    fun advance(deltaSeconds: Float): SceneFrame {
        val safeDelta = deltaSeconds.coerceIn(0f, .25f)
        val nextStoryTime = if (frame.storyPlaying) {
            frame.storyTime + safeDelta
        } else {
            frame.storyTime
        }
        val rollingDelta = if (frame.storyPlaying) {
            (nextStoryTime - maxOf(frame.storyTime, SceneMotion.INTRO_SECONDS))
                .coerceAtLeast(0f)
        } else {
            0f
        }
        frame = frame.copy(
            storyTime = nextStoryTime,
            kolobokRotation = if (rollingDelta > 0f) {
                (frame.kolobokRotation + rollingDelta * SceneMotion.rollDegreesPerSecond) % 360f
            } else {
                frame.kolobokRotation
            },
            sceneRotation = if (frame.sceneRotationEnabled) {
                (frame.sceneRotation + safeDelta * 3.2f) % 360f
            } else {
                frame.sceneRotation
            },
        )
        return frame
    }

    @Synchronized
    fun snapshot(): SceneFrame = frame

    private companion object {
        const val MIN_CAMERA_PITCH = 14f
        const val MAX_CAMERA_PITCH = 62f
        const val FOLLOW_CAMERA_PITCH = 34f
        const val FOLLOW_CAMERA_DISTANCE = 9.4f
    }
}
