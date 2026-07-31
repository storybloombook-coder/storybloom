package com.storybloom.app.ui.components

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.view.HapticFeedbackConstants
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.storybloom.app.data.BookSummary
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.mechanics.ShelfPhysics
import com.storybloom.app.ui.text
import kotlinx.coroutines.isActive
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private val ShelfWood = Color(0xFF8A5A34)
private val ShelfWoodDark = Color(0xFF6B4423)

/**
 * Fixed-width, paginated, sensor-aware shelf. This is a renderer around
 * [ShelfPhysics]; all movement remains continuous rather than snapping to
 * LazyRow slots.
 */
@Composable
fun PhysicalBookshelf(
    books: List<BookSummary>,
    locale: UiLocale,
    onOpen: (String) -> Unit,
    onReorder: (List<String>) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (books.isEmpty()) return

    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val containerWidth = maxWidth.value
        val booksPerShelf = max(
            1,
            floor(
                (containerWidth - 2f * ShelfPhysics.WALL_WIDTH + ShelfPhysics.SPINE_GAP) /
                    ShelfPhysics.SLOT,
            ).toInt(),
        )
        val shelfCount = max(1, ceil(books.size / booksPerShelf.toFloat()).toInt())
        var currentShelf by remember { mutableIntStateOf(0) }
        LaunchedEffect(shelfCount) {
            currentShelf = currentShelf.coerceIn(0, shelfCount - 1)
        }

        val pageStart = currentShelf * booksPerShelf
        val pageBooks = books.drop(pageStart).take(booksPerShelf)
        val pageSetKey = pageBooks.map { it.book.id }.sorted().joinToString("|")

        Column {
            Text(
                text = locale.text("Bookshelf", "Книжная полка"),
                modifier = Modifier.padding(start = 2.dp, bottom = 6.dp),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Bold,
            )

            key(currentShelf, pageSetKey) {
                ShelfPage(
                    books = pageBooks,
                    containerWidth = containerWidth,
                    onOpen = onOpen,
                    onReorder = { pageIds ->
                        val allIds = books.map { it.book.id }.toMutableList()
                        val replaceCount = min(pageIds.size, allIds.size - pageStart)
                        repeat(replaceCount) { allIds.removeAt(pageStart) }
                        allIds.addAll(pageStart, pageIds)
                        onReorder(allIds)
                    },
                )
            }

            Box(
                Modifier
                    .fillMaxWidth()
                    .height(14.dp)
                    .shadow(
                        elevation = 4.dp,
                        shape = RoundedCornerShape(
                            bottomStart = 4.dp,
                            bottomEnd = 4.dp,
                        ),
                    )
                    .background(
                        ShelfWood,
                        RoundedCornerShape(
                            bottomStart = 4.dp,
                            bottomEnd = 4.dp,
                        ),
                    ),
            )

            if (shelfCount > 1) {
                ShelfSwitcher(
                    count = shelfCount,
                    current = currentShelf,
                    onSelect = { currentShelf = it },
                )
            }
        }
    }
}

@Composable
private fun ShelfPage(
    books: List<BookSummary>,
    containerWidth: Float,
    onOpen: (String) -> Unit,
    onReorder: (List<String>) -> Unit,
) {
    if (books.isEmpty()) return
    val density = LocalDensity.current
    val view = LocalView.current
    val stableIds = remember { books.map { it.book.id } }
    val currentBooksById = books.associateBy { it.book.id }
    val stableBooks = stableIds.mapNotNull(currentBooksById::get)
    val physics = remember(stableIds) {
        ShelfPhysics(
            bookCount = stableIds.size,
            containerWidth = containerWidth,
        )
    }
    var poses by remember(physics) { mutableStateOf(physics.poses()) }

    LaunchedEffect(physics, containerWidth) {
        physics.updateContainerWidth(containerWidth)
        poses = physics.poses()
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
                if (physics.step(delta)) poses = physics.poses()
                physics.drainEvents().forEach { event ->
                    when (event) {
                        ShelfPhysics.Event.GapChanged,
                        ShelfPhysics.Event.SwipeHit,
                        -> view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    }
                }
            }
        }
    }
    ShelfSensorEffect(physics)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(ShelfPhysics.SHELF_HEIGHT.dp)
            .pointerInput(physics, density) {
                awaitPointerEventScope {
                    var previousX: Float? = null
                    var cumulativeX = 0f
                    var swipeStarted = false
                    while (true) {
                        val event = awaitPointerEvent(PointerEventPass.Initial)
                        val change = event.changes.firstOrNull()
                        if (change == null) {
                            previousX = null
                            cumulativeX = 0f
                            swipeStarted = false
                            continue
                        }
                        if (!change.pressed) {
                            previousX = null
                            cumulativeX = 0f
                            swipeStarted = false
                            continue
                        }
                        val oldX = previousX
                        if (oldX == null) {
                            physics.beginSwipe()
                            previousX = change.position.x
                            cumulativeX = 0f
                            swipeStarted = false
                            continue
                        }
                        val deltaX = change.position.x - oldX
                        previousX = change.position.x
                        cumulativeX += deltaX
                        if (!swipeStarted && abs(cumulativeX) >= viewConfiguration.touchSlop) {
                            swipeStarted = true
                        }
                        if (swipeStarted && !physics.isDragging() && abs(deltaX) > 0.01f) {
                            physics.swipeAt(
                                pointerX = with(density) { change.position.x.toDp().value },
                                direction = deltaX,
                            )
                        }
                    }
                }
            },
    ) {
        Box(
            Modifier
                .align(Alignment.TopStart)
                .width(ShelfPhysics.WALL_WIDTH.dp)
                .height(ShelfPhysics.VISIBLE_HEIGHT.dp)
                .background(
                    ShelfWoodDark,
                    RoundedCornerShape(topStart = 3.dp, bottomStart = 3.dp),
                ),
        )
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .width(ShelfPhysics.WALL_WIDTH.dp)
                .height(ShelfPhysics.VISIBLE_HEIGHT.dp)
                .background(
                    ShelfWoodDark,
                    RoundedCornerShape(topEnd = 3.dp, bottomEnd = 3.dp),
                ),
        )

        stableBooks.forEachIndexed { index, summary ->
            val pose = poses.getOrNull(index) ?: return@forEachIndexed
            PhysicalSpine(
                summary = summary,
                index = index,
                pose = pose,
                physics = physics,
                onOpen = onOpen,
                onDrop = { result ->
                    if (result.wasLifted) {
                        view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                    }
                    onReorder(result.order.map(stableIds::get))
                },
            )
        }
    }
}

@Composable
private fun PhysicalSpine(
    summary: BookSummary,
    index: Int,
    pose: ShelfPhysics.Pose,
    physics: ShelfPhysics,
    onOpen: (String) -> Unit,
    onDrop: (ShelfPhysics.DragResult) -> Unit,
) {
    val density = LocalDensity.current
    val view = LocalView.current
    val spineColor = remember(summary.book.id) {
        Color.hsv(
            hue = deterministicShelfHue(summary.book.id),
            saturation = .56f,
            value = .68f,
        )
    }
    val pivotFraction = min(1f, abs(pose.rotation) / 78f)
    val pivotX = 0.5f + (if (pose.rotation >= 0f) 0.5f else -0.5f) * pivotFraction
    val pivotY = 0.5f + 0.5f * pivotFraction
    val shape = RoundedCornerShape(4.dp)

    Box(
        modifier = Modifier
            .offset {
                IntOffset(
                    x = with(density) { pose.x.dp.roundToPx() },
                    y = with(density) { (pose.liftY + pose.bounceY).dp.roundToPx() },
                )
            }
            .zIndex(if (pose.isDragged) 10f else 1f)
            .width(ShelfPhysics.SPINE_WIDTH.dp)
            .height(ShelfPhysics.VISIBLE_HEIGHT.dp)
            .graphicsLayer {
                rotationZ = pose.rotation
                transformOrigin = TransformOrigin(
                    pivotFractionX = pivotX.coerceIn(0f, 1f),
                    pivotFractionY = pivotY.coerceIn(0f, 1f),
                )
                scaleX = if (pose.isLifted) 1.08f else 1f
                scaleY = if (pose.isLifted) 1.08f else 1f
                shadowElevation = with(density) {
                    (if (pose.isLifted) 7.dp else 3.dp).toPx()
                }
                this.shape = shape
                clip = true
            }
            .background(spineColor, shape)
            .pointerInput(summary.book.id, physics) {
                detectDragGesturesAfterLongPress(
                    onDragStart = { offset ->
                        if (
                            physics.beginDrag(
                                index = index,
                                touchX = with(density) { offset.x.toDp().value },
                                touchY = with(density) { offset.y.toDp().value },
                            )
                        ) {
                            view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                        }
                    },
                    onDrag = { change, dragAmount ->
                        change.consume()
                        physics.dragBy(
                            deltaX = with(density) { dragAmount.x.toDp().value },
                            deltaY = with(density) { dragAmount.y.toDp().value },
                        )
                    },
                    onDragEnd = {
                        physics.endDrag()?.let(onDrop)
                    },
                    onDragCancel = {
                        physics.cancelDrag()?.let(onDrop)
                    },
                )
            }
            .clickable { onOpen(summary.book.id) },
    ) {
        Box(
            Modifier
                .padding(start = 3.dp)
                .width(2.dp)
                .fillMaxSize()
                .background(Color.White.copy(alpha = .30f)),
        )
        Text(
            text = summary.book.title,
            modifier = Modifier
                .align(Alignment.Center)
                .width(102.dp)
                .height(48.dp)
                .graphicsLayer { rotationZ = 90f },
            color = Color.White.copy(alpha = .94f),
            fontSize = 12.sp,
            lineHeight = 13.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 14.dp)
                .fillMaxWidth(.78f)
                .height(3.dp)
                .background(
                    Color.White.copy(alpha = .24f),
                    RoundedCornerShape(2.dp),
                ),
        )
    }
}

@Composable
private fun ShelfSensorEffect(physics: ShelfPhysics) {
    val context = LocalContext.current
    DisposableEffect(context, physics) {
        val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val accelerometer = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        var baselineY: Float? = null
        var lastUpdateNanos = 0L
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                if (event.timestamp - lastUpdateNanos < 80_000_000L) return
                lastUpdateNanos = event.timestamp
                val gravity = SensorManager.GRAVITY_EARTH
                val x = event.values[0] / gravity
                val y = event.values[1] / gravity
                val baseline = baselineY
                baselineY = if (baseline == null) {
                    y
                } else {
                    baseline + (y - baseline) * 0.06f
                }
                physics.updateSensor(
                    tilt = -x,
                    verticalJerk = y - (baselineY ?: y),
                )
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }
        if (accelerometer != null) {
            manager.registerListener(
                listener,
                accelerometer,
                SensorManager.SENSOR_DELAY_GAME,
            )
        }
        onDispose { manager.unregisterListener(listener) }
    }
}

@Composable
private fun ShelfSwitcher(
    count: Int,
    current: Int,
    onSelect: (Int) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 10.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { index ->
            val selected = index == current
            TactileSurface(
                onClick = { onSelect(index) },
                enabled = !selected,
                shape = RoundedCornerShape(10.dp),
                containerColor = if (selected) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurface.copy(alpha = .08f)
                },
                contentColor = if (selected) {
                    MaterialTheme.colorScheme.onPrimary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier
                    .padding(horizontal = 3.dp)
                    .size(width = 34.dp, height = 28.dp),
            ) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = (index + 1).toString(),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

private fun deterministicShelfHue(id: String): Float {
    var hash = 0L
    id.forEach { character ->
        hash = (hash * 31L + character.code) and 0xFFFF_FFFFL
    }
    return (hash % 360L).toFloat()
}
