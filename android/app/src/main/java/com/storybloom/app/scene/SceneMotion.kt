package com.storybloom.app.scene

internal object SceneMotion {
    const val INTRO_SECONDS = 4f
    const val CHAPTER_SECONDS = 13
    const val LAP_SECONDS = 65f
    const val PATH_RADIUS = 4.6f
    const val KOLOBOK_RADIUS = .42f

    val angularSpeedRadians: Float = (Math.PI * 2.0 / LAP_SECONDS).toFloat()
    val rollDegreesPerSecond: Float =
        (PATH_RADIUS * angularSpeedRadians / KOLOBOK_RADIUS * 180.0 / Math.PI).toFloat()

    fun travelRadians(storyTime: Float): Float =
        (storyTime - INTRO_SECONDS).coerceAtLeast(0f) * angularSpeedRadians
}
