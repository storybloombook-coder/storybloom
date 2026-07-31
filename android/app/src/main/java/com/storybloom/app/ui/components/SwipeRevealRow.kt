package com.storybloom.app.ui.components

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import com.storybloom.app.ui.mechanics.SwipeRevealMath
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * Partial swipe-to-reveal interaction used by books, pages and recordings.
 * It preserves vertical scrolling, holds at exactly 20%, and requires a
 * deliberate tap on the revealed bin before asking for deletion.
 */
@Composable
fun SwipeRevealRow(
    onDelete: () -> Unit,
    deleteDescription: String,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val density = LocalDensity.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val translation = remember { Animatable(0f) }
    var widthPx by remember { mutableIntStateOf(0) }
    var open by remember { mutableStateOf(false) }
    var revealArmed by remember { mutableStateOf(false) }
    var zoneOpen by remember { mutableStateOf(false) }
    var settleJob by remember { mutableStateOf<Job?>(null) }
    val widthDp = with(density) { widthPx.toDp().value }
    val revealDp = widthDp * SwipeRevealMath.RevealFraction
    val shape = RoundedCornerShape(14.dp)

    fun close() {
        settleJob?.cancel()
        settleJob = scope.launch {
            translation.animateTo(
                0f,
                spring(dampingRatio = dampingRatio(22f, 220f), stiffness = 220f),
            )
            open = false
            zoneOpen = false
        }
    }

    Box(
        modifier = modifier
            .clip(shape)
            .onSizeChanged { widthPx = it.width },
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .width(revealDp.dp)
                .fillMaxHeight()
                .graphicsLayer {
                    alpha = if (!revealArmed) {
                        0f
                    } else {
                        (-translation.value / 8f).coerceIn(0f, 1f)
                    }
                }
                .background(MaterialTheme.colorScheme.errorContainer),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .clickable {
                        close()
                        onDelete()
                    },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.Delete,
                    contentDescription = deleteDescription,
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        }

        Box(
            modifier = Modifier
                .graphicsLayer {
                    translationX = with(density) { translation.value.dp.toPx() }
                }
                .pointerInput(widthDp) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val pointerId = down.id
                        settleJob?.cancel()
                        if (!zoneOpen) {
                            revealArmed = false
                            scope.launch {
                                delay(SwipeRevealMath.RevealDelayMillis)
                                revealArmed = true
                            }
                        }
                        view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)

                        var startTranslation = translation.value
                        var totalX = 0f
                        var totalY = 0f
                        var horizontal = false
                        var failed = false
                        while (true) {
                            val event = awaitPointerEvent(PointerEventPass.Main)
                            val change = event.changes.firstOrNull { it.id == pointerId }
                                ?: break
                            if (!change.pressed) {
                                if (horizontal) {
                                    val target = SwipeRevealMath.settleTarget(
                                        translation.value,
                                        widthDp,
                                    )
                                    open = target != 0f
                                    zoneOpen = open
                                    settleJob = scope.launch {
                                        translation.animateTo(
                                            target,
                                            spring(
                                                dampingRatio = dampingRatio(22f, 220f),
                                                stiffness = 220f,
                                            ),
                                        )
                                    }
                                }
                                break
                            }

                            val delta = change.position - change.previousPosition
                            totalX += with(density) { delta.x.toDp().value }
                            totalY += with(density) { delta.y.toDp().value }
                            if (!horizontal && !failed) {
                                when {
                                    abs(totalY) > SwipeRevealMath.ActivationDistance &&
                                        abs(totalY) > abs(totalX) -> failed = true
                                    abs(totalX) > SwipeRevealMath.ActivationDistance &&
                                        abs(totalX) > abs(totalY) -> {
                                        horizontal = true
                                        startTranslation = translation.value
                                    }
                                }
                            }
                            if (horizontal) {
                                change.consume()
                                val next = SwipeRevealMath.clamp(
                                    startTranslation + totalX,
                                    widthDp,
                                )
                                scope.launch(start = CoroutineStart.UNDISPATCHED) {
                                    translation.snapTo(next)
                                }
                                val nowOpenZone = next <= -revealDp / 2f
                                if (nowOpenZone != zoneOpen) {
                                    zoneOpen = nowOpenZone
                                    view.performHapticFeedback(
                                        HapticFeedbackConstants.CONTEXT_CLICK,
                                    )
                                }
                            }
                        }
                    }
                },
        ) {
            content()
            if (open) {
                Box(
                    Modifier
                        .matchParentSize()
                        .clickable(onClick = ::close),
                )
            }
        }
    }
}

/**
 * Converts physical spring damping/stiffness to Compose's dimensionless
 * damping ratio for a unit-mass spring.
 */
private fun dampingRatio(damping: Float, stiffness: Float): Float =
    damping / (2f * kotlin.math.sqrt(stiffness))
