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
import java.util.Calendar
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

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
    private var renderScale = .88f
    private val storyRenderer = StorySceneRenderer { suggestedScale ->
        post {
            if (suggestedScale < renderScale) {
                renderScale = suggestedScale
                applyRenderScale()
            }
        }
    }
    var onCrossroadsAction: ((CrossroadsAction) -> Unit)? = null
    var onSceneInteraction: ((SceneInteraction) -> Unit)? = null
    var onSceneInteractionEvent: ((SceneInteractionEvent) -> Unit)? = null
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
        storyRenderer.setAutoplayAllowed(android.animation.ValueAnimator.areAnimatorsEnabled())
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
                    )?.let(::dispatchTapResult)
                }
                return true
            }

            MotionEvent.ACTION_POINTER_DOWN -> {
                velocityTracker?.addMovement(event)
                if (event.pointerCount >= 2) pinchDistance = pointerDistance(event)
                moved = true
                queueEvent {
                    storyRenderer.releaseTreeBonk()
                    storyRenderer.cancelPressedTreeTap()
                }
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
                        storyRenderer.beginCameraGesture()
                        queueEvent {
                            storyRenderer.releaseTreeBonk()
                            storyRenderer.cancelPressedTreeTap()
                        }
                        // Apply the complete buffered drag once so slow,
                        // deliberate motion remains responsive after slop.
                        storyRenderer.orbitBy(
                            yawDegrees = -totalX * 0.28f,
                            pitchDegrees = -totalY * 0.22f,
                        )
                    } else if (moved && (dx != 0f || dy != 0f)) {
                        storyRenderer.orbitBy(
                            yawDegrees = -dx * 0.28f,
                            pitchDegrees = -dy * 0.22f,
                        )
                    }
                    if (moved && sqrt(totalX * totalX + totalY * totalY) > 40f) {
                        queueEvent(storyRenderer::cancelInteractiveEncounter)
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
                        pitchDegreesPerSecond = 0f,
                    )
                }
                if (!moved) {
                    super.performClick()
                    val tapX = event.x
                    val tapY = event.y
                    val tapWidth = width
                    val tapHeight = height
                    queueEvent {
                        storyRenderer.releaseTreeBonk()
                        storyRenderer.tapAt(tapX, tapY, tapWidth, tapHeight)?.let { result ->
                            dispatchTapResult(result)
                        }
                    }
                } else {
                    queueEvent {
                        storyRenderer.releaseTreeBonk()
                        storyRenderer.cancelPressedTreeTap()
                    }
                }
                queueEvent(storyRenderer::endCameraGesture)
                velocityTracker?.recycle()
                velocityTracker = null
                orbitPointerId = MotionEvent.INVALID_POINTER_ID
                pinchDistance = 0f
                parent?.requestDisallowInterceptTouchEvent(false)
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                queueEvent {
                    storyRenderer.releaseTreeBonk()
                    storyRenderer.cancelPressedTreeTap()
                    storyRenderer.endCameraGesture()
                }
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
        applyRenderScale()
    }

    private fun applyRenderScale() {
        if (width <= 0 || height <= 0) return
        holder.setFixedSize(
            (width * renderScale).roundToInt().coerceAtLeast(1),
            (height * renderScale).roundToInt().coerceAtLeast(1),
        )
    }

    override fun performClick(): Boolean {
        return super.performClick()
    }

    private fun dispatchTapResult(result: SceneTapResult) {
        post {
            when (result.haptic) {
                SceneHaptic.NONE -> Unit
                SceneHaptic.LIGHT ->
                    performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                SceneHaptic.MEDIUM ->
                    performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
            }
        }
        val deliverResult = {
            result.crossroadsAction?.let { onCrossroadsAction?.invoke(it) }
            result.interaction?.let { interaction ->
                onSceneInteraction?.invoke(interaction)
                onSceneInteractionEvent?.invoke(
                    SceneInteractionEvent(
                        interaction = interaction,
                        variant = result.variant,
                    ),
                )
            }
            Unit
        }
        if (result.crossroadsAction != null) {
            postDelayed(deliverResult, CROSSROADS_NAVIGATION_DELAY_MS)
        } else {
            post(deliverResult)
        }
    }

    fun requestStoryPlay() = queueEvent(storyRenderer::requestStoryPlay)

    fun requestStoryPause() = queueEvent(storyRenderer::requestStoryPause)

    fun noteUserInput() = queueEvent(storyRenderer::noteUserInput)

    fun setAutoplayAllowed(allowed: Boolean) =
        queueEvent { storyRenderer.setAutoplayAllowed(allowed) }

    fun setSceneRotationEnabled(enabled: Boolean) =
        storyRenderer.setSceneRotationEnabled(enabled)

    fun setFollowKolobok(enabled: Boolean) = storyRenderer.setFollowKolobok(enabled)

    fun resetCamera() = storyRenderer.resetCamera()

    fun setWeather(weather: SceneWeather) =
        queueEvent { storyRenderer.setWeather(weather) }

    fun setEnvironment(observation: SceneWeatherObservation) =
        queueEvent { storyRenderer.setEnvironment(observation) }

    fun setRockMenuLanguage(russian: Boolean) = storyRenderer.setRockMenuLanguage(russian)

    fun storyTimeSeconds(): Int = storyRenderer.transformSnapshot().storyTime.toInt()

    internal fun storySnapshot(): SceneStorySnapshot = storyRenderer.storySnapshot()

    internal fun encounterSnapshot(): SceneEncounterSnapshot =
        storyRenderer.encounterSnapshot()

    internal fun bubbleAnchor(): SceneBubbleAnchor? = storyRenderer.bubbleAnchor()

    internal fun activeZone(): SceneZone = storyRenderer.activeZone()

    internal fun transformSnapshotForTest(): SceneFrame = storyRenderer.transformSnapshot()

    private fun pointerDistance(event: MotionEvent): Float {
        if (event.pointerCount < 2) return 0f
        val dx = event.getX(0) - event.getX(1)
        val dy = event.getY(0) - event.getY(1)
        return sqrt(dx * dx + dy * dy)
    }

    private companion object {
        const val CROSSROADS_NAVIGATION_DELAY_MS = 250L
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
    PARTLY,
    OVERCAST,
    FOG,
    RAIN,
    SNOW,
    STORM,
}

enum class CrossroadsAction {
    ADD_BOOK,
    CREATE_STORY,
    LIBRARY,
}

enum class SceneZone {
    IZBA,
    HARE,
    WOLF,
    BEAR,
    FOX,
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
    SUN_GLOW,
    BUTTERFLY_DANCE,
    HIVE_BUZZ,
}

data class SceneInteractionEvent(
    val interaction: SceneInteraction,
    val variant: SceneInteractionVariant? = null,
)

data class SceneBubbleAnchor(
    val xFraction: Float,
    val yFraction: Float,
)

enum class SceneInteractionVariant {
    FISH_SILVER,
    FISH_BOOT,
    FISH_GOLD,
}

private data class SceneTapResult(
    val crossroadsAction: CrossroadsAction? = null,
    val interaction: SceneInteraction? = null,
    val variant: SceneInteractionVariant? = null,
    val haptic: SceneHaptic = SceneHaptic.LIGHT,
)

private enum class SceneHaptic {
    NONE,
    LIGHT,
    MEDIUM,
}

private class StorySceneRenderer(
    private val onRenderScaleSuggested: (Float) -> Unit,
) : GLSurfaceView.Renderer {
    private val transforms = SceneTransformState()
    private val storyDirector = SceneStoryDirector()
    private val encounterDirector = SceneEncounterDirector()
    private val eggRegistry = SceneEggRegistry()
    private val atmosphereDirector = SceneAtmosphereDirector()
    private val adaptiveQuality = SceneAdaptiveQualityController()
    private val lifeDirector = SceneLifeDirector()
    private val introCameraDirector =
        SceneIntroCameraDirector(SystemClock.uptimeMillis())
    private var frame = SceneFrame()
    @Volatile
    private var latestStory = storyDirector.snapshot()
    @Volatile
    private var latestEncounter = SceneEncounterSnapshot()
    @Volatile
    private var latestBubbleAnchor: SceneBubbleAnchor? = null
    @Volatile
    private var lastCameraInputMs = 0L
    @Volatile
    private var renderedCameraYaw = 180f
    private var renderedCameraPitch = 24f
    private var renderedCameraDistance = 13.2f
    private var followCameraActive = false
    @Volatile
    private var cinematicCameraActive = false
    @Volatile
    private var introCameraHoldingActive = true
    private var actorDrawAlpha = 1f
    private var kolobokRollDegrees = 0f
    private var kolobokLinearSpeed = 0f
    private var previousKolobokAngle = latestStory.kolobokAngleRadians
    private var renderedHappyExpression = 0f
    private var renderedStartledExpression = 0f
    private var renderedSlyExpression = 0f
    @Volatile
    private var weather = SceneWeather.CLEAR
    private var latestAtmosphere = atmosphereDirector.snapshot()
    private var localHour = 12f
    private var lastClockSampleMs = 0L
    private var solarLatitude: Double? = null
    private var solarLongitude: Double? = null
    private var solarElevationDegrees: Float? = null
    private var retainedWetness = 0f
    private var lastFrameMs = 0L
    private var pausedAtMs = 0L
    private var latestDeltaSeconds = 0f
    @Volatile
    private var yawVelocity = 0f
    @Volatile
    private var pitchVelocity = 0f
    @Volatile
    private var greetingUntilMs = 0L
    private var foxTailTipSwayDegrees = 0f

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
    private var crossroadsTextMeshes = emptyList<TextGlMesh>()
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
    private var terrain: GlMesh? = null
    private var ring: GlMesh? = null
    private var pondBlob: GlMesh? = null
    private var crossroadsBoulder: GlMesh? = null
    private var crossroadsPlaqueMeshes = emptyList<GlMesh>()
    private var crossroadsPlaqueAccentMeshes = emptyList<GlMesh>()
    private var izbaRoofShingleBatches = emptyList<StaticBatch>()

    private val crossroadsPlaqueSpecs = listOf(
        CrossroadsPlaqueSpec(
            y = 1.76f,
            innerRadius = .63f,
            outerRadius = .87f,
            height = .34f,
            arcLength = 1.36f,
            azimuth = 18f,
            tilt = -3f,
            labelScaleX = .55f,
            labelScaleY = .105f,
        ),
        CrossroadsPlaqueSpec(
            y = 1.27f,
            innerRadius = .80f,
            outerRadius = 1.07f,
            height = .35f,
            arcLength = 1.52f,
            azimuth = -6f,
            tilt = 2f,
            labelScaleX = .62f,
            labelScaleY = .108f,
        ),
        CrossroadsPlaqueSpec(
            y = .78f,
            innerRadius = .89f,
            outerRadius = 1.17f,
            height = .33f,
            arcLength = 1.50f,
            azimuth = 14f,
            tilt = -2f,
            labelScaleX = .57f,
            labelScaleY = .102f,
        ),
    )

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
    private val dynamicColor = FloatArray(4)
    private val instanceBuffers = mutableMapOf<Int, Int>()
    private var instanceUploadBuffer: FloatBuffer? = null
    private val dynamicInstanceGroups =
        linkedMapOf<DynamicInstanceStyle, MutableList<Transform>>()
    private var eyeX = 0f
    private var eyeY = 0f
    private var eyeZ = 0f
    private var sceneSpaceEyeX = 0f
    private var sceneSpaceEyeZ = 0f
    private var cameraTargetX = 0f
    private var cameraTargetY = 1.1f
    private var cameraTargetZ = 0f
    private var cameraGestureActive = false
    private var renderedPlaqueHeading = 0f
    private var plaqueHeadingInitialized = false
    private var plaqueTurnActivity = 0f
    private val plaquePressedAtMs = LongArray(3)
    private var crossroadsNavigationPendingUntilMs = 0L
    private val greetingElapsedSeconds = FloatArray(SceneActor.entries.size) { -1f }
    private var previousGreetingStoryActor: SceneActor? = null
    private var previousGreetingEncounterActor: SceneActor? = null
    private var viewportWidth = 1
    private var viewportHeight = 1

    private var backgroundBatches = emptyList<StaticBatch>()
    private var vegetationBatches = emptyList<StaticBatch>()

    private var fishingStartedMs = 0L
    private var fishingKind = FishingKind.SILVER
    private var accumulatedBoots = 0
    private var owlStartedMs = 0L
    private var owlFlapStartedMs = 0L
    private var owlTapCount = 0
    private var owlLastTapMs = 0L
    private var owlTapTreeIndex = -1
    private var owlActiveTreeIndex = 2
    private var smokeRingsStartedMs = 0L
    private var izbaFlashStartedMs = 0L
    private val stoneBirdStartedAtMs = LongArray(STONE_BIRD_COUNT)
    private val stoneBirdCameraX = FloatArray(STONE_BIRD_COUNT)
    private val stoneBirdCameraZ = FloatArray(STONE_BIRD_COUNT)
    private var willowSwayStartedMs = 0L
    private val willowTapSequence = TimedTapSequence(
        requiredTaps = 3,
        windowMs = 3_000L,
    )
    private var magpiesStartedMs = 0L
    private var magpieFlightSeed = 0
    private var frogJumpStartedMs = 0L
    private val drizzleStartedAtMs = LongArray(SCENE_CLOUD_COUNT)
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
    private var foxEndingRebirthTriggered = false
    private var foxEndingCameraStartYaw = 0f
    private var foxEndingCameraStartPitch = 0f
    private var foxEndingCameraStartDistance = 0f
    private var foxEndingCameraStartTarget = WorldPoint3(0f, 1.1f, 0f)

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
    private val terrainHills = listOf(
        terrainHill(29f, 6.35f, 1.02f),
        terrainHill(48f, 7.02f, 1.16f),
        terrainHill(101f, 6.62f, .96f),
        terrainHill(120f, 7.08f, 1.19f),
        terrainHill(171f, 6.44f, 1.08f),
        terrainHill(193f, 7.02f, .94f),
        terrainHill(245f, 6.53f, 1.15f),
        terrainHill(265f, 7.06f, 1.00f),
        terrainHill(344f, 6.58f, 1.12f),
        terrainHill(43f, 2.52f, .94f),
        terrainHill(177f, 3.12f, 1.08f),
        terrainHill(302f, 2.72f, 1.01f),
    )
    private val terrainPotholes = listOf(
        terrainPothole(65f, 6.74f, .46f, .27f, 18f),
        terrainPothole(84f, 7.18f, .31f, .24f, 71f),
        terrainPothole(135f, 6.62f, .50f, .31f, 124f),
        terrainPothole(154f, 7.13f, .28f, .18f, 39f),
        terrainPothole(210f, 6.71f, .43f, .27f, 163f),
        terrainPothole(229f, 7.17f, .34f, .20f, 92f),
        terrainPothole(281f, 6.61f, .52f, .32f, 147f),
        terrainPothole(304f, 7.14f, .30f, .23f, 52f),
        terrainPothole(355f, 7.00f, .39f, .24f, 111f),
    )
    private val reactiveGrass = List(REACTIVE_GRASS_COUNT) { index ->
        ReactivePlant(
            angle = pseudo(index * 137 + 61) * 360f,
            radius = 2.40f + pseudo(index * 149 + 67) * 4.80f,
            yaw = pseudo(index * 157 + 73) * 360f,
            scale = .78f + pseudo(index * 163 + 79) * .52f,
        )
    }
    private val reactiveFlowers = List(REACTIVE_FLOWER_COUNT) { index ->
        ReactivePlant(
            angle = pseudo(index * 173 + 83) * 360f,
            radius = 3.20f + pseudo(index * 179 + 89) * 3.20f,
            yaw = pseudo(index * 181 + 97) * 360f,
            scale = .80f + pseudo(index * 191 + 101) * .50f,
        )
    }
    private val grassBendStartedAtMs = LongArray(REACTIVE_GRASS_COUNT)
    private val grassBendDirectionX = FloatArray(REACTIVE_GRASS_COUNT)
    private val grassBendDirectionZ = FloatArray(REACTIVE_GRASS_COUNT)
    private val flowerBendStartedAtMs = LongArray(REACTIVE_FLOWER_COUNT)
    private val flowerBendDirectionX = FloatArray(REACTIVE_FLOWER_COUNT)
    private val flowerBendDirectionZ = FloatArray(REACTIVE_FLOWER_COUNT)
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
        PolarPoint(284f, 6.92f),
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
        PolarPoint(72f, 7.08f),
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
    private var pressedTreeTapPending = false
    private val leafBursts = mutableListOf<LeafBurst>()
    private val hedgehogJourneys = mutableListOf<HedgehogJourney>()
    private val mushroomTakenAtMs = LongArray(mushroomSpots.size)
    private val mushroomReserved = BooleanArray(mushroomSpots.size)
    private var sunPosition = WorldPoint3(-7.8f, 8.7f, -13.5f)
    private var moonPosition = WorldPoint3(7.2f, 3.35f, -11.5f)

    private val rain = List(380) { index ->
        Particle(
            x = pseudo(index * 13 + 7) * 10f - 5f,
            y = pseudo(index * 29 + 3) * 5f + 1f,
            z = pseudo(index * 47 + 11) * 10f - 5f,
            phase = pseudo(index * 61 + 5) * 7f,
        )
    }
    private val snow = List(200) { index ->
        Particle(
            x = pseudo(index * 17 + 13) * 16f - 8f,
            y = pseudo(index * 31 + 19) * 6f + 2f,
            z = pseudo(index * 53 + 23) * 16f - 8f,
            phase = pseudo(index * 67 + 29) * 9f,
        )
    }
    private val rainTransforms = ArrayList<Transform>(rain.size)
    private val snowTransforms = ArrayList<Transform>(snow.size)

    fun orbitBy(yawDegrees: Float, pitchDegrees: Float) {
        noteCameraInput()
        transforms.orbitBy(yawDegrees, pitchDegrees)
    }

    fun zoomBy(scale: Float) {
        noteCameraInput()
        transforms.zoomBy(scale)
    }

    fun resetCamera() {
        noteCameraInput()
        transforms.resetCamera()
        yawVelocity = 0f
        pitchVelocity = 0f
    }

    fun flingOrbit(yawDegreesPerSecond: Float, pitchDegreesPerSecond: Float) {
        yawVelocity = yawDegreesPerSecond.coerceIn(-120f, 120f)
        pitchVelocity = pitchDegreesPerSecond.coerceIn(-65f, 65f)
    }

    fun beginCameraGesture() {
        cameraGestureActive = true
    }

    fun endCameraGesture() {
        cameraGestureActive = false
        pitchVelocity = 0f
    }

    fun greet() {
        greetingUntilMs = SystemClock.uptimeMillis() + 850L
    }

    fun requestStoryPlay() {
        storyDirector.noteUserInput()
        latestStory = storyDirector.requestPlay()
    }

    fun requestStoryPause() {
        storyDirector.noteUserInput()
        // Story camera motion is written back before ownership changes, so
        // pausing hands the exact current view to the user instead of
        // snapping to the stale pre-story yaw on the following frame.
        transforms.setCameraYaw(renderedCameraYaw)
        latestStory = storyDirector.requestPause()
    }

    fun noteCameraInput() {
        storyDirector.noteUserInput()
        introCameraDirector.releaseByCameraInput()
        transforms.setCameraYaw(renderedCameraYaw)
        lastCameraInputMs = SystemClock.uptimeMillis()
    }

    fun noteUserInput() {
        storyDirector.noteUserInput()
    }

    fun setAutoplayAllowed(allowed: Boolean) {
        storyDirector.setAutoplayAllowed(allowed)
    }

    fun cancelInteractiveEncounter() {
        encounterDirector.cancel()
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

    fun setEnvironment(observation: SceneWeatherObservation) {
        weather = observation.weather
        solarLatitude = observation.latitude
        solarLongitude = observation.longitude
        lastClockSampleMs = 0L
    }

    fun setRockMenuLanguage(russian: Boolean) {
        russianRockMenu = russian
    }

    fun storySnapshot(): SceneStorySnapshot = latestStory

    fun encounterSnapshot(): SceneEncounterSnapshot = latestEncounter

    fun bubbleAnchor(): SceneBubbleAnchor? = latestBubbleAnchor

    fun activeZone(): SceneZone {
        if (
            cinematicCameraActive &&
            !introCameraHoldingActive &&
            (
                latestStory.mode == SceneStoryMode.PLAYING ||
                    latestStory.mode == SceneStoryMode.REBIRTH
                )
        ) {
            val storyAngle = Math.toDegrees(
                latestStory.kolobokAngleRadians.toDouble(),
            ).toFloat()
            return zoneForAngle(storyAngle)
        }
        val zoneAngle = ((renderedCameraYaw - 180f) % 360f + 360f) % 360f
        return zoneForAngle(zoneAngle)
    }

    private fun zoneForAngle(angleDegrees: Float): SceneZone {
        val zoneAngle = ((angleDegrees % 360f) + 360f) % 360f
        return when (((zoneAngle + 36f) / 72f).toInt() % 5) {
            0 -> SceneZone.IZBA
            1 -> SceneZone.HARE
            2 -> SceneZone.WOLF
            3 -> SceneZone.BEAR
            else -> SceneZone.FOX
        }
    }

    private fun zoneCameraFraming(zone: SceneZone): ZoneCameraFraming {
        val (radius, height, lookAtHeight) = when (zone) {
            SceneZone.IZBA -> Triple(12.6f, 6.0f, 1.2f)
            SceneZone.HARE -> Triple(12.8f, 6.3f, 1.1f)
            SceneZone.WOLF -> Triple(13.3f, 6.8f, 1.3f)
            SceneZone.BEAR -> Triple(13.4f, 7.0f, 1.4f)
            SceneZone.FOX -> Triple(12.8f, 6.2f, 1.1f)
        }
        val rise = height - lookAtHeight
        return ZoneCameraFraming(
            distance = sqrt(radius * radius + rise * rise),
            pitchDegrees = Math.toDegrees(
                kotlin.math.atan2(rise.toDouble(), radius.toDouble()),
            ).toFloat(),
            lookAtHeight = lookAtHeight,
        )
    }

    private fun storyCameraFraming(story: SceneStorySnapshot): ZoneCameraFraming {
        val (radius, height, lookAtHeight) = when (story.chapter) {
            SceneStoryChapter.BIRTH -> Triple(12f, 5.2f, 1.2f)
            SceneStoryChapter.ROAD_TO_HARE,
            SceneStoryChapter.ROAD_TO_WOLF,
            SceneStoryChapter.ROAD_TO_BEAR,
            SceneStoryChapter.ROAD_TO_FOX,
            -> Triple(13f, 6.5f, 1.2f)

            SceneStoryChapter.HARE -> Triple(13.2f, 5.9f, .9f)
            SceneStoryChapter.WOLF -> Triple(13.2f, 6.3f, .9f)
            SceneStoryChapter.BEAR -> Triple(13.2f, 6.5f, .9f)
            SceneStoryChapter.FOX_FINALE -> Triple(13.2f, 5.9f, .9f)
        }
        val rise = height - lookAtHeight
        return ZoneCameraFraming(
            distance = sqrt(radius * radius + rise * rise),
            pitchDegrees = Math.toDegrees(
                kotlin.math.atan2(rise.toDouble(), radius.toDouble()),
            ).toFloat(),
            lookAtHeight = lookAtHeight,
        )
    }

    private fun introCameraFraming(): ZoneCameraFraming {
        val rise = INTRO_CAMERA_HEIGHT - INTRO_CAMERA_TARGET_Y
        return ZoneCameraFraming(
            distance = sqrt(
                INTRO_CAMERA_RADIUS * INTRO_CAMERA_RADIUS +
                    rise * rise,
            ),
            pitchDegrees = Math.toDegrees(
                kotlin.math.atan2(
                    rise.toDouble(),
                    INTRO_CAMERA_RADIUS.toDouble(),
                ),
            ).toFloat(),
            lookAtHeight = INTRO_CAMERA_TARGET_Y,
        )
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
            stoneBirdStartedAtMs.indices.forEach { index ->
                stoneBirdStartedAtMs[index] = shift(stoneBirdStartedAtMs[index])
            }
            willowSwayStartedMs = shift(willowSwayStartedMs)
            magpiesStartedMs = shift(magpiesStartedMs)
            frogJumpStartedMs = shift(frogJumpStartedMs)
            drizzleStartedAtMs.indices.forEach { index ->
                drizzleStartedAtMs[index] = shift(drizzleStartedAtMs[index])
            }
            grassBendStartedAtMs.indices.forEach { index ->
                grassBendStartedAtMs[index] = shift(grassBendStartedAtMs[index])
            }
            flowerBendStartedAtMs.indices.forEach { index ->
                flowerBendStartedAtMs[index] = shift(flowerBendStartedAtMs[index])
            }
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
            plaquePressedAtMs.indices.forEach { index ->
                plaquePressedAtMs[index] = shift(plaquePressedAtMs[index])
            }
            if (greetingUntilMs > 0L) greetingUntilMs += pausedDuration
            owlTapCount = 0
            owlLastTapMs = 0L
            owlTapTreeIndex = -1
            willowTapSequence.reset()
            foxTapCount = 0
            foxLastTapMs = 0L
            pausedAtMs = 0L
        }
        lastFrameMs = now
    }

    fun transformSnapshot(): SceneFrame = transforms.snapshot()

    override fun onSurfaceCreated(gl: javax.microedition.khronos.opengles.GL10?, config: javax.microedition.khronos.egl.EGLConfig?) {
        if (
            introCameraDirector.snapshot(SystemClock.uptimeMillis()).phase ==
            SceneIntroCameraPhase.HOLDING
        ) {
            val introFraming = introCameraFraming()
            cameraTargetX = INTRO_CAMERA_TARGET_X
            cameraTargetY = INTRO_CAMERA_TARGET_Y
            cameraTargetZ = INTRO_CAMERA_TARGET_Z
            renderedCameraYaw = INTRO_CAMERA_YAW
            renderedCameraPitch = introFraming.pitchDegrees
            renderedCameraDistance = introFraming.distance
        }
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
        terrain = createMesh(
            Geometry.terrainDisc(
                radius = 8f,
                rings = 32,
                segments = 128,
                hills = terrainHills,
                potholes = terrainPotholes,
            ),
        )
        ring = createMesh(Geometry.ring(64, .86f))
        pondBlob = createMesh(Geometry.irregularDisc(20, 140))
        crossroadsBoulder = createMesh(Geometry.profiledBoulder(20))
        crossroadsPlaqueMeshes = crossroadsPlaqueSpecs.mapIndexed { index, spec ->
            createMesh(
                Geometry.curvedArcBlock(
                    innerRadius = spec.innerRadius,
                    outerRadius = spec.outerRadius,
                    height = spec.height,
                    arc = spec.arcLength / spec.outerRadius,
                    segments = 20,
                    weatheringSeed = index * 71 + 19,
                ),
            )
        }
        crossroadsPlaqueAccentMeshes = crossroadsPlaqueSpecs.map { spec ->
            createMesh(
                Geometry.curvedArcBlock(
                    innerRadius = spec.innerRadius - .025f,
                    outerRadius = spec.outerRadius - .055f,
                    height = spec.height + .085f,
                    arc = spec.arcLength / spec.outerRadius * 1.10f,
                    segments = 20,
                ),
            )
        }
        crossroadsTextMeshes = crossroadsPlaqueSpecs.map { spec ->
            val radius = (spec.outerRadius + .035f) * CROSSROADS_SCALE
            createCurvedTextMesh(
                radius = radius,
                arc = spec.labelScaleX * 2f * .94f / radius,
                segments = 20,
            )
        }
        izbaRoofShingleBatches = createIzbaRoofShingleBatches(cubeData)
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
        lastFrameMs = SystemClock.uptimeMillis()
    }

    override fun onDrawFrame(gl: javax.microedition.khronos.opengles.GL10?) {
        val now = SystemClock.uptimeMillis()
        val rawFrameMs = (now - lastFrameMs).coerceAtLeast(0L)
        if (rawFrameMs in 1L..250L) {
            adaptiveQuality.recordFrame(rawFrameMs.toFloat())
                ?.let(onRenderScaleSuggested)
        }
        val delta = (rawFrameMs / 1000f).coerceIn(0f, .25f)
        latestDeltaSeconds = delta
        val flingDelta = min(.05f, delta)
        lastFrameMs = now
        if (abs(yawVelocity) > .05f || abs(pitchVelocity) > .05f) {
            transforms.orbitBy(yawVelocity * flingDelta, pitchVelocity * flingDelta)
            val damping = Math.pow(.055, flingDelta.toDouble()).toFloat()
            yawVelocity *= damping
            pitchVelocity *= damping
        }
        if (!cameraGestureActive) transforms.settlePitch(delta)
        frame = transforms.advance(delta)
        latestStory = storyDirector.advance(
            deltaSeconds = delta,
            blockedByEncounter = encounterDirector.isRunning(),
        )
        latestEncounter = encounterDirector.advance(delta)
        updateGreetingWaves(delta)
        if (lastClockSampleMs == 0L || now - lastClockSampleMs >= 60_000L) {
            val calendar = Calendar.getInstance()
            localHour =
                calendar.get(Calendar.HOUR_OF_DAY) +
                calendar.get(Calendar.MINUTE) / 60f +
                calendar.get(Calendar.SECOND) / 3_600f
            val solar = solarLatitude?.let { latitude ->
                solarLongitude?.let { longitude ->
                    sceneSolarPosition(
                        latitude = latitude,
                        longitude = longitude,
                        epochMillis = System.currentTimeMillis(),
                    )
                }
            }
            solarElevationDegrees = solar?.elevationDegrees
            if (solar != null) {
                sunPosition = solarCelestial(
                    azimuthDegrees = solar.azimuthDegrees,
                    elevationDegrees = solar.elevationDegrees,
                )
                moonPosition = solarCelestial(
                    azimuthDegrees = (solar.azimuthDegrees + 180f) % 360f,
                    elevationDegrees = max(8f, -solar.elevationDegrees),
                )
            } else {
                sunPosition = fallbackCelestial(hourOffset = 13f)
                moonPosition = fallbackCelestial(hourOffset = 1f)
            }
            lastClockSampleMs = now
        }
        atmosphereDirector.setWeather(weather)
        latestAtmosphere = atmosphereDirector.advance(
            deltaSeconds = delta,
            localHour = localHour,
            solarElevationDegrees = solarElevationDegrees,
            beforeSolarNoon = localHour < 12f,
        )
        retainedWetness = if (latestAtmosphere.rainAmount > retainedWetness) {
            min(1f, retainedWetness + delta * .85f)
        } else {
            max(latestAtmosphere.rainAmount, retainedWetness - delta * .018f)
        }
        var angularStep = latestStory.kolobokAngleRadians - previousKolobokAngle
        while (angularStep > PI.toFloat()) angularStep -= (PI * 2f).toFloat()
        while (angularStep < -PI.toFloat()) angularStep += (PI * 2f).toFloat()
        val measuredKolobokSpeed = if (latestStory.rolling && delta > .0001f) {
            abs(angularStep) * SceneMotion.PATH_RADIUS / delta
        } else {
            0f
        }
        val speedBlend = 1f - exp(-delta * 12f)
        kolobokLinearSpeed +=
            (measuredKolobokSpeed - kolobokLinearSpeed) * speedBlend
        if (latestStory.rolling) {
            kolobokRollDegrees = (
                kolobokRollDegrees +
                    angularStep * SceneMotion.PATH_RADIUS / SceneMotion.KOLOBOK_RADIUS *
                    (180f / PI.toFloat())
                ) % 360f
        }
        previousKolobokAngle = latestStory.kolobokAngleRadians
        updateTreeBonks(delta)
        updateHedgehogJourneys(now)

        GLES30.glClearColor(
            latestAtmosphere.zenith.red,
            latestAtmosphere.zenith.green,
            latestAtmosphere.zenith.blue,
            1f,
        )
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT or GLES30.GL_DEPTH_BUFFER_BIT)

        val storyOwnsCamera =
            latestStory.mode == SceneStoryMode.PLAYING ||
                latestStory.mode == SceneStoryMode.REBIRTH
        val userRecentlySteered =
            cameraGestureActive ||
                now - lastCameraInputMs <= STORY_CAMERA_IDLE_RESUME_MS
        val foxEndingCameraElapsed = eventSeconds(foxEndingStartedMs)
        val foxEndingCameraActive =
            foxEndingCameraElapsed in 0f..FOX_ENDING_DURATION_SECONDS
        val introCamera = introCameraDirector.snapshot(now)
        val introCameraHolding =
            introCamera.phase == SceneIntroCameraPhase.HOLDING
        val introCameraHandoff =
            introCamera.phase == SceneIntroCameraPhase.HANDOFF
        introCameraHoldingActive = introCameraHolding
        val storyCameraEligible = storyOwnsCamera && !userRecentlySteered
        val storyCameraFollow =
            storyCameraEligible &&
                introCamera.phase == SceneIntroCameraPhase.INACTIVE
        val idleCameraFollow =
            !storyOwnsCamera &&
                !userRecentlySteered &&
                introCamera.phase == SceneIntroCameraPhase.INACTIVE
        val cinematicCamera =
            introCameraHolding ||
                introCameraHandoff ||
                storyCameraFollow ||
                foxEndingCameraActive
        cinematicCameraActive = cinematicCamera
        // The follow toggle configures free-camera behavior. The cinematic
        // owns its own framing until the user actually steers. A drag during
        // the tale temporarily hands the camera back without pausing the
        // story, and the selected pivot then matters just as it did in the
        // predecessor.
        val kolobokSafeToInspect =
            latestStory.kolobokScale > .08f &&
                latestStory.positionOverride == null
        val userFollowKolobok =
            frame.followKolobok &&
                kolobokSafeToInspect &&
                userRecentlySteered &&
                !foxEndingCameraActive
        followCameraActive = userFollowKolobok
        val kolobokPoint = currentKolobokPoint()
        val zoneFraming = zoneCameraFraming(activeZone())
        val storyFraming = storyCameraFraming(latestStory)
        val introFraming = introCameraFraming()
        val introTarget = WorldPoint3(
            INTRO_CAMERA_TARGET_X,
            INTRO_CAMERA_TARGET_Y,
            INTRO_CAMERA_TARGET_Z,
        )
        val (foxCameraTargetX, foxCameraTargetZ) = radial(288f, 5.2f)
        val foxCameraTarget = WorldPoint3(
            foxCameraTargetX,
            .95f,
            foxCameraTargetZ,
        )
        val foxEndingTarget = when {
            foxEndingCameraElapsed < FOX_ENDING_PUSH_SECONDS ->
                interpolate(
                    foxEndingCameraStartTarget,
                    foxCameraTarget,
                    smoothStep(
                        foxEndingCameraElapsed / FOX_ENDING_PUSH_SECONDS,
                    ),
                )
            foxEndingCameraElapsed < FOX_ENDING_BLACK_RESET_SECONDS ->
                foxCameraTarget
            foxEndingCameraElapsed < FOX_ENDING_REBIRTH_SECONDS ->
                interpolate(
                    foxCameraTarget,
                    introTarget,
                    smoothStep(
                        (
                            foxEndingCameraElapsed -
                                FOX_ENDING_BLACK_RESET_SECONDS
                            ) /
                            (
                                FOX_ENDING_REBIRTH_SECONDS -
                                    FOX_ENDING_BLACK_RESET_SECONDS
                                ),
                    ),
                )
            else -> introTarget
        }
        val postIntroTarget = if (storyCameraEligible) {
            storyFocusPoint()
        } else {
            WorldPoint3(0f, zoneFraming.lookAtHeight, 0f)
        }
        val localTarget = when {
            foxEndingCameraActive -> foxEndingTarget
            introCameraHolding -> introTarget
            introCameraHandoff -> interpolate(
                introTarget,
                postIntroTarget,
                introCamera.handoffProgress,
            )
            userFollowKolobok -> WorldPoint3(kolobokPoint.x, .8f, kolobokPoint.z)
            storyCameraFollow -> storyFocusPoint()
            else -> WorldPoint3(0f, zoneFraming.lookAtHeight, 0f)
        }
        val desiredTarget = if (userFollowKolobok || cinematicCamera) {
            val rotation = Math.toRadians(frame.sceneRotation.toDouble())
            val rotationCosine = cos(rotation).toFloat()
            val rotationSine = sin(rotation).toFloat()
            WorldPoint3(
                x = rotationCosine * localTarget.x + rotationSine * localTarget.z,
                y = localTarget.y,
                z = -rotationSine * localTarget.x + rotationCosine * localTarget.z,
            )
        } else {
            localTarget
        }
        if (
            foxEndingCameraActive ||
            introCameraHolding ||
            introCameraHandoff
        ) {
            cameraTargetX = desiredTarget.x
            cameraTargetY = desiredTarget.y
            cameraTargetZ = desiredTarget.z
        } else {
            val targetBlend = 1f - exp(-delta * 5.5f)
            cameraTargetX += (desiredTarget.x - cameraTargetX) * targetBlend
            cameraTargetY += (desiredTarget.y - cameraTargetY) * targetBlend
            cameraTargetZ += (desiredTarget.z - cameraTargetZ) * targetBlend
        }

        val postIntroYaw = if (storyCameraEligible || !userRecentlySteered) {
            Math.toDegrees(latestStory.kolobokAngleRadians.toDouble()).toFloat() -
                STORY_CAMERA_LEAD_DEGREES
        } else {
            frame.cameraYaw
        }
        val foxEndingTargetYaw = when {
            foxEndingCameraElapsed < FOX_ENDING_PUSH_SECONDS ->
                foxEndingCameraStartYaw +
                    shortestAngleDegrees(
                        foxEndingCameraStartYaw,
                        FOX_ENDING_CAMERA_YAW,
                    ) * smoothStep(
                        foxEndingCameraElapsed / FOX_ENDING_PUSH_SECONDS,
                    )
            foxEndingCameraElapsed < FOX_ENDING_BLACK_RESET_SECONDS ->
                FOX_ENDING_CAMERA_YAW
            foxEndingCameraElapsed < FOX_ENDING_REBIRTH_SECONDS ->
                FOX_ENDING_CAMERA_YAW +
                    shortestAngleDegrees(
                        FOX_ENDING_CAMERA_YAW,
                        FOX_ENDING_REBIRTH_CAMERA_YAW,
                    ) * smoothStep(
                        (
                            foxEndingCameraElapsed -
                                FOX_ENDING_BLACK_RESET_SECONDS
                            ) /
                            (
                                FOX_ENDING_REBIRTH_SECONDS -
                                    FOX_ENDING_BLACK_RESET_SECONDS
                                ),
                    )
            else -> FOX_ENDING_REBIRTH_CAMERA_YAW
        }
        val targetCameraYaw = if (foxEndingCameraActive) {
            foxEndingTargetYaw
        } else if (introCameraHolding) {
            INTRO_CAMERA_YAW
        } else if (introCameraHandoff) {
            INTRO_CAMERA_YAW +
                shortestAngleDegrees(INTRO_CAMERA_YAW, postIntroYaw) *
                introCamera.handoffProgress
        } else if (userFollowKolobok) {
            // Follow swaps the orbit pivot from the island to Kolobok; it
            // must not also swing the azimuth. Keeping the user's yaw is
            // what makes the control feel like the predecessor's eye
            // toggle and avoids flying the camera through the izba.
            frame.cameraYaw
        } else if (storyCameraFollow || idleCameraFollow) {
            Math.toDegrees(latestStory.kolobokAngleRadians.toDouble()).toFloat() -
                STORY_CAMERA_LEAD_DEGREES
        } else {
            frame.cameraYaw
        }
        renderedCameraYaw = if (
            foxEndingCameraActive ||
            introCameraHolding ||
            introCameraHandoff
        ) {
            targetCameraYaw
        } else if (
            storyCameraFollow ||
                idleCameraFollow ||
                userFollowKolobok
        ) {
            val deltaYaw = shortestAngleDegrees(renderedCameraYaw, targetCameraYaw)
            renderedCameraYaw +
                deltaYaw * (1f - exp(-delta * CAMERA_FOLLOW_LAG))
        } else {
            targetCameraYaw
        }
        lifeDirector.advance(
            deltaSeconds = delta,
            activeZone = activeZone(),
            wetness = retainedWetness,
            storyActor = latestStory.storyActor.takeIf {
                latestStory.mode == SceneStoryMode.PLAYING ||
                    latestStory.mode == SceneStoryMode.REBIRTH
            },
            encounterActor = latestEncounter.actor,
            nightAmount = latestAtmosphere.eveningAmount,
            grandpaFishing = fishingStartedMs > 0L,
            kolobokSinging = latestStory.singing || latestEncounter.singing,
        )
        val cameraBreathAllowed =
                latestStory.mode != SceneStoryMode.PLAYING &&
                latestStory.mode != SceneStoryMode.REBIRTH &&
                !cameraGestureActive &&
                !userFollowKolobok &&
                !foxEndingCameraActive &&
                !introCameraHolding &&
                !introCameraHandoff &&
                now - lastCameraInputMs > 300L
        val breathClock = now / 1_000f
        val breathYaw = if (cameraBreathAllowed) {
            sin(breathClock * PI.toFloat() * 2f / 8f) * .40f
        } else {
            0f
        }
        val breathHeight = if (cameraBreathAllowed) {
            sin(breathClock * PI.toFloat() * 2f / 13f) * .05f
        } else {
            0f
        }
        val effectiveYaw = renderedCameraYaw + breathYaw
        val yaw = Math.toRadians(effectiveYaw.toDouble())
        val foxEndingPushProgress = smoothStep(
            foxEndingCameraElapsed / FOX_ENDING_PUSH_SECONDS,
        )
        val foxEndingResetProgress = smoothStep(
            (
                foxEndingCameraElapsed -
                    FOX_ENDING_BLACK_RESET_SECONDS
                ) /
                (
                    FOX_ENDING_REBIRTH_SECONDS -
                        FOX_ENDING_BLACK_RESET_SECONDS
                    ),
        )
        val foxEndingPitch = when {
            foxEndingCameraElapsed < FOX_ENDING_PUSH_SECONDS ->
                interpolate(
                    foxEndingCameraStartPitch,
                    FOX_ENDING_CAMERA_PITCH,
                    foxEndingPushProgress,
                )
            foxEndingCameraElapsed < FOX_ENDING_BLACK_RESET_SECONDS ->
                FOX_ENDING_CAMERA_PITCH
            foxEndingCameraElapsed < FOX_ENDING_REBIRTH_SECONDS ->
                interpolate(
                    FOX_ENDING_CAMERA_PITCH,
                    introFraming.pitchDegrees,
                    foxEndingResetProgress,
                )
            else -> introFraming.pitchDegrees
        }
        val foxEndingDistance = when {
            foxEndingCameraElapsed < FOX_ENDING_PUSH_SECONDS ->
                interpolate(
                    foxEndingCameraStartDistance,
                    FOX_ENDING_CAMERA_DISTANCE,
                    foxEndingPushProgress,
                )
            foxEndingCameraElapsed < FOX_ENDING_BLACK_RESET_SECONDS ->
                FOX_ENDING_CAMERA_DISTANCE
            foxEndingCameraElapsed < FOX_ENDING_REBIRTH_SECONDS ->
                interpolate(
                    FOX_ENDING_CAMERA_DISTANCE,
                    introFraming.distance,
                    foxEndingResetProgress,
                )
            else -> introFraming.distance
        }
        val postIntroFraming = if (storyCameraEligible) {
            storyFraming
        } else {
            zoneFraming
        }
        val useZoneFraming =
            !userFollowKolobok &&
                !storyCameraFollow &&
                !foxEndingCameraActive &&
                !introCameraHolding &&
                !introCameraHandoff
        val desiredPitch = when {
            foxEndingCameraActive -> foxEndingPitch
            introCameraHolding -> introFraming.pitchDegrees
            introCameraHandoff -> interpolate(
                introFraming.pitchDegrees,
                postIntroFraming.pitchDegrees,
                introCamera.handoffProgress,
            )
            storyCameraFollow -> storyFraming.pitchDegrees
            useZoneFraming ->
                zoneFraming.pitchDegrees + (frame.cameraPitch - DEFAULT_CAMERA_PITCH)
            else -> frame.cameraPitch
        }
        val desiredDistance = when {
            foxEndingCameraActive -> foxEndingDistance
            introCameraHolding -> introFraming.distance
            introCameraHandoff -> interpolate(
                introFraming.distance,
                postIntroFraming.distance,
                introCamera.handoffProgress,
            )
            storyCameraFollow -> storyFraming.distance
            useZoneFraming -> (
                zoneFraming.distance +
                    (frame.cameraDistance - DEFAULT_CAMERA_DISTANCE)
                ).coerceIn(5.8f, 18f)
            else -> frame.cameraDistance
        }
        if (
            cameraGestureActive ||
            foxEndingCameraActive ||
            introCameraHolding ||
            introCameraHandoff
        ) {
            renderedCameraPitch = desiredPitch
            renderedCameraDistance = desiredDistance
        } else {
            val framingBlend = 1f - exp(-delta * 4.2f)
            renderedCameraPitch +=
                (desiredPitch - renderedCameraPitch) * framingBlend
            renderedCameraDistance +=
                (desiredDistance - renderedCameraDistance) * framingBlend
        }
        val pitch = Math.toRadians(renderedCameraPitch.toDouble())
        val houseSide = if (useZoneFraming) {
            max(0f, cos(yaw).toFloat())
        } else {
            0f
        }
        val occlusionSafeDistance = max(renderedCameraDistance, 17.6f)
        // Scripted/dialogue push-ins belong only to an idle cinematic.
        // A user-steered orbit must not lurch merely because a beat starts.
        val storyPushDistance = if (foxEndingCameraActive) {
            0f
        } else if (storyCameraFollow || introCameraHandoff) {
            (
                latestStory.cameraPush * 16f +
                    latestEncounter.cameraPush * 13f
                ) * if (introCameraHandoff) {
                introCamera.handoffProgress
            } else {
                1f
            }
        } else if (!userFollowKolobok && !storyOwnsCamera) {
            latestEncounter.cameraPush * 13f
        } else {
            0f
        }
        val minimumCameraDistance =
            if (userFollowKolobok || foxEndingCameraActive) 5.8f else 8.8f
        var effectiveDistance = (
            renderedCameraDistance +
            houseSide * houseSide *
            (occlusionSafeDistance - renderedCameraDistance)
            - storyPushDistance
            ).coerceAtLeast(minimumCameraDistance)
        if (userFollowKolobok) {
            val desiredHorizontal = effectiveDistance * cos(pitch).toFloat()
            val desiredEyeX = cameraTargetX + desiredHorizontal * sin(yaw).toFloat()
            val desiredEyeZ = cameraTargetZ + desiredHorizontal * cos(yaw).toFloat()
            effectiveDistance = SceneCameraOcclusion.clampDistanceForRect(
                heroX = cameraTargetX,
                heroZ = cameraTargetZ,
                desiredCameraX = desiredEyeX,
                desiredCameraZ = desiredEyeZ,
                desiredDistance = effectiveDistance,
                minX = -1.62f,
                maxX = 1.62f,
                minZ = 4.68f,
                maxZ = 7.82f,
                minimumDistance = 4.8f,
            )
            effectiveDistance = SceneCameraOcclusion.clampDistanceForRect(
                heroX = cameraTargetX,
                heroZ = cameraTargetZ,
                desiredCameraX = cameraTargetX +
                    effectiveDistance * cos(pitch).toFloat() * sin(yaw).toFloat(),
                desiredCameraZ = cameraTargetZ +
                    effectiveDistance * cos(pitch).toFloat() * cos(yaw).toFloat(),
                desiredDistance = effectiveDistance,
                minX = -1.38f,
                maxX = 1.38f,
                minZ = -1.18f,
                maxZ = 1.18f,
                minimumDistance = 4.8f,
            )
        }
        val horizontal = effectiveDistance * cos(pitch).toFloat()
        eyeX = cameraTargetX + horizontal * sin(yaw).toFloat()
        eyeY = cameraTargetY + .1f +
            effectiveDistance * sin(pitch).toFloat() +
            breathHeight
        eyeZ = cameraTargetZ + horizontal * cos(yaw).toFloat()
        val inverseSceneRotation = Math.toRadians(frame.sceneRotation.toDouble())
        val inverseSceneCosine = cos(inverseSceneRotation).toFloat()
        val inverseSceneSine = sin(inverseSceneRotation).toFloat()
        sceneSpaceEyeX =
            inverseSceneCosine * eyeX - inverseSceneSine * eyeZ
        sceneSpaceEyeZ =
            inverseSceneSine * eyeX + inverseSceneCosine * eyeZ
        updateCrossroadsPlaqueHeading(delta)
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
        updateBubbleAnchor()

        GLES30.glUseProgram(program)
        GLES30.glUniform3f(lightLocation, -0.48f, 0.78f, 0.39f)
        GLES30.glUniform3f(cameraLocation, eyeX, eyeY, eyeZ)
        GLES30.glUniform3f(
            fogColorLocation,
            latestAtmosphere.fog.red,
            latestAtmosphere.fog.green,
            latestAtmosphere.fog.blue,
        )

        drawWorld()
        drawWeather()
    }

    private fun drawWorld() {
        // Layered island with the original five-zone circular route.
        draw(
            requireNotNull(disc),
            color("#72513A"),
            Transform(0f, -.46f, 0f, 8f, .38f, 8f),
        )
        draw(
            requireNotNull(terrain),
            color("#7AA85C"),
            Transform(0f, TERRAIN_BASE_Y, 0f, 1f, 1f, 1f),
        )
        drawTerrainAccents()
        drawZoneGroundTints()
        draw(
            requireNotNull(ring),
            color("#D4B377"),
            Transform(0f, .075f, 0f, 4.96f, 1f, 4.96f),
        )
        drawWeatherGround()

        // Draw distant ground after the island so early depth rejection keeps
        // these very broad layers inexpensive.
        draw(requireNotNull(disc), color("#6A925F"), Transform(0f, -1.28f, 0f, 16f, .05f, 16f), rimStrength = 0f)
        draw(requireNotNull(disc), color("#5F845B"), Transform(0f, -1.39f, 0f, 24f, .06f, 24f), rimStrength = 0f)
        draw(requireNotNull(disc), color("#55745B"), Transform(0f, -1.50f, 0f, 32f, .07f, 32f), rimStrength = 0f)

        drawSkyDetails()
        drawBackgroundForest()
        drawIslandVegetation()
        drawReactiveGroundCover()
        drawInteractiveTrees()
        drawInteractiveMushrooms()
        drawCrossroadsStone()
        drawIzba()
        drawPondAndGrandpa()
        drawZoneAmbience()
        drawAtmosphereScenery()
        drawBirchLeafFalls()
        drawAmbientTapReaction()
        drawClouds()
        drawKolobok()
        drawHare()
        drawWolf()
        drawBear()
        drawFox()
        drawGoldenHourExtras()
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

    private fun drawReactiveGroundCover() {
        val kolobok = currentKolobokPoint()
        val now = SystemClock.uptimeMillis()
        dynamicInstanceGroups.clear()

        reactiveGrass.forEachIndexed { index, plant ->
            val (x, z) = radial(plant.angle, plant.radius)
            val bend = updatePlantBend(
                index = index,
                x = x,
                z = z,
                kolobok = kolobok,
                now = now,
                startedAtMs = grassBendStartedAtMs,
                directionX = grassBendDirectionX,
                directionZ = grassBendDirectionZ,
            )
            val windPhase =
                (x * latestAtmosphere.windDirectionX +
                    z * latestAtmosphere.windDirectionZ) * .9f +
                    frame.storyTime * 2.2f
            val windTilt =
                sin(windPhase) *
                    REACTIVE_GRASS_WIND_DEGREES *
                    latestAtmosphere.windStrength
            val tiltX =
                latestAtmosphere.windDirectionZ * windTilt +
                    bend.directionZ * bend.degrees
            val tiltZ =
                -latestAtmosphere.windDirectionX * windTilt -
                    bend.directionX * bend.degrees
            val baseY = groundHeightAt(x, z)
            val baseHeight = (.075f + pseudo(index * 43 + 7) * .095f) * plant.scale
            val grassColor = when (index % 4) {
                0 -> "#6F9B52"
                1 -> "#78A557"
                2 -> "#80AD5C"
                else -> "#86B25F"
            }
            repeat(3) { blade ->
                val bladeYaw =
                    plant.yaw + blade * (104f + pseudo(index * 11 + blade) * 17f)
                val bladeRadians = Math.toRadians(bladeYaw.toDouble())
                val bladeHeight =
                    baseHeight * (.76f + pseudo(index * 89 + blade * 7) * .34f)
                val naturalLean = (pseudo(index * 97 + blade * 13) - .5f) * 18f
                val offset = blade * .018f * plant.scale
                queueDynamicInstance(
                    requireNotNull(cube),
                    grassColor,
                    1f,
                    Transform(
                        x = x + cos(bladeRadians).toFloat() * offset,
                        y = baseY + bladeHeight,
                        z = z + sin(bladeRadians).toFloat() * offset,
                        scaleX = (.011f + pseudo(index * 31 + blade) * .005f) * plant.scale,
                        scaleY = bladeHeight,
                        scaleZ = (.019f + pseudo(index * 37 + blade) * .006f) * plant.scale,
                        rotationX = tiltX,
                        rotationY = bladeYaw,
                        rotationZ = naturalLean + tiltZ,
                    ),
                    rimStrength = .04f,
                )
            }
        }

        reactiveFlowers.forEachIndexed { index, plant ->
            val (x, z) = radial(plant.angle, plant.radius)
            val bend = updatePlantBend(
                index = index,
                x = x,
                z = z,
                kolobok = kolobok,
                now = now,
                startedAtMs = flowerBendStartedAtMs,
                directionX = flowerBendDirectionX,
                directionZ = flowerBendDirectionZ,
            )
            val baseY = groundHeightAt(x, z)
            val halfHeight = (.075f + pseudo(index * 89 + 13) * .055f) * plant.scale
            val stemRadius = (.010f + pseudo(index * 97 + 7) * .005f) * plant.scale
            queueDynamicInstance(
                requireNotNull(cylinder),
                "#58914D",
                1f,
                Transform(
                    x = x,
                    y = baseY + halfHeight,
                    z = z,
                    scaleX = stemRadius,
                    scaleY = halfHeight,
                    scaleZ = stemRadius,
                    rotationY = plant.yaw,
                ),
                rimStrength = .04f,
            )
            val fullHeight = halfHeight * 2f
            val bendRadians = Math.toRadians(bend.degrees.toDouble())
            val headX = x + bend.directionX * sin(bendRadians).toFloat() * fullHeight
            val headZ = z + bend.directionZ * sin(bendRadians).toFloat() * fullHeight
            val headY = baseY + cos(bendRadians).toFloat() * fullHeight
            val flowerColor = when (index % 4) {
                0 -> "#FFF1A8"
                1 -> "#F07F87"
                2 -> "#84BCE2"
                else -> "#E9A8D0"
            }
            val headScale = (.044f + pseudo(index * 101 + 19) * .026f) * plant.scale
            queueDynamicInstance(
                requireNotNull(lowSphere),
                flowerColor,
                1f,
                Transform(
                    x = headX,
                    y = headY,
                    z = headZ,
                    scaleX = headScale,
                    scaleY = headScale * .66f,
                    scaleZ = headScale,
                    rotationX = bend.directionZ * bend.degrees,
                    rotationY = plant.yaw,
                    rotationZ = -bend.directionX * bend.degrees,
                ),
                rimStrength = .08f,
            )
        }
        flushDynamicInstances()
    }

    private fun updatePlantBend(
        index: Int,
        x: Float,
        z: Float,
        kolobok: WorldPoint3,
        now: Long,
        startedAtMs: LongArray,
        directionX: FloatArray,
        directionZ: FloatArray,
    ): PlantBendPose {
        if (startedAtMs[index] <= 0L) {
            val dx = x - kolobok.x
            val dz = z - kolobok.z
            val distanceSquared = dx * dx + dz * dz
            if (distanceSquared < REACTIVE_PLANT_BEND_RADIUS * REACTIVE_PLANT_BEND_RADIUS) {
                val distance = sqrt(distanceSquared).coerceAtLeast(.001f)
                startedAtMs[index] = now
                directionX[index] = dx / distance
                directionZ[index] = dz / distance
            }
        }
        if (startedAtMs[index] <= 0L) return PlantBendPose()
        val elapsed = (now - startedAtMs[index]).coerceAtLeast(0L) / 1_000f
        if (elapsed >= REACTIVE_PLANT_BEND_SECONDS) {
            startedAtMs[index] = 0L
            return PlantBendPose()
        }
        val degrees =
            REACTIVE_PLANT_BEND_DEGREES *
                exp(-elapsed * REACTIVE_PLANT_BEND_DECAY) *
                cos(
                    elapsed * REACTIVE_PLANT_BEND_FREQUENCY *
                        PI.toFloat() * 2f,
                )
        return PlantBendPose(
            degrees = degrees,
            directionX = directionX[index],
            directionZ = directionZ[index],
        )
    }

    private fun updateTreeBonks(deltaSeconds: Float) {
        val kolobok = currentKolobokPoint()
        val kolobokX = kolobok.x
        val kolobokZ = kolobok.z
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
                // One global gust rolls across the island instead of making
                // every tree sway on an unrelated metronome.
                val windPhase =
                    (treeX * latestAtmosphere.windDirectionX +
                        treeZ * latestAtmosphere.windDirectionZ) * .9f +
                        frame.storyTime * 2.2f
                val sway = sin(windPhase) * 2.2f * latestAtmosphere.windStrength
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
            if (latestAtmosphere.snowAmount > .01f) {
                drawBonkedTreePart(
                    requireNotNull(cone),
                    "#F2F5F8",
                    x,
                    z,
                    leanX,
                    (2.02f + pseudo(treeSeed + 179) * .10f) * size,
                    leanZ,
                    upperWidth * size * .78f,
                    .055f * size,
                    upperWidth * size * .78f,
                    yaw - 18f + pseudo(treeSeed + 89) * 31f,
                    pose,
                    .04f,
                    alpha = latestAtmosphere.snowAmount * .92f,
                )
            }
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
        alpha: Float = 1f,
    ) {
        val intensity = pose.intensity.coerceIn(0f, 1.15f)
        val stretchY = 1f + intensity * TreeBonkPhysics.STRETCH_Y
        val stretchXZ = 1f - intensity * TreeBonkPhysics.STRETCH_XZ
        val tiltRadians = Math.toRadians(pose.tiltDegrees.toDouble())
        val stretchedHeight = localY * stretchY
        val hingeOffset = sin(tiltRadians).toFloat() * stretchedHeight
        val cameraVisibility = treeCameraVisibility(baseX, baseZ)
        queueDynamicInstance(
            mesh,
            hex,
            alpha * cameraVisibility,
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
            val groundY = groundHeightAt(x, z)
            val size = .88f + pseudo(index * 31 + 6) * .30f
            val yaw = pseudo(index * 61 + 14) * 360f
            val scratchMushroomIndex = when {
                lifeDirector.bearScratchSide < 0f -> 1
                lifeDirector.bearScratchSide > 0f -> 2
                else -> -1
            }
            val scratchWobble = if (index == scratchMushroomIndex) {
                lifeDirector.bearScratchDegrees * .72f
            } else {
                0f
            }
            val lean = (pseudo(index * 71 + 8) - .5f) * 12f + scratchWobble
            val capWidth = (.098f + pseudo(index * 73 + 11) * .038f) * size
            val capDepth = (.088f + pseudo(index * 79 + 5) * .043f) * size
            val capHeight = (.050f + pseudo(index * 83 + 17) * .027f) * size
            queueDynamicInstance(
                requireNotNull(disc),
                "#29462A",
                .18f * popScale,
                Transform(
                    x,
                    groundY + .066f,
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
                    groundY + .14f * size * popScale,
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
                    groundY + (.27f * size + capHeight * .10f) * popScale,
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
                        groundY + (.30f * size + capHeight * .42f) * popScale,
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

    private fun drawTerrainAccents() {
        terrainHills.forEachIndexed { index, hill ->
            draw(
                requireNotNull(lowSphere),
                color(
                    if (index % 3 == 0) "#75AD58" else "#80B65F",
                    .24f,
                ),
                Transform(
                    hill.x,
                    TERRAIN_BASE_Y + .055f,
                    hill.z,
                    hill.radius * .88f,
                    .105f,
                    hill.radius * .88f,
                ),
                rimStrength = .01f,
            )
        }
        terrainPotholes.forEachIndexed { index, hole ->
            draw(
                requireNotNull(lowSphere),
                color(if (index % 2 == 0) "#49382A" else "#3F3329", .72f),
                Transform(
                    hole.x,
                    TERRAIN_BASE_Y - TERRAIN_POTHOLE_DEPTH + .008f,
                    hole.z,
                    hole.majorRadius,
                    .012f,
                    hole.minorRadius,
                    rotationY = hole.rotationDegrees,
                ),
                rimStrength = .01f,
            )
        }
    }

    private fun drawWeatherGround() {
        val snowCover = latestAtmosphere.snowAmount
        if (snowCover > .01f) {
            draw(
                requireNotNull(disc),
                color("#E8ECF0", snowCover * .25f),
                Transform(0f, .082f, 0f, 7.95f, .010f, 7.95f),
                rimStrength = 0f,
            )
            draw(
                requireNotNull(ring),
                color("#F2F5F8", snowCover * .18f),
                Transform(0f, .094f, 0f, 4.97f, 1f, 4.97f),
                rimStrength = 0f,
            )
            draw(
                requireNotNull(lowSphere),
                color("#F2F5F8", snowCover * .88f),
                Transform(0f, 2.52f, 0f, .66f, .12f, .58f),
                rimStrength = .05f,
            )
        }

        if (retainedWetness <= .01f) return
        draw(
            requireNotNull(ring),
            color("#75543E", retainedWetness * .34f),
            Transform(0f, .096f, 0f, 4.96f, 1f, 4.96f),
            rimStrength = 0f,
        )
        terrainPotholes.forEachIndexed { index, hole ->
            draw(
                requireNotNull(lowSphere),
                color("#789EAE", retainedWetness * .42f),
                Transform(
                    hole.x,
                    TERRAIN_BASE_Y - TERRAIN_POTHOLE_DEPTH + .016f,
                    hole.z,
                    hole.majorRadius * .91f,
                    .012f,
                    hole.minorRadius * .91f,
                    rotationY = hole.rotationDegrees,
                ),
                rimStrength = .02f,
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
        val sunVisible = sunMechanicallyVisible()
        if (sunVisible) {
            draw(
                requireNotNull(lowSphere),
                color("#FFF0A8", 1f - evening * .86f),
                Transform(
                    sunPosition.x,
                    sunPosition.y,
                    sunPosition.z,
                    1.10f * sunPulse,
                    1.10f * sunPulse,
                    1.10f * sunPulse,
                ),
                rotateWithScene = false,
                rimStrength = .08f,
            )
        }
        if (sunVisible && sunReaction > .001f) {
            repeat(12) { index ->
                val angle = index * 30f + sunElapsed * 42f
                val radians = Math.toRadians(angle.toDouble())
                val radius = 1.42f + sunReaction * .42f
                draw(
                    requireNotNull(lowSphere),
                    color("#FFF5B8", sunReaction * .76f),
                    Transform(
                        sunPosition.x + cos(radians).toFloat() * radius,
                        sunPosition.y + sin(radians).toFloat() * radius,
                        sunPosition.z + .05f,
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
        return latestAtmosphere.eveningAmount
    }

    private fun drawMoonAndFireflies(evening: Float) {
        if (evening <= .02f || !moonMechanicallyVisible()) return
        val moonX = moonPosition.x
        val moonY = moonPosition.y
        val moonZ = moonPosition.z
        if (moonY <= -1.5f) return
        val moonVisibility = ((evening - .02f) / .30f).coerceIn(0f, 1f)
        val winkElapsed = eventSeconds(moonWinkStartedMs)
        val wink = if (winkElapsed in 0f..MOON_WINK_SECONDS) {
            sin((winkElapsed / MOON_WINK_SECONDS) * PI.toFloat()).coerceAtLeast(0f)
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
            if (wink > .001f) {
                repeat(3) { index ->
                    val angle = index / 3f * PI.toFloat() * 2f + wink * .6f
                    draw(
                        requireNotNull(lowSphere),
                        color("#FFF5B8", wink * .88f),
                        Transform(
                            moonX + cos(angle) * (.50f + wink * .14f),
                            moonY + sin(angle) * (.50f + wink * .14f),
                            moonZ + .82f,
                            .042f,
                            .042f,
                            .025f,
                            rotationZ = Math.toDegrees(angle.toDouble()).toFloat(),
                        ),
                        rotateWithScene = false,
                        rimStrength = .24f,
                    )
                }
            }
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
        if (moonWinkStartedMs > 0L && winkElapsed > MOON_WINK_SECONDS) {
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

    private fun createIzbaRoofShingleBatches(cubeData: MeshData): List<StaticBatch> {
        val centerZ = 6.25f
        val roofCenterY = 1.99f
        val roofCenterOffset = .68f
        val roofAngle = 36f
        val roofHalfDepth = 1.31f
        val palette = listOf(
            "#79332C",
            "#8C3C30",
            "#9D4936",
            "#AF5840",
            "#86503D",
            "#B46849",
        )
        val groups = linkedMapOf<String, MutableList<MeshPart>>()
        for (side in listOf(-1f, 1f)) {
            val rotation = -side * roofAngle
            val radians = Math.toRadians(rotation.toDouble())
            val normalX = side * sin(Math.toRadians(roofAngle.toDouble())).toFloat()
            val normalY = cos(Math.toRadians(roofAngle.toDouble())).toFloat()
            repeat(5) { row ->
                val ridgeward = -.72f + row * .36f
                val localX = -side * ridgeward
                repeat(8) { column ->
                    val seed =
                        row * 131 + column * 47 + if (side > 0f) 907 else 211
                    val stagger = if (row % 2 == 0) -.025f else .025f
                    val z =
                        centerZ - 1.12f + column * .32f + stagger +
                            (pseudo(seed + 5) - .5f) * .022f
                    if (abs(z - centerZ) > roofHalfDepth - .11f) return@repeat
                    val surfaceLift = .105f + (pseudo(seed + 11) - .5f) * .006f
                    val x =
                        side * roofCenterOffset +
                            localX * cos(radians).toFloat() +
                            normalX * surfaceLift
                    val y =
                        roofCenterY +
                            localX * sin(radians).toFloat() +
                            normalY * surfaceLift
                    val colorIndex =
                        ((pseudo(seed + 17) * palette.size).toInt() + row + column) % palette.size
                    groups.getOrPut(palette[colorIndex]) { mutableListOf() } += MeshPart(
                        data = cubeData,
                        transform = Transform(
                            x,
                            y,
                            z,
                            .205f + (pseudo(seed + 23) - .5f) * .015f,
                            .025f,
                            .177f + (pseudo(seed + 29) - .5f) * .012f,
                            rotationY = (pseudo(seed + 31) - .5f) * 1.2f,
                            rotationZ = rotation + (pseudo(seed + 37) - .5f) * 1.1f,
                        ),
                    )
                }
            }
        }
        return groups.map { (hex, parts) ->
            StaticBatch(
                mesh = createMesh(Geometry.merge(parts)),
                color = color(hex),
                rimStrength = .10f,
            )
        }
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
            Transform(0f, .055f, 0f, 1.20f, .025f, 1.00f),
        )
        draw(
            requireNotNull(crossroadsBoulder),
            color("#747970"),
            Transform(0f, 0f, 0f, CROSSROADS_SCALE, CROSSROADS_SCALE, CROSSROADS_SCALE),
            rimStrength = .18f,
        )

        // Moss grows in separate soft patches instead of one perfectly flat
        // lid, preserving the boulder's tapered crown and irregular outline.
        listOf(
            Transform(-.18f, 2.02f, .02f, .35f, .09f, .28f, rotationY = 18f, rotationZ = -5f),
            Transform(.16f, 1.98f, -.02f, .31f, .087f, .25f, rotationY = -21f, rotationZ = 6f),
            Transform(-.71f, .22f, .18f, .25f, .09f, .22f, rotationY = 33f),
            Transform(.66f, .18f, -.31f, .23f, .078f, .27f, rotationY = -14f),
        ).forEachIndexed { index, transform ->
            draw(
                requireNotNull(lowSphere),
                color(if (index < 2) "#66865A" else "#5F8055"),
                transform,
                rimStrength = .10f,
            )
        }

        val plaqueColors = listOf("#AA7949", "#95653E", "#B17B48")
        crossroadsPlaqueSpecs.forEachIndexed { index, spec ->
            val plaqueHeading = crossroadsPlaqueHeading() + spec.azimuth
            val pressDepth = crossroadsPlaquePressDepth(index)
            val plaqueHeadingRadians = Math.toRadians(plaqueHeading.toDouble())
            val pressX = -sin(plaqueHeadingRadians).toFloat() * pressDepth
            val pressZ = -cos(plaqueHeadingRadians).toFloat() * pressDepth
            val pressPulse = crossroadsPlaquePressPulse(index)
            draw(
                crossroadsPlaqueAccentMeshes[index],
                color("#4D3326"),
                Transform(
                    pressX,
                    spec.y * CROSSROADS_SCALE,
                    pressZ,
                    CROSSROADS_SCALE,
                    CROSSROADS_SCALE,
                    CROSSROADS_SCALE,
                    rotationY = plaqueHeading,
                    rotationZ = spec.tilt,
                ),
                rimStrength = .04f,
            )
            draw(
                crossroadsPlaqueMeshes[index],
                color(plaqueColors[index]),
                Transform(
                    pressX,
                    spec.y * CROSSROADS_SCALE,
                    pressZ,
                    CROSSROADS_SCALE,
                    CROSSROADS_SCALE,
                    CROSSROADS_SCALE,
                    rotationY = plaqueHeading,
                    rotationZ = spec.tilt,
                ),
                rimStrength = .18f + pressPulse * .34f,
            )
            val fastenerLocalAngle = spec.arcLength / spec.outerRadius * .395f
            val plaqueTiltRadians = Math.toRadians(spec.tilt.toDouble())
            val fastenerRadius = (spec.outerRadius + .050f) * CROSSROADS_SCALE
            for (side in listOf(-1f, 1f)) {
                val localAngle = side * fastenerLocalAngle
                val localX = sin(localAngle) * fastenerRadius
                val localY = spec.height * CROSSROADS_SCALE * .07f
                val localZ = cos(localAngle) * fastenerRadius
                val tiltedX =
                    cos(plaqueTiltRadians).toFloat() * localX -
                        sin(plaqueTiltRadians).toFloat() * localY
                val worldX =
                    cos(plaqueHeadingRadians).toFloat() * tiltedX +
                        sin(plaqueHeadingRadians).toFloat() * localZ
                val worldY =
                    spec.y * CROSSROADS_SCALE +
                        sin(plaqueTiltRadians).toFloat() * localX +
                        cos(plaqueTiltRadians).toFloat() * localY
                val worldZ =
                    -sin(plaqueHeadingRadians).toFloat() * tiltedX +
                        cos(plaqueHeadingRadians).toFloat() * localZ
                draw(
                    requireNotNull(lowSphere),
                    color("#49372B"),
                    Transform(
                        worldX + pressX,
                        worldY,
                        worldZ + pressZ,
                        .032f,
                        .037f,
                        .018f,
                        rotationY = plaqueHeading + Math.toDegrees(localAngle.toDouble()).toFloat(),
                        rotationZ = spec.tilt,
                    ),
                    rimStrength = .04f,
                )
            }
        }

        val labels = if (russianRockMenu) russianRockLabels else englishRockLabels
        if (labels.size == 3 && crossroadsTextMeshes.size == 3) {
            crossroadsPlaqueSpecs.forEachIndexed { index, spec ->
                drawTextLabel(
                    labels[index],
                    crossroadsTextMeshes[index],
                    crossroadsPlaqueLabelTransform(
                        spec = spec,
                        pressDepth = crossroadsPlaquePressDepth(index),
                    ),
                )
            }
        }
        if (plaqueTurnActivity > .01f) {
            repeat(9) { index ->
                val phase = (frame.storyTime * .72f + index * .137f) % 1f
                val angle = frame.storyTime * 54f + index * 137.5f
                val radians = Math.toRadians(angle.toDouble())
                val radius = .58f + (index % 3) * .16f + phase * .18f
                draw(
                    requireNotNull(lowSphere),
                    color("#C9B188", plaqueTurnActivity * (1f - phase) * .26f),
                    Transform(
                        cos(radians).toFloat() * radius,
                        .10f + phase * .26f,
                        sin(radians).toFloat() * radius,
                        .035f + (index % 2) * .014f,
                        .025f,
                        .035f + (index % 2) * .014f,
                    ),
                    rimStrength = .01f,
                )
            }
        }
        draw(
            requireNotNull(lowSphere),
            color("#87917D"),
            Transform(-.78f, .15f, .27f, .28f, .16f, .25f, rotationZ = -11f),
        )
        draw(
            requireNotNull(lowSphere),
            color("#7B8277"),
            Transform(.76f, .14f, -.27f, .25f, .15f, .28f, rotationZ = 9f),
        )
        drawStoneBirds()
    }

    private fun drawStoneBirds() {
        repeat(STONE_BIRD_COUNT) { index ->
            val elapsed = eventSeconds(stoneBirdStartedAtMs[index])
            val angle = pseudo(index * 47 + 3) * 360f
            val baseRadius = 1.00f + pseudo(index * 59 + 8) * .40f
            val (baseX, baseZ) = radial(angle, baseRadius)
            val baseY = .20f + pseudo(index * 71 + 4) * .13f
            var x = baseX
            var y = baseY
            var z = baseZ
            var flap = sin(frame.storyTime * 2f + index) * 10f
            var flightAmount = 0f
            var birdHeading = angle + 180f
            var visible = true
            var landingScale = 1f
            if (stoneBirdFlightActive(index, elapsed)) {
                val flightSeed = stoneBirdStartedAtMs[index].toInt() xor (index * 911)
                val escapeAngle =
                    pseudo(flightSeed) * PI.toFloat() * 2f
                val scatter = WorldPoint3(
                    x = baseX + sin(escapeAngle) * STONE_BIRD_SCATTER_DISTANCE,
                    y = baseY + STONE_BIRD_SCATTER_RISE,
                    z = baseZ + cos(escapeAngle) * STONE_BIRD_SCATTER_DISTANCE,
                )
                var awayX = scatter.x - stoneBirdCameraX[index]
                var awayZ = scatter.z - stoneBirdCameraZ[index]
                val awayLength = sqrt(awayX * awayX + awayZ * awayZ).coerceAtLeast(.01f)
                awayX /= awayLength
                awayZ /= awayLength
                val far = WorldPoint3(
                    x = scatter.x + awayX * STONE_BIRD_CLIMB_DISTANCE,
                    y = scatter.y + STONE_BIRD_CLIMB_RISE,
                    z = scatter.z + awayZ * STONE_BIRD_CLIMB_DISTANCE,
                )
                val scatterEnd = STONE_BIRD_SCATTER_SECONDS
                val climbEnd = scatterEnd + STONE_BIRD_CLIMB_SECONDS
                val awayEnd = climbEnd + stoneBirdAwaySeconds(index)
                val returnEnd = awayEnd + STONE_BIRD_RETURN_SECONDS
                val pose = when {
                    elapsed < scatterEnd -> curvedFlightPoint(
                        from = WorldPoint3(baseX, baseY, baseZ),
                        to = scatter,
                        progress = elapsed / STONE_BIRD_SCATTER_SECONDS,
                        seed = flightSeed + 41,
                    )
                    elapsed < climbEnd -> curvedFlightPoint(
                        from = scatter,
                        to = far,
                        progress = (elapsed - scatterEnd) / STONE_BIRD_CLIMB_SECONDS,
                        seed = flightSeed + 83,
                    )
                    elapsed < awayEnd -> {
                        visible = false
                        far
                    }
                    elapsed < returnEnd -> curvedFlightPoint(
                        from = far,
                        to = WorldPoint3(baseX, baseY, baseZ),
                        progress = (elapsed - awayEnd) / STONE_BIRD_RETURN_SECONDS,
                        seed = flightSeed + 127,
                    )
                    else -> {
                        val settle = (
                            (elapsed - returnEnd) / STONE_BIRD_LAND_SECONDS
                            ).coerceIn(0f, 1f)
                        landingScale = 1f - .20f * sin(settle * PI.toFloat())
                        WorldPoint3(baseX, baseY, baseZ)
                    }
                }
                x = pose.x
                y = pose.y
                z = pose.z
                flightAmount = if (elapsed < returnEnd && visible) 1f else 0f
                flap = if (flightAmount > 0f) {
                    sin(elapsed * STONE_BIRD_FLAP_HZ * PI.toFloat() * 2f + index) * 50f
                } else {
                    sin(frame.storyTime * 2f + index) * 10f
                }
                birdHeading = when {
                    elapsed < scatterEnd -> Math.toDegrees(escapeAngle.toDouble()).toFloat()
                    elapsed < awayEnd -> Math.toDegrees(kotlin.math.atan2(awayX, awayZ).toDouble()).toFloat()
                    elapsed < returnEnd -> Math.toDegrees(kotlin.math.atan2(-awayX, -awayZ).toDouble()).toFloat()
                    else -> angle + 180f
                }
            }
            if (visible) {
                drawTinyBird(
                    x = x,
                    y = y,
                    z = z,
                    heading = birdHeading,
                    flap = flap,
                    bodyColor = if (index % 3 == 0) "#465662" else if (index % 3 == 1) "#5B5148" else "#56636B",
                    flightAmount = flightAmount,
                    scale = landingScale,
                )
            }
            if (stoneBirdStartedAtMs[index] > 0L && elapsed > stoneBirdTotalSeconds(index)) {
                stoneBirdStartedAtMs[index] = 0L
            }
        }
    }

    private fun stoneBirdFlightActive(index: Int, elapsed: Float): Boolean =
        elapsed in 0f..stoneBirdTotalSeconds(index)

    private fun stoneBirdAwaySeconds(index: Int): Float {
        val seed = stoneBirdStartedAtMs[index].toInt() xor (index * 911)
        return STONE_BIRD_AWAY_MIN_SECONDS +
            pseudo(seed + 191) *
            (STONE_BIRD_AWAY_MAX_SECONDS - STONE_BIRD_AWAY_MIN_SECONDS)
    }

    private fun stoneBirdTotalSeconds(index: Int): Float =
        STONE_BIRD_SCATTER_SECONDS +
            STONE_BIRD_CLIMB_SECONDS +
            stoneBirdAwaySeconds(index) +
            STONE_BIRD_RETURN_SECONDS +
            STONE_BIRD_LAND_SECONDS

    private fun curvedFlightPoint(
        from: WorldPoint3,
        to: WorldPoint3,
        progress: Float,
        seed: Int,
    ): WorldPoint3 {
        val raw = progress.coerceIn(0f, 1f)
        val eased = 1f - (1f - raw) * (1f - raw)
        val dx = to.x - from.x
        val dz = to.z - from.z
        val length = sqrt(dx * dx + dz * dz).coerceAtLeast(.001f)
        val cycles = 1f + pseudo(seed + 1) * 1.3f
        val sign = if (pseudo(seed + 2) < .5f) -1f else 1f
        val amplitude = .25f + pseudo(seed + 3) * .35f
        val wobble =
            sin(raw * PI.toFloat() * cycles) *
                amplitude * sign *
                sin(raw * PI.toFloat())
        return WorldPoint3(
            x = from.x + dx * eased - dz / length * wobble,
            y = from.y + (to.y - from.y) * eased,
            z = from.z + dz * eased + dx / length * wobble,
        )
    }

    private fun drawIzba() {
        val centerZ = 6.25f
        val roofCenterY = 1.99f
        val roofCenterOffset = .68f
        val roofHalfSlope = .94f
        val roofHalfDepth = 1.31f
        val roofAngle = 36f
        val roofAngleRadians = Math.toRadians(roofAngle.toDouble())
        val roofRidgeY = roofCenterY + sin(roofAngleRadians).toFloat() * roofHalfSlope
        val roofEaveX = roofCenterOffset + cos(roofAngleRadians).toFloat() * roofHalfSlope
        val roofEaveY = roofCenterY - sin(roofAngleRadians).toFloat() * roofHalfSlope
        val gableCenterY = 1.97f
        val gableHalfHeight = .51f
        val izbaFlashElapsed = eventSeconds(izbaFlashStartedMs)
        val izbaFlash = if (izbaFlashElapsed in 0f..1.35f) {
            sin((izbaFlashElapsed / 1.35f) * PI.toFloat()).coerceAtLeast(0f)
        } else {
            0f
        }
        val mechanicalWindowGlow = max(
            latestStory.windowGlow,
            latestEncounter.windowFlash,
        )
        val windowWarmth = max(
            eveningAmount() * .88f,
            max(izbaFlash, mechanicalWindowGlow),
        )
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
            color("#87392F"),
            Transform(
                -roofCenterOffset,
                roofCenterY - .045f,
                centerZ,
                roofHalfSlope,
                .125f,
                roofHalfDepth,
                rotationZ = roofAngle,
            ),
        )
        draw(
            requireNotNull(cube),
            color("#913F32"),
            Transform(
                roofCenterOffset,
                roofCenterY - .045f,
                centerZ,
                roofHalfSlope,
                .125f,
                roofHalfDepth,
                rotationZ = -roofAngle,
            ),
        )
        draw(
            requireNotNull(cube),
            color("#A74E3B"),
            Transform(
                -roofCenterOffset,
                roofCenterY,
                centerZ,
                roofHalfSlope,
                .080f,
                roofHalfDepth,
                rotationZ = roofAngle,
            ),
            rimStrength = .14f,
        )
        draw(
            requireNotNull(cube),
            color("#B35440"),
            Transform(
                roofCenterOffset,
                roofCenterY,
                centerZ,
                roofHalfSlope,
                .080f,
                roofHalfDepth,
                rotationZ = -roofAngle,
            ),
            rimStrength = .14f,
        )

        // Substantial eaves, ridge cap and front/back rake boards make the
        // roof read as a complete overhanging construction from every side.
        for (side in listOf(-1f, 1f)) {
            draw(
                requireNotNull(cube),
                color("#713127"),
                Transform(
                    side * roofEaveX,
                    roofEaveY,
                    centerZ,
                    .060f,
                    .070f,
                    roofHalfDepth + .035f,
                ),
                rimStrength = .08f,
            )
        }
        draw(
            requireNotNull(cube),
            color("#6E3028"),
            Transform(0f, roofRidgeY + .025f, centerZ, .075f, .075f, roofHalfDepth + .085f),
            rimStrength = .10f,
        )
        for (frontBack in listOf(-1f, 1f)) {
            val z = centerZ + frontBack * (roofHalfDepth + .018f)
            val ridge = WorldPoint3(0f, roofRidgeY + .015f, z)
            drawLineSegment(
                ridge,
                WorldPoint3(-roofEaveX, roofEaveY, z),
                "#743128",
                1f,
                .048f,
            )
            drawLineSegment(
                ridge,
                WorldPoint3(roofEaveX, roofEaveY, z),
                "#743128",
                1f,
                .048f,
            )
        }

        izbaRoofShingleBatches.forEach { batch ->
            draw(
                batch.mesh,
                batch.color,
                IDENTITY_TRANSFORM,
                rimStrength = batch.rimStrength,
            )
        }
        if (latestAtmosphere.snowAmount > .01f) {
            for (side in listOf(-1f, 1f)) {
                draw(
                    requireNotNull(cube),
                    color("#F2F5F8", latestAtmosphere.snowAmount * .86f),
                    Transform(
                        side * roofCenterOffset,
                        roofCenterY + .11f,
                        centerZ,
                        roofHalfSlope * .94f,
                        .028f,
                        roofHalfDepth * .97f,
                        rotationZ = -side * roofAngle,
                    ),
                    rimStrength = .04f,
                )
            }
        }

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
        if (latestAtmosphere.snowAmount > .01f) {
            draw(
                requireNotNull(lowSphere),
                color("#F2F5F8", latestAtmosphere.snowAmount * .90f),
                Transform(.66f, 2.91f, centerZ + .25f, .19f, .045f, .19f),
                rimStrength = .03f,
            )
        }
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

        // Grandma crosses the window occasionally when this micro-scene is
        // active. During the story she remains visible for the kneading beat.
        val grandmaCrossing = lifeDirector.grandmaCrossing
        val grandmaVisible = latestStory.grandmaCooking || grandmaCrossing >= 0f
        val grandmaX = if (latestStory.grandmaCooking) {
            -.48f + sin(latestStory.chapterSeconds * .48f) * .10f
        } else {
            -.79f + grandmaCrossing.coerceIn(0f, 1f) * .62f
        }
        if (grandmaVisible) {
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
        }
        if (latestStory.grandmaCooking && grandmaVisible) {
            val knead = sin(latestStory.chapterSeconds * 8f)
            draw(
                requireNotNull(lowSphere),
                color("#F2C96A"),
                Transform(
                    grandmaX,
                    .69f + abs(knead) * .018f,
                    centerZ - 1.10f,
                    .105f + abs(knead) * .025f,
                    .050f,
                    .030f,
                ),
                rimStrength = .10f,
            )
            for (side in listOf(-1f, 1f)) {
                draw(
                    requireNotNull(lowSphere),
                    color("#D8A77C"),
                    Transform(
                        grandmaX + side * (.11f - knead * side * .025f),
                        .73f + knead * side * .025f,
                        centerZ - 1.115f,
                        .040f,
                        .040f,
                        .025f,
                    ),
                    rimStrength = .05f,
                )
            }
        }
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

        val ridgeBirdVisit = lifeDirector.ridgeBirdVisit
        if (ridgeBirdVisit >= 0f) {
            val ridgeBirdT = ridgeBirdVisit * 5.2f
            val ridgeArrivalEnd = .75f
            val ridgeDepartureStart = 4.10f
            val arrivalProgress = smoothStep(ridgeBirdT / ridgeArrivalEnd)
            val departureProgress = smoothStep(
                (ridgeBirdT - ridgeDepartureStart) / (5.2f - ridgeDepartureStart),
            )
            val arrivalOffset = 1f - arrivalProgress
            val flightStrength = max(arrivalOffset, departureProgress)
            val visitScale = min(
                smoothStep(ridgeBirdT / .28f),
                smoothStep((5.2f - ridgeBirdT) / .28f),
            )
            val perchX = -.25f
            val perchY = 2.64f
            val perchZ = centerZ - .10f
            val heading = when {
                ridgeBirdT < ridgeArrivalEnd -> 59f + (115f - 59f) * arrivalProgress
                ridgeBirdT > ridgeDepartureStart -> 115f + (124f - 115f) * departureProgress
                else -> 115f
            }
            val peck = if (ridgeBirdT in 1.7f..3.4f) {
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

        val smokeCount = (3f * latestStory.smokeBoost)
            .roundToInt()
            .coerceIn(3, 7)
        repeat(smokeCount) { index ->
            val phase = (frame.storyTime * .18f + index * .31f) % 1f
            val windDrift = phase * phase * latestAtmosphere.windStrength * .48f
            draw(
                requireNotNull(lowSphere),
                color("#E9EEF0", .45f * (1f - phase)),
                Transform(
                    .66f + sin(frame.storyTime * .4f + index) * .16f +
                        latestAtmosphere.windDirectionX * windDrift,
                    3.02f + phase * 1.2f,
                    centerZ + .25f + latestAtmosphere.windDirectionZ * windDrift,
                    .18f + phase * .18f,
                    .12f + phase * .15f,
                    .18f + phase * .18f,
                ),
            )
        }

        val smokeElapsed = eventSeconds(smokeRingsStartedMs)
        if (smokeElapsed in 0f..3.7f) {
            repeat(3) { index ->
                val local = smokeElapsed - index * .30f
                if (local < 0f) return@repeat
                val progress = (local / 3f).coerceIn(0f, 1f)
                val radius = .16f *
                    (.80f + pseudo(index * 59 + smokeRingsStartedMs.toInt()) * .40f)
                val windDrift = progress * latestAtmosphere.windStrength * .50f
                draw(
                    requireNotNull(lowSphere),
                    color("#EEF2F0", .62f * (1f - progress)),
                    Transform(
                        .66f + sin(progress * PI.toFloat() * 2f + index) * .15f +
                            latestAtmosphere.windDirectionX * windDrift,
                        2.96f + progress * 1.50f,
                        centerZ + .25f +
                            sin(progress * PI.toFloat() * 2f + index) * .09f +
                            latestAtmosphere.windDirectionZ * windDrift,
                        radius,
                        radius,
                        radius,
                    ),
                    rimStrength = .02f,
                )
            }
            if (smokeElapsed > 3.65f) smokeRingsStartedMs = 0L
        }
        if (izbaFlashStartedMs > 0L && izbaFlashElapsed > 1.35f) {
            izbaFlashStartedMs = 0L
        }
    }

    private fun drawPondAndGrandpa() {
        draw(
            requireNotNull(pondBlob),
            color("#8CB8C8"),
            Transform(POND_X, .062f, POND_Z, 1.64f, 1f, 1.64f, rotationY = POND_GROUP_HEADING),
            rimStrength = .06f,
        )
        draw(
            requireNotNull(pondBlob),
            color("#72B8C8", .94f),
            Transform(POND_X, .093f, POND_Z, 1.50f, 1f, 1.50f, rotationY = POND_GROUP_HEADING),
            rimStrength = .12f,
        )
        val beach = pondLocalPoint(.84f, .079f, -.08f)
        draw(
            requireNotNull(disc),
            color("#D8C382", .76f),
            Transform(
                beach.x,
                beach.y,
                beach.z,
                .48f,
                .012f,
                .62f,
                rotationY = POND_GROUP_HEADING - 18f,
            ),
            rimStrength = .04f,
        )

        // The bridge follows the inner path arc. Each plank is only bridge
        // width, rather than pond width, and the rails connect the same
        // sampled points so all parts share one curve and one arch.
        val bridgePoints = (0 until BRIDGE_SEGMENTS).map { index ->
            val t = index / (BRIDGE_SEGMENTS - 1f)
            val angle =
                BRIDGE_ARC_CENTER_DEGREES - BRIDGE_ARC_HALF_DEGREES +
                    t * BRIDGE_ARC_HALF_DEGREES * 2f
            val (x, z) = radial(angle, PATH_RADIUS)
            WorldPoint3(
                x,
                .13f + sin(t * PI.toFloat()) * .19f,
                z,
            )
        }
        val leftRailPosts = mutableListOf<WorldPoint3>()
        val rightRailPosts = mutableListOf<WorldPoint3>()
        bridgePoints.forEachIndexed { index, point ->
            val previous = bridgePoints[max(0, index - 1)]
            val next = bridgePoints[min(bridgePoints.lastIndex, index + 1)]
            val tangentX = next.x - previous.x
            val tangentZ = next.z - previous.z
            val tangentLength = sqrt(tangentX * tangentX + tangentZ * tangentZ).coerceAtLeast(.001f)
            val unitX = tangentX / tangentLength
            val unitZ = tangentZ / tangentLength
            val perpendicularX = -unitZ
            val perpendicularZ = unitX
            val yaw = Math.toDegrees(kotlin.math.atan2(-unitZ, unitX).toDouble()).toFloat()
            val horizontalLength = sqrt(tangentX * tangentX + tangentZ * tangentZ)
            val slope = Math.toDegrees(
                kotlin.math.atan2((next.y - previous.y).toDouble(), horizontalLength.toDouble()),
            ).toFloat()
            val segmentLength = if (index == 0 || index == bridgePoints.lastIndex) {
                .255f
            } else {
                .270f
            }
            draw(
                requireNotNull(cube),
                color(if (index % 2 == 0) "#8B653F" else "#9A7148"),
                Transform(
                    point.x,
                    point.y,
                    point.z,
                    segmentLength,
                    .035f,
                    .285f + (pseudo(index * 31 + 9) - .5f) * .018f,
                    rotationY = yaw + (pseudo(index * 41 + 3) - .5f) * 1.7f,
                    rotationZ = slope + (pseudo(index * 53 + 5) - .5f) * 1.2f,
                ),
                rimStrength = .10f,
            )
            for (side in listOf(-1f, 1f)) {
                val postX = point.x + perpendicularX * .30f * side
                val postZ = point.z + perpendicularZ * .30f * side
                val railY = .69f
                val postHeight = (railY - point.y + .035f).coerceAtLeast(.10f)
                draw(
                    requireNotNull(cylinder),
                    color("#6B4C33"),
                    Transform(
                        postX,
                        point.y + postHeight * .5f,
                        postZ,
                        .026f,
                        postHeight * .5f,
                        .026f,
                    ),
                    rimStrength = .08f,
                )
                val railPoint = WorldPoint3(postX, railY, postZ)
                if (side < 0f) leftRailPosts += railPoint else rightRailPosts += railPoint
            }
        }
        listOf(leftRailPosts, rightRailPosts).forEach { posts ->
            for (index in 0 until posts.lastIndex) {
                drawLineSegment(posts[index], posts[index + 1], "#845B3A", 1f, .024f)
            }
        }

        // Reeds occupy the irregular shoreline but explicitly leave the
        // bridge mouth, stump and water centre legible.
        repeat(16) { index ->
            val angle = index / 16f * PI.toFloat() * 2f + .18f
            val localX = sin(angle) * (1.34f + pseudo(index * 73 + 3) * .18f)
            val localZ = cos(angle) * (1.06f + pseudo(index * 79 + 7) * .17f)
            val bridgeClear = localZ > .65f && abs(localX) < 1.08f
            val stumpClear =
                (localX - POND_GRANDPA_LOCAL_X) * (localX - POND_GRANDPA_LOCAL_X) +
                    (localZ - POND_GRANDPA_LOCAL_Z) * (localZ - POND_GRANDPA_LOCAL_Z) < .34f
            if (!bridgeClear && !stumpClear) {
                val reed = pondLocalPoint(localX, .31f, localZ)
                val lean = (pseudo(index * 83 + 11) - .5f) * 14f
                draw(
                    requireNotNull(cylinder),
                    color(if (index % 3 == 0) "#5D8747" else "#527E43"),
                    Transform(reed.x, reed.y, reed.z, .022f, .27f, .022f, rotationZ = lean),
                )
                if (index % 3 == 0) {
                    draw(
                        requireNotNull(cone),
                        color("#8B6B3C"),
                        Transform(reed.x, .63f, reed.z, .055f, .14f, .055f, rotationZ = lean),
                    )
                }
            }
        }

        val bobberPoint = pondLocalPoint(.35f, .22f, .45f)
        val ripplePhase = (frame.storyTime * .42f) % 1f
        repeat(2) { index ->
            val phase = (ripplePhase + index * .46f) % 1f
            draw(
                requireNotNull(ring),
                color("#D8F4F5", .24f * (1f - phase)),
                Transform(
                    bobberPoint.x,
                    .122f,
                    bobberPoint.z,
                    .18f + phase * .46f,
                    .010f,
                    .18f + phase * .46f,
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
            val lily = pondLocalPoint(point.x, .135f, point.z)
            draw(
                requireNotNull(disc),
                color(if (index == 0) "#4E8D58" else "#5E9F60"),
                Transform(
                    lily.x,
                    lily.y,
                    lily.z,
                    point.size,
                    .012f,
                    point.size * .72f,
                    rotationY = POND_GROUP_HEADING + index * 31f,
                ),
                rimStrength = .06f,
            )
        }
        val lilyFlower = pondLocalPoint(.20f, .22f, .35f)
        draw(
            requireNotNull(lowSphere),
            color("#F7C2D2"),
            Transform(lilyFlower.x, lilyFlower.y, lilyFlower.z, .07f, .045f, .07f),
        )

        val willow = pondLocalPoint(.50f, 0f, 1.90f)
        val willowX = willow.x
        val willowZ = willow.z
        val willowElapsed = eventSeconds(willowSwayStartedMs)
        if (willowSwayStartedMs > 0L && willowElapsed > 2.8f) {
            willowSwayStartedMs = 0L
        }
        val willowSway = if (willowElapsed in 0f..2.8f) {
            sin(willowElapsed * 9f) * (1f - willowElapsed / 2.8f) * 12f
        } else {
            val windPhase =
                (willowX * latestAtmosphere.windDirectionX +
                    willowZ * latestAtmosphere.windDirectionZ) * .9f +
                    frame.storyTime * 2.2f
            sin(windPhase) * 1.7f * latestAtmosphere.windStrength
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
            val attachment = WorldPoint3(
                willowX + cos(angle) * .48f + willowTopDx * .83f,
                1.57f - (index % 2) * .06f + willowTopDy * .83f,
                willowZ + sin(angle) * .42f,
            )
            val end = WorldPoint3(
                attachment.x + sin(angle) * .045f,
                attachment.y - length,
                attachment.z + cos(angle) * .035f,
            )
            drawLineSegment(attachment, end, "#598D4D", .88f, .014f)
        }
        drawWillowMagpies(willowX + willowTopDx, willowZ, willowTopDy)

        val grandpa = pondLocalPoint(POND_GRANDPA_LOCAL_X, 0f, POND_GRANDPA_LOCAL_Z)
        val grandpaX = grandpa.x
        val grandpaZ = grandpa.z
        val heading = facingPoint(grandpaX, grandpaZ, bobberPoint.x, bobberPoint.z)
        val fishingElapsed = eventSeconds(fishingStartedMs)
        // The rendered arc is authored on a 3.35-second visual timeline, but
        // the actual egg is 2.7 seconds (5.4 for the rare golden catch).
        val fishingSequenceElapsed =
            fishingElapsed * FISHING_TIMELINE_SCALE /
                if (fishingKind == FishingKind.GOLD) 2f else 1f
        val grandpaHeadShake = if (
            fishingKind == FishingKind.BOOT &&
            fishingSequenceElapsed in 1.10f..1.90f
        ) {
            sin((fishingSequenceElapsed - 1.10f) / .80f * PI.toFloat() * 4f) * 10f
        } else {
            0f
        }
        val grandpaHeadHeading = heading + grandpaHeadShake
        draw(
            requireNotNull(pondBlob),
            color("#88AE68"),
            Transform(
                grandpaX,
                .112f,
                grandpaZ,
                .44f,
                1f,
                .36f,
                rotationY = POND_GROUP_HEADING - 16f,
            ),
            rimStrength = .05f,
        )
        draw(
            requireNotNull(cylinder),
            color("#664A34"),
            Transform(grandpaX, .12f, grandpaZ, .17f, .12f, .17f),
            rimStrength = .08f,
        )
        drawShadow(grandpaX, grandpaZ, .36f, .27f)
        drawActorPart(requireNotNull(lowSphere), "#557AA4", grandpaX, grandpaZ, 0f, .56f, 0f, .27f, .35f, .23f, heading)
        drawActorPart(requireNotNull(lowSphere), "#E9BE92", grandpaX, grandpaZ, 0f, 1.00f, .02f, .20f, .21f, .19f, grandpaHeadHeading)
        drawActorPart(requireNotNull(lowSphere), "#E7E2D8", grandpaX, grandpaZ, 0f, .89f, .18f, .18f, .15f, .12f, grandpaHeadHeading)
        drawActorPart(requireNotNull(lowSphere), "#D8D5CE", grandpaX, grandpaZ, 0f, 1.21f, -.01f, .22f, .10f, .19f, grandpaHeadHeading)
        drawActorPart(requireNotNull(lowSphere), "#D8D5CE", grandpaX, grandpaZ, .07f, 1.32f, -.01f, .075f, .075f, .07f, grandpaHeadHeading)
        drawActorPart(requireNotNull(lowSphere), "#332A24", grandpaX, grandpaZ, -.07f, 1.04f, .185f, .022f, .027f, .018f, grandpaHeadHeading)
        drawActorPart(requireNotNull(lowSphere), "#332A24", grandpaX, grandpaZ, .07f, 1.04f, .185f, .022f, .027f, .018f, grandpaHeadHeading)

        val grip = actorWorldPoint(grandpaX, grandpaZ, heading, .14f, .69f, .13f)
        val leftShoulder = actorWorldPoint(grandpaX, grandpaZ, heading, -.17f, .72f, .03f)
        val rightShoulder = actorWorldPoint(grandpaX, grandpaZ, heading, .17f, .72f, .03f)
        drawLineSegment(leftShoulder, grip, "#4D7198", 1f, .055f)
        drawLineSegment(rightShoulder, grip, "#4D7198", 1f, .055f)
        draw(requireNotNull(lowSphere), color("#E9BE92"), Transform(grip.x, grip.y, grip.z, .066f, .066f, .062f))
        for (side in listOf(-1f, 1f)) {
            drawActorPart(
                requireNotNull(lowSphere),
                "#403830",
                grandpaX,
                grandpaZ,
                side * .13f,
                .25f,
                .13f,
                .11f,
                .075f,
                .16f,
                heading,
            )
        }

        val catchEnvelope = if (fishingSequenceElapsed in 0f..3.4f) {
            sin((fishingSequenceElapsed / 3.4f).coerceIn(0f, 1f) * PI.toFloat())
        } else {
            0f
        }
        val toFloatX = bobberPoint.x - grip.x
        val toFloatZ = bobberPoint.z - grip.z
        val toFloatLength = sqrt(toFloatX * toFloatX + toFloatZ * toFloatZ).coerceAtLeast(.001f)
        val ambientRecast = lifeDirector.grandpaRecast
        val ambientRecastEnvelope = if (ambientRecast >= 0f) {
            sin(ambientRecast * PI.toFloat()).coerceAtLeast(0f)
        } else {
            0f
        }
        val rodRise = .18f +
            catchEnvelope * .43f +
            ambientRecastEnvelope * .34f +
            sin(frame.storyTime * .70f) * .012f
        val rodHorizontal = sqrt((.70f * .70f - rodRise * rodRise).coerceAtLeast(.05f))
        val rodTip = WorldPoint3(
            grip.x + toFloatX / toFloatLength * rodHorizontal,
            grip.y + rodRise,
            grip.z + toFloatZ / toFloatLength * rodHorizontal,
        )
        drawLineSegment(grip, rodTip, "#76512F", 1f, .018f)

        val floatBob = sin(frame.storyTime * 2.5f) * .025f
        val floatYank = if (fishingStartedMs > 0L) {
            smoothStep((fishingSequenceElapsed - .36f) / .38f) *
                (1f - smoothStep((fishingSequenceElapsed - 2.35f) / .35f))
        } else {
            0f
        }
        val bobberLift = floatYank * .16f
        val bobberTop = WorldPoint3(
            bobberPoint.x,
            .25f + floatBob + bobberLift,
            bobberPoint.z,
        )
        val lineSag = WorldPoint3(
            x = rodTip.x + (bobberTop.x - rodTip.x) * .55f,
            y = ((rodTip.y + bobberTop.y) * .5f - .13f).coerceAtLeast(.32f),
            z = rodTip.z + (bobberTop.z - rodTip.z) * .55f,
        )
        drawLineSegment(rodTip, lineSag, "#E9E5DA", .78f, .008f)
        drawLineSegment(lineSag, bobberTop, "#E9E5DA", .78f, .008f)
        draw(requireNotNull(lowSphere), color("#F5F2E8"), Transform(bobberPoint.x, .17f + floatBob + bobberLift, bobberPoint.z, .045f, .055f, .045f))
        draw(requireNotNull(lowSphere), color("#D94D43"), Transform(bobberPoint.x, .22f + floatBob + bobberLift, bobberPoint.z, .046f, .045f, .046f))
        val catchRipple = when {
            fishingSequenceElapsed in .36f..1.02f ->
                (fishingSequenceElapsed - .36f) / .66f
            fishingSequenceElapsed in 2.35f..3.01f ->
                (fishingSequenceElapsed - 2.35f) / .66f
            else -> -1f
        }
        if (catchRipple >= 0f) {
            repeat(3) { index ->
                val ringProgress = (catchRipple - index * .13f).coerceIn(0f, 1f)
                if (ringProgress > 0f) {
                    draw(
                        requireNotNull(ring),
                        color("#E8F4F2", (1f - ringProgress) * .46f),
                        Transform(
                            bobberPoint.x,
                            .125f,
                            bobberPoint.z,
                            .07f + ringProgress * (.30f + index * .08f),
                            .07f + ringProgress * (.30f + index * .08f),
                            .07f + ringProgress * (.30f + index * .08f),
                        ),
                        rimStrength = .02f,
                    )
                }
            }
        }
        if (ambientRecast >= .42f) {
            val ripple = ((ambientRecast - .42f) / .58f).coerceIn(0f, 1f)
            repeat(3) { index ->
                val ringProgress = (ripple - index * .14f).coerceIn(0f, 1f)
                if (ringProgress > 0f) {
                    draw(
                        requireNotNull(ring),
                        color("#E8F4F2", (1f - ringProgress) * .42f),
                        Transform(
                            bobberPoint.x,
                            .125f,
                            bobberPoint.z,
                            .08f + ringProgress * (.28f + index * .06f),
                            .08f + ringProgress * (.28f + index * .06f),
                            .08f + ringProgress * (.28f + index * .06f),
                        ),
                        rimStrength = .02f,
                    )
                }
            }
        }

        repeat(accumulatedBoots.coerceAtMost(3)) { index ->
            val boot = actorWorldPoint(
                grandpaX,
                grandpaZ,
                heading,
                -.34f - index * .13f,
                .13f,
                -.15f + index * .08f,
            )
            draw(
                requireNotNull(cube),
                color("#4A4038"),
                Transform(
                    boot.x,
                    boot.y,
                    boot.z,
                    .10f,
                    .07f,
                    .055f,
                    rotationY = heading + index * 19f,
                    rotationZ = -8f + index * 7f,
                ),
                rimStrength = .05f,
            )
        }

        if (fishingSequenceElapsed in .42f..3.25f) {
            val up = ((fishingSequenceElapsed - .42f) / .88f).coerceIn(0f, 1f)
            val down = ((fishingSequenceElapsed - 2.30f) / .85f).coerceIn(0f, 1f)
            val travel = up * (1f - down)
            val fishX = bobberPoint.x + (grip.x - bobberPoint.x) * travel
            val fishZ = bobberPoint.z + (grip.z - bobberPoint.z) * travel
            val fishY = .20f + travel * .40f +
                sin(travel * PI.toFloat()) * 1.36f
            val fishColor = when (fishingKind) {
                FishingKind.SILVER -> "#B9CAD2"
                FishingKind.GOLD -> "#FFD15A"
                FishingKind.BOOT -> "#4A4038"
            }
            val spin = fishingSequenceElapsed *
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
                    val sparkleAngle =
                        index * PI.toFloat() * .25f + fishingSequenceElapsed * 2.2f
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
        if (fishingStartedMs > 0L && fishingSequenceElapsed > 3.35f) {
            fishingStartedMs = 0L
        }

        val frogElapsed = eventSeconds(frogJumpStartedMs)
        val frogJump = if (frogElapsed in 0f..1.35f) sin(frogElapsed / 1.35f * PI.toFloat()) * .48f else 0f
        val frogTravel = if (frogJump > 0f) frogJump / .48f * .32f else 0f
        val frog = pondLocalPoint(-.43f + frogTravel, .23f + frogJump, -.24f)
        val frogHeading = POND_GROUP_HEADING
        draw(requireNotNull(lowSphere), color("#4E8A45"), Transform(frog.x, frog.y, frog.z, .095f, .065f, .085f, rotationY = frogHeading))
        val frogHead = pondLocalPoint(-.43f + frogTravel, .29f + frogJump, -.19f)
        draw(requireNotNull(lowSphere), color("#84B866"), Transform(frogHead.x, frogHead.y, frogHead.z, .067f, .057f, .060f, rotationY = frogHeading))
        for (side in listOf(-.032f, .032f)) {
            val eye = pondLocalPoint(-.43f + frogTravel + side, .35f + frogJump, -.165f)
            val pupil = pondLocalPoint(-.43f + frogTravel + side, .355f + frogJump, -.148f)
            draw(requireNotNull(lowSphere), color("#F4F0DF"), Transform(eye.x, eye.y, eye.z, .022f, .026f, .019f, rotationY = frogHeading))
            draw(requireNotNull(lowSphere), color("#28271F"), Transform(pupil.x, pupil.y, pupil.z, .009f, .011f, .008f, rotationY = frogHeading))
        }
        if (frogJumpStartedMs > 0L && frogElapsed > 1.35f) frogJumpStartedMs = 0L

        val splashProgress = lifeDirector.pondFishSplash
        if (splashProgress >= 0f) {
            val jump = sin(splashProgress * PI.toFloat())
            val splash = pondLocalPoint(.48f, .16f + jump * .30f, -.05f)
            draw(
                requireNotNull(lowSphere),
                color("#A7C9D4"),
                Transform(splash.x, splash.y, splash.z, .085f, .035f, .035f, rotationZ = splashProgress * 264f),
            )
            repeat(2) { index ->
                val ringProgress = (splashProgress - index * .18f).coerceIn(0f, 1f)
                if (ringProgress > 0f) {
                    draw(
                        requireNotNull(ring),
                        color("#E4F2F0", (1f - ringProgress) * .34f),
                        Transform(
                            splash.x,
                            .122f,
                            splash.z,
                            .08f + ringProgress * (.24f + index * .06f),
                            .08f + ringProgress * (.24f + index * .06f),
                            .08f + ringProgress * (.24f + index * .06f),
                        ),
                        rimStrength = .02f,
                    )
                }
            }
        }
    }

    private fun drawWillowMagpies(
        willowX: Float,
        willowZ: Float,
        willowTopDy: Float,
    ) {
        val elapsed = eventSeconds(magpiesStartedMs)
        if (elapsed < 0f) return
        val returnStart = MAGPIE_LAUNCH_SECONDS + MAGPIE_AWAY_SECONDS
        val cycleEnd = returnStart + MAGPIE_RETURN_SECONDS
        if (elapsed > cycleEnd) {
            magpiesStartedMs = 0L
            return
        }
        val returning = elapsed >= returnStart
        if (elapsed in MAGPIE_LAUNCH_SECONDS..returnStart) return
        val progress = if (returning) {
            1f - ((elapsed - returnStart) / MAGPIE_RETURN_SECONDS).coerceIn(0f, 1f)
        } else {
            (elapsed / MAGPIE_LAUNCH_SECONDS).coerceIn(0f, 1f)
        }
        repeat(3) { index ->
            val startX = willowX + (index - 1) * .24f
            val startY = 1.95f + willowTopDy + index * .08f
            val startZ = willowZ + (index % 2) * .18f
            val seed = magpieFlightSeed + index * 337
            val escapeAngle = pseudo(seed + 11) * PI.toFloat() * 2f
            val distance = 3f + pseudo(seed + 19) * 2.5f
            val endX = startX + sin(escapeAngle) * distance
            val endY = startY + 6f + pseudo(seed + 29) * 3f
            val endZ = startZ + cos(escapeAngle) * distance
            val dx = endX - startX
            val dz = endZ - startZ
            val horizontalLength = sqrt(dx * dx + dz * dz).coerceAtLeast(.001f)
            val side = if (pseudo(seed + 37) < .5f) -1f else 1f
            val amplitude =
                horizontalLength * (.15f + pseudo(seed + 43) * .20f) * side
            val wobble = sin(progress * PI.toFloat() * 2f) * amplitude
            val x = startX + dx * progress - dz / horizontalLength * wobble
            val y = startY + (endY - startY) * progress
            val z = startZ + dz * progress + dx / horizontalLength * wobble
            val aheadProgress = (
                progress + if (returning) -.02f else .02f
                ).coerceIn(0f, 1f)
            val aheadWobble =
                sin(aheadProgress * PI.toFloat() * 2f) * amplitude
            val aheadX =
                startX + dx * aheadProgress -
                    dz / horizontalLength * aheadWobble
            val aheadZ =
                startZ + dz * aheadProgress +
                    dx / horizontalLength * aheadWobble
            val birdHeading = Math.toDegrees(
                kotlin.math.atan2(
                    (aheadX - x).toDouble(),
                    (aheadZ - z).toDouble(),
                ),
            ).toFloat()
            drawTinyBird(
                x = x,
                y = y,
                z = z,
                heading = birdHeading,
                flap = sin(elapsed * MAGPIE_FLAP_HZ * PI.toFloat() * 2f + index) * 50f,
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

    private fun drawAtmosphereScenery() {
        val fogAmount = latestAtmosphere.fogAmount
        if (fogAmount <= .01f) return
        repeat(8) { index ->
            val angle =
                index / 8f * PI.toFloat() * 2f +
                    frame.storyTime * (.035f + index * .003f)
            val radius = 2.2f + (index % 4) * 1.35f
            val x = sin(angle) * radius
            val z = cos(angle) * radius
            val flutter = .84f + sin(frame.storyTime * .7f + index) * .16f
            draw(
                requireNotNull(lowSphere),
                color("#D9DEE2", fogAmount * .17f * flutter),
                Transform(
                    x,
                    .19f + (index % 3) * .055f,
                    z,
                    .95f + (index % 2) * .28f,
                    .11f,
                    .43f + (index % 3) * .08f,
                    rotationY = Math.toDegrees(angle.toDouble()).toFloat(),
                ),
                rimStrength = 0f,
            )
        }
    }

    private fun drawGoldenHourExtras() {
        val golden = goldenBandAmount()
        if (golden > .01f) {
            GLES30.glDepthMask(false)
            repeat(20) { index ->
                val baseX = (pseudo(index * 71 + 5) * 2f - 1f) * 7.6f
                val baseZ = (pseudo(index * 79 + 11) * 2f - 1f) * 7.6f
                val phase = frame.storyTime * .15f + index * 1.73f
                val drift = latestAtmosphere.windStrength * .20f
                draw(
                    requireNotNull(lowSphere),
                    color("#FFE9B0", golden * .30f),
                    Transform(
                        baseX +
                            sin(phase * .31f) * .22f +
                            latestAtmosphere.windDirectionX * drift,
                        .30f + pseudo(index * 83 + 17) * 1.20f +
                            sin(phase) * .08f,
                        baseZ +
                            cos(phase * .27f) * .22f +
                            latestAtmosphere.windDirectionZ * drift,
                        .022f,
                        .022f,
                        .022f,
                    ),
                    rimStrength = .08f,
                )
            }
            repeat(3) { index ->
                val spread = (index - 1) * 6f
                draw(
                    requireNotNull(cube),
                    color("#FFDF9E", golden * (.025f + index * .008f)),
                    Transform(
                        0f,
                        3.1f,
                        0f,
                        4.2f,
                        .035f,
                        .30f,
                        rotationY = 180f + spread,
                        rotationZ = -18f + index * 3f,
                    ),
                    rotateWithScene = false,
                    rimStrength = 0f,
                )
            }
            GLES30.glDepthMask(true)
        }

        val birdVisit = lifeDirector.distantBirdVisit
        if (birdVisit < 0f) return
        val angle = pseudo(251) * PI.toFloat() * 2f +
            birdVisit * PI.toFloat() * .6f
        val birdX = sin(angle) * 17f
        val birdZ = cos(angle) * 17f
        repeat(4) { index ->
            val row = if (index == 0) 0 else (index + 1) / 2
            val side = when {
                index == 0 -> 0f
                index % 2 == 0 -> 1f
                else -> -1f
            }
            drawTinyBird(
                x = birdX + side * row * .30f,
                y = 9f - row * .08f,
                z = birdZ - row * .15f,
                heading = Math.toDegrees(angle.toDouble()).toFloat() + 90f,
                flap = sin(frame.storyTime * PI.toFloat() * 4f + index) * 22f,
                bodyColor = "#2E2E33",
                flightAmount = 1f,
                scale = .72f,
            )
        }
    }

    private fun goldenBandAmount(): Float {
        solarElevationDegrees?.let { elevation ->
            return (1f - abs(elevation - 3f) / 10f).coerceIn(0f, 1f)
        }
        val hour = ((localHour % 24f) + 24f) % 24f
        val dawn = (1f - abs(hour - 6.8f) / 1.8f).coerceIn(0f, 1f)
        val dusk = (1f - abs(hour - 18.5f) / 2.0f).coerceIn(0f, 1f)
        return max(dawn, dusk)
    }

    private fun solarCelestial(
        azimuthDegrees: Float,
        elevationDegrees: Float,
    ): WorldPoint3 {
        val azimuth = Math.toRadians(azimuthDegrees.toDouble()).toFloat()
        val elevation = Math.toRadians(elevationDegrees.toDouble()).toFloat()
        val horizontal = cos(elevation)
        return WorldPoint3(
            x = sin(azimuth) * CELESTIAL_RADIUS * horizontal,
            y = sin(elevation) * CELESTIAL_RADIUS,
            z = cos(azimuth) * CELESTIAL_RADIUS * horizontal,
        )
    }

    private fun fallbackCelestial(hourOffset: Float): WorldPoint3 {
        val angle = ((localHour - hourOffset) / 24f) * PI.toFloat() * 2f
        return WorldPoint3(
            x = sin(angle) * CELESTIAL_RADIUS,
            y = cos(angle) * 10f,
            z = cos(angle) * CELESTIAL_RADIUS * .40f,
        )
    }

    private fun moonMechanicallyVisible(): Boolean {
        val elevation = solarElevationDegrees
        return if (elevation != null) {
            elevation < 0f && moonPosition.y > -1.5f
        } else {
            eveningAmount() > .05f && moonPosition.y > -1.5f
        }
    }

    private fun sunMechanicallyVisible(): Boolean =
        solarElevationDegrees?.let { it > -6f } ?: (sunPosition.y > -1.5f)

    private fun drawHareButterflies() {
        val butterflyCount = if (activeZone() == SceneZone.HARE) 3 else 2
        repeat(butterflyCount) { index ->
            val center = radial(61f + index * 10f, 5.62f + index * .25f)
            val orbit = frame.storyTime * (.72f + index * .11f) + index * 2.1f
            val landing = lifeDirector.butterflyLanding
            val landed = index == 2 && landing >= 0f
            val x = if (landed) {
                center.first + .11f
            } else {
                center.first + cos(orbit) * (.24f + index * .04f)
            }
            val z = if (landed) {
                center.second - .08f
            } else {
                center.second + sin(orbit) * (.19f + index * .03f)
            }
            val y = if (landed) {
                groundHeightAt(x, z) + .31f
            } else {
                .62f + sin(orbit * 1.7f) * .18f + index * .08f
            }
            val flap = if (landed) {
                .025f + abs(sin(frame.storyTime * PI.toFloat() * 2f)) * .018f
            } else {
                .035f + abs(sin(frame.storyTime * 9f + index)) * .045f
            }
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
        val crowFlight = lifeDirector.crowFlight
        if (activeZone() == SceneZone.WOLF && crowFlight >= 0f) {
            val zoneRadians = Math.toRadians(144.0)
            val (centerX, centerZ) = radial(144f, 6.15f)
            val tangentX = cos(zoneRadians).toFloat()
            val tangentZ = -sin(zoneRadians).toFloat()
            val travel = (crowFlight - .5f) * 3f
            drawTinyBird(
                x = centerX + tangentX * travel,
                y = 2.4f + sin(crowFlight * PI.toFloat()) * .16f,
                z = centerZ + tangentZ * travel,
                heading = Math.toDegrees(
                    kotlin.math.atan2(
                        tangentX.toDouble(),
                        tangentZ.toDouble(),
                    ),
                ).toFloat(),
                flap = sin(crowFlight * PI.toFloat() * 4f) * 34f,
                bodyColor = "#2D3338",
                flightAmount = 1f,
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
        val beeCount = if (activeZone() == SceneZone.BEAR) 5 else 3
        repeat(beeCount) { index ->
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
        val leafCount = if (activeZone() == SceneZone.BEAR) 7 else 2
        repeat(leafCount) { index ->
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
        if (activeZone() != SceneZone.FOX) return
        val progress = lifeDirector.foxFeatherFall
        if (progress >= 0f) {
            val (startX, startZ) = radial(282f, 5.45f)
            val pendulum = sin(progress * PI.toFloat() * 4.8f)
            val windCarry = latestAtmosphere.windStrength * progress * .35f
            draw(
                requireNotNull(lowSphere),
                color("#FFF2DE", .88f),
                Transform(
                    startX + pendulum * .20f +
                        latestAtmosphere.windDirectionX * windCarry,
                    1.8f - progress * 1.55f,
                    startZ + latestAtmosphere.windDirectionZ * windCarry,
                    .035f,
                    .012f,
                    .11f,
                    rotationY = progress * 360f,
                    rotationZ = pendulum * 20f,
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
        val targetGroundY = groundHeightAt(target.first, target.second)
        val startX = 0f
        val startZ = 0f
        val travel = when {
            elapsed < 4f -> elapsed / 4f
            elapsed < 5.6f -> 1f
            else -> (1f - (elapsed - 5.6f) / 4f).coerceIn(0f, 1f)
        }
        val pathProgress = travel.coerceIn(0f, 1f)
        val sideDirection = if (journey.seed and 1 == 0) 1f else -1f
        val dx = target.first - startX
        val dz = target.second - startZ
        val length = sqrt(dx * dx + dz * dz).coerceAtLeast(.01f)
        val pathAmplitude =
            length * (.12f + pseudo(journey.seed + 31) * .16f) * sideDirection
        val side = sin(pathProgress * PI.toFloat()) * pathAmplitude
        var x = startX + dx * pathProgress - dz / length * side
        var z = startZ + dz * pathProgress + dx / length * side
        val sniffing = elapsed in 4f..5.6f
        if (sniffing) {
            val sniff = sin((elapsed - 4f) * 9f) * .045f
            x += dx / length * sniff
            z += dz / length * sniff
        }
        val y =
            .27f +
                targetGroundY * pathProgress +
                abs(sin(elapsed * 3f * PI.toFloat())) * .028f
        val curveDerivative =
            cos(pathProgress * PI.toFloat()) * pathAmplitude * PI.toFloat()
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
        val pop = (elapsed / OWL_POP_SECONDS).coerceIn(0f, 1f)
        val flapElapsed = eventSeconds(owlFlapStartedMs)
        val duck = if (flapElapsed >= 0f) {
            ((flapElapsed - OWL_FLAP_SECONDS) / OWL_DUCK_SECONDS).coerceIn(0f, 1f)
        } else {
            (
                (elapsed - OWL_POP_SECONDS - OWL_LOOK_SECONDS) /
                    OWL_DUCK_SECONDS
                ).coerceIn(0f, 1f)
        }
        val owlFinished = if (flapElapsed >= 0f) {
            flapElapsed > OWL_FLAP_SECONDS + OWL_DUCK_SECONDS
        } else {
            elapsed > OWL_POP_SECONDS + OWL_LOOK_SECONDS + OWL_DUCK_SECONDS
        }
        if (owlFinished) {
            owlStartedMs = 0L
            owlFlapStartedMs = 0L
            return
        }
        val visibleScale = pop * (1f - duck)
        val cameraHeading = facingPoint(x, z, eyeX, eyeZ)
        val headYaw = cameraHeading + sin(elapsed * 2.2f) * 35f
        val headYawRadians = Math.toRadians(headYaw.toDouble())
        val headYawCosine = cos(headYawRadians).toFloat()
        val headYawSine = sin(headYawRadians).toFloat()
        val flap = if (flapElapsed in 0f..OWL_FLAP_SECONDS) {
            sin(flapElapsed * 4.5f * PI.toFloat() * 2f) * 55f
        } else {
            0f
        }
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
            val wingAngle = if (flapElapsed >= 0f) {
                side * flap
            } else {
                side * OWL_FOLDED_WING_DEGREES
            }
            val wingRadians = Math.toRadians(wingAngle.toDouble())
            val wingHalfLength = .18f * visibleScale
            val wingRootX = x + side * .11f * visibleScale
            val wingRootY = y + .21f * visibleScale
            val wingCenterX =
                wingRootX + sin(wingRadians).toFloat() * wingHalfLength
            val wingCenterY =
                wingRootY - cos(wingRadians).toFloat() * wingHalfLength
            draw(
                requireNotNull(lowSphere),
                color("#715B45"),
                Transform(
                    wingCenterX,
                    wingCenterY,
                    z,
                    .07f * visibleScale,
                    wingHalfLength,
                    .045f * visibleScale,
                    rotationZ = wingAngle,
                ),
                rimStrength = .16f,
            )
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
        if (eyeY >= 6.35f) return
        repeat(SCENE_CLOUD_COUNT) { index ->
            val cloud = cloudPosition(index)
            val drizzleElapsed = eventSeconds(drizzleStartedAtMs[index])
            val raining = drizzleElapsed in 0f..15f
            val rainEnvelope = if (raining) {
                min(
                    (drizzleElapsed / CLOUD_DARKEN_SECONDS).coerceIn(0f, 1f),
                    ((CLOUD_RAIN_SECONDS - drizzleElapsed) / CLOUD_DARKEN_SECONDS)
                        .coerceIn(0f, 1f),
                )
            } else {
                0f
            }
            val cloudShade = latestAtmosphere.cloudColor.lerp(
                SceneColor(.43f, .48f, .54f),
                rainEnvelope * .70f,
            )
            val edgeShade = cloudShade.brighten(.20f)
            val cameraVisibility = cloudCameraVisibility(cloud)
            if (cameraVisibility <= .015f) return@repeat
            val opacity =
                max(.68f, latestAtmosphere.cloudOpacity) * cameraVisibility
            val scale = .85f + pseudo(index * 97 + 31) * .35f
            val yaw = pseudo(index * 101 + 53) * PI.toFloat() * 2f
            val yawDegrees = Math.toDegrees(yaw.toDouble()).toFloat()
            val cosine = cos(yaw)
            val sine = sin(yaw)
            fun lobeOffset(across: Float, forward: Float): Pair<Float, Float> =
                across * cosine + forward * sine to
                    -across * sine + forward * cosine
            // Match the predecessor's hand-built three-sphere cloud:
            // medium, large, small with 30% overlap. The previous native
            // pass doubled and flattened every lobe, which made a nearby
            // cloud read as a full-screen slab.
            val medium = lobeOffset(-.77f * scale, -.01f * scale)
            val small = lobeOffset(.71f * scale, .02f * scale)
            draw(
                requireNotNull(sphere),
                color(cloudShade, opacity * .94f),
                Transform(
                    cloud.x,
                    cloud.y,
                    cloud.z,
                    .65f * scale,
                    .65f * scale,
                    .65f * scale,
                    rotationY = yawDegrees,
                ),
                rotateWithScene = false,
                rimStrength = .08f,
            )
            draw(
                requireNotNull(sphere),
                color(edgeShade, opacity),
                Transform(
                    cloud.x + medium.first,
                    cloud.y - .04f * scale,
                    cloud.z + medium.second,
                    .50f * scale,
                    .50f * scale,
                    .50f * scale,
                    rotationY = yawDegrees,
                ),
                rotateWithScene = false,
                rimStrength = .08f,
            )
            draw(
                requireNotNull(sphere),
                color(edgeShade, opacity),
                Transform(
                    cloud.x + small.first,
                    cloud.y - .07f * scale,
                    cloud.z + small.second,
                    .38f * scale,
                    .38f * scale,
                    .38f * scale,
                    rotationY = yawDegrees,
                ),
                rotateWithScene = false,
                rimStrength = .08f,
            )
            if (cloud.x * cloud.x + cloud.z * cloud.z <= 8f * 8f) {
                draw(
                    requireNotNull(disc),
                    color("#45684C", .08f + rainEnvelope * .08f),
                    Transform(cloud.x, .052f, cloud.z, 1.28f, .008f, .62f),
                    rotateWithScene = false,
                    rimStrength = 0f,
                )
            }
            if (raining) {
                repeat(10) { drop ->
                    val row = drop / 5
                    val column = drop % 5
                    val fall = (drizzleElapsed * 2.7f + row * .25f + column * .11f) % 1f
                    draw(
                        requireNotNull(cylinder),
                        color("#84B7D1", .72f),
                        Transform(
                            cloud.x + (column - 2f) * .28f * scale +
                                sin(drop * 2.4f) * .07f,
                            cloud.y - .65f - fall * (cloud.y - .58f),
                            cloud.z + (row - .5f) * .22f * scale,
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
            if (drizzleStartedAtMs[index] > 0L && drizzleElapsed > CLOUD_RAIN_SECONDS) {
                drizzleStartedAtMs[index] = 0L
            }
        }
    }

    private fun drawKolobok() {
        var foxEndingElapsed = eventSeconds(foxEndingStartedMs)
        if (foxEndingElapsed > FOX_ENDING_DURATION_SECONDS) {
            latestStory = storyDirector.finishStandaloneFoxEnding()
            transforms.setCameraYaw(renderedCameraYaw)
            foxEndingStartedMs = 0L
            foxEndingRebirthTriggered = false
            foxEndingElapsed = -1f
        }
        if (
            foxEndingElapsed >= FOX_ENDING_REBIRTH_SECONDS &&
            !foxEndingRebirthTriggered
        ) {
            foxEndingRebirthTriggered = true
            val now = SystemClock.uptimeMillis()
            izbaFlashStartedMs = now
            smokeRingsStartedMs = now
        }
        val story = latestStory
        val encounter = latestEncounter
        val position = currentKolobokPoint()
        var x = position.x
        var z = position.z
        var endingHeightOffset = 0f
        var endingScaleMultiplier = 1f
        if (foxEndingElapsed in .60f..1.50f) {
            val (foxX, foxZ) = radial(288f, 5.42f)
            val progress = smoothStep((foxEndingElapsed - .60f) / .50f)
            x += (foxX - x) * progress
            z += (foxZ - z) * progress
            endingHeightOffset = sin(progress * PI.toFloat()) * .12f
            if (foxEndingElapsed >= 1.10f) {
                endingScaleMultiplier =
                    1f - smoothStep((foxEndingElapsed - 1.10f) / .40f)
            }
        } else if (foxEndingElapsed in 1.50f..1.90f) {
            // The native UI is fully black during this teleport.
            return
        } else if (foxEndingElapsed in 1.90f..3.35f) {
            val progress = smoothStep((foxEndingElapsed - 1.90f) / .60f)
            x = -.34f * (1f - progress)
            z = 5.46f + (4.60f - 5.46f) * progress
            endingHeightOffset = (1f - progress) * 1.05f +
                sin(progress * PI.toFloat()) * .42f
            endingScaleMultiplier = easeOutBack01(
                (foxEndingElapsed - 1.90f) / .50f,
            ).coerceAtLeast(0f)
        } else if (foxEndingElapsed in 3.35f..FOX_ENDING_DURATION_SECONDS) {
            x = 0f
            z = SceneMotion.PATH_RADIUS
        }
        val greeting = if (SystemClock.uptimeMillis() < greetingUntilMs) {
            abs(sin((greetingUntilMs - SystemClock.uptimeMillis()) * .012f)) * .18f
        } else {
            0f
        }
        val speedAmount = (kolobokLinearSpeed / .65f).coerceIn(0f, 1f)
        val bounce = if (speedAmount > .15f) {
            abs(sin(Math.toRadians(kolobokRollDegrees.toDouble()).toFloat() * 2f)) * .020f
        } else {
            0f
        }
        val idleBob = if (story.positionOverride == null) {
            sin(frame.storyTime * 2.5f) * .030f
        } else {
            0f
        }
        val singing = story.singing || encounter.singing
        val singingBob = if (singing) {
            sin(frame.storyTime * 2.2f * PI.toFloat() * 2f) * .050f
        } else {
            0f
        }
        val y =
            position.y +
                idleBob +
                bounce +
                greeting +
                singingBob +
                encounter.kolobokHop +
                endingHeightOffset
        val heading = Math.toDegrees(story.kolobokAngleRadians.toDouble()).toFloat() +
            90f + (story.spinTurns + encounter.kolobokSpinTurns) * 360f
        val faceHeading = heading + story.faceYawDegrees
        val eyelidClose = max(
            lifeDirector.kolobokEyelidClose,
            story.forcedBlink,
        )
        val eyeOpen = .10f +
            (.018f - .10f) * eyelidClose
        val visibleScale =
            story.kolobokScale.coerceAtLeast(0f) * endingScaleMultiplier
        if (
            story.chapter == SceneStoryChapter.BIRTH &&
            story.chapterSeconds in 9.5f..10.3f
        ) {
            drawKolobokLandingDust(
                x = x,
                z = z,
                progress = (story.chapterSeconds - 9.5f) / .8f,
            )
        }
        if (story.catchBurst > .001f) {
            drawFoxCatchBurst(x, y, z, story.catchBurst)
        }
        if (visibleScale <= .004f) return
        val squash = min(
            .35f,
            speedAmount * .18f +
                encounter.kolobokSquash +
                story.squash,
        )
        val bodyScaleX = .42f * visibleScale * (1f + squash * .45f)
        val bodyScaleY = .42f * visibleScale * (1f - squash)
        val bodyScaleZ = .42f * visibleScale * (1f + squash * .45f)
        val expression = story.expression
        val expressionBlend =
            (latestDeltaSeconds / .20f).coerceIn(0f, 1f)
        renderedHappyExpression += (
            (if (expression == KolobokExpression.HAPPY) 1f else 0f) -
                renderedHappyExpression
            ) * expressionBlend
        renderedStartledExpression += (
            (if (expression == KolobokExpression.STARTLED) 1f else 0f) -
                renderedStartledExpression
            ) * expressionBlend
        renderedSlyExpression += (
            (if (expression == KolobokExpression.SLY) 1f else 0f) -
                renderedSlyExpression
            ) * expressionBlend

        drawShadow(x, z, .47f * visibleScale, .34f * visibleScale)
        draw(
            requireNotNull(sphere),
            color("#F2C14E"),
            Transform(
                x,
                y,
                z,
                bodyScaleX,
                bodyScaleY,
                bodyScaleZ,
                rotationX = kolobokRollDegrees,
                rotationY = heading,
                rotationZ = story.bodyTiltDegrees,
            ),
            rimStrength = .36f,
        )
        val rollRadians = Math.toRadians(kolobokRollDegrees.toDouble())
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
                .085f * visibleScale,
                .055f * visibleScale,
                .035f * visibleScale,
                heading,
                rotationX = kolobokRollDegrees,
                rotationZ = story.bodyTiltDegrees,
            )
        }

        for (offset in listOf(-.13f, .13f)) {
            drawActorPart(
                requireNotNull(sphere),
                "#FAF6EC",
                x,
                z,
                offset * visibleScale,
                y + .10f * visibleScale,
                .365f * visibleScale,
                .082f * visibleScale,
                eyeOpen * visibleScale,
                .040f * visibleScale,
                faceHeading,
                rotationZ = story.bodyTiltDegrees,
            )
            if (eyeOpen > .02f) {
                drawActorPart(
                    requireNotNull(lowSphere),
                    "#3A2C1A",
                    x,
                    z,
                    offset * visibleScale,
                    y + .095f * visibleScale,
                    .410f * visibleScale,
                    .031f * visibleScale,
                    .043f * visibleScale,
                    .020f * visibleScale,
                    faceHeading,
                    rotationZ = story.bodyTiltDegrees,
                )
            }
            val browLift =
                renderedHappyExpression * .025f +
                    renderedStartledExpression * .050f +
                    renderedSlyExpression * if (offset < 0f) .045f else .005f
            val restingBrowTilt = if (offset < 0f) -8f else 8f
            val browTilt =
                restingBrowTilt +
                    renderedHappyExpression *
                    ((if (offset < 0f) -18f else 18f) - restingBrowTilt) +
                    renderedSlyExpression *
                    ((if (offset < 0f) -13f else 5f) - restingBrowTilt)
            drawActorPart(
                requireNotNull(cube),
                "#8A5A22",
                x,
                z,
                offset * visibleScale,
                y + (.245f + browLift) * visibleScale,
                .372f * visibleScale,
                .075f * visibleScale,
                .018f * visibleScale,
                .018f * visibleScale,
                faceHeading,
                rotationZ = browTilt + story.bodyTiltDegrees,
            )
        }
        drawActorPart(requireNotNull(lowSphere), "#E89A5B", x, z, 0f, y - .015f * visibleScale, .415f * visibleScale, .060f * visibleScale, .050f * visibleScale, .028f * visibleScale, faceHeading, rotationZ = story.bodyTiltDegrees)
        drawActorPart(requireNotNull(lowSphere), "#E89A5B", x, z, -.235f * visibleScale, y - .055f * visibleScale, .345f * visibleScale, .078f * visibleScale, .045f * visibleScale, .025f * visibleScale, faceHeading, rotationZ = story.bodyTiltDegrees)
        drawActorPart(requireNotNull(lowSphere), "#E89A5B", x, z, .235f * visibleScale, y - .055f * visibleScale, .345f * visibleScale, .078f * visibleScale, .045f * visibleScale, .025f * visibleScale, faceHeading, rotationZ = story.bodyTiltDegrees)
        if (singing || renderedStartledExpression > .06f) {
            val mouthScale = if (singing) 1f else {
                .62f + (1f - renderedStartledExpression) * .38f
            }
            drawActorPart(
                requireNotNull(lowSphere),
                "#6D392A",
                x,
                z,
                0f,
                y - .145f * visibleScale,
                .405f * visibleScale,
                .105f * mouthScale * visibleScale,
                .105f * mouthScale * visibleScale,
                .028f * visibleScale,
                faceHeading,
                rotationZ = story.bodyTiltDegrees,
            )
        } else {
            val smileScale = 1f + renderedSlyExpression * .15f
            repeat(7) { index ->
                val t = index / 6f
                drawActorPart(
                    requireNotNull(lowSphere),
                    "#6D392A",
                    x,
                    z,
                    (t - .5f) * .27f * smileScale * visibleScale,
                    y - (.14f + abs(t - .5f) * .065f) * visibleScale,
                    .395f * visibleScale,
                    .021f * visibleScale,
                    .018f * visibleScale,
                    .013f * visibleScale,
                    faceHeading,
                    rotationZ = story.bodyTiltDegrees,
                )
            }
        }

        if (story.rolling) {
            repeat(5) { index ->
                val trailTravel = story.kolobokAngleRadians - .10f - index * .075f
                val life = ((frame.storyTime * 1.4f + index * .22f) % 1f)
                val windDrift = life * latestAtmosphere.windStrength * .22f
                val trailX = sin(trailTravel) * 4.6f +
                    latestAtmosphere.windDirectionX * windDrift
                val trailZ = cos(trailTravel) * 4.6f +
                    latestAtmosphere.windDirectionZ * windDrift
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
        }
        if (singing) {
            repeat(4) { index ->
                val noteLife = ((frame.storyTime + index * .28f) % 1.8f) / 1.8f
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

    private fun drawKolobokLandingDust(
        x: Float,
        z: Float,
        progress: Float,
    ) {
        val life = progress.coerceIn(0f, 1f)
        repeat(10) { index ->
            val angle = index * 36f + pseudo(index * 43 + 17) * 24f
            val radians = Math.toRadians(angle.toDouble())
            val radius = .10f + life * (.34f + pseudo(index * 47 + 11) * .24f)
            val size = (.055f + pseudo(index * 53 + 9) * .045f) * (1f - life * .45f)
            draw(
                requireNotNull(lowSphere),
                color("#D5B37D", .46f * (1f - life)),
                Transform(
                    x + cos(radians).toFloat() * radius,
                    .10f + sin(life * PI.toFloat()) * .12f,
                    z + sin(radians).toFloat() * radius,
                    size,
                    size * .55f,
                    size,
                ),
                rimStrength = .01f,
            )
        }
    }

    private fun drawFoxCatchBurst(
        x: Float,
        y: Float,
        z: Float,
        amount: Float,
    ) {
        val life = 1f - amount.coerceIn(0f, 1f)
        repeat(10) { index ->
            val angle = index * 36f + (pseudo(index * 67 + 23) - .5f) * 18f
            val radians = Math.toRadians(angle.toDouble())
            val startRadius = .16f + life * .13f
            val endRadius = .42f + life * (.48f + pseudo(index * 71 + 31) * .24f)
            val lift = sin(radians).toFloat() * .34f
            drawLineSegment(
                start = WorldPoint3(
                    x + cos(radians).toFloat() * startRadius,
                    y + lift * startRadius,
                    z + sin(radians).toFloat() * startRadius * .45f,
                ),
                end = WorldPoint3(
                    x + cos(radians).toFloat() * endRadius,
                    y + lift * endRadius,
                    z + sin(radians).toFloat() * endRadius * .45f,
                ),
                hex = if (index % 2 == 0) "#FFF0A3" else "#F8C75B",
                alpha = amount * .84f,
                thickness = .018f,
            )
        }
        repeat(7) { index ->
            val angle = pseudo(index * 79 + 37) * PI.toFloat() * 2f
            val radius = life * (.18f + pseudo(index * 83 + 41) * .38f)
            val puffScale = (.10f + pseudo(index * 89 + 43) * .09f) * (1f + life)
            draw(
                requireNotNull(lowSphere),
                color("#F8E2B8", amount * .48f),
                Transform(
                    x + cos(angle) * radius,
                    y + (pseudo(index * 97 + 47) - .5f) * .30f + life * .16f,
                    z + sin(angle) * radius,
                    puffScale,
                    puffScale * .72f,
                    puffScale,
                ),
                rimStrength = .02f,
            )
        }
    }

    private fun drawHare() {
        val approach = actorApproach(SceneActor.HARE)
        val reaction = reactionEnvelope(AnimalReaction.HARE)
        val (x, z) = radial(72f, 6.15f - approach * .60f - reaction * .22f)
        val previousActorAlpha = actorDrawAlpha
        actorDrawAlpha = animalCameraVisibility(x, z, .62f)
        val heading = facingCenter(x, z)
        val greeting = greetingEnvelope(SceneActor.HARE)
        val wetShake = lifeDirector.wetShakeDegrees(SceneActor.HARE)
        val wetX = wetShake / 12f * .035f
        val bob = sin(frame.storyTime * 2.2f + .4f) * .025f +
            lifeDirector.hareHop +
            reaction * .32f
        drawShadow(x, z, .46f, .34f)
        drawActorPart(requireNotNull(sphere), "#D9D7D5", x, z, wetX, .50f + bob, 0f, .38f, .50f, .34f, heading, rotationZ = wetShake * .16f)
        drawActorPart(requireNotNull(sphere), "#E6E4E1", x, z, wetX, .96f + bob, .05f, .32f, .34f, .31f, heading, rotationZ = wetShake * .20f)
        drawActorPart(requireNotNull(lowSphere), "#F8F4EF", x, z, wetX, .53f + bob, .31f, .23f, .28f, .14f, heading)
        for (side in listOf(-1f, 1f)) {
            val idleTwitch = if (side < 0f) {
                lifeDirector.hareLeftEarDegrees
            } else {
                lifeDirector.hareRightEarDegrees
            }
            val earAngle = side * 7f +
                idleTwitch +
                side * reaction * 18f +
                side * sin(frame.storyTime * 9f) * greeting * 14f +
                wetShake * .18f
            val earRadians = Math.toRadians(earAngle.toDouble())
            val earHalfLength = .43f
            val earRootX = side * .15f + wetX
            val earRootY = .99f + bob
            val earCenterX = earRootX - sin(earRadians).toFloat() * earHalfLength
            val earCenterY = earRootY + cos(earRadians).toFloat() * earHalfLength
            drawActorPart(
                requireNotNull(sphere),
                "#D9D7D5",
                x,
                z,
                earCenterX,
                earCenterY,
                .01f,
                .10f,
                earHalfLength,
                .10f,
                heading,
                rotationZ = earAngle,
            )
            val innerHalfLength = .32f
            val innerRootY = 1.05f + bob
            val innerCenterX = earRootX - sin(earRadians).toFloat() * innerHalfLength
            val innerCenterY = innerRootY + cos(earRadians).toFloat() * innerHalfLength
            drawActorPart(
                requireNotNull(sphere),
                "#F2A8B5",
                x,
                z,
                innerCenterX,
                innerCenterY,
                .095f,
                .038f,
                innerHalfLength,
                .025f,
                heading,
                rotationZ = earAngle,
            )
        }
        drawActorPart(requireNotNull(lowSphere), "#25211F", x, z, -.115f + wetX, 1.02f + bob, .315f, .038f, .045f, .025f, heading)
        drawActorPart(requireNotNull(lowSphere), "#25211F", x, z, .115f + wetX, 1.02f + bob, .315f, .038f, .045f, .025f, heading)
        val sniffScale = 1f +
            max(0f, sin(frame.storyTime * PI.toFloat() * 2f * 4f)) * .02f
        drawActorPart(requireNotNull(lowSphere), "#F28B9E", x, z, wetX, .90f + bob, .355f, .052f * sniffScale, .042f * sniffScale, .028f * sniffScale, heading)
        drawActorPart(requireNotNull(lowSphere), "#F4F1EC", x, z, .35f + wetX, .52f + bob, -.24f, .22f, .23f, .22f, heading)
        drawActorPart(requireNotNull(cone), "#F28C32", x, z, -.48f + wetX, .18f, .14f, .08f, .28f, .08f, heading, rotationZ = 90f)
        repeat(3) { index ->
            drawActorPart(requireNotNull(cube), "#4E8C45", x, z, -.56f + index * .04f + wetX, .27f, .13f, .018f, .12f, .035f, heading, rotationZ = -18f + index * 18f)
        }
        actorDrawAlpha = previousActorAlpha
    }

    private fun drawWolf() {
        val approach = actorApproach(SceneActor.WOLF)
        val reaction = reactionEnvelope(AnimalReaction.WOLF)
        val reactionProgress = actorReactionProgress(SceneActor.WOLF)
        val (x, z) = radial(144f, 6.15f - approach * .60f - reaction * .28f)
        val previousActorAlpha = actorDrawAlpha
        actorDrawAlpha = animalCameraVisibility(x, z, .72f)
        val heading = facingCenter(x, z)
        val greeting = greetingEnvelope(SceneActor.WOLF)
        val wetShake = lifeDirector.wetShakeDegrees(SceneActor.WOLF)
        val wetX = wetShake / 12f * .040f
        val landingShake = if (reactionProgress > .60f) {
            sin((reactionProgress - .60f) / .40f * PI.toFloat() * 4f) * 10f
        } else {
            0f
        }
        val headSweep = lifeDirector.wolfHeadSweepDegrees + landingShake
        val howlPitch = lifeDirector.wolfHowlDegrees
        val headHeading = heading + headSweep
        val reactY = reaction * .22f
        val tailYaw = 180f +
            sin(frame.storyTime * 1.4f) * 11f +
            sin(frame.storyTime * 8f) * greeting * 28f
        val tailPitch = 12f
        val tailYawRadians = Math.toRadians(tailYaw.toDouble())
        val tailPitchRadians = Math.toRadians(tailPitch.toDouble())
        val tailHalfLength = .48f
        val tailHorizontal = cos(tailPitchRadians).toFloat() * tailHalfLength
        val tailLocalX = -.30f + sin(tailYawRadians).toFloat() * tailHorizontal
        val tailForward = -.22f + cos(tailYawRadians).toFloat() * tailHorizontal
        val tailY = .70f + reactY + sin(tailPitchRadians).toFloat() * tailHalfLength
        drawShadow(x, z, .56f, .38f)
        drawActorPart(requireNotNull(sphere), "#66727D", x, z, wetX, .55f + reactY, -.10f, .43f, .52f, .58f, heading, rotationZ = wetShake * .16f)
        drawActorPart(requireNotNull(lowSphere), "#75818B", x, z, wetX, 1.03f + reactY, .18f, .36f, .38f, .34f, headHeading, rotationX = howlPitch, rotationZ = wetShake * .18f)
        drawActorPart(requireNotNull(lowSphere), "#AAB1B4", x, z, wetX, .93f + reactY, .43f, .25f, .19f, .24f, headHeading, rotationX = howlPitch)
        drawActorPart(requireNotNull(cone), "#58646E", x, z, -.22f + wetX, 1.44f + reactY, .10f, .16f, .31f, .15f, headHeading, rotationX = howlPitch, rotationZ = -10f + wetShake * .18f)
        drawActorPart(requireNotNull(cone), "#58646E", x, z, .22f + wetX, 1.44f + reactY, .10f, .16f, .31f, .15f, headHeading, rotationX = howlPitch, rotationZ = 10f + wetShake * .18f)
        drawActorPart(requireNotNull(lowSphere), "#20252A", x, z, -.12f + wetX, 1.10f + reactY, .34f, .038f, .045f, .025f, headHeading, rotationX = howlPitch)
        drawActorPart(requireNotNull(lowSphere), "#20252A", x, z, .12f + wetX, 1.10f + reactY, .34f, .038f, .045f, .025f, headHeading, rotationX = howlPitch)
        drawActorPart(requireNotNull(lowSphere), "#242425", x, z, wetX, .96f + reactY, .62f, .065f, .050f, .055f, headHeading, rotationX = howlPitch)
        drawActorPart(
            requireNotNull(sphere),
            "#5B6670",
            x,
            z,
            tailLocalX + wetX,
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
            drawActorPart(requireNotNull(cylinder), "#59646D", x, z, side + wetX, .26f + reactY, .20f, .09f, .27f, .09f, heading)
        }
        actorDrawAlpha = previousActorAlpha
    }

    private fun drawBear() {
        val approach = actorApproach(SceneActor.BEAR)
        val (x, z) = radial(216f, 6.15f - approach * .60f)
        val previousActorAlpha = actorDrawAlpha
        actorDrawAlpha = animalCameraVisibility(x, z, .92f)
        val heading = facingCenter(x, z)
        val reaction = reactionEnvelope(AnimalReaction.BEAR)
        val greeting = greetingEnvelope(SceneActor.BEAR)
        val wetShake = lifeDirector.wetShakeDegrees(SceneActor.BEAR)
        val wetX = wetShake / 12f * .045f
        val sway = lifeDirector.bearWeightShiftDegrees +
            wetShake * .18f
        val swayRadians = Math.toRadians(sway.toDouble())
        val swayCosine = cos(swayRadians).toFloat()
        val swaySine = sin(swayRadians).toFloat()
        val pivotY = .08f
        fun posed(localX: Float, y: Float): Pair<Float, Float> {
            val relativeY = y - pivotY
            return (
                localX * swayCosine - relativeY * swaySine + wetX
                ) to (
                pivotY + localX * swaySine + relativeY * swayCosine
                )
        }

        drawShadow(x, z, .68f, .46f)
        val body = posed(0f, .66f)
        drawActorPart(requireNotNull(sphere), "#79533A", x, z, body.first, body.second, -.05f, .58f, .67f, .49f, heading, rotationZ = sway)
        val head = posed(0f, 1.28f)
        drawActorPart(requireNotNull(sphere), "#865E41", x, z, head.first, head.second, .13f, .46f, .48f, .42f, heading, rotationZ = sway)
        val muzzle = posed(0f, 1.17f)
        drawActorPart(requireNotNull(lowSphere), "#9A7253", x, z, muzzle.first, muzzle.second, .48f, .29f, .22f, .22f, heading, rotationZ = sway)
        for (side in listOf(-1f, 1f)) {
            val ear = posed(side * .31f, 1.61f)
            drawActorPart(requireNotNull(lowSphere), "#765039", x, z, ear.first, ear.second, .06f, .18f, .18f, .15f, heading, rotationZ = sway)
            val eye = posed(side * .15f, 1.36f)
            drawActorPart(requireNotNull(lowSphere), "#29231F", x, z, eye.first, eye.second, .39f, .040f, .045f, .025f, heading, rotationZ = sway)
        }
        val nose = posed(0f, 1.18f)
        drawActorPart(requireNotNull(lowSphere), "#2F2520", x, z, nose.first, nose.second, .68f, .070f, .055f, .050f, heading, rotationZ = sway)
        val belly = posed(0f, .69f)
        drawActorPart(requireNotNull(lowSphere), "#B88963", x, z, belly.first, belly.second, .44f, .34f, .37f, .15f, heading, rotationZ = sway)
        for (side in listOf(-1f, 1f)) {
            val wave = if (side > 0f && greeting > 0f) {
                greeting * 100f +
                    sin(frame.storyTime * 2.5f * PI.toFloat() * 2f) *
                    greeting * 14f
            } else {
                0f
            }
            val armAngle = sway + side * (12f + wave)
            val armRadians = Math.toRadians(armAngle.toDouble())
            val scratch = if (lifeDirector.bearScratchSide == side) {
                lifeDirector.bearScratchDegrees
            } else {
                0f
            }
            val armPitch = reaction * 45f + scratch
            val armPitchRadians = Math.toRadians(armPitch.toDouble())
            val armHalfLength = .42f
            val shoulder = posed(side * (.43f - reaction * .12f), .98f)
            val shoulderX = shoulder.first
            val shoulderY = shoulder.second
            val armCenterX = shoulderX +
                sin(armRadians).toFloat() * cos(armPitchRadians).toFloat() *
                armHalfLength
            val armCenterY = shoulderY -
                cos(armRadians).toFloat() * cos(armPitchRadians).toFloat() *
                armHalfLength
            val armCenterForward =
                .02f + sin(armPitchRadians).toFloat() * armHalfLength
            drawActorPart(
                requireNotNull(cylinder),
                "#744D35",
                x,
                z,
                armCenterX,
                armCenterY,
                armCenterForward,
                .12f,
                armHalfLength,
                .12f,
                heading,
                rotationX = -armPitch,
                rotationZ = armAngle,
            )
        }
        actorDrawAlpha = previousActorAlpha
    }

    private fun drawFox() {
        val approach = actorApproach(SceneActor.FOX)
        val (x, z) = radial(288f, 6.15f - approach * .50f)
        val previousActorAlpha = actorDrawAlpha
        actorDrawAlpha = animalCameraVisibility(x, z, .70f)
        val heading = facingCenter(x, z)
        val watchProgress = lifeDirector.foxWatching
        val watchEnvelope = if (watchProgress >= 0f) {
            sin(watchProgress * PI.toFloat()).coerceAtLeast(0f)
        } else {
            0f
        }
        val cameraHeading = facingPoint(x, z, eyeX, eyeZ)
        val headHeading =
            heading + shortestAngleDegrees(heading, cameraHeading) * watchEnvelope
        val reactionProgress = actorReactionProgress(SceneActor.FOX)
        val greeting = greetingEnvelope(SceneActor.FOX)
        val wetShake = lifeDirector.wetShakeDegrees(SceneActor.FOX)
        val wetX = wetShake / 12f * .038f
        val encounterLean = if (reactionProgress >= 0f) {
            (1f - easeOutBack01(reactionProgress)) * 8f
        } else {
            0f
        }
        val headTilt = lifeDirector.foxHeadTiltDegrees +
            encounterLean +
            wetShake * .18f
        val storyHeadPitch = -latestStory.foxHeadPitch * 34f
        val eyeScaleY = .045f * (1f - lifeDirector.foxHalfBlink * .48f)
        val tailEncounterBoost = if (approach > .001f) 1.6f else 1f
        val tailSway =
            sin(frame.storyTime * .4f * PI.toFloat() * 2f) *
                14f * tailEncounterBoost +
                sin(frame.storyTime * 2.2f * PI.toFloat() * 2f) *
                greeting * 30f
        foxTailTipSwayDegrees +=
            (tailSway - foxTailTipSwayDegrees) *
            (1f - exp(-latestDeltaSeconds / .20f))
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
        val tipYaw = 180f + foxTailTipSwayDegrees
        val tipPitch = basePitch + 7f
        val tipYawRadians = Math.toRadians(tipYaw.toDouble())
        val tipPitchRadians = Math.toRadians(tipPitch.toDouble())
        val tipHalfLength = .22f
        val tipHorizontal = cos(tipPitchRadians).toFloat() * tipHalfLength
        val tipCenterX = tipRootX + sin(tipYawRadians).toFloat() * tipHorizontal
        val tipCenterY = tipRootY + sin(tipPitchRadians).toFloat() * tipHalfLength
        val tipCenterForward = tipRootForward + cos(tipYawRadians).toFloat() * tipHorizontal
        drawShadow(x, z, .56f, .38f)
        drawActorPart(requireNotNull(sphere), "#D9722F", x, z, wetX, .56f, -.06f, .42f, .56f, .39f, heading, rotationZ = wetShake * .14f)
        drawActorPart(requireNotNull(sphere), "#E07A34", x, z, wetX, 1.10f, .10f, .37f, .40f, .35f, headHeading, rotationX = storyHeadPitch, rotationZ = headTilt)
        drawActorPart(requireNotNull(cone), "#C95E28", x, z, -.23f + wetX, 1.50f, .05f, .17f, .33f, .16f, headHeading, rotationX = storyHeadPitch, rotationZ = -11f + headTilt)
        drawActorPart(requireNotNull(cone), "#C95E28", x, z, .23f + wetX, 1.50f, .05f, .17f, .33f, .16f, headHeading, rotationX = storyHeadPitch, rotationZ = 11f + headTilt)
        drawActorPart(requireNotNull(lowSphere), "#F5DFC5", x, z, wetX, .99f, .39f, .25f, .19f, .20f, headHeading, rotationX = storyHeadPitch, rotationZ = headTilt)
        drawActorPart(requireNotNull(lowSphere), "#22201E", x, z, -.12f + wetX, 1.17f, .34f, .038f, eyeScaleY, .023f, headHeading, rotationX = storyHeadPitch, rotationZ = headTilt)
        drawActorPart(requireNotNull(lowSphere), "#22201E", x, z, .12f + wetX, 1.17f, .34f, .038f, eyeScaleY, .023f, headHeading, rotationX = storyHeadPitch, rotationZ = headTilt)
        drawActorPart(requireNotNull(lowSphere), "#29211E", x, z, wetX, 1.02f, .58f, .060f, .045f, .040f, headHeading, rotationX = storyHeadPitch, rotationZ = headTilt)
        drawActorPart(
            requireNotNull(sphere),
            "#D9722F",
            x,
            z,
            baseCenterX + wetX,
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
            tipCenterX + wetX,
            tipCenterY,
            tipCenterForward,
            .18f,
            .19f,
            .27f,
            heading,
            rotationX = -tipPitch,
            yawOffset = tipYaw,
        )
        drawActorPart(requireNotNull(lowSphere), "#F5DFC5", x, z, wetX, .58f, .35f, .25f, .27f, .13f, heading)
        actorDrawAlpha = previousActorAlpha
    }

    private fun drawShadow(x: Float, z: Float, width: Float, depth: Float) {
        draw(
            requireNotNull(disc),
            color("#29462A", .24f * actorDrawAlpha),
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
            color(hex, actorDrawAlpha),
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

    private fun terrainHill(
        angleDegrees: Float,
        radius: Float,
        size: Float,
    ): TerrainHill {
        val (x, z) = radial(angleDegrees, radius)
        return TerrainHill(x, z, size)
    }

    private fun terrainPothole(
        angleDegrees: Float,
        radius: Float,
        majorRadius: Float,
        minorRadius: Float,
        rotationDegrees: Float,
    ): TerrainPothole {
        val (x, z) = radial(angleDegrees, radius)
        return TerrainPothole(
            x = x,
            z = z,
            majorRadius = majorRadius,
            minorRadius = minorRadius,
            rotationDegrees = rotationDegrees,
        )
    }

    private fun groundHeightAt(x: Float, z: Float): Float =
        TERRAIN_BASE_Y + terrainHeightAt(x, z, terrainHills, terrainPotholes)

    private fun currentKolobokPoint(): WorldPoint3 {
        val override = latestStory.positionOverride
        return if (override != null) {
            WorldPoint3(override.x, override.y, override.z)
        } else {
            WorldPoint3(
                sin(latestStory.kolobokAngleRadians) * SceneMotion.PATH_RADIUS,
                .52f,
                cos(latestStory.kolobokAngleRadians) * SceneMotion.PATH_RADIUS,
            )
        }
    }

    private fun storyFocusPoint(): WorldPoint3 {
        if (latestStory.chapter == SceneStoryChapter.BIRTH) {
            return WorldPoint3(0f, 1.2f, 4.2f)
        }
        val angleDegrees = when (latestStory.storyActor) {
            SceneActor.HARE -> 72f
            SceneActor.WOLF -> 144f
            SceneActor.BEAR -> 216f
            SceneActor.FOX -> 288f
            SceneActor.IZBA -> 0f
            SceneActor.KOLOBOK,
            null,
            -> return WorldPoint3(0f, 1.15f, 0f)
        }
        val (x, z) = radial(angleDegrees, 5.2f)
        return WorldPoint3(x, .95f, z)
    }

    private fun interpolate(
        from: WorldPoint3,
        to: WorldPoint3,
        progress: Float,
    ): WorldPoint3 = WorldPoint3(
        x = interpolate(from.x, to.x, progress),
        y = interpolate(from.y, to.y, progress),
        z = interpolate(from.z, to.z, progress),
    )

    private fun interpolate(
        from: Float,
        to: Float,
        progress: Float,
    ): Float = from + (to - from) * progress.coerceIn(0f, 1f)

    private fun pondLocalPoint(
        localX: Float,
        y: Float,
        localZ: Float,
    ): WorldPoint3 {
        val radians = Math.toRadians(POND_GROUP_HEADING.toDouble())
        return WorldPoint3(
            x = POND_X + localX * cos(radians).toFloat() + localZ * sin(radians).toFloat(),
            y = y,
            z = POND_Z - localX * sin(radians).toFloat() + localZ * cos(radians).toFloat(),
        )
    }

    private fun actorWorldPoint(
        centerX: Float,
        centerZ: Float,
        heading: Float,
        localX: Float,
        y: Float,
        forward: Float,
    ): WorldPoint3 {
        val radians = Math.toRadians(heading.toDouble())
        return WorldPoint3(
            x = centerX + localX * cos(radians).toFloat() + forward * sin(radians).toFloat(),
            y = y,
            z = centerZ - localX * sin(radians).toFloat() + forward * cos(radians).toFloat(),
        )
    }

    private fun smoothStep(value: Float): Float {
        val progress = value.coerceIn(0f, 1f)
        return progress * progress * (3f - 2f * progress)
    }

    private fun easeOutBack01(value: Float): Float {
        val progress = value.coerceIn(0f, 1f)
        val shifted = progress - 1f
        val overshoot = 1.70158f
        return 1f +
            (overshoot + 1f) * shifted * shifted * shifted +
            overshoot * shifted * shifted
    }

    private fun shortestAngleDegrees(from: Float, to: Float): Float {
        var delta = (to - from) % 360f
        if (delta > 180f) delta -= 360f
        if (delta < -180f) delta += 360f
        return delta
    }

    private fun facingCenter(x: Float, z: Float): Float =
        Math.toDegrees(kotlin.math.atan2(-x, -z).toDouble()).toFloat()

    private fun facingPoint(
        fromX: Float,
        fromZ: Float,
        toX: Float,
        toZ: Float,
    ): Float = Math.toDegrees(
        kotlin.math.atan2((toX - fromX).toDouble(), (toZ - fromZ).toDouble()),
    ).toFloat()

    private fun updateCrossroadsPlaqueHeading(deltaSeconds: Float) {
        val worldHeading = Math.toDegrees(
            kotlin.math.atan2(eyeX.toDouble(), eyeZ.toDouble()),
        ).toFloat()
        val desired = worldHeading - frame.sceneRotation
        if (!plaqueHeadingInitialized) {
            renderedPlaqueHeading = desired
            plaqueHeadingInitialized = true
            plaqueTurnActivity = 0f
            return
        }
        val remaining = shortestAngleDegrees(renderedPlaqueHeading, desired)
        val safeDelta = deltaSeconds.coerceIn(0f, .25f)
        renderedPlaqueHeading += remaining * (1f - exp(-safeDelta * 6.4f))
        val targetActivity = (abs(remaining) / 11f).coerceIn(0f, 1f)
        plaqueTurnActivity +=
            (targetActivity - plaqueTurnActivity) * (1f - exp(-safeDelta * 8f))
    }

    private fun crossroadsPlaqueHeading(): Float = renderedPlaqueHeading

    private fun crossroadsPlaquePoint(spec: CrossroadsPlaqueSpec): WorldPoint3 {
        val heading = crossroadsPlaqueHeading() + spec.azimuth
        val radians = Math.toRadians(heading.toDouble())
        val forward = (spec.outerRadius + .035f) * CROSSROADS_SCALE
        return WorldPoint3(
            x = forward * sin(radians).toFloat(),
            y = spec.y * CROSSROADS_SCALE,
            z = forward * cos(radians).toFloat(),
        )
    }

    private fun crossroadsPlaqueLabelTransform(
        spec: CrossroadsPlaqueSpec,
        pressDepth: Float = 0f,
    ): Transform {
        val heading = crossroadsPlaqueHeading() + spec.azimuth
        val radians = Math.toRadians(heading.toDouble())
        return Transform(
            x = -sin(radians).toFloat() * pressDepth,
            y = spec.y * CROSSROADS_SCALE,
            z = -cos(radians).toFloat() * pressDepth,
            scaleX = 1f,
            scaleY = spec.labelScaleY * .95f,
            scaleZ = 1f,
            rotationY = heading,
            rotationZ = spec.tilt,
        )
    }

    private fun crossroadsPlaquePressDepth(index: Int): Float {
        val elapsed = eventSeconds(plaquePressedAtMs.getOrElse(index) { 0L })
        if (elapsed !in 0f..CROSSROADS_PRESS_SECONDS) return 0f
        return when {
            elapsed < .085f -> smoothStep(elapsed / .085f) * .055f
            else -> (1f - smoothStep((elapsed - .085f) / .125f)) * .055f
        }
    }

    private fun crossroadsPlaquePressPulse(index: Int): Float {
        val elapsed = eventSeconds(plaquePressedAtMs.getOrElse(index) { 0L })
        return if (elapsed in 0f..CROSSROADS_PRESS_SECONDS) {
            sin(elapsed / CROSSROADS_PRESS_SECONDS * PI.toFloat()).coerceAtLeast(0f)
        } else {
            0f
        }
    }

    fun beginTreeBonkAt(
        touchX: Float,
        touchY: Float,
        viewWidth: Int,
        viewHeight: Int,
    ): SceneTapResult? {
        val mappedX = touchX * viewportWidth / max(1, viewWidth).toFloat()
        val mappedY = touchY * viewportHeight / max(1, viewHeight).toFloat()
        val treeTarget = findTreeAt(mappedX, mappedY) ?: return null
        val foregroundTarget = findTapTargetAt(
            mappedX = mappedX,
            mappedY = mappedY,
            includeTrees = false,
        )
        // Tree holds begin on ACTION_DOWN, before a normal tap can run.
        // Apply the same visual-depth rule here so a generous canopy hitbox
        // cannot steal Grandpa, an animal, Kolobok, or another visible prop
        // that is actually in front of it.
        if (
            !SceneTapArbitration.treeOwnsPress(
                treeDepth = treeTarget.depth,
                treeNormalizedDistance = treeTarget.normalizedDistance,
                foregroundDepth = foregroundTarget?.depth,
                foregroundNormalizedDistance =
                    foregroundTarget?.normalizedDistance,
            )
        ) {
            return null
        }
        val treeIndex = treeTarget.payload
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
        pressedTreeTapPending = true
        return triggerTreePress(treeIndex, SystemClock.uptimeMillis())
    }

    fun releaseTreeBonk() {
        if (grabbedTreeIndex !in treeBonkStates.indices) return
        TreeBonkPhysics.release(treeBonkStates[grabbedTreeIndex])
        grabbedTreeIndex = -1
    }

    fun cancelPressedTreeTap() {
        pressedTreeTapPending = false
    }

    private fun triggerTreePress(
        treeIndex: Int,
        now: Long,
    ): SceneTapResult {
        var interaction = SceneInteraction.TREE_RUSTLE
        if (treeIndex < sprucePoints.size) {
            if (
                owlTapTreeIndex != treeIndex ||
                now - owlLastTapMs > 1_200L
            ) {
                owlTapTreeIndex = treeIndex
                owlTapCount = 0
            }
            owlLastTapMs = now
            owlTapCount += 1
            if (owlTapCount >= 3) {
                owlTapCount = 0
                if (
                    eggRegistry.tryTrigger(
                        SceneEgg.OWL,
                        now,
                        instance = treeIndex,
                        suppressed = encounterDirector.isRunning(),
                    )
                ) {
                    owlActiveTreeIndex = treeIndex
                    owlStartedMs = now
                    owlFlapStartedMs = 0L
                    interaction = SceneInteraction.OWL_WAKE
                }
            }
        } else {
            val birchIndex = treeIndex - sprucePoints.size
            val point = birchPoints.getOrNull(birchIndex)
            if (point != null) {
                val (x, z) = radial(point.angle, point.radius)
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
        return SceneTapResult(
            interaction = interaction,
            haptic = SceneHaptic.LIGHT,
        )
    }

    private fun findTreeAt(mappedX: Float, mappedY: Float): TapTarget? {
        val candidates = mutableListOf<TapTarget>()
        (sprucePoints + birchPoints).forEachIndexed { index, point ->
            val (x, z) = radial(point.angle, point.radius)
            // A tree deliberately faded out of the follow sightline should
            // not retain an invisible hitbox over Kolobok.
            if (treeCameraVisibility(x, z) < .80f) return@forEachIndexed
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
            compareBy<TapTarget> { it.depth }
                .thenBy { it.normalizedDistance },
        )
    }

    private fun findTapTargetAt(
        mappedX: Float,
        mappedY: Float,
        includeTrees: Boolean,
    ): TapTarget? {
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
            val normalizedDistance =
                sqrt(dx * dx + dy * dy) / radius.coerceAtLeast(1f)
            if (normalizedDistance <= 1f) {
                targets += TapTarget(id, payload, normalizedDistance, point.depth)
            }
        }

        val grandpa = pondLocalPoint(
            POND_GRANDPA_LOCAL_X,
            .90f,
            POND_GRANDPA_LOCAL_Z,
        )
        val willow = pondLocalPoint(.50f, 1.42f, 1.90f)
        val pond = pondLocalPoint(0f, .30f, 0f)
        addTarget("grandpa", grandpa.x, grandpa.y, grandpa.z, .115f)
        addTarget("chimney", .66f, 2.65f, 6.50f, .075f)
        addTarget("izba", -.48f, .92f, 5.28f, .120f)
        addTarget("izba", 0f, 2.08f, 5.30f, .105f)
        addTarget("willow", willow.x, willow.y, willow.z, .115f)
        addTarget("pond", pond.x, pond.y, pond.z, .105f)
        val addPlaque = crossroadsPlaquePoint(crossroadsPlaqueSpecs[0])
        val createPlaque = crossroadsPlaquePoint(crossroadsPlaqueSpecs[1])
        val libraryPlaque = crossroadsPlaquePoint(crossroadsPlaqueSpecs[2])
        addTarget("menu_add", addPlaque.x, addPlaque.y, addPlaque.z, .072f)
        addTarget(
            "menu_create",
            createPlaque.x,
            createPlaque.y,
            createPlaque.z,
            .075f,
        )
        addTarget(
            "menu_library",
            libraryPlaque.x,
            libraryPlaque.y,
            libraryPlaque.z,
            .070f,
        )
        repeat(STONE_BIRD_COUNT) { index ->
            if (!stoneBirdFlightActive(index, eventSeconds(stoneBirdStartedAtMs[index]))) {
                val angle = pseudo(index * 47 + 3) * 360f
                val radius = 1.00f + pseudo(index * 59 + 8) * .40f
                val (birdX, birdZ) = radial(angle, radius)
                val birdY = .20f + pseudo(index * 71 + 4) * .13f
                addTarget(
                    id = "stone_bird",
                    x = birdX,
                    y = birdY,
                    z = birdZ,
                    radiusFraction = .060f,
                    payload = index,
                )
            }
        }

        listOf(
            Triple("hare", 72f, AnimalReaction.HARE),
            Triple("wolf", 144f, AnimalReaction.WOLF),
            Triple("bear", 216f, AnimalReaction.BEAR),
            Triple("fox", 288f, AnimalReaction.FOX),
        ).forEach { (id, angle, reaction) ->
            val actor = when (reaction) {
                AnimalReaction.HARE -> SceneActor.HARE
                AnimalReaction.WOLF -> SceneActor.WOLF
                AnimalReaction.BEAR -> SceneActor.BEAR
                AnimalReaction.FOX -> SceneActor.FOX
                AnimalReaction.NONE -> return@forEach
            }
            val blockerRadius = when (actor) {
                SceneActor.HARE -> .62f
                SceneActor.WOLF -> .72f
                SceneActor.BEAR -> .92f
                SceneActor.FOX -> .70f
                else -> .70f
            }
            val approachScale = if (actor == SceneActor.FOX) .50f else .60f
            val (x, z) = radial(
                angle,
                6.15f - actorApproach(actor) * approachScale,
            )
            if (animalCameraVisibility(x, z, blockerRadius) < .80f) {
                return@forEach
            }
            addTarget(id, x, 1.0f, z, .105f, payload = reaction.ordinal)
        }

        val kolobok = currentKolobokPoint()
        if (latestStory.kolobokScale > .08f) {
            addTarget("kolobok", kolobok.x, kolobok.y, kolobok.z, .105f)
        }

        mushroomSpots.forEachIndexed { index, point ->
            if (
                mushroomReserved[index] ||
                mushroomScale(index, SystemClock.uptimeMillis()) <= .50f
            ) {
                return@forEachIndexed
            }
            val (x, z) = radial(point.angle, point.radius)
            addTarget(
                "mushroom",
                x,
                groundHeightAt(x, z) + .27f,
                z,
                .065f,
                payload = index,
            )
        }

        if (owlStartedMs > 0L) {
            val activeTree =
                sprucePoints.getOrElse(owlActiveTreeIndex) { owlTree }
            val (owlX, owlZ) = radial(activeTree.angle, activeTree.radius)
            addTarget("owl", owlX, 2.58f, owlZ, .105f)
        }

        if (includeTrees) {
            (sprucePoints + birchPoints)
                .forEachIndexed { index, point ->
                    val (x, z) = radial(point.angle, point.radius)
                    if (treeCameraVisibility(x, z) < .80f) {
                        return@forEachIndexed
                    }
                    addTarget("tree", x, .72f, z, .10f, payload = index)
                    addTarget("tree", x, 1.48f, z, .13f, payload = index)
                    addTarget("tree", x, 2.18f, z, .11f, payload = index)
                }
        }

        val (butterflyX, butterflyZ) = radial(71f, 5.82f)
        addTarget("butterflies", butterflyX, .72f, butterflyZ, .095f)
        val (hiveX, hiveZ) = radial(205f, 5.55f)
        addTarget("hive", hiveX, .42f, hiveZ, .082f)
        if (sunMechanicallyVisible()) {
            addTarget(
                id = "sun",
                x = sunPosition.x,
                y = sunPosition.y,
                z = sunPosition.z,
                radiusFraction = .105f,
                rotatesWithScene = false,
            )
        }

        if (eyeY < 6.35f) {
            repeat(SCENE_CLOUD_COUNT) { index ->
                val cloud = cloudPosition(index)
                if (cloudCameraVisibility(cloud) < .65f) return@repeat
                addTarget(
                    id = "cloud",
                    x = cloud.x,
                    y = cloud.y,
                    z = cloud.z,
                    radiusFraction = .090f,
                    payload = index,
                    rotatesWithScene = false,
                )
            }
        }

        if (moonMechanicallyVisible()) {
            addTarget(
                id = "moon",
                x = moonPosition.x,
                y = moonPosition.y,
                z = moonPosition.z,
                radiusFraction = .10f,
                rotatesWithScene = false,
            )
        }

        // A padded hit area is useful only when it does not pass through a
        // visibly nearer object.
        val depthWinner = targets.minWithOrNull(
            compareBy<TapTarget> { it.depth }
                .thenBy { it.normalizedDistance },
        )
        if (depthWinner?.id != "tree") return depthWinner
        val foregroundWinner = targets
            .asSequence()
            .filter { it.id != "tree" }
            .minWithOrNull(
                compareBy<TapTarget> { it.depth }
                    .thenBy { it.normalizedDistance },
            )
        return if (
            SceneTapArbitration.treeOwnsPress(
                treeDepth = depthWinner.depth,
                treeNormalizedDistance = depthWinner.normalizedDistance,
                foregroundDepth = foregroundWinner?.depth,
                foregroundNormalizedDistance =
                    foregroundWinner?.normalizedDistance,
            )
        ) {
            depthWinner
        } else {
            foregroundWinner
        }
    }

    fun tapAt(
        tapX: Float,
        tapY: Float,
        viewWidth: Int,
        viewHeight: Int,
    ): SceneTapResult? {
        if (pressedTreeTapPending) {
            pressedTreeTapPending = false
            return null
        }
        val mappedX = tapX * viewportWidth / max(1, viewWidth).toFloat()
        val mappedY = tapY * viewportHeight / max(1, viewHeight).toFloat()
        val target = findTapTargetAt(
            mappedX = mappedX,
            mappedY = mappedY,
            includeTrees = true,
        )
        val now = SystemClock.uptimeMillis()
        var interaction: SceneInteraction? = null
        val dialogueSuppressed = latestStory.mode == SceneStoryMode.PLAYING ||
            latestStory.mode == SceneStoryMode.REBIRTH ||
            latestStory.mode == SceneStoryMode.STOPPED
        when (target?.id) {
            "menu_add" -> {
                if (now < crossroadsNavigationPendingUntilMs) return null
                crossroadsNavigationPendingUntilMs =
                    now + CROSSROADS_NAVIGATION_LOCK_MS
                plaquePressedAtMs[0] = now
                storyDirector.stopForNavigation()
                return SceneTapResult(
                    crossroadsAction = CrossroadsAction.ADD_BOOK,
                    haptic = SceneHaptic.MEDIUM,
                )
            }
            "menu_create" -> {
                if (now < crossroadsNavigationPendingUntilMs) return null
                crossroadsNavigationPendingUntilMs =
                    now + CROSSROADS_NAVIGATION_LOCK_MS
                plaquePressedAtMs[1] = now
                storyDirector.stopForNavigation()
                return SceneTapResult(
                    crossroadsAction = CrossroadsAction.CREATE_STORY,
                    haptic = SceneHaptic.MEDIUM,
                )
            }
            "menu_library" -> {
                if (now < crossroadsNavigationPendingUntilMs) return null
                crossroadsNavigationPendingUntilMs =
                    now + CROSSROADS_NAVIGATION_LOCK_MS
                plaquePressedAtMs[2] = now
                storyDirector.stopForNavigation()
                return SceneTapResult(
                    crossroadsAction = CrossroadsAction.LIBRARY,
                    haptic = SceneHaptic.MEDIUM,
                )
            }

            "grandpa" -> {
                val nextFishingKind = when (Random.nextFloat()) {
                    in 0f..<.05f -> FishingKind.GOLD
                    in .05f..<.30f -> FishingKind.BOOT
                    else -> FishingKind.SILVER
                }
                if (
                    eggRegistry.tryTrigger(
                        SceneEgg.GRANDPA_FISHING,
                        now,
                        suppressed = encounterDirector.isRunning(),
                        activeForMs = if (nextFishingKind == FishingKind.GOLD) {
                            5_400L
                        } else {
                            2_700L
                        },
                    )
                ) {
                    fishingKind = nextFishingKind
                    if (fishingKind == FishingKind.BOOT) {
                        accumulatedBoots = (accumulatedBoots + 1).coerceAtMost(3)
                    }
                    fishingStartedMs = now
                    interaction = SceneInteraction.GRANDPA_FISHING
                }
            }

            "chimney" -> {
                if (
                    eggRegistry.tryTrigger(
                        SceneEgg.SMOKE_RINGS,
                        now,
                        suppressed = encounterDirector.isRunning(),
                    )
                ) {
                    smokeRingsStartedMs = now
                    interaction = SceneInteraction.CHIMNEY_SMOKE
                }
            }
            "izba" -> {
                if (startInteractiveEncounter(SceneActor.IZBA, dialogueSuppressed)) {
                    izbaFlashStartedMs = now
                    smokeRingsStartedMs = now
                    interaction = SceneInteraction.IZBA_WINDOW
                }
            }

            "willow" -> {
                if (eventSeconds(willowSwayStartedMs) !in 0f..2.8f) {
                    willowSwayStartedMs = now
                }
                if (willowTapSequence.record(now)) {
                    if (
                        eggRegistry.tryTrigger(
                            SceneEgg.MAGPIES,
                            now,
                            suppressed = false,
                        ) &&
                        eventSeconds(magpiesStartedMs) !in
                        0f..(MAGPIE_LAUNCH_SECONDS + MAGPIE_AWAY_SECONDS + MAGPIE_RETURN_SECONDS)
                    ) {
                        magpiesStartedMs = now
                        magpieFlightSeed = now.toInt() xor 0x4D41_4750
                        interaction = SceneInteraction.MAGPIES
                    } else {
                        interaction = SceneInteraction.WILLOW_RUSTLE
                    }
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
            "stone_bird" -> {
                val birdIndex = target.payload
                if (
                    birdIndex in stoneBirdStartedAtMs.indices &&
                    !stoneBirdFlightActive(
                        birdIndex,
                        eventSeconds(stoneBirdStartedAtMs[birdIndex]),
                    )
                ) {
                    stoneBirdStartedAtMs[birdIndex] = now
                    val rotation = Math.toRadians(frame.sceneRotation.toDouble())
                    val rotationCosine = cos(rotation).toFloat()
                    val rotationSine = sin(rotation).toFloat()
                    stoneBirdCameraX[birdIndex] =
                        rotationCosine * eyeX - rotationSine * eyeZ
                    stoneBirdCameraZ[birdIndex] =
                        rotationSine * eyeX + rotationCosine * eyeZ
                    interaction = SceneInteraction.STONE_BIRDS
                }
            }
            "cloud" -> {
                if (
                    target.payload in drizzleStartedAtMs.indices &&
                    eventSeconds(drizzleStartedAtMs[target.payload]) !in
                    0f..CLOUD_RAIN_SECONDS &&
                    eggRegistry.tryTrigger(
                        SceneEgg.CLOUD_DRIZZLE,
                        now,
                        instance = target.payload,
                    )
                ) {
                    drizzleStartedAtMs[target.payload] = now
                    interaction = SceneInteraction.CLOUD_RAIN
                }
            }
            "moon" -> {
                if (
                    eggRegistry.tryTrigger(
                        SceneEgg.MOON_WINK,
                        now,
                        suppressed = encounterDirector.isRunning(),
                    )
                ) {
                    moonWinkStartedMs = now
                    interaction = SceneInteraction.MOON_WINK
                }
            }

            "mushroom" -> {
                val mushroomIndex = target.payload.coerceIn(mushroomSpots.indices)
                if (startHedgehogJourney(mushroomIndex, now)) {
                    interaction = SceneInteraction.HEDGEHOG
                }
            }

            "owl" -> {
                val owlElapsed = eventSeconds(owlStartedMs)
                if (
                    owlFlapStartedMs == 0L &&
                    owlElapsed in OWL_POP_SECONDS..(OWL_POP_SECONDS + OWL_LOOK_SECONDS)
                ) {
                    owlFlapStartedMs = now
                    interaction = SceneInteraction.OWL_FLAP
                }
            }

            "tree" -> {
                val point = (sprucePoints + birchPoints).getOrNull(target.payload)
                if (point == null) {
                    return null
                } else {
                    val (x, z) = radial(point.angle, point.radius)
                    val state = treeBonkStates[target.payload]
                    if (!state.held && state.elapsedSeconds < 0f) {
                        TreeBonkPhysics.kick(state, x, z)
                    }
                    return triggerTreePress(target.payload, now)
                }
            }

            "butterflies" -> {
                val (butterflyX, butterflyZ) = radial(71f, 5.82f)
                startAmbientReaction(
                    AmbientReaction.BUTTERFLIES,
                    WorldPoint3(butterflyX, .38f, butterflyZ),
                    now,
                )
                interaction = SceneInteraction.BUTTERFLY_DANCE
            }

            "hive" -> {
                val (hiveX, hiveZ) = radial(205f, 5.55f)
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
                val selectedReaction = AnimalReaction.entries[target.payload]
                val actor = when (selectedReaction) {
                    AnimalReaction.HARE -> SceneActor.HARE
                    AnimalReaction.WOLF -> SceneActor.WOLF
                    AnimalReaction.BEAR -> SceneActor.BEAR
                    AnimalReaction.FOX -> SceneActor.FOX
                    AnimalReaction.NONE -> null
                }
                val storyAlreadyOwnsActor =
                    (latestStory.mode == SceneStoryMode.PLAYING ||
                        latestStory.mode == SceneStoryMode.REBIRTH) &&
                        latestStory.storyActor == actor
                if (storyAlreadyOwnsActor) {
                    // Do not overwrite a story-owned beat, but still
                    // acknowledge that the visible character was tapped.
                    // The non-null empty result produces the light haptic
                    // without starting a second timeline or leaking copy.
                    return SceneTapResult()
                }
                if (selectedReaction == AnimalReaction.FOX) {
                    if (now - foxLastTapMs > 6_000L) foxTapCount = 0
                    foxLastTapMs = now
                    foxTapCount += 1
                    if (foxTapCount >= 5) {
                        foxTapCount = 0
                        // The hidden ending replaces the ordinary fifth
                        // fox beat. Starting both timelines used to leave
                        // the fox gliding/sitting while the catch sequence
                        // teleported Kolobok, producing contradictory poses.
                        encounterDirector.cancel()
                        latestStory = storyDirector.startStandaloneFoxEnding()
                        foxEndingCameraStartYaw = renderedCameraYaw
                        foxEndingCameraStartPitch = renderedCameraPitch
                        foxEndingCameraStartDistance = renderedCameraDistance
                        foxEndingCameraStartTarget = WorldPoint3(
                            cameraTargetX,
                            cameraTargetY,
                            cameraTargetZ,
                        )
                        foxEndingRebirthTriggered = false
                        foxEndingStartedMs = now
                        interaction = SceneInteraction.FOX_TRUE_ENDING
                    } else {
                        val started = actor?.let {
                            startInteractiveEncounter(
                                actor = it,
                                dialogueSuppressed = dialogueSuppressed,
                                greetingOnly = latestStory.mode == SceneStoryMode.STOPPED,
                            )
                        } == true
                        if (started) interaction = SceneInteraction.FOX
                    }
                } else {
                    val started = actor?.let {
                        startInteractiveEncounter(
                            actor = it,
                            dialogueSuppressed = dialogueSuppressed,
                            greetingOnly = latestStory.mode == SceneStoryMode.STOPPED,
                        )
                    } == true
                    if (started) {
                        interaction = when (selectedReaction) {
                            AnimalReaction.HARE -> SceneInteraction.HARE
                            AnimalReaction.WOLF -> SceneInteraction.WOLF
                            AnimalReaction.BEAR -> SceneInteraction.BEAR
                            AnimalReaction.FOX -> SceneInteraction.FOX
                            AnimalReaction.NONE -> null
                        }
                    }
                }
            }

            "kolobok" -> {
                if (startInteractiveEncounter(SceneActor.KOLOBOK, dialogueSuppressed)) {
                    greet()
                    interaction = SceneInteraction.KOLOBOK
                }
            }
            null -> Unit
        }
        return interaction?.let {
            SceneTapResult(
                interaction = it,
                variant = if (it == SceneInteraction.GRANDPA_FISHING) {
                    when (fishingKind) {
                        FishingKind.SILVER -> SceneInteractionVariant.FISH_SILVER
                        FishingKind.BOOT -> SceneInteractionVariant.FISH_BOOT
                        FishingKind.GOLD -> SceneInteractionVariant.FISH_GOLD
                    }
                } else {
                    null
                },
                haptic = when (it) {
                    SceneInteraction.IZBA_WINDOW,
                    SceneInteraction.HARE,
                    SceneInteraction.WOLF,
                    SceneInteraction.BEAR,
                    SceneInteraction.FOX,
                    -> SceneHaptic.MEDIUM

                    SceneInteraction.FOX_TRUE_ENDING -> SceneHaptic.NONE
                    else -> SceneHaptic.LIGHT
                },
            )
        }
    }

    private fun startInteractiveEncounter(
        actor: SceneActor,
        dialogueSuppressed: Boolean,
        greetingOnly: Boolean = false,
    ): Boolean {
        val started = encounterDirector.start(
            actor = actor,
            dialogueSuppressed = dialogueSuppressed,
            greetingOnly = greetingOnly,
        )
        if (started) storyDirector.noteUserInput()
        return started
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

    private fun treeCameraVisibility(
        treeX: Float,
        treeZ: Float,
    ): Float {
        if (!followCameraActive) return 1f
        val hero = currentKolobokPoint()
        return SceneCameraOcclusion.treeAlpha(
            heroX = hero.x,
            heroZ = hero.z,
            cameraX = sceneSpaceEyeX,
            cameraZ = sceneSpaceEyeZ,
            treeX = treeX,
            treeZ = treeZ,
            treeRadius = .72f,
        )
    }

    private fun animalCameraVisibility(
        actorX: Float,
        actorZ: Float,
        actorRadius: Float,
    ): Float {
        if (!followCameraActive) return 1f
        val hero = currentKolobokPoint()
        return SceneCameraOcclusion.sightlineAlpha(
            heroX = hero.x,
            heroZ = hero.z,
            cameraX = sceneSpaceEyeX,
            cameraZ = sceneSpaceEyeZ,
            blockerX = actorX,
            blockerZ = actorZ,
            blockerRadius = actorRadius,
            minimumAlpha = .08f,
            shoulderWidth = .65f,
        )
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

    private fun updateBubbleAnchor() {
        val speaker = if (latestStory.narration != null) {
            latestStory.speaker
        } else if (latestEncounter.narration != null) {
            latestEncounter.speaker
        } else {
            null
        }
        if (speaker == null) {
            latestBubbleAnchor = null
            return
        }
        val anchor = when (speaker) {
            SceneSpeaker.KOLOBOK -> currentKolobokPoint().let {
                WorldPoint3(it.x, it.y + .90f, it.z)
            }
            SceneSpeaker.GRANDMA -> WorldPoint3(-.48f, 1.46f, 5.28f)
            SceneSpeaker.HARE -> radial(72f, 6.15f - actorApproach(SceneActor.HARE) * .60f)
                .let { WorldPoint3(it.first, 1.72f, it.second) }
            SceneSpeaker.WOLF -> radial(144f, 6.15f - actorApproach(SceneActor.WOLF) * .60f)
                .let { WorldPoint3(it.first, 1.70f, it.second) }
            SceneSpeaker.BEAR -> radial(216f, 6.15f - actorApproach(SceneActor.BEAR) * .60f)
                .let { WorldPoint3(it.first, 1.92f, it.second) }
            SceneSpeaker.FOX -> radial(288f, 6.15f - actorApproach(SceneActor.FOX) * .50f)
                .let { WorldPoint3(it.first, 1.74f, it.second) }
            SceneSpeaker.NARRATOR -> if (latestStory.kolobokScale > .08f) {
                currentKolobokPoint().let { WorldPoint3(it.x, it.y + .90f, it.z) }
            } else {
                WorldPoint3(-.48f, 1.46f, 5.28f)
            }
        }
        val projected = projectPoint(anchor.x, anchor.y, anchor.z, rotatesWithScene = true)
        latestBubbleAnchor = projected?.let {
            SceneBubbleAnchor(
                xFraction = (it.x / viewportWidth.coerceAtLeast(1)).coerceIn(0f, 1f),
                yFraction = (it.y / viewportHeight.coerceAtLeast(1)).coerceIn(0f, 1f),
            )
        }
    }

    private fun cloudPosition(index: Int): WorldPoint3 {
        val quadrantStart = index * PI.toFloat() * .5f
        val orbit =
            quadrantStart +
                Math.toRadians((10f + pseudo(index * 73 + 17) * 70f).toDouble())
                    .toFloat() +
                frame.storyTime * .006f
        val radiusProgress = pseudo(index * 79 + 23)
        val radius = PATH_RADIUS * (.85f + radiusProgress * .30f)
        val windTravel =
            sin(frame.storyTime * .035f + index * .7f) *
                latestAtmosphere.windStrength * .75f
        return WorldPoint3(
            x = sin(orbit) * radius + latestAtmosphere.windDirectionX * windTravel,
            y = 4.59f + radiusProgress * 1.53f +
                sin(frame.storyTime + index * 1.73f) * .15f,
            z = cos(orbit) * radius + latestAtmosphere.windDirectionZ * windTravel,
        )
    }

    private fun cloudCameraVisibility(cloud: WorldPoint3): Float {
        val dx = cloud.x - eyeX
        val dy = cloud.y - eyeY
        val dz = cloud.z - eyeZ
        val distance = sqrt(dx * dx + dy * dy + dz * dz)
        val distanceAlpha = SceneCameraOcclusion.cloudAlpha(distance)
        if (distanceAlpha <= .015f) return 0f
        val projected = projectPoint(
            cloud.x,
            cloud.y,
            cloud.z,
            rotatesWithScene = false,
        ) ?: return distanceAlpha
        val headerAlpha = SceneCameraOcclusion.headerSafeAlpha(
            normalizedX = projected.x / viewportWidth.coerceAtLeast(1).toFloat(),
            normalizedY = projected.y / viewportHeight.coerceAtLeast(1).toFloat(),
        )
        return distanceAlpha * headerAlpha
    }

    private fun eventSeconds(startedAtMs: Long): Float {
        if (startedAtMs <= 0L) return -1f
        return (SystemClock.uptimeMillis() - startedAtMs).coerceAtLeast(0L) / 1_000f
    }

    private fun reactionEnvelope(target: AnimalReaction): Float {
        val actor = when (target) {
            AnimalReaction.HARE -> SceneActor.HARE
            AnimalReaction.WOLF -> SceneActor.WOLF
            AnimalReaction.BEAR -> SceneActor.BEAR
            AnimalReaction.FOX -> SceneActor.FOX
            AnimalReaction.NONE -> null
        }
        val legacyReaction = if (animalReaction == target) {
            val elapsed = eventSeconds(animalReactionStartedMs)
            if (elapsed > 1.35f) {
                animalReaction = AnimalReaction.NONE
                animalReactionStartedMs = 0L
                0f
            } else {
                sin((elapsed / 1.35f).coerceIn(0f, 1f) * PI.toFloat())
            }
        } else {
            0f
        }
        if (actor == null) return legacyReaction
        val storyReaction = if (latestStory.storyActor == actor) {
            latestStory.storyActorReaction
        } else {
            0f
        }
        val encounterReaction = if (latestEncounter.actor == actor) {
            latestEncounter.reaction
        } else {
            0f
        }
        return max(legacyReaction, max(storyReaction, encounterReaction))
    }

    private fun actorApproach(actor: SceneActor): Float {
        val storyApproach = if (latestStory.storyActor == actor) {
            latestStory.storyActorApproach
        } else {
            0f
        }
        val encounterApproach = if (latestEncounter.actor == actor) {
            latestEncounter.approach
        } else {
            0f
        }
        return max(storyApproach, encounterApproach).coerceIn(0f, 1f)
    }

    private fun actorReactionProgress(actor: SceneActor): Float {
        if (
            latestEncounter.actor == actor &&
            latestEncounter.reactionProgress >= 0f
        ) {
            return latestEncounter.reactionProgress
        }
        if (latestStory.storyActor != actor) return -1f
        val seconds = latestStory.chapterSeconds
        return when (actor) {
            SceneActor.HARE,
            SceneActor.WOLF,
            SceneActor.BEAR,
            -> if (seconds in 2.6f..<3f) {
                ((seconds - 2.6f) / .4f).coerceIn(0f, 1f)
            } else {
                -1f
            }

            SceneActor.FOX -> if (seconds in 5.8f..<6.7f) {
                ((seconds - 5.8f) / .9f).coerceIn(0f, 1f)
            } else {
                -1f
            }

            SceneActor.IZBA,
            SceneActor.KOLOBOK,
            -> -1f
        }
    }

    private fun greetingEnvelope(actor: SceneActor): Float {
        val elapsed = greetingElapsedSeconds[actor.ordinal]
        return if (elapsed in 0f..GREETING_WAVE_SECONDS) {
            sin((elapsed / GREETING_WAVE_SECONDS) * PI.toFloat())
                .coerceIn(0f, 1f)
        } else {
            0f
        }
    }

    private fun updateGreetingWaves(deltaSeconds: Float) {
        greetingElapsedSeconds.indices.forEach { index ->
            val elapsed = greetingElapsedSeconds[index]
            if (elapsed >= 0f) {
                val next = elapsed + deltaSeconds.coerceIn(0f, .25f)
                greetingElapsedSeconds[index] =
                    if (next > GREETING_WAVE_SECONDS) -1f else next
            }
        }

        val storyActor = latestStory.storyActor
            ?.takeIf { latestStory.mode == SceneStoryMode.PLAYING && it.isAnimal() }
        if (storyActor != null && storyActor != previousGreetingStoryActor) {
            greetingElapsedSeconds[storyActor.ordinal] = 0f
        }
        previousGreetingStoryActor = storyActor

        val encounterActor = latestEncounter.actor?.takeIf(SceneActor::isAnimal)
        if (encounterActor != null && encounterActor != previousGreetingEncounterActor) {
            greetingElapsedSeconds[encounterActor.ordinal] = 0f
        }
        previousGreetingEncounterActor = encounterActor
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
            val wingAngle = side * flap
            val wingRadians = Math.toRadians(wingAngle.toDouble())
            val wingRoot = (wingOffset - wingWidth).coerceAtLeast(.010f)
            val wingCenterX =
                side * wingRoot * birdScale +
                    side * cos(wingRadians).toFloat() * wingWidth * birdScale
            val wingCenterYOffset =
                side * sin(wingRadians).toFloat() * wingWidth * birdScale
            val wingCenter = pitched(wingCenterYOffset, 0f)
            drawActorPart(
                requireNotNull(cube),
                bodyColor,
                x,
                z,
                wingCenterX,
                y + wingCenter.first,
                wingCenter.second,
                wingWidth * birdScale,
                .014f * birdScale,
                wingDepth * birdScale,
                heading,
                rotationZ = wingAngle,
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
        val rainAmount = latestAtmosphere.rainAmount
        if (rainAmount > .01f) {
            rainTransforms.clear()
            val count = (rain.size * rainAmount).roundToInt().coerceIn(0, rain.size)
            repeat(count) { index ->
                val particle = rain[index]
                val fall = (frame.storyTime * 9f + particle.phase) % 8f
                val wind = latestAtmosphere.windStrength
                rainTransforms += Transform(
                    x = particle.x + latestAtmosphere.windDirectionX * fall * .075f * wind,
                    y = 8.2f - fall,
                    z = particle.z + latestAtmosphere.windDirectionZ * fall * .075f * wind,
                    scaleX = .014f,
                    scaleY = .18f,
                    scaleZ = .014f,
                    rotationZ = -10f - wind * 6f,
                )
            }
            drawInstanced(
                mesh = requireNotNull(cylinder),
                color = color("#AEBFD0", .58f),
                transforms = rainTransforms,
                rimStrength = 0f,
                rotateWithScene = false,
            )
        }

        val snowAmount = latestAtmosphere.snowAmount
        if (snowAmount > .01f) {
            snowTransforms.clear()
            val count = (snow.size * snowAmount).roundToInt().coerceIn(0, snow.size)
            repeat(count) { index ->
                val particle = snow[index]
                val fall = (frame.storyTime * 1.1f + particle.phase) % 7f
                val drift =
                    sin(frame.storyTime * 1.3f + index) * .30f +
                        latestAtmosphere.windDirectionX * latestAtmosphere.windStrength * .18f
                val pulse = 1f + sin(frame.storyTime * .8f + particle.phase) * .15f
                snowTransforms += Transform(
                    x = particle.x + drift,
                    y = 8.1f - fall,
                    z = particle.z +
                        cos(frame.storyTime * 1.1f + index) * .16f +
                        latestAtmosphere.windDirectionZ * latestAtmosphere.windStrength * .18f,
                    scaleX = .050f * pulse,
                    scaleY = .050f * pulse,
                    scaleZ = .050f * pulse,
                )
            }
            drawInstanced(
                mesh = requireNotNull(lowSphere),
                color = color("#FFFFFF", .90f),
                transforms = snowTransforms,
                rimStrength = .05f,
                rotateWithScene = false,
            )
        }
    }

    private fun drawTextLabel(
        texture: Int,
        mesh: TextGlMesh,
        transform: Transform,
    ) {
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
        rotateWithScene: Boolean = true,
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
            if (rotateWithScene) {
                Matrix.rotateM(model, 0, frame.sceneRotation, 0f, 1f, 0f)
            }
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
        GLES30.glUniform3f(
            instancedFogColorLocation,
            latestAtmosphere.fog.red,
            latestAtmosphere.fog.green,
            latestAtmosphere.fog.blue,
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

    private fun createCurvedTextMesh(
        radius: Float,
        arc: Float,
        segments: Int,
    ): TextGlMesh {
        val vertices = mutableListOf<Float>()
        val indices = mutableListOf<Short>()
        val startAngle = -arc * .5f
        for (segment in 0..segments) {
            val u = segment / segments.toFloat()
            val angle = startAngle + arc * u
            val x = sin(angle) * radius
            val z = cos(angle) * radius
            vertices += listOf(x, -1f, z, u, 1f)
            vertices += listOf(x, 1f, z, u, 0f)
        }
        repeat(segments) { segment ->
            val bottom = (segment * 2).toShort()
            val top = (bottom + 1).toShort()
            val nextBottom = (bottom + 2).toShort()
            val nextTop = (bottom + 3).toShort()
            indices += listOf(
                bottom,
                nextBottom,
                nextTop,
                bottom,
                nextTop,
                top,
            )
        }
        val vertexArray = vertices.toFloatArray()
        val indexArray = indices.toShortArray()
        val handles = IntArray(1)
        GLES30.glGenVertexArrays(1, handles, 0)
        val vao = handles[0]
        GLES30.glBindVertexArray(vao)

        GLES30.glGenBuffers(1, handles, 0)
        val vertexBuffer = handles[0]
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vertexBuffer)
        GLES30.glBufferData(
            GLES30.GL_ARRAY_BUFFER,
            vertexArray.size * Float.SIZE_BYTES,
            vertexArray.toNativeBuffer(),
            GLES30.GL_STATIC_DRAW,
        )

        GLES30.glGenBuffers(1, handles, 0)
        val indexBuffer = handles[0]
        GLES30.glBindBuffer(GLES30.GL_ELEMENT_ARRAY_BUFFER, indexBuffer)
        GLES30.glBufferData(
            GLES30.GL_ELEMENT_ARRAY_BUFFER,
            indexArray.size * Short.SIZE_BYTES,
            indexArray.toNativeBuffer(),
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
        return TextGlMesh(vao, vertexBuffer, indexBuffer, indexArray.size)
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

    private fun color(value: SceneColor, alpha: Float = 1f): FloatArray {
        dynamicColor[0] = value.red.coerceIn(0f, 1f)
        dynamicColor[1] = value.green.coerceIn(0f, 1f)
        dynamicColor[2] = value.blue.coerceIn(0f, 1f)
        dynamicColor[3] = alpha.coerceIn(0f, 1f)
        return dynamicColor
    }

    private fun pseudo(seed: Int): Float {
        val x = sin(seed * 12.9898) * 43758.5453
        return (x - kotlin.math.floor(x)).toFloat()
    }

    companion object {
        private const val POND_X = -3.2916f
        private const val POND_Z = 4.5305f
        private const val POND_GROUP_HEADING = 144f
        private const val POND_GRANDPA_LOCAL_X = -1.82f
        private const val POND_GRANDPA_LOCAL_Z = -.95f
        private const val PATH_RADIUS = 4.6f
        private const val BRIDGE_ARC_CENTER_DEGREES = 324f
        private const val BRIDGE_ARC_HALF_DEGREES = 17f
        private const val BRIDGE_SEGMENTS = 7
        private const val CROSSROADS_SCALE = .91f
        private const val DEFAULT_CAMERA_PITCH = 24f
        private const val DEFAULT_CAMERA_DISTANCE = 13.2f
        private const val STORY_CAMERA_IDLE_RESUME_MS = 10_000L
        private const val GREETING_WAVE_SECONDS = 2.6f
        private const val STORY_CAMERA_LEAD_DEGREES = 24f
        private const val CAMERA_FOLLOW_LAG = 2.4f
        private const val INTRO_CAMERA_YAW = 180f
        private const val INTRO_CAMERA_RADIUS = 12f
        private const val INTRO_CAMERA_HEIGHT = 5.2f
        private const val INTRO_CAMERA_TARGET_X = 0f
        private const val INTRO_CAMERA_TARGET_Y = 1.2f
        private const val INTRO_CAMERA_TARGET_Z = 4.2f
        private const val FOX_ENDING_PUSH_SECONDS = .60f
        private const val FOX_ENDING_BLACK_RESET_SECONDS = 1.50f
        private const val FOX_ENDING_REBIRTH_SECONDS = 1.90f
        private const val FOX_ENDING_DURATION_SECONDS = 4.60f
        private const val FOX_ENDING_CAMERA_YAW = 264f
        private const val FOX_ENDING_REBIRTH_CAMERA_YAW = -24f
        private const val FOX_ENDING_CAMERA_PITCH = 22f
        private const val FOX_ENDING_CAMERA_DISTANCE = 6.2f
        private const val SCENE_CLOUD_COUNT = 4
        private const val CLOUD_RAIN_SECONDS = 15f
        private const val CLOUD_DARKEN_SECONDS = .50f
        private const val FISHING_TIMELINE_SCALE = 3.35f / 2.7f
        private const val CROSSROADS_PRESS_SECONDS = .21f
        private const val CROSSROADS_NAVIGATION_LOCK_MS = 250L
        private const val OWL_POP_SECONDS = .25f
        private const val OWL_LOOK_SECONDS = 3f
        private const val OWL_FLAP_SECONDS = 1.4f
        private const val OWL_DUCK_SECONDS = .25f
        private const val OWL_FOLDED_WING_DEGREES = 65f
        private const val CELESTIAL_RADIUS = 24f
        private const val MOON_WINK_SECONDS = .40f
        private const val STONE_BIRD_COUNT = 7
        private const val STONE_BIRD_SCATTER_SECONDS = .55f
        private const val STONE_BIRD_SCATTER_DISTANCE = 1.6f
        private const val STONE_BIRD_SCATTER_RISE = .55f
        private const val STONE_BIRD_CLIMB_SECONDS = 1.2f
        private const val STONE_BIRD_CLIMB_DISTANCE = 3.5f
        private const val STONE_BIRD_CLIMB_RISE = 5.5f
        private const val STONE_BIRD_AWAY_MIN_SECONDS = 4f
        private const val STONE_BIRD_AWAY_MAX_SECONDS = 9f
        private const val STONE_BIRD_RETURN_SECONDS = 1.6f
        private const val STONE_BIRD_LAND_SECONDS = .18f
        private const val STONE_BIRD_FLAP_HZ = 9f
        private const val MAGPIE_LAUNCH_SECONDS = 1.8f / .7f
        private const val MAGPIE_AWAY_SECONDS = 15f
        private const val MAGPIE_RETURN_SECONDS = 1.8f / .7f
        private const val MAGPIE_FLAP_HZ = 8f
        private const val REACTIVE_GRASS_COUNT = 168
        private const val REACTIVE_FLOWER_COUNT = 23
        private const val REACTIVE_PLANT_BEND_RADIUS = .55f
        private const val REACTIVE_PLANT_BEND_DEGREES = 28f
        private const val REACTIVE_PLANT_BEND_DECAY = 9f
        private const val REACTIVE_PLANT_BEND_FREQUENCY = 3.2f
        private const val REACTIVE_PLANT_BEND_SECONDS = .40f
        private const val REACTIVE_GRASS_WIND_DEGREES = 14f
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

private fun SceneActor.isAnimal(): Boolean = when (this) {
    SceneActor.HARE,
    SceneActor.WOLF,
    SceneActor.BEAR,
    SceneActor.FOX,
    -> true

    SceneActor.IZBA,
    SceneActor.KOLOBOK,
    -> false
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

private const val TERRAIN_BASE_Y = .018f
private const val TERRAIN_HILL_HEIGHT = .16f
private const val TERRAIN_POTHOLE_DEPTH = .09f

private data class TerrainHill(
    val x: Float,
    val z: Float,
    val radius: Float,
)

private data class TerrainPothole(
    val x: Float,
    val z: Float,
    val majorRadius: Float,
    val minorRadius: Float,
    val rotationDegrees: Float,
)

private data class ReactivePlant(
    val angle: Float,
    val radius: Float,
    val yaw: Float,
    val scale: Float,
)

private data class PlantBendPose(
    val degrees: Float = 0f,
    val directionX: Float = 0f,
    val directionZ: Float = 0f,
)

private data class ZoneCameraFraming(
    val distance: Float,
    val pitchDegrees: Float,
    val lookAtHeight: Float,
)

private fun terrainHeightAt(
    x: Float,
    z: Float,
    hills: List<TerrainHill>,
    potholes: List<TerrainPothole>,
): Float {
    var height = 0f
    hills.forEach { hill ->
        val dx = x - hill.x
        val dz = z - hill.z
        val distance = sqrt(dx * dx + dz * dz)
        if (distance < hill.radius) {
            height +=
                cos(
                    distance / hill.radius *
                        PI.toFloat() * .5f,
                ) * TERRAIN_HILL_HEIGHT
        }
    }
    var deepestPothole = 0f
    potholes.forEach { hole ->
        val radians = Math.toRadians((-hole.rotationDegrees).toDouble())
        val cosine = cos(radians).toFloat()
        val sine = sin(radians).toFloat()
        val dx = x - hole.x
        val dz = z - hole.z
        val localX = dx * cosine - dz * sine
        val localZ = dx * sine + dz * cosine
        val normalizedDistance = sqrt(
            localX * localX / (hole.majorRadius * hole.majorRadius) +
                localZ * localZ / (hole.minorRadius * hole.minorRadius),
        )
        if (normalizedDistance < 1f) {
            deepestPothole = max(
                deepestPothole,
                cos(normalizedDistance * PI.toFloat() * .5f),
            )
        }
    }
    return height - deepestPothole * TERRAIN_POTHOLE_DEPTH
}

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

private data class CrossroadsPlaqueSpec(
    val y: Float,
    val innerRadius: Float,
    val outerRadius: Float,
    val height: Float,
    val arcLength: Float,
    val azimuth: Float,
    val tilt: Float,
    val labelScaleX: Float,
    val labelScaleY: Float,
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
    fun terrainDisc(
        radius: Float,
        rings: Int,
        segments: Int,
        hills: List<TerrainHill>,
        potholes: List<TerrainPothole>,
    ): MeshData {
        val vertexCount = 1 + rings * (segments + 1)
        val vertices = FloatArray(vertexCount * 6)
        val indices = ArrayList<Short>(
            segments * 3 + (rings - 1) * segments * 6,
        )

        fun writeVertex(index: Int, x: Float, z: Float) {
            val y = terrainHeightAt(x, z, hills, potholes)
            val sample = .035f
            val slopeX = (
                terrainHeightAt(x - sample, z, hills, potholes) -
                    terrainHeightAt(x + sample, z, hills, potholes)
                ) / (sample * 2f)
            val slopeZ = (
                terrainHeightAt(x, z - sample, hills, potholes) -
                    terrainHeightAt(x, z + sample, hills, potholes)
                ) / (sample * 2f)
            val normalLength =
                sqrt(slopeX * slopeX + 1f + slopeZ * slopeZ)
                    .coerceAtLeast(.001f)
            val offset = index * 6
            vertices[offset] = x
            vertices[offset + 1] = y
            vertices[offset + 2] = z
            vertices[offset + 3] = slopeX / normalLength
            vertices[offset + 4] = 1f / normalLength
            vertices[offset + 5] = slopeZ / normalLength
        }

        writeVertex(0, 0f, 0f)
        for (ringIndex in 1..rings) {
            val ringRadius = radius * ringIndex / rings.toFloat()
            for (segment in 0..segments) {
                val angle = segment.toDouble() / segments * PI * 2.0
                val vertexIndex = 1 + (ringIndex - 1) * (segments + 1) + segment
                writeVertex(
                    vertexIndex,
                    sin(angle).toFloat() * ringRadius,
                    cos(angle).toFloat() * ringRadius,
                )
            }
        }

        repeat(segments) { segment ->
            val current = (1 + segment).toShort()
            val next = (1 + segment + 1).toShort()
            indices += 0.toShort()
            indices += current
            indices += next
        }
        for (ringIndex in 1 until rings) {
            val innerStart = 1 + (ringIndex - 1) * (segments + 1)
            val outerStart = 1 + ringIndex * (segments + 1)
            repeat(segments) { segment ->
                val inner = (innerStart + segment).toShort()
                val innerNext = (innerStart + segment + 1).toShort()
                val outer = (outerStart + segment).toShort()
                val outerNext = (outerStart + segment + 1).toShort()
                indices += inner
                indices += outer
                indices += outerNext
                indices += inner
                indices += outerNext
                indices += innerNext
            }
        }
        return MeshData(vertices, indices.toShortArray())
    }

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

    /**
     * A seeded, shared outline used by both the pond rim and the water.
     * Scaling one mesh keeps the nested shore/water edge coherent while the
     * intentionally uneven radius avoids the stamped-circle look.
     */
    fun irregularDisc(segments: Int, seed: Int): MeshData {
        val vertices = mutableListOf<Float>()
        val indices = mutableListOf<Short>()

        fun seeded(index: Int): Float {
            val value = sin((seed * 31.17 + index * 12.9898)) * 43758.5453
            return (value - kotlin.math.floor(value)).toFloat()
        }

        vertices += listOf(0f, 0f, 0f, 0f, 1f, 0f)
        repeat(segments) { index ->
            val angle = index.toDouble() / segments * PI * 2.0
            val broadWave = sin(angle * 3.0 + .7).toFloat() * .055f
            val radius = 1f + (seeded(index) * 2f - 1f) * .13f + broadWave
            vertices += listOf(
                sin(angle).toFloat() * radius,
                0f,
                cos(angle).toFloat() * radius,
                0f,
                1f,
                0f,
            )
        }
        repeat(segments) { index ->
            val current = (index + 1).toShort()
            val next = ((index + 1) % segments + 1).toShort()
            indices += listOf(0.toShort(), current, next)
        }
        return MeshData(vertices.toFloatArray(), indices.toShortArray())
    }

    /**
     * Low-poly lathed boulder with a planted base, lower-body bulge, tapered
     * crown and three shallow horizontal channels for the menu tablets.
     * Each ring receives deterministic angular variation so the silhouette
     * is rocky rather than a stretched sphere.
     */
    fun profiledBoulder(segments: Int): MeshData {
        val vertices = mutableListOf<Float>()
        val indices = mutableListOf<Short>()
        val heights = floatArrayOf(
            -.16f, -.02f, .25f, .55f, .82f, 1.08f, 1.34f, 1.60f, 1.84f, 2.05f, 2.22f, 2.30f,
        )
        val baseRadii = floatArrayOf(
            .72f, .99f, 1.15f, 1.11f, 1.07f, 1.01f, .94f, .84f, .75f, .57f, .30f, .08f,
        )
        val grooveHeights = floatArrayOf(.78f, 1.27f, 1.76f)

        fun ringRadius(ring: Int): Float {
            var radius = baseRadii[ring]
            grooveHeights.forEach { grooveY ->
                val distance = abs(heights[ring] - grooveY)
                if (distance < .19f) {
                    val dip = cos((distance / .19f * PI.toFloat() * .5f).toDouble()).toFloat()
                    radius *= 1f - dip * .12f
                }
            }
            return radius
        }

        fun seeded(index: Int): Float {
            val value = sin(index * 12.9898 + 3.731) * 43758.5453
            return (value - kotlin.math.floor(value)).toFloat()
        }

        heights.indices.forEach { ring ->
            val previous = max(0, ring - 1)
            val next = min(heights.lastIndex, ring + 1)
            val deltaY = (heights[next] - heights[previous]).coerceAtLeast(.001f)
            val radiusSlope = (ringRadius(next) - ringRadius(previous)) / deltaY
            for (segment in 0..segments) {
                val wrapped = segment % segments
                val angle = wrapped.toDouble() / segments * PI * 2.0
                val irregularity =
                    1f +
                        (seeded(ring * 97 + wrapped * 29 + 7) * 2f - 1f) * .055f +
                        sin(angle * 3.0 + ring * .63).toFloat() * .018f
                val radius = ringRadius(ring) * irregularity
                val nx = sin(angle).toFloat()
                val ny = -radiusSlope
                val nz = cos(angle).toFloat()
                val normalLength = sqrt(nx * nx + ny * ny + nz * nz).coerceAtLeast(.001f)
                val yJitter = if (ring == 0 || ring == heights.lastIndex) {
                    0f
                } else {
                    (seeded(ring * 151 + wrapped * 43 + 11) * 2f - 1f) * .018f
                }
                vertices += listOf(
                    sin(angle).toFloat() * radius,
                    heights[ring] + yJitter,
                    cos(angle).toFloat() * radius,
                    nx / normalLength,
                    ny / normalLength,
                    nz / normalLength,
                )
            }
        }

        val rowSize = segments + 1
        for (ring in 0 until heights.lastIndex) {
            for (segment in 0 until segments) {
                val lower = ring * rowSize + segment
                val lowerNext = lower + 1
                val upper = lower + rowSize
                val upperNext = upper + 1
                indices += listOf(
                    lower.toShort(),
                    lowerNext.toShort(),
                    upper.toShort(),
                    lowerNext.toShort(),
                    upperNext.toShort(),
                    upper.toShort(),
                )
            }
        }

        val bottomCenter = (vertices.size / 6).toShort()
        vertices += listOf(0f, heights.first() - .01f, 0f, 0f, -1f, 0f)
        repeat(segments) { segment ->
            val current = segment.toShort()
            val next = (segment + 1).toShort()
            indices += listOf(bottomCenter, next, current)
        }

        val topCenter = (vertices.size / 6).toShort()
        vertices += listOf(0f, heights.last() + .035f, 0f, 0f, 1f, 0f)
        val topRingStart = heights.lastIndex * rowSize
        repeat(segments) { segment ->
            val current = (topRingStart + segment).toShort()
            val next = (topRingStart + segment + 1).toShort()
            indices += listOf(topCenter, current, next)
        }
        return MeshData(vertices.toFloatArray(), indices.toShortArray())
    }

    /**
     * Solid ring-sector tablet. Unlike a flat cube, its front and back faces
     * follow the stone radius and its top/bottom/end caps expose real depth.
     */
    fun curvedArcBlock(
        innerRadius: Float,
        outerRadius: Float,
        height: Float,
        arc: Float,
        segments: Int,
        weatheringSeed: Int = 0,
    ): MeshData {
        val vertices = mutableListOf<Float>()
        val indices = mutableListOf<Short>()
        val halfHeight = height * .5f
        val startAngle = -arc * .5f

        fun point(angle: Float, y: Float, radius: Float): FloatArray =
            floatArrayOf(sin(angle) * radius, y, cos(angle) * radius)

        fun seeded(index: Int): Float {
            if (weatheringSeed == 0) return .5f
            val value = sin((weatheringSeed * 19.17 + index * 12.9898)) * 43758.5453
            return (value - kotlin.math.floor(value)).toFloat()
        }

        fun edgeSample(index: Int): FloatArray {
            if (weatheringSeed == 0) {
                return floatArrayOf(-halfHeight, halfHeight, innerRadius, outerRadius)
            }
            val t = index / segments.toFloat()
            val endAmount = ((abs(t - .5f) * 2f - .72f) / .28f).coerceIn(0f, 1f)
            val taper = endAmount * (.032f + seeded(index * 17 + 3) * .020f)
            val lower = -halfHeight + taper + (seeded(index * 23 + 5) - .5f) * .022f
            val upper = halfHeight - taper + (seeded(index * 29 + 7) - .5f) * .022f
            val inner = innerRadius + (seeded(index * 31 + 11) - .5f) * .008f
            val outer = outerRadius + (seeded(index * 37 + 13) - .5f) * .018f
            return floatArrayOf(lower, upper, inner, outer)
        }

        fun addQuad(
            a: FloatArray,
            b: FloatArray,
            c: FloatArray,
            d: FloatArray,
            nx: Float,
            ny: Float,
            nz: Float,
        ) {
            val base = (vertices.size / 6).toShort()
            listOf(a, b, c, d).forEach { p ->
                vertices += listOf(p[0], p[1], p[2], nx, ny, nz)
            }
            indices += listOf(
                base,
                (base + 1).toShort(),
                (base + 2).toShort(),
                base,
                (base + 2).toShort(),
                (base + 3).toShort(),
            )
        }

        repeat(segments) { segment ->
            val a0 = startAngle + arc * segment / segments
            val a1 = startAngle + arc * (segment + 1) / segments
            val middle = (a0 + a1) * .5f
            val outerNormalX = sin(middle)
            val outerNormalZ = cos(middle)
            val edge0 = edgeSample(segment)
            val edge1 = edgeSample(segment + 1)

            val outerBottom0 = point(a0, edge0[0], edge0[3])
            val outerBottom1 = point(a1, edge1[0], edge1[3])
            val outerTop1 = point(a1, edge1[1], edge1[3])
            val outerTop0 = point(a0, edge0[1], edge0[3])
            addQuad(
                outerBottom0,
                outerBottom1,
                outerTop1,
                outerTop0,
                outerNormalX,
                0f,
                outerNormalZ,
            )

            val innerBottom0 = point(a0, edge0[0], edge0[2])
            val innerBottom1 = point(a1, edge1[0], edge1[2])
            val innerTop1 = point(a1, edge1[1], edge1[2])
            val innerTop0 = point(a0, edge0[1], edge0[2])
            addQuad(
                innerBottom0,
                innerTop0,
                innerTop1,
                innerBottom1,
                -outerNormalX,
                0f,
                -outerNormalZ,
            )
            addQuad(
                innerTop0,
                outerTop0,
                outerTop1,
                innerTop1,
                0f,
                1f,
                0f,
            )
            addQuad(
                innerBottom0,
                innerBottom1,
                outerBottom1,
                outerBottom0,
                0f,
                -1f,
                0f,
            )
        }

        val endAngle = startAngle + arc
        val startEdge = edgeSample(0)
        val endEdge = edgeSample(segments)
        addQuad(
            point(startAngle, startEdge[0], startEdge[2]),
            point(startAngle, startEdge[0], startEdge[3]),
            point(startAngle, startEdge[1], startEdge[3]),
            point(startAngle, startEdge[1], startEdge[2]),
            -cos(startAngle),
            0f,
            sin(startAngle),
        )
        addQuad(
            point(endAngle, endEdge[0], endEdge[2]),
            point(endAngle, endEdge[1], endEdge[2]),
            point(endAngle, endEdge[1], endEdge[3]),
            point(endAngle, endEdge[0], endEdge[3]),
            cos(endAngle),
            0f,
            -sin(endAngle),
        )
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
