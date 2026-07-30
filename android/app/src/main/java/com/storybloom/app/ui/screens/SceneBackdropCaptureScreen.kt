package com.storybloom.app.ui.screens

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.storybloom.app.scene.SceneWeather
import com.storybloom.app.scene.StorySceneView

/**
 * Debug-only clean framebuffer used to record the lightweight menu loop.
 * MainActivity gates this route behind BuildConfig.DEBUG, so release builds
 * always start in the normal application.
 */
@Composable
fun SceneBackdropCaptureScreen() {
    var sceneView by remember { mutableStateOf<StorySceneView?>(null) }
    val lifecycleOwner = LocalLifecycleOwner.current

    DisposableEffect(lifecycleOwner, sceneView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> sceneView?.onResume()
                Lifecycle.Event.ON_PAUSE -> sceneView?.onPause()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            sceneView?.onPause()
        }
    }

    AndroidView(
        factory = { context ->
            StorySceneView(context).also { sceneView = it }
        },
        modifier = Modifier.fillMaxSize(),
        update = { view ->
            view.setStoryPlaying(true)
            view.setSceneRotationEnabled(false)
            view.setFollowKolobok(false)
            view.setWeather(SceneWeather.CLEAR)
            view.setRockMenuLanguage(false)
        },
    )
}
