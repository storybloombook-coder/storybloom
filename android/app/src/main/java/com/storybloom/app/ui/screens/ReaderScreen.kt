package com.storybloom.app.ui.screens

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.storybloom.app.data.BookBundle
import com.storybloom.app.data.Cue
import com.storybloom.app.data.PageWithCues
import com.storybloom.app.data.TrimEnvelope
import com.storybloom.app.reader.AlignmentUpdate
import com.storybloom.app.reader.ReaderAligner
import com.storybloom.app.speech.RecognizedWord
import com.storybloom.app.speech.SpeechCallbacks
import com.storybloom.app.speech.VoskRecognizer
import com.storybloom.app.speech.speechWords
import com.storybloom.app.ui.StorybloomViewModel
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.components.NativeImage
import com.storybloom.app.ui.text
import com.storybloom.app.ui.theme.BloomBlue
import com.storybloom.app.ui.theme.BloomCoral
import com.storybloom.app.ui.theme.BloomGreen
import com.storybloom.app.ui.theme.BloomYellow
import kotlinx.coroutines.launch

@Composable
fun ReaderScreen(
    viewModel: StorybloomViewModel,
    bookId: String,
    locale: UiLocale,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val activity = context as Activity
    val scope = rememberCoroutineScope()
    val revision by viewModel.repository.revision.collectAsState()
    var bundle by remember(bookId) { mutableStateOf<BookBundle?>(null) }
    var loading by remember { mutableStateOf(true) }
    var pageIndex by remember { mutableIntStateOf(0) }
    var cursorWord by remember { mutableIntStateOf(-1) }
    var listening by remember { mutableStateOf(false) }
    var loadingSpeech by remember { mutableStateOf(false) }
    var finished by remember(bookId) { mutableStateOf(false) }
    var lastPageCommand by remember { mutableLongStateOf(0L) }
    val recognizer = remember { VoskRecognizer(viewModel.modelManager) }

    LaunchedEffect(bookId, revision) {
        loading = true
        bundle = viewModel.repository.getBundle(bookId)
        loading = false
    }
    val readablePages = bundle?.pages?.filter { it.page.pageType.isReadable }.orEmpty()
    if (pageIndex > readablePages.lastIndex && readablePages.isNotEmpty()) pageIndex = readablePages.lastIndex
    val active = readablePages.getOrNull(pageIndex)
    val aligner = remember(active?.page?.id, active?.page?.ocrText, active?.cues) {
        active?.let { ReaderAligner(it.page.ocrText, it.cues) }
    }
    val currentAligner by rememberUpdatedState(aligner)
    val currentActive by rememberUpdatedState(active)
    val currentPageIndex by rememberUpdatedState(pageIndex)
    val currentReadablePages by rememberUpdatedState(readablePages)

    fun playCue(cue: Cue) {
        val id = cue.soundId ?: return
        viewModel.audioEngine.duckAmbient()
        viewModel.audioEngine.playEffect(
            TrimEnvelope(id, cue.soundStartMs, cue.soundEndMs, cue.fadeInMs, cue.fadeOutMs),
        )
    }

    fun applyUpdates(updates: List<AlignmentUpdate>) {
        if (updates.isEmpty()) return
        cursorWord = updates.last().wordIndex
        updates.mapNotNull(AlignmentUpdate::cue).forEach(::playCue)
    }

    fun advancePage() {
        if (pageIndex < readablePages.lastIndex) {
            pageIndex += 1
            cursorWord = -1
        } else if (readablePages.isNotEmpty()) {
            finished = true
        }
    }

    fun handleNextPagePhrase(text: String): Boolean {
        val normalized = text.lowercase()
        val phrase = if (bundle?.book?.language == com.storybloom.app.data.BookLanguage.RUSSIAN) {
            "следующая страница"
        } else {
            "next page"
        }
        if (!normalized.contains(phrase)) return false
        val now = SystemClock.uptimeMillis()
        if (now - lastPageCommand < 1_200L) return true
        lastPageCommand = now
        advancePage()
        return true
    }

    fun stopSpeech() {
        listening = false
        scope.launch { recognizer.stop() }
    }

    fun startSpeech() {
        val loadedBundle = bundle ?: return
        loadingSpeech = true
        val vocabulary = loadedBundle.pages
            .flatMap { speechWords(it.page.ocrText) }
            .plus(
                if (loadedBundle.book.language == com.storybloom.app.data.BookLanguage.RUSSIAN) {
                    listOf("следующая", "страница")
                } else {
                    listOf("next", "page")
                },
            )
        scope.launch {
            viewModel.runOperation {
                recognizer.start(
                    language = loadedBundle.book.language,
                    vocabulary = vocabulary,
                    callbacks = object : SpeechCallbacks {
                        override fun onPartial(text: String) {
                            activity.runOnUiThread {
                                if (!handleNextPagePhrase(text)) {
                                    currentAligner?.onPartial(text)?.let(::applyUpdates)
                                }
                            }
                        }

                        override fun onResult(text: String, words: List<RecognizedWord>) {
                            activity.runOnUiThread {
                                if (!handleNextPagePhrase(text)) {
                                    val updates = if (words.isEmpty()) {
                                        currentAligner?.onFinalText(text)
                                    } else {
                                        currentAligner?.onFinal(words)
                                    }
                                    updates?.let(::applyUpdates)
                                }
                            }
                        }

                        override fun onError(message: String) {
                            activity.runOnUiThread {
                                listening = false
                                loadingSpeech = false
                                viewModel.notify(message)
                            }
                        }
                    },
                )
                listening = true
            }
            loadingSpeech = false
        }
    }

    val microphonePermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) startSpeech()
        else viewModel.notify(locale.text("Microphone permission was denied.", "Нет доступа к микрофону."))
    }

    LaunchedEffect(active?.page?.id, finished) {
        cursorWord = -1
        viewModel.audioEngine.stopAmbient(immediate = true)
        if (finished) return@LaunchedEffect
        val page = active?.page ?: return@LaunchedEffect
        viewModel.audioEngine.prewarm(active.cues.mapNotNull(Cue::soundId))
        page.ambientSoundId?.let { id ->
            viewModel.audioEngine.playAmbient(
                TrimEnvelope(
                    id,
                    page.ambientStartMs,
                    page.ambientEndMs,
                    page.ambientFadeInMs,
                    page.ambientFadeOutMs,
                ),
            )
        }
    }

    LaunchedEffect(finished) {
        if (finished) {
            listening = false
            recognizer.stop()
            viewModel.audioEngine.stopAmbient(immediate = true)
        }
    }

    DisposableEffect(activity) {
        val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
        onDispose {
            controller.show(WindowInsetsCompat.Type.systemBars())
            recognizer.closeNow()
            viewModel.audioEngine.stopAmbient(immediate = true)
        }
    }

    when {
        loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        bundle == null || readablePages.isEmpty() -> Box(
            Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(locale.text("No story pages to read", "Нет страниц для чтения"))
                IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, contentDescription = "Close") }
            }
        }
        finished -> ReaderFinished(
            title = bundle?.book?.title,
            locale = locale,
            onReadAgain = {
                aligner?.reset()
                cursorWord = -1
                pageIndex = 0
                finished = false
            },
            onDone = onClose,
        )
        active != null && aligner != null -> ReaderPage(
            active = active,
            pageIndex = pageIndex,
            pageCount = readablePages.size,
            cursorWord = cursorWord,
            aligner = aligner,
            locale = locale,
            listening = listening,
            loadingSpeech = loadingSpeech,
            onClose = onClose,
            onPrevious = {
                if (pageIndex > 0) {
                    pageIndex -= 1
                    cursorWord = -1
                }
            },
            onNext = ::advancePage,
            onMicrophone = {
                when {
                    listening -> stopSpeech()
                    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                        PackageManager.PERMISSION_GRANTED -> startSpeech()
                    else -> microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
                }
            },
            onWord = { wordIndex, cue ->
                aligner.moveManually(wordIndex)
                cursorWord = wordIndex
                cue?.let(::playCue)
            },
        )
    }
}

@Composable
private fun ReaderPage(
    active: PageWithCues,
    pageIndex: Int,
    pageCount: Int,
    cursorWord: Int,
    aligner: ReaderAligner,
    locale: UiLocale,
    listening: Boolean,
    loadingSpeech: Boolean,
    onClose: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onMicrophone: () -> Unit,
    onWord: (Int, Cue?) -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF14283D), Color(0xFF0B1521)),
                ),
            ),
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(
                Modifier.fillMaxWidth().weight(.54f),
                contentAlignment = Alignment.Center,
            ) {
                if (active.page.imagePath.isNotBlank()) {
                    NativeImage(
                        active.page.imagePath,
                        Modifier.fillMaxSize(),
                        contentScale = ContentScale.Fit,
                        maxEdge = 1900,
                    )
                } else {
                    Box(
                        Modifier.fillMaxSize().background(
                            Brush.radialGradient(
                                listOf(BloomBlue.copy(alpha = .7f), Color(0xFF14283D)),
                            ),
                        ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Rounded.GraphicEq,
                            contentDescription = null,
                            tint = Color.White.copy(alpha = .45f),
                            modifier = Modifier.size(86.dp),
                        )
                    }
                }
                Row(
                    Modifier
                        .align(Alignment.TopCenter)
                        .fillMaxWidth()
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    FilledIconButton(onClick = onClose) {
                        Icon(Icons.Rounded.Close, contentDescription = "Close")
                    }
                    Surface(
                        color = Color.Black.copy(alpha = .58f),
                        contentColor = Color.White,
                        shape = RoundedCornerShape(99.dp),
                    ) {
                        Text(
                            locale.text(
                                "Page ${pageIndex + 1} of $pageCount",
                                "Страница ${pageIndex + 1} из $pageCount",
                            ),
                            modifier = Modifier.padding(horizontal = 13.dp, vertical = 8.dp),
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
                ListeningStatusPill(
                    listening = listening,
                    loading = loadingSpeech,
                    locale = locale,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 12.dp),
                )
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .weight(.46f)
                    .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)),
            ) {
                Column(
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 110.dp),
                ) {
                    ReaderWords(
                        active = active,
                        aligner = aligner,
                        cursor = cursorWord,
                        onWord = onWord,
                    )
                }
                ReadingBall(
                    currentWord = aligner.script.getOrNull(cursorWord)?.display,
                    modifier = Modifier.align(Alignment.BottomStart).padding(start = 22.dp, bottom = 88.dp),
                )
            }
        }
        Row(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .systemBarsPadding()
                .padding(horizontal = 18.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FilledIconButton(onClick = onPrevious, enabled = pageIndex > 0, modifier = Modifier.size(56.dp)) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Previous page")
            }
            FilledIconButton(
                onClick = onMicrophone,
                enabled = !loadingSpeech,
                modifier = Modifier.size(66.dp),
            ) {
                if (loadingSpeech) {
                    CircularProgressIndicator(Modifier.size(26.dp), color = Color.White, strokeWidth = 2.dp)
                } else {
                    Icon(
                        if (listening) Icons.Rounded.Stop else Icons.Rounded.Mic,
                        contentDescription = if (listening) {
                            locale.text("Stop listening", "Остановить прослушивание")
                        } else {
                            locale.text("Start listening", "Начать прослушивание")
                        },
                        modifier = Modifier.size(30.dp),
                    )
                }
            }
            FilledIconButton(onClick = onNext, modifier = Modifier.size(56.dp)) {
                Icon(
                    if (pageIndex == pageCount - 1) Icons.Rounded.Check else Icons.AutoMirrored.Rounded.ArrowForward,
                    contentDescription = if (pageIndex == pageCount - 1) {
                        locale.text("Finish", "Завершить")
                    } else {
                        locale.text("Next page", "Следующая страница")
                    },
                )
            }
        }
    }
}

@Composable
private fun ListeningStatusPill(
    listening: Boolean,
    loading: Boolean,
    locale: UiLocale,
    modifier: Modifier = Modifier,
) {
    val accent = when {
        loading -> BloomYellow
        listening -> BloomGreen
        else -> Color(0xFF9A9AA0)
    }
    val label = when {
        loading -> locale.text("Starting microphone…", "Запускаю микрофон…")
        listening -> locale.text("Listening", "Слушаю")
        else -> locale.text("Microphone paused", "Микрофон выключен")
    }
    Surface(
        modifier = modifier,
        color = Color.Black.copy(alpha = .66f),
        contentColor = Color.White,
        shape = RoundedCornerShape(99.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, accent.copy(alpha = .82f)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(8.dp).background(accent, CircleShape))
            Text(label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ReaderWords(
    active: PageWithCues,
    aligner: ReaderAligner,
    cursor: Int,
    onWord: (Int, Cue?) -> Unit,
) {
    val cueByIndex = remember(active.cues, aligner.script) {
        aligner.script.indices.associateWith { index ->
            val word = aligner.script[index]
            active.cues.firstOrNull { cue ->
                cue.isActive && cue.charStart != null && cue.charEnd != null &&
                    word.charStart < cue.charEnd && word.charEnd > cue.charStart
            }
        }
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        aligner.script.forEachIndexed { index, word ->
            val cue = cueByIndex[index]
            Text(
                word.display,
                modifier = Modifier
                    .clip(RoundedCornerShape(7.dp))
                    .background(
                        when {
                            index == cursor -> BloomYellow.copy(alpha = .72f)
                            index < cursor -> BloomYellow.copy(alpha = .30f)
                            cue?.soundId != null -> BloomBlue.copy(alpha = .16f)
                            else -> Color.Transparent
                        },
                    )
                    .clickable { onWord(index, cue) }
                    .padding(horizontal = 3.dp, vertical = 3.dp),
                fontSize = 22.sp,
                lineHeight = 34.sp,
                fontWeight = when {
                    index == cursor -> FontWeight.ExtraBold
                    index < cursor -> FontWeight.Medium
                    else -> FontWeight.Normal
                },
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun ReadingBall(
    currentWord: String?,
    modifier: Modifier = Modifier,
) {
    if (currentWord == null) return
    val transition = rememberInfiniteTransition(label = "reading ball")
    val bounce by transition.animateFloat(
        initialValue = 0f,
        targetValue = -12f,
        animationSpec = infiniteRepeatable(tween(560), RepeatMode.Reverse),
        label = "bounce",
    )
    Row(
        modifier = modifier
            .offset(y = bounce.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(
            Modifier
                .size(35.dp)
                .background(BloomCoral, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(9.dp).background(Color.White, CircleShape))
        }
        Surface(
            color = BloomCoral.copy(alpha = .14f),
            shape = RoundedCornerShape(99.dp),
        ) {
            Text(
                currentWord,
                modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                color = BloomCoral,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun ReaderFinished(
    title: String?,
    locale: UiLocale,
    onReadAgain: () -> Unit,
    onDone: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF14283D), Color(0xFF0B1521)),
                ),
            )
            .systemBarsPadding()
            .padding(28.dp),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(28.dp),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 30.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    modifier = Modifier
                        .size(68.dp)
                        .background(BloomGreen.copy(alpha = .16f), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Rounded.Check,
                        contentDescription = null,
                        tint = BloomGreen,
                        modifier = Modifier.size(36.dp),
                    )
                }
                Spacer(Modifier.height(18.dp))
                Text(
                    locale.text("The End", "Конец"),
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.ExtraBold,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    if (title.isNullOrBlank()) {
                        locale.text(
                            "You finished the story.",
                            "Вы дочитали историю.",
                        )
                    } else {
                        locale.text(
                            "You finished “$title”.",
                            "Вы дочитали «$title».",
                        )
                    },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    fontSize = 16.sp,
                )
                Spacer(Modifier.height(26.dp))
                Button(
                    onClick = onReadAgain,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Icon(Icons.Rounded.Replay, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text(
                        locale.text("Read Again", "Прочитать снова"),
                        fontWeight = FontWeight.Bold,
                    )
                }
                Spacer(Modifier.height(10.dp))
                OutlinedButton(
                    onClick = onDone,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text(locale.text("Done", "Готово"), fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
