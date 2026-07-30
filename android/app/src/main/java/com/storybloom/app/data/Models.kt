package com.storybloom.app.data

enum class BookSource(val value: String) {
    PHOTOS("photos"),
    DICTATION("dictation");

    companion object {
        fun from(value: String?) = entries.firstOrNull { it.value == value } ?: PHOTOS
    }
}

enum class BookLanguage(val value: String, val tesseractCode: String) {
    ENGLISH("en", "eng"),
    RUSSIAN("ru", "rus");

    companion object {
        fun from(value: String?) = entries.firstOrNull { it.value == value } ?: ENGLISH
    }
}

enum class PrepStatus(val value: String) {
    PENDING("pending"),
    PROCESSING("processing"),
    READY("ready"),
    FAILED("failed");

    companion object {
        fun from(value: String?) = entries.firstOrNull { it.value == value } ?: PENDING
    }
}

enum class ReviewStatus(val value: String) {
    UNREVIEWED("unreviewed"),
    IN_PROGRESS("in_progress"),
    APPROVED("approved");

    companion object {
        fun from(value: String?) = entries.firstOrNull { it.value == value } ?: UNREVIEWED
    }
}

enum class PageType(val value: String) {
    COVER("cover"),
    TITLE("title"),
    STORY("story"),
    ILLUSTRATION_ONLY("illustration_only"),
    BACK_COVER("back_cover");

    val isReadable: Boolean
        get() = this == STORY || this == ILLUSTRATION_ONLY

    companion object {
        fun from(value: String?) = entries.firstOrNull { it.value == value } ?: STORY
    }
}

enum class CueType(val value: String) {
    KEYWORD("keyword"),
    CHARACTER("character");

    companion object {
        fun from(value: String?) = entries.firstOrNull { it.value == value } ?: KEYWORD
    }
}

enum class CueReviewState(val value: String) {
    PROPOSED("proposed"),
    CONFIRMED("confirmed"),
    REMOVED("removed");

    companion object {
        fun from(value: String?) = entries.firstOrNull { it.value == value } ?: PROPOSED
    }
}

data class Book(
    val id: String,
    val title: String,
    val isbn: String?,
    val coverImagePath: String?,
    val createdAt: Long,
    val prepStatus: PrepStatus,
    val hasDialogue: Boolean,
    val reviewStatus: ReviewStatus,
    val source: BookSource,
    val language: BookLanguage,
    val isFavorite: Boolean,
    val shelfPosition: Int?,
)

data class BookSummary(
    val book: Book,
    val pageCount: Int,
    val cueCount: Int,
)

data class Page(
    val id: String,
    val bookId: String,
    val pageNumber: Int,
    val imagePath: String,
    val pageType: PageType,
    val embeddedText: String?,
    val ocrText: String,
    val backgroundScene: String?,
    val ambientSoundId: String?,
    val ambientCandidates: List<String>,
    val ambientStartMs: Long?,
    val ambientEndMs: Long?,
    val ambientFadeInMs: Long?,
    val ambientFadeOutMs: Long?,
)

data class Cue(
    val id: String,
    val pageId: String,
    val type: CueType,
    val triggerText: String,
    val contextPhrase: String?,
    val charStart: Int?,
    val charEnd: Int?,
    val soundId: String?,
    val candidateSoundIds: List<String>,
    val characterName: String?,
    val intensity: String?,
    val emotion: String?,
    val reviewState: CueReviewState,
    val soundStartMs: Long?,
    val soundEndMs: Long?,
    val fadeInMs: Long?,
    val fadeOutMs: Long?,
) {
    val isActive: Boolean
        get() = reviewState != CueReviewState.REMOVED
}

data class Recording(
    val id: String,
    val name: String,
    val fileUri: String,
    val durationMs: Long?,
    val startMs: Long?,
    val endMs: Long?,
    val fadeInMs: Long?,
    val fadeOutMs: Long?,
    val createdAt: Long,
    val originBookId: String?,
    val originBookTitle: String?,
    val originPageNumber: Int?,
    val originLabel: String?,
)

data class PageWithCues(
    val page: Page,
    val cues: List<Cue>,
)

data class BookBundle(
    val book: Book,
    val pages: List<PageWithCues>,
)

data class CueDraft(
    val type: CueType = CueType.KEYWORD,
    val triggerText: String,
    val contextPhrase: String? = null,
    val charStart: Int? = null,
    val charEnd: Int? = null,
    val soundId: String? = null,
    val characterName: String? = null,
    val intensity: String? = null,
    val emotion: String? = null,
)

data class PageAnalysis(
    val ocrText: String,
    val pageType: PageType = PageType.STORY,
    val backgroundScene: String? = null,
    val ambientSoundId: String? = null,
    val cues: List<CueDraft> = emptyList(),
    val meanConfidence: Int = -1,
)

data class TrimEnvelope(
    val soundId: String,
    val startMs: Long? = null,
    val endMs: Long? = null,
    val fadeInMs: Long? = null,
    val fadeOutMs: Long? = null,
)

data class TextToken(
    val text: String,
    val start: Int,
    val end: Int,
    val isWhitespace: Boolean,
)

fun tokenizeText(text: String): List<TextToken> {
    if (text.isEmpty()) return emptyList()
    val tokens = mutableListOf<TextToken>()
    val matcher = Regex("""\s+|\S+""").findAll(text)
    matcher.forEach { match ->
        tokens += TextToken(
            text = match.value,
            start = match.range.first,
            end = match.range.last + 1,
            isWhitespace = match.value.all(Char::isWhitespace),
        )
    }
    return tokens
}

fun cueAtRange(cues: List<Cue>, start: Int, end: Int): Cue? =
    cues.firstOrNull { cue ->
        val cueStart = cue.charStart
        val cueEnd = cue.charEnd
        cueStart != null && cueEnd != null && start < cueEnd && end > cueStart
    }
