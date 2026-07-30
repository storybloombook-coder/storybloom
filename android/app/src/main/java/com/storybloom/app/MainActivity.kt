package com.storybloom.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.storybloom.app.ui.StorybloomApp
import com.storybloom.app.ui.screens.SceneBackdropCaptureScreen
import com.storybloom.app.ui.theme.StorybloomTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val captureMenuScene =
            BuildConfig.DEBUG && intent.getBooleanExtra(EXTRA_CAPTURE_MENU_SCENE, false)
        if (captureMenuScene) {
            WindowCompat.getInsetsController(window, window.decorView).apply {
                hide(WindowInsetsCompat.Type.systemBars())
                systemBarsBehavior =
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        }
        setContent {
            StorybloomTheme {
                if (captureMenuScene) {
                    SceneBackdropCaptureScreen()
                } else {
                    StorybloomApp()
                }
            }
        }
    }

    private companion object {
        const val EXTRA_CAPTURE_MENU_SCENE = "capture_menu_scene"
    }
}
