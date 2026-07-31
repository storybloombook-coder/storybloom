package com.storybloom.app.ui.screens

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.view.HapticFeedbackConstants
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.storybloom.app.data.Book
import com.storybloom.app.data.BookLanguage
import com.storybloom.app.data.Cue
import com.storybloom.app.data.CueDraft
import com.storybloom.app.data.CueReviewState
import com.storybloom.app.data.CueType
import com.storybloom.app.data.Page
import com.storybloom.app.data.PageType
import com.storybloom.app.data.TextToken
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
import com.storybloom.app.ui.components.NativePhotoEditorDialog
import com.storybloom.app.ui.components.PulsingStoryDot
import com.storybloom.app.ui.components.RecordingOrigin
import com.storybloom.app.ui.components.SoundPickerDialog
import com.storybloom.app.ui.components.SoundPickerMode
import com.storybloom.app.ui.components.StoryScaffold
import com.storybloom.app.ui.components.StoryLightSwitch
import com.storybloom.app.ui.text
import com.storybloom.app.ui.theme.BloomBlue
import com.storybloom.app.ui.theme.BloomCoral
import com.storybloom.app.ui.theme.BloomGreen
import com.storybloom.app.ui.theme.BloomPurple
import com.storybloom.app.ui.theme.BloomYellow
import kotlinx.coroutines.launch
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

private sealed interface SoundTarget {
    data object Ambient : SoundTarget
    data class CueTarget(val cue: Cue) : SoundTarget
    data class NewCue(val draft: CueDraft) : SoundTarget
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
    var rescanning by remember { mutableStateOf(false) }
    var photoEditor by remember { mutableStateOf(false) }
    var rescanEditor by remember { mutableStateOf(false) }
    var dictateOpen by remember { mutableStateOf(false) }
    var ambientPreviewing by remember(pageId) { mutableStateOf(false) }
    var ambientAppliedToAll by remember(pageId) { mutableStateOf(false) }
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
    LaunchedEffect(
        currentPage?.ambientSoundId,
        currentPage?.ambientStartMs,
        currentPage?.ambientEndMs,
        currentPage?.ambientFadeInMs,
        currentPage?.ambientFadeOutMs,
    ) {
        viewModel.audioEngine.stopAmbient(immediate = true)
        ambientPreviewing = false
    }
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
                                onClick = { rescanEditor = true },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(16.dp),
                            ) {
                                Icon(Icons.Rounded.Refresh, contentDescription = null)
                                Text(locale.text("Re-scan area", "Распознать область"))
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
                                        pickerTarget = if (existing != null) {
                                            SoundTarget.CueTarget(existing)
                                        } else {
                                            SoundTarget.NewCue(
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
                        onLucky = {
                            val sound = com.storybloom.app.audio.SoundLibrary.randomAmbient(
                                currentPage.ambientSoundId,
                            )
                            viewModel.audioEngine.stopAmbient(immediate = true)
                            ambientPreviewing = false
                            ambientAppliedToAll = false
                            scope.launch {
                                viewModel.repository.updatePageAmbient(
                                    currentPage.id,
                                    TrimEnvelope(sound),
                                )
                            }
                        },
                        previewing = ambientPreviewing,
                        onTogglePreview = {
                            if (ambientPreviewing) {
                                viewModel.audioEngine.stopAmbient()
                                ambientPreviewing = false
                            } else {
                                val sound = currentPage.ambientSoundId
                                    ?: return@AmbientCard
                                viewModel.audioEngine.playAmbient(
                                    TrimEnvelope(
                                        sound,
                                        currentPage.ambientStartMs,
                                        currentPage.ambientEndMs,
                                        currentPage.ambientFadeInMs,
                                        currentPage.ambientFadeOutMs,
                                    ),
                                )
                                ambientPreviewing = true
                            }
                        },
                        appliedToAll = ambientAppliedToAll,
                        onApplyAll = {
                            if (ambientAppliedToAll) {
                                ambientAppliedToAll = false
                            } else {
                                currentPage.ambientSoundId?.let { sound ->
                                    ambientAppliedToAll = true
                                    val envelope = TrimEnvelope(
                                        sound,
                                        currentPage.ambientStartMs,
                                        currentPage.ambientEndMs,
                                        currentPage.ambientFadeInMs,
                                        currentPage.ambientFadeOutMs,
                                    )
                                    scope.launch {
                                        viewModel.repository.applyAmbientToBook(
                                            currentPage.bookId,
                                            envelope,
                                        )
                                    }
                                }
                            }
                        },
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
                                    if (cue.reviewState == CueReviewState.REMOVED) {
                                        viewModel.repository.updateCueState(
                                            cue.id,
                                            CueReviewState.CONFIRMED,
                                        )
                                    }
                                }
                            },
                            onToggleRemoved = {
                                scope.launch {
                                    viewModel.repository.updateCueState(
                                        cue.id,
                                        if (cue.reviewState == CueReviewState.REMOVED) {
                                            CueReviewState.CONFIRMED
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
            is SoundTarget.NewCue -> null
        }
        SoundPickerDialog(
            viewModel = viewModel,
            locale = locale,
            mode = if (target == SoundTarget.Ambient) SoundPickerMode.AMBIENT else SoundPickerMode.EFFECT,
            currentSoundId = currentId,
            allowRemove = target == SoundTarget.Ambient,
            origin = RecordingOrigin(
                currentBook,
                currentPage.pageNumber,
                if (target == SoundTarget.Ambient) "Ambient"
                else when (target) {
                    is SoundTarget.CueTarget -> target.cue.triggerText
                    is SoundTarget.NewCue -> target.draft.triggerText
                    SoundTarget.Ambient -> error("Handled above")
                },
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
                        is SoundTarget.NewCue -> if (envelope != null) {
                            val cue = viewModel.repository.addCue(
                                pageId,
                                target.draft.copy(soundId = envelope.soundId),
                            )
                            viewModel.repository.updateCueSound(cue.id, envelope)
                            viewModel.repository.updateCueState(cue.id, CueReviewState.CONFIRMED)
                        }
                    }
                    pickerTarget = null
                }
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
        NativePhotoEditorDialog(
            imageStore = viewModel.imageStore,
            sourcePath = currentPage.imagePath,
            locale = locale,
            onDismiss = { photoEditor = false },
            onSaved = { path, _ ->
                photoEditor = false
                scope.launch {
                    viewModel.runOperation {
                        viewModel.repository.updatePageImage(pageId, path)
                    }
                }
            },
        )
    }
    if (rescanEditor && currentPage != null && currentBook != null) {
        NativePhotoEditorDialog(
            imageStore = viewModel.imageStore,
            sourcePath = currentPage.imagePath,
            locale = locale,
            scanOnly = true,
            onDismiss = { rescanEditor = false },
            onSaved = { temporaryPath, _ ->
                rescanEditor = false
                rescanning = true
                scope.launch {
                    try {
                        viewModel.runOperation {
                            val bitmap = requireNotNull(
                                viewModel.imageStore.load(temporaryPath),
                            )
                            val analysis = try {
                                viewModel.preparationEngine.recognize(
                                    bitmap,
                                    currentBook.language,
                                )
                            } finally {
                                bitmap.recycle()
                            }
                            // Region OCR replaces only the recognized text.
                            // Parent-selected sounds, review states, page
                            // type, ambience and the original photo survive.
                            saveCorrectedText(
                                viewModel = viewModel,
                                page = currentPage,
                                cues = cues,
                                corrected = analysis.ocrText,
                            )
                        }
                    } finally {
                        viewModel.imageStore.delete(temporaryPath)
                        rescanning = false
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
                CueWordToken(
                    token = token,
                    cue = cue,
                    onClick = { onWord(token.start, token.end, cue) },
                )
            }
        }
    }
}

@Composable
private fun CueWordToken(
    token: TextToken,
    cue: Cue?,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) .94f else 1f,
        animationSpec = tween(if (pressed) 70 else 115),
        label = "word token press",
    )
    val view = LocalView.current
    val active = cue?.reviewState != CueReviewState.REMOVED
    LaunchedEffect(pressed) {
        if (pressed) view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
    }
    Text(
        token.text,
        modifier = Modifier
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .clip(RoundedCornerShape(6.dp))
            .background(
                when {
                    pressed -> MaterialTheme.colorScheme.onSurface.copy(alpha = .18f)
                    cue == null -> Color.Transparent
                    !active -> Color.Gray.copy(alpha = .13f)
                    cue.type == CueType.CHARACTER -> BloomPurple.copy(alpha = .38f)
                    cue.soundId == null -> BloomYellow.copy(alpha = .28f)
                    else -> BloomBlue.copy(alpha = .30f)
                },
            )
            .clickable(
                interactionSource = interaction,
                indication = null,
            ) {
                view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                onClick()
            }
            .padding(horizontal = 2.dp, vertical = 1.dp),
        color = if (active) {
            MaterialTheme.colorScheme.onSurface
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
        textDecoration = if (!active) TextDecoration.LineThrough else TextDecoration.None,
        style = MaterialTheme.typography.bodyLarge,
    )
}

@Composable
private fun AmbientCard(
    page: Page,
    locale: UiLocale,
    onPick: () -> Unit,
    onLucky: () -> Unit,
    previewing: Boolean,
    onTogglePreview: () -> Unit,
    appliedToAll: Boolean,
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
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    AssistChip(
                        onClick = onTogglePreview,
                        label = {
                            Text(
                                if (previewing) {
                                    locale.text("Stop", "Стоп")
                                } else {
                                    locale.text("Play ambience", "Слушать фон")
                                },
                            )
                        },
                        leadingIcon = {
                            Icon(
                                if (previewing) Icons.Rounded.Stop else Icons.Rounded.PlayArrow,
                                contentDescription = null,
                            )
                        },
                    )
                    AssistChip(
                        onClick = onLucky,
                        label = { Text(locale.text("Lucky", "Случайно")) },
                        leadingIcon = {
                            Icon(Icons.Rounded.Casino, contentDescription = null)
                        },
                    )
                    /*
                    AssistChip(
                        onClick = onApplyAll,
                        label = { Text(locale.text("Apply all", "На все")) },
                        leadingIcon = { Icon(Icons.Rounded.ContentCopy, contentDescription = null) },
                    )
                    */
                    Row(
                        modifier = Modifier
                            .background(
                                Color(0xFFE8A33D).copy(alpha = .14f),
                                RoundedCornerShape(16.dp),
                            )
                            .padding(
                                start = 10.dp,
                                end = 7.dp,
                                top = 5.dp,
                                bottom = 5.dp,
                            ),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Rounded.ContentCopy,
                            contentDescription = null,
                            tint = Color(0xFFE8A33D),
                            modifier = Modifier.size(18.dp),
                        )
                        Text(
                            locale.text("Apply all", "На все"),
                            color = Color(0xFFE8A33D),
                            fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.labelMedium,
                        )
                        StoryLightSwitch(
                            on = appliedToAll,
                            onToggle = onApplyAll,
                            onColor = Color(0xFFE8A33D),
                        )
                    }
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
                IconButton(onClick = onPick) {
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

/*
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

*/
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
    val recognitionSession = remember { AtomicInteger(0) }
    val scope = rememberCoroutineScope()
    var text by remember(initial) { mutableStateOf(initial) }
    var partial by remember { mutableStateOf("") }
    var listening by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var language by remember(initial) {
        mutableStateOf(
            if (initial.any { it in '\u0400'..'\u04FF' }) {
                BookLanguage.RUSSIAN
            } else if (initial.isBlank()) {
                book.language
            } else {
                BookLanguage.ENGLISH
            },
        )
    }

    fun stop(commitPartial: Boolean = true) {
        if (commitPartial && partial.isNotBlank()) {
            text = listOf(text.trimEnd(), partial.trim())
                .filter(String::isNotBlank)
                .joinToString(" ")
        }
        recognitionSession.incrementAndGet()
        listening = false
        partial = ""
        scope.launch { recognizer.stop() }
    }

    fun start() {
        if (listening || loading) return
        val session = recognitionSession.incrementAndGet()
        loading = true
        scope.launch {
            viewModel.runOperation {
                recognizer.start(
                    language,
                    callbacks = object : SpeechCallbacks {
                        override fun onPartial(value: String) {
                            activity.runOnUiThread {
                                if (session == recognitionSession.get()) partial = value
                            }
                        }

                        override fun onResult(value: String, words: List<RecognizedWord>) {
                            activity.runOnUiThread {
                                if (session == recognitionSession.get()) {
                                    text = listOf(text.trimEnd(), value)
                                        .filter(String::isNotBlank)
                                        .joinToString(" ")
                                    partial = ""
                                }
                            }
                        }

                        override fun onError(message: String) {
                            activity.runOnUiThread {
                                if (session == recognitionSession.get()) {
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
                        }
                    },
                )
                if (session == recognitionSession.get()) listening = true
            }
            if (session == recognitionSession.get()) loading = false
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (it) start() else viewModel.notify(locale.text("Microphone permission was denied.", "Нет доступа к микрофону."))
    }
    DisposableEffect(Unit) {
        onDispose {
            recognitionSession.incrementAndGet()
            recognizer.closeNow()
        }
    }
    AlertDialog(
        onDismissRequest = { stop(commitPartial = false); onDismiss() },
        title = { Text(locale.text("Dictate correction", "Продиктовать исправление")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(
                        selected = language == BookLanguage.ENGLISH,
                        onClick = { language = BookLanguage.ENGLISH },
                        enabled = !listening && !loading,
                        label = { Text(locale.text("English", "Английский")) },
                        modifier = Modifier.weight(1f),
                    )
                    FilterChip(
                        selected = language == BookLanguage.RUSSIAN,
                        onClick = { language = BookLanguage.RUSSIAN },
                        enabled = !listening && !loading,
                        label = { Text(locale.text("Russian", "Русский")) },
                        modifier = Modifier.weight(1f),
                    )
                }
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
                    leading = {
                        if (listening) {
                            PulsingStoryDot(color = Color.White, size = 8.dp)
                        } else {
                            Icon(Icons.Rounded.Mic, contentDescription = null)
                        }
                    },
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    stop()
                    onSave(text.trim())
                },
                enabled = text.isNotBlank() || partial.isNotBlank(),
            ) { Text(locale.text("Use text", "Использовать")) }
        },
        dismissButton = {
            TextButton(onClick = { stop(commitPartial = false); onDismiss() }) {
                Text(locale.text("Cancel", "Отмена"))
            }
        },
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
