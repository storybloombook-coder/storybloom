package com.storybloom.app.scene

import android.os.SystemClock
import android.view.MotionEvent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OneFingerSceneGestureTest {
    @Test
    fun tapWobbleDoesNotRotateCamera() {
        lateinit var before: SceneFrame
        lateinit var after: SceneFrame

        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = StorySceneView(ApplicationProvider.getApplicationContext())
            before = view.transformSnapshotForTest()
            val downTime = SystemClock.uptimeMillis()
            view.dispatchTouchEvent(
                MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, 120f, 180f, 0),
            )
            view.dispatchTouchEvent(
                MotionEvent.obtain(downTime, downTime + 16, MotionEvent.ACTION_MOVE, 121f, 181f, 0),
            )
            view.dispatchTouchEvent(
                MotionEvent.obtain(downTime, downTime + 32, MotionEvent.ACTION_UP, 121f, 181f, 0),
            )
            after = view.transformSnapshotForTest()
        }

        assertEquals(before.cameraYaw, after.cameraYaw)
        assertEquals(before.cameraPitch, after.cameraPitch)
    }

    @Test
    fun firstPointerImmediatelyOrbitsCameraWithoutChangingSceneRotation() {
        lateinit var view: StorySceneView
        lateinit var before: SceneFrame
        lateinit var after: SceneFrame

        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            view = StorySceneView(ApplicationProvider.getApplicationContext())
            before = view.transformSnapshotForTest()
            val downTime = SystemClock.uptimeMillis()
            view.dispatchTouchEvent(
                MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, 120f, 180f, 0),
            )
            view.dispatchTouchEvent(
                MotionEvent.obtain(downTime, downTime + 16, MotionEvent.ACTION_MOVE, 205f, 225f, 0),
            )
            view.dispatchTouchEvent(
                MotionEvent.obtain(downTime, downTime + 32, MotionEvent.ACTION_UP, 205f, 225f, 0),
            )
            after = view.transformSnapshotForTest()
        }

        assertNotEquals(before.cameraYaw, after.cameraYaw)
        assertNotEquals(before.cameraPitch, after.cameraPitch)
        assertEquals(before.sceneRotation, after.sceneRotation)
        assertEquals(before.kolobokRotation, after.kolobokRotation)
    }

    @Test
    fun oneFingerOrbitCannotMoveTheCameraBelowTheField() {
        lateinit var frame: SceneFrame

        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = StorySceneView(ApplicationProvider.getApplicationContext())
            val downTime = SystemClock.uptimeMillis()
            view.dispatchTouchEvent(
                MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, 300f, 2_000f, 0),
            )
            view.dispatchTouchEvent(
                MotionEvent.obtain(downTime, downTime + 16, MotionEvent.ACTION_MOVE, 300f, 180f, 0),
            )
            view.dispatchTouchEvent(
                MotionEvent.obtain(downTime, downTime + 32, MotionEvent.ACTION_UP, 300f, 180f, 0),
            )
            frame = view.transformSnapshotForTest()
        }

        assertEquals(14f, frame.cameraPitch)
    }

    @Test
    fun followModeIsIndependentFromSceneRotation() {
        lateinit var frame: SceneFrame

        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = StorySceneView(ApplicationProvider.getApplicationContext())
            view.setFollowKolobok(true)
            view.setSceneRotationEnabled(false)
            frame = view.transformSnapshotForTest()
        }

        assertTrue(frame.followKolobok)
        assertEquals(0f, frame.sceneRotation)
    }
}
