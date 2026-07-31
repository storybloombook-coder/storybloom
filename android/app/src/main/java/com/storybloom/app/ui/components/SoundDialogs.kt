package com.storybloom.app.ui.components

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.view.HapticFeedbackConstants
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
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
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import com.storybloom.app.audio.AudioRecorder
import com.storybloom.app.audio.EffectPlayback
import com.storybloom.app.audio.RecordedClip
import com.storybloom.app.audio.SoundLibrary
import com.storybloom.app.data.Book
import com.storybloom.app.data.Recording
import com.storybloom.app.data.TrimEnvelope
import com.storybloom.app.ui.StorybloomViewModel
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.mechanics.WaveformTrimMath
import com.storybloom.app.ui.text
import com.storybloom.app.ui.theme.BloomBlue
import com.storybloom.app.ui.theme.BloomCoral
import com.storybloom.app.ui.theme.BloomGreen
import com.storybloom.app.vision.LocalCueAnalyzer
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt
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
    allowRemove: Boolean = true,
    onDismiss: () -> Unit,
    onChoose: (TrimEnvelope?) -> Unit,
) {
    var search by remember { mutableStateOf("") }
    var expandedSections by remember(mode) { mutableStateOf(setOf<String>()) }
    var recordingOpen by remember { mutableStateOf(false) }
    var previewingId by remember { mutableStateOf<String?>(null) }
    var previewPlayback by remember { mutableStateOf<EffectPlayback?>(null) }
    val revision by viewModel.repository.revision.collectAsState()
    var recordings by remember { mutableStateOf<List<Recording>>(emptyList()) }
    LaunchedEffect(revision) {
        recordings = viewModel.repository.listRecordings()
    }
    val allLibraryIds = if (mode == SoundPickerMode.AMBIENT) {
        SoundLibrary.ambientIds
    } else {
        SoundLibrary.effectIds
    }
    val libraryIds = allLibraryIds.filter { id ->
        id.contains(search.trim(), ignoreCase = true) ||
            SoundLibrary.label(id).contains(search.trim(), ignoreCase = true) ||
            LocalCueAnalyzer.soundMatchesSearch(
                soundId = id,
                query = search,
                ambient = mode == SoundPickerMode.AMBIENT,
            )
    }
    val suggestedIds = LocalCueAnalyzer.relatedSoundIds(
        query = if (mode == SoundPickerMode.EFFECT) origin.label.orEmpty() else "",
        ambient = mode == SoundPickerMode.AMBIENT,
        allowedIds = allLibraryIds,
    )
    val suggested = libraryIds.filter(suggestedIds::contains)
    val remainingIds = libraryIds.filterNot(suggestedIds::contains)
    val searching = search.isNotBlank()
    val visibleRecordings = recordings.filter {
        search.isBlank() ||
            it.name.contains(search.trim(), ignoreCase = true) ||
            it.originLabel?.contains(search.trim(), ignoreCase = true) == true ||
            it.originBookTitle?.contains(search.trim(), ignoreCase = true) == true
    }

    fun toggleSection(key: String) {
        expandedSections = if (key in expandedSections) {
            expandedSections - key
        } else {
            expandedSections + key
        }
    }

    fun stopPreview() {
        previewPlayback?.stop()
        previewPlayback = null
        previewingId = null
    }

    fun togglePreview(id: String, envelope: TrimEnvelope) {
        if (previewingId == id) {
            stopPreview()
            return
        }
        stopPreview()
        previewingId = id
        previewPlayback = viewModel.audioEngine.playEffectControlled(
            envelope = envelope,
            onComplete = {
                if (previewingId == id) {
                    previewPlayback = null
                    previewingId = null
                }
            },
        )
    }

    DisposableEffect(Unit) {
        onDispose { previewPlayback?.stop() }
    }

    Dialog(
        onDismissRequest = {
            stopPreview()
            onDismiss()
        },
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
                    IconButton(onClick = {
                        stopPreview()
                        onDismiss()
                    }) {
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
                Spacer(Modifier.height(10.dp))
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
                                onClick = {
                                    stopPreview()
                                    recordingOpen = true
                                },
                                label = { Text(locale.text("Record", "Записать")) },
                                leadingIcon = { Icon(Icons.Rounded.Mic, contentDescription = null) },
                            )
                            if (currentSoundId != null && allowRemove) {
                                AssistChip(
                                    onClick = {
                                        stopPreview()
                                        onChoose(null)
                                    },
                                    label = { Text(locale.text("Remove", "Убрать")) },
                                    leadingIcon = { Icon(Icons.Rounded.Delete, contentDescription = null) },
                                )
                            }
                        }
                    }
                    if (visibleRecordings.isNotEmpty()) {
                        val recordingsOpen = searching || "recordings" in expandedSections
                        item(key = "recordings-header") {
                            SoundSectionHeader(
                                title = locale.text("My recordings", "Мои записи"),
                                count = visibleRecordings.size,
                                expanded = recordingsOpen,
                                onClick = { toggleSection("recordings") },
                            )
                        }
                        if (recordingsOpen) {
                        items(visibleRecordings, key = { it.id }) { recording ->
                            val envelope = TrimEnvelope(
                                soundId = "custom:${recording.fileUri}",
                                startMs = recording.startMs,
                                endMs = recording.endMs,
                                fadeInMs = recording.fadeInMs,
                                fadeOutMs = recording.fadeOutMs,
                            )
                            val originParts = listOfNotNull(
                                recording.originBookTitle?.let { "“$it”" },
                                recording.originPageNumber?.let {
                                    locale.text("p. $it", "стр. $it")
                                },
                                recording.originLabel?.let {
                                    if (it == "Ambient") {
                                        locale.text("Ambient", "Фон")
                                    } else {
                                        "“$it”"
                                    }
                                },
                            )
                            SoundRow(
                                title = recording.name,
                                subtitle = originParts.joinToString(" · ")
                                    .ifBlank {
                                        locale.text("Custom recording", "Своя запись")
                                    },
                                selected = currentSoundId == envelope.soundId,
                                previewing = previewingId == recording.id,
                                previewDescription = locale.text("Preview", "Прослушать"),
                                onPreview = { togglePreview(recording.id, envelope) },
                                onChoose = {
                                    stopPreview()
                                    onChoose(envelope)
                                },
                            )
                        }
                        }
                    }
                    if (suggested.isNotEmpty()) {
                        item(key = "suggested-header") {
                            Text(
                                locale.text("Suggested", "Подходящие"),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.ExtraBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 8.dp, bottom = 2.dp),
                            )
                        }
                        items(suggested, key = { "suggested:$it" }) { id ->
                            PickerLibrarySoundRow(
                                id = id,
                                mode = mode,
                                locale = locale,
                                currentSoundId = currentSoundId,
                                previewingId = previewingId,
                                onPreview = { togglePreview(id, TrimEnvelope(id)) },
                                onChoose = {
                                    stopPreview()
                                    onChoose(TrimEnvelope(id))
                                },
                            )
                        }
                    }
                    if (suggested.isNotEmpty() && remainingIds.isNotEmpty()) {
                        item(key = "all-sounds-header") {
                            Text(
                                locale.text("All sounds", "Все звуки"),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.ExtraBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 8.dp, bottom = 2.dp),
                            )
                        }
                    }
                    if (mode == SoundPickerMode.AMBIENT) {
                        items(remainingIds, key = { "ambient:$it" }) { id ->
                            PickerLibrarySoundRow(
                                id = id,
                                mode = mode,
                                locale = locale,
                                currentSoundId = currentSoundId,
                                previewingId = previewingId,
                                onPreview = { togglePreview(id, TrimEnvelope(id)) },
                                onChoose = {
                                    stopPreview()
                                    onChoose(TrimEnvelope(id))
                                },
                            )
                        }
                    } else {
                        SoundLibrary.effectCategories.forEach { soundCategory ->
                            val ids = soundCategory.soundIds.filter(remainingIds::contains)
                            if (ids.isNotEmpty()) {
                                val key = "category:${soundCategory.label}"
                                val expanded = searching || key in expandedSections
                                item(key = "$key:header") {
                                    SoundSectionHeader(
                                        title = localizedCategory(soundCategory.label, locale),
                                        count = ids.size,
                                        expanded = expanded,
                                        onClick = { toggleSection(key) },
                                    )
                                }
                                if (expanded) {
                                    items(ids, key = { "$key:$it" }) { id ->
                                        PickerLibrarySoundRow(
                                            id = id,
                                            mode = mode,
                                            locale = locale,
                                            currentSoundId = currentSoundId,
                                            previewingId = previewingId,
                                            onPreview = { togglePreview(id, TrimEnvelope(id)) },
                                            onChoose = {
                                                stopPreview()
                                                onChoose(TrimEnvelope(id))
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                    if (libraryIds.isEmpty() && visibleRecordings.isEmpty()) {
                        item(key = "no-sound-results") {
                            Text(
                                locale.text(
                                    "No sounds match “$search”.",
                                    "По запросу «$search» ничего не найдено.",
                                ),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(vertical = 18.dp),
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
private fun SoundSectionHeader(
    title: String,
    count: Int,
    expanded: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(13.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 11.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (expanded) "▾" else "▸",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Black,
        )
        Text(
            title,
            modifier = Modifier.weight(1f),
            fontWeight = FontWeight.ExtraBold,
        )
        Text(
            count.toString(),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

@Composable
private fun PickerLibrarySoundRow(
    id: String,
    mode: SoundPickerMode,
    locale: UiLocale,
    currentSoundId: String?,
    previewingId: String?,
    onPreview: () -> Unit,
    onChoose: () -> Unit,
) {
    SoundRow(
        title = SoundLibrary.label(id),
        subtitle = if (mode == SoundPickerMode.AMBIENT) {
            locale.text("Included ambience", "Встроенный фон")
        } else {
            locale.text("Included sound", "Встроенный звук")
        },
        selected = currentSoundId == id,
        previewing = previewingId == id,
        previewDescription = locale.text("Preview", "Прослушать"),
        onPreview = onPreview,
        onChoose = onChoose,
    )
}

@Composable
private fun SoundRow(
    title: String,
    subtitle: String,
    selected: Boolean,
    previewing: Boolean,
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
                    Icon(
                        if (previewing) Icons.Rounded.Stop else Icons.Rounded.PlayArrow,
                        previewDescription,
                        tint = BloomBlue,
                    )
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
    // Recorder output lives in the app's persistent files directory so a
    // saved custom cue remains valid. Until Save, however, it is staged
    // content and must be removed on cancel/dispose or before another take.
    val stagedClipUris = remember { mutableSetOf<String>() }
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
    var fadeInOn by remember(existing?.id) {
        mutableStateOf(existing == null || (existing.fadeInMs ?: 0L) > 0L)
    }
    var fadeOutOn by remember(existing?.id) {
        mutableStateOf(existing == null || (existing.fadeOutMs ?: 0L) > 0L)
    }
    var rawWaveform by remember { mutableStateOf<List<Float>>(emptyList()) }
    var displayWaveform by remember(existing?.id) {
        mutableStateOf(List(WaveformTrimMath.Bars) { .45f })
    }
    var previewPlayback by remember { mutableStateOf<EffectPlayback?>(null) }
    var previewProgress by remember { mutableFloatStateOf(0f) }

    fun stopPreview() {
        previewPlayback?.stop()
        previewPlayback = null
        previewProgress = 0f
    }

    fun deleteStagedClip(uri: String?) {
        if (uri == null || !stagedClipUris.remove(uri)) return
        Uri.parse(uri).path?.let { path -> runCatching { File(path).delete() } }
    }

    fun startRecording() {
        stopPreview()
        val previousClip = clip
        val previousWasStaged = previousClip?.fileUri in stagedClipUris
        deleteStagedClip(previousClip?.fileUri)
        clip = null
        runCatching {
            rawWaveform = emptyList()
            displayWaveform = List(WaveformTrimMath.Bars) { .45f }
            recorder.start()
            startedAt = System.currentTimeMillis()
            elapsed = 0
            recording = true
        }.onFailure {
            if (!previousWasStaged) clip = previousClip
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
            deleteStagedClip(clip?.fileUri)
            stagedClipUris += captured.fileUri
            clip = captured
            displayWaveform = WaveformTrimMath.bucket(rawWaveform)
            trim = 0f..captured.durationMs.toFloat().coerceAtLeast(1f)
        }
    }

    fun togglePreview() {
        if (previewPlayback != null) {
            stopPreview()
            return
        }
        val current = clip ?: return
        previewProgress = 0f
        previewPlayback = viewModel.audioEngine.playEffectControlled(
            envelope = TrimEnvelope(
                "custom:${current.fileUri}",
                trim.start.toLong(),
                trim.endInclusive.toLong(),
                fadeIn.toLong(),
                fadeOut.toLong(),
            ),
            onProgress = { previewProgress = it },
            onComplete = {
                previewPlayback = null
                previewProgress = 0f
            },
        )
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (it) startRecording()
        else viewModel.notify(locale.text("Microphone permission was denied.", "Нет доступа к микрофону."))
    }

    LaunchedEffect(recording) {
        while (recording) {
            elapsed = System.currentTimeMillis() - startedAt
            rawWaveform = rawWaveform + recorder.amplitude()
            delay(100)
        }
    }

    LaunchedEffect(trim, fadeInOn, fadeOutOn) {
        val maximum = ((trim.endInclusive - trim.start) / 2f).coerceAtLeast(0f)
        fadeIn = if (fadeInOn) min(1_000f, maximum) else 0f
        fadeOut = if (fadeOutOn) min(1_000f, maximum) else 0f
    }

    DisposableEffect(Unit) {
        onDispose {
            previewPlayback?.stop()
            if (recorder.isRecording) recorder.cancel()
            stagedClipUris.toList().forEach(::deleteStagedClip)
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
                        TrimmableWaveform(
                            samples = displayWaveform,
                            value = trim,
                            duration = clip!!.durationMs.toFloat().coerceAtLeast(1f),
                            playheadFraction = previewProgress.takeIf { previewPlayback != null },
                            onValueChange = {
                                stopPreview()
                                trim = it
                            },
                        )
                    } else {
                        if (recording) {
                            PulsingStoryDot(
                                modifier = Modifier
                                    .align(Alignment.CenterStart)
                                    .offset(x = 18.dp),
                                color = BloomCoral,
                                size = 10.dp,
                            )
                        }
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
                    /*
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
                    */
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            formatDuration(trim.start.toLong()),
                            style = MaterialTheme.typography.labelMedium,
                        )
                        Text(
                            formatDuration(trim.endInclusive.toLong()),
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally),
                    ) {
                        FadeToggle(
                            label = locale.text("Fade in", "Плавное начало"),
                            checked = fadeInOn,
                            onToggle = { fadeInOn = !fadeInOn },
                        )
                        FadeToggle(
                            label = locale.text("Fade out", "Плавный конец"),
                            checked = fadeOutOn,
                            onToggle = { fadeOutOn = !fadeOutOn },
                        )
                    }
                    OutlinedButton(
                        onClick = ::togglePreview,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(
                            if (previewPlayback == null) Icons.Rounded.PlayArrow else Icons.Rounded.Stop,
                            contentDescription = null,
                        )
                        Text(
                            if (previewPlayback == null) {
                                locale.text("Preview selection", "Прослушать фрагмент")
                            } else {
                                locale.text("Stop preview", "Остановить")
                            },
                        )
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
                        // The repository now owns this file. Removing it
                        // from the staged set prevents dialog disposal from
                        // deleting a freshly saved recording.
                        stagedClipUris.remove(savedClip.fileUri)
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
private fun TrimmableWaveform(
    samples: List<Float>,
    value: ClosedFloatingPointRange<Float>,
    duration: Float,
    playheadFraction: Float?,
    onValueChange: (ClosedFloatingPointRange<Float>) -> Unit,
) {
    val density = LocalDensity.current
    val view = LocalView.current
    val inactiveColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .22f)
    var widthPx by remember { mutableStateOf(0) }
    val currentValue by rememberUpdatedState(value)
    val currentOnValueChange by rememberUpdatedState(onValueChange)
    val safeDuration = duration.coerceAtLeast(1f)
    val startX = value.start / safeDuration * widthPx
    val endX = value.endInclusive / safeDuration * widthPx

    Box(
        Modifier
            .fillMaxSize()
            .onSizeChanged { widthPx = it.width },
    ) {
        Canvas(Modifier.fillMaxSize().padding(vertical = 14.dp)) {
            val bars = samples.size.coerceAtLeast(1)
            val barWidth = size.width / bars
            repeat(bars) { index ->
                val level = samples.getOrElse(index) { .45f }.coerceIn(.08f, 1f)
                val x = index * barWidth + barWidth * .5f
                val time = index.toFloat() / maxOf(1, bars - 1) * safeDuration
                drawLine(
                    color = if (time in value) BloomBlue else inactiveColor,
                    start = Offset(x, size.height * (.5f - level * .45f)),
                    end = Offset(x, size.height * (.5f + level * .45f)),
                    strokeWidth = barWidth * .50f,
                )
            }
            drawRect(
                color = Color.Black.copy(alpha = .46f),
                size = androidx.compose.ui.geometry.Size(
                    width = (value.start / safeDuration * size.width).coerceAtLeast(0f),
                    height = size.height,
                ),
            )
            val selectedEnd = value.endInclusive / safeDuration * size.width
            drawRect(
                color = Color.Black.copy(alpha = .46f),
                topLeft = Offset(selectedEnd, 0f),
                size = androidx.compose.ui.geometry.Size(
                    width = (size.width - selectedEnd).coerceAtLeast(0f),
                    height = size.height,
                ),
            )
        }

        playheadFraction?.let { fraction ->
            val selectedPosition =
                value.start + fraction.coerceIn(0f, 1f) * (value.endInclusive - value.start)
            val playheadX = selectedPosition / safeDuration * widthPx
            Box(
                Modifier
                    .offset { IntOffset(playheadX.roundToInt() - 1, 0) }
                    .width(2.dp)
                    .fillMaxHeight()
                    .padding(vertical = 7.dp)
                    .background(BloomCoral, RoundedCornerShape(2.dp)),
            )
        }

        WaveformHandle(
            xPx = startX,
            widthPx = widthPx,
            onMove = { deltaPx ->
                val current = currentValue
                val currentEndX = current.endInclusive / safeDuration * widthPx
                val next = WaveformTrimMath.startFromPointer(
                    pointerX = current.start / safeDuration * widthPx + deltaPx,
                    endX = currentEndX,
                    width = widthPx.toFloat(),
                    duration = safeDuration,
                )
                currentOnValueChange(next..current.endInclusive)
            },
            onGrab = {
                view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            },
        )
        WaveformHandle(
            xPx = endX,
            widthPx = widthPx,
            onMove = { deltaPx ->
                val current = currentValue
                val currentStartX = current.start / safeDuration * widthPx
                val next = WaveformTrimMath.endFromPointer(
                    pointerX = current.endInclusive / safeDuration * widthPx + deltaPx,
                    startX = currentStartX,
                    width = widthPx.toFloat(),
                    duration = safeDuration,
                )
                currentOnValueChange(current.start..next)
            },
            onGrab = {
                view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            },
        )
    }
}

@Composable
private fun WaveformHandle(
    xPx: Float,
    widthPx: Int,
    onMove: (Float) -> Unit,
    onGrab: () -> Unit,
) {
    if (widthPx <= 0) return
    val density = LocalDensity.current
    Box(
        modifier = Modifier
            .offset {
                IntOffset(
                    x = (xPx - with(density) { 20.dp.toPx() }).toInt(),
                    y = 0,
                )
            }
            .width(40.dp)
            .fillMaxHeight()
            .pointerInput(widthPx) {
                detectDragGestures(
                    onDragStart = { onGrab() },
                    onDrag = { change, amount ->
                        change.consume()
                        onMove(amount.x)
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .width(12.dp)
                .fillMaxHeight()
                .padding(vertical = 4.dp)
                .background(BloomBlue, RoundedCornerShape(6.dp))
                .border(2.dp, Color.White, RoundedCornerShape(6.dp)),
        )
    }
}

@Composable
private fun FadeToggle(
    label: String,
    checked: Boolean,
    onToggle: () -> Unit,
) {
    TactileSurface(
        onClick = onToggle,
        containerColor = Color.Transparent,
        contentColor = MaterialTheme.colorScheme.onSurface,
        borderColor = Color.Transparent,
        liftedElevation = 0.dp,
        modifier = Modifier.height(40.dp),
    ) { contentColor ->
        Row(
            modifier = Modifier.padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(20.dp)
                    .background(
                        if (checked) BloomBlue else Color.Transparent,
                        RoundedCornerShape(5.dp),
                    )
                    .border(
                        1.5.dp,
                        if (checked) BloomBlue
                        else MaterialTheme.colorScheme.outline.copy(alpha = .65f),
                        RoundedCornerShape(5.dp),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                if (checked) {
                    Icon(
                        Icons.Rounded.Check,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(15.dp),
                    )
                }
            }
            Text(label, color = contentColor, fontWeight = FontWeight.SemiBold)
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
