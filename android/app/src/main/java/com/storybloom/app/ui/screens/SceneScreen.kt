package com.storybloom.app.ui.screens

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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.RotateRight
import androidx.compose.material.icons.rounded.CenterFocusStrong
import androidx.compose.material.icons.rounded.NearMe
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.storybloom.app.StorybloomApplication
import com.storybloom.app.data.TrimEnvelope
import com.storybloom.app.scene.CrossroadsAction
import com.storybloom.app.scene.SceneInteraction
import com.storybloom.app.scene.SceneMotion
import com.storybloom.app.scene.SceneWeather
import com.storybloom.app.scene.StorySceneView
import com.storybloom.app.ui.UiLocale
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
    val audioEngine = (context.applicationContext as StorybloomApplication).audioEngine
    var sceneView by remember { mutableStateOf<StorySceneView?>(null) }
    var playing by remember { mutableStateOf(true) }
    var rotating by remember { mutableStateOf(false) }
    var following by remember { mutableStateOf(false) }
    var storySeconds by remember { mutableIntStateOf(0) }
    var interactionLine by remember { mutableStateOf<String?>(null) }
    var interactionSequence by remember { mutableIntStateOf(0) }
    var foxEndingSequence by remember { mutableIntStateOf(0) }
    val foxEndingFade = remember { Animatable(0f) }
    var discoveries by remember { mutableStateOf(emptySet<SceneInteraction>()) }
    val lifecycleOwner = LocalLifecycleOwner.current
    var lifecycleResumed by remember(lifecycleOwner) {
        mutableStateOf(
            lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED),
        )
    }
    val chapterSeconds = (storySeconds - SceneMotion.INTRO_SECONDS.toInt()).coerceAtLeast(0)
    val chapter = (chapterSeconds / SceneMotion.CHAPTER_SECONDS) % 5
    val chapterTitle = if (storySeconds < SceneMotion.INTRO_SECONDS.toInt()) {
        locale.text("The crossroads", "У перекрёстка")
    } else {
        listOf(
            locale.text("The old izba", "Старая избушка"),
            locale.text("The hare’s meadow", "Заячья поляна"),
            locale.text("The wolf’s pines", "Волчьи сосны"),
            locale.text("The bear’s grove", "Медвежья роща"),
            locale.text("The fox’s clearing", "Лисья полянка"),
        )[chapter]
    }
    val storyLine = if (storySeconds < SceneMotion.INTRO_SECONDS.toInt()) {
        locale.text(
            "Five paths meet beneath an old mossy stone.",
            "Пять тропинок сходятся у старого замшелого камня.",
        )
    } else {
        listOf(
            locale.text(
                "Off rolled Kolobok, bright as the sun.",
                "Покатился Колобок, румяный, словно солнце.",
            ),
            locale.text(
                "The hare pricked up both ears.",
                "Заяц навострил оба уха.",
            ),
            locale.text(
                "A gray wolf stepped onto the path.",
                "Серый волк вышел на тропинку.",
            ),
            locale.text(
                "The bear listened to Kolobok’s song.",
                "Медведь заслушался песенкой Колобка.",
            ),
            locale.text(
                "The fox waited in the warm grass.",
                "Лиса ждала в тёплой траве.",
            ),
        )[chapter]
    }
    val countedDiscoveries = setOf(
        SceneInteraction.GRANDPA_FISHING,
        SceneInteraction.CHIMNEY_SMOKE,
        SceneInteraction.MAGPIES,
        SceneInteraction.CLOUD_RAIN,
        SceneInteraction.HEDGEHOG,
        SceneInteraction.OWL_WAKE,
        SceneInteraction.MOON_WINK,
        SceneInteraction.FOX_TRUE_ENDING,
    )

    fun respondTo(interaction: SceneInteraction) {
        val (line, sound) = when (interaction) {
            SceneInteraction.GRANDPA_FISHING -> locale.text(
                "Grandpa's line tugs—what a catch!",
                "У дедушки клюёт — вот это улов!",
            ) to "fx_splash"
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
            SceneInteraction.MEADOW_BLOOM -> locale.text(
                "The meadow answers with a little bloom.",
                "Полянка ответила маленьким цветением.",
            ) to "fx_magic"
            SceneInteraction.PATH_SPARKLE -> locale.text(
                "Golden footprints sparkle on the story path.",
                "На сказочной тропинке вспыхнули золотые следы.",
            ) to "fx_sparkle"
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
        }
        if (interaction == SceneInteraction.FOX_TRUE_ENDING) {
            foxEndingSequence += 1
        }
        interactionLine = line
        interactionSequence += 1
        audioEngine.preview(sound)
    }

    LaunchedEffect(sceneView, lifecycleResumed) {
        while (lifecycleResumed) {
            storySeconds = sceneView?.storyTimeSeconds() ?: storySeconds
            delay(250)
        }
    }

    LaunchedEffect(interactionSequence) {
        if (interactionSequence == 0) return@LaunchedEffect
        val sequence = interactionSequence
        delay(3_800)
        if (interactionSequence == sequence) interactionLine = null
    }

    LaunchedEffect(foxEndingSequence) {
        if (foxEndingSequence == 0) return@LaunchedEffect
        foxEndingFade.snapTo(0f)
        delay(1_100)
        foxEndingFade.animateTo(1f, tween(400))
        delay(400)
        foxEndingFade.animateTo(0f, tween(600))
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

    Box(Modifier.fillMaxSize()) {
        AndroidView(
            factory = { context ->
                StorySceneView(context).also { sceneView = it }
            },
            modifier = Modifier.fillMaxSize(),
            update = { view ->
                view.setStoryPlaying(playing)
                view.setSceneRotationEnabled(rotating)
                view.setFollowKolobok(following)
                view.setWeather(SceneWeather.CLEAR)
                view.setRockMenuLanguage(locale == UiLocale.RUSSIAN)
                view.onCrossroadsAction = { action ->
                    when (action) {
                        CrossroadsAction.ADD_BOOK -> onAddBook()
                        CrossroadsAction.CREATE_STORY -> onCreateStory()
                        CrossroadsAction.LIBRARY -> onLibrary()
                    }
                }
                view.onSceneInteraction = ::respondTo
            },
        )

        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = foxEndingFade.value)),
        )

        Column(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .systemBarsPadding()
                .padding(top = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Surface(
                color = Color.Black.copy(alpha = .28f),
                contentColor = Color.White,
                shape = RoundedCornerShape(999.dp),
            ) {
                Text(
                    chapterTitle,
                    modifier = Modifier.padding(horizontal = 15.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            AnimatedVisibility(
                visible = storySeconds < SceneMotion.INTRO_SECONDS.toInt() ||
                    chapterSeconds % SceneMotion.CHAPTER_SECONDS in 2..6,
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                Surface(
                    color = Color(0xFFF9F1DE).copy(alpha = .92f),
                    contentColor = Color(0xFF3A2C1A),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text(
                        storyLine,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }

        Surface(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .systemBarsPadding()
                .padding(top = 14.dp, end = 14.dp)
                .semantics {
                    contentDescription = locale.text(
                        "${discoveries.size} of 8 discoveries",
                        "Открыто ${discoveries.size} из 8 секретов",
                    )
                },
            color = Color.Black.copy(alpha = .26f),
            contentColor = Color(0xFFFFE59A),
            shape = RoundedCornerShape(999.dp),
        ) {
            Text(
                "${discoveries.size}/8 ✦",
                modifier = Modifier.padding(horizontal = 11.dp, vertical = 7.dp),
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
            )
        }

        AnimatedVisibility(
            visible = interactionLine != null,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .systemBarsPadding()
                .padding(start = 72.dp, end = 72.dp, bottom = 164.dp),
            enter = fadeIn(),
            exit = fadeOut(),
        ) {
            Surface(
                color = Color(0xFFF9F1DE).copy(alpha = .94f),
                contentColor = Color(0xFF3A2C1A),
                shape = RoundedCornerShape(16.dp),
            ) {
                Text(
                    interactionLine.orEmpty(),
                    modifier = Modifier.padding(horizontal = 15.dp, vertical = 10.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                )
            }
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .systemBarsPadding()
                .padding(start = 14.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FollowSceneButton(
                label = if (following) {
                    locale.text("FOLLOWING", "СЛЕЖУ")
                } else {
                    locale.text("FOLLOW", "СЛЕДИТЬ")
                },
                contentDescription = if (following) {
                    locale.text("Stop following Kolobok", "Перестать следить за Колобком")
                } else {
                    locale.text("Follow Kolobok", "Следить за Колобком")
                },
                selected = following,
                onClick = { following = !following },
            )
            GlassSceneButton(
                contentDescription = locale.text("Change language", "Сменить язык"),
                onClick = {
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
                contentDescription = locale.text("Return to the menu", "Вернуться в меню"),
                onClick = onBack,
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
                contentDescription = locale.text("Reset view", "Вернуть вид"),
                onClick = { sceneView?.resetCamera() },
            ) {
                Icon(
                    Icons.Rounded.CenterFocusStrong,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(21.dp),
                )
            }
            GlassSceneButton(
                contentDescription = locale.text("Turn the story world", "Вращать мир сказки"),
                selected = rotating,
                onClick = { rotating = !rotating },
            ) {
                Icon(
                    Icons.AutoMirrored.Rounded.RotateRight,
                    contentDescription = null,
                    tint = if (rotating) Color(0xFFFFD36A) else Color.White,
                    modifier = Modifier.size(22.dp),
                )
            }
            GlassSceneButton(
                contentDescription = if (playing) {
                    locale.text("Pause the story", "Поставить сказку на паузу")
                } else {
                    locale.text("Continue the story", "Продолжить сказку")
                },
                onClick = { playing = !playing },
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
}

@Composable
private fun FollowSceneButton(
    label: String,
    contentDescription: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(999.dp)
    val outlineColor = if (selected) {
        Color(0xFFFFD36A).copy(alpha = .90f)
    } else {
        Color.White.copy(alpha = .38f)
    }
    Surface(
        modifier = Modifier
            .width(140.dp)
            .height(40.dp)
            .border(1.dp, outlineColor, shape),
        color = if (selected) {
            Color(0xFF765B24).copy(alpha = .88f)
        } else {
            Color.Black.copy(alpha = .38f)
        },
        contentColor = if (selected) Color(0xFFFFE59A) else Color.White,
        shape = shape,
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .clickable(onClick = onClick)
                .semantics { this.contentDescription = contentDescription }
                .padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Rounded.NearMe,
                contentDescription = null,
                modifier = Modifier.size(17.dp),
            )
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.ExtraBold,
            )
        }
    }
}

@Composable
private fun GlassSceneButton(
    contentDescription: String,
    onClick: () -> Unit,
    selected: Boolean = false,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = Modifier
            .size(40.dp)
            .border(
                width = 1.dp,
                color = if (selected) {
                    Color(0xFFFFD36A).copy(alpha = .82f)
                } else {
                    Color.White.copy(alpha = .34f)
                },
                shape = CircleShape,
            ),
        color = Color.Black.copy(alpha = .32f),
        contentColor = Color.White,
        shape = CircleShape,
    ) {
        IconButton(
            onClick = onClick,
            modifier = Modifier
                .size(40.dp)
                .semantics { this.contentDescription = contentDescription },
        ) {
            Box(
                modifier = Modifier.size(40.dp),
                contentAlignment = Alignment.Center,
            ) {
                content()
            }
        }
    }
}
