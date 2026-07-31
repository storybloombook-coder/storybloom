package com.storybloom.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.storybloom.app.data.Recording
import com.storybloom.app.data.TrimEnvelope
import com.storybloom.app.audio.EffectPlayback
import com.storybloom.app.ui.StorybloomViewModel
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.components.EmptyState
import com.storybloom.app.ui.components.RecordSoundDialog
import com.storybloom.app.ui.components.RecordingOrigin
import com.storybloom.app.ui.components.StoryScaffold
import com.storybloom.app.ui.components.StoryButton
import com.storybloom.app.ui.components.SwipeRevealRow
import com.storybloom.app.ui.text
import com.storybloom.app.ui.theme.BloomCoral
import kotlinx.coroutines.launch

private enum class RecordingFilter {
    ALL,
    AMBIENT,
    SOUND,
}

@Composable
fun RecordingsScreen(
    viewModel: StorybloomViewModel,
    locale: UiLocale,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
) {
    val revision by viewModel.repository.revision.collectAsState()
    var recordings by remember { mutableStateOf<List<Recording>>(emptyList()) }
    var search by remember { mutableStateOf("") }
    var editTarget by remember { mutableStateOf<Recording?>(null) }
    var deleteTarget by remember { mutableStateOf<Recording?>(null) }
    var createKind by remember { mutableStateOf<RecordingFilter?>(null) }
    var kindFilter by remember { mutableStateOf(RecordingFilter.ALL) }
    var previewingId by remember { mutableStateOf<String?>(null) }
    var previewPlayback by remember { mutableStateOf<EffectPlayback?>(null) }
    val scope = rememberCoroutineScope()

    fun stopPreview() {
        previewPlayback?.stop()
        previewPlayback = null
        previewingId = null
    }

    fun togglePreview(recording: Recording) {
        if (previewingId == recording.id) {
            stopPreview()
            return
        }
        stopPreview()
        previewingId = recording.id
        previewPlayback = viewModel.audioEngine.playEffectControlled(
            envelope = recording.envelope(),
            onComplete = {
                if (previewingId == recording.id) {
                    previewPlayback = null
                    previewingId = null
                }
            },
        )
    }

    DisposableEffect(Unit) {
        onDispose { previewPlayback?.stop() }
    }

    LaunchedEffect(revision) {
        recordings = viewModel.repository.listRecordings()
    }
    val visible = recordings.filter {
        val searchMatches =
            search.isBlank() || it.name.contains(search.trim(), ignoreCase = true) ||
                it.originLabel.orEmpty().contains(search.trim(), ignoreCase = true)
        val ambient = it.originLabel == "Ambient"
        val kindMatches = when (kindFilter) {
            RecordingFilter.ALL -> true
            RecordingFilter.AMBIENT -> ambient
            RecordingFilter.SOUND -> !ambient
        }
        searchMatches && kindMatches
    }

    StoryScaffold(
        title = locale.text("My recordings", "Мои записи"),
        onBack = onBack,
        snackbarHostState = snackbarHostState,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                singleLine = true,
                shape = RoundedCornerShape(18.dp),
                leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
                placeholder = { Text(locale.text("Search recordings", "Найти запись")) },
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RecordingFilter.entries.forEach { filter ->
                    FilterChip(
                        selected = kindFilter == filter,
                        onClick = { kindFilter = filter },
                        label = {
                            Text(
                                when (filter) {
                                    RecordingFilter.ALL -> locale.text("All", "Все")
                                    RecordingFilter.AMBIENT -> locale.text("Ambient", "Фон")
                                    RecordingFilter.SOUND -> locale.text("Sounds", "Звуки")
                                },
                            )
                        },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            if (recordings.isEmpty()) {
                EmptyState(
                    title = locale.text("No recordings yet", "Записей пока нет"),
                    message = locale.text(
                        "Record voices, effects or ambience and reuse them anywhere.",
                        "Записывайте голоса, эффекты или фон и используйте их снова.",
                    ),
                    actionText = locale.text("Record a sound", "Записать звук"),
                    onAction = { createKind = RecordingFilter.SOUND },
                    modifier = Modifier.weight(1f),
                )
            } else if (visible.isEmpty()) {
                EmptyState(
                    title = locale.text("No matching recordings", "Подходящих записей нет"),
                    message = locale.text(
                        "Try another search or filter.",
                        "Попробуйте другой поиск или фильтр.",
                    ),
                    modifier = Modifier.weight(1f),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(
                        start = 16.dp,
                        end = 16.dp,
                        bottom = 12.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(visible, key = { it.id }) { recording ->
                        SwipeRevealRow(
                            onDelete = { deleteTarget = recording },
                            deleteDescription = locale.text("Delete", "Удалить"),
                        ) {
                        Card(
                            modifier = Modifier.fillMaxWidth().clickable {
                                togglePreview(recording)
                            },
                            shape = RoundedCornerShape(20.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        ) {
                            Row(
                                Modifier.fillMaxWidth().padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                IconButton(onClick = {
                                    togglePreview(recording)
                                }) {
                                    Icon(
                                        if (previewingId == recording.id) Icons.Rounded.Stop
                                        else Icons.Rounded.PlayArrow,
                                        locale.text("Play", "Слушать"),
                                    )
                                }
                                Column(Modifier.weight(1f)) {
                                    Text(recording.name, fontWeight = FontWeight.ExtraBold)
                                    Text(
                                        recording.originDescription(locale),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        formatDuration(recording),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                }
                                IconButton(onClick = {
                                    stopPreview()
                                    editTarget = recording
                                }) {
                                    Icon(Icons.Rounded.Edit, locale.text("Edit", "Изменить"))
                                }
                                /*
                                IconButton(onClick = { deleteTarget = recording }) {
                                    Icon(
                                        Icons.Rounded.Delete,
                                        locale.text("Delete", "Удалить"),
                                        tint = MaterialTheme.colorScheme.error,
                                    )
                                }
                                */
                            }
                        }
                        }
                    }
                }
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StoryButton(
                    text = locale.text("Record ambience", "Записать фон"),
                    onClick = {
                        stopPreview()
                        createKind = RecordingFilter.AMBIENT
                    },
                    modifier = Modifier.weight(1f),
                    containerColor = BloomCoral.copy(alpha = .16f),
                    contentColor = BloomCoral,
                    leading = {
                        Icon(
                            Icons.Rounded.MusicNote,
                            contentDescription = null,
                            tint = BloomCoral,
                        )
                    },
                )
                StoryButton(
                    text = locale.text("Record a sound", "Записать звук"),
                    onClick = {
                        stopPreview()
                        createKind = RecordingFilter.SOUND
                    },
                    modifier = Modifier.weight(1f),
                    containerColor = BloomCoral.copy(alpha = .16f),
                    contentColor = BloomCoral,
                    leading = {
                        Icon(
                            Icons.Rounded.GraphicEq,
                            contentDescription = null,
                            tint = BloomCoral,
                        )
                    },
                )
            }
        }
    }

    createKind?.let { kind ->
        RecordSoundDialog(
            viewModel = viewModel,
            locale = locale,
            origin = RecordingOrigin(
                null,
                null,
                if (kind == RecordingFilter.AMBIENT) "Ambient" else "Sound effect",
            ),
            onDismiss = { createKind = null },
            onSaved = { createKind = null },
        )
    }
    editTarget?.let { recording ->
        RecordSoundDialog(
            viewModel = viewModel,
            locale = locale,
            origin = RecordingOrigin(null, recording.originPageNumber, recording.originLabel),
            existing = recording,
            onDismiss = { editTarget = null },
            onSaved = { editTarget = null },
        )
    }
    deleteTarget?.let { recording ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text(locale.text("Delete recording?", "Удалить запись?")) },
            text = {
                Text(
                    locale.text(
                        "Placed copies keep working; this removes “${recording.name}” from your reusable list.",
                        "Уже добавленные звуки продолжат работать; «${recording.name}» исчезнет из списка.",
                    ),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        deleteTarget = null
                        if (previewingId == recording.id) stopPreview()
                        scope.launch { viewModel.repository.deleteRecording(recording.id) }
                    },
                ) { Text(locale.text("Delete", "Удалить"), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) { Text(locale.text("Cancel", "Отмена")) }
            },
        )
    }
}

private fun Recording.envelope() = TrimEnvelope(
    soundId = "custom:$fileUri",
    startMs = startMs,
    endMs = endMs,
    fadeInMs = fadeInMs,
    fadeOutMs = fadeOutMs,
)

private fun Recording.originDescription(locale: UiLocale): String {
    val details = listOfNotNull(
        originBookTitle,
        originPageNumber?.let { locale.text("page $it", "страница $it") },
        originLabel,
    )
    return if (details.isEmpty()) {
        locale.text("Standalone recording", "Отдельная запись")
    } else {
        details.joinToString(" · ")
    }
}

private fun formatDuration(recording: Recording): String {
    val from = recording.startMs ?: 0L
    val to = recording.endMs ?: recording.durationMs ?: 0L
    return "%.1f s".format((to - from).coerceAtLeast(0L) / 1_000f)
}
