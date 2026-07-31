package com.storybloom.app.ui.components

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseOutCubic
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.storybloom.app.ui.mechanics.ReorderMath
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.abs
import kotlin.math.max

@Stable
class GridReorderState {
    var draggingId by mutableStateOf<String?>(null)
        private set
    var fromIndex by mutableIntStateOf(-1)
        private set
    var targetIndex by mutableIntStateOf(-1)
        private set
    var settlingId by mutableStateOf<String?>(null)
        private set

    val active: Boolean get() = draggingId != null

    fun begin(id: String, index: Int) {
        draggingId = id
        fromIndex = index
        targetIndex = index
        settlingId = null
    }

    fun target(index: Int) {
        targetIndex = index
    }

    fun beginSettle(id: String) {
        settlingId = id
        draggingId = null
        fromIndex = -1
        targetIndex = -1
    }

    fun finishSettle(id: String) {
        if (settlingId == id) settlingId = null
    }

    fun cancel() {
        draggingId = null
        fromIndex = -1
        targetIndex = -1
    }
}

@Composable
fun rememberGridReorderState(): GridReorderState = remember { GridReorderState() }

@Composable
fun ReorderableGridItem(
    id: String,
    index: Int,
    columns: Int,
    totalCount: Int,
    horizontalSlot: Float,
    verticalSlot: Float,
    state: GridReorderState,
    onReorder: (Int, Int) -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val density = LocalDensity.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var ownX by remember(id) { mutableFloatStateOf(0f) }
    var ownY by remember(id) { mutableFloatStateOf(0f) }
    var animationJob by remember(id) { mutableStateOf<Job?>(null) }

    val slotDelta = ReorderMath.gridSiblingDeltaSlots(
        index = index,
        from = state.fromIndex,
        to = state.targetIndex,
    )
    val siblingTarget = if (slotDelta == 0) {
        Offset.Zero
    } else {
        val targetSlot = index + slotDelta
        val myRow = index / max(1, columns)
        val myColumn = index % max(1, columns)
        val slotRow = targetSlot / max(1, columns)
        val slotColumn = targetSlot % max(1, columns)
        Offset(
            x = (slotColumn - myColumn) * horizontalSlot,
            y = (slotRow - myRow) * verticalSlot,
        )
    }
    val siblingX = remember(id) { Animatable(0f) }
    val siblingY = remember(id) { Animatable(0f) }
    LaunchedEffect(state.active, siblingTarget) {
        if (!state.active) {
            siblingX.snapTo(0f)
            siblingY.snapTo(0f)
        } else {
            launch { siblingX.animateTo(siblingTarget.x, tween(180, easing = EaseOutCubic)) }
            launch { siblingY.animateTo(siblingTarget.y, tween(180, easing = EaseOutCubic)) }
        }
    }

    val isDragged = state.draggingId == id
    val isSettling = state.settlingId == id
    val scaleTarget = if (isDragged) 1.08f else 1f
    val scale = remember(id) { Animatable(1f) }
    LaunchedEffect(scaleTarget) {
        scale.animateTo(scaleTarget, tween(130, easing = EaseOutCubic))
    }

    fun settle(reorder: Boolean) {
        val from = index
        val to = state.targetIndex.coerceIn(0, totalCount - 1)
        animationJob?.cancel()

        if (reorder && from != to) {
            val oldRow = from / max(1, columns)
            val oldColumn = from % max(1, columns)
            val newRow = to / max(1, columns)
            val newColumn = to % max(1, columns)
            // Rebase in the same event turn as the list mutation. The layout
            // moves by +slotDelta while this offset moves by -slotDelta, so
            // the dragged thumbnail stays under the release point.
            ownX -= (newColumn - oldColumn) * horizontalSlot
            ownY -= (newRow - oldRow) * verticalSlot
            state.beginSettle(id)
            onReorder(from, to)
        } else {
            state.beginSettle(id)
        }

        val startX = ownX
        val startY = ownY
        animationJob = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            animate(
                initialValue = 0f,
                targetValue = 1f,
                animationSpec = tween(220, easing = EaseOutCubic),
            ) { fraction, _ ->
                ownX = startX * (1f - fraction)
                ownY = startY * (1f - fraction)
            }
            ownX = 0f
            ownY = 0f
            state.finishSettle(id)
        }
    }

    Box(
        modifier = modifier
            .zIndex(if (isDragged || isSettling) 100f else 0f)
            .graphicsLayer {
                val xDp = if (isDragged || isSettling) ownX else siblingX.value
                val yDp = if (isDragged || isSettling) ownY else siblingY.value
                translationX = with(density) { xDp.dp.toPx() }
                translationY = with(density) { yDp.dp.toPx() }
                scaleX = scale.value
                scaleY = scale.value
                shadowElevation = if (isDragged) with(density) { 8.dp.toPx() } else 0f
            }
            .pointerInput(id, columns, totalCount, horizontalSlot, verticalSlot) {
                detectDragAfterLongPress(
                    onStart = {
                        animationJob?.cancel()
                        ownX = 0f
                        ownY = 0f
                        state.begin(id, index)
                        view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                    },
                    onDrag = { delta ->
                        ownX += with(density) { delta.x.toDp().value }
                        ownY += with(density) { delta.y.toDp().value }
                        state.target(
                            ReorderMath.gridTargetIndex(
                                index = index,
                                translationX = ownX,
                                translationY = ownY,
                                columns = columns,
                                totalCount = totalCount,
                                horizontalSlot = horizontalSlot,
                                verticalSlot = verticalSlot,
                            ),
                        )
                    },
                    onEnd = { settle(reorder = true) },
                    onCancel = { settle(reorder = false) },
                )
            },
        content = content,
    )
}

@Stable
class VerticalReorderState {
    var draggingId by mutableStateOf<String?>(null)
        private set
    var fromIndex by mutableIntStateOf(-1)
        private set
    var targetIndex by mutableIntStateOf(-1)
        private set
    var settlingId by mutableStateOf<String?>(null)
        private set
    private val measuredHeights = mutableStateMapOf<String, Float>()

    val active: Boolean get() = draggingId != null

    fun measure(id: String, height: Float) {
        if (height > 0f && measuredHeights[id] != height) measuredHeights[id] = height
    }

    fun heights(ids: List<String>): List<Float> = ids.map { measuredHeights[it] ?: 0f }

    fun begin(id: String, index: Int) {
        draggingId = id
        fromIndex = index
        targetIndex = index
        settlingId = null
    }

    fun target(index: Int) {
        targetIndex = index
    }

    fun beginSettle(id: String) {
        settlingId = id
        draggingId = null
        fromIndex = -1
        targetIndex = -1
    }

    fun finishSettle(id: String) {
        if (settlingId == id) settlingId = null
    }
}

@Composable
fun rememberVerticalReorderState(): VerticalReorderState =
    remember { VerticalReorderState() }

@Composable
fun ReorderableVerticalItem(
    id: String,
    index: Int,
    orderedIds: List<String>,
    state: VerticalReorderState,
    onReorder: (Int, Int) -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val density = LocalDensity.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var ownY by remember(id) { mutableFloatStateOf(0f) }
    var animationJob by remember(id) { mutableStateOf<Job?>(null) }
    val heights = state.heights(orderedIds)
    val siblingTarget = ReorderMath.verticalSiblingShift(
        index = index,
        from = state.fromIndex,
        to = state.targetIndex,
        heights = heights,
    )
    val siblingY = remember(id) { Animatable(0f) }
    LaunchedEffect(state.active, siblingTarget) {
        if (!state.active) {
            siblingY.snapTo(0f)
        } else {
            siblingY.animateTo(siblingTarget, tween(180, easing = EaseOutCubic))
        }
    }

    val isDragged = state.draggingId == id
    val isSettling = state.settlingId == id
    val scale = remember(id) { Animatable(1f) }
    LaunchedEffect(isDragged) {
        scale.animateTo(
            if (isDragged) 1.03f else 1f,
            tween(130, easing = EaseOutCubic),
        )
    }

    fun settle(reorder: Boolean) {
        val from = index
        val to = state.targetIndex.coerceIn(0, orderedIds.lastIndex)
        animationJob?.cancel()
        if (reorder && from != to) {
            val naturalLayoutDelta = ReorderMath.verticalSettleOffset(
                from = from,
                to = to,
                heights = heights,
            )
            ownY -= naturalLayoutDelta
            state.beginSettle(id)
            onReorder(from, to)
        } else {
            state.beginSettle(id)
        }

        val startY = ownY
        animationJob = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            animate(
                initialValue = startY,
                targetValue = 0f,
                animationSpec = tween(220, easing = EaseOutCubic),
            ) { value, _ -> ownY = value }
            ownY = 0f
            state.finishSettle(id)
        }
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .onSizeChanged { size ->
                state.measure(id, with(density) { size.height.toDp().value })
            }
            .zIndex(if (isDragged || isSettling) 100f else 0f)
            .graphicsLayer {
                val offsetDp = if (isDragged || isSettling) ownY else siblingY.value
                translationY = with(density) { offsetDp.dp.toPx() }
                scaleX = scale.value
                scaleY = scale.value
                shadowElevation = if (isDragged) with(density) { 8.dp.toPx() } else 0f
            }
            .pointerInput(id, orderedIds) {
                detectDragAfterLongPress(
                    onStart = {
                        animationJob?.cancel()
                        ownY = 0f
                        state.begin(id, index)
                        view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                    },
                    onDrag = { delta ->
                        ownY += with(density) { delta.y.toDp().value }
                        state.target(
                            ReorderMath.verticalTargetIndex(
                                index = index,
                                translationY = ownY,
                                heights = heights,
                                currentTarget = state.targetIndex,
                            ),
                        )
                    },
                    onEnd = { settle(reorder = true) },
                    onCancel = { settle(reorder = false) },
                )
            },
        content = content,
    )
}

/**
 * The predecessor activates reorder after 350 ms, shorter than Android's
 * platform long-press timeout. This detector keeps that exact threshold,
 * yields to scrolling when the finger moves first, and consumes only after
 * the hold succeeds so nested tap actions keep working.
 */
private suspend fun PointerInputScope.detectDragAfterLongPress(
    onStart: (Offset) -> Unit,
    onDrag: (Offset) -> Unit,
    onEnd: () -> Unit,
    onCancel: () -> Unit,
) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        val pointerId: PointerId = down.id
        val downPosition = down.position
        var lastPosition = down.position

        val held = withTimeoutOrNull(350L) {
            while (true) {
                val event = awaitPointerEvent()
                val change = event.changes.firstOrNull { it.id == pointerId }
                    ?: return@withTimeoutOrNull false
                if (!change.pressed) return@withTimeoutOrNull false
                lastPosition = change.position
                if ((lastPosition - downPosition).getDistance() > viewConfiguration.touchSlop) {
                    return@withTimeoutOrNull false
                }
            }
            @Suppress("UNREACHABLE_CODE")
            false
        } ?: true

        if (!held) return@awaitEachGesture
        onStart(downPosition)

        while (true) {
            val event = awaitPointerEvent()
            val change = event.changes.firstOrNull { it.id == pointerId }
            if (change == null) {
                onCancel()
                return@awaitEachGesture
            }
            if (!change.pressed) {
                change.consume()
                onEnd()
                return@awaitEachGesture
            }
            val delta = change.position - lastPosition
            lastPosition = change.position
            if (abs(delta.x) > 0f || abs(delta.y) > 0f) {
                change.consume()
                onDrag(delta)
            }
        }
    }
}
