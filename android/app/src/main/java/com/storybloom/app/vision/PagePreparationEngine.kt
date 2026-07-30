package com.storybloom.app.vision

import android.content.Context
import android.graphics.Bitmap
import com.storybloom.app.data.BookLanguage
import com.storybloom.app.data.PageAnalysis
import com.storybloom.app.data.PrepStatus
import com.storybloom.app.data.StoryRepository
import com.storybloom.app.media.PageImageStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PreparationProgress(
    val bookId: String,
    val currentPage: Int,
    val totalPages: Int,
    val message: String,
    val failed: Boolean = false,
)

class PagePreparationEngine(
    context: Context,
    private val repository: StoryRepository,
) {
    private val imageStore = PageImageStore(context.applicationContext)
    private val tesseract = TesseractEngine(context.applicationContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val _progress = MutableStateFlow<Map<String, PreparationProgress>>(emptyMap())
    val progress: StateFlow<Map<String, PreparationProgress>> = _progress.asStateFlow()

    fun prepareBook(bookId: String) {
        scope.launch {
            val book = repository.getBook(bookId) ?: return@launch
            val pages = repository.getPages(bookId)
            var hasDialogue = false
            try {
                pages.forEachIndexed { index, page ->
                    report(bookId, index + 1, pages.size, "Reading page ${index + 1}…")
                    val analysis = if (page.imagePath.isBlank()) {
                        LocalCueAnalyzer.analyze(page.ocrText)
                    } else {
                        val bitmap = imageStore.load(page.imagePath)
                            ?: error("Page ${index + 1} image could not be opened.")
                        try {
                            recognize(bitmap, book.language)
                        } finally {
                            bitmap.recycle()
                        }
                    }
                    hasDialogue = hasDialogue || analysis.cues.any {
                        it.type == com.storybloom.app.data.CueType.CHARACTER
                    }
                    repository.replacePageAnalysis(page.id, analysis)
                }
                repository.updateBookPrep(bookId, PrepStatus.READY, hasDialogue)
                report(bookId, pages.size, pages.size, "Ready")
            } catch (error: Throwable) {
                repository.updateBookPrep(bookId, PrepStatus.FAILED, hasDialogue)
                _progress.value = _progress.value + (
                    bookId to PreparationProgress(
                        bookId,
                        0,
                        pages.size,
                        error.message ?: "Page preparation failed.",
                        failed = true,
                    )
                )
            }
        }
    }

    fun preparePages(bookId: String, pageIds: Set<String>) {
        scope.launch {
            val book = repository.getBook(bookId) ?: return@launch
            val pages = repository.getPages(bookId).filter { it.id in pageIds }
            try {
                pages.forEachIndexed { index, page ->
                    report(bookId, index + 1, pages.size, "Reading new page ${index + 1}…")
                    val bitmap = imageStore.load(page.imagePath)
                        ?: error("The new page image could not be opened.")
                    val analysis = try {
                        recognize(bitmap, book.language)
                    } finally {
                        bitmap.recycle()
                    }
                    repository.replacePageAnalysis(page.id, analysis)
                }
                val allCues = repository.getCuesForBook(bookId)
                repository.updateBookPrep(
                    bookId,
                    PrepStatus.READY,
                    allCues.any { it.type == com.storybloom.app.data.CueType.CHARACTER },
                )
                report(bookId, pages.size, pages.size, "Ready")
            } catch (error: Throwable) {
                report(
                    bookId,
                    0,
                    pages.size,
                    error.message ?: "New-page preparation failed.",
                )
            }
        }
    }

    suspend fun recognize(bitmap: Bitmap, language: BookLanguage): PageAnalysis {
        val result = tesseract.recognize(bitmap, language)
        return LocalCueAnalyzer.analyze(result.text, result.meanConfidence)
    }

    private fun report(bookId: String, current: Int, total: Int, message: String) {
        _progress.value = _progress.value + (
            bookId to PreparationProgress(bookId, current, total, message)
        )
    }
}
