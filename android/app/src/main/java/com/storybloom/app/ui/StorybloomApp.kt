package com.storybloom.app.ui

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.material3.SnackbarHostState
import com.storybloom.app.ui.screens.AddBookScreen
import com.storybloom.app.ui.screens.BookDetailsScreen
import com.storybloom.app.ui.screens.CreateStoryScreen
import com.storybloom.app.ui.screens.HomeScreen
import com.storybloom.app.ui.screens.LibraryScreen
import com.storybloom.app.ui.screens.PageEditorScreen
import com.storybloom.app.ui.screens.ReaderScreen
import com.storybloom.app.ui.screens.RecordingsScreen
import com.storybloom.app.ui.screens.SceneScreen

@Composable
fun StorybloomApp(
    viewModel: StorybloomViewModel = viewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val routes by viewModel.routes.collectAsState()
    val route = routes.last()
    val currentRoute by rememberUpdatedState(route)
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current

    BackHandler(enabled = routes.size > 1) {
        viewModel.back()
    }

    LaunchedEffect(Unit) {
        viewModel.messages.collect { message ->
            if (currentRoute is AppRoute.Reader || currentRoute is AppRoute.Scene || currentRoute is AppRoute.Home) {
                Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            } else {
                snackbar.showSnackbar(message)
            }
        }
    }

    when (val destination = route) {
        AppRoute.Home -> HomeScreen(
            locale = uiState.locale,
            onLocaleChange = viewModel::setLocale,
            onLibrary = { viewModel.navigate(AppRoute.Library) },
            onAddBook = { viewModel.navigate(AppRoute.AddBook) },
            onCreateStory = { viewModel.navigate(AppRoute.CreateStory) },
            onScene = { viewModel.navigate(AppRoute.Scene) },
        )
        AppRoute.Library -> LibraryScreen(
            viewModel = viewModel,
            books = uiState.books,
            loading = uiState.loading,
            locale = uiState.locale,
            snackbarHostState = snackbar,
            onBack = { viewModel.back() },
            onBook = { viewModel.navigate(AppRoute.BookDetails(it)) },
            onAdd = { viewModel.navigate(AppRoute.AddBook) },
            onRecordings = { viewModel.navigate(AppRoute.Recordings) },
        )
        AppRoute.AddBook -> AddBookScreen(
            viewModel = viewModel,
            locale = uiState.locale,
            snackbarHostState = snackbar,
            onBack = { viewModel.back() },
            onDictateInstead = { viewModel.replace(AppRoute.CreateStory) },
        )
        AppRoute.CreateStory -> CreateStoryScreen(
            viewModel = viewModel,
            locale = uiState.locale,
            snackbarHostState = snackbar,
            onBack = { viewModel.back() },
        )
        is AppRoute.BookDetails -> BookDetailsScreen(
            viewModel = viewModel,
            bookId = destination.bookId,
            locale = uiState.locale,
            snackbarHostState = snackbar,
            onBack = { viewModel.back() },
            onPage = { viewModel.navigate(AppRoute.PageEditor(it)) },
            onRead = { viewModel.navigate(AppRoute.Reader(destination.bookId)) },
        )
        is AppRoute.PageEditor -> PageEditorScreen(
            viewModel = viewModel,
            pageId = destination.pageId,
            locale = uiState.locale,
            snackbarHostState = snackbar,
            onBack = { viewModel.back() },
        )
        is AppRoute.Reader -> ReaderScreen(
            viewModel = viewModel,
            bookId = destination.bookId,
            locale = uiState.locale,
            onClose = { viewModel.back() },
        )
        AppRoute.Scene -> SceneScreen(
            locale = uiState.locale,
            onLocaleChange = viewModel::setLocale,
            onAddBook = { viewModel.navigate(AppRoute.AddBook) },
            onCreateStory = { viewModel.navigate(AppRoute.CreateStory) },
            onLibrary = { viewModel.navigate(AppRoute.Library) },
            onBack = { viewModel.back() },
        )
        AppRoute.Recordings -> RecordingsScreen(
            viewModel = viewModel,
            locale = uiState.locale,
            snackbarHostState = snackbar,
            onBack = { viewModel.back() },
        )
    }
}
