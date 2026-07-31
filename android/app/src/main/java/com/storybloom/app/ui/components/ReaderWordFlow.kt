package com.storybloom.app.ui.components

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.storybloom.app.data.Cue
import com.storybloom.app.data.PageWithCues
import com.storybloom.app.reader.ScriptWord
import com.storybloom.app.ui.mechanics.ReadingBallPhysics
import com.storybloom.app.ui.mechanics.WordBounds
import com.storybloom.app.ui.mechanics.groupMeasuredWordRows
import com.storybloom.app.ui.theme.BloomBlue
import com.storybloom.app.ui.theme.BloomCoral
import com.storybloom.app.ui.theme.BloomYellow
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlin.math.abs

/**
 * Measured word flow plus the draggable, spring-driven Kolobok cursor.
 * Positions come from the words as Compose actually wrapped them on this
 * device; there are no estimated text coordinates.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReaderWordFlow(
    active: PageWithCues,
    script: List<ScriptWord>,
    cursor: Int,
    firingWord: Int,
    onWord: (Int, Cue?) -> Unit,
    onBallWord: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val view = LocalView.current
    val wordLayouts = remember(active.page.id) { mutableStateMapOf<Int, WordBounds>() }
    var layoutVersion by remember(active.page.id) { mutableIntStateOf(0) }
    var rowStarts by remember(active.page.id) { mutableStateOf<List<Int>>(emptyList()) }
    var rowByWord by remember(active.page.id) { mutableStateOf<Map<Int, Int>>(emptyMap()) }
    var activeRow by remember(active.page.id) { mutableIntStateOf(-1) }
    val physics = remember(active.page.id) { ReadingBallPhysics() }
    var ballPose by remember(physics) { mutableStateOf(physics.pose()) }

    val cueByIndex = remember(active.cues, script) {
        script.indices.associateWith { index ->
            val word = script[index]
            active.cues.firstOrNull { cue ->
                cue.isActive && cue.charStart != null && cue.charEnd != null &&
                    word.charStart < cue.charEnd && word.charEnd > cue.charStart
            }
        }
    }

    LaunchedEffect(layoutVersion) {
        if (layoutVersion == 0) return@LaunchedEffect
        // A mount produces a burst of measurements. Debouncing prevents a
        // partial row map from inserting spacers and reflowing the text early.
        delay(80)
        val rows = groupMeasuredWordRows(wordLayouts)
        rowByWord = rows.rowByWord
        if (rowStarts != rows.rowStarts) rowStarts = rows.rowStarts
    }

    val currentBounds = wordLayouts[cursor]
    val currentRow = rowByWord[cursor] ?: -1
    LaunchedEffect(cursor, currentBounds, currentRow) {
        if (cursor < 0 || currentBounds == null) {
            activeRow = -1
            physics.hide()
        } else {
            physics.target(cursor, currentRow, currentBounds)
        }
    }

    LaunchedEffect(physics) {
        var previousFrameNanos = 0L
        while (isActive) {
            androidx.compose.runtime.withFrameNanos { frameNanos ->
                val delta = if (previousFrameNanos == 0L) {
                    1f / 60f
                } else {
                    (frameNanos - previousFrameNanos) / 1_000_000_000f
                }
                previousFrameNanos = frameNanos
                if (physics.step(delta)) ballPose = physics.pose()
                physics.drainArrivals().lastOrNull()?.let { arrival ->
                    if (arrival.wordIndex == physics.currentTargetWord()) {
                        activeRow = arrival.rowIndex
                    }
                }
            }
        }
    }

    val rowStartAt = remember(rowStarts) {
        rowStarts.withIndex().associate { (row, wordIndex) -> wordIndex to row }
    }

    Box(modifier = modifier.fillMaxWidth()) {
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(5.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            FirstReaderRowGap(active = activeRow == 0)

            script.forEachIndexed { index, word ->
                val rowStartingHere = rowStartAt[index]
                if (rowStartingHere != null && rowStartingHere > 0) {
                    ReaderRowGap(active = activeRow == rowStartingHere)
                }
                val previousEnd = script.getOrNull(index - 1)?.charEnd ?: 0
                if (
                    index > 0 &&
                    active.page.ocrText
                        .substring(
                            previousEnd.coerceAtMost(active.page.ocrText.length),
                            word.charStart.coerceAtMost(active.page.ocrText.length),
                        )
                        .contains('\n')
                ) {
                    Spacer(Modifier.fillMaxWidth().height(0.dp))
                }

                val cue = cueByIndex[index]
                val isRead = index <= cursor
                Text(
                    text = word.display,
                    modifier = Modifier
                        .onGloballyPositioned { coordinates ->
                            val position = coordinates.positionInParent()
                            val measured = with(density) {
                                WordBounds(
                                    x = position.x.toDp().value,
                                    y = position.y.toDp().value,
                                    width = coordinates.size.width.toDp().value,
                                    height = coordinates.size.height.toDp().value,
                                )
                            }
                            val old = wordLayouts[index]
                            if (old == null || !old.nearlyEquals(measured)) {
                                wordLayouts[index] = measured
                                layoutVersion++
                            }
                        }
                        .clip(RoundedCornerShape(if (cue?.soundId != null) 5.dp else 3.dp))
                        .background(
                            when {
                                index == firingWord ->
                                    BloomBlue.copy(alpha = .60f)
                                cue?.soundId != null && index == cursor ->
                                    BloomBlue.copy(alpha = .60f)
                                cue?.soundId != null && isRead ->
                                    BloomBlue.copy(alpha = .40f)
                                cue?.soundId != null ->
                                    BloomBlue.copy(alpha = .28f)
                                isRead -> BloomYellow.copy(alpha = .35f)
                                else -> Color.Transparent
                            },
                        )
                        .graphicsLayer {
                            val firingScale = if (index == firingWord) 1.08f else 1f
                            scaleX = firingScale
                            scaleY = firingScale
                        }
                        .clickable { onWord(index, cue) }
                        .padding(horizontal = 3.dp, vertical = 3.dp),
                    fontSize = 22.sp,
                    lineHeight = 36.sp,
                    fontWeight = if (index == cursor) FontWeight.ExtraBold else FontWeight.Normal,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }

        if (cursor >= 0 && currentBounds != null) {
            Box(
                modifier = Modifier
                    .offset {
                        IntOffset(
                            x = with(density) {
                                (ballPose.x - BALL_HIT_SLOP_DP).dp.roundToPx()
                            },
                            y = with(density) {
                                (ballPose.y - BALL_HIT_SLOP_DP).dp.roundToPx()
                            },
                        )
                    }
                    .zIndex(20f)
                    .size((ReadingBallPhysics.BALL_SIZE + BALL_HIT_SLOP_DP * 2f).dp)
                    .pointerInput(physics, active.page.id) {
                        detectDragGestures(
                            onDragStart = {
                                physics.beginDrag()
                                ballPose = physics.pose()
                                view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                            },
                            onDrag = { change, amount ->
                                change.consume()
                                physics.dragBy(
                                    deltaX = with(density) { amount.x.toDp().value },
                                    deltaY = with(density) { amount.y.toDp().value },
                                )
                                ballPose = physics.pose()
                            },
                            onDragEnd = {
                                val target = physics.endDrag(wordLayouts)
                                if (target >= 0) {
                                    onBallWord(target)
                                    activeRow = rowByWord[target] ?: -1
                                    wordLayouts[target]?.let { bounds ->
                                        physics.target(
                                            target,
                                            rowByWord[target] ?: -1,
                                            bounds,
                                        )
                                    }
                                }
                                ballPose = physics.pose()
                            },
                            onDragCancel = {
                                physics.cancelDrag()
                                currentBounds.let { bounds ->
                                    physics.target(cursor, currentRow, bounds)
                                }
                                ballPose = physics.pose()
                            },
                        )
                    },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .size(ReadingBallPhysics.BALL_SIZE.dp)
                        .graphicsLayer {
                            alpha = ballPose.opacity
                            scaleX = ballPose.scaleX
                            scaleY = ballPose.scaleY
                            shadowElevation = with(density) { 4.dp.toPx() }
                            shape = CircleShape
                            clip = true
                        }
                        .background(BloomCoral, CircleShape)
                        .border(2.dp, Color.White, CircleShape),
                )
            }
        }
    }
}

@Composable
private fun FirstReaderRowGap(active: Boolean) {
    val height by animateDpAsState(
        targetValue = if (active) 56.dp else 16.dp,
        animationSpec = tween(65),
        label = "first reader row gap",
    )
    Spacer(Modifier.fillMaxWidth().height(height))
}

@Composable
private fun ReaderRowGap(active: Boolean) {
    val height by animateDpAsState(
        targetValue = if (active) 56.dp else 10.dp,
        animationSpec = tween(65),
        label = "reader row gap",
    )
    Spacer(Modifier.fillMaxWidth().height(height))
}

private fun WordBounds.nearlyEquals(other: WordBounds): Boolean =
    abs(x - other.x) < 0.1f &&
        abs(y - other.y) < 0.1f &&
        abs(width - other.width) < 0.1f &&
        abs(height - other.height) < 0.1f

private const val BALL_HIT_SLOP_DP = 14f
