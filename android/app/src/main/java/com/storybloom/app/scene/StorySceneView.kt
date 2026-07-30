package com.storybloom.app.scene

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.opengl.GLES30
import android.opengl.GLUtils
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.ViewConfiguration
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.ShortBuffer
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Native OpenGL scene. Camera orbit is deliberately owned by the view and
 * scene/model animation by the renderer:
 *
 *  - cameraYaw/cameraPitch/cameraDistance: changed only by touch
 *  - sceneRotation: scripted world transform
 *  - kolobokRotation: character's rolling transform
 *
 * Those values never alias, so starting a scene animation cannot consume or
 * reset a one-finger camera gesture.
 */
class StorySceneView(context: Context) : GLSurfaceView(context) {
    private val storyRenderer = StorySceneRenderer()
    var onCrossroadsAction: ((CrossroadsAction) -> Unit)? = null
    var onSceneInteraction: ((SceneInteraction) -> Unit)? = null
    private var orbitPointerId = MotionEvent.INVALID_POINTER_ID
    private var lastOrbitX = 0f
    private var lastOrbitY = 0f
    private var downX = 0f
    private var downY = 0f
    private var pinchDistance = 0f
    private var moved = false
    private var velocityTracker: VelocityTracker? = null
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()

    init {
        setEGLContextClientVersion(3)
        setEGLConfigChooser(StoryEglConfigChooser())
        preserveEGLContextOnPause = true
        setRenderer(storyRenderer)
        renderMode = RENDERMODE_CONTINUOUSLY
        isClickable = true
        contentDescription = "Interactive three-dimensional Kolobok story scene"
    }

    override fun onPause() {
        queueEvent(storyRenderer::pauseClock)
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        queueEvent(storyRenderer::resumeClock)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                storyRenderer.flingOrbit(0f, 0f)
                velocityTracker?.recycle()
                velocityTracker = VelocityTracker.obtain().also { it.addMovement(event) }
                orbitPointerId = event.getPointerId(0)
                lastOrbitX = event.x
                lastOrbitY = event.y
                downX = event.x
                downY = event.y
                pinchDistance = 0f
                moved = false
                val pressX = event.x
                val pressY = event.y
                val pressWidth = width
                val pressHeight = height
                queueEvent {
                    storyRenderer.beginTreeBonkAt(
                        pressX,
                        pressY,
                        pressWidth,
                        pressHeight,
                    )
                }
                return true
            }

            MotionEvent.ACTION_POINTER_DOWN -> {
                velocityTracker?.addMovement(event)
                if (event.pointerCount >= 2) pinchDistance = pointerDistance(event)
                moved = true
                queueEvent(storyRenderer::releaseTreeBonk)
                // Do not replace orbitPointerId: the first finger continues to
                // orbit normally while a second finger optionally zooms.
                return true
            }

            MotionEvent.ACTION_MOVE -> {
                velocityTracker?.addMovement(event)
                val index = event.findPointerIndex(orbitPointerId)
                if (index >= 0) {
                    val x = event.getX(index)
                    val y = event.getY(index)
                    val dx = x - lastOrbitX
                    val dy = y - lastOrbitY
                    val totalX = x - downX
                    val totalY = y - downY
                    val crossedSlop = sqrt(totalX * totalX + totalY * totalY) > touchSlop
                    if (!moved && crossedSlop) {
                        moved = true
                        queueEvent(storyRenderer::releaseTreeBonk)
                        // Apply the complete buffered drag once so slow,
                        // deliberate motion remains responsive after slop.
                        storyRenderer.orbitBy(
                            yawDegrees = -totalX * 0.28f,
                            pitchDegrees = totalY * 0.22f,
                        )
                    } else if (moved && (dx != 0f || dy != 0f)) {
                        storyRenderer.orbitBy(
                            yawDegrees = -dx * 0.28f,
                            pitchDegrees = dy * 0.22f,
                        )
                    }
                    lastOrbitX = x
                    lastOrbitY = y
                }
                if (event.pointerCount >= 2) {
                    val distance = pointerDistance(event)
                    if (pinchDistance > 0f && distance > 0f) {
                        storyRenderer.zoomBy(pinchDistance / distance)
                    }
                    pinchDistance = distance
                }
                return true
            }

            MotionEvent.ACTION_POINTER_UP -> {
                velocityTracker?.addMovement(event)
                val liftedId = event.getPointerId(event.actionIndex)
                if (liftedId == orbitPointerId) {
                    val replacementIndex = (0 until event.pointerCount)
                        .firstOrNull { it != event.actionIndex }
                    if (replacementIndex != null) {
                        orbitPointerId = event.getPointerId(replacementIndex)
                        lastOrbitX = event.getX(replacementIndex)
                        lastOrbitY = event.getY(replacementIndex)
                    } else {
                        orbitPointerId = MotionEvent.INVALID_POINTER_ID
                    }
                }
                pinchDistance = 0f
                return true
            }

            MotionEvent.ACTION_UP -> {
                velocityTracker?.addMovement(event)
                velocityTracker?.computeCurrentVelocity(1_000)
                if (moved) {
                    storyRenderer.flingOrbit(
                        yawDegreesPerSecond = -(velocityTracker?.xVelocity ?: 0f) * .018f,
                        pitchDegreesPerSecond = (velocityTracker?.yVelocity ?: 0f) * .012f,
                    )
                }
                if (!moved) {
                    super.performClick()
                    performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    val tapX = event.x
                    val tapY = event.y
                    val tapWidth = width
                    val tapHeight = height
                    queueEvent {
                        storyRenderer.releaseTreeBonk()
                        storyRenderer.tapAt(tapX, tapY, tapWidth, tapHeight)?.let { result ->
                            post {
                                result.crossroadsAction?.let { onCrossroadsAction?.invoke(it) }
                                result.interaction?.let { onSceneInteraction?.invoke(it) }
                            }
                        }
                    }
                } else {
                    queueEvent(storyRenderer::releaseTreeBonk)
                }
                velocityTracker?.recycle()
                velocityTracker = null
                orbitPointerId = MotionEvent.INVALID_POINTER_ID
                pinchDistance = 0f
                parent?.requestDisallowInterceptTouchEvent(false)
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                queueEvent(storyRenderer::releaseTreeBonk)
                velocityTracker?.recycle()
                velocityTracker = null
                orbitPointerId = MotionEvent.INVALID_POINTER_ID
                pinchDistance = 0f
                parent?.requestDisallowInterceptTouchEvent(false)
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        super.onSizeChanged(width, height, oldWidth, oldHeight)
        if (width > 0 && height > 0) {
            holder.setFixedSize(
                (width * RENDER_SCALE).roundToInt().coerceAtLeast(1),
                (height * RENDER_SCALE).roundToInt().coerceAtLeast(1),
            )
        }
    }

    override fun performClick(): Boolean {
        return super.performClick()
    }

    fun setStoryPlaying(playing: Boolean) = storyRenderer.setStoryPlaying(playing)

    fun setSceneRotationEnabled(enabled: Boolean) =
        storyRenderer.setSceneRotationEnabled(enabled)

    fun setFollowKolobok(enabled: Boolean) = storyRenderer.setFollowKolobok(enabled)

    fun resetCamera() = storyRenderer.resetCamera()

    fun setWeather(weather: SceneWeather) = storyRenderer.setWeather(weather)

    fun setRockMenuLanguage(russian: Boolean) = storyRenderer.setRockMenuLanguage(russian)

    fun storyTimeSeconds(): Int = storyRenderer.transformSnapshot().storyTime.toInt()

    internal fun transformSnapshotForTest(): SceneFrame = storyRenderer.transformSnapshot()

    private fun pointerDistance(event: MotionEvent): Float {
        if (event.pointerCount < 2) return 0f
        val dx = event.getX(0) - event.getX(1)
        val dy = event.getY(0) - event.getY(1)
        return sqrt(dx * dx + dy * dy)
    }

    private companion object {
        const val RENDER_SCALE = .88f
    }
}

private class StoryEglConfigChooser : GLSurfaceView.EGLConfigChooser {
    override fun chooseConfig(
        egl: javax.microedition.khronos.egl.EGL10,
        display: javax.microedition.khronos.egl.EGLDisplay,
    ): javax.microedition.khronos.egl.EGLConfig {
        val withMsaa = intArrayOf(
            javax.microedition.khronos.egl.EGL10.EGL_RED_SIZE, 8,
            javax.microedition.khronos.egl.EGL10.EGL_GREEN_SIZE, 8,
            javax.microedition.khronos.egl.EGL10.EGL_BLUE_SIZE, 8,
            javax.microedition.khronos.egl.EGL10.EGL_ALPHA_SIZE, 8,
            javax.microedition.khronos.egl.EGL10.EGL_DEPTH_SIZE, 24,
            // EGL_OPENGL_ES3_BIT_KHR is not exposed by the legacy EGL10 API.
            javax.microedition.khronos.egl.EGL10.EGL_RENDERABLE_TYPE, 0x40,
            javax.microedition.khronos.egl.EGL10.EGL_SAMPLE_BUFFERS, 1,
            javax.microedition.khronos.egl.EGL10.EGL_SAMPLES, 2,
            javax.microedition.khronos.egl.EGL10.EGL_NONE,
        )
        val fallback = intArrayOf(
            javax.microedition.khronos.egl.EGL10.EGL_RED_SIZE, 8,
            javax.microedition.khronos.egl.EGL10.EGL_GREEN_SIZE, 8,
            javax.microedition.khronos.egl.EGL10.EGL_BLUE_SIZE, 8,
            javax.microedition.khronos.egl.EGL10.EGL_ALPHA_SIZE, 8,
            javax.microedition.khronos.egl.EGL10.EGL_DEPTH_SIZE, 24,
            javax.microedition.khronos.egl.EGL10.EGL_RENDERABLE_TYPE, 0x40,
            javax.microedition.khronos.egl.EGL10.EGL_NONE,
        )

        fun first(attributes: IntArray): javax.microedition.khronos.egl.EGLConfig? {
            val count = IntArray(1)
            if (!egl.eglChooseConfig(display, attributes, null, 0, count) || count[0] <= 0) {
                return null
            }
            val configs = arrayOfNulls<javax.microedition.khronos.egl.EGLConfig>(count[0])
            egl.eglChooseConfig(display, attributes, configs, configs.size, count)
            return configs.firstOrNull()
        }

        // High-density phones already provide enough edge resolution for the
        // low-poly style. Prefer the single-sample config so the full-screen
        // scene holds its frame rate; retain MSAA as a compatibility fallback.
        return first(fallback) ?: first(withMsaa)
        ?: error("No suitable OpenGL ES configuration")
    }
}

enum class SceneWeather {
    CLEAR,
    RAIN,
    SNOW,
}

enum class CrossroadsAction {
    ADD_BOOK,
    CREATE_STORY,
    LIBRARY,
}

enum class SceneInteraction {
    GRANDPA_FISHING,
    CHIMNEY_SMOKE,
    IZBA_WINDOW,
    WILLOW_RUSTLE,
    MAGPIES,
    FROG_SPLASH,
    STONE_BIRDS,
    CLOUD_RAIN,
    HEDGEHOG,
    OWL_WAKE,
    OWL_FLAP,
    HARE,
    WOLF,
    BEAR,
    FOX,
    FOX_TRUE_ENDING,
    KOLOBOK,
    MOON_WINK,
    TREE_RUSTLE,
    MEADOW_BLOOM,
    PATH_SPARKLE,
    SUN_GLOW,
    BUTTERFLY_DANCE,
    HIVE_BUZZ,
}

private data class SceneTapResult(
    val crossroadsAction: CrossroadsAction? = null,
    val interaction: SceneInteraction? = null,
)

private class StorySceneRenderer : GLSurfaceView.Renderer {
    private val transforms = SceneTransformState()
    private var frame = SceneFrame()
    @Volatile
    private var weather = SceneWeather.CLEAR
    private var lastFrameMs = 0L
    private var pausedAtMs = 0L
    @Volatile
    private var yawVelocity = 0f
    @Volatile
    private var pitchVelocity = 0f
    @Volatile
    private var greetingUntilMs = 0L

    private var program = 0
    private var mvpLocation = 0
    private var modelLocation = 0
    private var colorLocation = 0
    private var lightLocation = 0
    private var normalLocation = 0
    private var cameraLocation = 0
    private var fogColorLocation = 0
    private var rimLocation = 0
    private var instancedProgram = 0
    private var instancedProjectionViewLocation = 0
    private var instancedColorLocation = 0
    private var instancedLightLocation = 0
    private var instancedCameraLocation = 0
    private var instancedFogColorLocation = 0
    private var instancedRimLocation = 0
    private var textProgram = 0
    private var textMvpLocation = 0
    private var textTextureLocation = 0
    private var textMesh: TextGlMesh? = null
    private var englishRockLabels = IntArray(0)
    private var russianRockLabels = IntArray(0)
    @Volatile
    private var russianRockMenu = false
    private var sphere: GlMesh? = null
    private var lowSphere: GlMesh? = null
    private var cube: GlMesh? = null
    private var triangularPrism: GlMesh? = null
    private var cylinder: GlMesh? = null
    private var cone: GlMesh? = null
    private var disc: GlMesh? = null
    private var ring: GlMesh? = null

    private val projection = FloatArray(16)
    private val view = FloatArray(16)
    private val model = FloatArray(16)
    private val viewModel = FloatArray(16)
    private val mvp = FloatArray(16)
    private val projectionView = FloatArray(16)
    private val temp = FloatArray(16)
    private val normalModel = FloatArray(16)
    private val normalMatrix = FloatArray(9)
    private val colorCache = mutableMapOf<String, Array<FloatArray?>>()
    private val instanceBuffers = mutableMapOf<Int, Int>()
    private var instanceUploadBuffer: FloatBuffer? = null
    private val dynamicInstanceGroups =
        linkedMapOf<DynamicInstanceStyle, MutableList<Transform>>()
    private var eyeX = 0f
    private var eyeY = 0f
    private var eyeZ = 0f
    private var cameraTargetX = 0f
    private var cameraTargetY = 1.1f
    private var cameraTargetZ = 0f
    private var viewportWidth = 1
    private var viewportHeight = 1

    private var backgroundBatches = emptyList<StaticBatch>()
    private var vegetationBatches = emptyList<StaticBatch>()

    private var fishingStartedMs = 0L
    private var fishingCatchCount = 0
    private var fishingKind = FishingKind.SILVER
    private var accumulatedBoots = 0
    private var owlStartedMs = 0L
    private var owlFlapStartedMs = 0L
    private var owlTapCount = 0
    private var owlLastTapMs = 0L
    private var owlTapTreeIndex = -1
    private var owlActiveTreeIndex = 2
    private val owlCooldownUntilMs = mutableMapOf<Int, Long>()
    private var smokeRingsStartedMs = 0L
    private var izbaFlashStartedMs = 0L
    private var stoneBirdsStartedMs = 0L
    private var willowSwayStartedMs = 0L
    private var willowTapCount = 0
    private var willowLastTapMs = 0L
    private var magpiesStartedMs = 0L
    private var frogJumpStartedMs = 0L
    private var drizzleStartedMs = 0L
    private var drizzleCloud = -1
    private var moonWinkStartedMs = 0L
    private var animalReaction = AnimalReaction.NONE
    private var animalReactionStartedMs = 0L
    private var ambientReaction = AmbientReaction.NONE
    private var ambientReactionStartedMs = 0L
    private var ambientReactionPoint = WorldPoint3(0f, .12f, 0f)
    private var sunGlowStartedMs = 0L
    private var foxTapCount = 0
    private var foxLastTapMs = 0L
    private var foxEndingStartedMs = 0L

    private val mushroomSpots = listOf(
        PolarPoint(184f, 6.78f),
        PolarPoint(202f, 7.12f),
        PolarPoint(226f, 6.72f),
        PolarPoint(249f, 7.18f),
        PolarPoint(278f, 6.94f),
        PolarPoint(315f, 7.05f),
        PolarPoint(103f, 6.86f),
        PolarPoint(133f, 7.18f),
        PolarPoint(33f, 6.92f),
        PolarPoint(346f, 5.85f),
        PolarPoint(172f, 5.70f),
        PolarPoint(258f, 5.82f),
        PolarPoint(54f, 5.63f),
        PolarPoint(116f, 5.54f),
        PolarPoint(194f, 5.34f),
        PolarPoint(238f, 3.68f),
        PolarPoint(304f, 3.46f),
    )
    private val owlTree = PolarPoint(164f, 7.08f)
    private val sprucePoints = listOf(
        PolarPoint(104f, 7.18f),
        PolarPoint(122f, 6.90f),
        owlTree,
        PolarPoint(182f, 7.22f),
        PolarPoint(199f, 6.82f),
        PolarPoint(239f, 6.86f),
        PolarPoint(258f, 7.27f),
        PolarPoint(326f, 7.20f),
        PolarPoint(340f, 6.83f),
        PolarPoint(20f, 7.30f),
        PolarPoint(94f, 7.33f),
        PolarPoint(172f, 5.32f),
        PolarPoint(306f, 5.35f),
        PolarPoint(45f, 5.46f),
        PolarPoint(115f, 6.12f),
        PolarPoint(185f, 6.22f),
        PolarPoint(252f, 6.08f),
    )
    private val birchPoints = listOf(
        PolarPoint(28f, 6.86f),
        PolarPoint(52f, 7.31f),
        PolarPoint(92f, 6.82f),
        PolarPoint(112f, 7.36f),
        PolarPoint(264f, 7.21f),
        PolarPoint(309f, 6.78f),
        PolarPoint(321f, 7.42f),
        PolarPoint(338f, 6.98f),
        PolarPoint(18f, 5.42f),
        PolarPoint(116f, 5.55f),
        PolarPoint(252f, 5.48f),
        PolarPoint(332f, 5.58f),
    )
    private val treeBonkStates = MutableList(sprucePoints.size + birchPoints.size) {
        TreeBonkState()
    }
    private val treeBonkPoses = MutableList(sprucePoints.size + birchPoints.size) {
        TreeBonkPose(0f, 0f, 0f, 1f, 0f, active = false)
    }
    private var grabbedTreeIndex = -1
    private val leafBursts = mutableListOf<LeafBurst>()
    private val hedgehogJourneys = mutableListOf<HedgehogJourney>()
    private val mushroomTakenAtMs = LongArray(mushroomSpots.size)
    private val mushroomReserved = BooleanArray(mushroomSpots.size)
    private val moonPosition = WorldPoint3(7.2f, 3.35f, -11.5f)

    private val rain = List(72) { index ->
        Particle(
            x = pseudo(index * 13 + 7) * 10f - 5f,
            y = pseudo(index * 29 + 3) * 5f + 1f,
            z = pseudo(index * 47 + 11) * 10f - 5f,
            phase = pseudo(index * 61 + 5) * 7f,
        )
    }

    fun orbitBy(yawDegrees: Float, pitchDegrees: Float) {
        transforms.orbitBy(yawDegrees, pitchDegrees)
    }

    fun zoomBy(scale: Float) {
        transforms.zoomBy(scale)
    }

    fun resetCamera() {
        transforms.resetCamera()
        yawVelocity = 0f
        pitchVelocity = 0f
    }

    fun flingOrbit(yawDegreesPerSecond: Float, pitchDegreesPerSecond: Float) {
        yawVelocity = yawDegreesPerSecond.coerceIn(-120f, 120f)
        pitchVelocity = pitchDegreesPerSecond.coerceIn(-65f, 65f)
    }

    fun greet() {
        greetingUntilMs = SystemClock.uptimeMillis() + 850L
    }

    fun setStoryPlaying(playing: Boolean) {
        transforms.setStoryPlaying(playing)
    }

    fun setSceneRotationEnabled(enabled: Boolean) {
        transforms.setSceneRotationEnabled(enabled)
    }

    fun setFollowKolobok(enabled: Boolean) {
        transforms.setFollowKolobok(enabled)
    }

    fun setWeather(next: SceneWeather) {
        weather = next
    }

    fun setRockMenuLanguage(russian: Boolean) {
        russianRockMenu = russian
    }

    fun pauseClock() {
        if (pausedAtMs == 0L) pausedAtMs = SystemClock.uptimeMillis()
    }

    fun resumeClock() {
        val now = SystemClock.uptimeMillis()
        if (pausedAtMs > 0L) {
            val pausedDuration = (now - pausedAtMs).coerceAtLeast(0L)
            fun shift(startedAtMs: Long): Long =
                if (startedAtMs > 0L) startedAtMs + pausedDuration else 0L

            fishingStartedMs = shift(fishingStartedMs)
            owlStartedMs = shift(owlStartedMs)
            owlFlapStartedMs = shift(owlFlapStartedMs)
            smokeRingsStartedMs = shift(smokeRingsStartedMs)
            izbaFlashStartedMs = shift(izbaFlashStartedMs)
            stoneBirdsStartedMs = shift(stoneBirdsStartedMs)
            willowSwayStartedMs = shift(willowSwayStartedMs)
            magpiesStartedMs = shift(magpiesStartedMs)
            frogJumpStartedMs = shift(frogJumpStartedMs)
            drizzleStartedMs = shift(drizzleStartedMs)
            moonWinkStartedMs = shift(moonWinkStartedMs)
            animalReactionStartedMs = shift(animalReactionStartedMs)
            ambientReactionStartedMs = shift(ambientReactionStartedMs)
            sunGlowStartedMs = shift(sunGlowStartedMs)
            foxEndingStartedMs = shift(foxEndingStartedMs)
            leafBursts.forEach { it.startedAtMs = shift(it.startedAtMs) }
            hedgehogJourneys.forEach { it.startedAtMs = shift(it.startedAtMs) }
            mushroomTakenAtMs.indices.forEach { index ->
                mushroomTakenAtMs[index] = shift(mushroomTakenAtMs[index])
            }
            if (greetingUntilMs > 0L) greetingUntilMs += pausedDuration
            owlTapCount = 0
            owlLastTapMs = 0L
            owlTapTreeIndex = -1
            willowTapCount = 0
            willowLastTapMs = 0L
            foxTapCount = 0
            foxLastTapMs = 0L
            pausedAtMs = 0L
        }
        lastFrameMs = now
    }

    fun transformSnapshot(): SceneFrame = transforms.snapshot()

    override fun onSurfaceCreated(gl: javax.microedition.khronos.opengles.GL10?, config: javax.microedition.khronos.egl.EGLConfig?) {
        GLES30.glClearColor(0.48f, 0.78f, 0.98f, 1f)
        GLES30.glEnable(GLES30.GL_DEPTH_TEST)
        GLES30.glEnable(GLES30.GL_CULL_FACE)
        GLES30.glCullFace(GLES30.GL_BACK)
        GLES30.glEnable(GLES30.GL_BLEND)
        GLES30.glBlendFunc(GLES30.GL_SRC_ALPHA, GLES30.GL_ONE_MINUS_SRC_ALPHA)

        program = createProgram(VERTEX_SHADER, FRAGMENT_SHADER)
        mvpLocation = GLES30.glGetUniformLocation(program, "uMvp")
        modelLocation = GLES30.glGetUniformLocation(program, "uModel")
        colorLocation = GLES30.glGetUniformLocation(program, "uColor")
        lightLocation = GLES30.glGetUniformLocation(program, "uLight")
        normalLocation = GLES30.glGetUniformLocation(program, "uNormalMatrix")
        cameraLocation = GLES30.glGetUniformLocation(program, "uCamera")
        fogColorLocation = GLES30.glGetUniformLocation(program, "uFogColor")
        rimLocation = GLES30.glGetUniformLocation(program, "uRimStrength")
        instancedProgram = createProgram(INSTANCED_VERTEX_SHADER, FRAGMENT_SHADER)
        instancedProjectionViewLocation =
            GLES30.glGetUniformLocation(instancedProgram, "uProjectionView")
        instancedColorLocation = GLES30.glGetUniformLocation(instancedProgram, "uColor")
        instancedLightLocation = GLES30.glGetUniformLocation(instancedProgram, "uLight")
        instancedCameraLocation = GLES30.glGetUniformLocation(instancedProgram, "uCamera")
        instancedFogColorLocation = GLES30.glGetUniformLocation(instancedProgram, "uFogColor")
        instancedRimLocation = GLES30.glGetUniformLocation(instancedProgram, "uRimStrength")
        textProgram = createProgram(TEXT_VERTEX_SHADER, TEXT_FRAGMENT_SHADER)
        textMvpLocation = GLES30.glGetUniformLocation(textProgram, "uMvp")
        textTextureLocation = GLES30.glGetUniformLocation(textProgram, "uTexture")
        textMesh = createTextMesh()
        englishRockLabels = arrayOf("ADD A BOOK", "CREATE A STORY", "MY LIBRARY")
            .map(::createTextTexture)
            .toIntArray()
        russianRockLabels = arrayOf("НОВАЯ КНИГА", "СВОЯ ИСТОРИЯ", "БИБЛИОТЕКА")
            .map(::createTextTexture)
            .toIntArray()

        val sphereData = Geometry.sphere(18, 12)
        val lowSphereData = Geometry.sphere(10, 7)
        val cubeData = Geometry.cube()
        val cylinderData = Geometry.cylinder(18)
        val coneData = Geometry.cone(18)
        val discData = Geometry.cylinder(48)
        val batchCylinderData = Geometry.cylinder(10)
        val batchConeData = Geometry.cone(10)
        val batchDiscData = Geometry.cylinder(16)
        sphere = createMesh(sphereData)
        lowSphere = createMesh(lowSphereData)
        cube = createMesh(cubeData)
        triangularPrism = createMesh(Geometry.triangularPrism())
        cylinder = createMesh(cylinderData)
        cone = createMesh(coneData)
        disc = createMesh(discData)
        ring = createMesh(Geometry.ring(64, .86f))
        backgroundBatches = createBackgroundBatches(
            lowSphereData = lowSphereData,
            cylinderData = batchCylinderData,
            coneData = batchConeData,
        )
        vegetationBatches = createVegetationBatches(
            lowSphereData = lowSphereData,
            cubeData = cubeData,
            cylinderData = batchCylinderData,
            coneData = batchConeData,
            discData = batchDiscData,
        )
        lastFrameMs = SystemClock.uptimeMillis()
    }

    override fun onSurfaceChanged(gl: javax.microedition.khronos.opengles.GL10?, width: Int, height: Int) {
        viewportWidth = max(1, width)
        viewportHeight = max(1, height)
        GLES30.glViewport(0, 0, width, height)
        Matrix.perspectiveM(
            projection,
            0,
            46f,
            width.toFloat() / max(1, height).toFloat(),
            0.1f,
            80f,
        )
    }

    override fun onDrawFrame(gl: javax.microedition.khronos.opengles.GL10?) {
        val now = SystemClock.uptimeMillis()
        val delta = ((now - lastFrameMs) / 1000f).coerceIn(0f, .25f)
        val flingDelta = min(.05f, delta)
        lastFrameMs = now
        if (abs(yawVelocity) > .05f || abs(pitchVelocity) > .05f) {
            transforms.orbitBy(yawVelocity * flingDelta, pitchVelocity * flingDelta)
            val damping = Math.pow(.055, flingDelta.toDouble()).toFloat()
            yawVelocity *= damping
            pitchVelocity *= damping
        }
        frame = transforms.advance(delta)
        updateTreeBonks(delta)
        updateHedgehogJourneys(now)

        val evening = eveningAmount()
        GLES30.glClearColor(
            .48f * (1f - evening) + .15f * evening,
            .78f * (1f - evening) + .24f * evening,
            .98f * (1f - evening) + .42f * evening,
            1f,
        )
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT or GLES30.GL_DEPTH_BUFFER_BIT)

        val desiredTarget = if (frame.followKolobok) {
            val travel = SceneMotion.travelRadians(frame.storyTime)
            val localX = sin(travel) * SceneMotion.PATH_RADIUS
            val localZ = cos(travel) * SceneMotion.PATH_RADIUS
            val rotation = Math.toRadians(frame.sceneRotation.toDouble())
            val rotationCosine = cos(rotation).toFloat()
            val rotationSine = sin(rotation).toFloat()
            WorldPoint3(
                x = rotationCosine * localX + rotationSine * localZ,
                y = .62f,
                z = -rotationSine * localX + rotationCosine * localZ,
            )
        } else {
            WorldPoint3(0f, 1.1f, 0f)
        }
        val targetBlend = 1f - exp(-delta * 5.5f)
        cameraTargetX += (desiredTarget.x - cameraTargetX) * targetBlend
        cameraTargetY += (desiredTarget.y - cameraTargetY) * targetBlend
        cameraTargetZ += (desiredTarget.z - cameraTargetZ) * targetBlend

        val effectiveYaw = if (frame.followKolobok) {
            val outwardYaw = Math.toDegrees(
                kotlin.math.atan2(
                    desiredTarget.x.toDouble(),
                    desiredTarget.z.toDouble(),
                ),
            ).toFloat()
            outwardYaw + FOLLOW_CAMERA_BIAS_DEGREES + (frame.cameraYaw - 180f)
        } else {
            frame.cameraYaw
        }
        val yaw = Math.toRadians(effectiveYaw.toDouble())
        val pitch = Math.toRadians(frame.cameraPitch.toDouble())
        val houseSide = if (frame.followKolobok) {
            0f
        } else {
            max(0f, cos(yaw).toFloat())
        }
        val occlusionSafeDistance = max(frame.cameraDistance, 17.6f)
        val effectiveDistance = frame.cameraDistance +
            houseSide * houseSide * (occlusionSafeDistance - frame.cameraDistance)
        val horizontal = effectiveDistance * cos(pitch).toFloat()
        eyeX = cameraTargetX + horizontal * sin(yaw).toFloat()
        eyeY = cameraTargetY + .1f + effectiveDistance * sin(pitch).toFloat()
        eyeZ = cameraTargetZ + horizontal * cos(yaw).toFloat()
        Matrix.setLookAtM(
            view,
            0,
            eyeX,
            eyeY,
            eyeZ,
            cameraTargetX,
            cameraTargetY,
            cameraTargetZ,
            0f,
            1f,
            0f,
        )
        Matrix.multiplyMM(projectionView, 0, projection, 0, view, 0)

        GLES30.glUseProgram(program)
        GLES30.glUniform3f(lightLocation, -0.48f, 0.78f, 0.39f)
        GLES30.glUniform3f(cameraLocation, eyeX, eyeY, eyeZ)
        GLES30.glUniform3f(
            fogColorLocation,
            .78f * (1f - evening) + .25f * evening,
            .89f * (1f - evening) + .33f * evening,
            .93f * (1f - evening) + .48f * evening,
        )

        drawWorld()
        drawWeather()
    }

    private fun drawWorld() {
        // Layered island with the original five-zone circular route.
        draw(
            requireNotNull(disc),
            color("#72513A"),
            Transform(0f, -.34f, 0f, 8f, .34f, 8f),
        )
        draw(
            requireNotNull(disc),
            color("#7AA85C"),
            Transform(0f, .015f, 0f, 8f, .035f, 8f),
        )
        drawZoneGroundTints()
        draw(
            requireNotNull(ring),
            color("#D4B377"),
            Transform(0f, .075f, 0f, 4.96f, 1f, 4.96f),
        )

        // Draw distant ground after the island so early depth rejection keeps
        // these very broad layers inexpensive.
        draw(requireNotNull(disc), color("#6A925F"), Transform(0f, -1.28f, 0f, 16f, .05f, 16f), rimStrength = 0f)
        draw(requireNotNull(disc), color("#5F845B"), Transform(0f, -1.39f, 0f, 24f, .06f, 24f), rimStrength = 0f)
        draw(requireNotNull(disc), color("#55745B"), Transform(0f, -1.50f, 0f, 32f, .07f, 32f), rimStrength = 0f)

        drawSkyDetails()
        drawBackgroundForest()
        drawIslandVegetation()
        drawInteractiveTrees()
        drawInteractiveMushrooms()
        drawCrossroadsStone()
        drawIzba()
        drawPondAndGrandpa()
        drawZoneAmbience()
        drawBirchLeafFalls()
        drawAmbientTapReaction()
        drawClouds()
        drawKolobok()
        drawHare()
        drawWolf()
        drawBear()
        drawFox()
    }

    private fun drawBackgroundForest() {
        backgroundBatches.forEach { batch ->
            draw(batch.mesh, batch.color, IDENTITY_TRANSFORM, rimStrength = batch.rimStrength)
        }
    }

    private fun drawIslandVegetation() {
        vegetationBatches.forEach { batch ->
            draw(batch.mesh, batch.color, IDENTITY_TRANSFORM, rimStrength = batch.rimStrength)
        }
    }

    private fun updateTreeBonks(deltaSeconds: Float) {
        val travel = SceneMotion.travelRadians(frame.storyTime)
        val kolobokX = sin(travel) * SceneMotion.PATH_RADIUS
        val kolobokZ = cos(travel) * SceneMotion.PATH_RADIUS
        (sprucePoints + birchPoints).forEachIndexed { index, point ->
            val (treeX, treeZ) = radial(point.angle, point.radius)
            val collisionPose = TreeBonkPhysics.advance(
                state = treeBonkStates[index],
                deltaSeconds = deltaSeconds.coerceAtMost(1f / 30f),
                treeX = treeX,
                treeZ = treeZ,
                kolobokX = kolobokX,
                kolobokZ = kolobokZ,
            )
            treeBonkPoses[index] = if (collisionPose.active) {
                collisionPose
            } else {
                // Heavy trees only take a small, phase-offset wind sway.
                val sway = sin(frame.storyTime * .72f + index * 1.37f) * 2.2f
                TreeBonkPose(
                    pushDistance = 0f,
                    tiltDegrees = sway,
                    directionX = .72f,
                    directionZ = .69f,
                    intensity = 0f,
                    active = false,
                )
            }
        }
    }

    private fun drawInteractiveTrees() {
        dynamicInstanceGroups.clear()
        sprucePoints.forEachIndexed { index, point ->
            val (x, z) = radial(point.angle, point.radius)
            val pose = treeBonkPoses[index]
            val size = .72f + pseudo(index * 37 + 8) * .28f
            val darker = point.angle in 116f..270f
            val treeSeed = (point.angle * 37f + point.radius * 19f).toInt()
            val yaw = pseudo(treeSeed) * 360f
            val leanX = (pseudo(treeSeed + 17) - .5f) * .11f * size
            val leanZ = (pseudo(treeSeed + 29) - .5f) * .11f * size
            val lowerWidth = .58f + pseudo(treeSeed + 31) * .16f
            val middleWidth = .46f + pseudo(treeSeed + 37) * .14f
            val upperWidth = .32f + pseudo(treeSeed + 41) * .12f
            drawTreeShadow(x, z, size)
            drawBonkedTreePart(
                requireNotNull(cylinder),
                "#6B4C33",
                x,
                z,
                0f,
                .46f * size,
                0f,
                .095f * size,
                .45f * size,
                .095f * size,
                yaw,
                pose,
                .08f,
            )
            val lower = if (darker) "#376A3D" else "#4B8A49"
            val upper = if (darker) "#427947" else "#5A9A51"
            drawBonkedTreePart(
                requireNotNull(cone),
                lower,
                x,
                z,
                0f,
                (.90f + pseudo(treeSeed + 43) * .09f) * size,
                0f,
                lowerWidth * size,
                (.62f + pseudo(treeSeed + 47) * .16f) * size,
                lowerWidth * size * (.90f + pseudo(treeSeed + 53) * .18f),
                yaw,
                pose,
                .12f,
            )
            drawBonkedTreePart(
                requireNotNull(cone),
                lower,
                x,
                z,
                leanX * .48f,
                (1.43f + pseudo(treeSeed + 59) * .11f) * size,
                leanZ * .48f,
                middleWidth * size,
                (.54f + pseudo(treeSeed + 61) * .15f) * size,
                middleWidth * size * (.88f + pseudo(treeSeed + 67) * .20f),
                yaw + 10f + pseudo(treeSeed + 71) * 25f,
                pose,
                .12f,
            )
            drawBonkedTreePart(
                requireNotNull(cone),
                upper,
                x,
                z,
                leanX,
                (1.88f + pseudo(treeSeed + 73) * .13f) * size,
                leanZ,
                upperWidth * size,
                (.42f + pseudo(treeSeed + 79) * .14f) * size,
                upperWidth * size * (.86f + pseudo(treeSeed + 83) * .22f),
                yaw - 18f + pseudo(treeSeed + 89) * 31f,
                pose,
                .12f,
            )
        }

        birchPoints.forEachIndexed { birchIndex, point ->
            val globalIndex = sprucePoints.size + birchIndex
            val (x, z) = radial(point.angle, point.radius)
            val pose = treeBonkPoses[globalIndex]
            val size = .78f + pseudo(birchIndex * 41 + 5) * .23f
            val treeSeed = (point.angle * 43f + point.radius * 23f).toInt()
            val yaw = pseudo(treeSeed) * 360f
            val yawRadians = Math.toRadians(yaw.toDouble())
            val offsetX = cos(yawRadians).toFloat()
            val offsetZ = sin(yawRadians).toFloat()
            drawTreeShadow(x, z, size)
            drawBonkedTreePart(
                requireNotNull(cylinder),
                "#ECE8DE",
                x,
                z,
                0f,
                .80f * size,
                0f,
                .075f * size,
                .78f * size,
                .075f * size,
                yaw,
                pose,
                .10f,
            )
            val stripeCount = 3 + (kotlin.math.abs(treeSeed) % 3)
            repeat(stripeCount) { stripe ->
                val stripeY = (.31f + stripe * (1.08f / stripeCount)) * size
                val stripeX = if (stripe % 2 == 0) {
                    (.022f + pseudo(treeSeed + stripe * 11) * .014f) * size
                } else {
                    -(.016f + pseudo(treeSeed + stripe * 13) * .012f) * size
                }
                drawBonkedTreePart(
                    requireNotNull(lowSphere),
                    "#4C463D",
                    x,
                    z,
                    stripeX,
                    stripeY,
                    0f,
                    (.070f + pseudo(treeSeed + stripe * 17) * .016f) * size,
                    (.018f + pseudo(treeSeed + stripe * 19) * .013f) * size,
                    (.072f + pseudo(treeSeed + stripe * 23) * .018f) * size,
                    yaw + stripe * (21f + pseudo(treeSeed + 97) * 15f),
                    pose,
                    .02f,
                )
            }
            val canopy = if (point.angle < 120f || point.angle > 280f) {
                "#83B763"
            } else {
                "#76A95B"
            }
            drawBonkedTreePart(
                requireNotNull(lowSphere),
                canopy,
                x,
                z,
                0f,
                (1.56f + pseudo(treeSeed + 101) * .12f) * size,
                0f,
                (.40f + pseudo(treeSeed + 103) * .13f) * size,
                (.31f + pseudo(treeSeed + 107) * .12f) * size,
                (.36f + pseudo(treeSeed + 109) * .13f) * size,
                yaw,
                pose,
                .14f,
            )
            val firstOffset = (.19f + pseudo(treeSeed + 113) * .11f) * size
            drawBonkedTreePart(
                requireNotNull(lowSphere),
                canopy,
                x,
                z,
                -offsetX * firstOffset,
                (1.78f + pseudo(treeSeed + 127) * .16f) * size,
                -offsetZ * firstOffset,
                (.28f + pseudo(treeSeed + 131) * .13f) * size,
                (.26f + pseudo(treeSeed + 137) * .11f) * size,
                (.29f + pseudo(treeSeed + 139) * .12f) * size,
                yaw + 71f,
                pose,
                .14f,
            )
            val secondOffset = (.20f + pseudo(treeSeed + 149) * .12f) * size
            drawBonkedTreePart(
                requireNotNull(lowSphere),
                canopy,
                x,
                z,
                offsetX * secondOffset,
                (1.74f + pseudo(treeSeed + 151) * .17f) * size,
                offsetZ * secondOffset,
                (.30f + pseudo(treeSeed + 157) * .14f) * size,
                (.27f + pseudo(treeSeed + 163) * .12f) * size,
                (.28f + pseudo(treeSeed + 167) * .13f) * size,
                yaw - 53f,
                pose,
                .14f,
            )
        }
        flushDynamicInstances()
    }

    private fun drawTreeShadow(x: Float, z: Float, size: Float) {
        queueDynamicInstance(
            requireNotNull(disc),
            "#29462A",
            .20f,
            Transform(x, .068f, z, .63f * size, .010f, .43f * size),
            0f,
        )
    }

    private fun drawBonkedTreePart(
        mesh: GlMesh,
        hex: String,
        baseX: Float,
        baseZ: Float,
        localX: Float,
        localY: Float,
        localZ: Float,
        scaleX: Float,
        scaleY: Float,
        scaleZ: Float,
        rotationY: Float,
        pose: TreeBonkPose,
        rimStrength: Float,
    ) {
        val intensity = pose.intensity.coerceIn(0f, 1.15f)
        val stretchY = 1f + intensity * TreeBonkPhysics.STRETCH_Y
        val stretchXZ = 1f - intensity * TreeBonkPhysics.STRETCH_XZ
        val tiltRadians = Math.toRadians(pose.tiltDegrees.toDouble())
        val stretchedHeight = localY * stretchY
        val hingeOffset = sin(tiltRadians).toFloat() * stretchedHeight
        queueDynamicInstance(
            mesh,
            hex,
            1f,
            Transform(
                x = baseX + localX + pose.directionX * (pose.pushDistance + hingeOffset),
                y = cos(tiltRadians).toFloat() * stretchedHeight,
                z = baseZ + localZ + pose.directionZ * (pose.pushDistance + hingeOffset),
                scaleX = scaleX * stretchXZ,
                scaleY = scaleY * stretchY,
                scaleZ = scaleZ * stretchXZ,
                rotationX = pose.tiltDegrees * pose.directionZ,
                rotationY = rotationY,
                rotationZ = -pose.tiltDegrees * pose.directionX,
            ),
            rimStrength,
        )
    }

    private fun drawInteractiveMushrooms() {
        dynamicInstanceGroups.clear()
        val now = SystemClock.uptimeMillis()
        mushroomSpots.forEachIndexed { index, point ->
            val popScale = mushroomScale(index, now)
            if (popScale <= .01f) return@forEachIndexed
            val (x, z) = radial(point.angle, point.radius)
            val size = .88f + pseudo(index * 31 + 6) * .30f
            val yaw = pseudo(index * 61 + 14) * 360f
            val lean = (pseudo(index * 71 + 8) - .5f) * 12f
            val capWidth = (.098f + pseudo(index * 73 + 11) * .038f) * size
            val capDepth = (.088f + pseudo(index * 79 + 5) * .043f) * size
            val capHeight = (.050f + pseudo(index * 83 + 17) * .027f) * size
            queueDynamicInstance(
                requireNotNull(disc),
                "#29462A",
                .18f * popScale,
                Transform(
                    x,
                    .066f,
                    z,
                    .15f * size * popScale,
                    .008f,
                    .11f * size * popScale,
                    rotationY = yaw,
                ),
                0f,
            )
            queueDynamicInstance(
                requireNotNull(cylinder),
                "#F2EDE3",
                1f,
                Transform(
                    x,
                    .14f * size * popScale,
                    z,
                    .040f * size * popScale,
                    .11f * size * popScale,
                    .040f * size * popScale,
                    rotationY = yaw,
                    rotationZ = lean,
                ),
                .06f,
            )
            queueDynamicInstance(
                requireNotNull(lowSphere),
                if (index % 4 == 0) "#D85D48" else "#C94E3E",
                1f,
                Transform(
                    x,
                    (.27f * size + capHeight * .10f) * popScale,
                    z,
                    capWidth * popScale,
                    capHeight * popScale,
                    capDepth * popScale,
                    rotationY = yaw,
                    rotationZ = lean * .35f,
                ),
                .12f,
            )
            val spotCount = 1 + index % 3
            repeat(spotCount) { spot ->
                val spotAngle = yaw + spot * (360f / spotCount) +
                    (pseudo(index * 89 + spot * 17) - .5f) * 42f
                val spotRadians = Math.toRadians(spotAngle.toDouble())
                val spotRadius = capWidth * (.22f + pseudo(index * 97 + spot * 19) * .23f)
                val spotSize = (.012f + pseudo(index * 101 + spot * 23) * .010f) *
                    size * popScale
                queueDynamicInstance(
                    requireNotNull(lowSphere),
                    "#FFF8E9",
                    1f,
                    Transform(
                        x + cos(spotRadians).toFloat() * spotRadius * popScale,
                        (.30f * size + capHeight * .42f) * popScale,
                        z + sin(spotRadians).toFloat() * spotRadius * .55f * popScale,
                        spotSize,
                        spotSize * .58f,
                        spotSize,
                    ),
                    .04f,
                )
            }
        }
        flushDynamicInstances()
    }

    private fun mushroomScale(index: Int, now: Long): Float {
        val takenAt = mushroomTakenAtMs[index]
        if (takenAt <= 0L) return 1f
        val elapsed = (now - takenAt).coerceAtLeast(0L)
        return when {
            elapsed < 300L -> 1f - smoothStep(elapsed / 300f)
            elapsed < 10_000L -> 0f
            elapsed < 10_300L -> smoothStep((elapsed - 10_000L) / 300f)
            else -> {
                mushroomTakenAtMs[index] = 0L
                mushroomReserved[index] = false
                1f
            }
        }
    }

    private fun drawBirchLeafFalls() {
        val now = SystemClock.uptimeMillis()
        leafBursts.removeAll { now - it.startedAtMs > 5_200L }
        leafBursts.forEach { burst ->
            val elapsed = (now - burst.startedAtMs).coerceAtLeast(0L) / 1_000f
            repeat(42) { index ->
                val duration = 3f + pseudo(burst.seed + index * 47 + 3) * 2f
                val progress = (elapsed / duration).coerceIn(0f, 1f)
                if (progress >= 1f) return@repeat
                val angle = pseudo(burst.seed + index * 53 + 7) * 360f
                val radians = Math.toRadians(angle.toDouble())
                val radius = pseudo(burst.seed + index * 59 + 11) * .35f
                val driftX = (pseudo(burst.seed + index * 61 + 13) - .5f) * .50f
                val driftZ = (pseudo(burst.seed + index * 67 + 17) - .5f) * .50f
                val phase = pseudo(burst.seed + index * 71 + 19) * PI.toFloat() * 2f
                val wobble = sin(progress * PI.toFloat() * 3f + phase) * .015f
                draw(
                    requireNotNull(lowSphere),
                    color("#2E4A1E", .92f * (1f - progress * .45f)),
                    Transform(
                        x = burst.x + cos(radians).toFloat() * radius + driftX * progress + wobble,
                        y = (burst.y + (pseudo(burst.seed + index * 73 + 23) - .5f) * .30f) *
                            (1f - progress),
                        z = burst.z + sin(radians).toFloat() * radius + driftZ * progress - wobble,
                        scaleX = .030f,
                        scaleY = .010f,
                        scaleZ = .052f,
                        rotationY = angle + progress * 520f,
                        rotationZ = progress * 740f + index * 19f,
                    ),
                    rimStrength = .03f,
                )
            }
        }
    }

    private fun drawZoneGroundTints() {
        val patches = listOf(
            Triple(0f, 2.55f, "#9AB76B"),
            Triple(72f, 2.50f, "#9DC873"),
            Triple(144f, 2.45f, "#688B58"),
            Triple(216f, 2.55f, "#5F8150"),
            Triple(288f, 2.48f, "#A5AF67"),
        )
        patches.forEach { (angle, radius, tint) ->
            val (x, z) = radial(angle, 5.72f)
            draw(
                requireNotNull(disc),
                color(tint, .34f),
                Transform(x, .058f, z, radius, .010f, radius * .76f, rotationY = -angle),
                rimStrength = 0f,
            )
        }
    }

    private fun drawSkyDetails() {
        val evening = eveningAmount()
        val sunElapsed = eventSeconds(sunGlowStartedMs)
        val sunReaction = if (sunElapsed in 0f..1.8f) {
            sin((sunElapsed / 1.8f) * PI.toFloat()).coerceAtLeast(0f)
        } else {
            0f
        }
        val sunPulse = .96f + sin(frame.storyTime * .25f) * .025f + sunReaction * .16f
        draw(
            requireNotNull(lowSphere),
            color("#FFF0A8", 1f - evening * .86f),
            Transform(-7.8f, 8.7f, -13.5f, 1.10f * sunPulse, 1.10f * sunPulse, 1.10f * sunPulse),
            rotateWithScene = false,
            rimStrength = .08f,
        )
        if (sunReaction > .001f) {
            repeat(12) { index ->
                val angle = index * 30f + sunElapsed * 42f
                val radians = Math.toRadians(angle.toDouble())
                val radius = 1.42f + sunReaction * .42f
                draw(
                    requireNotNull(lowSphere),
                    color("#FFF5B8", sunReaction * .76f),
                    Transform(
                        -7.8f + cos(radians).toFloat() * radius,
                        8.7f + sin(radians).toFloat() * radius,
                        -13.45f,
                        .07f + sunReaction * .04f,
                        .025f,
                        .07f + sunReaction * .04f,
                    ),
                    rotateWithScene = false,
                    rimStrength = .18f,
                )
            }
        }
        if (sunGlowStartedMs > 0L && sunElapsed > 1.8f) {
            sunGlowStartedMs = 0L
        }
        // A tiny migrating pair rewards a slow orbit without competing with
        // the foreground characters.
        val birdTravel = (frame.storyTime * .055f) % 1f
        val birdX = -10f + birdTravel * 20f
        val birdY = 7.1f + sin(birdTravel * PI.toFloat()) * 1.15f
        for (offset in listOf(-.12f, .12f)) {
            draw(
                requireNotNull(cube),
                color("#42525A", .82f * (1f - evening)),
                Transform(
                    birdX + offset,
                    birdY,
                    -10.5f,
                    .13f,
                    .018f,
                    .035f,
                    rotationZ = if (offset < 0f) 22f else -22f,
                ),
                rotateWithScene = false,
                rimStrength = 0f,
            )
        }
        drawMoonAndFireflies(evening)
    }

    private fun eveningAmount(): Float {
        // The narrated loop restarts after its five 13-second chapters. Match
        // that rhythm so the brighter daytime remains the scene's home state
        // instead of getting stuck at night after the first play-through.
        val cycle = if (frame.storyTime < SceneMotion.INTRO_SECONDS) {
            frame.storyTime
        } else {
            SceneMotion.INTRO_SECONDS +
                ((frame.storyTime - SceneMotion.INTRO_SECONDS) % SceneMotion.LAP_SECONDS)
        }
        return when {
            cycle < 44f -> 0f
            cycle < 54f -> (cycle - 44f) / 10f
            cycle < 62f -> 1f
            else -> ((69f - cycle) / 7f).coerceIn(0f, 1f)
        }
    }

    private fun drawMoonAndFireflies(evening: Float) {
        if (evening <= .02f) return
        val moonX = moonPosition.x
        val moonY = moonPosition.y
        val moonZ = moonPosition.z
        val moonVisibility = ((evening - .02f) / .30f).coerceIn(0f, 1f)
        val winkElapsed = eventSeconds(moonWinkStartedMs)
        val wink = if (winkElapsed in 0f..1.45f) {
            sin((winkElapsed / 1.45f) * PI.toFloat()).coerceAtLeast(0f)
        } else {
            0f
        }
        val pulse = 1f + wink * .055f
        repeat(14) { index ->
            val starPulse = .45f + abs(sin(frame.storyTime * (.45f + index * .017f) + index)) * .55f
            draw(
                requireNotNull(lowSphere),
                color("#FFF3C0", moonVisibility * starPulse * .72f),
                Transform(
                    -10.5f + pseudo(index * 43 + 7) * 21f,
                    4.7f + pseudo(index * 61 + 3) * 4.7f,
                    -13.4f - pseudo(index * 71 + 11) * 1.8f,
                    .022f + (index % 3) * .009f,
                    .022f + (index % 3) * .009f,
                    .022f + (index % 3) * .009f,
                ),
                rotateWithScene = false,
                rimStrength = .20f,
            )
        }
        draw(
            requireNotNull(lowSphere),
            color("#FFF3C4", moonVisibility * .16f),
            Transform(moonX, moonY, moonZ, 1.04f * pulse, 1.04f * pulse, 1.04f * pulse),
            rotateWithScene = false,
            rimStrength = .08f,
        )
        draw(
            requireNotNull(lowSphere),
            color("#FFF2B8", .94f * moonVisibility),
            Transform(moonX, moonY, moonZ, .82f * pulse, .82f * pulse, .82f * pulse),
            rotateWithScene = false,
            rimStrength = .18f,
        )
        if (moonVisibility > .42f) {
            val heading = Math.toDegrees(
                kotlin.math.atan2(
                    (eyeX - moonX).toDouble(),
                    (eyeZ - moonZ).toDouble(),
                ),
            ).toFloat()
            listOf(
                Triple(-.34f, .34f, .095f),
                Triple(.36f, -.10f, .075f),
                Triple(-.19f, -.34f, .060f),
            ).forEach { (localX, localY, size) ->
                drawActorPart(
                    requireNotNull(lowSphere),
                    "#D8C98F",
                    moonX,
                    moonZ,
                    localX,
                    moonY + localY,
                    .70f,
                    size,
                    size * .72f,
                    .035f,
                    heading,
                    rotateWithScene = false,
                )
            }
            drawActorPart(
                requireNotNull(lowSphere),
                "#776D58",
                moonX,
                moonZ,
                -.22f,
                moonY + .13f,
                .75f,
                .075f,
                .085f * (1f - wink * .82f),
                .035f,
                heading,
                rotateWithScene = false,
            )
            drawActorPart(
                requireNotNull(lowSphere),
                "#776D58",
                moonX,
                moonZ,
                .22f,
                moonY + .13f,
                .75f,
                .075f,
                .085f,
                .035f,
                heading,
                rotateWithScene = false,
            )
            drawActorPart(
                requireNotNull(lowSphere),
                "#B89C67",
                moonX,
                moonZ,
                0f,
                moonY - .17f,
                .77f,
                .16f,
                .035f,
                .028f,
                heading,
                rotateWithScene = false,
            )
        }

        if (evening > .25f) {
            val fireflyVisibility = ((evening - .25f) / .35f).coerceIn(0f, 1f)
            repeat(18) { index ->
                val angle = pseudo(index * 47 + 5) * 360f
                val radius = 1.7f + pseudo(index * 59 + 7) * 5.4f
                val (x, z) = radial(angle, radius)
                val blink = (.28f + .72f * abs(sin(frame.storyTime * (1.8f + index * .03f) + index)))
                draw(
                    requireNotNull(lowSphere),
                    color("#FFE76B", fireflyVisibility * blink * .86f),
                    Transform(
                        x,
                        .38f + pseudo(index * 71 + 3) * 1.15f +
                            sin(frame.storyTime * 1.1f + index) * .08f,
                        z,
                        .027f,
                        .027f,
                        .027f,
                    ),
                    rimStrength = .24f,
                )
            }
        }
        if (moonWinkStartedMs > 0L && winkElapsed > 1.45f) {
            moonWinkStartedMs = 0L
        }
    }

    private fun createBackgroundBatches(
        lowSphereData: MeshData,
        cylinderData: MeshData,
        coneData: MeshData,
    ): List<StaticBatch> {
        val groups = linkedMapOf<BatchStyle, MutableList<MeshPart>>()
        fun add(style: BatchStyle, data: MeshData, transform: Transform) {
            groups.getOrPut(style) { mutableListOf() }.add(MeshPart(data, transform))
        }

        // Broad low mounds and undergrowth close the visual gap between the
        // island edge and the tree silhouettes.
        listOf(
            Triple(32f, 25.5f, 7.2f),
            Triple(151f, 27.5f, 8.8f),
            Triple(264f, 26.4f, 7.8f),
            Triple(338f, 24.8f, 6.4f),
        ).forEachIndexed { index, (angle, radius, size) ->
            val (x, z) = radial(angle, radius)
            add(
                BatchStyle(if (index % 2 == 0) "#537558" else "#486B50", rimStrength = .04f),
                lowSphereData,
                Transform(x, -1.20f, z, size, 1.15f, size * .62f, rotationY = angle),
            )
        }

        val forestRings = listOf(
            ForestRing(radius = 18.5f, count = 50, tint = "#35643D", topTint = "#43774A", baseSize = .92f),
            ForestRing(radius = 23.5f, count = 46, tint = "#416B47", topTint = "#527B56", baseSize = 1.10f),
            ForestRing(radius = 29f, count = 42, tint = "#526F55", topTint = "#648268", baseSize = 1.26f),
        )
        var seed = 17
        forestRings.forEachIndexed { ringIndex, ringSpec ->
            repeat(ringSpec.count) { index ->
                val angle = (index.toFloat() / ringSpec.count) * PI.toFloat() * 2f +
                    ringIndex * .071f + (pseudo(seed + 81) - .5f) * .10f
                val radius = ringSpec.radius + (pseudo(seed + 14) - .5f) * 2.4f
                val size = ringSpec.baseSize * (.78f + pseudo(seed + 37) * .58f)
                val x = sin(angle) * radius
                val z = cos(angle) * radius
                val ground = -1.62f
                val yaw = pseudo(seed + 101) * 360f
                val crownProfile = index % 3
                val lowerWidth = (.69f + pseudo(seed + 109) * .16f) *
                    if (crownProfile == 0) 1.08f else .96f
                val middleWidth = (.52f + pseudo(seed + 113) * .13f) *
                    if (crownProfile == 1) 1.10f else .98f
                val upperWidth = (.35f + pseudo(seed + 127) * .10f) *
                    if (crownProfile == 2) 1.13f else .98f
                val lowerHeight = .65f + pseudo(seed + 131) * .14f
                val middleHeight = .54f + pseudo(seed + 137) * .14f
                val upperHeight = .42f + pseudo(seed + 139) * .13f
                val crownLeanX = (pseudo(seed + 149) - .5f) * .15f * size
                val crownLeanZ = (pseudo(seed + 151) - .5f) * .15f * size
                add(
                    BatchStyle(ringSpec.tint, rimStrength = .04f),
                    coneData,
                    Transform(
                        x,
                        ground + .82f * size,
                        z,
                        lowerWidth * size,
                        lowerHeight * size,
                        lowerWidth * size * (.91f + pseudo(seed + 157) * .16f),
                        rotationY = yaw,
                    ),
                )
                add(
                    BatchStyle(ringSpec.tint, rimStrength = .04f),
                    coneData,
                    Transform(
                        x + crownLeanX * .45f,
                        ground + (1.40f + pseudo(seed + 163) * .10f) * size,
                        z + crownLeanZ * .45f,
                        middleWidth * size,
                        middleHeight * size,
                        middleWidth * size * (.90f + pseudo(seed + 167) * .18f),
                        rotationY = yaw + 11f + pseudo(seed + 173) * 21f,
                    ),
                )
                add(
                    BatchStyle(ringSpec.topTint, rimStrength = .04f),
                    coneData,
                    Transform(
                        x + crownLeanX,
                        ground + (1.91f + pseudo(seed + 179) * .13f) * size,
                        z + crownLeanZ,
                        upperWidth * size,
                        upperHeight * size,
                        upperWidth * size * (.88f + pseudo(seed + 181) * .20f),
                        rotationY = yaw - 18f + pseudo(seed + 191) * 29f,
                    ),
                )
                // Only the nearest silhouettes need a visible trunk. The two
                // distant rings save that draw/geometry budget for foliage.
                if (ringIndex == 0 && index % 2 == 0) {
                    add(
                        BatchStyle("#5D4D3D", rimStrength = .02f),
                        cylinderData,
                        Transform(x, ground + .26f * size, z, .08f * size, .34f * size, .08f * size),
                    )
                }
                seed += 19
            }
        }

        repeat(50) { index ->
            val angle = index * (2f * PI.toFloat() / 50f) + pseudo(index * 11 + 7) * .08f
            val radius = 14.8f + pseudo(index * 31 + 2) * 5.0f
            val x = sin(angle) * radius
            val z = cos(angle) * radius
            val size = .42f + pseudo(index * 43 + 9) * .38f
            val yaw = pseudo(index * 59 + 3) * 360f
            val style = BatchStyle(if (index % 3 == 0) "#456F49" else "#507A50", rimStrength = .04f)
            val firstWidth = size * (.82f + pseudo(index * 71 + 5) * .35f)
            val firstDepth = size * (.66f + pseudo(index * 73 + 9) * .30f)
            add(
                style,
                lowSphereData,
                Transform(
                    x,
                    -1.36f + size * (.29f + pseudo(index * 79 + 1) * .12f),
                    z,
                    firstWidth,
                    size * (.37f + pseudo(index * 83 + 2) * .18f),
                    firstDepth,
                    rotationY = yaw,
                ),
            )
            val secondOffset = size * (.35f + pseudo(index * 89 + 6) * .42f)
            add(
                style,
                lowSphereData,
                Transform(
                    x + cos(Math.toRadians(yaw.toDouble())).toFloat() * secondOffset,
                    -1.38f + size * .25f,
                    z + sin(Math.toRadians(yaw.toDouble())).toFloat() * secondOffset,
                    size * (.48f + pseudo(index * 97 + 4) * .30f),
                    size * (.27f + pseudo(index * 101 + 8) * .16f),
                    size * (.45f + pseudo(index * 103 + 2) * .25f),
                    rotationY = yaw + 47f,
                ),
            )
            if (index % 3 == 0) {
                val thirdYaw = yaw - 74f + pseudo(index * 107 + 3) * 28f
                val thirdRadians = Math.toRadians(thirdYaw.toDouble())
                add(
                    style,
                    lowSphereData,
                    Transform(
                        x + cos(thirdRadians).toFloat() * size * .42f,
                        -1.39f + size * .22f,
                        z + sin(thirdRadians).toFloat() * size * .42f,
                        size * (.38f + pseudo(index * 109 + 7) * .24f),
                        size * (.24f + pseudo(index * 113 + 1) * .14f),
                        size * (.38f + pseudo(index * 127 + 6) * .22f),
                        rotationY = thirdYaw,
                    ),
                )
            }
        }
        return createStaticBatches(groups)
    }

    private fun createVegetationBatches(
        lowSphereData: MeshData,
        cubeData: MeshData,
        cylinderData: MeshData,
        coneData: MeshData,
        discData: MeshData,
    ): List<StaticBatch> {
        val groups = linkedMapOf<BatchStyle, MutableList<MeshPart>>()
        fun add(style: BatchStyle, data: MeshData, transform: Transform) {
            groups.getOrPut(style) { mutableListOf() }.add(MeshPart(data, transform))
        }

        fun addTreeShadow(x: Float, z: Float, size: Float) {
            add(
                BatchStyle("#29462A", alpha = .20f, rimStrength = 0f),
                discData,
                Transform(x, .068f, z, .63f * size, .010f, .43f * size),
            )
        }

        fun addSpruce(point: PolarPoint, size: Float, darker: Boolean) {
            val (x, z) = radial(point.angle, point.radius)
            val treeSeed = (point.angle * 37f + point.radius * 19f).toInt()
            val yaw = pseudo(treeSeed) * 360f
            val leanX = (pseudo(treeSeed + 17) - .5f) * .11f * size
            val leanZ = (pseudo(treeSeed + 29) - .5f) * .11f * size
            val lowerWidth = .58f + pseudo(treeSeed + 31) * .16f
            val middleWidth = .46f + pseudo(treeSeed + 37) * .14f
            val upperWidth = .32f + pseudo(treeSeed + 41) * .12f
            addTreeShadow(x, z, size)
            add(
                BatchStyle("#6B4C33", rimStrength = .08f),
                cylinderData,
                Transform(x, .46f * size, z, .095f * size, .45f * size, .095f * size),
            )
            val lower = if (darker) "#376A3D" else "#4B8A49"
            val upper = if (darker) "#427947" else "#5A9A51"
            add(
                BatchStyle(lower, rimStrength = .12f),
                coneData,
                Transform(
                    x,
                    (.90f + pseudo(treeSeed + 43) * .09f) * size,
                    z,
                    lowerWidth * size,
                    (.62f + pseudo(treeSeed + 47) * .16f) * size,
                    lowerWidth * size * (.90f + pseudo(treeSeed + 53) * .18f),
                    rotationY = yaw,
                ),
            )
            add(
                BatchStyle(lower, rimStrength = .12f),
                coneData,
                Transform(
                    x + leanX * .48f,
                    (1.43f + pseudo(treeSeed + 59) * .11f) * size,
                    z + leanZ * .48f,
                    middleWidth * size,
                    (.54f + pseudo(treeSeed + 61) * .15f) * size,
                    middleWidth * size * (.88f + pseudo(treeSeed + 67) * .20f),
                    rotationY = yaw + 10f + pseudo(treeSeed + 71) * 25f,
                ),
            )
            add(
                BatchStyle(upper, rimStrength = .12f),
                coneData,
                Transform(
                    x + leanX,
                    (1.88f + pseudo(treeSeed + 73) * .13f) * size,
                    z + leanZ,
                    upperWidth * size,
                    (.42f + pseudo(treeSeed + 79) * .14f) * size,
                    upperWidth * size * (.86f + pseudo(treeSeed + 83) * .22f),
                    rotationY = yaw - 18f + pseudo(treeSeed + 89) * 31f,
                ),
            )
        }

        fun addBirch(point: PolarPoint, size: Float) {
            val (x, z) = radial(point.angle, point.radius)
            val treeSeed = (point.angle * 43f + point.radius * 23f).toInt()
            val yaw = pseudo(treeSeed) * 360f
            val yawRadians = Math.toRadians(yaw.toDouble())
            val offsetX = cos(yawRadians).toFloat()
            val offsetZ = sin(yawRadians).toFloat()
            addTreeShadow(x, z, size)
            add(
                BatchStyle("#ECE8DE", rimStrength = .10f),
                cylinderData,
                Transform(x, .80f * size, z, .075f * size, .78f * size, .075f * size),
            )
            val stripeCount = 3 + (kotlin.math.abs(treeSeed) % 3)
            repeat(stripeCount) { stripe ->
                val stripeY = (.31f + stripe * (1.08f / stripeCount)) * size
                add(
                    BatchStyle("#4C463D", rimStrength = .02f),
                    lowSphereData,
                    Transform(
                        x + if (stripe % 2 == 0) {
                            (.022f + pseudo(treeSeed + stripe * 11) * .014f) * size
                        } else {
                            -(.016f + pseudo(treeSeed + stripe * 13) * .012f) * size
                        },
                        stripeY,
                        z,
                        (.070f + pseudo(treeSeed + stripe * 17) * .016f) * size,
                        (.018f + pseudo(treeSeed + stripe * 19) * .013f) * size,
                        (.072f + pseudo(treeSeed + stripe * 23) * .018f) * size,
                        rotationY = yaw + stripe * (21f + pseudo(treeSeed + 97) * 15f),
                    ),
                )
            }
            val canopyStyle = BatchStyle(if (point.angle < 120f || point.angle > 280f) "#83B763" else "#76A95B", rimStrength = .14f)
            add(
                canopyStyle,
                lowSphereData,
                Transform(
                    x,
                    (1.56f + pseudo(treeSeed + 101) * .12f) * size,
                    z,
                    (.40f + pseudo(treeSeed + 103) * .13f) * size,
                    (.31f + pseudo(treeSeed + 107) * .12f) * size,
                    (.36f + pseudo(treeSeed + 109) * .13f) * size,
                    rotationY = yaw,
                ),
            )
            add(
                canopyStyle,
                lowSphereData,
                Transform(
                    x - offsetX * (.19f + pseudo(treeSeed + 113) * .11f) * size,
                    (1.78f + pseudo(treeSeed + 127) * .16f) * size,
                    z - offsetZ * (.19f + pseudo(treeSeed + 113) * .11f) * size,
                    (.28f + pseudo(treeSeed + 131) * .13f) * size,
                    (.26f + pseudo(treeSeed + 137) * .11f) * size,
                    (.29f + pseudo(treeSeed + 139) * .12f) * size,
                    rotationY = yaw + 71f,
                ),
            )
            add(
                canopyStyle,
                lowSphereData,
                Transform(
                    x + offsetX * (.20f + pseudo(treeSeed + 149) * .12f) * size,
                    (1.74f + pseudo(treeSeed + 151) * .17f) * size,
                    z + offsetZ * (.20f + pseudo(treeSeed + 149) * .12f) * size,
                    (.30f + pseudo(treeSeed + 157) * .14f) * size,
                    (.27f + pseudo(treeSeed + 163) * .12f) * size,
                    (.28f + pseudo(treeSeed + 167) * .13f) * size,
                    rotationY = yaw - 53f,
                ),
            )
        }

        // Moss grows thick along both sides of the circular story path.
        repeat(40) { index ->
            val angle = index * (360f / 40f) + (pseudo(index * 41 + 2) - .5f) * 5f
            val radius = if (index % 2 == 0) 4.03f else 5.23f
            val (x, z) = radial(angle, radius)
            val size = .14f + pseudo(index * 13 + 4) * .13f
            val yaw = pseudo(index * 67 + 9) * 360f
            val style = BatchStyle(if (index % 3 == 0) "#74A85D" else "#639A52", rimStrength = .08f)
            val lobeCount = 2 + index % 3
            repeat(lobeCount) { lobe ->
                val lobeYaw = yaw + lobe * (360f / lobeCount) +
                    (pseudo(index * 101 + lobe * 17) - .5f) * 38f
                val lobeRadians = Math.toRadians(lobeYaw.toDouble())
                val offset = if (lobe == 0) 0f else {
                    size * (.34f + pseudo(index * 103 + lobe * 19) * .48f)
                }
                val lobeScale = .58f + pseudo(index * 107 + lobe * 23) * .48f
                add(
                    style,
                    lowSphereData,
                    Transform(
                        x + cos(lobeRadians).toFloat() * offset,
                        .09f + size * (.10f + pseudo(index * 109 + lobe * 29) * .16f),
                        z + sin(lobeRadians).toFloat() * offset,
                        size * lobeScale * (.86f + pseudo(index * 113 + lobe * 31) * .30f),
                        size * lobeScale * (.34f + pseudo(index * 127 + lobe * 37) * .20f),
                        size * lobeScale * (.66f + pseudo(index * 131 + lobe * 41) * .30f),
                        rotationY = lobeYaw,
                    ),
                )
            }
        }

        repeat(30) { index ->
            val angle = index * 12f + (pseudo(index * 31 + 4) - .5f) * 9f
            val radius = .76f + pseudo(index * 47 + 7) * .43f
            val (x, z) = radial(angle, radius)
            val size = .085f + pseudo(index * 53 + 2) * .075f
            add(
                BatchStyle(if (index % 3 == 0) "#71965B" else "#5E874E", rimStrength = .06f),
                lowSphereData,
                Transform(
                    x,
                    .09f + pseudo(index * 13 + 1) * .03f,
                    z,
                    size * (1f + pseudo(index * 17 + 5) * .38f),
                    size * (.38f + pseudo(index * 19 + 6) * .18f),
                    size,
                    rotationY = pseudo(index * 59 + 9) * 360f,
                ),
            )
        }

        // A carpet of tiny, batched grass blades adds detail without adding
        // per-object draw calls.
        repeat(168) { index ->
            val angle = pseudo(index * 17 + 4) * 360f
            var radius = 1.55f + pseudo(index * 29 + 12) * 5.90f
            if (abs(radius - 4.63f) < .48f) {
                radius += if (radius < 4.63f) -.55f else .55f
            }
            val (x, z) = radial(angle, radius)
            val height = .075f + pseudo(index * 43 + 7) * .095f
            val yaw = pseudo(index * 73 + 19) * 360f
            val style = BatchStyle(
                when (index % 4) {
                    0 -> "#6EAD59"
                    1 -> "#7AB763"
                    2 -> "#62A253"
                    else -> "#88BD6A"
                },
                rimStrength = .04f,
            )
            repeat(3) { blade ->
                val bladeYaw = yaw + blade * (104f + pseudo(index * 11 + blade) * 17f)
                val bladeRadians = Math.toRadians(bladeYaw.toDouble())
                val bladeHeight = height * (.76f + pseudo(index * 89 + blade * 7) * .34f)
                val bladeLean = (pseudo(index * 97 + blade * 13) - .5f) * 34f
                val offset = blade * .018f
                add(
                    style,
                    cubeData,
                    Transform(
                        x + cos(bladeRadians).toFloat() * offset,
                        .055f + bladeHeight,
                        z + sin(bladeRadians).toFloat() * offset,
                        .011f + pseudo(index * 31 + blade) * .005f,
                        bladeHeight,
                        .019f + pseudo(index * 37 + blade) * .006f,
                        rotationY = bladeYaw,
                        rotationZ = bladeLean,
                    ),
                )
            }
        }

        // Shaded fern fans break up the repeated grass silhouette. They are
        // still merged into two color batches, so the extra detail adds no
        // per-plant draw calls.
        repeat(18) { index ->
            val angle = 105f + pseudo(index * 151 + 7) * 185f
            var radius = 1.75f + pseudo(index * 157 + 11) * 5.45f
            if (abs(radius - 4.63f) < .52f) {
                radius += if (radius < 4.63f) -.61f else .61f
            }
            val (x, z) = radial(angle, radius)
            val yaw = pseudo(index * 163 + 5) * 360f
            val fernScale = .72f + pseudo(index * 167 + 3) * .76f
            val stemHalfHeight = .095f * fernScale
            val fernStyle = BatchStyle(
                if (index % 2 == 0) "#477C45" else "#568C4C",
                rimStrength = .05f,
            )
            add(
                fernStyle,
                cylinderData,
                Transform(
                    x,
                    .035f + stemHalfHeight,
                    z,
                    .010f * fernScale,
                    stemHalfHeight,
                    .010f * fernScale,
                    rotationY = yaw,
                    rotationZ = (pseudo(index * 173 + 1) - .5f) * 16f,
                ),
            )
            repeat(3) { tier ->
                val tierScale = (1f - tier * .19f) *
                    (.86f + pseudo(index * 179 + tier * 13) * .27f)
                for (side in listOf(-1f, 1f)) {
                    val leafYaw = yaw + side * (42f + tier * 13f) +
                        (pseudo(index * 181 + tier * 17 + if (side > 0f) 5 else 0) - .5f) * 19f
                    val leafRadians = Math.toRadians(leafYaw.toDouble())
                    val offset = .045f * fernScale * (1f + tier * .16f)
                    add(
                        fernStyle,
                        cubeData,
                        Transform(
                            x + cos(leafRadians).toFloat() * offset,
                            .085f + tier * .055f * fernScale,
                            z + sin(leafRadians).toFloat() * offset,
                            .075f * fernScale * tierScale,
                            .009f * fernScale,
                            .021f * fernScale * (.82f + pseudo(index * 191 + tier * 19) * .31f),
                            rotationY = leafYaw,
                            rotationZ = side * (12f + tier * 7f),
                        ),
                    )
                }
            }
        }

        repeat(34) { index ->
            val angle = index * (360f / 34f) + 4f +
                (pseudo(index * 43 + 17) - .5f) * 6f
            var radius = 2.05f + pseudo(index * 53 + 9) * 5.18f
            if (abs(radius - 4.63f) < .58f) radius += if (radius < 4.63f) -.68f else .68f
            val (x, z) = radial(angle, radius)
            val yaw = pseudo(index * 79 + 11) * 360f
            val lean = (pseudo(index * 83 + 3) - .5f) * 16f
            val stemHalfHeight = .09f + pseudo(index * 89 + 13) * .095f
            val stemRadius = .012f + pseudo(index * 97 + 7) * .007f
            val headScale = .044f + pseudo(index * 101 + 19) * .046f
            add(
                BatchStyle("#58914D", rimStrength = .04f),
                cylinderData,
                Transform(
                    x,
                    .025f + stemHalfHeight,
                    z,
                    stemRadius,
                    stemHalfHeight,
                    stemRadius,
                    rotationY = yaw,
                    rotationZ = lean,
                ),
            )
            add(
                BatchStyle("#68A153", rimStrength = .04f),
                cubeData,
                Transform(
                    x,
                    .04f + stemHalfHeight * (.70f + pseudo(index * 103 + 5) * .42f),
                    z,
                    (.034f + pseudo(index * 107 + 3) * .028f),
                    .010f + pseudo(index * 109 + 11) * .008f,
                    .014f + pseudo(index * 113 + 2) * .012f,
                    rotationY = yaw + 18f + pseudo(index * 127 + 9) * 46f,
                    rotationZ = lean + 12f + pseudo(index * 131 + 4) * 24f,
                ),
            )
            val flowerColor = when (index % 4) {
                0 -> "#FFF1A8"
                1 -> "#F07F87"
                2 -> "#84BCE2"
                else -> "#E9A8D0"
            }
            add(
                BatchStyle(flowerColor, rimStrength = .08f),
                lowSphereData,
                Transform(
                    x,
                    .045f + stemHalfHeight * 2f,
                    z,
                    headScale * (.86f + pseudo(index * 137 + 5) * .24f),
                    headScale * (.58f + pseudo(index * 139 + 4) * .28f),
                    headScale * (.84f + pseudo(index * 149 + 8) * .28f),
                    rotationY = yaw,
                ),
            )
        }

        repeat(20) { index ->
            val angle = index * (360f / 20f) + 7f + (pseudo(index * 23 + 4) - .5f) * 8f
            var radius = 1.90f + pseudo(index * 47 + 3) * 5.25f
            if (abs(radius - 4.63f) < .72f) radius += if (radius < 4.63f) -.82f else .82f
            val (x, z) = radial(angle, radius)
            val style = BatchStyle(
                when (index % 3) {
                    0 -> "#6BA055"
                    1 -> "#5D944D"
                    else -> "#78A95E"
                },
                rimStrength = .10f,
            )
            val size = .17f + pseudo(index * 31 + 8) * .11f
            val yaw = pseudo(index * 73 + 5) * 360f
            val lobeCount = 2 + index % 3
            repeat(lobeCount) { lobe ->
                val lobeYaw = yaw + lobe * (360f / lobeCount) +
                    (pseudo(index * 137 + lobe * 17) - .5f) * 34f
                val lobeRadians = Math.toRadians(lobeYaw.toDouble())
                val offset = if (lobe == 0) 0f else {
                    size * (.35f + pseudo(index * 139 + lobe * 19) * .48f)
                }
                val lobeScale = .61f + pseudo(index * 149 + lobe * 23) * .48f
                add(
                    style,
                    lowSphereData,
                    Transform(
                        x + cos(lobeRadians).toFloat() * offset,
                        .10f + size * (.13f + pseudo(index * 151 + lobe * 29) * .20f),
                        z + sin(lobeRadians).toFloat() * offset,
                        size * lobeScale * (.88f + pseudo(index * 157 + lobe * 31) * .26f),
                        size * lobeScale * (.48f + pseudo(index * 163 + lobe * 37) * .25f),
                        size * lobeScale * (.66f + pseudo(index * 167 + lobe * 41) * .30f),
                        rotationY = lobeYaw,
                    ),
                )
            }
            if (index % 4 == 0) {
                repeat(3) { berry ->
                    add(
                        BatchStyle(if (index % 8 == 0) "#D84E52" else "#6F4B88", rimStrength = .12f),
                        lowSphereData,
                        Transform(
                            x + (berry - 1) * .065f,
                            .25f + (berry % 2) * .035f,
                            z + .04f - berry * .018f,
                            .026f,
                            .026f,
                            .026f,
                            rotationY = yaw,
                        ),
                    )
                }
            }
        }

        repeat(12) { index ->
            val angle = index * 30f + 14f + (pseudo(index * 47 + 6) - .5f) * 10f
            val radius = if (index % 2 == 0) 3.15f + pseudo(index * 37 + 4) * .52f else 6.05f + pseudo(index * 41 + 2) * .70f
            val (x, z) = radial(angle, radius)
            val size = .24f + pseudo(index * 59 + 3) * .16f
            val yaw = pseudo(index * 71 + 1) * 360f
            val normalized = size / .3f
            val leanX = (pseudo(index * 73 + 9) - .5f) * .075f * normalized
            val leanZ = (pseudo(index * 79 + 5) - .5f) * .075f * normalized
            add(
                BatchStyle("#6B4C33", rimStrength = .06f),
                cylinderData,
                Transform(
                    x,
                    (.17f + pseudo(index * 83 + 2) * .07f) * normalized,
                    z,
                    (.039f + pseudo(index * 89 + 7) * .021f) * normalized,
                    (.17f + pseudo(index * 97 + 1) * .07f) * normalized,
                    (.039f + pseudo(index * 101 + 4) * .021f) * normalized,
                ),
            )
            add(
                BatchStyle("#4C8545", rimStrength = .10f),
                coneData,
                Transform(
                    x,
                    (.43f + pseudo(index * 103 + 8) * .09f) * normalized,
                    z,
                    (.23f + pseudo(index * 107 + 3) * .11f) * normalized,
                    (.24f + pseudo(index * 109 + 11) * .12f) * normalized,
                    (.22f + pseudo(index * 113 + 6) * .11f) * normalized,
                    rotationY = yaw,
                ),
            )
            add(
                BatchStyle("#5A9850", rimStrength = .10f),
                coneData,
                Transform(
                    x + leanX,
                    (.68f + pseudo(index * 127 + 5) * .11f) * normalized,
                    z + leanZ,
                    (.16f + pseudo(index * 131 + 2) * .09f) * normalized,
                    (.19f + pseudo(index * 137 + 7) * .10f) * normalized,
                    (.15f + pseudo(index * 139 + 1) * .10f) * normalized,
                    rotationY = yaw + 12f + pseudo(index * 149 + 4) * 31f,
                ),
            )
            if (index % 4 == 0) {
                add(
                    BatchStyle("#5A9850", rimStrength = .10f),
                    coneData,
                    Transform(
                        x + leanX * 1.45f,
                        (.87f + pseudo(index * 151 + 3) * .08f) * normalized,
                        z + leanZ * 1.45f,
                        (.10f + pseudo(index * 157 + 9) * .055f) * normalized,
                        (.13f + pseudo(index * 163 + 2) * .07f) * normalized,
                        (.10f + pseudo(index * 167 + 6) * .055f) * normalized,
                        rotationY = yaw - 19f,
                    ),
                )
            }
        }

        repeat(38) { index ->
            val angle = pseudo(index * 83 + 7) * 360f
            var radius = 1.42f + pseudo(index * 61 + 9) * 5.75f
            if (abs(radius - 4.63f) < .48f) radius += if (radius < 4.63f) -.54f else .54f
            val (x, z) = radial(angle, radius)
            val yaw = pseudo(index * 31 + 12) * 360f
            val patchScale = .72f + pseudo(index * 37 + 8) * .72f
            val leafCount = if (index % 4 == 0) 4 else 3
            repeat(leafCount) { leaf ->
                val leafAngle = yaw + leaf * (360f / leafCount) +
                    (pseudo(index * 41 + leaf * 13) - .5f) * 18f
                val radians = Math.toRadians(leafAngle.toDouble())
                val leafScale = patchScale * (.78f + pseudo(index * 43 + leaf * 17) * .40f)
                val leafOffset = .041f + pseudo(index * 47 + leaf * 19) * .022f
                add(
                    BatchStyle(if (index % 2 == 0) "#6BA558" else "#78AF60", rimStrength = .05f),
                    lowSphereData,
                    Transform(
                        x + cos(radians).toFloat() * leafOffset * patchScale,
                        .074f + .020f * patchScale,
                        z + sin(radians).toFloat() * leafOffset * patchScale,
                        .050f * leafScale,
                        .014f * leafScale,
                        (.029f + pseudo(index * 53 + leaf * 23) * .012f) * leafScale,
                        rotationY = leafAngle,
                    ),
                )
            }
            if (index % 5 == 0) {
                add(
                    BatchStyle("#F3EEE3", rimStrength = .08f),
                    lowSphereData,
                    Transform(
                        x,
                        .115f + .030f * patchScale,
                        z,
                        .026f * patchScale,
                        .018f * patchScale,
                        .026f * patchScale,
                        rotationY = yaw,
                    ),
                )
            }
        }

        repeat(6) { index ->
            val angle = 118f + index * 31f
            val radius = 5.45f + (index % 2) * 1.12f
            val (x, z) = radial(angle, radius)
            val size = .13f + pseudo(index * 43 + 5) * .07f
            val yaw = pseudo(index * 53 + 2) * 360f
            val stumpHeight = .085f + pseudo(index * 59 + 7) * .085f
            val stumpWidth = size * (.82f + pseudo(index * 61 + 4) * .35f)
            add(
                BatchStyle("#765038", rimStrength = .08f),
                cylinderData,
                Transform(
                    x,
                    .04f + stumpHeight,
                    z,
                    stumpWidth,
                    stumpHeight,
                    size * (.80f + pseudo(index * 67 + 3) * .38f),
                    rotationY = yaw,
                    rotationZ = (pseudo(index * 71 + 1) - .5f) * 8f,
                ),
            )
            add(
                BatchStyle("#B28A5D", rimStrength = .06f),
                lowSphereData,
                Transform(
                    x,
                    .045f + stumpHeight * 2f,
                    z,
                    stumpWidth * .82f,
                    .016f + pseudo(index * 73 + 9) * .014f,
                    size * (.66f + pseudo(index * 79 + 2) * .28f),
                    rotationY = yaw + 18f + pseudo(index * 83 + 5) * 35f,
                ),
            )
        }

        repeat(22) { index ->
            val angle = pseudo(index * 101 + 3) * 360f
            var radius = 1.48f + pseudo(index * 89 + 11) * 5.86f
            if (abs(radius - 4.63f) < .34f) radius += if (radius < 4.63f) -.40f else .40f
            val (x, z) = radial(angle, radius)
            val size = .045f + pseudo(index * 47 + 2) * .075f
            add(
                BatchStyle(if (index % 3 == 0) "#879083" else "#9B9A89", rimStrength = .05f),
                lowSphereData,
                Transform(
                    x,
                    .085f,
                    z,
                    size * (1.1f + pseudo(index * 31 + 4) * .8f),
                    size * .45f,
                    size,
                    rotationY = pseudo(index * 67 + 8) * 360f,
                    rotationZ = (pseudo(index * 71 + 9) - .5f) * 14f,
                ),
            )
        }

        repeat(24) { index ->
            val angle = index * (360f / 24f) + 4f +
                (pseudo(index * 19 + 3) - .5f) * 10f
            val (x, z) = radial(angle, 4.62f + (pseudo(index * 23 + 1) - .5f) * .22f)
            val size = .045f + pseudo(index * 37 + 9) * .050f
            add(
                BatchStyle(if (index % 2 == 0) "#9B8A70" else "#B5A283", rimStrength = .04f),
                lowSphereData,
                Transform(
                    x,
                    .105f + pseudo(index * 41 + 5) * .026f,
                    z,
                    size * (.92f + pseudo(index * 43 + 8) * .88f),
                    size * (.34f + pseudo(index * 47 + 6) * .31f),
                    size * (.72f + pseudo(index * 53 + 2) * .62f),
                    rotationY = pseudo(index * 59 + 7) * 360f,
                    rotationZ = (pseudo(index * 61 + 4) - .5f) * 12f,
                ),
            )
        }

        repeat(7) { index ->
            val angle = index * 47f + 19f
            var radius = 2.2f + pseudo(index * 67 + 5) * 4.7f
            if (abs(radius - 4.63f) < .65f) radius -= .78f
            val (x, z) = radial(angle, radius)
            add(
                BatchStyle("#725E48", alpha = .55f, rimStrength = 0f),
                discData,
                Transform(x, .060f, z, .22f + index * .008f, .009f, .13f + index * .005f, rotationY = angle),
            )
        }
        return createStaticBatches(groups)
    }

    private fun createStaticBatches(
        groups: LinkedHashMap<BatchStyle, MutableList<MeshPart>>,
    ): List<StaticBatch> = groups.mapNotNull { (style, parts) ->
        if (parts.isEmpty()) {
            null
        } else {
            StaticBatch(
                mesh = createMesh(Geometry.merge(parts)),
                color = color(style.hex, style.alpha),
                rimStrength = style.rimStrength,
            )
        }
    }

    private fun drawCrossroadsStone() {
        draw(
            requireNotNull(disc),
            color("#31522D", .22f),
            Transform(0f, .055f, 0f, 1.08f, .025f, .78f),
        )
        draw(
            requireNotNull(lowSphere),
            color("#6E756A"),
            Transform(0f, 1.03f, 0f, .82f, 1.05f, .62f, rotationY = -8f, rotationZ = 3f),
            rimStrength = .12f,
        )
        draw(
            requireNotNull(lowSphere),
            color("#66865A"),
            Transform(-.08f, 1.92f, -.02f, .61f, .18f, .50f, rotationY = 15f),
        )
        val plaqueColor = color("#A8733C")
        listOf(
            crossroadsPlaqueTransform(-.08f, 1.48f, .72f, .66f, .14f, .055f, -3f),
            crossroadsPlaqueTransform(.08f, 1.13f, .74f, .72f, .14f, .055f, 2f),
            crossroadsPlaqueTransform(-.04f, .78f, .715f, .64f, .13f, .055f, -2f),
        ).forEach {
            draw(requireNotNull(cube), plaqueColor, it)
        }
        val labels = if (russianRockMenu) russianRockLabels else englishRockLabels
        if (labels.size == 3) {
            drawTextLabel(
                labels[0],
                crossroadsPlaqueTransform(-.08f, 1.48f, .783f, .61f, .100f, 1f, -3f),
            )
            drawTextLabel(
                labels[1],
                crossroadsPlaqueTransform(.08f, 1.13f, .803f, .67f, .100f, 1f, 2f),
            )
            drawTextLabel(
                labels[2],
                crossroadsPlaqueTransform(-.04f, .78f, .788f, .58f, .092f, 1f, -2f),
            )
        }
        draw(
            requireNotNull(lowSphere),
            color("#87917D"),
            Transform(-.66f, .21f, .18f, .31f, .20f, .27f, rotationZ = -11f),
        )
        draw(
            requireNotNull(lowSphere),
            color("#7B8277"),
            Transform(.60f, .18f, -.22f, .27f, .17f, .31f, rotationZ = 9f),
        )
        drawStoneBirds()
    }

    private fun drawStoneBirds() {
        val elapsed = eventSeconds(stoneBirdsStartedMs)
        val flying = elapsed in 0f..6.2f
        repeat(7) { index ->
            val angle = pseudo(index * 47 + 3) * 360f
            val baseRadius = .68f + pseudo(index * 59 + 8) * .43f
            val (baseX, baseZ) = radial(angle, baseRadius)
            val baseY = .20f + pseudo(index * 71 + 4) * .13f
            var x = baseX
            var y = baseY
            var z = baseZ
            var flap = sin(frame.storyTime * 2f + index) * 10f
            var flightAmount = 0f
            if (flying) {
                val depart = (elapsed / 1.35f).coerceIn(0f, 1f)
                val arrive = ((elapsed - 4.65f) / 1.55f).coerceIn(0f, 1f)
                val airborne = depart * (1f - arrive)
                flightAmount = airborne
                val outward = 2.2f + (index % 3) * .55f
                val (farX, farZ) = radial(angle + (index - 3) * 7f, outward)
                x = baseX + (farX - baseX) * airborne
                z = baseZ + (farZ - baseZ) * airborne
                y = baseY + airborne * (2.1f + (index % 2) * .45f) +
                    sin(depart * PI.toFloat()) * .24f
                val flightFlap = sin(elapsed * 14f + index) * 34f
                flap += (flightFlap - flap) * flightAmount
            }
            drawTinyBird(
                x = x,
                y = y,
                z = z,
                heading = when {
                    flying && elapsed >= 4.65f -> angle + (index - 3) * 7f + 180f
                    flying -> angle + (index - 3) * 7f
                    else -> angle + 180f
                },
                flap = flap,
                bodyColor = if (index % 3 == 0) "#465662" else if (index % 3 == 1) "#5B5148" else "#56636B",
                flightAmount = flightAmount,
            )
        }
        if (stoneBirdsStartedMs > 0L && elapsed > 6.2f) stoneBirdsStartedMs = 0L
    }

    private fun drawIzba() {
        val centerZ = 6.25f
        val roofCenterY = 1.96f
        val roofHalfDepth = 1.05f
        val gableCenterY = 1.97f
        val gableHalfHeight = .51f
        val izbaFlashElapsed = eventSeconds(izbaFlashStartedMs)
        val izbaFlash = if (izbaFlashElapsed in 0f..1.35f) {
            sin((izbaFlashElapsed / 1.35f) * PI.toFloat()).coerceAtLeast(0f)
        } else {
            0f
        }
        val windowWarmth = max(eveningAmount() * .88f, izbaFlash)
        val windowColor = floatArrayOf(
            .56f * (1f - windowWarmth) + .98f * windowWarmth,
            .82f * (1f - windowWarmth) + .76f * windowWarmth,
            .87f * (1f - windowWarmth) + .36f * windowWarmth,
            1f,
        )
        draw(
            requireNotNull(disc),
            color("#31522D", .24f),
            Transform(0f, .055f, centerZ, 1.72f, .025f, 1.42f),
        )
        repeat(6) { row ->
            val y = .20f + row * .25f
            val logColor = if (row % 2 == 0) "#A96936" else "#B8783D"
            draw(
                requireNotNull(cylinder),
                color(logColor),
                Transform(0f, y, centerZ - .92f, .12f, 1.28f, .12f, rotationZ = 90f),
            )
            draw(
                requireNotNull(cylinder),
                color(logColor),
                Transform(0f, y, centerZ + .92f, .12f, 1.28f, .12f, rotationZ = 90f),
            )
            draw(
                requireNotNull(cylinder),
                color(logColor),
                Transform(-1.25f, y, centerZ, .12f, .92f, .12f, rotationX = 90f),
            )
            draw(
                requireNotNull(cylinder),
                color(logColor),
                Transform(1.25f, y, centerZ, .12f, .92f, .12f, rotationX = 90f),
            )
        }
        draw(
            requireNotNull(cube),
            color("#8F3F31"),
            Transform(
                -.60f,
                roofCenterY,
                centerZ,
                .79f,
                .095f,
                roofHalfDepth,
                rotationZ = 35f,
            ),
        )
        draw(
            requireNotNull(cube),
            color("#A94B38"),
            Transform(
                .60f,
                roofCenterY,
                centerZ,
                .79f,
                .095f,
                roofHalfDepth,
                rotationZ = -35f,
            ),
        )
        for (side in listOf(-1f, 1f)) {
            val gableZ = centerZ + side * .955f
            draw(
                requireNotNull(triangularPrism),
                color(if (side < 0f) "#A86B3B" else "#8D5735"),
                Transform(
                    0f,
                    gableCenterY,
                    gableZ,
                    1.23f,
                    gableHalfHeight,
                    .055f,
                ),
                rimStrength = .10f,
            )
            draw(
                requireNotNull(cube),
                color("#6F472E"),
                Transform(0f, 1.47f, gableZ + side * .065f, 1.24f, .045f, .045f),
                rimStrength = .08f,
            )
            draw(
                requireNotNull(cube),
                color("#794B2E"),
                Transform(0f, 1.82f, gableZ + side * .066f, .040f, .34f, .045f),
                rimStrength = .08f,
            )
        }
        draw(
            requireNotNull(cylinder),
            color("#6A4633"),
            Transform(.66f, 2.46f, centerZ + .25f, .15f, .43f, .15f),
        )
        draw(
            requireNotNull(cube),
            color("#573424"),
            Transform(.47f, .66f, centerZ - .955f, .35f, .63f, .06f),
        )
        draw(
            requireNotNull(cube),
            windowColor,
            Transform(-.48f, .87f, centerZ - .968f, .34f, .34f, .045f),
        )
        draw(
            requireNotNull(cube),
            color("#F5E7BE"),
            Transform(-.48f, .87f, centerZ - 1.02f, .025f, .34f, .05f),
        )
        draw(
            requireNotNull(cube),
            color("#F5E7BE"),
            Transform(-.48f, .87f, centerZ - 1.02f, .34f, .025f, .05f),
        )
        draw(
            requireNotNull(lowSphere),
            color("#F2D59A"),
            Transform(.72f, .67f, centerZ - 1.04f, .035f, .035f, .035f),
        )

        // A moving silhouette and curtains make the lit window feel occupied.
        val grandmaX = -.48f + sin(frame.storyTime * .48f) * .10f
        draw(
            requireNotNull(lowSphere),
            color("#49392F"),
            Transform(grandmaX, .95f, centerZ - 1.075f, .085f, .105f, .035f),
            rimStrength = .02f,
        )
        draw(
            requireNotNull(cone),
            color("#6D4538"),
            Transform(grandmaX, .74f, centerZ - 1.07f, .16f, .22f, .045f),
            rimStrength = .02f,
        )
        for (side in listOf(-.29f, .29f)) {
            draw(
                requireNotNull(cube),
                color("#C96A53"),
                Transform(-.48f + side, .87f, centerZ - 1.085f, .035f, .31f, .025f),
                rimStrength = .04f,
            )
        }

        // Porch, bench and firewood restore the lived-in miniature around the
        // house instead of leaving it as an isolated model.
        draw(requireNotNull(cube), color("#8B582F"), Transform(.47f, .12f, centerZ - 1.20f, .47f, .10f, .27f))
        draw(requireNotNull(cube), color("#A66D38"), Transform(.47f, .26f, centerZ - 1.02f, .38f, .07f, .18f))
        draw(requireNotNull(cube), color("#86522F"), Transform(-1.58f, .34f, centerZ - .64f, .54f, .075f, .18f, rotationY = 12f))
        for (side in listOf(-1f, 1f)) {
            draw(
                requireNotNull(cylinder),
                color("#67442E"),
                Transform(-1.58f + side * .39f, .20f, centerZ - .64f, .055f, .20f, .055f),
            )
        }
        repeat(7) { index ->
            val row = index / 3
            val column = index % 3
            draw(
                requireNotNull(cylinder),
                color(if (index % 2 == 0) "#765037" else "#8A5B37"),
                Transform(
                    -1.63f + column * .17f,
                    .12f + row * .16f,
                    centerZ + .76f,
                    .070f,
                    .27f,
                    .070f,
                    rotationX = 90f,
                ),
                rimStrength = .08f,
            )
        }
        repeat(4) { index ->
            val x = -2.15f + index * 1.45f
            draw(requireNotNull(cylinder), color("#7B5638"), Transform(x, .37f, centerZ + 1.18f, .055f, .37f, .055f))
        }
        repeat(2) { rail ->
            draw(
                requireNotNull(cube),
                color("#936640"),
                Transform(.02f, .25f + rail * .35f, centerZ + 1.18f, 2.24f, .045f, .055f),
            )
        }

        val ridgeBirdT = frame.storyTime % 15f
        val ridgeArrivalEnd = 2.15f
        val ridgeDepartureStart = 11.15f
        val arrivalProgress = smoothStep(ridgeBirdT / ridgeArrivalEnd)
        val departureProgress = smoothStep(
            (ridgeBirdT - ridgeDepartureStart) / (15f - ridgeDepartureStart),
        )
        val arrivalOffset = 1f - arrivalProgress
        val flightStrength = max(arrivalOffset, departureProgress)
        val visitScale = min(
            smoothStep(ridgeBirdT / .65f),
            smoothStep((15f - ridgeBirdT) / .65f),
        )
        if (visitScale > .001f) {
            val perchX = -.25f
            val perchY = 2.64f
            val perchZ = centerZ - .10f
            val heading = when {
                ridgeBirdT < ridgeArrivalEnd -> 59f + (115f - 59f) * arrivalProgress
                ridgeBirdT > ridgeDepartureStart -> 115f + (124f - 115f) * departureProgress
                else -> 115f
            }
            val peck = if (ridgeBirdT in 5.0f..8.0f) {
                abs(sin(ridgeBirdT * 8f)) * 23f
            } else {
                0f
            }
            drawTinyBird(
                x = perchX - arrivalOffset * 2.30f + departureProgress * 2.80f,
                y = perchY + arrivalOffset * 2.10f + departureProgress * 2.40f,
                z = perchZ - arrivalOffset * 1.40f - departureProgress * 1.60f,
                heading = heading,
                flap = 4f + sin(frame.storyTime * 17f) * 34f * flightStrength,
                bodyColor = "#596775",
                pitch = peck,
                scale = visitScale,
                flightAmount = flightStrength,
            )
        }

        repeat(3) { index ->
            val phase = (frame.storyTime * .18f + index * .31f) % 1f
            draw(
                requireNotNull(lowSphere),
                color("#E9EEF0", .45f * (1f - phase)),
                Transform(
                    .66f + sin(frame.storyTime * .4f + index) * .16f,
                    3.02f + phase * 1.2f,
                    centerZ + .25f,
                    .18f + phase * .18f,
                    .12f + phase * .15f,
                    .18f + phase * .18f,
                ),
            )
        }

        val smokeElapsed = eventSeconds(smokeRingsStartedMs)
        if (smokeElapsed in 0f..3.4f) {
            repeat(3) { index ->
                val local = smokeElapsed - index * .34f
                if (local < 0f) return@repeat
                val progress = (local / 2.25f).coerceIn(0f, 1f)
                draw(
                    requireNotNull(ring),
                    color("#EEF2F0", .68f * (1f - progress)),
                    Transform(
                        .66f + sin(local * 1.8f) * .12f,
                        2.96f + progress * 1.55f,
                        centerZ + .25f,
                        .16f + progress * .30f,
                        .16f + progress * .30f,
                        .16f + progress * .30f,
                    ),
                    rimStrength = .02f,
                )
            }
            if (smokeElapsed > 3.2f) smokeRingsStartedMs = 0L
        }
        if (izbaFlashStartedMs > 0L && izbaFlashElapsed > 1.35f) {
            izbaFlashStartedMs = 0L
        }
    }

    private fun drawPondAndGrandpa() {
        val pondX = -2.78f
        val pondZ = 4.43f
        draw(
            requireNotNull(disc),
            color("#557D45"),
            Transform(pondX, .065f, pondZ, 1.42f, .025f, .98f),
        )
        draw(
            requireNotNull(disc),
            color("#72B8C8", .92f),
            Transform(pondX, .10f, pondZ, 1.16f, .018f, .76f),
        )
        draw(
            requireNotNull(disc),
            color("#D8C382", .72f),
            Transform(pondX + .84f, .085f, pondZ - .08f, .42f, .012f, .55f, rotationY = -18f),
            rimStrength = .04f,
        )

        repeat(7) { index ->
            val x = pondX - .84f + index * .28f
            val arch = sin(index / 6f * PI.toFloat()) * .12f
            draw(
                requireNotNull(cube),
                color(if (index % 2 == 0) "#8B653F" else "#9A7148"),
                Transform(x, .19f + arch, pondZ, .115f, .052f, .88f, rotationZ = if (index % 2 == 0) 2f else -2f),
            )
        }
        for (side in listOf(-1f, 1f)) {
            repeat(3) { index ->
                val x = pondX + side * (.83f - index * .30f)
                draw(
                    requireNotNull(cylinder),
                    color("#755138"),
                    Transform(x, .53f, pondZ + .72f, .035f, .32f, .035f),
                )
            }
            draw(
                requireNotNull(cube),
                color("#845B3A"),
                Transform(
                    pondX + side * .52f,
                    .72f,
                    pondZ + .72f,
                    .58f,
                    .035f,
                    .035f,
                    rotationZ = side * 4f,
                ),
            )
        }

        repeat(10) { index ->
            val side = if (index % 2 == 0) -1f else 1f
            val x = pondX + side * (1.07f + (index / 2) * .07f)
            val z = pondZ + (index - 4.5f) * .16f
            draw(requireNotNull(cylinder), color("#527E43"), Transform(x, .31f, z, .025f, .27f, .025f, rotationZ = side * 7f))
            if (index % 2 == 0) {
                draw(requireNotNull(cone), color("#8B6B3C"), Transform(x, .63f, z, .06f, .16f, .06f))
            }
        }

        val ripplePhase = (frame.storyTime * .42f) % 1f
        repeat(2) { index ->
            val phase = (ripplePhase + index * .46f) % 1f
            draw(
                requireNotNull(ring),
                color("#D8F4F5", .24f * (1f - phase)),
                Transform(
                    pondX + .25f,
                    .132f,
                    pondZ + .18f,
                    .18f + phase * .46f,
                    .010f,
                    (.18f + phase * .46f) * .72f,
                ),
                rimStrength = 0f,
            )
        }

        val lilyPads = listOf(
            PondPoint(-.43f, -.24f, .22f),
            PondPoint(.20f, .35f, .17f),
            PondPoint(.56f, -.18f, .14f),
        )
        lilyPads.forEachIndexed { index, point ->
            draw(
                requireNotNull(disc),
                color(if (index == 0) "#4E8D58" else "#5E9F60"),
                Transform(
                    pondX + point.x,
                    .143f,
                    pondZ + point.z,
                    point.size,
                    .012f,
                    point.size * .72f,
                    rotationY = index * 31f,
                ),
                rimStrength = .06f,
            )
        }
        draw(
            requireNotNull(lowSphere),
            color("#F7C2D2"),
            Transform(pondX + .20f, .23f, pondZ + .35f, .07f, .045f, .07f),
        )

        val willowX = pondX + 1.60f
        val willowZ = pondZ + .62f
        val willowElapsed = eventSeconds(willowSwayStartedMs)
        if (willowSwayStartedMs > 0L && willowElapsed > 2.8f) {
            willowSwayStartedMs = 0L
        }
        val willowSway = if (willowElapsed in 0f..2.8f) {
            sin(willowElapsed * 9f) * (1f - willowElapsed / 2.8f) * 12f
        } else {
            sin(frame.storyTime * .55f) * 1.7f
        }
        val willowRadians = Math.toRadians(willowSway.toDouble())
        val willowHalfHeight = .84f
        val willowCenterX = willowX - sin(willowRadians).toFloat() * willowHalfHeight
        val willowCenterY = cos(willowRadians).toFloat() * willowHalfHeight
        val willowTopDx = -sin(willowRadians).toFloat() * willowHalfHeight * 2f
        val willowTopDy = cos(willowRadians).toFloat() * willowHalfHeight * 2f -
            willowHalfHeight * 2f
        drawShadow(willowX, willowZ, .68f, .46f)
        draw(
            requireNotNull(cylinder),
            color("#71543A"),
            Transform(
                willowCenterX,
                willowCenterY,
                willowZ,
                .16f,
                willowHalfHeight,
                .16f,
                rotationZ = willowSway,
            ),
            rimStrength = .12f,
        )
        val willowCanopy = listOf(
            Triple(0f, 1.62f, .72f),
            Triple(-.48f, 1.50f, .58f),
            Triple(.48f, 1.52f, .60f),
            Triple(-.22f, 1.92f, .54f),
            Triple(.28f, 1.91f, .52f),
        )
        willowCanopy.forEachIndexed { index, (offsetX, y, size) ->
            val trunkCarry = (y / (willowHalfHeight * 2f)).coerceIn(.68f, 1.12f)
            draw(
                requireNotNull(lowSphere),
                color(if (index % 2 == 0) "#70A45B" else "#78AD62"),
                Transform(
                    willowX + offsetX + willowTopDx * trunkCarry,
                    y + willowTopDy * trunkCarry,
                    willowZ + (index % 2) * .10f,
                    size,
                    size * .55f,
                    size * .78f,
                ),
                rimStrength = .12f,
            )
        }
        repeat(10) { index ->
            val angle = index / 10f * PI.toFloat() * 2f
            val length = .34f + (index % 3) * .11f
            draw(
                requireNotNull(cube),
                color("#598D4D", .88f),
                Transform(
                    willowX + cos(angle) * .55f + willowTopDx * .78f,
                    1.28f - (index % 2) * .09f + willowTopDy * .78f,
                    willowZ + sin(angle) * .48f,
                    .016f,
                    length,
                    .016f,
                    rotationZ = sin(angle) * 10f,
                ),
                rimStrength = .04f,
            )
        }
        drawWillowMagpies(willowX + willowTopDx, willowZ, willowTopDy)

        val grandpaX = -4.04f
        val grandpaZ = 4.18f
        val heading = facingCenter(grandpaX, grandpaZ)
        draw(
            requireNotNull(cylinder),
            color("#664A34"),
            Transform(grandpaX, .20f, grandpaZ - .08f, .24f, .20f, .24f),
            rimStrength = .08f,
        )
        drawShadow(grandpaX, grandpaZ, .48f, .34f)
        drawActorPart(requireNotNull(lowSphere), "#557AA4", grandpaX, grandpaZ, 0f, .53f, 0f, .36f, .50f, .30f, heading)
        drawActorPart(requireNotNull(lowSphere), "#E9BE92", grandpaX, grandpaZ, 0f, 1.12f, .03f, .27f, .30f, .25f, heading)
        drawActorPart(requireNotNull(lowSphere), "#E7E2D8", grandpaX, grandpaZ, 0f, .98f, .22f, .25f, .20f, .17f, heading)
        drawActorPart(requireNotNull(lowSphere), "#D8D5CE", grandpaX, grandpaZ, 0f, 1.32f, -.02f, .29f, .16f, .25f, heading)
        drawActorPart(requireNotNull(lowSphere), "#332A24", grandpaX, grandpaZ, -.09f, 1.17f, .245f, .028f, .035f, .025f, heading)
        drawActorPart(requireNotNull(lowSphere), "#332A24", grandpaX, grandpaZ, .09f, 1.17f, .245f, .028f, .035f, .025f, heading)
        drawActorPart(
            requireNotNull(cylinder),
            "#4D7198",
            grandpaX,
            grandpaZ,
            -.25f,
            .72f,
            .14f,
            .075f,
            .25f,
            .075f,
            heading,
            rotationZ = -12f,
        )
        drawActorPart(
            requireNotNull(cylinder),
            "#4D7198",
            grandpaX,
            grandpaZ,
            .18f,
            .75f,
            .20f,
            .075f,
            .25f,
            .075f,
            heading,
            rotationZ = 28f,
        )
        drawActorPart(requireNotNull(lowSphere), "#E9BE92", grandpaX, grandpaZ, -.31f, .51f, .19f, .075f, .075f, .070f, heading)
        drawActorPart(requireNotNull(lowSphere), "#E9BE92", grandpaX, grandpaZ, -.02f, .58f, .27f, .075f, .075f, .070f, heading)
        for (side in listOf(-1f, 1f)) {
            drawActorPart(
                requireNotNull(lowSphere),
                "#403830",
                grandpaX,
                grandpaZ,
                side * .18f,
                .16f,
                .22f,
                .14f,
                .10f,
                .22f,
                heading,
            )
        }

        val fishingElapsed = eventSeconds(fishingStartedMs)
        val rodKick = if (fishingElapsed in 0f..3.4f) {
            -sin((fishingElapsed / 3.4f).coerceIn(0f, 1f) * PI.toFloat()) * 23f
        } else {
            sin(frame.storyTime * .70f) * 1.4f
        }
        val rodAngle = -38f + rodKick
        drawActorPart(
            requireNotNull(cube),
            "#76512F",
            grandpaX,
            grandpaZ,
            .30f,
            1.13f,
            .28f,
            .025f,
            .58f,
            .025f,
            heading,
            rotationZ = rodAngle,
        )
        val floatBob = sin(frame.storyTime * 2.5f) * .025f
        val bobberX = pondX + .22f
        val bobberZ = pondZ + .18f
        val rodAngleRadians = Math.toRadians(rodAngle.toDouble())
        val rodTipLocalX = .30f - sin(rodAngleRadians).toFloat() * .58f
        val rodTipY = 1.13f + cos(rodAngleRadians).toFloat() * .58f
        val headingRadians = Math.toRadians(heading.toDouble())
        val rodTip = WorldPoint3(
            x = grandpaX + rodTipLocalX * cos(headingRadians).toFloat() +
                .28f * sin(headingRadians).toFloat(),
            y = rodTipY,
            z = grandpaZ - rodTipLocalX * sin(headingRadians).toFloat() +
                .28f * cos(headingRadians).toFloat(),
        )
        val bobberTop = WorldPoint3(bobberX, .27f + floatBob, bobberZ)
        val lineSag = WorldPoint3(
            x = rodTip.x + (bobberTop.x - rodTip.x) * .55f,
            y = ((rodTip.y + bobberTop.y) * .5f - .15f).coerceAtLeast(.34f),
            z = rodTip.z + (bobberTop.z - rodTip.z) * .55f,
        )
        drawLineSegment(rodTip, lineSag, "#E9E5DA", .78f, .008f)
        drawLineSegment(lineSag, bobberTop, "#E9E5DA", .78f, .008f)
        draw(requireNotNull(lowSphere), color("#F5F2E8"), Transform(bobberX, .18f + floatBob, bobberZ, .045f, .055f, .045f))
        draw(requireNotNull(lowSphere), color("#D94D43"), Transform(bobberX, .23f + floatBob, bobberZ, .046f, .045f, .046f))

        repeat(accumulatedBoots.coerceAtMost(3)) { index ->
            draw(
                requireNotNull(cube),
                color("#4A4038"),
                Transform(
                    grandpaX - .42f - index * .14f,
                    .12f,
                    grandpaZ - .22f + index * .10f,
                    .10f,
                    .07f,
                    .055f,
                    rotationY = index * 19f,
                    rotationZ = -8f + index * 7f,
                ),
                rimStrength = .05f,
            )
        }

        if (fishingElapsed in .42f..3.25f) {
            val up = ((fishingElapsed - .42f) / .88f).coerceIn(0f, 1f)
            val down = ((fishingElapsed - 2.30f) / .85f).coerceIn(0f, 1f)
            val travel = up * (1f - down)
            val handX = grandpaX + .30f
            val handZ = grandpaZ + .10f
            val fishX = bobberX + (handX - bobberX) * travel
            val fishZ = bobberZ + (handZ - bobberZ) * travel
            val fishY = .20f + travel * .40f +
                sin(travel * PI.toFloat()) * 1.36f
            val fishColor = when (fishingKind) {
                FishingKind.SILVER -> "#B9CAD2"
                FishingKind.GOLD -> "#FFD15A"
                FishingKind.BOOT -> "#4A4038"
            }
            val spin = fishingElapsed *
                if (fishingKind == FishingKind.GOLD) 230f else 410f
            draw(
                requireNotNull(lowSphere),
                color(fishColor),
                Transform(
                    fishX,
                    fishY,
                    fishZ,
                    if (fishingKind == FishingKind.BOOT) .10f else .16f,
                    if (fishingKind == FishingKind.BOOT) .19f else .08f,
                    .065f,
                    rotationZ = spin,
                ),
                rimStrength = if (fishingKind == FishingKind.GOLD) .65f else .18f,
            )
            if (fishingKind != FishingKind.BOOT) {
                val spinRadians = Math.toRadians(spin.toDouble())
                val tailOffsetX = cos(spinRadians).toFloat() * -.15f
                val tailOffsetY = sin(spinRadians).toFloat() * -.15f
                draw(
                    requireNotNull(cone),
                    color(fishColor),
                    Transform(
                        fishX + tailOffsetX,
                        fishY + tailOffsetY,
                        fishZ,
                        .075f,
                        .10f,
                        .055f,
                        rotationZ = 90f + spin,
                    ),
                )
            }
            if (fishingKind == FishingKind.GOLD) {
                repeat(8) { index ->
                    val sparkleAngle = index * PI.toFloat() * .25f + fishingElapsed * 2.2f
                    draw(
                        requireNotNull(lowSphere),
                        color("#FFF0A0", .82f),
                        Transform(
                            fishX + cos(sparkleAngle) * .24f,
                            fishY + sin(sparkleAngle) * .20f,
                            fishZ + sin(sparkleAngle * .7f) * .08f,
                            .028f,
                            .028f,
                            .028f,
                        ),
                        rimStrength = .20f,
                    )
                }
            }
        }
        if (fishingStartedMs > 0L && fishingElapsed > 3.35f) fishingStartedMs = 0L

        val frogElapsed = eventSeconds(frogJumpStartedMs)
        val frogJump = if (frogElapsed in 0f..1.35f) sin(frogElapsed / 1.35f * PI.toFloat()) * .48f else 0f
        val frogX = pondX - .43f + (frogJump / .48f) * .32f
        val frogZ = pondZ - .24f
        draw(requireNotNull(lowSphere), color("#4E8A45"), Transform(frogX, .23f + frogJump, frogZ, .095f, .065f, .085f))
        draw(requireNotNull(lowSphere), color("#84B866"), Transform(frogX, .29f + frogJump, frogZ + .05f, .067f, .057f, .060f))
        for (side in listOf(-.032f, .032f)) {
            draw(requireNotNull(lowSphere), color("#F4F0DF"), Transform(frogX + side, .35f + frogJump, frogZ + .075f, .022f, .026f, .019f))
            draw(requireNotNull(lowSphere), color("#28271F"), Transform(frogX + side, .355f + frogJump, frogZ + .092f, .009f, .011f, .008f))
        }
        if (frogJumpStartedMs > 0L && frogElapsed > 1.35f) frogJumpStartedMs = 0L

        val splashCycle = frame.storyTime % 27f
        if (splashCycle in 0f..1.1f) {
            val jump = sin(splashCycle / 1.1f * PI.toFloat())
            draw(
                requireNotNull(lowSphere),
                color("#A7C9D4"),
                Transform(pondX + .48f, .16f + jump * .30f, pondZ - .05f, .085f, .035f, .035f, rotationZ = splashCycle * 240f),
            )
        }
    }

    private fun drawWillowMagpies(
        willowX: Float,
        willowZ: Float,
        willowTopDy: Float,
    ) {
        val elapsed = eventSeconds(magpiesStartedMs)
        if (elapsed < 0f) return
        if (elapsed > 18.4f) {
            magpiesStartedMs = 0L
            return
        }
        val returning = elapsed >= 15f
        if (elapsed in 3.2f..15f) return
        val progress = if (returning) {
            1f - ((elapsed - 15f) / 3.2f).coerceIn(0f, 1f)
        } else {
            (elapsed / 3.2f).coerceIn(0f, 1f)
        }
        repeat(3) { index ->
            val startX = willowX + (index - 1) * .24f
            val startY = 1.95f + willowTopDy + index * .08f
            val startZ = willowZ + (index % 2) * .18f
            val direction = if (index == 1) -1f else 1f
            val outward = 5.8f + index * .90f
            val depth = 4.8f + index * .60f
            val x = startX + direction * progress * outward +
                sin(progress * PI.toFloat() * 3f + index) * .36f
            val y = startY + progress * (6.4f + index * .50f) +
                sin(progress * PI.toFloat()) * .34f
            val z = startZ - progress * depth +
                sin(progress * PI.toFloat() * 2f + index) * .22f
            val outboundHeading = Math.toDegrees(
                kotlin.math.atan2(
                    (direction * outward).toDouble(),
                    (-depth).toDouble(),
                ),
            ).toFloat()
            val birdHeading = outboundHeading + if (returning) 180f else 0f
            drawTinyBird(
                x = x,
                y = y,
                z = z,
                heading = birdHeading,
                flap = sin(elapsed * 17f + index) * 38f,
                bodyColor = "#252A2E",
                flightAmount = 1f,
            )
            drawActorPart(
                requireNotNull(lowSphere),
                "#F4F3EA",
                x,
                z,
                0f,
                y - .015f,
                .055f,
                .035f,
                .027f,
                .025f,
                birdHeading,
            )
        }
    }

    private fun drawZoneAmbience() {
        drawHareButterflies()
        drawWolfAmbience()
        drawBearAmbience()
        drawFoxAmbience()
        drawHedgehogEggs()
        drawOwlEgg()
    }

    private fun drawHareButterflies() {
        repeat(3) { index ->
            val center = radial(61f + index * 10f, 5.62f + index * .25f)
            val orbit = frame.storyTime * (.72f + index * .11f) + index * 2.1f
            val x = center.first + cos(orbit) * (.24f + index * .04f)
            val z = center.second + sin(orbit) * (.19f + index * .03f)
            val y = .62f + sin(orbit * 1.7f) * .18f + index * .08f
            val flap = .035f + abs(sin(frame.storyTime * 9f + index)) * .045f
            val wingColor = when (index) {
                0 -> "#F3AFCF"
                1 -> "#F5DA67"
                else -> "#B8DDF2"
            }
            draw(requireNotNull(cylinder), color("#5D5549"), Transform(x, y, z, .012f, .055f, .012f, rotationZ = 90f), rimStrength = .02f)
            draw(requireNotNull(lowSphere), color(wingColor, .90f), Transform(x - .045f, y, z, flap, .018f, .060f, rotationZ = -24f), rimStrength = .04f)
            draw(requireNotNull(lowSphere), color(wingColor, .90f), Transform(x + .045f, y, z, flap, .018f, .060f, rotationZ = 24f), rimStrength = .04f)
        }
    }

    private fun drawWolfAmbience() {
        repeat(3) { index ->
            val (baseX, baseZ) = radial(132f + index * 12f, 5.45f + index * .42f)
            val drift = sin(frame.storyTime * .25f + index * 2.2f) * .32f
            draw(
                requireNotNull(lowSphere),
                color("#D8E2E5", .11f),
                Transform(
                    baseX + drift,
                    .19f + index * .025f,
                    baseZ + cos(frame.storyTime * .20f + index) * .15f,
                    .78f,
                    .105f,
                    .42f,
                    rotationY = 144f,
                ),
                rimStrength = 0f,
            )
        }
        val crowCycle = frame.storyTime % 17f
        if (crowCycle in 2f..12f) {
            val fly = ((crowCycle - 9f) / 3f).coerceIn(0f, 1f)
            val (perchX, perchZ) = radial(126f, 7.05f)
            drawTinyBird(
                x = perchX + fly * 2.2f,
                y = 2.15f + fly * 1.4f,
                z = perchZ - fly * 1.5f,
                heading = 124f,
                flap = 3f + sin(crowCycle * 15f) * 35f * fly,
                bodyColor = "#2D3338",
                flightAmount = fly,
            )
        }
    }

    private fun drawBearAmbience() {
        val (logX, logZ) = radial(205f, 5.55f)
        draw(
            requireNotNull(cylinder),
            color("#6B4C33"),
            Transform(logX, .20f, logZ, .16f, .48f, .16f, rotationX = 90f, rotationY = 22f),
            rimStrength = .10f,
        )
        draw(
            requireNotNull(lowSphere),
            color("#E8C04A"),
            Transform(logX + .15f, .32f, logZ + .04f, .18f, .055f, .12f, rotationY = 22f),
            rimStrength = .14f,
        )
        repeat(5) { index ->
            val orbit = frame.storyTime * (1.6f + index * .08f) + index * 1.26f
            draw(
                requireNotNull(lowSphere),
                color("#F5D34F"),
                Transform(
                    logX + cos(orbit) * (.24f + (index % 2) * .08f),
                    .48f + sin(orbit * 1.7f) * .12f,
                    logZ + sin(orbit) * (.18f + (index % 2) * .05f),
                    .025f,
                    .018f,
                    .025f,
                ),
                rimStrength = .18f,
            )
        }
        repeat(7) { index ->
            val fall = (frame.storyTime * .18f + index * .14f) % 1f
            val (treeX, treeZ) = radial(232f, 6.8f)
            draw(
                requireNotNull(lowSphere),
                color(if (index % 2 == 0) "#D3A84E" else "#BA7D3E", .82f),
                Transform(
                    treeX + sin(fall * 7f + index) * .55f,
                    2.3f - fall * 2.0f,
                    treeZ + cos(fall * 5f + index) * .34f,
                    .045f,
                    .018f,
                    .075f,
                    rotationY = fall * 240f,
                ),
                rimStrength = .04f,
            )
        }
    }

    private fun drawFoxAmbience() {
        val cycle = frame.storyTime % 13f
        if (cycle < 8f) {
            val progress = cycle / 8f
            val (startX, startZ) = radial(282f, 5.45f)
            draw(
                requireNotNull(lowSphere),
                color("#FFF2DE", .88f),
                Transform(
                    startX + progress * 1.3f,
                    .50f + sin(progress * PI.toFloat() * 3f) * .18f,
                    startZ + sin(progress * PI.toFloat()) * .55f,
                    .035f,
                    .012f,
                    .11f,
                    rotationY = progress * 290f,
                    rotationZ = 18f,
                ),
                rimStrength = .05f,
            )
        }
    }

    private fun startHedgehogJourney(mushroomIndex: Int, now: Long): Boolean {
        if (mushroomReserved[mushroomIndex] || hedgehogJourneys.size >= 8) return false
        mushroomReserved[mushroomIndex] = true
        hedgehogJourneys += HedgehogJourney(
            mushroomIndex = mushroomIndex,
            seed = mushroomIndex * 173 + now.toInt(),
            startedAtMs = now,
        )
        return true
    }

    private fun updateHedgehogJourneys(now: Long) {
        hedgehogJourneys.forEach { journey ->
            val elapsed = now - journey.startedAtMs
            if (elapsed >= 5_600L && mushroomTakenAtMs[journey.mushroomIndex] == 0L) {
                mushroomTakenAtMs[journey.mushroomIndex] = journey.startedAtMs + 5_600L
            }
        }
        hedgehogJourneys.removeAll { now - it.startedAtMs > 9_700L }
    }

    private fun drawHedgehogEggs() {
        hedgehogJourneys.forEach(::drawHedgehogJourney)
    }

    private fun drawHedgehogJourney(journey: HedgehogJourney) {
        val elapsed = (
            SystemClock.uptimeMillis() - journey.startedAtMs
            ).coerceAtLeast(0L) / 1_000f
        if (elapsed !in 0f..9.7f) return
        val targetPoint = mushroomSpots[journey.mushroomIndex]
        val target = radial(targetPoint.angle, targetPoint.radius)
        val startX = .85f
        val startZ = .62f
        val travel = when {
            elapsed < 4f -> elapsed / 4f
            elapsed < 5.6f -> 1f
            else -> (1f - (elapsed - 5.6f) / 4f).coerceIn(0f, 1f)
        }
        val eased = smoothStep(travel)
        val sideDirection = if (journey.seed and 1 == 0) 1f else -1f
        val side = sin(eased * PI.toFloat()) * .58f * sideDirection
        val dx = target.first - startX
        val dz = target.second - startZ
        val length = sqrt(dx * dx + dz * dz).coerceAtLeast(.01f)
        var x = startX + dx * eased - dz / length * side
        var z = startZ + dz * eased + dx / length * side
        val sniffing = elapsed in 4f..5.6f
        if (sniffing) {
            val sniff = sin((elapsed - 4f) * 9f) * .045f
            x += dx / length * sniff
            z += dz / length * sniff
        }
        val y = .27f + abs(sin(elapsed * 3f * PI.toFloat())) * .028f
        val curveDerivative =
            cos(eased * PI.toFloat()) * .58f * PI.toFloat() * sideDirection
        val tangentX = dx - dz / length * curveDerivative
        val tangentZ = dz + dx / length * curveDerivative
        val tangentHeading = Math.toDegrees(
            kotlin.math.atan2(tangentX, tangentZ).toDouble(),
        ).toFloat()
        val returning = elapsed >= 5.6f
        val heading = tangentHeading + if (returning) 180f else 0f
        val waddle = sin(elapsed * 3f * PI.toFloat() * 2f) * 6f

        drawShadow(x, z, .25f, .17f)
        drawActorPart(
            requireNotNull(lowSphere),
            "#5C4A3D",
            x,
            z,
            0f,
            y,
            0f,
            .23f,
            .18f,
            .29f,
            heading,
            rotationZ = waddle,
        )
        drawActorPart(
            requireNotNull(cone),
            "#96785D",
            x,
            z,
            0f,
            y + .01f,
            .30f,
            .13f,
            .13f,
            .22f,
            heading,
            rotationX = 90f,
        )
        drawActorPart(
            requireNotNull(lowSphere),
            "#27231F",
            x,
            z,
            0f,
            y + .02f + if (sniffing) sin(elapsed * 10f) * .018f else 0f,
            .52f,
            .025f,
            .025f,
            .025f,
            heading,
        )
        repeat(12) { index ->
            val row = index / 4
            val column = index % 4
            drawActorPart(
                requireNotNull(cone),
                "#40372F",
                x,
                z,
                (column - 1.5f) * .10f,
                y + .13f + row * .04f,
                -.12f + row * .08f,
                .035f,
                .075f,
                .035f,
                heading,
                rotationZ = (column - 1.5f) * 10f + waddle * .3f,
            )
        }
        if (returning) {
            val carriedScale = .88f + pseudo(journey.mushroomIndex * 31 + 6) * .30f
            drawActorPart(
                requireNotNull(cylinder),
                "#F2EDE3",
                x,
                z,
                0f,
                y + .36f,
                -.04f,
                .030f * carriedScale,
                .075f * carriedScale,
                .030f * carriedScale,
                heading,
            )
            drawActorPart(
                requireNotNull(lowSphere),
                if (journey.mushroomIndex % 4 == 0) "#D85D48" else "#C94E3E",
                x,
                z,
                0f,
                y + .45f,
                -.04f,
                .090f * carriedScale,
                .050f * carriedScale,
                .090f * carriedScale,
                heading,
            )
        }
    }

    private fun drawOwlEgg() {
        val elapsed = eventSeconds(owlStartedMs)
        if (elapsed < 0f) return
        val activeTree = sprucePoints.getOrElse(owlActiveTreeIndex) { owlTree }
        val (x, z) = radial(activeTree.angle, activeTree.radius)
        val pop = (elapsed / .34f).coerceIn(0f, 1f)
        val flapElapsed = eventSeconds(owlFlapStartedMs)
        val duck = if (flapElapsed >= 0f) {
            ((flapElapsed - 1.05f) / .58f).coerceIn(0f, 1f)
        } else {
            0f
        }
        if (flapElapsed > 1.72f) {
            owlStartedMs = 0L
            owlFlapStartedMs = 0L
            return
        }
        val visibleScale = pop * (1f - duck)
        val headYaw = sin(elapsed * 2.4f) * 48f
        val headYawRadians = Math.toRadians(headYaw.toDouble())
        val headYawCosine = cos(headYawRadians).toFloat()
        val headYawSine = sin(headYawRadians).toFloat()
        val flap = if (flapElapsed in 0f..1.15f) sin(flapElapsed * 19f) * 42f else 7f
        val y = 2.35f + visibleScale * .25f
        draw(requireNotNull(lowSphere), color("#806A52"), Transform(x, y, z, .17f * visibleScale, .22f * visibleScale, .15f * visibleScale), rimStrength = .20f)
        draw(requireNotNull(lowSphere), color("#9A8262"), Transform(x, y + .20f * visibleScale, z + .03f, .14f * visibleScale, .14f * visibleScale, .13f * visibleScale, rotationY = headYaw), rimStrength = .20f)
        for (side in listOf(-1f, 1f)) {
            val eyeLocalX = side * .065f * visibleScale
            val eyeForward = .13f * visibleScale
            val eyeX = x + eyeLocalX * headYawCosine + eyeForward * headYawSine
            val eyeZ = z - eyeLocalX * headYawSine + eyeForward * headYawCosine
            val pupilForward = .155f * visibleScale
            val pupilX = x + eyeLocalX * headYawCosine + pupilForward * headYawSine
            val pupilZ = z - eyeLocalX * headYawSine + pupilForward * headYawCosine
            draw(requireNotNull(lowSphere), color("#F8EECF"), Transform(eyeX, y + .23f * visibleScale, eyeZ, .040f * visibleScale, .047f * visibleScale, .025f * visibleScale, rotationY = headYaw), rimStrength = .06f)
            draw(requireNotNull(lowSphere), color("#28251F"), Transform(pupilX, y + .23f * visibleScale, pupilZ, .018f * visibleScale, .021f * visibleScale, .012f * visibleScale, rotationY = headYaw), rimStrength = .04f)
            draw(requireNotNull(lowSphere), color("#715B45"), Transform(x + side * .15f * visibleScale, y + .05f, z, .07f * visibleScale, .18f * visibleScale, .045f * visibleScale, rotationZ = side * flap), rimStrength = .16f)
        }
        draw(
            requireNotNull(cone),
            color("#D8A641"),
            Transform(
                x + headYawSine * .16f * visibleScale,
                y + .17f * visibleScale,
                z + headYawCosine * .16f * visibleScale,
                .035f * visibleScale,
                .055f * visibleScale,
                .035f * visibleScale,
                rotationX = 90f,
                rotationY = headYaw,
            ),
            rimStrength = .08f,
        )
    }

    private fun drawAmbientTapReaction() {
        val elapsed = eventSeconds(ambientReactionStartedMs)
        if (ambientReaction == AmbientReaction.NONE || elapsed !in 0f..2.2f) {
            if (ambientReactionStartedMs > 0L) {
                ambientReactionStartedMs = 0L
                ambientReaction = AmbientReaction.NONE
            }
            return
        }

        val progress = (elapsed / 2.2f).coerceIn(0f, 1f)
        val envelope = sin(progress * PI.toFloat()).coerceAtLeast(0f)
        val base = ambientReactionPoint
        val palette = when (ambientReaction) {
            AmbientReaction.TREE -> listOf("#7FB65B", "#A7C66A", "#D5A34B")
            AmbientReaction.MEADOW -> listOf("#F07F87", "#FFF1A8", "#A7D7F4")
            AmbientReaction.PATH -> listOf("#FFF2B8", "#E7C98F", "#FFFFFF")
            AmbientReaction.BUTTERFLIES -> listOf("#F3AFCF", "#F5DA67", "#B8DDF2")
            AmbientReaction.HIVE -> listOf("#F5D34F", "#FFF1A8", "#B67A2F")
            AmbientReaction.NONE -> emptyList()
        }
        if (palette.isEmpty()) return

        if (ambientReaction != AmbientReaction.TREE) {
            draw(
                requireNotNull(ring),
                color(palette[0], envelope * .52f),
                Transform(
                    base.x,
                    .095f,
                    base.z,
                    .16f + progress * .62f,
                    .16f + progress * .62f,
                    .16f + progress * .62f,
                ),
                rimStrength = .02f,
            )
        }

        repeat(12) { index ->
            val phase = progress * 1.45f + index / 12f
            val angle = index * 137.5f + elapsed * when (ambientReaction) {
                AmbientReaction.BUTTERFLIES -> 150f
                AmbientReaction.HIVE -> 210f
                else -> 76f
            }
            val radians = Math.toRadians(angle.toDouble())
            val radius = when (ambientReaction) {
                AmbientReaction.TREE -> .18f + progress * .78f
                AmbientReaction.HIVE -> .18f + (index % 3) * .12f
                else -> .10f + progress * (.42f + (index % 3) * .10f)
            }
            val particleY = when (ambientReaction) {
                AmbientReaction.TREE ->
                    base.y + .58f - progress * .88f + sin(phase * 8f) * .12f
                AmbientReaction.HIVE ->
                    base.y + .20f + sin(phase * 10f) * .25f + progress * .18f
                else ->
                    base.y + .08f +
                        sin(progress * PI.toFloat()) * (.36f + index % 3 * .08f)
            }
            val width = if (ambientReaction == AmbientReaction.BUTTERFLIES) {
                .040f + abs(sin(elapsed * 12f + index)) * .035f
            } else {
                .032f + (index % 3) * .009f
            }
            draw(
                requireNotNull(lowSphere),
                color(palette[index % palette.size], envelope * .86f),
                Transform(
                    base.x + cos(radians).toFloat() * radius,
                    particleY,
                    base.z + sin(radians).toFloat() * radius,
                    width,
                    if (ambientReaction == AmbientReaction.TREE) .018f else width * .68f,
                    width * 1.35f,
                    rotationY = angle,
                    rotationZ = progress * 260f + index * 23f,
                ),
                rimStrength = .12f,
            )
        }
    }

    private fun drawClouds() {
        // Once the orbit rises through the cloud layer, drawing nearby cloud
        // lobes would fill the camera. Keep the overhead view unobstructed.
        if (eyeY >= 6.95f) return
        val drizzleElapsed = eventSeconds(drizzleStartedMs)
        repeat(5) { index ->
            val cloud = cloudPosition(index)
            val raining = index == drizzleCloud && drizzleElapsed in 0f..15f
            val cloudShade = if (raining) "#A9B7C2" else "#EDF6F7"
            val edgeShade = if (raining) "#C2CDD3" else "#FFFFFF"
            draw(requireNotNull(sphere), color(cloudShade, .88f), Transform(cloud.x, cloud.y, cloud.z, 1.18f, .48f, .58f), rotateWithScene = false, rimStrength = .08f)
            draw(requireNotNull(sphere), color(edgeShade, .92f), Transform(cloud.x + .72f, cloud.y - .04f, cloud.z, .82f, .37f, .46f), rotateWithScene = false, rimStrength = .08f)
            draw(requireNotNull(sphere), color(edgeShade, .92f), Transform(cloud.x - .72f, cloud.y - .06f, cloud.z, .76f, .35f, .43f), rotateWithScene = false, rimStrength = .08f)
            if (cloud.x * cloud.x + cloud.z * cloud.z <= 8f * 8f) {
                draw(
                    requireNotNull(disc),
                    color("#45684C", .08f),
                    Transform(cloud.x, .052f, cloud.z, 1.28f, .008f, .62f),
                    rotateWithScene = false,
                    rimStrength = 0f,
                )
            }
            if (raining) {
                repeat(12) { drop ->
                    val row = drop / 4
                    val column = drop % 4
                    val fall = (drizzleElapsed * 2.7f + row * .25f + column * .11f) % 1f
                    draw(
                        requireNotNull(cylinder),
                        color("#84B7D1", .72f),
                        Transform(
                            cloud.x + (column - 1.5f) * .34f + sin(drop * 2.4f) * .07f,
                            cloud.y - .65f - fall * (cloud.y - .58f),
                            cloud.z + (row - 1f) * .18f,
                            .012f,
                            .10f,
                            .012f,
                            rotationZ = -9f,
                        ),
                        rotateWithScene = false,
                        rimStrength = 0f,
                    )
                }
            }
        }
        if (drizzleStartedMs > 0L && drizzleElapsed > 15f) {
            drizzleStartedMs = 0L
            drizzleCloud = -1
        }
    }

    private fun drawKolobok() {
        val travel = SceneMotion.travelRadians(frame.storyTime)
        var x = sin(travel) * 4.6f
        var z = cos(travel) * 4.6f
        val foxEndingElapsed = eventSeconds(foxEndingStartedMs)
        var endingHeightOffset = 0f
        if (foxEndingElapsed in .60f..1.50f) {
            val (foxX, foxZ) = radial(288f, 5.42f)
            val progress = smoothStep((foxEndingElapsed - .60f) / .50f)
            x += (foxX - x) * progress
            z += (foxZ - z) * progress
            endingHeightOffset = sin(progress * PI.toFloat()) * .12f
        } else if (foxEndingElapsed in 1.50f..1.90f) {
            // The native UI is fully black during this teleport.
            return
        } else if (foxEndingElapsed in 1.90f..3.35f) {
            val progress = smoothStep((foxEndingElapsed - 1.90f) / .60f)
            x = -.34f * (1f - progress)
            z = 5.46f + (4.60f - 5.46f) * progress
            endingHeightOffset = (1f - progress) * 1.05f +
                sin(progress * PI.toFloat()) * .42f
        } else if (foxEndingElapsed > 4.60f) {
            foxEndingStartedMs = 0L
        }
        val greeting = if (SystemClock.uptimeMillis() < greetingUntilMs) {
            abs(sin((greetingUntilMs - SystemClock.uptimeMillis()) * .012f)) * .18f
        } else {
            0f
        }
        val bounce = if (frame.storyPlaying) abs(sin(frame.storyTime * 4.0f)) * .055f else 0f
        val y = .52f + bounce + greeting + endingHeightOffset
        val heading = Math.toDegrees(travel.toDouble()).toFloat() + 90f
        val blinkCycle = (frame.storyTime + 1.7f) % 4.8f
        val eyeOpen = if (blinkCycle < .16f) .018f else .10f

        drawShadow(x, z, .47f, .34f)
        draw(
            requireNotNull(sphere),
            color("#F2C14E"),
            Transform(x, y, z, .42f, .42f, .42f, rotationX = frame.kolobokRotation, rotationY = heading),
            rimStrength = .36f,
        )
        val rollRadians = Math.toRadians(frame.kolobokRotation.toDouble())
        val rollCosine = cos(rollRadians).toFloat()
        val rollSine = sin(rollRadians).toFloat()
        listOf(
            Triple(-.18f, .18f, .17f),
            Triple(.16f, -.08f, -.16f),
            Triple(-.06f, -.08f, -.23f),
        ).forEachIndexed { index, (localX, localY, forward) ->
            val rolledY = localY * rollCosine - forward * rollSine
            val rolledForward = localY * rollSine + forward * rollCosine
            drawActorPart(
                requireNotNull(lowSphere),
                if (index == 0) "#FFD66C" else "#C98A2E",
                x,
                z,
                localX,
                y + rolledY,
                rolledForward,
                .085f,
                .055f,
                .035f,
                heading,
                rotationX = frame.kolobokRotation,
            )
        }

        for (offset in listOf(-.13f, .13f)) {
            drawActorPart(requireNotNull(sphere), "#FAF6EC", x, z, offset, y + .10f, .365f, .082f, eyeOpen, .040f, heading)
            if (eyeOpen > .02f) {
                drawActorPart(requireNotNull(lowSphere), "#3A2C1A", x, z, offset, y + .095f, .410f, .031f, .043f, .020f, heading)
            }
            drawActorPart(
                requireNotNull(cube),
                "#8A5A22",
                x,
                z,
                offset,
                y + .245f,
                .372f,
                .075f,
                .018f,
                .018f,
                heading,
                rotationZ = if (offset < 0f) -8f else 8f,
            )
        }
        drawActorPart(requireNotNull(lowSphere), "#E89A5B", x, z, 0f, y - .015f, .415f, .060f, .050f, .028f, heading)
        drawActorPart(requireNotNull(lowSphere), "#E89A5B", x, z, -.235f, y - .055f, .345f, .078f, .045f, .025f, heading)
        drawActorPart(requireNotNull(lowSphere), "#E89A5B", x, z, .235f, y - .055f, .345f, .078f, .045f, .025f, heading)
        repeat(7) { index ->
            val t = index / 6f
            drawActorPart(
                requireNotNull(lowSphere),
                "#6D392A",
                x,
                z,
                (t - .5f) * .27f,
                y - .14f - abs(t - .5f) * .065f,
                .395f,
                .021f,
                .018f,
                .013f,
                heading,
            )
        }

        if (frame.storyPlaying) {
            repeat(5) { index ->
                val trailTravel = travel - .10f - index * .075f
                val trailX = sin(trailTravel) * 4.6f
                val trailZ = cos(trailTravel) * 4.6f
                val life = ((frame.storyTime * 1.4f + index * .22f) % 1f)
                draw(
                    requireNotNull(lowSphere),
                    color("#E5C693", .24f * (1f - life)),
                    Transform(
                        trailX,
                        .12f + life * .22f,
                        trailZ,
                        .10f + life * .10f,
                        .055f + life * .05f,
                        .10f + life * .10f,
                    ),
                    rimStrength = 0f,
                )
            }
            val songCycle = frame.storyTime % 9f
            if (songCycle < 1.8f) {
                repeat(4) { index ->
                    val noteLife = ((songCycle + index * .28f) % 1.8f) / 1.8f
                    draw(
                        requireNotNull(lowSphere),
                        color("#FFF8D7", .72f * (1f - noteLife)),
                        Transform(
                            x + (index - 1.5f) * .10f + sin(noteLife * 5f) * .08f,
                            y + .55f + noteLife * .60f,
                            z,
                            .035f,
                            .035f,
                            .035f,
                        ),
                        rimStrength = .18f,
                    )
                }
            }
        }
    }

    private fun drawHare() {
        val (x, z) = radial(72f, 6.15f)
        val heading = facingCenter(x, z)
        val reaction = reactionEnvelope(AnimalReaction.HARE)
        val idleHopCycle = frame.storyTime % 6.5f
        val idleHop = if (idleHopCycle < .75f) sin(idleHopCycle / .75f * PI.toFloat()) * .16f else 0f
        val bob = sin(frame.storyTime * 2.2f + .4f) * .025f + idleHop + reaction * .28f
        val earTwitch = sin(frame.storyTime * 1.6f) * 3f + reaction * 18f
        drawShadow(x, z, .46f, .34f)
        drawActorPart(requireNotNull(sphere), "#D9D7D5", x, z, 0f, .50f + bob, 0f, .38f, .50f, .34f, heading)
        drawActorPart(requireNotNull(sphere), "#E6E4E1", x, z, 0f, .96f + bob, .05f, .32f, .34f, .31f, heading)
        drawActorPart(requireNotNull(lowSphere), "#F8F4EF", x, z, 0f, .53f + bob, .31f, .23f, .28f, .14f, heading)
        drawActorPart(requireNotNull(sphere), "#D9D7D5", x, z, -.15f, 1.42f + bob, .01f, .10f, .43f, .10f, heading, rotationZ = -7f - earTwitch)
        drawActorPart(requireNotNull(sphere), "#D9D7D5", x, z, .15f, 1.42f + bob, .01f, .10f, .43f, .10f, heading, rotationZ = 7f + earTwitch)
        drawActorPart(requireNotNull(sphere), "#F2A8B5", x, z, -.15f, 1.42f + bob, .095f, .038f, .32f, .025f, heading, rotationZ = -7f - earTwitch)
        drawActorPart(requireNotNull(sphere), "#F2A8B5", x, z, .15f, 1.42f + bob, .095f, .038f, .32f, .025f, heading, rotationZ = 7f + earTwitch)
        drawActorPart(requireNotNull(lowSphere), "#25211F", x, z, -.115f, 1.02f + bob, .315f, .038f, .045f, .025f, heading)
        drawActorPart(requireNotNull(lowSphere), "#25211F", x, z, .115f, 1.02f + bob, .315f, .038f, .045f, .025f, heading)
        drawActorPart(requireNotNull(lowSphere), "#F28B9E", x, z, 0f, .90f + bob, .355f, .052f, .042f, .028f, heading)
        drawActorPart(requireNotNull(lowSphere), "#F4F1EC", x, z, .35f, .52f + bob, -.24f, .22f, .23f, .22f, heading)
        drawActorPart(requireNotNull(cone), "#F28C32", x, z, -.48f, .18f, .14f, .08f, .28f, .08f, heading, rotationZ = 90f)
        repeat(3) { index ->
            drawActorPart(requireNotNull(cube), "#4E8C45", x, z, -.56f + index * .04f, .27f, .13f, .018f, .12f, .035f, heading, rotationZ = -18f + index * 18f)
        }
    }

    private fun drawWolf() {
        val (x, z) = radial(144f, 6.15f)
        val heading = facingCenter(x, z)
        val reaction = reactionEnvelope(AnimalReaction.WOLF)
        val headSweep = sin(frame.storyTime * .62f) * 12f + reaction * 22f
        val headHeading = heading + headSweep
        val tailYaw = 180f + sin(frame.storyTime * 1.4f) * 11f
        val tailPitch = 12f - reaction * 36f
        val tailYawRadians = Math.toRadians(tailYaw.toDouble())
        val tailPitchRadians = Math.toRadians(tailPitch.toDouble())
        val tailHalfLength = .48f
        val tailHorizontal = cos(tailPitchRadians).toFloat() * tailHalfLength
        val tailLocalX = -.30f + sin(tailYawRadians).toFloat() * tailHorizontal
        val tailForward = -.22f + cos(tailYawRadians).toFloat() * tailHorizontal
        val tailY = .70f + sin(tailPitchRadians).toFloat() * tailHalfLength
        drawShadow(x, z, .56f, .38f)
        drawActorPart(requireNotNull(sphere), "#66727D", x, z, 0f, .55f, -.10f, .43f, .52f, .58f, heading)
        drawActorPart(requireNotNull(lowSphere), "#75818B", x, z, 0f, 1.03f + reaction * .08f, .18f, .36f, .38f, .34f, headHeading)
        drawActorPart(requireNotNull(lowSphere), "#AAB1B4", x, z, 0f, .93f + reaction * .08f, .43f, .25f, .19f, .24f, headHeading)
        drawActorPart(requireNotNull(cone), "#58646E", x, z, -.22f, 1.44f + reaction * .08f, .10f, .16f, .31f, .15f, headHeading, rotationZ = -10f)
        drawActorPart(requireNotNull(cone), "#58646E", x, z, .22f, 1.44f + reaction * .08f, .10f, .16f, .31f, .15f, headHeading, rotationZ = 10f)
        drawActorPart(requireNotNull(lowSphere), "#20252A", x, z, -.12f, 1.10f + reaction * .08f, .34f, .038f, .045f, .025f, headHeading)
        drawActorPart(requireNotNull(lowSphere), "#20252A", x, z, .12f, 1.10f + reaction * .08f, .34f, .038f, .045f, .025f, headHeading)
        drawActorPart(requireNotNull(lowSphere), "#242425", x, z, 0f, .96f + reaction * .08f, .62f, .065f, .050f, .055f, headHeading)
        drawActorPart(
            requireNotNull(sphere),
            "#5B6670",
            x,
            z,
            tailLocalX,
            tailY,
            tailForward,
            .16f,
            .16f,
            .53f,
            heading,
            rotationX = -tailPitch,
            yawOffset = tailYaw,
        )
        for (side in listOf(-.24f, .24f)) {
            drawActorPart(requireNotNull(cylinder), "#59646D", x, z, side, .26f, .20f, .09f, .27f, .09f, heading)
        }
    }

    private fun drawBear() {
        val (x, z) = radial(216f, 6.15f)
        val heading = facingCenter(x, z)
        val reaction = reactionEnvelope(AnimalReaction.BEAR)
        val sway = sin(frame.storyTime * .9f + 1.2f) * 2f + reaction * 5f
        drawShadow(x, z, .68f, .46f)
        drawActorPart(requireNotNull(sphere), "#79533A", x, z, 0f, .66f, -.05f, .58f, .67f, .49f, heading, rotationZ = sway)
        drawActorPart(requireNotNull(sphere), "#865E41", x, z, 0f, 1.28f, .13f, .46f, .48f, .42f, heading)
        drawActorPart(requireNotNull(lowSphere), "#9A7253", x, z, 0f, 1.17f, .48f, .29f, .22f, .22f, heading)
        drawActorPart(requireNotNull(lowSphere), "#765039", x, z, -.31f, 1.61f, .06f, .18f, .18f, .15f, heading)
        drawActorPart(requireNotNull(lowSphere), "#765039", x, z, .31f, 1.61f, .06f, .18f, .18f, .15f, heading)
        drawActorPart(requireNotNull(lowSphere), "#29231F", x, z, -.15f, 1.36f, .39f, .040f, .045f, .025f, heading)
        drawActorPart(requireNotNull(lowSphere), "#29231F", x, z, .15f, 1.36f, .39f, .040f, .045f, .025f, heading)
        drawActorPart(requireNotNull(lowSphere), "#2F2520", x, z, 0f, 1.18f, .68f, .070f, .055f, .050f, heading)
        drawActorPart(requireNotNull(lowSphere), "#B88963", x, z, 0f, .69f, .44f, .34f, .37f, .15f, heading)
        for (side in listOf(-1f, 1f)) {
            val wave = if (side > 0f) reaction * 58f else 0f
            val armAngle = side * (12f + wave)
            val armRadians = Math.toRadians(armAngle.toDouble())
            val armHalfLength = .42f
            val shoulderX = side * .43f
            val shoulderY = .98f
            val armCenterX = shoulderX + sin(armRadians).toFloat() * armHalfLength
            val armCenterY = shoulderY - cos(armRadians).toFloat() * armHalfLength
            drawActorPart(
                requireNotNull(cylinder),
                "#744D35",
                x,
                z,
                armCenterX,
                armCenterY,
                .02f,
                .12f,
                armHalfLength,
                .12f,
                heading,
                rotationZ = armAngle,
            )
        }
    }

    private fun drawFox() {
        val (x, z) = radial(288f, 6.15f)
        val heading = facingCenter(x, z)
        val reaction = reactionEnvelope(AnimalReaction.FOX)
        val tailSway = sin(frame.storyTime * 1.8f) * 18f + reaction * 32f
        val tailRootX = -.30f
        val tailRootY = .63f
        val tailRootForward = -.24f
        val baseYaw = 180f + tailSway
        val basePitch = 13f + sin(frame.storyTime * .72f) * 2f
        val baseYawRadians = Math.toRadians(baseYaw.toDouble())
        val basePitchRadians = Math.toRadians(basePitch.toDouble())
        val baseHalfLength = .45f
        val baseHorizontal = cos(basePitchRadians).toFloat() * baseHalfLength
        val baseCenterX = tailRootX + sin(baseYawRadians).toFloat() * baseHorizontal
        val baseCenterY = tailRootY + sin(basePitchRadians).toFloat() * baseHalfLength
        val baseCenterForward = tailRootForward + cos(baseYawRadians).toFloat() * baseHorizontal
        val tipRootX = tailRootX + sin(baseYawRadians).toFloat() * baseHorizontal * 2f
        val tipRootY = tailRootY + sin(basePitchRadians).toFloat() * baseHalfLength * 2f
        val tipRootForward = tailRootForward + cos(baseYawRadians).toFloat() * baseHorizontal * 2f
        val tipYaw = baseYaw + sin(frame.storyTime * 1.8f - .45f) * 9f + reaction * 8f
        val tipPitch = basePitch + 7f
        val tipYawRadians = Math.toRadians(tipYaw.toDouble())
        val tipPitchRadians = Math.toRadians(tipPitch.toDouble())
        val tipHalfLength = .22f
        val tipHorizontal = cos(tipPitchRadians).toFloat() * tipHalfLength
        val tipCenterX = tipRootX + sin(tipYawRadians).toFloat() * tipHorizontal
        val tipCenterY = tipRootY + sin(tipPitchRadians).toFloat() * tipHalfLength
        val tipCenterForward = tipRootForward + cos(tipYawRadians).toFloat() * tipHorizontal
        drawShadow(x, z, .56f, .38f)
        drawActorPart(requireNotNull(sphere), "#D9722F", x, z, 0f, .56f, -.06f, .42f, .56f, .39f, heading)
        drawActorPart(requireNotNull(sphere), "#E07A34", x, z, 0f, 1.10f, .10f, .37f, .40f, .35f, heading)
        drawActorPart(requireNotNull(cone), "#C95E28", x, z, -.23f, 1.50f, .05f, .17f, .33f, .16f, heading, rotationZ = -11f)
        drawActorPart(requireNotNull(cone), "#C95E28", x, z, .23f, 1.50f, .05f, .17f, .33f, .16f, heading, rotationZ = 11f)
        drawActorPart(requireNotNull(lowSphere), "#F5DFC5", x, z, 0f, .99f, .39f, .25f, .19f, .20f, heading)
        drawActorPart(requireNotNull(lowSphere), "#22201E", x, z, -.12f, 1.17f, .34f, .038f, .045f, .023f, heading)
        drawActorPart(requireNotNull(lowSphere), "#22201E", x, z, .12f, 1.17f, .34f, .038f, .045f, .023f, heading)
        drawActorPart(requireNotNull(lowSphere), "#29211E", x, z, 0f, 1.02f, .58f, .060f, .045f, .040f, heading)
        drawActorPart(
            requireNotNull(sphere),
            "#D9722F",
            x,
            z,
            baseCenterX,
            baseCenterY,
            baseCenterForward,
            .23f,
            .24f,
            .53f,
            heading,
            rotationX = -basePitch,
            yawOffset = baseYaw,
        )
        drawActorPart(
            requireNotNull(sphere),
            "#F4E2C9",
            x,
            z,
            tipCenterX,
            tipCenterY,
            tipCenterForward,
            .18f,
            .19f,
            .27f,
            heading,
            rotationX = -tipPitch,
            yawOffset = tipYaw,
        )
        drawActorPart(requireNotNull(lowSphere), "#F5DFC5", x, z, 0f, .58f, .35f, .25f, .27f, .13f, heading)
    }

    private fun drawShadow(x: Float, z: Float, width: Float, depth: Float) {
        draw(
            requireNotNull(disc),
            color("#29462A", .24f),
            Transform(x, .085f, z, width, .012f, depth),
            rimStrength = 0f,
        )
    }

    private fun drawLineSegment(
        start: WorldPoint3,
        end: WorldPoint3,
        hex: String,
        alpha: Float,
        thickness: Float,
    ) {
        val dx = end.x - start.x
        val dy = end.y - start.y
        val dz = end.z - start.z
        val length = sqrt(dx * dx + dy * dy + dz * dz)
        if (length <= .001f) return
        val horizontal = sqrt(dx * dx + dz * dz)
        val heading = Math.toDegrees(kotlin.math.atan2(-dz.toDouble(), dx.toDouble())).toFloat()
        val tilt = Math.toDegrees(kotlin.math.atan2(-horizontal.toDouble(), dy.toDouble())).toFloat()
        draw(
            requireNotNull(cube),
            color(hex, alpha),
            Transform(
                x = (start.x + end.x) * .5f,
                y = (start.y + end.y) * .5f,
                z = (start.z + end.z) * .5f,
                scaleX = thickness,
                scaleY = length * .5f,
                scaleZ = thickness,
                rotationY = heading,
                rotationZ = tilt,
            ),
            rimStrength = 0f,
        )
    }

    private fun drawActorPart(
        mesh: GlMesh,
        hex: String,
        centerX: Float,
        centerZ: Float,
        localX: Float,
        y: Float,
        forward: Float,
        scaleX: Float,
        scaleY: Float,
        scaleZ: Float,
        heading: Float,
        rotationZ: Float = 0f,
        rotationX: Float = 0f,
        yawOffset: Float = 0f,
        rotateWithScene: Boolean = true,
    ) {
        val radians = Math.toRadians(heading.toDouble())
        val worldX = centerX + localX * cos(radians).toFloat() + forward * sin(radians).toFloat()
        val worldZ = centerZ - localX * sin(radians).toFloat() + forward * cos(radians).toFloat()
        draw(
            mesh,
            color(hex),
            Transform(
                worldX,
                y,
                worldZ,
                scaleX,
                scaleY,
                scaleZ,
                rotationX = rotationX,
                rotationY = heading + yawOffset,
                rotationZ = rotationZ,
            ),
            rotateWithScene = rotateWithScene,
            rimStrength = .28f,
        )
    }

    private fun radial(degrees: Float, radius: Float): Pair<Float, Float> {
        val radians = Math.toRadians(degrees.toDouble())
        return sin(radians).toFloat() * radius to cos(radians).toFloat() * radius
    }

    private fun smoothStep(value: Float): Float {
        val progress = value.coerceIn(0f, 1f)
        return progress * progress * (3f - 2f * progress)
    }

    private fun facingCenter(x: Float, z: Float): Float =
        Math.toDegrees(kotlin.math.atan2(-x, -z).toDouble()).toFloat()

    private fun crossroadsPlaqueHeading(): Float {
        val worldHeading = Math.toDegrees(
            kotlin.math.atan2(eyeX.toDouble(), eyeZ.toDouble()),
        ).toFloat()
        return worldHeading - frame.sceneRotation
    }

    private fun crossroadsPlaquePoint(
        localX: Float,
        y: Float,
        forward: Float,
    ): WorldPoint3 {
        val heading = crossroadsPlaqueHeading()
        val radians = Math.toRadians(heading.toDouble())
        return WorldPoint3(
            x = localX * cos(radians).toFloat() + forward * sin(radians).toFloat(),
            y = y,
            z = -localX * sin(radians).toFloat() + forward * cos(radians).toFloat(),
        )
    }

    private fun crossroadsPlaqueTransform(
        localX: Float,
        y: Float,
        forward: Float,
        scaleX: Float,
        scaleY: Float,
        scaleZ: Float,
        rotationZ: Float,
    ): Transform {
        val point = crossroadsPlaquePoint(localX, y, forward)
        return Transform(
            x = point.x,
            y = point.y,
            z = point.z,
            scaleX = scaleX,
            scaleY = scaleY,
            scaleZ = scaleZ,
            rotationY = crossroadsPlaqueHeading(),
            rotationZ = rotationZ,
        )
    }

    fun beginTreeBonkAt(
        touchX: Float,
        touchY: Float,
        viewWidth: Int,
        viewHeight: Int,
    ) {
        val mappedX = touchX * viewportWidth / max(1, viewWidth).toFloat()
        val mappedY = touchY * viewportHeight / max(1, viewHeight).toFloat()
        val treeIndex = findTreeAt(mappedX, mappedY) ?: return
        val point = (sprucePoints + birchPoints)[treeIndex]
        val (treeX, treeZ) = radial(point.angle, point.radius)
        val ground = groundPointAt(mappedX, mappedY)
        var directionX = (ground?.x ?: treeX) - treeX
        var directionZ = (ground?.z ?: treeZ) - treeZ
        if (directionX * directionX + directionZ * directionZ < .0025f) {
            // A centered press still needs a legible direction. Push outward
            // from the island just as Kolobok would when brushing the trunk.
            directionX = treeX
            directionZ = treeZ
        }
        TreeBonkPhysics.hold(treeBonkStates[treeIndex], directionX, directionZ)
        grabbedTreeIndex = treeIndex
    }

    fun releaseTreeBonk() {
        if (grabbedTreeIndex !in treeBonkStates.indices) return
        TreeBonkPhysics.release(treeBonkStates[grabbedTreeIndex])
        grabbedTreeIndex = -1
    }

    private fun findTreeAt(mappedX: Float, mappedY: Float): Int? {
        val candidates = mutableListOf<TapTarget>()
        (sprucePoints + birchPoints).forEachIndexed { index, point ->
            val (x, z) = radial(point.angle, point.radius)
            listOf(
                .70f to .10f,
                1.46f to .13f,
                2.12f to .11f,
            ).forEach { (y, radiusFraction) ->
                val projected = projectPoint(x, y, z, rotatesWithScene = true)
                    ?: return@forEach
                val radius = min(viewportWidth, viewportHeight) * radiusFraction
                val dx = mappedX - projected.x
                val dy = mappedY - projected.y
                val normalizedDistance = sqrt(dx * dx + dy * dy) / radius.coerceAtLeast(1f)
                if (normalizedDistance <= 1f) {
                    candidates += TapTarget(
                        id = "tree",
                        payload = index,
                        normalizedDistance = normalizedDistance,
                        depth = projected.depth,
                    )
                }
            }
        }
        return candidates.minWithOrNull(
            compareBy<TapTarget> { (it.normalizedDistance * 8f).toInt() }
                .thenBy { it.depth }
                .thenBy { it.normalizedDistance },
        )?.payload
    }

    fun tapAt(
        tapX: Float,
        tapY: Float,
        viewWidth: Int,
        viewHeight: Int,
    ): SceneTapResult? {
        val mappedX = tapX * viewportWidth / max(1, viewWidth).toFloat()
        val mappedY = tapY * viewportHeight / max(1, viewHeight).toFloat()
        val targets = mutableListOf<TapTarget>()

        fun addTarget(
            id: String,
            x: Float,
            y: Float,
            z: Float,
            radiusFraction: Float,
            payload: Int = -1,
            rotatesWithScene: Boolean = true,
        ) {
            val point = projectPoint(x, y, z, rotatesWithScene) ?: return
            val radius = min(viewportWidth, viewportHeight) * radiusFraction
            val dx = mappedX - point.x
            val dy = mappedY - point.y
            val normalizedDistance = sqrt(dx * dx + dy * dy) / radius.coerceAtLeast(1f)
            if (normalizedDistance <= 1f) {
                targets += TapTarget(id, payload, normalizedDistance, point.depth)
            }
        }

        addTarget("grandpa", -4.04f, .88f, 4.18f, .115f)
        addTarget("chimney", .66f, 2.65f, 6.50f, .075f)
        addTarget("izba", -.48f, .92f, 5.28f, .120f)
        addTarget("izba", 0f, 2.08f, 5.30f, .105f)
        addTarget("willow", -1.18f, 1.42f, 5.05f, .115f)
        addTarget("pond", -3.21f, .30f, 4.19f, .090f)
        val addPlaque = crossroadsPlaquePoint(-.08f, 1.48f, .79f)
        val createPlaque = crossroadsPlaquePoint(.08f, 1.13f, .81f)
        val libraryPlaque = crossroadsPlaquePoint(-.04f, .78f, .795f)
        addTarget("menu_add", addPlaque.x, addPlaque.y, addPlaque.z, .072f)
        addTarget("menu_create", createPlaque.x, createPlaque.y, createPlaque.z, .075f)
        addTarget("menu_library", libraryPlaque.x, libraryPlaque.y, libraryPlaque.z, .070f)
        addTarget("stone", 0f, 1.05f, 0f, .105f)

        listOf(
            Triple("hare", 72f, AnimalReaction.HARE),
            Triple("wolf", 144f, AnimalReaction.WOLF),
            Triple("bear", 216f, AnimalReaction.BEAR),
            Triple("fox", 288f, AnimalReaction.FOX),
        ).forEach { (id, angle, reaction) ->
            val (x, z) = radial(angle, 6.15f)
            addTarget(id, x, 1.0f, z, .105f, payload = reaction.ordinal)
        }

        val travel = SceneMotion.travelRadians(frame.storyTime)
        addTarget("kolobok", sin(travel) * 4.6f, .58f, cos(travel) * 4.6f, .105f)

        mushroomSpots.forEachIndexed { index, point ->
            if (mushroomReserved[index] || mushroomScale(index, SystemClock.uptimeMillis()) <= .50f) {
                return@forEachIndexed
            }
            val (x, z) = radial(point.angle, point.radius)
            addTarget("mushroom", x, .27f, z, .065f, payload = index)
        }

        if (owlStartedMs > 0L) {
            val activeTree = sprucePoints.getOrElse(owlActiveTreeIndex) { owlTree }
            val (owlX, owlZ) = radial(activeTree.angle, activeTree.radius)
            addTarget("owl", owlX, 2.58f, owlZ, .105f)
        }

        (sprucePoints + birchPoints)
            .forEachIndexed { index, point ->
                val (x, z) = radial(point.angle, point.radius)
                addTarget("tree", x, .72f, z, .10f, payload = index)
                addTarget("tree", x, 1.48f, z, .13f, payload = index)
                addTarget("tree", x, 2.18f, z, .11f, payload = index)
            }

        val (butterflyX, butterflyZ) = radial(71f, 5.82f)
        addTarget("butterflies", butterflyX, .72f, butterflyZ, .095f)
        val (hiveX, hiveZ) = radial(205f, 5.55f)
        addTarget("hive", hiveX, .42f, hiveZ, .082f)
        addTarget(
            id = "sun",
            x = -7.8f,
            y = 8.7f,
            z = -13.5f,
            radiusFraction = .105f,
            rotatesWithScene = false,
        )

        repeat(5) { index ->
            val cloud = cloudPosition(index)
            addTarget(
                id = "cloud",
                x = cloud.x,
                y = cloud.y,
                z = cloud.z,
                radiusFraction = .125f,
                payload = index,
                rotatesWithScene = false,
            )
        }

        if (eveningAmount() > .05f) {
            addTarget(
                id = "moon",
                x = moonPosition.x,
                y = moonPosition.y,
                z = moonPosition.z,
                radiusFraction = .10f,
                rotatesWithScene = false,
            )
        }

        // Plaques are navigation, so a generous overlapping boulder hitbox
        // must never steal their taps near an edge.
        val target = targets
            .filter { it.id.startsWith("menu_") }
            .minByOrNull { it.normalizedDistance }
            ?: targets.minWithOrNull(
                compareBy<TapTarget> {
                    // Screen-distance buckets preserve intentional target
                    // padding, while depth resolves genuinely overlapping hits.
                    (it.normalizedDistance * 8f).toInt()
                }.thenBy { it.depth }
                    .thenBy { it.normalizedDistance },
            )
        val now = SystemClock.uptimeMillis()
        var interaction: SceneInteraction? = null
        when (target?.id) {
            "menu_add" -> return SceneTapResult(crossroadsAction = CrossroadsAction.ADD_BOOK)
            "menu_create" -> return SceneTapResult(crossroadsAction = CrossroadsAction.CREATE_STORY)
            "menu_library" -> return SceneTapResult(crossroadsAction = CrossroadsAction.LIBRARY)

            "grandpa" -> {
                fishingCatchCount += 1
                val roll = pseudo(fishingCatchCount * 71 + 23)
                fishingKind = when {
                    roll < .05f -> FishingKind.GOLD
                    roll < .30f -> FishingKind.BOOT
                    else -> FishingKind.SILVER
                }
                if (fishingKind == FishingKind.BOOT) {
                    accumulatedBoots = (accumulatedBoots + 1).coerceAtMost(3)
                }
                fishingStartedMs = now
                interaction = SceneInteraction.GRANDPA_FISHING
            }

            "chimney" -> {
                smokeRingsStartedMs = now
                interaction = SceneInteraction.CHIMNEY_SMOKE
            }
            "izba" -> {
                izbaFlashStartedMs = now
                smokeRingsStartedMs = now
                interaction = SceneInteraction.IZBA_WINDOW
            }

            "willow" -> {
                if (eventSeconds(willowSwayStartedMs) !in 0f..2.8f) {
                    willowSwayStartedMs = now
                }
                if (now - willowLastTapMs > 1_250L) willowTapCount = 0
                willowLastTapMs = now
                willowTapCount += 1
                if (willowTapCount >= 3) {
                    willowTapCount = 0
                    if (eventSeconds(magpiesStartedMs) !in 0f..18.4f) {
                        magpiesStartedMs = now
                    }
                    interaction = SceneInteraction.MAGPIES
                } else {
                    interaction = SceneInteraction.WILLOW_RUSTLE
                }
            }

            "pond" -> {
                if (eventSeconds(frogJumpStartedMs) !in 0f..1.35f) {
                    frogJumpStartedMs = now
                }
                interaction = SceneInteraction.FROG_SPLASH
            }
            "stone" -> {
                if (eventSeconds(stoneBirdsStartedMs) !in 0f..6.2f) {
                    stoneBirdsStartedMs = now
                }
                interaction = SceneInteraction.STONE_BIRDS
            }
            "cloud" -> {
                drizzleCloud = target.payload
                drizzleStartedMs = now
                interaction = SceneInteraction.CLOUD_RAIN
            }
            "moon" -> {
                moonWinkStartedMs = now
                interaction = SceneInteraction.MOON_WINK
            }

            "mushroom" -> {
                val mushroomIndex = target.payload.coerceIn(mushroomSpots.indices)
                if (startHedgehogJourney(mushroomIndex, now)) {
                    interaction = SceneInteraction.HEDGEHOG
                }
            }

            "owl" -> {
                owlFlapStartedMs = now
                interaction = SceneInteraction.OWL_FLAP
            }

            "tree" -> {
                val point = (sprucePoints + birchPoints)
                    .getOrNull(target.payload)
                if (point != null) {
                    val (x, z) = radial(point.angle, point.radius)
                    val state = treeBonkStates[target.payload]
                    if (!state.held && state.elapsedSeconds < 0f) {
                        TreeBonkPhysics.kick(state, x, z)
                    }
                    interaction = SceneInteraction.TREE_RUSTLE
                    val spruceIndex = sprucePoints.indexOf(point)
                    if (spruceIndex >= 0) {
                        if (owlTapTreeIndex != spruceIndex || now - owlLastTapMs > 1_200L) {
                            owlTapTreeIndex = spruceIndex
                            owlTapCount = 0
                        }
                        owlLastTapMs = now
                        owlTapCount += 1
                        if (
                            owlTapCount >= 3 &&
                            now >= (owlCooldownUntilMs[spruceIndex] ?: 0L)
                        ) {
                            owlTapCount = 0
                            owlActiveTreeIndex = spruceIndex
                            owlCooldownUntilMs[spruceIndex] = now + 10_000L
                            owlStartedMs = now
                            owlFlapStartedMs = 0L
                            interaction = SceneInteraction.OWL_WAKE
                        }
                    } else {
                        val birchIndex = birchPoints.indexOf(point)
                        val size = .78f + pseudo(birchIndex * 41 + 5) * .23f
                        if (leafBursts.size >= 4) leafBursts.removeAt(0)
                        leafBursts += LeafBurst(
                            x = x,
                            y = 1.72f * size,
                            z = z,
                            seed = birchIndex * 409 + now.toInt(),
                            startedAtMs = now,
                        )
                    }
                }
            }

            "butterflies" -> {
                startAmbientReaction(
                    AmbientReaction.BUTTERFLIES,
                    WorldPoint3(butterflyX, .38f, butterflyZ),
                    now,
                )
                interaction = SceneInteraction.BUTTERFLY_DANCE
            }

            "hive" -> {
                startAmbientReaction(
                    AmbientReaction.HIVE,
                    WorldPoint3(hiveX, .32f, hiveZ),
                    now,
                )
                interaction = SceneInteraction.HIVE_BUZZ
            }

            "sun" -> {
                sunGlowStartedMs = now
                interaction = SceneInteraction.SUN_GLOW
            }

            "hare", "wolf", "bear", "fox" -> {
                animalReaction = AnimalReaction.entries[target.payload]
                animalReactionStartedMs = now
                if (animalReaction == AnimalReaction.FOX) {
                    if (now - foxLastTapMs > 6_000L) foxTapCount = 0
                    foxLastTapMs = now
                    foxTapCount += 1
                    if (foxTapCount >= 5) {
                        foxTapCount = 0
                        foxEndingStartedMs = now
                        interaction = SceneInteraction.FOX_TRUE_ENDING
                    } else {
                        interaction = SceneInteraction.FOX
                    }
                } else {
                    interaction = when (animalReaction) {
                        AnimalReaction.HARE -> SceneInteraction.HARE
                        AnimalReaction.WOLF -> SceneInteraction.WOLF
                        AnimalReaction.BEAR -> SceneInteraction.BEAR
                        AnimalReaction.FOX -> SceneInteraction.FOX
                        AnimalReaction.NONE -> null
                    }
                }
            }

            "kolobok" -> {
                greet()
                interaction = SceneInteraction.KOLOBOK
            }
            null -> {
                val ground = groundPointAt(mappedX, mappedY)
                if (ground != null && sqrt(ground.x * ground.x + ground.z * ground.z) <= 8.1f) {
                    val radius = sqrt(ground.x * ground.x + ground.z * ground.z)
                    if (abs(radius - 4.72f) <= .58f) {
                        startAmbientReaction(AmbientReaction.PATH, ground, now)
                        interaction = SceneInteraction.PATH_SPARKLE
                    } else {
                        startAmbientReaction(AmbientReaction.MEADOW, ground, now)
                        interaction = SceneInteraction.MEADOW_BLOOM
                    }
                }
            }
        }
        return interaction?.let { SceneTapResult(interaction = it) }
    }

    private fun startAmbientReaction(
        reaction: AmbientReaction,
        point: WorldPoint3,
        now: Long,
    ) {
        ambientReaction = reaction
        ambientReactionPoint = point
        ambientReactionStartedMs = now
    }

    private fun groundPointAt(screenX: Float, screenY: Float): WorldPoint3? {
        val inverseProjectionView = FloatArray(16)
        if (!Matrix.invertM(inverseProjectionView, 0, projectionView, 0)) return null

        val normalizedX = screenX / viewportWidth.coerceAtLeast(1) * 2f - 1f
        val normalizedY = 1f - screenY / viewportHeight.coerceAtLeast(1) * 2f
        val nearClip = floatArrayOf(normalizedX, normalizedY, -1f, 1f)
        val farClip = floatArrayOf(normalizedX, normalizedY, 1f, 1f)
        val nearWorld = FloatArray(4)
        val farWorld = FloatArray(4)
        Matrix.multiplyMV(nearWorld, 0, inverseProjectionView, 0, nearClip, 0)
        Matrix.multiplyMV(farWorld, 0, inverseProjectionView, 0, farClip, 0)
        if (abs(nearWorld[3]) < .0001f || abs(farWorld[3]) < .0001f) return null
        for (index in 0..2) {
            nearWorld[index] /= nearWorld[3]
            farWorld[index] /= farWorld[3]
        }
        val rayY = farWorld[1] - nearWorld[1]
        if (abs(rayY) < .0001f) return null
        val distance = (.08f - nearWorld[1]) / rayY
        if (distance !in 0f..1f) return null
        val worldX = nearWorld[0] + (farWorld[0] - nearWorld[0]) * distance
        val worldZ = nearWorld[2] + (farWorld[2] - nearWorld[2]) * distance

        // Scene rotation is a model transform. Store the reaction in local
        // scene coordinates so it stays attached to the touched prop.
        val rotation = Math.toRadians(frame.sceneRotation.toDouble())
        val cosine = cos(rotation).toFloat()
        val sine = sin(rotation).toFloat()
        return WorldPoint3(
            x = cosine * worldX - sine * worldZ,
            y = .10f,
            z = sine * worldX + cosine * worldZ,
        )
    }

    private fun projectPoint(
        x: Float,
        y: Float,
        z: Float,
        rotatesWithScene: Boolean,
    ): ScreenPoint? {
        var worldX = x
        var worldZ = z
        if (rotatesWithScene) {
            val radians = Math.toRadians(frame.sceneRotation.toDouble())
            val cosine = cos(radians).toFloat()
            val sine = sin(radians).toFloat()
            worldX = cosine * x + sine * z
            worldZ = -sine * x + cosine * z
        }
        val world = floatArrayOf(worldX, y, worldZ, 1f)
        val clip = FloatArray(4)
        Matrix.multiplyMV(clip, 0, projectionView, 0, world, 0)
        if (clip[3] <= .01f) return null
        val ndcX = clip[0] / clip[3]
        val ndcY = clip[1] / clip[3]
        if (ndcX !in -1.35f..1.35f || ndcY !in -1.35f..1.35f) return null
        return ScreenPoint(
            x = (ndcX + 1f) * .5f * viewportWidth,
            y = (1f - ndcY) * .5f * viewportHeight,
            depth = clip[3],
        )
    }

    private fun cloudPosition(index: Int): WorldPoint3 {
        val x = ((frame.storyTime * (0.065f + index * .009f) + index * 5.1f) % 26f) - 13f
        val z = -8f + index * 4f
        val y = 7.35f + (index % 2) * .68f
        return WorldPoint3(x, y, z)
    }

    private fun eventSeconds(startedAtMs: Long): Float {
        if (startedAtMs <= 0L) return -1f
        return (SystemClock.uptimeMillis() - startedAtMs).coerceAtLeast(0L) / 1_000f
    }

    private fun reactionEnvelope(target: AnimalReaction): Float {
        if (animalReaction != target) return 0f
        val elapsed = eventSeconds(animalReactionStartedMs)
        if (elapsed > 1.35f) {
            animalReaction = AnimalReaction.NONE
            animalReactionStartedMs = 0L
            return 0f
        }
        return sin((elapsed / 1.35f).coerceIn(0f, 1f) * PI.toFloat())
    }

    private fun drawTinyBird(
        x: Float,
        y: Float,
        z: Float,
        heading: Float,
        flap: Float,
        bodyColor: String,
        pitch: Float = 0f,
        scale: Float = 1f,
        flightAmount: Float = 0f,
    ) {
        val birdScale = scale.coerceIn(0f, 1f)
        val flight = flightAmount.coerceIn(0f, 1f)
        val posedPitch = pitch - (1f - flight) * 18f
        val pitchRadians = Math.toRadians(posedPitch.toDouble())
        val pitchCosine = cos(pitchRadians).toFloat()
        val pitchSine = sin(pitchRadians).toFloat()
        fun pitched(localY: Float, forward: Float): Pair<Float, Float> =
            localY * pitchCosine - forward * pitchSine to
                localY * pitchSine + forward * pitchCosine

        drawActorPart(
            requireNotNull(lowSphere),
            bodyColor,
            x,
            z,
            0f,
            y,
            0f,
            .090f * birdScale,
            .062f * birdScale,
            .12f * birdScale,
            heading,
            rotationX = posedPitch,
        )
        val headPoint = pitched(.055f * birdScale, .11f * birdScale)
        drawActorPart(
            requireNotNull(lowSphere),
            bodyColor,
            x,
            z,
            0f,
            y + headPoint.first,
            headPoint.second,
            .058f * birdScale,
            .054f * birdScale,
            .055f * birdScale,
            heading,
            rotationX = posedPitch,
        )
        val beakPoint = pitched(.050f * birdScale, .20f * birdScale)
        drawActorPart(
            requireNotNull(cone),
            "#D9A441",
            x,
            z,
            0f,
            y + beakPoint.first,
            beakPoint.second,
            .026f * birdScale,
            .055f * birdScale,
            .026f * birdScale,
            heading,
            rotationX = 90f + posedPitch,
        )
        for (side in listOf(-1f, 1f)) {
            val wingOffset = .044f + (.095f - .044f) * flight
            val wingWidth = .032f + (.080f - .032f) * flight
            val wingDepth = .090f + (.055f - .090f) * flight
            drawActorPart(
                requireNotNull(cube),
                bodyColor,
                x,
                z,
                side * wingOffset * birdScale,
                y,
                0f,
                wingWidth * birdScale,
                .014f * birdScale,
                wingDepth * birdScale,
                heading,
                rotationZ = side * flap,
                rotationX = posedPitch,
            )
        }
        val tailPoint = pitched(0f, -.15f * birdScale)
        drawActorPart(
            requireNotNull(cube),
            bodyColor,
            x,
            z,
            0f,
            y + tailPoint.first,
            tailPoint.second,
            .035f * birdScale,
            .015f * birdScale,
            .095f * birdScale,
            heading,
            rotationZ = 8f,
            rotationX = posedPitch,
        )
    }

    private fun drawWeather() {
        if (weather == SceneWeather.CLEAR) return
        rain.forEachIndexed { index, particle ->
            val speed = if (weather == SceneWeather.RAIN) 2.8f else 0.55f
            val fall = (frame.storyTime * speed + particle.phase) % 5.5f
            val y = 5.4f - fall
            val drift = if (weather == SceneWeather.SNOW) {
                sin(frame.storyTime * 1.3f + index) * 0.22f
            } else {
                frame.storyTime * .07f
            }
            val shade = if (weather == SceneWeather.RAIN) "#A7D4EE" else "#FFFFFF"
            val transform = if (weather == SceneWeather.RAIN) {
                Transform(particle.x + drift, y, particle.z, .015f, .16f, .015f, rotationZ = -12f)
            } else {
                Transform(particle.x + drift, y, particle.z, .045f, .045f, .045f)
            }
            draw(
                if (weather == SceneWeather.RAIN) requireNotNull(cylinder) else requireNotNull(sphere),
                color(shade, .72f),
                transform,
                rotateWithScene = false,
            )
        }
    }

    private fun drawTextLabel(texture: Int, transform: Transform) {
        val mesh = textMesh ?: return
        if (texture == 0) return

        Matrix.setIdentityM(model, 0)
        Matrix.rotateM(model, 0, frame.sceneRotation, 0f, 1f, 0f)
        Matrix.translateM(model, 0, transform.x, transform.y, transform.z)
        if (transform.rotationY != 0f) {
            Matrix.rotateM(model, 0, transform.rotationY, 0f, 1f, 0f)
        }
        if (transform.rotationZ != 0f) {
            Matrix.rotateM(model, 0, transform.rotationZ, 0f, 0f, 1f)
        }
        Matrix.scaleM(model, 0, transform.scaleX, transform.scaleY, 1f)
        Matrix.multiplyMM(viewModel, 0, view, 0, model, 0)
        Matrix.multiplyMM(mvp, 0, projection, 0, viewModel, 0)

        GLES30.glUseProgram(textProgram)
        GLES30.glUniformMatrix4fv(textMvpLocation, 1, false, mvp, 0)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, texture)
        GLES30.glUniform1i(textTextureLocation, 0)
        GLES30.glDepthMask(false)
        GLES30.glBindVertexArray(mesh.vao)
        GLES30.glDrawElements(GLES30.GL_TRIANGLES, mesh.indexCount, GLES30.GL_UNSIGNED_SHORT, 0)
        GLES30.glBindVertexArray(0)
        GLES30.glDepthMask(true)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, 0)
        GLES30.glUseProgram(program)
    }

    private fun queueDynamicInstance(
        mesh: GlMesh,
        hex: String,
        alpha: Float,
        transform: Transform,
        rimStrength: Float,
    ) {
        val style = DynamicInstanceStyle(mesh, hex, alpha, rimStrength)
        dynamicInstanceGroups.getOrPut(style) { mutableListOf() }.add(transform)
    }

    private fun flushDynamicInstances() {
        dynamicInstanceGroups.forEach { (style, transforms) ->
            drawInstanced(
                mesh = style.mesh,
                color = color(style.hex, style.alpha),
                transforms = transforms,
                rimStrength = style.rimStrength,
            )
        }
        dynamicInstanceGroups.clear()
    }

    private fun drawInstanced(
        mesh: GlMesh,
        color: FloatArray,
        transforms: List<Transform>,
        rimStrength: Float,
    ) {
        if (transforms.isEmpty() || color[3] <= .015f) return
        val requiredFloats = transforms.size * 16
        var upload = instanceUploadBuffer
        if (upload == null || upload.capacity() < requiredFloats) {
            var capacity = 64
            while (capacity < requiredFloats) capacity *= 2
            upload = ByteBuffer
                .allocateDirect(capacity * Float.SIZE_BYTES)
                .order(ByteOrder.nativeOrder())
                .asFloatBuffer()
            instanceUploadBuffer = upload
        }
        upload.clear()
        transforms.forEach { transform ->
            Matrix.setIdentityM(model, 0)
            Matrix.rotateM(model, 0, frame.sceneRotation, 0f, 1f, 0f)
            Matrix.translateM(model, 0, transform.x, transform.y, transform.z)
            if (transform.rotationY != 0f) {
                Matrix.rotateM(model, 0, transform.rotationY, 0f, 1f, 0f)
            }
            if (transform.rotationX != 0f) {
                Matrix.rotateM(model, 0, transform.rotationX, 1f, 0f, 0f)
            }
            if (transform.rotationZ != 0f) {
                Matrix.rotateM(model, 0, transform.rotationZ, 0f, 0f, 1f)
            }
            Matrix.scaleM(model, 0, transform.scaleX, transform.scaleY, transform.scaleZ)
            upload.put(model, 0, 16)
        }
        upload.flip()

        GLES30.glBindVertexArray(mesh.vao)
        val instanceBuffer = instanceBuffers.getOrPut(mesh.vao) {
            val handles = IntArray(1)
            GLES30.glGenBuffers(1, handles, 0)
            GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, handles[0])
            val stride = 16 * Float.SIZE_BYTES
            repeat(4) { column ->
                val location = 3 + column
                GLES30.glEnableVertexAttribArray(location)
                GLES30.glVertexAttribPointer(
                    location,
                    4,
                    GLES30.GL_FLOAT,
                    false,
                    stride,
                    column * 4 * Float.SIZE_BYTES,
                )
                GLES30.glVertexAttribDivisor(location, 1)
            }
            handles[0]
        }
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, instanceBuffer)
        GLES30.glBufferData(
            GLES30.GL_ARRAY_BUFFER,
            requiredFloats * Float.SIZE_BYTES,
            upload,
            GLES30.GL_STREAM_DRAW,
        )

        GLES30.glUseProgram(instancedProgram)
        GLES30.glUniformMatrix4fv(
            instancedProjectionViewLocation,
            1,
            false,
            projectionView,
            0,
        )
        GLES30.glUniform4fv(instancedColorLocation, 1, color, 0)
        GLES30.glUniform3f(instancedLightLocation, -0.48f, 0.78f, 0.39f)
        GLES30.glUniform3f(instancedCameraLocation, eyeX, eyeY, eyeZ)
        val evening = eveningAmount()
        GLES30.glUniform3f(
            instancedFogColorLocation,
            .78f * (1f - evening) + .25f * evening,
            .89f * (1f - evening) + .33f * evening,
            .93f * (1f - evening) + .48f * evening,
        )
        GLES30.glUniform1f(instancedRimLocation, rimStrength)

        val suppressDepthWrite = color[3] < .80f
        if (suppressDepthWrite) GLES30.glDepthMask(false)
        GLES30.glDrawElementsInstanced(
            GLES30.GL_TRIANGLES,
            mesh.indexCount,
            GLES30.GL_UNSIGNED_SHORT,
            0,
            transforms.size,
        )
        if (suppressDepthWrite) GLES30.glDepthMask(true)
        GLES30.glBindVertexArray(0)
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, 0)
        GLES30.glUseProgram(program)
    }

    private fun draw(
        mesh: GlMesh,
        color: FloatArray,
        transform: Transform,
        rotateWithScene: Boolean = true,
        rimStrength: Float = .20f,
    ) {
        if (color[3] <= .015f) return
        // Soft particles/glows must not hide later geometry. Nearly opaque
        // solids (cloud lobes, moon, etc.) still write depth so their own
        // overlapping pieces remain spatially correct as the camera orbits.
        val suppressDepthWrite = color[3] < .80f
        if (suppressDepthWrite) GLES30.glDepthMask(false)
        Matrix.setIdentityM(model, 0)
        if (rotateWithScene) Matrix.rotateM(model, 0, frame.sceneRotation, 0f, 1f, 0f)
        Matrix.translateM(model, 0, transform.x, transform.y, transform.z)
        if (transform.rotationY != 0f) Matrix.rotateM(model, 0, transform.rotationY, 0f, 1f, 0f)
        if (transform.rotationX != 0f) Matrix.rotateM(model, 0, transform.rotationX, 1f, 0f, 0f)
        if (transform.rotationZ != 0f) Matrix.rotateM(model, 0, transform.rotationZ, 0f, 0f, 1f)
        Matrix.scaleM(model, 0, transform.scaleX, transform.scaleY, transform.scaleZ)
        Matrix.multiplyMM(viewModel, 0, view, 0, model, 0)
        Matrix.multiplyMM(mvp, 0, projection, 0, viewModel, 0)
        Matrix.setIdentityM(normalModel, 0)
        if (rotateWithScene) Matrix.rotateM(normalModel, 0, frame.sceneRotation, 0f, 1f, 0f)
        if (transform.rotationY != 0f) Matrix.rotateM(normalModel, 0, transform.rotationY, 0f, 1f, 0f)
        if (transform.rotationX != 0f) Matrix.rotateM(normalModel, 0, transform.rotationX, 1f, 0f, 0f)
        if (transform.rotationZ != 0f) Matrix.rotateM(normalModel, 0, transform.rotationZ, 0f, 0f, 1f)
        Matrix.scaleM(
            normalModel,
            0,
            1f / transform.scaleX.coerceAtLeast(.0001f),
            1f / transform.scaleY.coerceAtLeast(.0001f),
            1f / transform.scaleZ.coerceAtLeast(.0001f),
        )
        normalMatrix[0] = normalModel[0]
        normalMatrix[1] = normalModel[1]
        normalMatrix[2] = normalModel[2]
        normalMatrix[3] = normalModel[4]
        normalMatrix[4] = normalModel[5]
        normalMatrix[5] = normalModel[6]
        normalMatrix[6] = normalModel[8]
        normalMatrix[7] = normalModel[9]
        normalMatrix[8] = normalModel[10]
        GLES30.glUniformMatrix4fv(mvpLocation, 1, false, mvp, 0)
        GLES30.glUniformMatrix4fv(modelLocation, 1, false, model, 0)
        GLES30.glUniformMatrix3fv(normalLocation, 1, false, normalMatrix, 0)
        GLES30.glUniform4fv(colorLocation, 1, color, 0)
        GLES30.glUniform1f(rimLocation, rimStrength)
        GLES30.glBindVertexArray(mesh.vao)
        GLES30.glDrawElements(GLES30.GL_TRIANGLES, mesh.indexCount, GLES30.GL_UNSIGNED_SHORT, 0)
        if (suppressDepthWrite) GLES30.glDepthMask(true)
    }

    private fun createMesh(data: MeshData): GlMesh {
        val handles = IntArray(1)
        GLES30.glGenVertexArrays(1, handles, 0)
        val vao = handles[0]
        GLES30.glBindVertexArray(vao)

        GLES30.glGenBuffers(1, handles, 0)
        val vertexBuffer = handles[0]
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vertexBuffer)
        val vertices = data.vertices.toNativeBuffer()
        GLES30.glBufferData(
            GLES30.GL_ARRAY_BUFFER,
            data.vertices.size * Float.SIZE_BYTES,
            vertices,
            GLES30.GL_STATIC_DRAW,
        )

        GLES30.glGenBuffers(1, handles, 0)
        val indexBuffer = handles[0]
        GLES30.glBindBuffer(GLES30.GL_ELEMENT_ARRAY_BUFFER, indexBuffer)
        val indices = data.indices.toNativeBuffer()
        GLES30.glBufferData(
            GLES30.GL_ELEMENT_ARRAY_BUFFER,
            data.indices.size * Short.SIZE_BYTES,
            indices,
            GLES30.GL_STATIC_DRAW,
        )

        val stride = 6 * Float.SIZE_BYTES
        GLES30.glEnableVertexAttribArray(0)
        GLES30.glVertexAttribPointer(0, 3, GLES30.GL_FLOAT, false, stride, 0)
        GLES30.glEnableVertexAttribArray(1)
        GLES30.glVertexAttribPointer(
            1,
            3,
            GLES30.GL_FLOAT,
            false,
            stride,
            3 * Float.SIZE_BYTES,
        )
        GLES30.glBindVertexArray(0)
        return GlMesh(vao, vertexBuffer, indexBuffer, data.indices.size)
    }

    private fun createTextMesh(): TextGlMesh {
        val vertices = floatArrayOf(
            -1f, -1f, 0f, 0f, 1f,
            1f, -1f, 0f, 1f, 1f,
            1f, 1f, 0f, 1f, 0f,
            -1f, 1f, 0f, 0f, 0f,
        )
        val indices = shortArrayOf(0, 1, 2, 0, 2, 3)
        val handles = IntArray(1)
        GLES30.glGenVertexArrays(1, handles, 0)
        val vao = handles[0]
        GLES30.glBindVertexArray(vao)

        GLES30.glGenBuffers(1, handles, 0)
        val vertexBuffer = handles[0]
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vertexBuffer)
        GLES30.glBufferData(
            GLES30.GL_ARRAY_BUFFER,
            vertices.size * Float.SIZE_BYTES,
            vertices.toNativeBuffer(),
            GLES30.GL_STATIC_DRAW,
        )

        GLES30.glGenBuffers(1, handles, 0)
        val indexBuffer = handles[0]
        GLES30.glBindBuffer(GLES30.GL_ELEMENT_ARRAY_BUFFER, indexBuffer)
        GLES30.glBufferData(
            GLES30.GL_ELEMENT_ARRAY_BUFFER,
            indices.size * Short.SIZE_BYTES,
            indices.toNativeBuffer(),
            GLES30.GL_STATIC_DRAW,
        )

        val stride = 5 * Float.SIZE_BYTES
        GLES30.glEnableVertexAttribArray(0)
        GLES30.glVertexAttribPointer(0, 3, GLES30.GL_FLOAT, false, stride, 0)
        GLES30.glEnableVertexAttribArray(1)
        GLES30.glVertexAttribPointer(
            1,
            2,
            GLES30.GL_FLOAT,
            false,
            stride,
            3 * Float.SIZE_BYTES,
        )
        GLES30.glBindVertexArray(0)
        return TextGlMesh(vao, vertexBuffer, indexBuffer, indices.size)
    }

    private fun createTextTexture(label: String): Int {
        val width = 768
        val height = 160
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
            color = Color.rgb(255, 244, 205)
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            textSize = 82f
            setShadowLayer(3f, 1.5f, 2f, Color.argb(180, 65, 38, 18))
        }
        val maximumWidth = width * .94f
        while (paint.measureText(label) > maximumWidth && paint.textSize > 36f) {
            paint.textSize -= 2f
        }
        val baseline = height / 2f - (paint.ascent() + paint.descent()) / 2f
        canvas.drawText(label, width / 2f, baseline, paint)

        val handles = IntArray(1)
        GLES30.glGenTextures(1, handles, 0)
        val texture = handles[0]
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, texture)
        GLES30.glTexParameteri(
            GLES30.GL_TEXTURE_2D,
            GLES30.GL_TEXTURE_MIN_FILTER,
            GLES30.GL_LINEAR_MIPMAP_LINEAR,
        )
        GLES30.glTexParameteri(
            GLES30.GL_TEXTURE_2D,
            GLES30.GL_TEXTURE_MAG_FILTER,
            GLES30.GL_LINEAR,
        )
        GLES30.glTexParameteri(
            GLES30.GL_TEXTURE_2D,
            GLES30.GL_TEXTURE_WRAP_S,
            GLES30.GL_CLAMP_TO_EDGE,
        )
        GLES30.glTexParameteri(
            GLES30.GL_TEXTURE_2D,
            GLES30.GL_TEXTURE_WRAP_T,
            GLES30.GL_CLAMP_TO_EDGE,
        )
        GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, bitmap, 0)
        GLES30.glGenerateMipmap(GLES30.GL_TEXTURE_2D)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, 0)
        bitmap.recycle()
        return texture
    }

    private fun createProgram(vertexSource: String, fragmentSource: String): Int {
        val vertex = compileShader(GLES30.GL_VERTEX_SHADER, vertexSource)
        val fragment = compileShader(GLES30.GL_FRAGMENT_SHADER, fragmentSource)
        val result = GLES30.glCreateProgram()
        GLES30.glAttachShader(result, vertex)
        GLES30.glAttachShader(result, fragment)
        GLES30.glLinkProgram(result)
        val status = IntArray(1)
        GLES30.glGetProgramiv(result, GLES30.GL_LINK_STATUS, status, 0)
        check(status[0] == GLES30.GL_TRUE) {
            "Scene shader link failed: ${GLES30.glGetProgramInfoLog(result)}"
        }
        GLES30.glDeleteShader(vertex)
        GLES30.glDeleteShader(fragment)
        return result
    }

    private fun compileShader(type: Int, source: String): Int {
        val shader = GLES30.glCreateShader(type)
        GLES30.glShaderSource(shader, source)
        GLES30.glCompileShader(shader)
        val status = IntArray(1)
        GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, status, 0)
        check(status[0] == GLES30.GL_TRUE) {
            "Scene shader compile failed: ${GLES30.glGetShaderInfoLog(shader)}"
        }
        return shader
    }

    private fun color(hex: String, alpha: Float = 1f): FloatArray {
        // Animated particles previously inserted a unique floating-point alpha
        // every frame. A small fixed palette is visually smooth and keeps this
        // cache bounded during long-running story sessions.
        val alphaStep = (alpha.coerceIn(0f, 1f) * 64f).roundToInt()
        val alphaSlots = colorCache.getOrPut(hex) { arrayOfNulls(65) }
        alphaSlots[alphaStep]?.let { return it }
        return run {
            val value = Color.parseColor(hex)
            floatArrayOf(
                Color.red(value) / 255f,
                Color.green(value) / 255f,
                Color.blue(value) / 255f,
                alphaStep / 64f,
            )
        }.also { alphaSlots[alphaStep] = it }
    }

    private fun pseudo(seed: Int): Float {
        val x = sin(seed * 12.9898) * 43758.5453
        return (x - kotlin.math.floor(x)).toFloat()
    }

    companion object {
        private const val FOLLOW_CAMERA_BIAS_DEGREES = 110f
        private const val INSTANCED_VERTEX_SHADER = """#version 300 es
            layout(location = 0) in vec3 aPosition;
            layout(location = 1) in vec3 aNormal;
            layout(location = 3) in vec4 aInstanceColumn0;
            layout(location = 4) in vec4 aInstanceColumn1;
            layout(location = 5) in vec4 aInstanceColumn2;
            layout(location = 6) in vec4 aInstanceColumn3;
            uniform mat4 uProjectionView;
            out vec3 vNormal;
            out vec3 vWorldPosition;
            void main() {
                mat4 instanceModel = mat4(
                    aInstanceColumn0,
                    aInstanceColumn1,
                    aInstanceColumn2,
                    aInstanceColumn3
                );
                vec4 worldPosition = instanceModel * vec4(aPosition, 1.0);
                vWorldPosition = worldPosition.xyz;
                vNormal = mat3(instanceModel) * aNormal;
                gl_Position = uProjectionView * worldPosition;
            }
        """

        private const val VERTEX_SHADER = """#version 300 es
            layout(location = 0) in vec3 aPosition;
            layout(location = 1) in vec3 aNormal;
            uniform mat4 uMvp;
            uniform mat4 uModel;
            uniform mat3 uNormalMatrix;
            out vec3 vNormal;
            out vec3 vWorldPosition;
            void main() {
                vec4 world = uModel * vec4(aPosition, 1.0);
                vWorldPosition = world.xyz;
                vNormal = normalize(uNormalMatrix * aNormal);
                gl_Position = uMvp * vec4(aPosition, 1.0);
            }
        """

        private const val FRAGMENT_SHADER = """#version 300 es
            precision mediump float;
            uniform vec4 uColor;
            uniform vec3 uLight;
            uniform vec3 uCamera;
            uniform vec3 uFogColor;
            uniform float uRimStrength;
            in vec3 vNormal;
            in vec3 vWorldPosition;
            out vec4 outColor;
            void main() {
                vec3 normal = normalize(vNormal);
                float diffuse = max(dot(normal, normalize(uLight)), 0.0);
                float band = diffuse < 0.16 ? 0.44 :
                    (diffuse < 0.43 ? 0.62 : (diffuse < 0.72 ? 0.82 : 1.04));
                vec3 base = uColor.rgb;
                vec3 coolShadow = vec3(0.42, 0.43, 0.62);
                vec3 warmLight = vec3(1.0, 0.95, 0.84);
                vec3 lit = base * band;
                lit = mix(lit, lit * coolShadow, (1.0 - band) * 0.30);
                lit = mix(lit, lit * warmLight, max(band - 0.80, 0.0) * 0.50);
                vec3 viewDirection = normalize(uCamera - vWorldPosition);
                float rimBase = 1.0 - max(dot(normal, viewDirection), 0.0);
                float rim = rimBase * rimBase * uRimStrength;
                lit += vec3(1.0, 0.95, 0.84) * rim;
                float distanceToCamera = distance(uCamera, vWorldPosition);
                float fog = smoothstep(21.0, 41.0, distanceToCamera);
                vec3 finalColor = mix(lit, uFogColor, fog);
                outColor = vec4(finalColor, uColor.a);
            }
        """

        private const val TEXT_VERTEX_SHADER = """#version 300 es
            layout(location = 0) in vec3 aPosition;
            layout(location = 1) in vec2 aTextureCoordinate;
            uniform mat4 uMvp;
            out vec2 vTextureCoordinate;
            void main() {
                vTextureCoordinate = aTextureCoordinate;
                gl_Position = uMvp * vec4(aPosition, 1.0);
            }
        """

        private const val TEXT_FRAGMENT_SHADER = """#version 300 es
            precision mediump float;
            uniform sampler2D uTexture;
            in vec2 vTextureCoordinate;
            out vec4 outColor;
            void main() {
                vec4 sampleColor = texture(uTexture, vTextureCoordinate);
                if (sampleColor.a < 0.04) {
                    discard;
                }
                outColor = sampleColor;
            }
        """
    }
}

private data class Transform(
    val x: Float,
    val y: Float,
    val z: Float,
    val scaleX: Float,
    val scaleY: Float,
    val scaleZ: Float,
    val rotationX: Float = 0f,
    val rotationY: Float = 0f,
    val rotationZ: Float = 0f,
)

private val IDENTITY_TRANSFORM = Transform(0f, 0f, 0f, 1f, 1f, 1f)

private data class MeshPart(
    val data: MeshData,
    val transform: Transform,
)

private data class BatchStyle(
    val hex: String,
    val alpha: Float = 1f,
    val rimStrength: Float = .14f,
)

private data class StaticBatch(
    val mesh: GlMesh,
    val color: FloatArray,
    val rimStrength: Float,
)

private data class DynamicInstanceStyle(
    val mesh: GlMesh,
    val hex: String,
    val alpha: Float,
    val rimStrength: Float,
)

private data class ForestRing(
    val radius: Float,
    val count: Int,
    val tint: String,
    val topTint: String,
    val baseSize: Float,
)

private data class PolarPoint(
    val angle: Float,
    val radius: Float,
)

private data class LeafBurst(
    val x: Float,
    val y: Float,
    val z: Float,
    val seed: Int,
    var startedAtMs: Long,
)

private data class HedgehogJourney(
    val mushroomIndex: Int,
    val seed: Int,
    var startedAtMs: Long,
)

private data class PondPoint(
    val x: Float,
    val z: Float,
    val size: Float,
)

private data class WorldPoint3(
    val x: Float,
    val y: Float,
    val z: Float,
)

private data class ScreenPoint(
    val x: Float,
    val y: Float,
    val depth: Float,
)

private data class TapTarget(
    val id: String,
    val payload: Int,
    val normalizedDistance: Float,
    val depth: Float,
)

private enum class FishingKind {
    SILVER,
    BOOT,
    GOLD,
}

private enum class AnimalReaction {
    NONE,
    HARE,
    WOLF,
    BEAR,
    FOX,
}

private enum class AmbientReaction {
    NONE,
    TREE,
    MEADOW,
    PATH,
    BUTTERFLIES,
    HIVE,
}

private data class Particle(
    val x: Float,
    val y: Float,
    val z: Float,
    val phase: Float,
)

private data class GlMesh(
    val vao: Int,
    val vertexBuffer: Int,
    val indexBuffer: Int,
    val indexCount: Int,
)

private data class TextGlMesh(
    val vao: Int,
    val vertexBuffer: Int,
    val indexBuffer: Int,
    val indexCount: Int,
)

private data class MeshData(
    val vertices: FloatArray,
    val indices: ShortArray,
)

private object Geometry {
    fun merge(parts: List<MeshPart>): MeshData {
        val vertexFloatCount = parts.sumOf { it.data.vertices.size }
        val indexCount = parts.sumOf { it.data.indices.size }
        val vertexCount = vertexFloatCount / 6
        require(vertexCount <= 65_535) {
            "Merged scene batch exceeds the unsigned-short vertex limit: $vertexCount"
        }

        val mergedVertices = FloatArray(vertexFloatCount)
        val mergedIndices = ShortArray(indexCount)
        var vertexFloatOffset = 0
        var indexOffset = 0
        var vertexOffset = 0

        val model = FloatArray(16)
        val normalModel = FloatArray(16)
        val position = FloatArray(4)
        val transformedPosition = FloatArray(4)
        val normal = FloatArray(4)
        val transformedNormal = FloatArray(4)

        parts.forEach { part ->
            val transform = part.transform
            Matrix.setIdentityM(model, 0)
            Matrix.translateM(model, 0, transform.x, transform.y, transform.z)
            if (transform.rotationY != 0f) Matrix.rotateM(model, 0, transform.rotationY, 0f, 1f, 0f)
            if (transform.rotationX != 0f) Matrix.rotateM(model, 0, transform.rotationX, 1f, 0f, 0f)
            if (transform.rotationZ != 0f) Matrix.rotateM(model, 0, transform.rotationZ, 0f, 0f, 1f)
            Matrix.scaleM(model, 0, transform.scaleX, transform.scaleY, transform.scaleZ)

            Matrix.setIdentityM(normalModel, 0)
            if (transform.rotationY != 0f) Matrix.rotateM(normalModel, 0, transform.rotationY, 0f, 1f, 0f)
            if (transform.rotationX != 0f) Matrix.rotateM(normalModel, 0, transform.rotationX, 1f, 0f, 0f)
            if (transform.rotationZ != 0f) Matrix.rotateM(normalModel, 0, transform.rotationZ, 0f, 0f, 1f)
            Matrix.scaleM(
                normalModel,
                0,
                1f / transform.scaleX.coerceAtLeast(.0001f),
                1f / transform.scaleY.coerceAtLeast(.0001f),
                1f / transform.scaleZ.coerceAtLeast(.0001f),
            )

            var source = 0
            while (source < part.data.vertices.size) {
                position[0] = part.data.vertices[source]
                position[1] = part.data.vertices[source + 1]
                position[2] = part.data.vertices[source + 2]
                position[3] = 1f
                Matrix.multiplyMV(transformedPosition, 0, model, 0, position, 0)

                normal[0] = part.data.vertices[source + 3]
                normal[1] = part.data.vertices[source + 4]
                normal[2] = part.data.vertices[source + 5]
                normal[3] = 0f
                Matrix.multiplyMV(transformedNormal, 0, normalModel, 0, normal, 0)
                val normalLength = sqrt(
                    transformedNormal[0] * transformedNormal[0] +
                        transformedNormal[1] * transformedNormal[1] +
                        transformedNormal[2] * transformedNormal[2],
                ).coerceAtLeast(.0001f)

                mergedVertices[vertexFloatOffset] = transformedPosition[0]
                mergedVertices[vertexFloatOffset + 1] = transformedPosition[1]
                mergedVertices[vertexFloatOffset + 2] = transformedPosition[2]
                mergedVertices[vertexFloatOffset + 3] = transformedNormal[0] / normalLength
                mergedVertices[vertexFloatOffset + 4] = transformedNormal[1] / normalLength
                mergedVertices[vertexFloatOffset + 5] = transformedNormal[2] / normalLength
                source += 6
                vertexFloatOffset += 6
            }

            part.data.indices.forEach { index ->
                mergedIndices[indexOffset++] = (index.toInt() and 0xFFFF)
                    .plus(vertexOffset)
                    .toShort()
            }
            vertexOffset += part.data.vertices.size / 6
        }
        return MeshData(mergedVertices, mergedIndices)
    }

    fun sphere(longitudes: Int, latitudes: Int): MeshData {
        val vertices = mutableListOf<Float>()
        val indices = mutableListOf<Short>()
        for (latitude in 0..latitudes) {
            val v = latitude.toFloat() / latitudes
            val theta = v * PI
            val y = cos(theta).toFloat()
            val ring = sin(theta).toFloat()
            for (longitude in 0..longitudes) {
                val u = longitude.toFloat() / longitudes
                val phi = u * PI * 2.0
                val x = (ring * sin(phi)).toFloat()
                val z = (ring * cos(phi)).toFloat()
                vertices += listOf(x, y, z, x, y, z)
            }
        }
        for (latitude in 0 until latitudes) {
            for (longitude in 0 until longitudes) {
                val first = (latitude * (longitudes + 1) + longitude).toShort()
                val second = (first + longitudes + 1).toShort()
                indices += first
                indices += second
                indices += (first + 1).toShort()
                indices += second
                indices += (second + 1).toShort()
                indices += (first + 1).toShort()
            }
        }
        return MeshData(vertices.toFloatArray(), indices.toShortArray())
    }

    fun cube(): MeshData {
        val faces = arrayOf(
            floatArrayOf(0f, 0f, 1f, -1f, -1f, 1f, 1f, -1f, 1f, 1f, 1f, 1f, -1f, 1f, 1f),
            floatArrayOf(0f, 0f, -1f, 1f, -1f, -1f, -1f, -1f, -1f, -1f, 1f, -1f, 1f, 1f, -1f),
            floatArrayOf(1f, 0f, 0f, 1f, -1f, 1f, 1f, -1f, -1f, 1f, 1f, -1f, 1f, 1f, 1f),
            floatArrayOf(-1f, 0f, 0f, -1f, -1f, -1f, -1f, -1f, 1f, -1f, 1f, 1f, -1f, 1f, -1f),
            floatArrayOf(0f, 1f, 0f, -1f, 1f, 1f, 1f, 1f, 1f, 1f, 1f, -1f, -1f, 1f, -1f),
            floatArrayOf(0f, -1f, 0f, -1f, -1f, -1f, 1f, -1f, -1f, 1f, -1f, 1f, -1f, -1f, 1f),
        )
        val vertices = mutableListOf<Float>()
        val indices = mutableListOf<Short>()
        faces.forEachIndexed { faceIndex, face ->
            val nx = face[0]
            val ny = face[1]
            val nz = face[2]
            for (vertex in 0 until 4) {
                val offset = 3 + vertex * 3
                vertices += listOf(face[offset], face[offset + 1], face[offset + 2], nx, ny, nz)
            }
            val base = (faceIndex * 4).toShort()
            indices += listOf(base, (base + 1).toShort(), (base + 2).toShort(), base, (base + 2).toShort(), (base + 3).toShort())
        }
        return MeshData(vertices.toFloatArray(), indices.toShortArray())
    }

    fun triangularPrism(): MeshData {
        val vertices = mutableListOf<Float>()
        val indices = mutableListOf<Short>()

        fun addFace(
            normalX: Float,
            normalY: Float,
            normalZ: Float,
            points: List<FloatArray>,
        ) {
            val base = (vertices.size / 6).toShort()
            points.forEach { point ->
                vertices += listOf(
                    point[0],
                    point[1],
                    point[2],
                    normalX,
                    normalY,
                    normalZ,
                )
            }
            indices += listOf(base, (base + 1).toShort(), (base + 2).toShort())
            if (points.size == 4) {
                indices += listOf(base, (base + 2).toShort(), (base + 3).toShort())
            }
        }

        addFace(
            0f,
            0f,
            1f,
            listOf(
                floatArrayOf(-1f, -1f, 1f),
                floatArrayOf(1f, -1f, 1f),
                floatArrayOf(0f, 1f, 1f),
            ),
        )
        addFace(
            0f,
            0f,
            -1f,
            listOf(
                floatArrayOf(1f, -1f, -1f),
                floatArrayOf(-1f, -1f, -1f),
                floatArrayOf(0f, 1f, -1f),
            ),
        )
        addFace(
            0f,
            -1f,
            0f,
            listOf(
                floatArrayOf(-1f, -1f, -1f),
                floatArrayOf(1f, -1f, -1f),
                floatArrayOf(1f, -1f, 1f),
                floatArrayOf(-1f, -1f, 1f),
            ),
        )
        addFace(
            -.8944f,
            .4472f,
            0f,
            listOf(
                floatArrayOf(-1f, -1f, -1f),
                floatArrayOf(-1f, -1f, 1f),
                floatArrayOf(0f, 1f, 1f),
                floatArrayOf(0f, 1f, -1f),
            ),
        )
        addFace(
            .8944f,
            .4472f,
            0f,
            listOf(
                floatArrayOf(1f, -1f, 1f),
                floatArrayOf(1f, -1f, -1f),
                floatArrayOf(0f, 1f, -1f),
                floatArrayOf(0f, 1f, 1f),
            ),
        )
        return MeshData(vertices.toFloatArray(), indices.toShortArray())
    }

    fun cylinder(segments: Int): MeshData {
        val vertices = mutableListOf<Float>()
        val indices = mutableListOf<Short>()

        // Side vertices have radial normals.
        for (index in 0..segments) {
            val angle = index.toDouble() / segments * PI * 2.0
            val x = sin(angle).toFloat()
            val z = cos(angle).toFloat()
            vertices += listOf(x, -1f, z, x, 0f, z)
            vertices += listOf(x, 1f, z, x, 0f, z)
        }
        for (index in 0 until segments) {
            val base = (index * 2).toShort()
            indices += listOf(
                base,
                (base + 2).toShort(),
                (base + 1).toShort(),
                (base + 2).toShort(),
                (base + 3).toShort(),
                (base + 1).toShort(),
            )
        }

        // Caps need their own vertices and vertical normals; sharing the side
        // ring creates the radial dark wedges the prototype showed.
        val bottomCenter = (vertices.size / 6).toShort()
        vertices += listOf(0f, -1f, 0f, 0f, -1f, 0f)
        val bottomRing = (vertices.size / 6).toShort()
        for (index in 0..segments) {
            val angle = index.toDouble() / segments * PI * 2.0
            vertices += listOf(
                sin(angle).toFloat(),
                -1f,
                cos(angle).toFloat(),
                0f,
                -1f,
                0f,
            )
        }
        val topCenter = (vertices.size / 6).toShort()
        vertices += listOf(0f, 1f, 0f, 0f, 1f, 0f)
        val topRing = (vertices.size / 6).toShort()
        for (index in 0..segments) {
            val angle = index.toDouble() / segments * PI * 2.0
            vertices += listOf(
                sin(angle).toFloat(),
                1f,
                cos(angle).toFloat(),
                0f,
                1f,
                0f,
            )
        }
        for (index in 0 until segments) {
            val bottomCurrent = (bottomRing + index).toShort()
            val bottomNext = (bottomRing + index + 1).toShort()
            val topCurrent = (topRing + index).toShort()
            val topNext = (topRing + index + 1).toShort()
            indices += listOf(bottomCenter, bottomNext, bottomCurrent)
            indices += listOf(topCenter, topCurrent, topNext)
        }
        return MeshData(vertices.toFloatArray(), indices.toShortArray())
    }

    fun cone(segments: Int): MeshData {
        val vertices = mutableListOf<Float>()
        val indices = mutableListOf<Short>()
        val slope = 1f / sqrt(2f)
        for (index in 0..segments) {
            val angle = index.toDouble() / segments * PI * 2.0
            val x = sin(angle).toFloat()
            val z = cos(angle).toFloat()
            vertices += listOf(x, -1f, z, x * slope, slope, z * slope)
            vertices += listOf(0f, 1f, 0f, x * slope, slope, z * slope)
        }
        for (index in 0 until segments) {
            val base = (index * 2).toShort()
            indices += listOf(base, (base + 2).toShort(), (base + 1).toShort())
        }
        val center = (vertices.size / 6).toShort()
        vertices += listOf(0f, -1f, 0f, 0f, -1f, 0f)
        val baseRing = (vertices.size / 6).toShort()
        for (index in 0..segments) {
            val angle = index.toDouble() / segments * PI * 2.0
            vertices += listOf(
                sin(angle).toFloat(),
                -1f,
                cos(angle).toFloat(),
                0f,
                -1f,
                0f,
            )
        }
        for (index in 0 until segments) {
            val current = (baseRing + index).toShort()
            val next = (baseRing + index + 1).toShort()
            indices += listOf(center, next, current)
        }
        return MeshData(vertices.toFloatArray(), indices.toShortArray())
    }

    fun ring(segments: Int, innerRadius: Float): MeshData {
        val vertices = mutableListOf<Float>()
        val indices = mutableListOf<Short>()
        for (index in 0..segments) {
            val angle = index.toDouble() / segments * PI * 2.0
            val x = sin(angle).toFloat()
            val z = cos(angle).toFloat()
            vertices += listOf(x, 0f, z, 0f, 1f, 0f)
            vertices += listOf(x * innerRadius, 0f, z * innerRadius, 0f, 1f, 0f)
        }
        for (index in 0 until segments) {
            val outer = (index * 2).toShort()
            val inner = (outer + 1).toShort()
            val nextOuter = (outer + 2).toShort()
            val nextInner = (outer + 3).toShort()
            indices += listOf(
                outer,
                nextOuter,
                inner,
                nextOuter,
                nextInner,
                inner,
            )
        }
        return MeshData(vertices.toFloatArray(), indices.toShortArray())
    }
}

private fun FloatArray.toNativeBuffer(): FloatBuffer =
    ByteBuffer.allocateDirect(size * Float.SIZE_BYTES)
        .order(ByteOrder.nativeOrder())
        .asFloatBuffer()
        .apply {
            put(this@toNativeBuffer)
            position(0)
        }

private fun ShortArray.toNativeBuffer(): ShortBuffer =
    ByteBuffer.allocateDirect(size * Short.SIZE_BYTES)
        .order(ByteOrder.nativeOrder())
        .asShortBuffer()
        .apply {
            put(this@toNativeBuffer)
            position(0)
        }
