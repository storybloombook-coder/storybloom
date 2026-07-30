package com.storybloom.app.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.storybloom.app.StorybloomApplication
import com.storybloom.app.audio.AudioEngine
import com.storybloom.app.data.BookLanguage
import com.storybloom.app.data.BookSource
import com.storybloom.app.data.BookSummary
import com.storybloom.app.data.StoryRepository
import com.storybloom.app.media.PageImageStore
import com.storybloom.app.speech.ModelManager
import com.storybloom.app.vision.PagePreparationEngine
import com.storybloom.app.vision.PreparationProgress
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface AppRoute {
    data object Home : AppRoute
    data object Library : AppRoute
    data object AddBook : AppRoute
    data object CreateStory : AppRoute
    data class BookDetails(val bookId: String) : AppRoute
    data class PageEditor(val pageId: String) : AppRoute
    data class Reader(val bookId: String) : AppRoute
    data object Scene : AppRoute
    data object Recordings : AppRoute
}

enum class UiLocale {
    ENGLISH,
    RUSSIAN,
}

data class AppUiState(
    val books: List<BookSummary> = emptyList(),
    val loading: Boolean = true,
    val locale: UiLocale = UiLocale.ENGLISH,
    val preparation: Map<String, PreparationProgress> = emptyMap(),
)

class StorybloomViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as StorybloomApplication
    val repository: StoryRepository = app.repository
    val imageStore: PageImageStore = app.imageStore
    val audioEngine: AudioEngine = app.audioEngine
    val preparationEngine: PagePreparationEngine = app.preparationEngine
    val modelManager: ModelManager = app.modelManager

    private val preferences = application.getSharedPreferences("storybloom-ui", 0)
    private val _books = MutableStateFlow<List<BookSummary>>(emptyList())
    private val _loading = MutableStateFlow(true)
    private val _locale = MutableStateFlow(
        if (preferences.getString("locale", "en") == "ru") {
            UiLocale.RUSSIAN
        } else {
            UiLocale.ENGLISH
        },
    )
    private val _routes = MutableStateFlow<List<AppRoute>>(listOf(AppRoute.Home))
    val routes: StateFlow<List<AppRoute>> = _routes.asStateFlow()
    val route: AppRoute
        get() = _routes.value.last()

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages = _messages.asSharedFlow()

    val uiState: StateFlow<AppUiState> = combine(
        _books,
        _loading,
        _locale,
        preparationEngine.progress,
    ) { books, loading, locale, preparation ->
        AppUiState(books, loading, locale, preparation)
    }.stateIn(
        viewModelScope,
        SharingStarted.Eagerly,
        AppUiState(),
    )

    init {
        viewModelScope.launch {
            repository.revision.collect { refreshBooks() }
        }
    }

    fun navigate(route: AppRoute) {
        _routes.value = _routes.value + route
    }

    fun replace(route: AppRoute) {
        _routes.value = _routes.value.dropLast(1) + route
    }

    fun back(): Boolean {
        if (_routes.value.size <= 1) return false
        _routes.value = _routes.value.dropLast(1)
        return true
    }

    fun home() {
        _routes.value = listOf(AppRoute.Home)
    }

    fun setLocale(locale: UiLocale) {
        _locale.value = locale
        preferences.edit().putString("locale", if (locale == UiLocale.RUSSIAN) "ru" else "en").apply()
    }

    suspend fun importImages(uris: List<Uri>): List<String> = runOperation {
        imageStore.importAll(uris)
    } ?: emptyList()

    suspend fun createPhotoBook(
        title: String,
        language: BookLanguage,
        imagePaths: List<String>,
    ): String? = runOperation {
        require(imagePaths.isNotEmpty()) { localize("Choose at least one page.", "Выберите хотя бы одну страницу.") }
        val book = repository.createBook(title, BookSource.PHOTOS, language)
        imagePaths.forEachIndexed { index, path ->
            repository.createPage(book.id, index + 1, path)
        }
        preparationEngine.prepareBook(book.id)
        replace(AppRoute.BookDetails(book.id))
        book.id
    }

    suspend fun createDictatedBook(
        title: String,
        language: BookLanguage,
        text: String,
    ): String? = runOperation {
        val paragraphs = text
            .split(Regex("""\n\s*\n"""))
            .map(String::trim)
            .filter(String::isNotBlank)
        require(paragraphs.isNotEmpty()) {
            localize("Tell or type at least one page.", "Расскажите или напишите хотя бы одну страницу.")
        }
        val book = repository.createBook(title, BookSource.DICTATION, language)
        paragraphs.forEachIndexed { index, paragraph ->
            repository.createPage(book.id, index + 1, "", paragraph)
        }
        preparationEngine.prepareBook(book.id)
        replace(AppRoute.BookDetails(book.id))
        book.id
    }

    suspend fun addPhotos(bookId: String, uris: List<Uri>) = runOperation {
        val paths = imageStore.importAll(uris)
        val existing = repository.getPages(bookId)
        val ids = paths.mapIndexed { index, path ->
            repository.createPage(bookId, existing.size + index + 1, path).id
        }
        preparationEngine.preparePages(bookId, ids.toSet())
    }

    suspend fun addDictatedPage(bookId: String, text: String) = runOperation {
        require(text.isNotBlank()) { localize("The page is empty.", "Страница пустая.") }
        val book = requireNotNull(repository.getBook(bookId))
        val pages = repository.getPages(bookId)
        val page = repository.createPage(bookId, pages.size + 1, "", text.trim())
        val analysis = com.storybloom.app.vision.LocalCueAnalyzer.analyze(text.trim())
        repository.replacePageAnalysis(page.id, analysis)
        repository.updateBookPrep(
            bookId,
            com.storybloom.app.data.PrepStatus.READY,
            book.hasDialogue || analysis.cues.any { it.type == com.storybloom.app.data.CueType.CHARACTER },
        )
    }

    suspend fun deleteBook(bookId: String) = runOperation {
        val pages = repository.getPages(bookId)
        repository.deleteBook(bookId)
        pages.forEach { page ->
            if (page.imagePath.isNotBlank()) imageStore.delete(page.imagePath)
        }
        if (route is AppRoute.BookDetails) back()
    }

    suspend fun deletePage(pageId: String) = runOperation {
        val page = repository.getPage(pageId) ?: return@runOperation
        val remaining = repository.getPages(page.bookId).filterNot { it.id == pageId }
        repository.deletePage(pageId)
        repository.reorderPages(remaining.map { it.id })
        if (page.imagePath.isNotBlank()) imageStore.delete(page.imagePath)
    }

    suspend fun refreshBooks() {
        _loading.value = true
        _books.value = runCatching { repository.listBookSummaries() }
            .onFailure {
                _messages.emit(
                    localize(
                        "The library could not be loaded. Please try again.",
                        "Не удалось загрузить библиотеку. Попробуйте ещё раз.",
                    ),
                )
            }
            .getOrDefault(emptyList())
        _loading.value = false
    }

    fun notify(message: String) {
        _messages.tryEmit(message)
    }

    fun localize(english: String, russian: String): String =
        if (_locale.value == UiLocale.RUSSIAN) russian else english

    suspend fun <T> runOperation(block: suspend () -> T): T? = try {
        block()
    } catch (error: Throwable) {
        _messages.emit(userFacingMessage(error))
        null
    }

    private fun userFacingMessage(error: Throwable): String {
        val message = error.message
        return when (message) {
            localize(
                "Choose at least one page.",
                "Выберите хотя бы одну страницу.",
            ),
            localize(
                "Tell or type at least one page.",
                "Расскажите или напишите хотя бы одну страницу.",
            ),
            localize(
                "The page is empty.",
                "Страница пустая.",
            ),
            -> requireNotNull(message)

            "The selected image could not be decoded." ->
                localize("That image could not be opened.", "Не удалось открыть это изображение.")

            "The page image is no longer available." ->
                localize(
                    "That page image is no longer available.",
                    "Изображение этой страницы больше недоступно.",
                )

            else -> localize(
                "Something went wrong. Please try again.",
                "Что-то пошло не так. Попробуйте ещё раз.",
            )
        }
    }
}

fun UiLocale.text(english: String, russian: String): String =
    if (this == UiLocale.RUSSIAN) russian else english
