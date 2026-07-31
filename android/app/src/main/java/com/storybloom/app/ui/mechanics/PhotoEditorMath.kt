package com.storybloom.app.ui.mechanics

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

data class CropRect(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
) {
    val width: Float get() = right - left
    val height: Float get() = bottom - top
}

enum class CropCorner {
    TOP_LEFT,
    TOP_RIGHT,
    BOTTOM_LEFT,
    BOTTOM_RIGHT,
}

data class CropFractions(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
)

object PhotoEditorMath {
    fun move(
        rect: CropRect,
        deltaX: Float,
        deltaY: Float,
        boundsWidth: Float,
        boundsHeight: Float,
    ): CropRect {
        val left = (rect.left + deltaX).coerceIn(0f, (boundsWidth - rect.width).coerceAtLeast(0f))
        val top = (rect.top + deltaY).coerceIn(0f, (boundsHeight - rect.height).coerceAtLeast(0f))
        return CropRect(left, top, left + rect.width, top + rect.height)
    }

    fun resize(
        rect: CropRect,
        corner: CropCorner,
        deltaX: Float,
        deltaY: Float,
        boundsWidth: Float,
        boundsHeight: Float,
        minimumSize: Float,
    ): CropRect = when (corner) {
        CropCorner.TOP_LEFT -> rect.copy(
            left = (rect.left + deltaX).coerceIn(0f, rect.right - minimumSize),
            top = (rect.top + deltaY).coerceIn(0f, rect.bottom - minimumSize),
        )

        CropCorner.TOP_RIGHT -> rect.copy(
            right = (rect.right + deltaX).coerceIn(rect.left + minimumSize, boundsWidth),
            top = (rect.top + deltaY).coerceIn(0f, rect.bottom - minimumSize),
        )

        CropCorner.BOTTOM_LEFT -> rect.copy(
            left = (rect.left + deltaX).coerceIn(0f, rect.right - minimumSize),
            bottom = (rect.bottom + deltaY).coerceIn(rect.top + minimumSize, boundsHeight),
        )

        CropCorner.BOTTOM_RIGHT -> rect.copy(
            right = (rect.right + deltaX).coerceIn(rect.left + minimumSize, boundsWidth),
            bottom = (rect.bottom + deltaY).coerceIn(rect.top + minimumSize, boundsHeight),
        )
    }

    fun fractions(rect: CropRect, width: Float, height: Float): CropFractions {
        if (width <= 0f || height <= 0f) return CropFractions(0f, 0f, 1f, 1f)
        return CropFractions(
            left = (rect.left / width).coerceIn(0f, 1f),
            top = (rect.top / height).coerceIn(0f, 1f),
            right = (rect.right / width).coerceIn(0f, 1f),
            bottom = (rect.bottom / height).coerceIn(0f, 1f),
        )
    }

    /**
     * Android's Bitmap.createBitmap returns the axis-aligned bounding box of
     * an arbitrarily rotated bitmap. The editor uses the same dimensions for
     * its preview so crop fractions map to the saved pixels without drift.
     */
    fun rotatedBounds(width: Float, height: Float, degrees: Float): Pair<Float, Float> {
        val radians = Math.toRadians(degrees.toDouble())
        val cosine = abs(cos(radians)).toFloat()
        val sine = abs(sin(radians)).toFloat()
        return (width * cosine + height * sine) to (width * sine + height * cosine)
    }
}
