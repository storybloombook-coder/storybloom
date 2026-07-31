package com.storybloom.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.storybloom.app.data.BookLanguage
import com.storybloom.app.speech.RecognizedWord
import com.storybloom.app.speech.SpeechCallbacks
import com.storybloom.app.speech.VoskRecognizer
import com.storybloom.app.ui.StorybloomViewModel
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.components.BloomPrimaryButton
import com.storybloom.app.ui.components.PulsingStoryDot
import com.storybloom.app.ui.components.StoryScaffold
import com.storybloom.app.ui.text
import com.storybloom.app.ui.theme.BloomCoral
import com.storybloom.app.ui.theme.BloomGreen
import kotlinx.coroutines.launch

private enum class CreateStoryPhase {
    SETUP,
    WRITING,
}

@Composable
fun CreateStoryScreen(
    viewModel: StorybloomViewModel,
    locale: UiLocale,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val recognizer = remember { VoskRecognizer(viewModel.modelManager) }

    var phase by remember { mutableStateOf(CreateStoryPhase.SETUP) }
    var title by remember { mutableStateOf("") }
    var language by remember { mutableStateOf(BookLanguage.ENGLISH) }
    var savedPages by remember { mutableStateOf(emptyList<String>()) }
    var draft by remember { mutableStateOf("") }
    var partial by remember { mutableStateOf("") }
    var listening by remember { mutableStateOf(false) }
    var preparingDictation by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var recognitionSession by remember { mutableStateOf(0) }

    fun notifyDictationUnavailable() {
        viewModel.notify(
            locale.text(
                "Dictation is unavailable right now. You can keep typing or try again.",
                "Диктовка сейчас недоступна. Можно продолжить печатать или попробовать ещё раз.",
            ),
        )
    }

    fun stopListening(commitPartial: Boolean = true) {
        if (commitPartial && partial.isNotBlank()) {
            draft = appendSpokenText(draft, partial)
        }
        recognitionSession += 1
        listening = false
        partial = ""
        scope.launch { recognizer.stop() }
    }

    fun startListening() {
        if (listening || preparingDictation || saving) return

        recognitionSession += 1
        val session = recognitionSession
        preparingDictation = true
        scope.launch {
            try {
                recognizer.start(
                    language = language,
                    callbacks = object : SpeechCallbacks {
                        override fun onPartial(text: String) {
                            scope.launch {
                                if (session == recognitionSession) partial = text
                            }
                        }

                        override fun onResult(text: String, words: List<RecognizedWord>) {
                            scope.launch {
                                if (session == recognitionSession) {
                                    draft = appendSpokenText(draft, text)
                                    partial = ""
                                }
                            }
                        }

                        override fun onError(message: String) {
                            scope.launch {
                                if (session == recognitionSession) {
                                    listening = false
                                    preparingDictation = false
                                    partial = ""
                                    notifyDictationUnavailable()
                                }
                            }
                        }
                    },
                )
                if (session == recognitionSession) listening = true
            } catch (_: Throwable) {
                if (session == recognitionSession) {
                    listening = false
                    partial = ""
                    notifyDictationUnavailable()
                }
            } finally {
                if (session == recognitionSession) preparingDictation = false
            }
        }
    }

    val microphonePermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            startListening()
        } else {
            viewModel.notify(
                locale.text(
                    "Microphone access is needed for dictation.",
                    "Для диктовки нужен доступ к микрофону.",
                ),
            )
        }
    }

    fun requestDictation() {
        if (
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            startListening()
        } else {
            microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    fun clearCurrentPage() {
        if (listening) stopListening(commitPartial = false)
        draft = ""
        partial = ""
    }

    fun addPageAndContinue() {
        if (listening) stopListening()
        val pageText = draft.trim()
        if (pageText.isBlank()) {
            viewModel.notify(
                locale.text(
                    "Write or dictate something for this page first.",
                    "Сначала напишите или продиктуйте текст этой страницы.",
                ),
            )
            return
        }
        savedPages = savedPages + pageText
        draft = ""
        partial = ""
    }

    fun finishStory() {
        if (saving) return
        if (listening) stopListening()

        val finalPage = draft.trim()
        val pagesToSave = if (finalPage.isBlank()) savedPages else savedPages + finalPage
        if (pagesToSave.isEmpty()) {
            viewModel.notify(
                locale.text(
                    "Write or dictate at least one page.",
                    "Напишите или продиктуйте хотя бы одну страницу.",
                ),
            )
            return
        }

        saving = true
        scope.launch {
            viewModel.createDictatedBook(
                title = title.trim(),
                language = language,
                text = pagesToSave.joinToString("\n\n"),
            )
            saving = false
        }
    }

    DisposableEffect(Unit) {
        onDispose { recognizer.closeNow() }
    }

    StoryScaffold(
        title = locale.text("Create a story", "Создать историю"),
        onBack = onBack,
        snackbarHostState = snackbarHostState,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            when (phase) {
                CreateStoryPhase.SETUP -> {
                    SetupPhase(
                        locale = locale,
                        title = title,
                        onTitleChange = { title = it },
                        language = language,
                        onLanguageChange = { language = it },
                        onStart = {
                            if (title.isBlank()) {
                                viewModel.notify(
                                    locale.text(
                                        "Give your story a title first.",
                                        "Сначала придумайте название истории.",
                                    ),
                                )
                            } else {
                                phase = CreateStoryPhase.WRITING
                            }
                        },
                    )
                }

                CreateStoryPhase.WRITING -> {
                    WritingPhase(
                        locale = locale,
                        pageNumber = savedPages.size + 1,
                        savedPageCount = savedPages.size,
                        draft = draft,
                        onDraftChange = { draft = it },
                        partial = partial,
                        listening = listening,
                        preparingDictation = preparingDictation,
                        saving = saving,
                        onToggleDictation = {
                            if (listening) stopListening() else requestDictation()
                        },
                        onClearPage = ::clearCurrentPage,
                        onAddPage = ::addPageAndContinue,
                        onFinish = ::finishStory,
                    )
                }
            }
        }
    }
}

@Composable
private fun SetupPhase(
    locale: UiLocale,
    title: String,
    onTitleChange: (String) -> Unit,
    language: BookLanguage,
    onLanguageChange: (BookLanguage) -> Unit,
    onStart: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = locale.text("Create your story", "Создайте свою историю"),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = locale.text(
                "Name it, choose a language, then tell it one page at a time.",
                "Придумайте название, выберите язык и рассказывайте историю по одной странице.",
            ),
            modifier = Modifier.padding(bottom = 8.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        OutlinedTextField(
            value = title,
            onValueChange = onTitleChange,
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text(locale.text("Story title", "Название истории")) },
            shape = RoundedCornerShape(12.dp),
        )
        Text(
            text = locale.text("Story language", "Язык истории"),
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            fontWeight = FontWeight.SemiBold,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            LanguageChoice(
                text = locale.text("English", "Английский"),
                selected = language == BookLanguage.ENGLISH,
                onClick = { onLanguageChange(BookLanguage.ENGLISH) },
                modifier = Modifier.weight(1f),
            )
            LanguageChoice(
                text = locale.text("Russian", "Русский"),
                selected = language == BookLanguage.RUSSIAN,
                onClick = { onLanguageChange(BookLanguage.RUSSIAN) },
                modifier = Modifier.weight(1f),
            )
        }
        BloomPrimaryButton(
            text = locale.text("Start dictating", "Начать диктовку"),
            onClick = onStart,
            modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
            color = BloomCoral,
            leading = { Icon(Icons.Rounded.Mic, contentDescription = null) },
        )
    }
}

@Composable
private fun LanguageChoice(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val accent = MaterialTheme.colorScheme.primary
    OutlinedButton(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(
            width = if (selected) 1.5.dp else 1.dp,
            color = if (selected) accent else MaterialTheme.colorScheme.outline,
        ),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = if (selected) accent.copy(alpha = .12f) else MaterialTheme.colorScheme.surface,
            contentColor = if (selected) accent else MaterialTheme.colorScheme.onSurface,
        ),
    ) {
        Text(text, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun WritingPhase(
    locale: UiLocale,
    pageNumber: Int,
    savedPageCount: Int,
    draft: String,
    onDraftChange: (String) -> Unit,
    partial: String,
    listening: Boolean,
    preparingDictation: Boolean,
    saving: Boolean,
    onToggleDictation: () -> Unit,
    onClearPage: () -> Unit,
    onAddPage: () -> Unit,
    onFinish: () -> Unit,
) {
    Text(
        text = locale.text("Page $pageNumber", "Страница $pageNumber"),
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontWeight = FontWeight.Bold,
        textAlign = TextAlign.Center,
    )
    OutlinedTextField(
        value = draft,
        onValueChange = onDraftChange,
        modifier = Modifier.fillMaxWidth().heightIn(min = 180.dp),
        enabled = !saving,
        label = { Text(locale.text("Page text", "Текст страницы")) },
        placeholder = {
            Text(
                locale.text(
                    "Tell or type this page…",
                    "Расскажите или напишите эту страницу…",
                ),
            )
        },
        shape = RoundedCornerShape(12.dp),
    )
    if (partial.isNotBlank()) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(12.dp),
        ) {
            Text(
                text = partial,
                modifier = Modifier.padding(12.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    if (listening) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PulsingStoryDot(color = BloomCoral)
            Text(
                text = locale.text("Listening…", "Слушаю…"),
                modifier = Modifier.padding(start = 8.dp),
                color = BloomCoral,
                fontWeight = FontWeight.Bold,
            )
        }
    }
    BloomPrimaryButton(
        text = when {
            preparingDictation -> locale.text("Preparing dictation…", "Подготовка диктовки…")
            listening -> locale.text("Stop dictation", "Остановить диктовку")
            else -> locale.text("Start dictation", "Начать диктовку")
        },
        onClick = onToggleDictation,
        modifier = Modifier.fillMaxWidth(),
        enabled = !preparingDictation && !saving,
        color = BloomCoral,
        leading = {
            if (preparingDictation) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = Color.White,
                    strokeWidth = 2.dp,
                )
            } else {
                Icon(
                    imageVector = if (listening) Icons.Rounded.Stop else Icons.Rounded.Mic,
                    contentDescription = null,
                )
            }
        },
    )
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        OutlinedButton(
            onClick = onClearPage,
            modifier = Modifier.weight(1f),
            enabled = !preparingDictation && !saving,
            shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = MaterialTheme.colorScheme.error,
            ),
        ) {
            Text(locale.text("Clear page", "Очистить страницу"))
        }
        OutlinedButton(
            onClick = onAddPage,
            modifier = Modifier.weight(1.35f),
            enabled = draft.isNotBlank() && !preparingDictation && !saving,
            shape = RoundedCornerShape(10.dp),
        ) {
            Text(locale.text("Add page & continue", "Добавить и продолжить"))
        }
    }
    Text(
        text = locale.text(
            "$savedPageCount pages saved",
            "Сохранено страниц: $savedPageCount",
        ),
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
    BloomPrimaryButton(
        text = if (saving) {
            locale.text("Saving story…", "Сохранение истории…")
        } else {
            locale.text("Finish story", "Завершить историю")
        },
        onClick = onFinish,
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
        enabled = !preparingDictation && !saving,
        color = BloomGreen,
        leading = {
            if (saving) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = Color.White,
                    strokeWidth = 2.dp,
                )
            }
        },
    )
}

private fun appendSpokenText(existing: String, spoken: String): String =
    listOf(existing.trimEnd(), spoken.trim())
        .filter(String::isNotBlank)
        .joinToString(" ")
