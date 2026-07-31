package com.storybloom.app.ui.components

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.max
import kotlin.math.min

data class GlassTilt(
    val x: Float = 0f,
    val y: Float = 0f,
)

/**
 * One accelerometer subscription can feed every glass pane on a screen.
 * Values are normalized to gravity and low-pass filtered to keep the rim
 * light fluid instead of noisy.
 */
@Composable
fun rememberGlassTilt(): GlassTilt {
    val context = LocalContext.current
    var x by remember { mutableFloatStateOf(0f) }
    var y by remember { mutableFloatStateOf(0f) }
    DisposableEffect(context) {
        val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val accelerometer = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        var lastUpdate = 0L
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                if (event.timestamp - lastUpdate < 50_000_000L) return
                lastUpdate = event.timestamp
                val gravity = SensorManager.GRAVITY_EARTH
                val targetX = (-event.values[0] / gravity).coerceIn(-1f, 1f)
                val targetY = (event.values[1] / gravity).coerceIn(-1f, 1f)
                x += (targetX - x) * .18f
                y += (targetY - y) * .18f
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }
        if (accelerometer != null) {
            manager.registerListener(listener, accelerometer, SensorManager.SENSOR_DELAY_GAME)
        }
        onDispose { manager.unregisterListener(listener) }
    }
    return GlassTilt(x, y)
}

/**
 * Sensor-driven interior bloom, layered rim and travelling highlight for a
 * native frosted control. This intentionally draws light, not a flat stroke.
 */
@Composable
fun GlassGlareOverlay(
    tilt: GlassTilt,
    radius: Dp,
    modifier: Modifier = Modifier,
    intensity: Float = .4f,
) {
    val density = LocalDensity.current
    Canvas(modifier.fillMaxSize()) {
        if (size.width <= 0f || size.height <= 0f) return@Canvas
        val r = with(density) { radius.toPx() }
            .coerceAtMost(min(size.width, size.height) / 2f)
        val unit = min(size.width, size.height)
        val direction = Offset(tilt.x, -tilt.y)
        val bloomCenter = Offset(
            x = size.width / 2f + direction.x * size.width * .28f,
            y = size.height / 2f + direction.y * size.height * .28f,
        )

        drawRoundRect(
            brush = Brush.radialGradient(
                colors = listOf(
                    Color.White.copy(alpha = .13f * intensity),
                    Color.White.copy(alpha = .035f * intensity),
                    Color.Transparent,
                ),
                center = bloomCenter,
                radius = unit * .72f,
            ),
            cornerRadius = CornerRadius(r, r),
        )

        val edgeStart = Offset(
            x = size.width / 2f - direction.x * size.width,
            y = size.height / 2f - direction.y * size.height,
        )
        val edgeEnd = Offset(
            x = size.width / 2f + direction.x * size.width,
            y = size.height / 2f + direction.y * size.height,
        )
        val rimBrush = Brush.linearGradient(
            colors = listOf(
                Color.White.copy(alpha = .18f * intensity),
                Color.White.copy(alpha = .80f * intensity),
                Color(0xFFB9D9FF).copy(alpha = .30f * intensity),
                Color.White.copy(alpha = .10f * intensity),
            ),
            start = edgeStart,
            end = edgeEnd,
        )
        drawRoundRect(
            brush = rimBrush,
            topLeft = Offset(.65f, .65f),
            size = Size(max(0f, size.width - 1.3f), max(0f, size.height - 1.3f)),
            cornerRadius = CornerRadius(max(0f, r - .65f), max(0f, r - .65f)),
            style = Stroke(width = 1.3f),
        )
        drawRoundRect(
            color = Color.White.copy(alpha = .16f * intensity),
            topLeft = Offset(2.1f, 2.1f),
            size = Size(max(0f, size.width - 4.2f), max(0f, size.height - 4.2f)),
            cornerRadius = CornerRadius(max(0f, r - 2.1f), max(0f, r - 2.1f)),
            style = Stroke(width = .7f),
        )

        val hotspot = Offset(
            x = (size.width / 2f + direction.x * size.width * .46f)
                .coerceIn(0f, size.width),
            y = (size.height / 2f + direction.y * size.height * .46f)
                .coerceIn(0f, size.height),
        )
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(
                    Color.White.copy(alpha = .72f * intensity),
                    Color(0xFFCBE5FF).copy(alpha = .22f * intensity),
                    Color.Transparent,
                ),
                center = hotspot,
                radius = unit * .30f,
            ),
            radius = unit * .30f,
            center = hotspot,
        )
    }
}
