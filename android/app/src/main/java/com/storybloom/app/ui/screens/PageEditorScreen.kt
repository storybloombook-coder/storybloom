package com.storybloom.app.ui.screens

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoFixHigh
import androidx.compose.material.icons.rounded.Casino
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.CropRotate
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.RemoveCircleOutline
import androidx.compose.material.icons.rounded.Restore
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.storybloom.app.data.Book
import com.storybloom.app.data.Cue
import com.storybloom.app.data.CueDraft
import com.storybloom.app.data.CueReviewState
import com.storybloom.app.data.Page
import com.storybloom.app.data.PageType
import com.storybloom.app.data.TrimEnvelope
import com.storybloom.app.data.cueAtRange
import com.storybloom.app.data.tokenizeText
import com.storybloom.app.speech.RecognizedWord
import com.storybloom.app.speech.SpeechCallbacks
import com.storybloom.app.speech.VoskRecognizer
import com.storybloom.app.ui.StorybloomViewModel
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.components.BloomPrimaryButton
import com.storybloom.app.ui.components.NativeImage
import com.storybloom.app.ui.components.RecordingOrigin
import com.storybloom.app.ui.components.SoundPickerDialog
import com.storybloom.app.ui.components.SoundPickerMode
import com.storybloom.app.ui.components.StoryScaffold
import com.storybloom.app.ui.text
import com.storybloom.app.ui.theme.BloomBlue
import com.storybloom.app.ui.theme.BloomCoral
import com.storybloom.app.ui.theme.BloomGreen
import com.storybloom.app.ui.theme.BloomPurple
import com.storybloom.app.ui.theme.BloomYellow
import kotlinx.coroutines.launch
import java.util.Locale

private sealed interface SoundTarget {
    data object Ambient : SoundTarget
    data class CueTarget(val cue: Cue) : SoundTarget
}

@Composable
fun PageEditorScreen(
    viewModel: StorybloomViewModel,
    pageId: String,
    locale: UiLocale,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
) {
    val revision by viewModel.repository.revision.collectAsState()
    var page by remember(pageId) { mutableStateOf<Page?>(null) }
    var book by remember(pageId) { mutableStateOf<Book?>(null) }
    var cues by remember(pageId) { mutableStateOf<List<Cue>>(emptyList()) }
    var loading by remember(pageId) { mutableStateOf(true) }
    var editText by remember { mutableStateOf(false) }
    var textDraft by remember { mutableStateOf("") }
    var textDirty by remember { mutableStateOf(false) }
    var pickerTarget by remember { mutableStateOf<SoundTarget?>(null) }
    var rescanConfirm by remember { mutableStateOf(false) }
    var rescanning by remember { mutableStateOf(false) }
    var photoEditor by remember { mutableStateOf(false) }
    var dictateOpen by remember { mutableStateOf(false) }
    var applyAmbientConfirm by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    DisposableEffect(viewModel.audioEngine) {
        onDispose { viewModel.audioEngine.stopAmbient(immediate = true) }
    }

    LaunchedEffect(pageId, revision) {
        loading = true
        val loadedPage = viewModel.repository.getPage(pageId)
        page = loadedPage
        if (loadedPage != null) {
            book = viewModel.repository.getBook(loadedPage.bookId)
            cues = viewModel.repository.getCuesForPage(pageId)
            if (!textDirty) textDraft = loadedPage.ocrText
        }
        loading = false
    }

    val currentPage = page
    val currentBook = book
    StoryScaffold(
        title = if (currentPage == null) {
            locale.text("Page", "Страница")
        } else {
            locale.text("Page ${currentPage.pageNumber}", "Страница ${currentPage.pageNumber}")
        },
        onBack = onBack,
        snackbarHostState = snackbarHostState,
        actions = {
            if (textDirty && currentPage != null) {
                IconButton(
                    onClick = {
                        scope.launch {
                            saveCorrectedText(viewModel, currentPage, cues, textDraft)
                            textDirty = false
                        }
                    },
                ) { Icon(Icons.Rounded.Save, locale.text("Save text", "Сохранить текст")) }
            }
        },
    ) { padding ->
        when {
            loading -> Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }
            currentPage == null || currentBook == null -> Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { Text(locale.text("Page not found", "Страница не найдена")) }
            else -> LazyColumn(
                Modifier.fillMaxSize().padding(padding),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (currentPage.imagePath.isNotBlank()) {
                    item {
                        ZoomablePageImage(currentPage.imagePath)
                    }
                    item {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(9.dp),
                        ) {
                            OutlinedButton(
                                onClick = { photoEditor = true },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(16.dp),
                            ) {
                                Icon(Icons.Rounded.CropRotate, contentDescription = null)
                                Text(locale.text("Crop & rotate", "Кадрировать"))
                            }
                            OutlinedButton(
                                onClick = { rescanConfirm = true },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(16.dp),
                            ) {
                                Icon(Icons.Rounded.Refresh, contentDescription = null)
                                Text(locale.text("Re-scan", "Распознать"))
                            }
                        }
                    }
                }
                item {
                    PageTypePicker(
                        pageType = currentPage.pageType,
                        locale = locale,
                        onChange = { type ->
                            scope.launch { viewModel.repository.updatePageType(pageId, type) }
                        },
                    )
                }
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        shape = RoundedCornerShape(23.dp),
                    ) {
                        Column(
                            Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(11.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        locale.text("Story text", "Текст истории"),
                                        style = MaterialTheme.typography.titleLarge,
                                        fontWeight = FontWeight.ExtraBold,
                                    )
                                    Text(
                                        if (editText) {
                                            locale.text("Correct the recognized text", "Исправьте распознанный текст")
                                        } else {
                                            locale.text("Tap a word to attach a sound", "Нажмите слово, чтобы добавить звук")
                                        },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                IconButton(onClick = { editText = !editText }) {
                                    Icon(if (editText) Icons.Rounded.Check else Icons.Rounded.Edit, contentDescription = null)
                                }
                                IconButton(onClick = { dictateOpen = true }) {
                                    Icon(Icons.Rounded.Mic, locale.text("Dictate text", "Диктовать текст"))
                                }
                            }
                            if (editText) {
                                OutlinedTextField(
                                    value = textDraft,
                                    onValueChange = {
                                        textDraft = it
                                        textDirty = it != currentPage.ocrText
                                    },
                                    modifier = Modifier.fillMaxWidth().heightIn(min = 190.dp),
                                    placeholder = {
                                        Text(locale.text("Type the page text", "Введите текст страницы"))
                                    },
                                    shape = RoundedCornerShape(18.dp),
                                )
                                BloomPrimaryButton(
                                    text = locale.text("Save corrected text", "Сохранить исправления"),
                                    onClick = {
                                        scope.launch {
                                            saveCorrectedText(viewModel, currentPage, cues, textDraft)
                                            textDirty = false
                                            editText = false
                                        }
                                    },
                                    enabled = textDraft.isNotBlank(),
                                    modifier = Modifier.fillMaxWidth(),
                                    leading = { Icon(Icons.Rounded.Save, contentDescription = null) },
                                )
                            } else if (currentPage.ocrText.isBlank()) {
                                Text(
                                    locale.text(
                                        "No text recognized. Edit or dictate it above.",
                                        "Текст не распознан. Введите или продиктуйте его.",
                                    ),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontStyle = FontStyle.Italic,
                                )
                            } else {
                                WordCueText(
                                    text = currentPage.ocrText,
                                    cues = cues,
                                    onWord = { start, end, existing ->
                                        scope.launch {
                                            val cue = existing ?: viewModel.repository.addCue(
                                                pageId,
                                                CueDraft(
                                                    triggerText = currentPage.ocrText.substring(start, end),
                                                    contextPhrase = currentPage.ocrText.substring(
                                                        (start - 20).coerceAtLeast(0),
                                                        (end + 20).coerceAtMost(currentPage.ocrText.length),
                                                    ),
                                                    charStart = start,
                                                    charEnd = end,
                                                ),
                                            )
                                            pickerTarget = SoundTarget.CueTarget(cue)
                                        }
                                    },
                                )
                            }
                        }
                    }
                }
                item {
                    AmbientCard(
                        page = currentPage,
                        locale = locale,
                        onPick = { pickerTarget = SoundTarget.Ambient },
                        onPlay = {
                            val sound = currentPage.ambientSoundId ?: return@AmbientCard
                            viewModel.audioEngine.playAmbient(
                                TrimEnvelope(
                                    sound,
                                    currentPage.ambientStartMs,
                                    currentPage.ambientEndMs,
                                    currentPage.ambientFadeInMs,
                                    currentPage.ambientFadeOutMs,
                                ),
                            )
                        },
                        onStop = { viewModel.audioEngine.stopAmbient() },
                        onApplyAll = { applyAmbientConfirm = true },
                    )
                }
                item {
                    Text(
                        locale.text("Sound cues", "Звуковые метки"),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.ExtraBold,
                    )
                }
                if (cues.isEmpty()) {
                    item {
                        Text(
                            locale.text(
                                "Tap a word above to add the first sound.",
                                "Нажмите слово выше, чтобы добавить первый звук.",
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    }
                } else {
                    items(cues, key = { it.id }) { cue ->
                        CueCard(
                            cue = cue,
                            locale = locale,
                            onPick = { pickerTarget = SoundTarget.CueTarget(cue) },
                            onPlay = {
                                cue.soundId?.let {
                                    viewModel.audioEngine.playEffect(
                                        TrimEnvelope(
                                            it,
                                            cue.soundStartMs,
                                            cue.soundEndMs,
                                            cue.fadeInMs,
                                            cue.fadeOutMs,
                                        ),
                                    )
                                }
                            },
                            onLucky = {
                                val id = com.storybloom.app.audio.SoundLibrary.randomEffect(cue.soundId)
                                viewModel.audioEngine.preview(id)
                                scope.launch {
                                    viewModel.repository.updateCueSound(cue.id, TrimEnvelope(id))
                                }
                            },
                            onToggleRemoved = {
                                scope.launch {
                                    viewModel.repository.updateCueState(
                                        cue.id,
                                        if (cue.reviewState == CueReviewState.REMOVED) {
                                            CueReviewState.PROPOSED
                                        } else {
                                            CueReviewState.REMOVED
                                        },
                                    )
                                }
                            },
                        )
                    }
                }
                item { Spacer(Modifier.height(30.dp)) }
            }
        }
    }

    val target = pickerTarget
    if (target != null && currentPage != null && currentBook != null) {
        val currentId = when (target) {
            SoundTarget.Ambient -> currentPage.ambientSoundId
            is SoundTarget.CueTarget -> cues.firstOrNull { it.id == target.cue.id }?.soundId ?: target.cue.soundId
        }
        SoundPickerDialog(
            viewModel = viewModel,
            locale = locale,
            mode = if (target == SoundTarget.Ambient) SoundPickerMode.AMBIENT else SoundPickerMode.EFFECT,
            currentSoundId = currentId,
            origin = RecordingOrigin(
                currentBook,
                currentPage.pageNumber,
                if (target == SoundTarget.Ambient) "Ambient"
                else (target as SoundTarget.CueTarget).cue.triggerText,
            ),
            onDismiss = { pickerTarget = null },
            onChoose = { envelope ->
                scope.launch {
                    when (target) {
                        SoundTarget.Ambient -> viewModel.repository.updatePageAmbient(pageId, envelope)
                        is SoundTarget.CueTarget -> {
                            viewModel.repository.updateCueSound(target.cue.id, envelope)
                            if (envelope != null) {
                                viewModel.repository.updateCueState(target.cue.id, CueReviewState.CONFIRMED)
                            }
                        }
                    }
                    pickerTarget = null
                }
            },
        )
    }
    if (rescanConfirm && currentPage != null && currentBook != null) {
        AlertDialog(
            onDismissRequest = { rescanConfirm = false },
            title = { Text(locale.text("Re-scan this page?", "Распознать страницу заново?")) },
            text = {
                Text(
                    locale.text(
                        "Current text and automatically matched cues will be replaced.",
                        "Текущий текст и автоматически подобранные звуки будут заменены.",
                    ),
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !rescanning,
                    onClick = {
                        rescanConfirm = false
                        rescanning = true
                        scope.launch {
                            viewModel.runOperation {
                                val bitmap = requireNotNull(viewModel.imageStore.load(currentPage.imagePath))
                                val analysis = try {
                                    viewModel.preparationEngine.recognize(bitmap, currentBook.language)
                                } finally {
                                    bitmap.recycle()
                                }
                                viewModel.repository.replacePageAnalysis(pageId, analysis)
                            }
                            rescanning = false
                        }
                    },
                ) { Text(locale.text("Re-scan", "Распознать")) }
            },
            dismissButton = {
                TextButton(onClick = { rescanConfirm = false }) { Text(locale.text("Cancel", "Отмена")) }
            },
        )
    }
    if (rescanning) {
        AlertDialog(
            onDismissRequest = {},
            confirmButton = {},
            title = { Text(locale.text("Recognizing text…", "Распознавание текста…")) },
            text = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
                    Text(locale.text("This may take a moment.", "Это может занять немного времени."))
                }
            },
        )
    }
    if (photoEditor && currentPage != null && currentBook != null) {
        PhotoEditorDialog(
            viewModel = viewModel,
            page = currentPage,
            locale = locale,
            onDismiss = { photoEditor = false },
            onSaved = { path, rescan ->
                photoEditor = false
                scope.launch {
                    viewModel.repository.updatePageImage(pageId, path)
                    if (rescan) {
                        val bitmap = requireNotNull(viewModel.imageStore.load(path))
                        val analysis = try {
                            viewModel.preparationEngine.recognize(bitmap, currentBook.language)
                        } finally {
                            bitmap.recycle()
                        }
                        viewModel.repository.replacePageAnalysis(pageId, analysis)
                    }
                }
            },
        )
    }
    if (dictateOpen && currentPage != null && currentBook != null) {
        DictateCorrectionDialog(
            viewModel = viewModel,
            book = currentBook,
            initial = textDraft,
            locale = locale,
            onDismiss = { dictateOpen = false },
            onSave = { text ->
                dictateOpen = false
                textDraft = text
                textDirty = text != currentPage.ocrText
                editText = true
            },
        )
    }
    if (applyAmbientConfirm && currentPage?.ambientSoundId != null) {
        AlertDialog(
            onDismissRequest = { applyAmbientConfirm = false },
            title = { Text(locale.text("Use on every page?", "Применить ко всем страницам?")) },
            text = { Text(locale.text("This replaces each page’s current ambience.", "Текущий фон на всех страницах будет заменён.")) },
            confirmButton = {
                TextButton(
                    onClick = {
                        applyAmbientConfirm = false
                        val envelope = TrimEnvelope(
                            requireNotNull(currentPage.ambientSoundId),
                            currentPage.ambientStartMs,
                            currentPage.ambientEndMs,
                            currentPage.ambientFadeInMs,
                            currentPage.ambientFadeOutMs,
                        )
                        scope.launch { viewModel.repository.applyAmbientToBook(currentPage.bookId, envelope) }
                    },
                ) { Text(locale.text("Apply to all", "Применить")) }
            },
            dismissButton = {
                TextButton(onClick = { applyAmbientConfirm = false }) { Text(locale.text("Cancel", "Отмена")) }
            },
        )
    }
}

@Composable
private fun ZoomablePageImage(path: String) {
    var scale by remember(path) { mutableFloatStateOf(1f) }
    var offset by remember(path) { mutableStateOf(Offset.Zero) }
    Box(
        Modifier
            .fillMaxWidth()
            .height(360.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .pointerInput(path) {
                detectTapGestures(
                    onDoubleTap = {
                        scale = 1f
                        offset = Offset.Zero
                    },
                )
            }
            .pointerInput(path) {
                detectTransformGestures { _, pan, zoom, _ ->
                    scale = (scale * zoom).coerceIn(1f, 5f)
                    offset = if (scale <= 1f) Offset.Zero else offset + pan
                }
            },
    ) {
        NativeImage(
            path = path,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offset.x,
                    translationY = offset.y,
                ),
            contentScale = ContentScale.Fit,
            maxEdge = 1900,
        )
        Surface(
            modifier = Modifier.align(Alignment.BottomCenter).padding(10.dp),
            color = Color.Black.copy(alpha = .55f),
            contentColor = Color.White,
            shape = RoundedCornerShape(99.dp),
        ) {
            Text(
                "Pinch to zoom · double-tap to reset",
                modifier = Modifier.padding(horizontal = 11.dp, vertical = 6.dp),
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun PageTypePicker(
    pageType: PageType,
    locale: UiLocale,
    onChange: (PageType) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = pageTypeLabel(pageType, locale),
            onValueChange = {},
            modifier = Modifier.fillMaxWidth().menuAnchor(),
            readOnly = true,
            label = { Text(locale.text("Page type", "Тип страницы")) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            shape = RoundedCornerShape(18.dp),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            PageType.entries.forEach { type ->
                DropdownMenuItem(
                    text = { Text(pageTypeLabel(type, locale)) },
                    onClick = {
                        expanded = false
                        onChange(type)
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun WordCueText(
    text: String,
    cues: List<Cue>,
    onWord: (Int, Int, Cue?) -> Unit,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start,
    ) {
        tokenizeText(text).forEach { token ->
            if (token.isWhitespace) {
                Text(token.text)
            } else {
                val cue = cueAtRange(cues, token.start, token.end)
                val active = cue?.reviewState != CueReviewState.REMOVED
                Text(
                    token.text,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(
                            when {
                                cue == null -> Color.Transparent
                                !active -> Color.Gray.copy(alpha = .13f)
                                cue.soundId == null -> BloomYellow.copy(alpha = .28f)
                                else -> BloomBlue.copy(alpha = .18f)
                            },
                        )
                        .clickable { onWord(token.start, token.end, cue) }
                        .padding(horizontal = 2.dp, vertical = 1.dp),
                    color = if (active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    textDecoration = if (!active) TextDecoration.LineThrough else TextDecoration.None,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
    }
}

@Composable
private fun AmbientCard(
    page: Page,
    locale: UiLocale,
    onPick: () -> Unit,
    onPlay: () -> Unit,
    onStop: () -> Unit,
    onApplyAll: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = BloomPurple.copy(alpha = .12f)),
        shape = RoundedCornerShape(22.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.GraphicEq, contentDescription = null, tint = BloomPurple)
                Spacer(Modifier.width(9.dp))
                Column(Modifier.weight(1f)) {
                    Text(locale.text("Page ambience", "Фоновый звук"), fontWeight = FontWeight.ExtraBold)
                    Text(
                        page.ambientSoundId?.let(com.storybloom.app.audio.SoundLibrary::label)
                            ?: locale.text("No ambience", "Без фона"),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = onPick) {
                    Icon(Icons.Rounded.MusicNote, locale.text("Choose ambience", "Выбрать фон"))
                }
            }
            if (page.ambientSoundId != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssistChip(
                        onClick = onPlay,
                        label = { Text(locale.text("Preview", "Слушать")) },
                        leadingIcon = { Icon(Icons.Rounded.PlayArrow, contentDescription = null) },
                    )
                    AssistChip(
                        onClick = onStop,
                        label = { Text(locale.text("Stop", "Стоп")) },
                        leadingIcon = { Icon(Icons.Rounded.Stop, contentDescription = null) },
                    )
                    AssistChip(
                        onClick = onApplyAll,
                        label = { Text(locale.text("Apply all", "На все")) },
                        leadingIcon = { Icon(Icons.Rounded.ContentCopy, contentDescription = null) },
                    )
                }
            }
        }
    }
}

@Composable
private fun CueCard(
    cue: Cue,
    locale: UiLocale,
    onPick: () -> Unit,
    onPlay: () -> Unit,
    onLucky: () -> Unit,
    onToggleRemoved: () -> Unit,
) {
    val removed = cue.reviewState == CueReviewState.REMOVED
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (removed) {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .46f)
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "“${cue.triggerText}”",
                        fontWeight = FontWeight.ExtraBold,
                        textDecoration = if (removed) TextDecoration.LineThrough else TextDecoration.None,
                    )
                    Text(
                        cue.soundId?.let(com.storybloom.app.audio.SoundLibrary::label)
                            ?: locale.text("No sound assigned", "Звук не выбран"),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (cue.soundId != null && !removed) {
                    IconButton(onClick = onPlay) {
                        Icon(Icons.Rounded.PlayArrow, locale.text("Play sound", "Воспроизвести звук"))
                    }
                }
                IconButton(onClick = onPick, enabled = !removed) {
                    Icon(Icons.Rounded.MusicNote, locale.text("Choose sound", "Выбрать звук"))
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip(
                    onClick = onLucky,
                    enabled = !removed,
                    label = { Text(locale.text("Lucky", "Случайно")) },
                    leadingIcon = { Icon(Icons.Rounded.Casino, contentDescription = null) },
                )
                AssistChip(
                    onClick = onToggleRemoved,
                    label = {
                        Text(
                            if (removed) locale.text("Restore", "Вернуть")
                            else locale.text("Remove", "Убрать"),
                        )
                    },
                    leadingIcon = {
                        Icon(
                            if (removed) Icons.Rounded.Restore else Icons.Rounded.RemoveCircleOutline,
                            contentDescription = null,
                        )
                    },
                )
            }
        }
    }
}

@Composable
private fun PhotoEditorDialog(
    viewModel: StorybloomViewModel,
    page: Page,
    locale: UiLocale,
    onDismiss: () -> Unit,
    onSaved: (String, Boolean) -> Unit,
) {
    var rotation by remember { mutableFloatStateOf(0f) }
    var left by remember { mutableFloatStateOf(0f) }
    var top by remember { mutableFloatStateOf(0f) }
    var right by remember { mutableFloatStateOf(1f) }
    var bottom by remember { mutableFloatStateOf(1f) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(locale.text("Crop & rotate", "Кадрирование и поворот")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                NativeImage(
                    page.imagePath,
                    Modifier.fillMaxWidth().height(230.dp).clip(RoundedCornerShape(16.dp))
                        .graphicsLayer(rotationZ = rotation),
                    contentScale = ContentScale.Fit,
                )
                Text(locale.text("Left edge", "Левый край"))
                Slider(left, { left = it.coerceAtMost(right - .05f) }, valueRange = 0f..1f)
                Text(locale.text("Right edge", "Правый край"))
                Slider(right, { right = it.coerceAtLeast(left + .05f) }, valueRange = 0f..1f)
                Text(locale.text("Top edge", "Верхний край"))
                Slider(top, { top = it.coerceAtMost(bottom - .05f) }, valueRange = 0f..1f)
                Text(locale.text("Bottom edge", "Нижний край"))
                Slider(bottom, { bottom = it.coerceAtLeast(top + .05f) }, valueRange = 0f..1f)
                OutlinedButton(onClick = { rotation = (rotation + 90f) % 360f }) {
                    Icon(Icons.Rounded.CropRotate, contentDescription = null)
                    Text(locale.text("Rotate 90°", "Повернуть на 90°"))
                }
            }
        },
        confirmButton = {
            Column {
                TextButton(
                    enabled = !saving,
                    onClick = {
                        saving = true
                        scope.launch {
                            val path = viewModel.imageStore.saveEdited(
                                page.imagePath,
                                rotation,
                                left,
                                top,
                                right,
                                bottom,
                            )
                            onSaved(path, false)
                        }
                    },
                ) { Text(locale.text("Save", "Сохранить")) }
                TextButton(
                    enabled = !saving,
                    onClick = {
                        saving = true
                        scope.launch {
                            val path = viewModel.imageStore.saveEdited(
                                page.imagePath,
                                rotation,
                                left,
                                top,
                                right,
                                bottom,
                            )
                            onSaved(path, true)
                        }
                    },
                ) { Text(locale.text("Save & re-scan", "Сохранить и распознать")) }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(locale.text("Cancel", "Отмена")) } },
    )
}

@Composable
private fun DictateCorrectionDialog(
    viewModel: StorybloomViewModel,
    book: Book,
    initial: String,
    locale: UiLocale,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    val context = LocalContext.current
    val activity = context as Activity
    val recognizer = remember { VoskRecognizer(viewModel.modelManager) }
    val scope = rememberCoroutineScope()
    var text by remember(initial) { mutableStateOf(initial) }
    var partial by remember { mutableStateOf("") }
    var listening by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }

    fun stop() {
        listening = false
        partial = ""
        scope.launch { recognizer.stop() }
    }

    fun start() {
        loading = true
        scope.launch {
            viewModel.runOperation {
                recognizer.start(
                    book.language,
                    callbacks = object : SpeechCallbacks {
                        override fun onPartial(value: String) {
                            activity.runOnUiThread { partial = value }
                        }

                        override fun onResult(value: String, words: List<RecognizedWord>) {
                            activity.runOnUiThread {
                                text = listOf(text.trimEnd(), value).filter(String::isNotBlank).joinToString(" ")
                                partial = ""
                            }
                        }

                        override fun onError(message: String) {
                            activity.runOnUiThread {
                                listening = false
                                loading = false
                                viewModel.notify(
                                    locale.text(
                                        "Voice input stopped. Please try again.",
                                        "Голосовой ввод остановлен. Попробуйте ещё раз.",
                                    ),
                                )
                            }
                        }
                    },
                )
                listening = true
            }
            loading = false
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (it) start() else viewModel.notify(locale.text("Microphone permission was denied.", "Нет доступа к микрофону."))
    }
    DisposableEffect(Unit) {
        onDispose { recognizer.closeNow() }
    }
    AlertDialog(
        onDismissRequest = { stop(); onDismiss() },
        title = { Text(locale.text("Dictate correction", "Продиктовать исправление")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.fillMaxWidth().height(220.dp),
                    supportingText = { if (partial.isNotBlank()) Text("…$partial") },
                )
                BloomPrimaryButton(
                    text = when {
                        loading -> locale.text("Loading…", "Загрузка…")
                        listening -> locale.text("Stop", "Остановить")
                        else -> locale.text("Dictate", "Диктовать")
                    },
                    onClick = {
                        when {
                            listening -> stop()
                            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                                PackageManager.PERMISSION_GRANTED -> start()
                            else -> permission.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !loading,
                    color = if (listening) BloomCoral else BloomBlue,
                    leading = { Icon(if (listening) Icons.Rounded.Stop else Icons.Rounded.Mic, contentDescription = null) },
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    stop()
                    onSave(text.trim())
                },
                enabled = text.isNotBlank(),
            ) { Text(locale.text("Use text", "Использовать")) }
        },
        dismissButton = { TextButton(onClick = { stop(); onDismiss() }) { Text(locale.text("Cancel", "Отмена")) } },
    )
}

private suspend fun saveCorrectedText(
    viewModel: StorybloomViewModel,
    page: Page,
    cues: List<Cue>,
    corrected: String,
) {
    viewModel.repository.updatePageText(page.id, corrected)
    val lower = corrected.lowercase(Locale.ROOT)
    var searchFrom = 0
    cues.sortedBy { it.charStart ?: Int.MAX_VALUE }.forEach { cue ->
        val trigger = cue.triggerText.lowercase(Locale.ROOT)
        var index = lower.indexOf(trigger, searchFrom)
        if (index < 0) index = lower.indexOf(trigger)
        viewModel.repository.updateCueRange(
            cue.id,
            index.takeIf { it >= 0 },
            index.takeIf { it >= 0 }?.plus(trigger.length),
        )
        if (index >= 0) searchFrom = index + trigger.length
    }
}

private fun pageTypeLabel(type: PageType, locale: UiLocale): String = when (type) {
    PageType.COVER -> locale.text("Cover", "Обложка")
    PageType.TITLE -> locale.text("Title page", "Титульная страница")
    PageType.STORY -> locale.text("Story", "История")
    PageType.ILLUSTRATION_ONLY -> locale.text("Illustration only", "Только иллюстрация")
    PageType.BACK_COVER -> locale.text("Back cover", "Задняя обложка")
}
