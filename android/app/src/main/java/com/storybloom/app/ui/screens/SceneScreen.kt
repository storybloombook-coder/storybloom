package com.storybloom.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.view.HapticFeedbackConstants
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.TrackChanges
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.zIndex
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.storybloom.app.StorybloomApplication
import com.storybloom.app.data.TrimEnvelope
import com.storybloom.app.scene.CrossroadsAction
import com.storybloom.app.scene.SceneBubbleAnchor
import com.storybloom.app.scene.SceneInteraction
import com.storybloom.app.scene.SceneEncounterSnapshot
import com.storybloom.app.scene.SceneInteractionEvent
import com.storybloom.app.scene.SceneInteractionVariant
import com.storybloom.app.scene.SceneNarration
import com.storybloom.app.scene.SceneStoryMode
import com.storybloom.app.scene.SceneStorySnapshot
import com.storybloom.app.scene.SceneWeather
import com.storybloom.app.scene.SceneWeatherObservation
import com.storybloom.app.scene.SceneWeatherService
import com.storybloom.app.scene.SceneZone
import com.storybloom.app.scene.StorySceneView
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.components.GlassGlareOverlay
import com.storybloom.app.ui.components.GlassTilt
import com.storybloom.app.ui.components.TactileSurface
import com.storybloom.app.ui.components.rememberGlassTilt
import com.storybloom.app.ui.text
import kotlinx.coroutines.delay

@Composable
fun SceneScreen(
    locale: UiLocale,
    onLocaleChange: (UiLocale) -> Unit,
    onAddBook: () -> Unit,
    onCreateStory: () -> Unit,
    onLibrary: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val hapticView = LocalView.current
    val audioEngine = (context.applicationContext as StorybloomApplication).audioEngine
    val glassTilt = rememberGlassTilt()
    var sceneView by remember { mutableStateOf<StorySceneView?>(null) }
    var storyState by remember { mutableStateOf<SceneStorySnapshot?>(null) }
    var encounterState by remember { mutableStateOf(SceneEncounterSnapshot()) }
    var bubbleAnchor by remember { mutableStateOf<SceneBubbleAnchor?>(null) }
    var activeZone by remember { mutableStateOf(SceneZone.IZBA) }
    var following by remember { mutableStateOf(false) }
    var weatherObservation by remember {
        mutableStateOf(SceneWeatherObservation(SceneWeather.CLEAR))
    }
    var weatherPermissionVersion by remember { mutableIntStateOf(0) }
    var interactionLine by remember { mutableStateOf<String?>(null) }
    var interactionSequence by remember { mutableIntStateOf(0) }
    var discoveryHintVisible by remember { mutableStateOf(false) }
    var discoveryHintSequence by remember { mutableIntStateOf(0) }
    var foxEndingSequence by remember { mutableIntStateOf(0) }
    val foxEndingFade = remember { Animatable(0f) }
    val foxEndingUiAlpha = remember { Animatable(1f) }
    val storyFade = remember { Animatable(0f) }
    val discoveryPreferences = remember(context) {
        context.getSharedPreferences("storybloom-scene-discoveries", 0)
    }
    val scenePreferences = remember(context) {
        context.getSharedPreferences("storybloom-scene-settings", 0)
    }
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        weatherPermissionVersion += 1
    }
    var discoveries by remember(discoveryPreferences) {
        mutableStateOf(
            discoveryPreferences
                .getStringSet("found", emptySet())
                .orEmpty()
                .mapNotNull { name ->
                    runCatching { SceneInteraction.valueOf(name) }.getOrNull()
                }
                .toSet(),
        )
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    var lifecycleResumed by remember(lifecycleOwner) {
        mutableStateOf(
            lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED),
        )
    }
    val playing = storyState?.mode == SceneStoryMode.PLAYING ||
        storyState?.mode == SceneStoryMode.REBIRTH
    val storyCompleted = storyState?.mode == SceneStoryMode.STOPPED
    val zoneTitle = zoneTitle(activeZone, locale)
    val storyLine = narrationText(storyState?.narration, locale)
    val encounterLine = narrationText(encounterState.narration, locale)
    val bubbleLine = storyLine ?: encounterLine ?: interactionLine
    val countedDiscoveries = setOf(
        SceneInteraction.GRANDPA_FISHING,
        SceneInteraction.CHIMNEY_SMOKE,
        SceneInteraction.MAGPIES,
        SceneInteraction.CLOUD_RAIN,
        SceneInteraction.HEDGEHOG,
        SceneInteraction.OWL_WAKE,
        SceneInteraction.MOON_WINK,
    )

    LaunchedEffect(scenePreferences) {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            weatherPermissionVersion += 1
        } else if (!scenePreferences.getBoolean("weather-permission-requested", false)) {
            scenePreferences.edit()
                .putBoolean("weather-permission-requested", true)
                .apply()
            locationPermissionLauncher.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
    }

    fun respondTo(event: SceneInteractionEvent) {
        val interaction = event.interaction
        val (line, sound) = when (interaction) {
            SceneInteraction.GRANDPA_FISHING -> when (event.variant) {
                SceneInteractionVariant.FISH_BOOT -> locale.text(
                    "Grandpa: “A boot. Again.”",
                    "Дед: «Опять сапог...»",
                )
                SceneInteractionVariant.FISH_GOLD -> locale.text(
                    "Grandpa: “A golden fish! I'll let you go, dear — no wishes needed today.”",
                    "Дед: «Золотая рыбка! Отпущу тебя — нам и так хорошо.»",
                )
                else -> locale.text(
                    "Grandpa: “Ooh, a fine one! Back you go.”",
                    "Дед: «Ух ты, хороша! Ну, плыви себе.»",
                )
            } to "fx_splash"
            SceneInteraction.CHIMNEY_SMOKE -> locale.text(
                "A perfect smoke ring drifts from the chimney.",
                "Из трубы выплывает ровное колечко дыма.",
            ) to "fx_whoosh"
            SceneInteraction.IZBA_WINDOW -> locale.text(
                "Grandma's window glows warmly.",
                "Бабушкино окошко светится тёплым светом.",
            ) to "fx_chime"
            SceneInteraction.WILLOW_RUSTLE -> locale.text(
                "The old willow whispers in the breeze.",
                "Старая ива шепчется с ветерком.",
            ) to "fx_leaves"
            SceneInteraction.MAGPIES -> locale.text(
                "Three magpies burst from the willow!",
                "Три сороки вспорхнули с ивы!",
            ) to "fx_animal_bird"
            SceneInteraction.FROG_SPLASH -> locale.text(
                "Plop! A frog leaps from the reeds.",
                "Плюх! Лягушка выпрыгнула из камышей.",
            ) to "fx_animal_frog"
            SceneInteraction.STONE_BIRDS -> locale.text(
                "The stone's little flock takes wing.",
                "Птичья стайка у камня взмыла в небо.",
            ) to "fx_animal_bird"
            SceneInteraction.CLOUD_RAIN -> locale.text(
                "A tiny shower follows the cloud.",
                "За облачком потянулся маленький дождик.",
            ) to "fx_rain"
            SceneInteraction.HEDGEHOG -> locale.text(
                "A hedgehog carries the mushroom home.",
                "Ёжик понёс гриб домой.",
            ) to "fx_leaves"
            SceneInteraction.OWL_WAKE -> locale.text(
                "An owl opens two sleepy eyes.",
                "Сова открыла два сонных глаза.",
            ) to "fx_animal_owl"
            SceneInteraction.OWL_FLAP -> locale.text(
                "The owl answers with a soft flap.",
                "Сова ответила тихим взмахом крыльев.",
            ) to "fx_animal_owl"
            SceneInteraction.HARE -> locale.text(
                "The hare springs high above the clover.",
                "Заяц подпрыгнул выше клевера.",
            ) to "fx_boing"
            SceneInteraction.WOLF -> locale.text(
                "The wolf listens, then lowers his tail.",
                "Волк прислушался и опустил хвост.",
            ) to "fx_animal_wolf"
            SceneInteraction.BEAR -> locale.text(
                "The bear waves a honey-sticky paw.",
                "Медведь машет лапой, липкой от мёда.",
            ) to "fx_roar"
            SceneInteraction.FOX -> locale.text(
                "The fox's bright tail swishes through the grass.",
                "Яркий лисий хвост скользнул по траве.",
            ) to "fx_swoosh"
            SceneInteraction.FOX_TRUE_ENDING -> locale.text(
                "Grandma: Fresh out of the oven—again!",
                "Бабушка: Только из печи — опять!",
            ) to "fx_chime"
            SceneInteraction.KOLOBOK -> locale.text(
                "Kolobok hums his traveling song.",
                "Колобок напевает дорожную песенку.",
            ) to "fx_chime"
            SceneInteraction.MOON_WINK -> locale.text(
                "The moon winked back.",
                "Луна подмигнула в ответ.",
            ) to "fx_twinkle"
            SceneInteraction.TREE_RUSTLE -> locale.text(
                "Bonk! The tree bends and springs back.",
                "Бум! Дерево качнулось и упруго выпрямилось.",
            ) to "fx_leaves"
            SceneInteraction.SUN_GLOW -> locale.text(
                "The sun beams a little brighter.",
                "Солнце засияло чуточку ярче.",
            ) to "fx_twinkle"
            SceneInteraction.BUTTERFLY_DANCE -> locale.text(
                "The butterflies whirl into a tiny dance.",
                "Бабочки закружились в маленьком танце.",
            ) to "fx_whoosh"
            SceneInteraction.HIVE_BUZZ -> locale.text(
                "The bees hum around their honey.",
                "Пчёлки загудели над душистым мёдом.",
            ) to "fx_animal_bee"
        }
        if (interaction in countedDiscoveries) {
            discoveries = discoveries + interaction
            discoveryPreferences.edit()
                .putStringSet("found", discoveries.map { it.name }.toSet())
                .apply()
        }
        if (interaction == SceneInteraction.FOX_TRUE_ENDING) {
            foxEndingSequence += 1
        }
        val hasAuthoredInteractionLine =
            interaction == SceneInteraction.GRANDPA_FISHING
        if (hasAuthoredInteractionLine) {
            interactionLine = line
            interactionSequence += 1
        }
        audioEngine.preview(sound)
    }

    LaunchedEffect(sceneView, lifecycleResumed) {
        while (lifecycleResumed) {
            sceneView?.let { view ->
                storyState = view.storySnapshot()
                encounterState = view.encounterSnapshot()
                bubbleAnchor = view.bubbleAnchor()
                activeZone = view.activeZone()
            }
            delay(50)
        }
    }

    LaunchedEffect(lifecycleResumed, weatherPermissionVersion) {
        while (lifecycleResumed) {
            weatherObservation = SceneWeatherService.refresh(context.applicationContext)
            delay(30L * 60L * 1_000L)
        }
    }

    LaunchedEffect(interactionSequence) {
        if (interactionSequence == 0) return@LaunchedEffect
        val sequence = interactionSequence
        delay(3_800)
        if (interactionSequence == sequence) interactionLine = null
    }

    LaunchedEffect(discoveryHintSequence) {
        if (discoveryHintSequence == 0) return@LaunchedEffect
        val sequence = discoveryHintSequence
        delay(2_500)
        if (discoveryHintSequence == sequence) discoveryHintVisible = false
    }

    LaunchedEffect(foxEndingSequence) {
        if (foxEndingSequence == 0) return@LaunchedEffect
        foxEndingFade.snapTo(0f)
        foxEndingUiAlpha.snapTo(1f)
        foxEndingUiAlpha.animateTo(0f, tween(600))
        delay(500)
        foxEndingFade.animateTo(1f, tween(400))
        delay(400)
        hapticView.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
        foxEndingFade.animateTo(0f, tween(600))
        delay(100)
        interactionLine = locale.text(
            "Grandma: Fresh out of the oven—again!",
            "Бабушка: Только из печи — опять!",
        )
        interactionSequence += 1
        foxEndingUiAlpha.animateTo(1f, tween(300))
    }

    LaunchedEffect(storyState?.fadeBlack) {
        if (storyState?.fadeBlack == true) {
            hapticView.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
        }
        storyFade.animateTo(
            targetValue = if (storyState?.fadeBlack == true) 1f else 0f,
            animationSpec = tween(if (storyState?.fadeBlack == true) 300 else 900),
        )
    }

    LaunchedEffect(storyState?.narration) {
        if (storyState?.narration == SceneNarration.REBIRTH) {
            hapticView.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
        }
    }

    LaunchedEffect(audioEngine) {
        audioEngine.prewarm(
            listOf(
                "fx_splash",
                "fx_whoosh",
                "fx_leaves",
                "fx_animal_bird",
                "fx_animal_frog",
                "fx_rain",
                "fx_animal_owl",
                "fx_boing",
                "fx_animal_wolf",
                "fx_roar",
                "fx_swoosh",
                "fx_chime",
                "fx_twinkle",
                "fx_magic",
                "fx_sparkle",
                "fx_animal_bee",
            ),
        )
    }

    DisposableEffect(audioEngine, lifecycleOwner) {
        var ambientStarted = false
        fun updateForLifecycle(resumed: Boolean) {
            lifecycleResumed = resumed
            if (resumed && !ambientStarted) {
                audioEngine.playAmbient(
                    TrimEnvelope(
                        soundId = "amb_forest",
                        fadeInMs = 650L,
                        fadeOutMs = 450L,
                    ),
                    gainOverride = .16f,
                )
                ambientStarted = true
            } else if (!resumed && ambientStarted) {
                audioEngine.stopAmbient(immediate = true)
                ambientStarted = false
            }
        }
        updateForLifecycle(
            lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED),
        )
        val ambienceObserver = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> updateForLifecycle(true)
                Lifecycle.Event.ON_PAUSE -> updateForLifecycle(false)
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(ambienceObserver)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(ambienceObserver)
            if (ambientStarted) audioEngine.stopAmbient()
        }
    }

    DisposableEffect(lifecycleOwner, sceneView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> sceneView?.onResume()
                Lifecycle.Event.ON_PAUSE -> sceneView?.onPause()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            sceneView?.onPause()
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val sceneMaxWidth = maxWidth
        val sceneMaxHeight = maxHeight
        AndroidView(
            factory = { context ->
                StorySceneView(context).also { sceneView = it }
            },
            modifier = Modifier.fillMaxSize(),
            update = { view ->
                view.setSceneRotationEnabled(false)
                view.setFollowKolobok(following)
                view.setEnvironment(weatherObservation)
                view.setRockMenuLanguage(locale == UiLocale.RUSSIAN)
                view.onCrossroadsAction = { action ->
                    when (action) {
                        CrossroadsAction.ADD_BOOK -> onAddBook()
                        CrossroadsAction.CREATE_STORY -> onCreateStory()
                        CrossroadsAction.LIBRARY -> onLibrary()
                    }
                }
                view.onSceneInteractionEvent = ::respondTo
            },
        )

        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = foxEndingUiAlpha.value },
        ) {
            Column(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .systemBarsPadding()
                .padding(top = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                zoneTitle,
                color = Color(0xFF2E2A22),
                fontSize = 22.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                locale.text(
                    "Swipe to explore · tap a character",
                    "Проведите, чтобы осмотреться · нажмите на героя",
                ),
                color = Color(0xFF4A463C).copy(alpha = .80f),
                fontSize = 13.sp,
            )
        }

            Column(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .systemBarsPadding()
                .padding(top = 14.dp, end = 14.dp),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Surface(
                modifier = Modifier
                    .clickable {
                        discoveryHintVisible = true
                        discoveryHintSequence += 1
                    }
                    .semantics {
                        contentDescription = locale.text(
                            "${discoveries.size} of 7 discoveries. Find all the secrets.",
                            "Открыто ${discoveries.size} из 7 секретов. Найдите их все.",
                        )
                    },
                color = Color.White.copy(alpha = .55f),
                contentColor = Color(0xFF2E2A22),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text(
                    "${discoveries.size}/7",
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            AnimatedVisibility(
                visible = discoveryHintVisible,
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                Surface(
                    color = Color.White.copy(alpha = .85f),
                    contentColor = Color(0xFF2E2A22),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Text(
                        locale.text("Find all the secrets", "Найдите все секреты"),
                        modifier = Modifier.padding(horizontal = 11.dp, vertical = 7.dp),
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }

            val bubbleModifier = bubbleAnchor?.let { anchor ->
            val x = (sceneMaxWidth * anchor.xFraction - 140.dp)
                .coerceIn(8.dp, maxOf(8.dp, sceneMaxWidth - 288.dp))
            val y = (sceneMaxHeight * anchor.yFraction - 96.dp)
                .coerceIn(92.dp, maxOf(92.dp, sceneMaxHeight - 218.dp))
            Modifier
                .align(Alignment.TopStart)
                .offset(x = x, y = y)
                .widthIn(max = 280.dp)
        } ?: Modifier
            .align(Alignment.BottomCenter)
            .widthIn(max = 280.dp)
            .systemBarsPadding()
            .padding(bottom = 164.dp)

            AnimatedVisibility(
            visible = bubbleLine != null,
            modifier = bubbleModifier,
            enter = fadeIn(),
            exit = fadeOut(),
        ) {
            Surface(
                color = Color(0xFFF9F1DE).copy(alpha = .94f),
                contentColor = Color(0xFF3A2C1A),
                shape = RoundedCornerShape(16.dp),
            ) {
                Row(Modifier.height(IntrinsicSize.Min)) {
                    Box(
                        Modifier
                            .width(3.dp)
                            .fillMaxHeight()
                            .background(Color(0xFFD09A38)),
                    )
                    Text(
                        bubbleLine.orEmpty(),
                        modifier = Modifier.padding(horizontal = 15.dp, vertical = 10.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }

            Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .systemBarsPadding()
                .padding(start = 14.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            GlassSceneButton(
                tilt = glassTilt,
                contentDescription = locale.text("Change language", "Сменить язык"),
                onClick = {
                    sceneView?.noteUserInput()
                    onLocaleChange(
                        if (locale == UiLocale.ENGLISH) UiLocale.RUSSIAN else UiLocale.ENGLISH,
                    )
                },
            ) {
                Text(
                    if (locale == UiLocale.ENGLISH) "RU" else "EN",
                    color = Color.White,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
            GlassSceneButton(
                tilt = glassTilt,
                contentDescription = locale.text("Return to the menu", "Вернуться в меню"),
                onClick = {
                    sceneView?.noteUserInput()
                    onBack()
                },
            ) {
                Text(
                    "2D",
                    color = Color.White,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

            Column(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .systemBarsPadding()
                .padding(end = 14.dp, bottom = 12.dp),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            GlassSceneButton(
                tilt = glassTilt,
                contentDescription = if (following) {
                    locale.text("Orbit the island center", "Вращаться вокруг центра острова")
                } else {
                    locale.text("Orbit around Kolobok", "Вращаться вокруг Колобка")
                },
                selected = following,
                onClick = {
                    sceneView?.noteUserInput()
                    following = !following
                },
            ) {
                val followTint = if (following) Color(0xFFFFD36A) else Color.White
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        Icons.Rounded.TrackChanges,
                        contentDescription = null,
                        tint = followTint,
                        modifier = Modifier.size(20.dp),
                    )
                    Text(
                        locale.text("FOLLOW", "\u0421\u041b\u0415\u0414"),
                        color = followTint,
                        fontSize = 8.sp,
                        lineHeight = 8.sp,
                        fontWeight = FontWeight.Black,
                    )
                }
            }
            GlassSceneButton(
                tilt = glassTilt,
                contentDescription = if (playing) {
                    locale.text("Pause the story", "Поставить сказку на паузу")
                } else if (storyCompleted) {
                    locale.text("Play the tale again", "Рассказать сказку снова")
                } else {
                    locale.text("Continue the story", "Продолжить сказку")
                },
                onClick = {
                    if (playing) {
                        sceneView?.requestStoryPause()
                    } else {
                        sceneView?.requestStoryPlay()
                    }
                },
            ) {
                Icon(
                    if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(23.dp),
                )
            }
            }
        }

        Box(
            Modifier
                .fillMaxSize()
                .zIndex(10f)
                .background(
                    Color.Black.copy(alpha = maxOf(foxEndingFade.value, storyFade.value)),
                ),
        )
    }
}

private fun zoneTitle(
    zone: SceneZone,
    locale: UiLocale,
): String = when (zone) {
    SceneZone.IZBA -> locale.text("Grandma's izba", "Избушка бабушки")
    SceneZone.HARE -> locale.text("Hare meadow", "Заячий луг")
    SceneZone.WOLF -> locale.text("Wolf forest", "Волчий лес")
    SceneZone.BEAR -> locale.text("Bear thicket", "Медвежья чаща")
    SceneZone.FOX -> locale.text("Fox clearing", "Лисья поляна")
}

private fun narrationText(
    narration: SceneNarration?,
    locale: UiLocale,
): String? = when (narration) {
    null -> null
    SceneNarration.BAKE_START -> locale.text(
        "Grandma scraped the flour bin and mixed a little dough...",
        "По амбару метено, по сусекам скребено — замесила бабушка тесто...",
    )
    SceneNarration.GRANDMA_COOKS -> locale.text(
        "...kneading and shaping it into a small round bun.",
        "...и скатала из него колобок.",
    )
    SceneNarration.OTHER_PLANS -> locale.text(
        "...and set him on the windowsill to cool. But Kolobok had other plans.",
        "...и положила на окошко студиться. Но у Колобка были свои планы.",
    )
    SceneNarration.HARE_THREAT -> locale.text(
        "Hare: “Kolobok, Kolobok, I will eat you up!”",
        "Заяц: «Колобок, Колобок, я тебя съем!»",
    )
    SceneNarration.WOLF_THREAT -> locale.text(
        "Wolf: “Kolobok, Kolobok, I will eat you up!”",
        "Волк: «Колобок, Колобок, я тебя съем!»",
    )
    SceneNarration.BEAR_THREAT -> locale.text(
        "Bear: “Kolobok, Kolobok, I will eat you up!”",
        "Медведь: «Колобок, Колобок, я тебя съем!»",
    )
    SceneNarration.FOX_INTRO -> locale.text(
        "But by the fox clearing sat someone very polite...",
        "А на лисьей поляне сидел кое-кто очень вежливый...",
    )
    SceneNarration.FOX_FLATTER -> locale.text(
        "Fox: “What a lovely song! Come closer, dear — I can't quite hear.”",
        "Лиса: «Какая славная песенка! Подойди поближе, милый, — я стала глуховата.»",
    )
    SceneNarration.FOX_CLOSER -> locale.text(
        "Fox: “Closer still, sweet thing... sit right on my nose.”",
        "Лиса: «Сядь ко мне на носок да спой ещё разок!»",
    )
    SceneNarration.KOLOBOK_SONG -> locale.text(
        "“I ran away from Grandma, I ran away from Grandpa — and I'll run away from you!”",
        "«Я от бабушки ушёл, я от дедушки ушёл — и от тебя уйду!»",
    )
    SceneNarration.BRAG_GRANDMA -> locale.text(
        "And on he rolled — from Grandma and Grandpa he'd gotten away...",
        "И покатился дальше — от бабушки ушёл, от дедушки ушёл...",
    )
    SceneNarration.BRAG_WOLF -> locale.text(
        "And on he rolled — from the Wolf he'd gotten away...",
        "И покатился дальше — и от волка ушёл...",
    )
    SceneNarration.BRAG_BEAR -> locale.text(
        "And on he rolled — from the Bear he'd gotten away...",
        "И покатился дальше — и от медведя ушёл...",
    )
    SceneNarration.SNAP -> locale.text(
        "...and SNAP! That is how the tale goes.",
        "...ам! — вот и сказке конец.",
    )
    SceneNarration.REBIRTH -> locale.text(
        "But Grandma just smiled — and baked another.",
        "А бабушка улыбнулась — и испекла нового.",
    )
    SceneNarration.GRANDMA_TAP -> locale.text(
        "Grandma: “Kolobok, where have you rolled off to again?”",
        "Бабушка: «Колобок, куда ты опять укатился?»",
    )
    SceneNarration.KOLOBOK_HUMS -> locale.text(
        "Kolobok hums his traveling song.",
        "Колобок напевает дорожную песенку.",
    )
}

@Composable
private fun GlassSceneButton(
    tilt: GlassTilt,
    contentDescription: String,
    onClick: () -> Unit,
    selected: Boolean = false,
    content: @Composable () -> Unit,
) {
    TactileSurface(
        onClick = onClick,
        modifier = Modifier
            .size(40.dp)
            .semantics { this.contentDescription = contentDescription },
        shape = CircleShape,
        containerColor = Color.Black.copy(alpha = .32f),
        contentColor = Color.White,
        borderColor = if (selected) {
            Color(0xFFFFD36A).copy(alpha = .82f)
        } else {
            Color.White.copy(alpha = .34f)
        },
        pressedScale = .91f,
        liftedElevation = 2.dp,
    ) {
        Box(
            modifier = Modifier.size(40.dp),
            contentAlignment = Alignment.Center,
        ) {
            GlassGlareOverlay(
                tilt = tilt,
                radius = 20.dp,
                intensity = if (selected) .56f else .40f,
            )
            content()
        }
    }
}
