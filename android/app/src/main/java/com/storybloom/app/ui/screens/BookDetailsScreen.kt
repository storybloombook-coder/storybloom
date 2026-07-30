package com.storybloom.app.ui.screens

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AddAPhoto
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.storybloom.app.data.Book
import com.storybloom.app.data.Cue
import com.storybloom.app.data.Page
import com.storybloom.app.data.PrepStatus
import com.storybloom.app.reader.ReadinessWarning
import com.storybloom.app.reader.ReadinessWarningKind
import com.storybloom.app.reader.checkReadiness
import com.storybloom.app.speech.RecognizedWord
import com.storybloom.app.speech.SpeechCallbacks
import com.storybloom.app.speech.VoskRecognizer
import com.storybloom.app.ui.StorybloomViewModel
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.components.BloomPrimaryButton
import com.storybloom.app.ui.components.EmptyState
import com.storybloom.app.ui.components.NativeImage
import com.storybloom.app.ui.components.StatusPill
import com.storybloom.app.ui.components.StoryScaffold
import com.storybloom.app.ui.text
import com.storybloom.app.ui.theme.BloomBlue
import com.storybloom.app.ui.theme.BloomCoral
import com.storybloom.app.ui.theme.BloomGreen
import kotlinx.coroutines.launch

@Composable
fun BookDetailsScreen(
    viewModel: StorybloomViewModel,
    bookId: String,
    locale: UiLocale,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
    onPage: (String) -> Unit,
    onRead: () -> Unit,
) {
    val revision by viewModel.repository.revision.collectAsState()
    var book by remember(bookId) { mutableStateOf<Book?>(null) }
    var pages by remember(bookId) { mutableStateOf<List<Page>>(emptyList()) }
    var cues by remember(bookId) { mutableStateOf<List<Cue>>(emptyList()) }
    var loading by remember(bookId) { mutableStateOf(true) }
    var renameOpen by remember { mutableStateOf(false) }
    var dictatedOpen by remember { mutableStateOf(false) }
    var deleteBookOpen by remember { mutableStateOf(false) }
    var deletePage by remember { mutableStateOf<Page?>(null) }
    var readinessOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(bookId, revision) {
        loading = true
        book = viewModel.repository.getBook(bookId)
        pages = viewModel.repository.getPages(bookId)
        cues = viewModel.repository.getCuesForBook(bookId)
        loading = false
    }

    val addPhotos = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(60),
    ) { uris ->
        if (uris.isNotEmpty()) scope.launch { viewModel.addPhotos(bookId, uris) }
    }

    val currentBook = book
    if (!loading && currentBook == null) {
        EmptyState(
            title = locale.text("Book not found", "Книга не найдена"),
            message = locale.text("It may have been deleted.", "Возможно, она была удалена."),
            actionText = locale.text("Back to library", "В библиотеку"),
            onAction = onBack,
            modifier = Modifier.fillMaxSize(),
        )
        return
    }
    val report = checkReadiness(pages, cues)
    val progress = viewModel.preparationEngine.progress.collectAsState().value[bookId]

    StoryScaffold(
        title = currentBook?.title ?: locale.text("Book", "Книга"),
        onBack = onBack,
        snackbarHostState = snackbarHostState,
        actions = {
            currentBook?.let { value ->
                IconButton(
                    onClick = {
                        scope.launch {
                            viewModel.runOperation {
                                viewModel.repository.setFavorite(value.id, !value.isFavorite)
                            }
                        }
                    },
                ) {
                    Icon(
                        if (value.isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                        contentDescription = if (value.isFavorite) {
                            locale.text("Remove from favorites", "Убрать из избранного")
                        } else {
                            locale.text("Add to favorites", "Добавить в избранное")
                        },
                        tint = if (value.isFavorite) BloomCoral else MaterialTheme.colorScheme.onSurface,
                    )
                }
                IconButton(onClick = { renameOpen = true }) {
                    Icon(Icons.Rounded.Edit, locale.text("Rename", "Переименовать"))
                }
                IconButton(onClick = { deleteBookOpen = true }) {
                    Icon(Icons.Rounded.Delete, locale.text("Delete", "Удалить"))
                }
            }
        },
    ) { padding ->
        if (loading) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize().padding(padding),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                item {
                    BookSummaryPanel(
                        book = requireNotNull(currentBook),
                        pageCount = pages.size,
                        soundCount = report.soundCount,
                        locale = locale,
                    )
                }
                if (currentBook?.prepStatus == PrepStatus.PROCESSING) {
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                            shape = RoundedCornerShape(20.dp),
                        ) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                                Text(
                                    if (progress != null && progress.totalPages > 0) {
                                        locale.text(
                                            "Preparing page ${progress.currentPage} of ${progress.totalPages}…",
                                            "Подготовка страницы ${progress.currentPage} из ${progress.totalPages}…",
                                        )
                                    } else {
                                        locale.text("Preparing your book…", "Подготовка книги…")
                                    },
                                    fontWeight = FontWeight.Bold,
                                )
                                LinearProgressIndicator(
                                    progress = {
                                        if (progress == null || progress.totalPages == 0) 0f
                                        else progress.currentPage.toFloat() / progress.totalPages
                                    },
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                Text(
                                    locale.text(
                                        "Getting the words and sounds ready for reading.",
                                        "Подбираем текст и звуки для чтения.",
                                    ),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
                if (currentBook?.prepStatus == PrepStatus.FAILED) {
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                            shape = RoundedCornerShape(20.dp),
                        ) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text(
                                    locale.text(
                                        "This book could not be prepared.",
                                        "Не удалось подготовить книгу.",
                                    ),
                                    fontWeight = FontWeight.Bold,
                                )
                                OutlinedButton(onClick = { viewModel.preparationEngine.prepareBook(bookId) }) {
                                    Icon(Icons.Rounded.Refresh, contentDescription = null)
                                    Text(locale.text("Try again", "Повторить"))
                                }
                            }
                        }
                    }
                }
                item {
                    ReadinessCard(
                        ready = report.ready,
                        pages = report.storyPageCount,
                        sounds = report.soundCount,
                        ambient = report.ambientPageCount,
                        warnings = report.warnings.size,
                        locale = locale,
                        onClick = { readinessOpen = true },
                    )
                }
                item {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        BloomPrimaryButton(
                            text = locale.text("Read", "Читать"),
                            onClick = {
                                if (report.ready) onRead() else readinessOpen = true
                            },
                            enabled = pages.any { it.pageType.isReadable } &&
                                currentBook?.prepStatus != PrepStatus.PROCESSING,
                            modifier = Modifier.weight(1f),
                            leading = { Icon(Icons.Rounded.PlayArrow, contentDescription = null) },
                        )
                        OutlinedButton(
                            onClick = {
                                addPhotos.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                                )
                            },
                            modifier = Modifier.height(54.dp),
                            shape = RoundedCornerShape(18.dp),
                        ) {
                            Icon(Icons.Rounded.AddAPhoto, contentDescription = null)
                        }
                        OutlinedButton(
                            onClick = { dictatedOpen = true },
                            modifier = Modifier.height(54.dp),
                            shape = RoundedCornerShape(18.dp),
                        ) {
                            Icon(Icons.Rounded.Mic, contentDescription = null)
                        }
                    }
                }
                item {
                    Text(
                        locale.text("Pages", "Страницы"),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.ExtraBold,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
                if (pages.isEmpty()) {
                    item {
                        EmptyState(
                            title = locale.text("No pages yet", "Страниц пока нет"),
                            message = locale.text(
                                "Add photos or dictate a page.",
                                "Добавьте фото или продиктуйте страницу.",
                            ),
                        )
                    }
                } else {
                    itemsIndexed(pages, key = { _, page -> page.id }) { index, page ->
                        PageRow(
                            page = page,
                            locale = locale,
                            onClick = { onPage(page.id) },
                            onMoveUp = {
                                if (index > 0) {
                                    val reordered = pages.toMutableList()
                                    val item = reordered.removeAt(index)
                                    reordered.add(index - 1, item)
                                    scope.launch { viewModel.repository.reorderPages(reordered.map { it.id }) }
                                }
                            },
                            onMoveDown = {
                                if (index < pages.lastIndex) {
                                    val reordered = pages.toMutableList()
                                    val item = reordered.removeAt(index)
                                    reordered.add(index + 1, item)
                                    scope.launch { viewModel.repository.reorderPages(reordered.map { it.id }) }
                                }
                            },
                            onDelete = { deletePage = page },
                            canMoveUp = index > 0,
                            canMoveDown = index < pages.lastIndex,
                        )
                    }
                }
            }
        }
    }

    if (renameOpen && currentBook != null) {
        RenameBookDialog(
            current = currentBook.title,
            locale = locale,
            onDismiss = { renameOpen = false },
            onSave = { title ->
                renameOpen = false
                scope.launch { viewModel.repository.updateBookTitle(bookId, title) }
            },
        )
    }
    if (dictatedOpen && currentBook != null) {
        AddDictatedPageDialog(
            viewModel = viewModel,
            book = currentBook,
            locale = locale,
            onDismiss = { dictatedOpen = false },
            onSave = { text ->
                dictatedOpen = false
                scope.launch { viewModel.addDictatedPage(bookId, text) }
            },
        )
    }
    if (deleteBookOpen && currentBook != null) {
        AlertDialog(
            onDismissRequest = { deleteBookOpen = false },
            title = { Text(locale.text("Delete book?", "Удалить книгу?")) },
            text = { Text(locale.text("This removes every page and cue.", "Будут удалены все страницы и звуки.")) },
            confirmButton = {
                TextButton(
                    onClick = {
                        deleteBookOpen = false
                        scope.launch { viewModel.deleteBook(bookId) }
                    },
                ) { Text(locale.text("Delete", "Удалить"), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { deleteBookOpen = false }) { Text(locale.text("Cancel", "Отмена")) }
            },
        )
    }
    deletePage?.let { page ->
        AlertDialog(
            onDismissRequest = { deletePage = null },
            title = { Text(locale.text("Delete page ${page.pageNumber}?", "Удалить страницу ${page.pageNumber}?")) },
            text = { Text(locale.text("Its text and sound cues will also be removed.", "Текст и звуки этой страницы тоже будут удалены.")) },
            confirmButton = {
                TextButton(
                    onClick = {
                        deletePage = null
                        scope.launch { viewModel.deletePage(page.id) }
                    },
                ) { Text(locale.text("Delete", "Удалить"), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { deletePage = null }) { Text(locale.text("Cancel", "Отмена")) }
            },
        )
    }
    if (readinessOpen) {
        ReadinessDialog(
            warnings = report.warnings,
            locale = locale,
            onDismiss = { readinessOpen = false },
            onPage = { pageId ->
                readinessOpen = false
                onPage(pageId)
            },
            onReadAnyway = {
                readinessOpen = false
                onRead()
            },
        )
    }
}

@Composable
private fun BookSummaryPanel(
    book: Book,
    pageCount: Int,
    soundCount: Int,
    locale: UiLocale,
) {
    Card(
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Row(
            Modifier.padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(15.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            NativeImage(
                path = book.coverImagePath,
                modifier = Modifier.size(width = 92.dp, height = 118.dp).clip(RoundedCornerShape(15.dp)),
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(book.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                Text(
                    locale.text("$pageCount pages · $soundCount sounds", "$pageCount стр. · $soundCount звуков"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                StatusPill(
                    text = when (book.prepStatus) {
                        PrepStatus.READY -> locale.text("Ready", "Готово")
                        PrepStatus.PROCESSING -> locale.text("Preparing", "Подготовка")
                        PrepStatus.FAILED -> locale.text("Needs attention", "Нужна проверка")
                        PrepStatus.PENDING -> locale.text("Waiting", "Ожидание")
                    },
                    color = when (book.prepStatus) {
                        PrepStatus.READY -> BloomGreen
                        PrepStatus.PROCESSING -> BloomBlue
                        PrepStatus.FAILED -> BloomCoral
                        PrepStatus.PENDING -> Color.Gray
                    },
                )
            }
        }
    }
}

@Composable
private fun ReadinessCard(
    ready: Boolean,
    pages: Int,
    sounds: Int,
    ambient: Int,
    warnings: Int,
    locale: UiLocale,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (ready) {
                BloomGreen.copy(alpha = .13f)
            } else {
                MaterialTheme.colorScheme.tertiaryContainer
            },
        ),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(
                if (ready) locale.text("Ready to read", "Готово к чтению")
                else locale.text("$warnings things to review", "Нужно проверить: $warnings"),
                fontWeight = FontWeight.ExtraBold,
            )
            Text(
                locale.text(
                    "$pages story pages · $sounds cue sounds · $ambient ambient pages",
                    "$pages страниц · $sounds звуков · $ambient фоновых",
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun PageRow(
    page: Page,
    locale: UiLocale,
    onClick: () -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    onDelete: () -> Unit,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(21.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            Modifier.padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (page.imagePath.isNotBlank()) {
                NativeImage(
                    page.imagePath,
                    Modifier.size(width = 76.dp, height = 94.dp).clip(RoundedCornerShape(13.dp)),
                )
            } else {
                Box(
                    Modifier.size(width = 76.dp, height = 94.dp)
                        .background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(13.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Rounded.Mic, contentDescription = null)
                }
            }
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(
                    locale.text("Page ${page.pageNumber}", "Страница ${page.pageNumber}"),
                    fontWeight = FontWeight.ExtraBold,
                )
                Text(
                    page.ocrText.ifBlank { locale.text("No text yet", "Текста пока нет") },
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Column {
                IconButton(onClick = onMoveUp, enabled = canMoveUp) {
                    Icon(Icons.Rounded.ArrowUpward, locale.text("Move up", "Переместить выше"))
                }
                IconButton(onClick = onMoveDown, enabled = canMoveDown) {
                    Icon(Icons.Rounded.ArrowDownward, locale.text("Move down", "Переместить ниже"))
                }
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Rounded.Delete,
                        locale.text("Delete", "Удалить"),
                        tint = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }
}

@Composable
private fun RenameBookDialog(
    current: String,
    locale: UiLocale,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    var title by remember(current) { mutableStateOf(current) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(locale.text("Rename book", "Переименовать книгу")) },
        text = {
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                singleLine = true,
                label = { Text(locale.text("Title", "Название")) },
            )
        },
        confirmButton = {
            TextButton(onClick = { if (title.isNotBlank()) onSave(title.trim()) }) {
                Text(locale.text("Save", "Сохранить"))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(locale.text("Cancel", "Отмена")) } },
    )
}

@Composable
private fun AddDictatedPageDialog(
    viewModel: StorybloomViewModel,
    book: Book,
    locale: UiLocale,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    val context = LocalContext.current
    val activity = context as Activity
    val scope = rememberCoroutineScope()
    val recognizer = remember { VoskRecognizer(viewModel.modelManager) }
    var text by remember { mutableStateOf("") }
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
        onDismissRequest = {
            stop()
            onDismiss()
        },
        title = { Text(locale.text("Add a dictated page", "Добавить страницу голосом")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.fillMaxWidth().height(180.dp),
                    label = { Text(locale.text("Page text", "Текст страницы")) },
                    supportingText = { if (partial.isNotBlank()) Text("…$partial") },
                )
                OutlinedButton(
                    onClick = {
                        when {
                            listening -> stop()
                            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                                PackageManager.PERMISSION_GRANTED -> start()
                            else -> permission.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                    enabled = !loading,
                ) {
                    if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else Icon(if (listening) Icons.Rounded.Stop else Icons.Rounded.Mic, contentDescription = null)
                    Text(
                        if (listening) locale.text("Stop", "Остановить")
                        else locale.text("Dictate", "Диктовать"),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    stop()
                    if (text.isNotBlank()) onSave(text.trim())
                },
                enabled = text.isNotBlank(),
            ) { Text(locale.text("Add page", "Добавить")) }
        },
        dismissButton = {
            TextButton(onClick = { stop(); onDismiss() }) { Text(locale.text("Cancel", "Отмена")) }
        },
    )
}

@Composable
private fun ReadinessDialog(
    warnings: List<ReadinessWarning>,
    locale: UiLocale,
    onDismiss: () -> Unit,
    onPage: (String) -> Unit,
    onReadAnyway: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                if (warnings.isEmpty()) locale.text("Ready to read", "Готово к чтению")
                else locale.text("A quick review", "Быстрая проверка"),
            )
        },
        text = {
            if (warnings.isEmpty()) {
                Text(locale.text("Every story page has text and sound.", "На каждой странице есть текст и звук."))
            } else {
                LazyColumn(
                    modifier = Modifier.height(320.dp),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    items(warnings.size) { index ->
                        val warning = warnings[index]
                        Card(
                            modifier = Modifier.fillMaxWidth().clickable { onPage(warning.pageId) },
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            Text(
                                warningLabel(warning, locale),
                                modifier = Modifier.padding(12.dp),
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onReadAnyway) {
                Text(
                    if (warnings.isEmpty()) locale.text("Start reading", "Начать чтение")
                    else locale.text("Read anyway", "Читать всё равно"),
                )
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(locale.text("Close", "Закрыть")) } },
    )
}

private fun warningLabel(warning: ReadinessWarning, locale: UiLocale): String = when (warning.kind) {
    ReadinessWarningKind.EMPTY_TEXT -> locale.text(
        "Page ${warning.pageNumber}: no text recognized",
        "Страница ${warning.pageNumber}: нет текста",
    )
    ReadinessWarningKind.PAGE_NO_SOUNDS -> locale.text(
        "Page ${warning.pageNumber}: no sounds yet",
        "Страница ${warning.pageNumber}: пока нет звуков",
    )
    ReadinessWarningKind.SILENT_CUE -> locale.text(
        "Page ${warning.pageNumber}: “${warning.detail}” has no sound",
        "Страница ${warning.pageNumber}: у «${warning.detail}» нет звука",
    )
    ReadinessWarningKind.UNPLAYABLE_CUE -> locale.text(
        "Page ${warning.pageNumber}: “${warning.detail}” is missing audio",
        "Страница ${warning.pageNumber}: звук «${warning.detail}» недоступен",
    )
}
