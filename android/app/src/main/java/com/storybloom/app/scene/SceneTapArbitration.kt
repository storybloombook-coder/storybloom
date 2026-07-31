package com.storybloom.app.scene

/**
 * Press-time ownership must match the visual-depth rule used by tap-time hit
 * testing. Trees are special because their hold mechanic begins on ACTION_DOWN;
 * every other interaction waits for ACTION_UP.
 */
internal object SceneTapArbitration {
    fun treeOwnsPress(
        treeDepth: Float,
        treeNormalizedDistance: Float,
        foregroundDepth: Float?,
        foregroundNormalizedDistance: Float?,
    ): Boolean {
        if (foregroundDepth == null || foregroundNormalizedDistance == null) {
            return true
        }
        if (foregroundDepth <= treeDepth + DEPTH_EPSILON) return false

        // Tree hit areas deliberately include the whole moving canopy, so
        // their circular edge extends beyond the visible needles. A centered
        // press on a character or prop must beat that transparent fringe even
        // when the tree's coarse anchor is technically closer to the camera.
        val centeredForeground =
            foregroundNormalizedDistance <= CENTERED_FOREGROUND_RADIUS &&
                treeNormalizedDistance >= TREE_FRINGE_RADIUS
        if (centeredForeground) return false

        val foregroundAimAdvantage =
            treeNormalizedDistance - foregroundNormalizedDistance
        val shallowDepthOverlap =
            foregroundDepth - treeDepth <= MAX_SHALLOW_DEPTH_OVERLAP
        return !(
            foregroundAimAdvantage >= MIN_AIM_ADVANTAGE &&
                shallowDepthOverlap
            )
    }

    private const val DEPTH_EPSILON = .001f
    private const val CENTERED_FOREGROUND_RADIUS = .46f
    private const val TREE_FRINGE_RADIUS = .67f
    private const val MIN_AIM_ADVANTAGE = .32f
    private const val MAX_SHALLOW_DEPTH_OVERLAP = 1.85f
}
