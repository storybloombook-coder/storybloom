package com.storybloom.app.ui.screens

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.text

@Composable
fun HomeScreen(
    locale: UiLocale,
    onLocaleChange: (UiLocale) -> Unit,
    onLibrary: () -> Unit,
    onAddBook: () -> Unit,
    onCreateStory: () -> Unit,
    onScene: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF1B2732)),
    ) {
        AndroidView(
            factory = { context -> LoopingMenuVideoView(context) },
            modifier = Modifier.fillMaxSize(),
        )

        // The source clip is already softly focused; this quiet scrim gives
        // text consistent contrast while keeping the crossroads visible.
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            Color.Black.copy(alpha = .14f),
                            Color.Black.copy(alpha = .22f),
                            Color.Black.copy(alpha = .34f),
                        ),
                    ),
                ),
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = "Storybloom",
                color = Color.White,
                fontSize = 34.sp,
                lineHeight = 40.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = .5.sp,
                textAlign = TextAlign.Center,
            )
            Text(
                text = locale.text(
                    "Read a book to life.",
                    "Читайте — и книга оживёт.",
                ),
                color = Color.White.copy(alpha = .72f),
                fontSize = 16.sp,
                lineHeight = 22.sp,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(24.dp))
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                TactileGlassButton(
                    label = locale.text("Add a Book", "Новая книга"),
                    onClick = onAddBook,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                )
                TactileGlassButton(
                    label = locale.text("Create a Story", "Своя история"),
                    onClick = onCreateStory,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                )
                TactileGlassButton(
                    label = locale.text("My Library", "Библиотека"),
                    onClick = onLibrary,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                )
            }
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .navigationBarsPadding()
                .padding(start = 14.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TactileGlassButton(
                label = if (locale == UiLocale.RUSSIAN) "EN" else "RU",
                onClick = {
                    onLocaleChange(
                        if (locale == UiLocale.ENGLISH) UiLocale.RUSSIAN else UiLocale.ENGLISH,
                    )
                },
                modifier = Modifier.size(40.dp),
                shape = CircleShape,
                fontSize = 13.sp,
                accessibilityLabel = locale.text("Switch to Russian", "Switch to English"),
            )
            TactileGlassButton(
                label = "3D",
                onClick = onScene,
                modifier = Modifier.size(40.dp),
                shape = CircleShape,
                fontSize = 13.sp,
                accessibilityLabel = locale.text("Open 3D scene", "Открыть 3D-сцену"),
            )
        }
    }
}

@Composable
private fun TactileGlassButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(12.dp),
    fontSize: TextUnit = 17.sp,
    accessibilityLabel: String = label,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) .96f else 1f,
        animationSpec = tween(durationMillis = if (pressed) 80 else 120),
        label = "glass button press",
    )
    val hostView = LocalView.current

    LaunchedEffect(pressed) {
        if (pressed) {
            hostView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        }
    }

    Box(
        modifier = modifier
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .clip(shape)
            .background(
                Brush.verticalGradient(
                    listOf(
                        Color.White.copy(alpha = .26f),
                        Color.White.copy(alpha = .13f),
                    ),
                ),
            )
            .border(
                width = 1.dp,
                brush = Brush.verticalGradient(
                    listOf(
                        Color.White.copy(alpha = .68f),
                        Color.White.copy(alpha = .24f),
                    ),
                ),
                shape = shape,
            )
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                role = Role.Button,
                onClickLabel = accessibilityLabel,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = Color.White,
            fontSize = fontSize,
            lineHeight = fontSize * 1.25f,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.labelLarge,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * A small native video surface for the menu backdrop. It owns no controls,
 * audio, networking, JavaScript runtime, or WebView.
 */
private class LoopingMenuVideoView(context: Context) : FrameLayout(context) {
    private inner class VideoSlot(val index: Int) : TextureView.SurfaceTextureListener {
        val view = TextureView(context).also { textureView ->
            textureView.isOpaque = true
            textureView.surfaceTextureListener = this
        }
        var texture: SurfaceTexture? = null
        var surface: Surface? = null
        var player: MediaPlayer? = null
        var prepared = false
        var videoWidth = 0
        var videoHeight = 0

        override fun onSurfaceTextureAvailable(
            surfaceTexture: SurfaceTexture,
            width: Int,
            height: Int,
        ) {
            texture = surfaceTexture
            if (isAttachedToWindow) openSlot(this)
        }

        override fun onSurfaceTextureSizeChanged(
            surfaceTexture: SurfaceTexture,
            width: Int,
            height: Int,
        ) {
            applyCenterCrop(this)
        }

        override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
            releaseSlot(this)
            texture = null
            return true
        }

        override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) = Unit
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val slots = listOf(VideoSlot(0), VideoSlot(1))
    private var activeIndex = 0
    private var transitioning = false
    private var loopMonitorScheduled = false
    private val loopMonitor = object : Runnable {
        override fun run() {
            loopMonitorScheduled = false
            val active = slots[activeIndex]
            if (
                !transitioning &&
                active.prepared &&
                active.player?.isPlaying == true &&
                (active.player?.currentPosition ?: 0) >= CROSSFADE_START_MS
            ) {
                beginDecoderHandoff()
            }
            if (windowVisibility == View.VISIBLE && isAttachedToWindow) {
                scheduleLoopMonitor()
            }
        }
    }

    init {
        setBackgroundColor(android.graphics.Color.rgb(27, 39, 50))
        slots.forEach { slot ->
            slot.view.alpha = if (slot.index == activeIndex) 1f else 0f
            addView(
                slot.view,
                LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        slots.forEach { slot ->
            if (slot.texture == null && slot.view.isAvailable) {
                slot.texture = slot.view.surfaceTexture
            }
            openSlot(slot)
        }
    }

    override fun onDetachedFromWindow() {
        stopLoopMonitor()
        slots.forEach { slot ->
            slot.view.animate().cancel()
            releaseSlot(slot)
        }
        transitioning = false
        super.onDetachedFromWindow()
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility == View.VISIBLE) {
            slots.forEach(::openSlot)
            val active = slots[activeIndex]
            if (active.prepared && !transitioning) active.player?.start()
            scheduleLoopMonitor()
        } else {
            stopLoopMonitor()
            slots.forEach { slot ->
                if (slot.prepared && slot.player?.isPlaying == true) {
                    slot.player?.pause()
                }
            }
        }
    }

    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        super.onSizeChanged(width, height, oldWidth, oldHeight)
        slots.forEach(::applyCenterCrop)
    }

    private fun openSlot(slot: VideoSlot) {
        val texture = slot.texture ?: return
        if (slot.player != null) return
        val surface = Surface(texture)
        slot.surface = surface
        try {
            slot.player = MediaPlayer().also { mediaPlayer ->
                context.assets.openFd("videos/menu-background.mp4").use { descriptor ->
                    mediaPlayer.setDataSource(
                        descriptor.fileDescriptor,
                        descriptor.startOffset,
                        descriptor.length,
                    )
                }
                mediaPlayer.setSurface(surface)
                mediaPlayer.isLooping = false
                mediaPlayer.setVolume(0f, 0f)
                mediaPlayer.setOnPreparedListener {
                    if (slot.player !== it) return@setOnPreparedListener
                    slot.prepared = true
                    slot.videoWidth = it.videoWidth
                    slot.videoHeight = it.videoHeight
                    applyCenterCrop(slot)
                    if (
                        slot.index == activeIndex &&
                        !transitioning &&
                        windowVisibility == View.VISIBLE &&
                        isAttachedToWindow
                    ) {
                        it.start()
                        scheduleLoopMonitor()
                    }
                }
                mediaPlayer.setOnVideoSizeChangedListener { _, videoWidth, videoHeight ->
                    slot.videoWidth = videoWidth
                    slot.videoHeight = videoHeight
                    applyCenterCrop(slot)
                }
                mediaPlayer.setOnCompletionListener {
                    if (slot.index == activeIndex) beginDecoderHandoff()
                }
                mediaPlayer.setOnErrorListener { _, _, _ ->
                    val wasActive = slot.index == activeIndex
                    releaseSlot(slot)
                    if (wasActive) beginDecoderHandoff()
                    true
                }
                mediaPlayer.prepareAsync()
            }
        } catch (_: Exception) {
            releaseSlot(slot)
        }
    }

    private fun beginDecoderHandoff() {
        if (transitioning) return
        val outgoing = slots[activeIndex]
        val incoming = slots[1 - activeIndex]
        if (!incoming.prepared || incoming.player == null) {
            openSlot(incoming)
            return
        }

        transitioning = true
        incoming.view.animate().cancel()
        outgoing.view.animate().cancel()
        incoming.view.bringToFront()
        incoming.view.alpha = 0f
        incoming.player?.start()
        incoming.view.animate()
            .alpha(1f)
            .setDuration(CROSSFADE_DURATION_MS)
            .start()
        outgoing.view.animate()
            .alpha(0f)
            .setDuration(CROSSFADE_DURATION_MS)
            .withEndAction {
                if (!isAttachedToWindow) return@withEndAction
                outgoing.player?.pause()
                releaseSlot(outgoing)
                activeIndex = incoming.index
                transitioning = false
                openSlot(outgoing)
                scheduleLoopMonitor()
            }
            .start()
    }

    private fun applyCenterCrop(slot: VideoSlot) {
        val viewWidth = slot.view.width.toFloat()
        val viewHeight = slot.view.height.toFloat()
        if (
            viewWidth <= 0f ||
            viewHeight <= 0f ||
            slot.videoWidth <= 0 ||
            slot.videoHeight <= 0
        ) {
            return
        }
        val videoAspect = slot.videoWidth.toFloat() / slot.videoHeight.toFloat()
        val viewAspect = viewWidth / viewHeight
        val scaleX = if (videoAspect > viewAspect) videoAspect / viewAspect else 1f
        val scaleY = if (videoAspect < viewAspect) viewAspect / videoAspect else 1f
        slot.view.setTransform(
            Matrix().apply {
                setScale(scaleX, scaleY, viewWidth / 2f, viewHeight / 2f)
            },
        )
    }

    private fun scheduleLoopMonitor() {
        if (loopMonitorScheduled) return
        loopMonitorScheduled = true
        mainHandler.postDelayed(loopMonitor, LOOP_POLL_MS)
    }

    private fun stopLoopMonitor() {
        mainHandler.removeCallbacks(loopMonitor)
        loopMonitorScheduled = false
    }

    private fun releaseSlot(slot: VideoSlot) {
        slot.prepared = false
        slot.videoWidth = 0
        slot.videoHeight = 0
        slot.player?.setOnPreparedListener(null)
        slot.player?.setOnVideoSizeChangedListener(null)
        slot.player?.setOnCompletionListener(null)
        slot.player?.setOnErrorListener(null)
        slot.player?.release()
        slot.player = null
        slot.surface?.release()
        slot.surface = null
    }

    private companion object {
        // Each decoder is retired before MediaCodec sees end-of-stream. The
        // source's final section already blends back toward its first frame,
        // so the two surfaces can hand off without changing the scene.
        const val CROSSFADE_START_MS = 12_000
        const val CROSSFADE_DURATION_MS = 700L
        const val LOOP_POLL_MS = 100L
    }
}
