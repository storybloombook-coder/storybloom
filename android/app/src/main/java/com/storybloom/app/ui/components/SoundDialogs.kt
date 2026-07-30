package com.storybloom.app.ui.components

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Casino
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import com.storybloom.app.audio.AudioRecorder
import com.storybloom.app.audio.RecordedClip
import com.storybloom.app.audio.SoundLibrary
import com.storybloom.app.data.Book
import com.storybloom.app.data.Recording
import com.storybloom.app.data.TrimEnvelope
import com.storybloom.app.ui.StorybloomViewModel
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.text
import com.storybloom.app.ui.theme.BloomBlue
import com.storybloom.app.ui.theme.BloomCoral
import com.storybloom.app.ui.theme.BloomGreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sin

enum class SoundPickerMode {
    EFFECT,
    AMBIENT,
}

data class RecordingOrigin(
    val book: Book?,
    val pageNumber: Int?,
    val label: String?,
)

@Composable
fun SoundPickerDialog(
    viewModel: StorybloomViewModel,
    locale: UiLocale,
    mode: SoundPickerMode,
    currentSoundId: String?,
    origin: RecordingOrigin,
    onDismiss: () -> Unit,
    onChoose: (TrimEnvelope?) -> Unit,
) {
    var search by remember { mutableStateOf("") }
    var category by remember {
        mutableStateOf(if (mode == SoundPickerMode.EFFECT) SoundLibrary.effectCategories.first().label else "Ambient")
    }
    var recordingOpen by remember { mutableStateOf(false) }
    val revision by viewModel.repository.revision.collectAsState()
    var recordings by remember { mutableStateOf<List<Recording>>(emptyList()) }
    LaunchedEffect(revision) {
        recordings = viewModel.repository.listRecordings()
    }
    val libraryIds = when (mode) {
        SoundPickerMode.AMBIENT -> SoundLibrary.ambientIds
        SoundPickerMode.EFFECT -> SoundLibrary.effectCategories
            .firstOrNull { it.label == category }
            ?.soundIds
            .orEmpty()
    }.filter { id ->
        id.contains(search.trim(), ignoreCase = true) ||
            SoundLibrary.label(id).contains(search.trim(), ignoreCase = true)
    }
    val visibleRecordings = recordings.filter {
        search.isBlank() || it.name.contains(search.trim(), ignoreCase = true)
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(.94f).fillMaxHeight(.88f),
            shape = RoundedCornerShape(28.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
        ) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            if (mode == SoundPickerMode.AMBIENT) {
                                locale.text("Choose ambience", "Выбрать фон")
                            } else {
                                locale.text("Choose a sound", "Выбрать звук")
                            },
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.ExtraBold,
                        )
                        Text(
                            locale.text("Tap ▶ to preview", "Нажмите ▶ для прослушивания"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(
                            Icons.Rounded.Close,
                            contentDescription = locale.text("Close", "Закрыть"),
                        )
                    }
                }
                OutlinedTextField(
                    value = search,
                    onValueChange = { search = it },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    singleLine = true,
                    shape = RoundedCornerShape(17.dp),
                    leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
                    placeholder = { Text(locale.text("Search sounds", "Найти звук")) },
                )
                if (mode == SoundPickerMode.EFFECT) {
                    LazyRow(
                        modifier = Modifier.padding(vertical = 10.dp),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(7.dp),
                    ) {
                        items(SoundLibrary.effectCategories, key = { it.label }) { item ->
                            FilterChip(
                                selected = category == item.label,
                                onClick = { category = item.label },
                                label = { Text(localizedCategory(item.label, locale)) },
                            )
                        }
                    }
                } else {
                    Spacer(Modifier.height(10.dp))
                }
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(
                        start = 16.dp,
                        end = 16.dp,
                        bottom = 12.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            AssistChip(
                                onClick = {
                                    val lucky = if (mode == SoundPickerMode.AMBIENT) {
                                        SoundLibrary.randomAmbient(currentSoundId)
                                    } else {
                                        SoundLibrary.randomEffect(currentSoundId)
                                    }
                                    viewModel.audioEngine.preview(lucky)
                                    onChoose(TrimEnvelope(lucky))
                                },
                                label = { Text(locale.text("Feeling lucky", "Мне повезёт")) },
                                leadingIcon = { Icon(Icons.Rounded.Casino, contentDescription = null) },
                            )
                            AssistChip(
                                onClick = { recordingOpen = true },
                                label = { Text(locale.text("Record", "Записать")) },
                                leadingIcon = { Icon(Icons.Rounded.Mic, contentDescription = null) },
                            )
                            if (currentSoundId != null) {
                                AssistChip(
                                    onClick = { onChoose(null) },
                                    label = { Text(locale.text("Remove", "Убрать")) },
                                    leadingIcon = { Icon(Icons.Rounded.Delete, contentDescription = null) },
                                )
                            }
                        }
                    }
                    item {
                        Text(
                            locale.text("Built-in library", "Встроенная библиотека"),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.ExtraBold,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                    }
                    items(libraryIds, key = { it }) { id ->
                        SoundRow(
                            title = SoundLibrary.label(id),
                            subtitle = if (mode == SoundPickerMode.AMBIENT) {
                                locale.text("Included ambience", "Встроенный фон")
                            } else {
                                locale.text("Included sound", "Встроенный звук")
                            },
                            selected = currentSoundId == id,
                            previewDescription = locale.text("Preview", "Прослушать"),
                            onPreview = { viewModel.audioEngine.preview(id) },
                            onChoose = { onChoose(TrimEnvelope(id)) },
                        )
                    }
                    item {
                        Text(
                            locale.text("My recordings", "Мои записи"),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.ExtraBold,
                            modifier = Modifier.padding(top = 10.dp),
                        )
                    }
                    if (visibleRecordings.isEmpty()) {
                        item {
                            Text(
                                locale.text(
                                    "Record your own sound and it will appear here.",
                                    "Запишите свой звук — он появится здесь.",
                                ),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(vertical = 12.dp),
                            )
                        }
                    } else {
                        items(visibleRecordings, key = { it.id }) { recording ->
                            val envelope = TrimEnvelope(
                                soundId = "custom:${recording.fileUri}",
                                startMs = recording.startMs,
                                endMs = recording.endMs,
                                fadeInMs = recording.fadeInMs,
                                fadeOutMs = recording.fadeOutMs,
                            )
                            SoundRow(
                                title = recording.name,
                                subtitle = recording.originLabel?.let {
                                    locale.text("Recorded for “$it”", "Записано для «$it»")
                                } ?: locale.text("Custom recording", "Своя запись"),
                                selected = currentSoundId == envelope.soundId,
                                previewDescription = locale.text("Preview", "Прослушать"),
                                onPreview = { viewModel.audioEngine.playEffect(envelope) },
                                onChoose = { onChoose(envelope) },
                            )
                        }
                    }
                }
            }
        }
    }

    if (recordingOpen) {
        RecordSoundDialog(
            viewModel = viewModel,
            locale = locale,
            origin = origin,
            onDismiss = { recordingOpen = false },
            onSaved = { envelope ->
                recordingOpen = false
                onChoose(envelope)
            },
        )
    }
}

@Composable
private fun SoundRow(
    title: String,
    subtitle: String,
    selected: Boolean,
    previewDescription: String,
    onPreview: () -> Unit,
    onChoose: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onChoose),
        shape = RoundedCornerShape(17.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .58f)
            },
        ),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                Modifier.size(42.dp).background(BloomBlue.copy(alpha = .16f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                IconButton(onClick = onPreview) {
                    Icon(Icons.Rounded.PlayArrow, previewDescription, tint = BloomBlue)
                }
            }
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.Bold)
                Text(
                    subtitle,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (selected) Icon(Icons.Rounded.Check, contentDescription = null, tint = BloomGreen)
        }
    }
}

@Composable
fun RecordSoundDialog(
    viewModel: StorybloomViewModel,
    locale: UiLocale,
    origin: RecordingOrigin,
    existing: Recording? = null,
    onDismiss: () -> Unit,
    onSaved: (TrimEnvelope) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val recorder = remember { AudioRecorder(context.applicationContext) }
    var name by remember { mutableStateOf(existing?.name ?: origin.label.orEmpty()) }
    var recording by remember { mutableStateOf(false) }
    var startedAt by remember { mutableLongStateOf(0L) }
    var elapsed by remember { mutableLongStateOf(0L) }
    var clip by remember {
        mutableStateOf(
            existing?.let {
                RecordedClip(it.fileUri, it.durationMs ?: 0L)
            },
        )
    }
    var trim by remember {
        mutableStateOf(
            (existing?.startMs ?: 0L).toFloat()..(existing?.endMs ?: existing?.durationMs ?: 1L).toFloat(),
        )
    }
    var fadeIn by remember { mutableStateOf((existing?.fadeInMs ?: 30L).toFloat()) }
    var fadeOut by remember { mutableStateOf((existing?.fadeOutMs ?: 120L).toFloat()) }

    fun startRecording() {
        runCatching {
            recorder.start()
            startedAt = System.currentTimeMillis()
            elapsed = 0
            recording = true
        }.onFailure {
            viewModel.notify(
                locale.text(
                    "Recording could not start. Check microphone access and try again.",
                    "Не удалось начать запись. Проверьте доступ к микрофону и попробуйте ещё раз.",
                ),
            )
        }
    }

    fun stopRecording() {
        val captured = recorder.stop()
        recording = false
        if (captured != null) {
            clip = captured
            trim = 0f..captured.durationMs.toFloat().coerceAtLeast(1f)
            fadeIn = min(120f, captured.durationMs * .15f)
            fadeOut = min(180f, captured.durationMs * .20f)
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (it) startRecording()
        else viewModel.notify(locale.text("Microphone permission was denied.", "Нет доступа к микрофону."))
    }

    LaunchedEffect(recording) {
        while (recording) {
            elapsed = System.currentTimeMillis() - startedAt
            delay(100)
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            if (recorder.isRecording) recorder.cancel()
        }
    }

    AlertDialog(
        onDismissRequest = {
            if (recording) recorder.cancel()
            onDismiss()
        },
        title = {
            Text(
                if (existing == null) locale.text("Record a sound", "Записать звук")
                else locale.text("Edit recording", "Изменить запись"),
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text(locale.text("Sound name", "Название звука")) },
                )
                Box(
                    Modifier.fillMaxWidth().height(92.dp)
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(18.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    if (clip != null) {
                        WaveformPreview(
                            seed = clip!!.fileUri.hashCode(),
                            trim = trim,
                            duration = clip!!.durationMs.toFloat().coerceAtLeast(1f),
                        )
                    } else {
                        Text(
                            if (recording) formatDuration(elapsed)
                            else locale.text("Ready to record", "Готово к записи"),
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
                BloomPrimaryButton(
                    text = when {
                        recording -> locale.text("Stop recording", "Остановить запись")
                        clip == null -> locale.text("Start recording", "Начать запись")
                        else -> locale.text("Record again", "Записать снова")
                    },
                    onClick = {
                        if (recording) {
                            stopRecording()
                        } else {
                            if (clip != null && existing == null) {
                                Uri.parse(clip!!.fileUri).path?.let { File(it).delete() }
                                clip = null
                            }
                            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                                PackageManager.PERMISSION_GRANTED
                            ) {
                                startRecording()
                            } else {
                                permission.launch(Manifest.permission.RECORD_AUDIO)
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    color = if (recording) BloomCoral else BloomBlue,
                    leading = {
                        Icon(if (recording) Icons.Rounded.Stop else Icons.Rounded.Mic, contentDescription = null)
                    },
                )
                val currentClip = clip
                if (currentClip != null) {
                    Text(
                        locale.text("Trim", "Обрезка"),
                        fontWeight = FontWeight.Bold,
                    )
                    RangeSlider(
                        value = trim,
                        onValueChange = {
                            trim = it.start.coerceAtLeast(0f)..it.endInclusive.coerceAtMost(currentClip.durationMs.toFloat())
                        },
                        valueRange = 0f..currentClip.durationMs.toFloat().coerceAtLeast(1f),
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(formatDuration(trim.start.toLong()), style = MaterialTheme.typography.labelMedium)
                        Text(formatDuration(trim.endInclusive.toLong()), style = MaterialTheme.typography.labelMedium)
                    }
                    Text(locale.text("Fade in · ${fadeIn.toInt()} ms", "Плавное начало · ${fadeIn.toInt()} мс"))
                    Slider(
                        value = fadeIn,
                        onValueChange = { fadeIn = it },
                        valueRange = 0f..min(2_000f, (trim.endInclusive - trim.start) / 2f).coerceAtLeast(1f),
                    )
                    Text(locale.text("Fade out · ${fadeOut.toInt()} ms", "Плавный конец · ${fadeOut.toInt()} мс"))
                    Slider(
                        value = fadeOut,
                        onValueChange = { fadeOut = it },
                        valueRange = 0f..min(2_000f, (trim.endInclusive - trim.start) / 2f).coerceAtLeast(1f),
                    )
                    OutlinedButton(
                        onClick = {
                            viewModel.audioEngine.playEffect(
                                TrimEnvelope(
                                    "custom:${currentClip.fileUri}",
                                    trim.start.toLong(),
                                    trim.endInclusive.toLong(),
                                    fadeIn.toLong(),
                                    fadeOut.toLong(),
                                ),
                            )
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Rounded.PlayArrow, contentDescription = null)
                        Text(locale.text("Preview selection", "Прослушать фрагмент"))
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = clip != null && name.isNotBlank() && !recording,
                onClick = {
                    val savedClip = clip ?: return@TextButton
                    val envelope = TrimEnvelope(
                        "custom:${savedClip.fileUri}",
                        trim.start.toLong(),
                        trim.endInclusive.toLong(),
                        fadeIn.toLong(),
                        fadeOut.toLong(),
                    )
                    scope.launch {
                        if (existing == null) {
                            viewModel.repository.createRecording(
                                name = name.trim(),
                                fileUri = savedClip.fileUri,
                                durationMs = savedClip.durationMs,
                                startMs = envelope.startMs,
                                endMs = envelope.endMs,
                                fadeInMs = envelope.fadeInMs,
                                fadeOutMs = envelope.fadeOutMs,
                                originBookId = origin.book?.id,
                                originBookTitle = origin.book?.title,
                                originPageNumber = origin.pageNumber,
                                originLabel = origin.label,
                            )
                        } else {
                            viewModel.repository.renameRecording(existing.id, name.trim())
                            viewModel.repository.updateRecording(existing.id, envelope, savedClip.durationMs)
                        }
                        onSaved(envelope)
                    }
                },
            ) { Text(locale.text("Save", "Сохранить")) }
        },
        dismissButton = {
            TextButton(
                onClick = {
                    if (recording) recorder.cancel()
                    onDismiss()
                },
            ) { Text(locale.text("Cancel", "Отмена")) }
        },
    )
}

@Composable
private fun WaveformPreview(
    seed: Int,
    trim: ClosedFloatingPointRange<Float>,
    duration: Float,
) {
    val inactiveColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .22f)
    Canvas(Modifier.fillMaxSize().padding(horizontal = 10.dp, vertical = 14.dp)) {
        val bars = 54
        val barWidth = size.width / bars
        repeat(bars) { index ->
            val phase = seed * .00013f + index * .73f
            val level = .18f + abs(sin(phase) * sin(phase * .37f)) * .78f
            val x = index * barWidth + barWidth * .5f
            val time = index.toFloat() / (bars - 1) * duration
            val selected = time in trim
            drawLine(
                color = if (selected) BloomBlue else inactiveColor,
                start = Offset(x, size.height * (.5f - level * .45f)),
                end = Offset(x, size.height * (.5f + level * .45f)),
                strokeWidth = barWidth * .50f,
            )
        }
    }
}

private fun formatDuration(ms: Long): String {
    val totalSeconds = ms / 1_000f
    return "%.1fs".format(totalSeconds)
}

private fun localizedCategory(category: String, locale: UiLocale): String = when (category) {
    "Animals" -> locale.text("Animals", "Животные")
    "Vehicles" -> locale.text("Vehicles", "Транспорт")
    "Nature & weather" -> locale.text("Nature & weather", "Природа и погода")
    "Household & objects" -> locale.text("Home & objects", "Дом и предметы")
    "Human & body" -> locale.text("People", "Люди")
    "Toys, fun & games" -> locale.text("Toys & games", "Игрушки и игры")
    "Music & bells" -> locale.text("Music & bells", "Музыка и колокольчики")
    "Impact & misc" -> locale.text("Other", "Другое")
    else -> category
}
