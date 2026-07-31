package com.storybloom.app.ui.components

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DocumentScanner
import androidx.compose.material.icons.rounded.RotateLeft
import androidx.compose.material.icons.rounded.RotateRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.storybloom.app.media.PageImageStore
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.mechanics.CropCorner
import com.storybloom.app.ui.mechanics.CropRect
import com.storybloom.app.ui.mechanics.PhotoEditorMath
import com.storybloom.app.ui.text
import com.storybloom.app.ui.theme.BloomBlue
import com.storybloom.app.ui.theme.BloomGreen
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Direct-manipulation photo editor shared by capture, add-page and page
 * correction flows. Crop geometry lives in preview pixels, exactly as in the
 * predecessor, so the frame and its four handles never lag behind a finger.
 */
@Composable
fun NativePhotoEditorDialog(
    imageStore: PageImageStore,
    sourcePath: String,
    locale: UiLocale,
    queueIndex: Int? = null,
    queueTotal: Int? = null,
    allowSaveAndScan: Boolean = false,
    scanOnly: Boolean = false,
    onDismiss: () -> Unit,
    onSaved: (path: String, scanText: Boolean) -> Unit,
) {
    var sourceWidth by remember(sourcePath) { mutableIntStateOf(0) }
    var sourceHeight by remember(sourcePath) { mutableIntStateOf(0) }
    var rotation by remember(sourcePath) { mutableFloatStateOf(0f) }
    var liveRotation by remember(sourcePath) { mutableFloatStateOf(0f) }
    var crop by remember(sourcePath) { mutableStateOf(CropRect(0f, 0f, 0f, 0f)) }
    var previewWidthPx by remember(sourcePath) { mutableFloatStateOf(0f) }
    var previewHeightPx by remember(sourcePath) { mutableFloatStateOf(0f) }
    var saving by remember(sourcePath) { mutableStateOf(false) }
    var error by remember(sourcePath) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current

    LaunchedEffect(sourcePath) {
        val bitmap = imageStore.load(sourcePath)
        if (bitmap != null) {
            sourceWidth = bitmap.width
            sourceHeight = bitmap.height
            bitmap.recycle()
        } else {
            error = locale.text(
                "This image could not be opened.",
                "Не удалось открыть это изображение.",
            )
        }
    }

    LaunchedEffect(rotation, previewWidthPx, previewHeightPx) {
        if (previewWidthPx > 0f && previewHeightPx > 0f) {
            crop = CropRect(0f, 0f, previewWidthPx, previewHeightPx)
        }
    }

    fun rotateBy(degrees: Float) {
        rotation = normalizeDegrees(rotation + degrees)
        liveRotation = 0f
    }

    fun save(scanText: Boolean) {
        if (saving || previewWidthPx <= 0f || previewHeightPx <= 0f) return
        saving = true
        error = null
        val fractions = PhotoEditorMath.fractions(crop, previewWidthPx, previewHeightPx)
        scope.launch {
            runCatching {
                imageStore.saveEdited(
                    sourcePath = sourcePath,
                    rotationDegrees = rotation,
                    cropLeftFraction = fractions.left,
                    cropTopFraction = fractions.top,
                    cropRightFraction = fractions.right,
                    cropBottomFraction = fractions.bottom,
                )
            }.onSuccess { onSaved(it, scanText) }
                .onFailure {
                    error = locale.text(
                        "The edited image could not be saved.",
                        "Не удалось сохранить отредактированное изображение.",
                    )
                    saving = false
                }
        }
    }

    Dialog(
        onDismissRequest = { if (!saving) onDismiss() },
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnBackPress = !saving,
            dismissOnClickOutside = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .safeDrawingPadding(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    if (queueIndex != null && queueTotal != null && queueTotal > 1) {
                        Text(
                            locale.text(
                                "Photo $queueIndex of $queueTotal",
                                "Фото $queueIndex из $queueTotal",
                            ),
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    Text(
                        if (scanOnly) {
                            locale.text(
                                "Frame the text to recognize · the page photo will stay unchanged",
                                "Выделите текст для распознавания · фото страницы не изменится",
                            )
                        } else {
                            locale.text(
                                "Drag the frame or its corners to crop · twist with two fingers to straighten",
                                "Перетаскивайте рамку или её углы · поворачивайте двумя пальцами",
                            )
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelSmall,
                        textAlign = TextAlign.Center,
                    )
                }

                BoxWithConstraints(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp, vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (sourceWidth > 0 && sourceHeight > 0) {
                        val rotatedBounds = PhotoEditorMath.rotatedBounds(
                            sourceWidth.toFloat(),
                            sourceHeight.toFloat(),
                            rotation,
                        )
                        val maximumWidthPx = with(density) { maxWidth.toPx() - 36.dp.toPx() }
                        val maximumHeightPx = with(density) {
                            min(maxHeight.toPx() - 36.dp.toPx(), 460.dp.toPx())
                        }
                        val previewScale = min(
                            maximumWidthPx / rotatedBounds.first.coerceAtLeast(1f),
                            maximumHeightPx / rotatedBounds.second.coerceAtLeast(1f),
                        )
                        val previewWidth = with(density) {
                            (rotatedBounds.first * previewScale).toDp()
                        }
                        val previewHeight = with(density) {
                            (rotatedBounds.second * previewScale).toDp()
                        }
                        val unrotatedWidth = with(density) {
                            (sourceWidth * previewScale).toDp()
                        }
                        val unrotatedHeight = with(density) {
                            (sourceHeight * previewScale).toDp()
                        }

                        Box(
                            modifier = Modifier
                                .size(previewWidth, previewHeight)
                                .onSizeChanged {
                                    previewWidthPx = it.width.toFloat()
                                    previewHeightPx = it.height.toFloat()
                                }
                                .pointerInput(sourcePath, rotation) {
                                    detectTwist(
                                        onChanged = { liveRotation = it },
                                        onFinished = { degrees ->
                                            liveRotation = 0f
                                            if (abs(degrees) >= .5f) rotateBy(degrees)
                                        },
                                    )
                                },
                            // Crop geometry is expressed from the preview's
                            // top-left. Keeping the parent centered made the
                            // frame itself look right at full size while its
                            // four handles were offset from the center (two
                            // landed off-screen). Center only the bitmap.
                            contentAlignment = Alignment.TopStart,
                        ) {
                            NativeImage(
                                path = sourcePath,
                                modifier = Modifier
                                    .align(Alignment.Center)
                                    .size(unrotatedWidth, unrotatedHeight)
                                    .graphicsLayer {
                                        rotationZ = rotation + liveRotation
                                    },
                                contentScale = ContentScale.FillBounds,
                                maxEdge = PageImageStore.MAX_IMAGE_EDGE,
                            )
                            CropScrim(crop)
                            CropFrame(
                                rect = crop,
                                boundsWidth = previewWidthPx,
                                boundsHeight = previewHeightPx,
                                onChange = { crop = it },
                            )
                        }
                    } else if (error == null) {
                        CircularProgressIndicator()
                    }
                }

                if (error != null) {
                    Text(
                        requireNotNull(error),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp, vertical = 4.dp),
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                    )
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                        RotationControl(
                            label = locale.text("Left", "Влево"),
                            enabled = !saving,
                            onClick = { rotateBy(-90f) },
                        ) {
                            Icon(
                                Icons.Rounded.RotateLeft,
                                contentDescription = null,
                                tint = it,
                                modifier = Modifier.size(31.dp),
                            )
                        }
                        RotationControl(
                            label = locale.text("Right", "Вправо"),
                            enabled = !saving,
                            onClick = { rotateBy(90f) },
                        ) {
                            Icon(
                                Icons.Rounded.RotateRight,
                                contentDescription = null,
                                tint = it,
                                modifier = Modifier.size(31.dp),
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        StoryIconButton(
                            onClick = onDismiss,
                            enabled = !saving,
                            modifier = Modifier.size(56.dp),
                            containerColor = MaterialTheme.colorScheme.surfaceVariant,
                            contentColor = MaterialTheme.colorScheme.onSurface,
                        ) {
                            Icon(Icons.Rounded.Close, contentDescription = null, tint = it)
                        }
                        if (allowSaveAndScan || scanOnly) {
                            StoryIconButton(
                                onClick = { save(true) },
                                enabled = !saving && sourceWidth > 0,
                                modifier = Modifier.size(56.dp),
                                containerColor = BloomGreen.copy(alpha = .18f),
                                contentColor = BloomGreen,
                                haptic = StoryHaptic.MEDIUM,
                            ) {
                                Icon(Icons.Rounded.DocumentScanner, contentDescription = null, tint = it)
                            }
                        }
                        if (!scanOnly) {
                            StoryIconButton(
                                onClick = { save(false) },
                                enabled = !saving && sourceWidth > 0,
                                modifier = Modifier.size(56.dp),
                                containerColor = BloomBlue.copy(alpha = .16f),
                                contentColor = BloomBlue,
                                haptic = StoryHaptic.MEDIUM,
                            ) {
                                if (saving) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(24.dp),
                                        color = it,
                                        strokeWidth = 2.dp,
                                    )
                                } else {
                                    Icon(Icons.Rounded.Check, contentDescription = null, tint = it)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RotationControl(
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
    icon: @Composable (Color) -> Unit,
) {
    TactileSurface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.widthIn(min = 58.dp),
        containerColor = Color.Transparent,
        contentColor = BloomBlue,
        borderColor = Color.Transparent,
        liftedElevation = 0.dp,
    ) { color ->
        Column(
            modifier = Modifier.padding(horizontal = 5.dp, vertical = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            icon(color)
            Text(
                label,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun CropScrim(rect: CropRect) {
    Canvas(Modifier.fillMaxSize()) {
        val scrim = Color.Black.copy(alpha = .42f)
        drawRect(scrim, size = Size(size.width, rect.top.coerceAtLeast(0f)))
        drawRect(
            scrim,
            topLeft = Offset(0f, rect.bottom.coerceAtMost(size.height)),
            size = Size(size.width, (size.height - rect.bottom).coerceAtLeast(0f)),
        )
        drawRect(
            scrim,
            topLeft = Offset(0f, rect.top),
            size = Size(rect.left.coerceAtLeast(0f), rect.height.coerceAtLeast(0f)),
        )
        drawRect(
            scrim,
            topLeft = Offset(rect.right.coerceAtMost(size.width), rect.top),
            size = Size((size.width - rect.right).coerceAtLeast(0f), rect.height.coerceAtLeast(0f)),
        )
    }
}

@Composable
private fun CropFrame(
    rect: CropRect,
    boundsWidth: Float,
    boundsHeight: Float,
    onChange: (CropRect) -> Unit,
) {
    if (boundsWidth <= 0f || boundsHeight <= 0f || rect.width <= 0f || rect.height <= 0f) return
    val density = LocalDensity.current
    val view = LocalView.current
    val minimumPx = with(density) { 40.dp.toPx() }
    val currentRect by rememberUpdatedState(rect)
    Box(
        modifier = Modifier
            .offset { IntOffset(rect.left.roundToInt(), rect.top.roundToInt()) }
            .size(
                width = with(density) { rect.width.toDp() },
                height = with(density) { rect.height.toDp() },
            )
            .background(BloomBlue.copy(alpha = .08f))
            .border(2.dp, BloomBlue)
            .pointerInput(boundsWidth, boundsHeight) {
                detectDragGestures(
                    onDragStart = {
                        view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    },
                ) { change, drag ->
                    change.consume()
                    onChange(
                        PhotoEditorMath.move(
                            currentRect,
                            drag.x,
                            drag.y,
                            boundsWidth,
                            boundsHeight,
                        ),
                    )
                }
            },
    )
    CropCorner.entries.forEach { corner ->
        val x = when (corner) {
            CropCorner.TOP_LEFT, CropCorner.BOTTOM_LEFT -> rect.left
            CropCorner.TOP_RIGHT, CropCorner.BOTTOM_RIGHT -> rect.right
        }
        val y = when (corner) {
            CropCorner.TOP_LEFT, CropCorner.TOP_RIGHT -> rect.top
            CropCorner.BOTTOM_LEFT, CropCorner.BOTTOM_RIGHT -> rect.bottom
        }
        CropHandle(
            x = x,
            y = y,
            corner = corner,
            rect = rect,
            boundsWidth = boundsWidth,
            boundsHeight = boundsHeight,
            minimumPx = minimumPx,
            onChange = onChange,
        )
    }
}

@Composable
private fun CropHandle(
    x: Float,
    y: Float,
    corner: CropCorner,
    rect: CropRect,
    boundsWidth: Float,
    boundsHeight: Float,
    minimumPx: Float,
    onChange: (CropRect) -> Unit,
) {
    val density = LocalDensity.current
    val view = LocalView.current
    val handlePx = with(density) { 32.dp.toPx() }
    val currentRect by rememberUpdatedState(rect)
    Box(
        modifier = Modifier
            .offset {
                IntOffset(
                    (x - handlePx / 2f).roundToInt(),
                    (y - handlePx / 2f).roundToInt(),
                )
            }
            .size(32.dp)
            .pointerInput(corner, boundsWidth, boundsHeight) {
                detectDragGestures(
                    onDragStart = {
                        view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    },
                ) { change, drag ->
                    change.consume()
                    onChange(
                        PhotoEditorMath.resize(
                            rect = currentRect,
                            corner = corner,
                            deltaX = drag.x,
                            deltaY = drag.y,
                            boundsWidth = boundsWidth,
                            boundsHeight = boundsHeight,
                            minimumSize = minimumPx,
                        ),
                    )
                }
            }
            .clip(CircleShape)
            .background(BloomBlue)
            .border(2.dp, Color.White, CircleShape),
    )
}

private suspend fun PointerInputScope.detectTwist(
    onChanged: (Float) -> Unit,
    onFinished: (Float) -> Unit,
) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false)
        var previousAngle: Float? = null
        var accumulated = 0f
        do {
            val event = awaitPointerEvent()
            val pressed = event.changes.filter { it.pressed }
            if (pressed.size >= 2) {
                val first = pressed[0].position
                val second = pressed[1].position
                val angle = atan2(second.y - first.y, second.x - first.x) * 180f / PI.toFloat()
                val old = previousAngle
                if (old != null) {
                    var delta = angle - old
                    if (delta > 180f) delta -= 360f
                    if (delta < -180f) delta += 360f
                    accumulated += delta
                    onChanged(accumulated)
                }
                previousAngle = angle
                event.changes.forEach { it.consume() }
            } else if (previousAngle != null) {
                break
            }
        } while (event.changes.any { it.pressed })
        onFinished(accumulated)
    }
}

private fun normalizeDegrees(value: Float): Float {
    var normalized = value % 360f
    if (normalized > 180f) normalized -= 360f
    if (normalized < -180f) normalized += 360f
    return normalized
}
