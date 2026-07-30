package com.storybloom.app.ui.screens

import android.content.Context
import android.graphics.BitmapFactory
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
import android.widget.ImageView
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
private class LoopingMenuVideoView(context: Context) :
    FrameLayout(context),
    TextureView.SurfaceTextureListener {
    private val videoView = TextureView(context).apply {
        isOpaque = true
        surfaceTextureListener = this@LoopingMenuVideoView
    }
    private val posterView = ImageView(context).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        context.assets.open("videos/menu-background-poster.webp").use { stream ->
            setImageBitmap(BitmapFactory.decodeStream(stream))
        }
        alpha = 1f
    }
    private val mainHandler = Handler(Looper.getMainLooper())
    private var surface: Surface? = null
    private var player: MediaPlayer? = null
    private var prepared = false
    private var restarting = true
    private var monitorScheduled = false
    private var videoWidth = 0
    private var videoHeight = 0
    private val loopMonitor = object : Runnable {
        override fun run() {
            monitorScheduled = false
            val currentPlayer = player
            if (
                !restarting &&
                prepared &&
                currentPlayer?.isPlaying == true &&
                currentPlayer.currentPosition >= MASKED_RESTART_MS
            ) {
                beginMaskedRestart()
            } else if (isAttachedToWindow && windowVisibility == View.VISIBLE) {
                scheduleMonitor()
            }
        }
    }

    init {
        setBackgroundColor(android.graphics.Color.rgb(27, 39, 50))
        addView(
            videoView,
            LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        addView(
            posterView,
            LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (surface == null && videoView.isAvailable) {
            videoView.surfaceTexture?.let { surface = Surface(it) }
        }
        openPlayer()
    }

    override fun onDetachedFromWindow() {
        stopMonitor()
        releasePlayer()
        super.onDetachedFromWindow()
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility == View.VISIBLE) {
            openPlayer()
            if (prepared) {
                player?.start()
                scheduleMonitor()
            }
        } else {
            stopMonitor()
            if (prepared && player?.isPlaying == true) player?.pause()
        }
    }

    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        super.onSizeChanged(width, height, oldWidth, oldHeight)
        applyCenterCrop()
    }

    override fun onSurfaceTextureAvailable(
        surfaceTexture: SurfaceTexture,
        width: Int,
        height: Int,
    ) {
        surface?.release()
        surface = Surface(surfaceTexture)
        if (isAttachedToWindow) openPlayer()
    }

    override fun onSurfaceTextureSizeChanged(
        surfaceTexture: SurfaceTexture,
        width: Int,
        height: Int,
    ) {
        applyCenterCrop()
    }

    override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
        stopMonitor()
        releasePlayer()
        surface?.release()
        surface = null
        posterView.alpha = 1f
        restarting = true
        return true
    }

    override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) = Unit

    private fun revealVideo() {
        mainHandler.postDelayed(
            {
                if (!isAttachedToWindow || !prepared) return@postDelayed
                posterView.animate()
                    .cancel()
                posterView.animate()
                    .alpha(0f)
                    .setDuration(POSTER_FADE_MS)
                    .withEndAction {
                        restarting = false
                        scheduleMonitor()
                    }
                    .start()
            },
            DECODER_SETTLE_MS,
        )
    }

    private fun beginMaskedRestart() {
        if (restarting) return
        restarting = true
        stopMonitor()
        posterView.animate().cancel()
        posterView.animate()
            .alpha(1f)
            .setDuration(POSTER_FADE_MS)
            .withEndAction {
                if (!isAttachedToWindow) return@withEndAction
                releasePlayer()
                openPlayer()
            }
            .start()
    }

    private fun retryMasked() {
        restarting = true
        stopMonitor()
        posterView.animate().cancel()
        posterView.alpha = 1f
        releasePlayer()
        mainHandler.postDelayed(
            {
                if (isAttachedToWindow && windowVisibility == View.VISIBLE) {
                    openPlayer()
                }
            },
            ERROR_RETRY_MS,
        )
    }

    private fun openPlayer() {
        val currentSurface = surface ?: return
        if (player != null || !isAttachedToWindow) return
        try {
            player = MediaPlayer().also { mediaPlayer ->
                context.assets.openFd("videos/menu-background.mp4").use { descriptor ->
                    mediaPlayer.setDataSource(
                        descriptor.fileDescriptor,
                        descriptor.startOffset,
                        descriptor.length,
                    )
                }
                mediaPlayer.setSurface(currentSurface)
                mediaPlayer.isLooping = false
                mediaPlayer.setVolume(0f, 0f)
                mediaPlayer.setOnPreparedListener {
                    if (player !== it) return@setOnPreparedListener
                    prepared = true
                    videoWidth = it.videoWidth
                    videoHeight = it.videoHeight
                    applyCenterCrop()
                    if (windowVisibility == View.VISIBLE && isAttachedToWindow) {
                        it.start()
                    }
                }
                mediaPlayer.setOnVideoSizeChangedListener { _, width, height ->
                    videoWidth = width
                    videoHeight = height
                    applyCenterCrop()
                }
                mediaPlayer.setOnInfoListener { _, what, _ ->
                    if (what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) {
                        revealVideo()
                    }
                    false
                }
                mediaPlayer.setOnCompletionListener {
                    beginMaskedRestart()
                }
                mediaPlayer.setOnErrorListener { _, _, _ ->
                    retryMasked()
                    true
                }
                mediaPlayer.prepareAsync()
            }
        } catch (_: Exception) {
            retryMasked()
        }
    }

    private fun applyCenterCrop() {
        val viewWidth = videoView.width.toFloat()
        val viewHeight = videoView.height.toFloat()
        if (
            viewWidth <= 0f ||
            viewHeight <= 0f ||
            videoWidth <= 0 ||
            videoHeight <= 0
        ) {
            return
        }
        val videoAspect = videoWidth.toFloat() / videoHeight.toFloat()
        val viewAspect = viewWidth / viewHeight
        val scaleX = if (videoAspect > viewAspect) videoAspect / viewAspect else 1f
        val scaleY = if (videoAspect < viewAspect) viewAspect / videoAspect else 1f
        videoView.setTransform(
            Matrix().apply {
                setScale(scaleX, scaleY, viewWidth / 2f, viewHeight / 2f)
            },
        )
    }

    private fun scheduleMonitor() {
        if (monitorScheduled) return
        monitorScheduled = true
        mainHandler.postDelayed(loopMonitor, LOOP_POLL_MS)
    }

    private fun stopMonitor() {
        mainHandler.removeCallbacks(loopMonitor)
        monitorScheduled = false
    }

    private fun releasePlayer() {
        prepared = false
        videoWidth = 0
        videoHeight = 0
        player?.setOnPreparedListener(null)
        player?.setOnVideoSizeChangedListener(null)
        player?.setOnInfoListener(null)
        player?.setOnCompletionListener(null)
        player?.setOnErrorListener(null)
        player?.release()
        player = null
    }

    private companion object {
        const val MASKED_RESTART_MS = 12_000
        const val LOOP_POLL_MS = 100L
        const val POSTER_FADE_MS = 220L
        const val DECODER_SETTLE_MS = 180L
        const val ERROR_RETRY_MS = 500L
    }
}
