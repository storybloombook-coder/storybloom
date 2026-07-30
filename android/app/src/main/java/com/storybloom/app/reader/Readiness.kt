package com.storybloom.app.reader

import com.storybloom.app.audio.SoundLibrary
import com.storybloom.app.data.Cue
import com.storybloom.app.data.Page

enum class ReadinessWarningKind {
    EMPTY_TEXT,
    PAGE_NO_SOUNDS,
    SILENT_CUE,
    UNPLAYABLE_CUE,
}

data class ReadinessWarning(
    val kind: ReadinessWarningKind,
    val pageId: String,
    val pageNumber: Int,
    val detail: String? = null,
)

data class ReadinessReport(
    val ready: Boolean,
    val storyPageCount: Int,
    val soundCount: Int,
    val ambientPageCount: Int,
    val warnings: List<ReadinessWarning>,
)

fun checkReadiness(
    pages: List<Page>,
    cues: List<Cue>,
): ReadinessReport {
    val storyPages = pages.filter { it.pageType.isReadable }
    val byPage = cues.groupBy(Cue::pageId)
    val warnings = mutableListOf<ReadinessWarning>()
    var soundCount = 0
    var ambientCount = 0

    storyPages.forEach { page ->
        val active = byPage[page.id].orEmpty().filter(Cue::isActive)
        val ambientPlayable = page.ambientSoundId?.let(::isPlayableSound) == true
        if (ambientPlayable) ambientCount += 1
        var pageSounds = 0
        active.forEach { cue ->
            when {
                cue.charStart != null && cue.soundId == null -> warnings += ReadinessWarning(
                    ReadinessWarningKind.SILENT_CUE,
                    page.id,
                    page.pageNumber,
                    cue.triggerText,
                )
                cue.soundId != null && !isPlayableSound(cue.soundId) -> warnings += ReadinessWarning(
                    ReadinessWarningKind.UNPLAYABLE_CUE,
                    page.id,
                    page.pageNumber,
                    cue.triggerText,
                )
                cue.soundId != null -> pageSounds += 1
            }
        }
        soundCount += pageSounds
        if (page.ocrText.isBlank()) {
            warnings += ReadinessWarning(
                ReadinessWarningKind.EMPTY_TEXT,
                page.id,
                page.pageNumber,
            )
        } else if (!ambientPlayable && pageSounds == 0) {
            warnings += ReadinessWarning(
                ReadinessWarningKind.PAGE_NO_SOUNDS,
                page.id,
                page.pageNumber,
            )
        }
    }
    return ReadinessReport(
        ready = warnings.isEmpty(),
        storyPageCount = storyPages.size,
        soundCount = soundCount,
        ambientPageCount = ambientCount,
        warnings = warnings,
    )
}

fun isPlayableSound(soundId: String): Boolean =
    soundId.startsWith("custom:") || SoundLibrary.assetPath(soundId) != null
