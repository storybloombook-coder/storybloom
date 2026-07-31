package com.storybloom.app.ui.mechanics

import org.junit.Assert.assertEquals
import org.junit.Test

class PhotoEditorMathTest {
    @Test
    fun movingCropClampsWithoutChangingItsSize() {
        val moved = PhotoEditorMath.move(
            rect = CropRect(10f, 20f, 70f, 80f),
            deltaX = 80f,
            deltaY = -50f,
            boundsWidth = 120f,
            boundsHeight = 100f,
        )

        assertEquals(CropRect(60f, 0f, 120f, 60f), moved)
    }

    @Test
    fun cornerResizeHonorsMinimumAndBounds() {
        val resized = PhotoEditorMath.resize(
            rect = CropRect(10f, 10f, 90f, 90f),
            corner = CropCorner.TOP_LEFT,
            deltaX = 200f,
            deltaY = -30f,
            boundsWidth = 100f,
            boundsHeight = 100f,
            minimumSize = 40f,
        )

        assertEquals(CropRect(50f, 0f, 90f, 90f), resized)
    }

    @Test
    fun fractionsMapPreviewCoordinatesToBitmapCoordinates() {
        val fractions = PhotoEditorMath.fractions(
            CropRect(25f, 20f, 175f, 80f),
            width = 200f,
            height = 100f,
        )

        assertEquals(.125f, fractions.left, .0001f)
        assertEquals(.2f, fractions.top, .0001f)
        assertEquals(.875f, fractions.right, .0001f)
        assertEquals(.8f, fractions.bottom, .0001f)
    }

    @Test
    fun ninetyDegreeRotationSwapsBounds() {
        val bounds = PhotoEditorMath.rotatedBounds(1200f, 800f, 90f)

        assertEquals(800f, bounds.first, .001f)
        assertEquals(1200f, bounds.second, .001f)
    }
}
