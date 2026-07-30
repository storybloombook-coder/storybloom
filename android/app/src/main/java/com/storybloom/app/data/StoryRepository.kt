package com.storybloom.app.data

import android.content.ContentValues
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.util.UUID

class StoryRepository(private val helper: StorybloomDatabase) {
    private val lock = Any()
    private val _revision = MutableStateFlow(0L)
    val revision: StateFlow<Long> = _revision.asStateFlow()

    private val db: SQLiteDatabase
        get() = helper.writableDatabase

    suspend fun listBookSummaries(): List<BookSummary> = read {
        db.rawQuery(
            """
            SELECT b.*,
              (SELECT COUNT(*) FROM pages p WHERE p.book_id = b.id) AS page_count,
              (SELECT COUNT(*) FROM cues c
                 JOIN pages p2 ON c.page_id = p2.id
                 WHERE p2.book_id = b.id) AS cue_count,
              (SELECT p3.image_path FROM pages p3
                 WHERE p3.book_id = b.id
                 ORDER BY p3.page_number LIMIT 1) AS cover_path
            FROM books b
            ORDER BY b.created_at DESC
            """.trimIndent(),
            null,
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    val book = cursor.toBook().let {
                        if (it.coverImagePath == null) {
                            it.copy(coverImagePath = cursor.stringOrNull("cover_path"))
                        } else {
                            it
                        }
                    }
                    add(
                        BookSummary(
                            book = book,
                            pageCount = cursor.getInt(cursor.getColumnIndexOrThrow("page_count")),
                            cueCount = cursor.getInt(cursor.getColumnIndexOrThrow("cue_count")),
                        ),
                    )
                }
            }
        }
    }

    suspend fun getBook(id: String): Book? = read {
        db.rawQuery("SELECT * FROM books WHERE id = ?", arrayOf(id)).use { cursor ->
            if (cursor.moveToFirst()) cursor.toBook() else null
        }
    }

    suspend fun getPages(bookId: String): List<Page> = read {
        db.rawQuery(
            "SELECT * FROM pages WHERE book_id = ? ORDER BY page_number",
            arrayOf(bookId),
        ).use(Cursor::toPages)
    }

    suspend fun getPage(pageId: String): Page? = read {
        db.rawQuery("SELECT * FROM pages WHERE id = ?", arrayOf(pageId)).use { cursor ->
            if (cursor.moveToFirst()) cursor.toPage() else null
        }
    }

    suspend fun getCuesForPage(pageId: String): List<Cue> = read {
        db.rawQuery(
            "SELECT * FROM cues WHERE page_id = ? ORDER BY char_start IS NULL, char_start",
            arrayOf(pageId),
        ).use(Cursor::toCues)
    }

    suspend fun getCuesForBook(bookId: String): List<Cue> = read {
        db.rawQuery(
            """
            SELECT c.* FROM cues c
            JOIN pages p ON c.page_id = p.id
            WHERE p.book_id = ?
            ORDER BY p.page_number, c.char_start
            """.trimIndent(),
            arrayOf(bookId),
        ).use(Cursor::toCues)
    }

    suspend fun getBundle(bookId: String): BookBundle? {
        val book = getBook(bookId) ?: return null
        val pages = getPages(bookId)
        val cues = getCuesForBook(bookId).groupBy(Cue::pageId)
        return BookBundle(
            book = book,
            pages = pages.map { PageWithCues(it, cues[it.id].orEmpty()) },
        )
    }

    suspend fun listRecordings(): List<Recording> = read {
        db.rawQuery("SELECT * FROM recordings ORDER BY created_at DESC", null).use { cursor ->
            buildList {
                while (cursor.moveToNext()) add(cursor.toRecording())
            }
        }
    }

    suspend fun createBook(
        title: String,
        source: BookSource,
        language: BookLanguage,
    ): Book {
        val book = Book(
            id = newId(),
            title = title.trim().ifEmpty { "My story" },
            isbn = null,
            coverImagePath = null,
            createdAt = System.currentTimeMillis(),
            prepStatus = PrepStatus.PROCESSING,
            hasDialogue = false,
            reviewStatus = ReviewStatus.UNREVIEWED,
            source = source,
            language = language,
            isFavorite = false,
            shelfPosition = null,
        )
        write {
            db.insertOrThrow(
                "books",
                null,
                ContentValues().apply {
                    put("id", book.id)
                    put("title", book.title)
                    putNull("isbn")
                    putNull("cover_image_path")
                    put("created_at", book.createdAt)
                    put("prep_status", book.prepStatus.value)
                    put("has_dialogue", 0)
                    put("review_status", book.reviewStatus.value)
                    put("source", book.source.value)
                    put("language", book.language.value)
                    put("is_favorite", 0)
                },
            )
        }
        return book
    }

    suspend fun createPage(
        bookId: String,
        pageNumber: Int,
        imagePath: String,
        text: String = "",
    ): Page {
        val page = Page(
            id = newId(),
            bookId = bookId,
            pageNumber = pageNumber,
            imagePath = imagePath,
            pageType = PageType.STORY,
            embeddedText = null,
            ocrText = text,
            backgroundScene = null,
            ambientSoundId = null,
            ambientCandidates = emptyList(),
            ambientStartMs = null,
            ambientEndMs = null,
            ambientFadeInMs = null,
            ambientFadeOutMs = null,
        )
        write {
            db.insertOrThrow(
                "pages",
                null,
                ContentValues().apply {
                    put("id", page.id)
                    put("book_id", page.bookId)
                    put("page_number", page.pageNumber)
                    put("image_path", page.imagePath)
                    put("page_type", page.pageType.value)
                    putNull("embedded_text")
                    put("ocr_text", page.ocrText)
                    putNull("background_scene")
                    putNull("ambient_sound_id")
                    put("ambient_candidates", "[]")
                },
            )
        }
        return page
    }

    suspend fun replacePageAnalysis(pageId: String, analysis: PageAnalysis) = write {
        transaction {
            db.update(
                "pages",
                ContentValues().apply {
                    put("page_type", analysis.pageType.value)
                    put("ocr_text", analysis.ocrText)
                    putOrNull("background_scene", analysis.backgroundScene)
                    putOrNull("ambient_sound_id", analysis.ambientSoundId)
                    put(
                        "ambient_candidates",
                        encodeList(analysis.ambientSoundId?.let(::listOf).orEmpty()),
                    )
                },
                "id = ?",
                arrayOf(pageId),
            )
            db.delete("cues", "page_id = ?", arrayOf(pageId))
            analysis.cues.forEach { draft -> insertCue(pageId, draft) }
        }
    }

    suspend fun addCue(pageId: String, draft: CueDraft): Cue {
        val cue = draft.toCue(pageId)
        write { insertCue(cue) }
        return cue
    }

    suspend fun updateBookPrep(
        bookId: String,
        prepStatus: PrepStatus,
        hasDialogue: Boolean,
    ) = write {
        db.update(
            "books",
            ContentValues().apply {
                put("prep_status", prepStatus.value)
                put("has_dialogue", if (hasDialogue) 1 else 0)
            },
            "id = ?",
            arrayOf(bookId),
        )
    }

    suspend fun updateBookTitle(bookId: String, title: String) = write {
        db.update(
            "books",
            ContentValues().apply { put("title", title.trim()) },
            "id = ?",
            arrayOf(bookId),
        )
    }

    suspend fun setFavorite(bookId: String, favorite: Boolean) = write {
        db.execSQL(
            """
            UPDATE books SET is_favorite = ?, shelf_position = CASE
              WHEN ? = 1 AND shelf_position IS NULL
                THEN (SELECT COALESCE(MAX(shelf_position), -1) + 1
                      FROM books WHERE is_favorite = 1)
              WHEN ? = 0 THEN NULL
              ELSE shelf_position
            END WHERE id = ?
            """.trimIndent(),
            arrayOf<Any>(
                if (favorite) 1 else 0,
                if (favorite) 1 else 0,
                if (favorite) 1 else 0,
                bookId,
            ),
        )
    }

    suspend fun updateShelfOrder(bookIds: List<String>) = write {
        transaction {
            bookIds.forEachIndexed { index, id ->
                db.execSQL(
                    "UPDATE books SET shelf_position = ? WHERE id = ?",
                    arrayOf<Any>(index, id),
                )
            }
        }
    }

    suspend fun updatePageText(pageId: String, text: String) = write {
        db.update(
            "pages",
            ContentValues().apply { put("ocr_text", text) },
            "id = ?",
            arrayOf(pageId),
        )
    }

    suspend fun updatePageType(pageId: String, type: PageType) = write {
        db.update(
            "pages",
            ContentValues().apply { put("page_type", type.value) },
            "id = ?",
            arrayOf(pageId),
        )
    }

    suspend fun updatePageImage(pageId: String, path: String) = write {
        db.update(
            "pages",
            ContentValues().apply { put("image_path", path) },
            "id = ?",
            arrayOf(pageId),
        )
    }

    suspend fun updatePageAmbient(pageId: String, envelope: TrimEnvelope?) = write {
        db.update(
            "pages",
            ContentValues().apply {
                putOrNull("ambient_sound_id", envelope?.soundId)
                putOrNull("ambient_start_ms", envelope?.startMs)
                putOrNull("ambient_end_ms", envelope?.endMs)
                putOrNull("ambient_fade_in_ms", envelope?.fadeInMs)
                putOrNull("ambient_fade_out_ms", envelope?.fadeOutMs)
            },
            "id = ?",
            arrayOf(pageId),
        )
    }

    suspend fun applyAmbientToBook(bookId: String, envelope: TrimEnvelope) = write {
        db.update(
            "pages",
            ContentValues().apply {
                put("ambient_sound_id", envelope.soundId)
                putOrNull("ambient_start_ms", envelope.startMs)
                putOrNull("ambient_end_ms", envelope.endMs)
                putOrNull("ambient_fade_in_ms", envelope.fadeInMs)
                putOrNull("ambient_fade_out_ms", envelope.fadeOutMs)
            },
            "book_id = ?",
            arrayOf(bookId),
        )
    }

    suspend fun updateCueSound(cueId: String, envelope: TrimEnvelope?) = write {
        db.update(
            "cues",
            ContentValues().apply {
                putOrNull("sound_id", envelope?.soundId)
                putOrNull("sound_start_ms", envelope?.startMs)
                putOrNull("sound_end_ms", envelope?.endMs)
                putOrNull("fade_in_ms", envelope?.fadeInMs)
                putOrNull("fade_out_ms", envelope?.fadeOutMs)
            },
            "id = ?",
            arrayOf(cueId),
        )
    }

    suspend fun updateCueState(cueId: String, state: CueReviewState) = write {
        db.update(
            "cues",
            ContentValues().apply { put("review_state", state.value) },
            "id = ?",
            arrayOf(cueId),
        )
    }

    suspend fun updateCueRange(cueId: String, start: Int?, end: Int?) = write {
        db.update(
            "cues",
            ContentValues().apply {
                putOrNull("char_start", start)
                putOrNull("char_end", end)
            },
            "id = ?",
            arrayOf(cueId),
        )
    }

    suspend fun reorderPages(pageIds: List<String>) = write {
        transaction {
            pageIds.forEachIndexed { index, id ->
                db.execSQL(
                    "UPDATE pages SET page_number = ? WHERE id = ?",
                    arrayOf<Any>(index + 1, id),
                )
            }
        }
    }

    suspend fun deletePage(pageId: String) = write {
        db.delete("pages", "id = ?", arrayOf(pageId))
    }

    suspend fun deleteBook(bookId: String) = write {
        db.delete("books", "id = ?", arrayOf(bookId))
    }

    suspend fun createRecording(
        name: String,
        fileUri: String,
        durationMs: Long?,
        startMs: Long?,
        endMs: Long?,
        fadeInMs: Long?,
        fadeOutMs: Long?,
        originBookId: String?,
        originBookTitle: String?,
        originPageNumber: Int?,
        originLabel: String?,
    ): Recording {
        val recording = Recording(
            id = newId(),
            name = name.trim().ifEmpty { "My sound" },
            fileUri = fileUri,
            durationMs = durationMs,
            startMs = startMs,
            endMs = endMs,
            fadeInMs = fadeInMs,
            fadeOutMs = fadeOutMs,
            createdAt = System.currentTimeMillis(),
            originBookId = originBookId,
            originBookTitle = originBookTitle,
            originPageNumber = originPageNumber,
            originLabel = originLabel,
        )
        write {
            db.insertOrThrow(
                "recordings",
                null,
                ContentValues().apply {
                    put("id", recording.id)
                    put("name", recording.name)
                    put("file_uri", recording.fileUri)
                    putOrNull("duration_ms", recording.durationMs)
                    putOrNull("start_ms", recording.startMs)
                    putOrNull("end_ms", recording.endMs)
                    putOrNull("fade_in_ms", recording.fadeInMs)
                    putOrNull("fade_out_ms", recording.fadeOutMs)
                    put("created_at", recording.createdAt)
                    putOrNull("origin_book_id", recording.originBookId)
                    putOrNull("origin_book_title", recording.originBookTitle)
                    putOrNull("origin_page_number", recording.originPageNumber)
                    putOrNull("origin_label", recording.originLabel)
                },
            )
        }
        return recording
    }

    suspend fun renameRecording(id: String, name: String) = write {
        db.update(
            "recordings",
            ContentValues().apply { put("name", name.trim()) },
            "id = ?",
            arrayOf(id),
        )
    }

    suspend fun updateRecording(id: String, envelope: TrimEnvelope, durationMs: Long?) = write {
        db.update(
            "recordings",
            ContentValues().apply {
                put("file_uri", envelope.soundId.removePrefix("custom:"))
                putOrNull("duration_ms", durationMs)
                putOrNull("start_ms", envelope.startMs)
                putOrNull("end_ms", envelope.endMs)
                putOrNull("fade_in_ms", envelope.fadeInMs)
                putOrNull("fade_out_ms", envelope.fadeOutMs)
            },
            "id = ?",
            arrayOf(id),
        )
    }

    suspend fun deleteRecording(id: String) = write {
        db.delete("recordings", "id = ?", arrayOf(id))
    }

    private fun insertCue(pageId: String, draft: CueDraft) = insertCue(draft.toCue(pageId))

    private fun insertCue(cue: Cue) {
        db.insertOrThrow(
            "cues",
            null,
            ContentValues().apply {
                put("id", cue.id)
                put("page_id", cue.pageId)
                put("type", cue.type.value)
                put("trigger_text", cue.triggerText)
                putOrNull("context_phrase", cue.contextPhrase)
                putOrNull("char_start", cue.charStart)
                putOrNull("char_end", cue.charEnd)
                putOrNull("sound_id", cue.soundId)
                put("candidate_sound_ids", encodeList(cue.candidateSoundIds))
                putOrNull("character_name", cue.characterName)
                putOrNull("intensity", cue.intensity)
                putOrNull("emotion", cue.emotion)
                put("review_state", cue.reviewState.value)
                putOrNull("sound_start_ms", cue.soundStartMs)
                putOrNull("sound_end_ms", cue.soundEndMs)
                putOrNull("fade_in_ms", cue.fadeInMs)
                putOrNull("fade_out_ms", cue.fadeOutMs)
            },
        )
    }

    private fun CueDraft.toCue(pageId: String) = Cue(
        id = newId(),
        pageId = pageId,
        type = type,
        triggerText = triggerText.lowercase(),
        contextPhrase = contextPhrase,
        charStart = charStart,
        charEnd = charEnd,
        soundId = soundId,
        candidateSoundIds = soundId?.let(::listOf).orEmpty(),
        characterName = characterName,
        intensity = intensity,
        emotion = emotion,
        reviewState = CueReviewState.PROPOSED,
        soundStartMs = null,
        soundEndMs = null,
        fadeInMs = null,
        fadeOutMs = null,
    )

    private suspend fun <T> read(block: () -> T): T = withContext(Dispatchers.IO) {
        synchronized(lock) { block() }
    }

    private suspend fun <T> write(block: () -> T): T = withContext(Dispatchers.IO) {
        val value = synchronized(lock) { block() }
        _revision.value += 1
        value
    }

    private fun <T> transaction(block: () -> T): T {
        db.beginTransaction()
        return try {
            val value = block()
            db.setTransactionSuccessful()
            value
        } finally {
            db.endTransaction()
        }
    }

    companion object {
        fun newId(): String =
            "${System.currentTimeMillis().toString(36)}-${UUID.randomUUID().toString().take(8)}"
    }
}

private fun Cursor.toBook() = Book(
    id = getString(getColumnIndexOrThrow("id")),
    title = getString(getColumnIndexOrThrow("title")),
    isbn = stringOrNull("isbn"),
    coverImagePath = stringOrNull("cover_image_path"),
    createdAt = getLong(getColumnIndexOrThrow("created_at")),
    prepStatus = PrepStatus.from(getString(getColumnIndexOrThrow("prep_status"))),
    hasDialogue = getInt(getColumnIndexOrThrow("has_dialogue")) == 1,
    reviewStatus = ReviewStatus.from(getString(getColumnIndexOrThrow("review_status"))),
    source = BookSource.from(getString(getColumnIndexOrThrow("source"))),
    language = BookLanguage.from(getString(getColumnIndexOrThrow("language"))),
    isFavorite = getInt(getColumnIndexOrThrow("is_favorite")) == 1,
    shelfPosition = intOrNull("shelf_position"),
)

private fun Cursor.toPage() = Page(
    id = getString(getColumnIndexOrThrow("id")),
    bookId = getString(getColumnIndexOrThrow("book_id")),
    pageNumber = getInt(getColumnIndexOrThrow("page_number")),
    imagePath = getString(getColumnIndexOrThrow("image_path")),
    pageType = PageType.from(getString(getColumnIndexOrThrow("page_type"))),
    embeddedText = stringOrNull("embedded_text"),
    ocrText = getString(getColumnIndexOrThrow("ocr_text")),
    backgroundScene = stringOrNull("background_scene"),
    ambientSoundId = stringOrNull("ambient_sound_id"),
    ambientCandidates = decodeList(getString(getColumnIndexOrThrow("ambient_candidates"))),
    ambientStartMs = longOrNull("ambient_start_ms"),
    ambientEndMs = longOrNull("ambient_end_ms"),
    ambientFadeInMs = longOrNull("ambient_fade_in_ms"),
    ambientFadeOutMs = longOrNull("ambient_fade_out_ms"),
)

private fun Cursor.toCue() = Cue(
    id = getString(getColumnIndexOrThrow("id")),
    pageId = getString(getColumnIndexOrThrow("page_id")),
    type = CueType.from(getString(getColumnIndexOrThrow("type"))),
    triggerText = getString(getColumnIndexOrThrow("trigger_text")),
    contextPhrase = stringOrNull("context_phrase"),
    charStart = intOrNull("char_start"),
    charEnd = intOrNull("char_end"),
    soundId = stringOrNull("sound_id"),
    candidateSoundIds = decodeList(getString(getColumnIndexOrThrow("candidate_sound_ids"))),
    characterName = stringOrNull("character_name"),
    intensity = stringOrNull("intensity"),
    emotion = stringOrNull("emotion"),
    reviewState = CueReviewState.from(getString(getColumnIndexOrThrow("review_state"))),
    soundStartMs = longOrNull("sound_start_ms"),
    soundEndMs = longOrNull("sound_end_ms"),
    fadeInMs = longOrNull("fade_in_ms"),
    fadeOutMs = longOrNull("fade_out_ms"),
)

private fun Cursor.toRecording() = Recording(
    id = getString(getColumnIndexOrThrow("id")),
    name = getString(getColumnIndexOrThrow("name")),
    fileUri = getString(getColumnIndexOrThrow("file_uri")),
    durationMs = longOrNull("duration_ms"),
    startMs = longOrNull("start_ms"),
    endMs = longOrNull("end_ms"),
    fadeInMs = longOrNull("fade_in_ms"),
    fadeOutMs = longOrNull("fade_out_ms"),
    createdAt = getLong(getColumnIndexOrThrow("created_at")),
    originBookId = stringOrNull("origin_book_id"),
    originBookTitle = stringOrNull("origin_book_title"),
    originPageNumber = intOrNull("origin_page_number"),
    originLabel = stringOrNull("origin_label"),
)

private fun Cursor.toPages(): List<Page> = buildList {
    while (moveToNext()) add(toPage())
}

private fun Cursor.toCues(): List<Cue> = buildList {
    while (moveToNext()) add(toCue())
}

private fun ContentValues.putOrNull(key: String, value: String?) {
    if (value == null) putNull(key) else put(key, value)
}

private fun ContentValues.putOrNull(key: String, value: Long?) {
    if (value == null) putNull(key) else put(key, value)
}

private fun ContentValues.putOrNull(key: String, value: Int?) {
    if (value == null) putNull(key) else put(key, value)
}

private fun encodeList(values: List<String>): String =
    JSONArray().apply { values.forEach(::put) }.toString()

private fun decodeList(raw: String?): List<String> {
    if (raw.isNullOrBlank()) return emptyList()
    return runCatching {
        val array = JSONArray(raw)
        buildList {
            for (index in 0 until array.length()) {
                array.optString(index).takeIf(String::isNotBlank)?.let(::add)
            }
        }
    }.getOrDefault(emptyList())
}
