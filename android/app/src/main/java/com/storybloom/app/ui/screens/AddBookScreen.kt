package com.storybloom.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.EaseOutCubic
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AddAPhoto
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.ArrowForward
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import com.storybloom.app.data.BookLanguage
import com.storybloom.app.ui.StorybloomViewModel
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.components.BloomPrimaryButton
import com.storybloom.app.ui.components.NativeImage
import com.storybloom.app.ui.components.NativePhotoEditorDialog
import com.storybloom.app.ui.components.ReorderableGridItem
import com.storybloom.app.ui.components.StoryScaffold
import com.storybloom.app.ui.components.rememberGridReorderState
import com.storybloom.app.ui.mechanics.ReorderMath
import com.storybloom.app.ui.text
import com.storybloom.app.ui.theme.BloomBlue
import kotlinx.coroutines.launch
import java.io.File
import kotlin.math.floor

@Composable
fun AddBookScreen(
    viewModel: StorybloomViewModel,
    locale: UiLocale,
    snackbarHostState: androidx.compose.material3.SnackbarHostState,
    onBack: () -> Unit,
    onDictateInstead: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val imagePaths = remember { mutableStateListOf<String>() }
    var editorSourcePath by remember { mutableStateOf<String?>(null) }
    var editorQueue by remember { mutableStateOf<List<String>>(emptyList()) }
    var editorTotal by remember { mutableIntStateOf(0) }
    var editorExistingIndex by remember { mutableIntStateOf(-1) }
    var title by remember { mutableStateOf("") }
    var language by remember { mutableStateOf(BookLanguage.ENGLISH) }
    var showBookDetails by remember { mutableStateOf(false) }
    var importing by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var pendingCameraFile by remember { mutableStateOf<File?>(null) }
    var pendingCameraUri by remember { mutableStateOf<Uri?>(null) }
    val gridReorderState = rememberGridReorderState()
    val currentPendingCameraFile by rememberUpdatedState(pendingCameraFile)

    fun openNextEditor(queue: List<String>) {
        if (queue.isEmpty()) {
            editorSourcePath = null
            editorQueue = emptyList()
            editorTotal = 0
            editorExistingIndex = -1
            return
        }
        editorSourcePath = queue.first()
        editorQueue = queue.drop(1)
        editorExistingIndex = -1
    }

    fun editImported(paths: List<String>) {
        if (paths.isEmpty()) return
        editorTotal = paths.size
        openNextEditor(paths)
    }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val uri = pendingCameraUri
        val file = pendingCameraFile
        if (success && uri != null) {
            importing = true
            scope.launch {
                editImported(viewModel.importImages(listOf(uri)))
                importing = false
                file?.let(viewModel.imageStore::cleanupCameraFile)
                pendingCameraFile = null
                pendingCameraUri = null
            }
        } else {
            file?.let(viewModel.imageStore::cleanupCameraFile)
            pendingCameraFile = null
            pendingCameraUri = null
        }
    }

    fun openCamera() {
        val (file, uri) = viewModel.imageStore.createCameraTarget()
        pendingCameraFile = file
        pendingCameraUri = uri
        takePicture.launch(uri)
    }

    val cameraPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            openCamera()
        } else {
            viewModel.notify(
                locale.text(
                    "Camera permission was denied.",
                    "Доступ к камере не предоставлен.",
                ),
            )
        }
    }

    val pickImages = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(60),
    ) { uris ->
        if (uris.isNotEmpty()) {
            importing = true
            scope.launch {
                editImported(viewModel.importImages(uris))
                importing = false
            }
        }
    }

    fun launchCamera() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            openCamera()
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    fun launchGallery() {
        pickImages.launch(
            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
        )
    }

    DisposableEffect(Unit) {
        onDispose {
            currentPendingCameraFile?.let(viewModel.imageStore::cleanupCameraFile)
        }
    }

    StoryScaffold(
        title = locale.text("Add a Book", "Новая книга"),
        onBack = onBack,
        snackbarHostState = snackbarHostState,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            if (imagePaths.isEmpty()) {
                EmptyCaptureTray(
                    locale = locale,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                )
            } else {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        locale.pageCount(imagePaths.size),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        locale.text("Reading order", "Порядок чтения"),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
                BoxWithConstraints(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                ) {
                    val columns = maxOf(
                        1,
                        floor(
                            (maxWidth.value - 32f + ReorderMath.GridGap) /
                                (ReorderMath.ThumbnailSize + ReorderMath.GridGap),
                        ).toInt(),
                    )
                    val gridWidth =
                        columns * ReorderMath.ThumbnailSize +
                            (columns - 1) * ReorderMath.GridGap
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(columns),
                        modifier = Modifier
                            .padding(horizontal = 16.dp)
                            .width(gridWidth.dp)
                            .fillMaxHeight(),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            bottom = 12.dp,
                        ),
                        horizontalArrangement = Arrangement.spacedBy(ReorderMath.GridGap.dp),
                        verticalArrangement = Arrangement.spacedBy(ReorderMath.GridGap.dp),
                    ) {
                        itemsIndexed(
                            items = imagePaths,
                            key = { _, path -> path },
                        ) { index, path ->
                            ReorderableGridItem(
                                id = path,
                                index = index,
                                columns = columns,
                                totalCount = imagePaths.size,
                                horizontalSlot =
                                    ReorderMath.ThumbnailSize + ReorderMath.GridGap,
                                verticalSlot =
                                    ReorderMath.ThumbnailSize + ReorderMath.GridGap,
                                state = gridReorderState,
                                modifier = if (gridReorderState.settlingId == path) {
                                    Modifier
                                } else {
                                    Modifier.animateItem(
                                        fadeInSpec = null,
                                        fadeOutSpec = null,
                                        placementSpec = tween(220, easing = EaseOutCubic),
                                    )
                                },
                                onReorder = { from, to ->
                                    val page = imagePaths.removeAt(from)
                                    imagePaths.add(to, page)
                                },
                            ) {
                                PageThumbnail(
                                    path = path,
                                    index = index,
                                    locale = locale,
                                    onSelect = {
                                        editorTotal = 0
                                        editorQueue = emptyList()
                                        editorExistingIndex = index
                                        editorSourcePath = path
                                    },
                                    onRemove = {
                                        val removed = imagePaths.removeAt(index)
                                        scope.launch { viewModel.imageStore.delete(removed) }
                                    },
                                )
                            }
                        }
                    }
                }
            }

            if (importing) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text(
                        locale.text("Adding pages…", "Добавляем страницы…"),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            CaptureFooter(
                locale = locale,
                hasPages = imagePaths.isNotEmpty(),
                enabled = !importing && !creating,
                pageCount = imagePaths.size,
                onCamera = ::launchCamera,
                onGallery = ::launchGallery,
                onDone = { showBookDetails = true },
                onDictateInstead = onDictateInstead,
            )
        }
    }

    if (showBookDetails) {
        BookDetailsDialog(
            locale = locale,
            pageCount = imagePaths.size,
            title = title,
            onTitleChange = { title = it },
            language = language,
            onLanguageChange = { language = it },
            creating = creating,
            onDismiss = {
                if (!creating) showBookDetails = false
            },
            onCreate = {
                creating = true
                scope.launch {
                    val resolvedTitle = title.trim().ifBlank {
                        locale.text("Untitled Book", "Книга без названия")
                    }
                    val created = viewModel.createPhotoBook(
                        resolvedTitle,
                        language,
                        imagePaths.toList(),
                    )
                    creating = false
                    if (created != null) showBookDetails = false
                }
            },
        )
    }
    editorSourcePath?.let { sourcePath ->
        NativePhotoEditorDialog(
            imageStore = viewModel.imageStore,
            sourcePath = sourcePath,
            locale = locale,
            queueIndex = if (editorTotal > 1) editorTotal - editorQueue.size else null,
            queueTotal = editorTotal.takeIf { it > 1 },
            onDismiss = {
                if (editorExistingIndex < 0) {
                    scope.launch { viewModel.imageStore.delete(sourcePath) }
                }
                openNextEditor(editorQueue)
            },
            onSaved = { editedPath, _ ->
                if (editorExistingIndex >= 0) {
                    imagePaths[editorExistingIndex] = editedPath
                } else {
                    imagePaths += editedPath
                }
                scope.launch { viewModel.imageStore.delete(sourcePath) }
                openNextEditor(editorQueue)
            },
        )
    }
}

@Composable
private fun EmptyCaptureTray(
    locale: UiLocale,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(width = 116.dp, height = 150.dp)
                    .background(
                        MaterialTheme.colorScheme.surfaceVariant,
                        RoundedCornerShape(12.dp),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.AddAPhoto,
                    contentDescription = null,
                    modifier = Modifier.size(40.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .55f),
                )
            }
            Text(
                locale.text("No pages yet", "Страниц пока нет"),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                locale.text(
                    "Start with the cover, then add pages in reading order.",
                    "Начните с обложки, затем добавьте страницы по порядку.",
                ),
                modifier = Modifier.fillMaxWidth(.78f),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun CaptureFooter(
    locale: UiLocale,
    hasPages: Boolean,
    enabled: Boolean,
    pageCount: Int,
    onCamera: () -> Unit,
    onGallery: () -> Unit,
    onDone: () -> Unit,
    onDictateInstead: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.background,
        shadowElevation = 0.dp,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CaptureAction(
                    title = locale.text(
                        if (hasPages) "Next photo" else "Camera",
                        if (hasPages) "Следующее фото" else "Камера",
                    ),
                    caption = locale.text("Camera", "С камеры"),
                    icon = Icons.Rounded.CameraAlt,
                    enabled = enabled,
                    modifier = Modifier.weight(1f),
                    onClick = onCamera,
                )
                CaptureAction(
                    title = locale.text(
                        if (hasPages) "Add pictures" else "Gallery",
                        if (hasPages) "Добавить снимки" else "Галерея",
                    ),
                    caption = locale.text("Gallery or files", "Галерея или файлы"),
                    icon = Icons.Rounded.PhotoLibrary,
                    enabled = enabled,
                    modifier = Modifier.weight(1f),
                    onClick = onGallery,
                )
            }
            if (hasPages) {
                BloomPrimaryButton(
                    text = locale.text(
                        "Done · $pageCount",
                        "Готово · $pageCount",
                    ),
                    onClick = onDone,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = enabled,
                )
            } else {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = enabled, onClick = onDictateInstead),
                    color = Color.Transparent,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(vertical = 11.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Rounded.Mic,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            locale.text("Tell a story instead", "Рассказать историю"),
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CaptureAction(
    title: String,
    caption: String,
    icon: ImageVector,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val outlineColor = MaterialTheme.colorScheme.outline.copy(alpha = .62f)
    val contentColor = if (enabled) {
        MaterialTheme.colorScheme.onSurface
    } else {
        MaterialTheme.colorScheme.onSurface.copy(alpha = .38f)
    }
    Surface(
        modifier = modifier
            .aspectRatio(1.55f)
            .clickable(enabled = enabled, onClick = onClick),
        color = MaterialTheme.colorScheme.surface,
        contentColor = contentColor,
        shape = RoundedCornerShape(14.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, outlineColor),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = if (enabled) BloomBlue else contentColor,
                modifier = Modifier.size(30.dp),
            )
            Spacer(Modifier.height(7.dp))
            Text(
                title,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Text(
                caption,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelSmall,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun PageThumbnail(
    path: String,
    index: Int,
    locale: UiLocale,
    onSelect: () -> Unit,
    onRemove: () -> Unit,
) {
    Column(
        modifier = Modifier.width(ReorderMath.ThumbnailSize.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val shape = RoundedCornerShape(12.dp)
        Box(
            modifier = Modifier
                .size(ReorderMath.ThumbnailSize.dp)
                .clip(shape)
                .border(
                    width = 1.dp,
                    color = MaterialTheme.colorScheme.outline.copy(alpha = .55f),
                    shape = shape,
                )
                .clickable(onClick = onSelect),
        ) {
            NativeImage(
                path = path,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
                contentDescription = locale.text(
                    "Page ${index + 1}",
                    "Страница ${index + 1}",
                ),
            )
            Text(
                "${index + 1}",
                modifier = Modifier
                    .padding(7.dp)
                    .background(Color.Black.copy(alpha = .68f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                color = Color.White,
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.labelMedium,
            )
            IconButton(
                onClick = onRemove,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(3.dp)
                    .size(38.dp)
                    .background(Color.Black.copy(alpha = .58f), RoundedCornerShape(10.dp)),
            ) {
                Icon(
                    Icons.Rounded.Delete,
                    contentDescription = locale.text("Remove page", "Удалить страницу"),
                    tint = Color.White,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        /*
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            IconButton(
                onClick = onMoveEarlier,
                enabled = canMoveEarlier,
            ) {
                Icon(
                    Icons.Rounded.ArrowBack,
                    contentDescription = locale.text("Move earlier", "Переместить раньше"),
                )
            }
            IconButton(
                onClick = onMoveLater,
                enabled = canMoveLater,
            ) {
                Icon(
                    Icons.Rounded.ArrowForward,
                    contentDescription = locale.text("Move later", "Переместить позже"),
                )
            }
        }
        */
        Text(
            text = (index + 1).toString(),
            modifier = Modifier.padding(top = 4.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

@Composable
private fun BookDetailsDialog(
    locale: UiLocale,
    pageCount: Int,
    title: String,
    onTitleChange: (String) -> Unit,
    language: BookLanguage,
    onLanguageChange: (BookLanguage) -> Unit,
    creating: Boolean,
    onDismiss: () -> Unit,
    onCreate: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            dismissOnBackPress = !creating,
            dismissOnClickOutside = !creating,
        ),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.background,
            shape = RoundedCornerShape(20.dp),
            shadowElevation = 4.dp,
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        locale.text("Name this book", "Назовите книгу"),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        locale.pageCount(pageCount),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedTextField(
                    value = title,
                    onValueChange = onTitleChange,
                    modifier = Modifier.fillMaxWidth(),
                    label = {
                        Text(locale.text("Book title", "Название книги"))
                    },
                    placeholder = {
                        Text(locale.text("Untitled Book", "Книга без названия"))
                    },
                    singleLine = true,
                    enabled = !creating,
                    shape = RoundedCornerShape(12.dp),
                )
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        locale.text("Printed language", "Язык текста"),
                        fontWeight = FontWeight.SemiBold,
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        LanguageChoice(
                            label = "English",
                            selected = language == BookLanguage.ENGLISH,
                            enabled = !creating,
                            modifier = Modifier.weight(1f),
                            onClick = { onLanguageChange(BookLanguage.ENGLISH) },
                        )
                        LanguageChoice(
                            label = "Русский",
                            selected = language == BookLanguage.RUSSIAN,
                            enabled = !creating,
                            modifier = Modifier.weight(1f),
                            onClick = { onLanguageChange(BookLanguage.RUSSIAN) },
                        )
                    }
                }
                BloomPrimaryButton(
                    text = locale.text(
                        "Create book",
                        "Создать книгу",
                    ),
                    onClick = onCreate,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !creating,
                    leading = {
                        if (creating) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = Color.White,
                                strokeWidth = 2.dp,
                            )
                        }
                    },
                )
                Text(
                    locale.text("Cancel", "Отмена"),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = !creating, onClick = onDismiss)
                        .padding(vertical = 8.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

@Composable
private fun LanguageChoice(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(10.dp)
    Surface(
        modifier = modifier
            .height(48.dp)
            .clickable(enabled = enabled, onClick = onClick),
        color = if (selected) {
            BloomBlue.copy(alpha = .14f)
        } else {
            MaterialTheme.colorScheme.surface
        },
        contentColor = if (selected) BloomBlue else MaterialTheme.colorScheme.onSurface,
        shape = shape,
        border = androidx.compose.foundation.BorderStroke(
            width = if (selected) 1.5.dp else 1.dp,
            color = if (selected) BloomBlue else MaterialTheme.colorScheme.outline.copy(alpha = .68f),
        ),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(label, fontWeight = FontWeight.SemiBold)
        }
    }
}

private fun UiLocale.pageCount(count: Int): String {
    if (this == UiLocale.ENGLISH) {
        return if (count == 1) "1 page" else "$count pages"
    }
    val mod100 = count % 100
    val mod10 = count % 10
    val noun = when {
        mod100 in 11..14 -> "страниц"
        mod10 == 1 -> "страница"
        mod10 in 2..4 -> "страницы"
        else -> "страниц"
    }
    return "$count $noun"
}
