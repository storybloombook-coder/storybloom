package com.storybloom.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.storybloom.app.data.BookSource
import com.storybloom.app.data.BookSummary
import com.storybloom.app.data.PrepStatus
import com.storybloom.app.ui.AppRoute
import com.storybloom.app.ui.StorybloomViewModel
import com.storybloom.app.ui.UiLocale
import com.storybloom.app.ui.components.EmptyState
import com.storybloom.app.ui.components.NativeImage
import com.storybloom.app.ui.text
import com.storybloom.app.ui.theme.BloomCoral
import com.storybloom.app.ui.theme.BloomGreen
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

private val ShelfWood = Color(0xFF8A5A34)
private val ShelfWoodDark = Color(0xFF6B4423)
private val FavoriteGold = Color(0xFFF5B301)
private val PreparingAmber = Color(0xFFE8A33D)

@Composable
fun LibraryScreen(
    viewModel: StorybloomViewModel,
    books: List<BookSummary>,
    loading: Boolean,
    locale: UiLocale,
    snackbarHostState: androidx.compose.material3.SnackbarHostState,
    onBack: () -> Unit,
    onBook: (String) -> Unit,
    onAdd: () -> Unit,
    onRecordings: () -> Unit,
) {
    var favoritesOnly by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<BookSummary?>(null) }
    val scope = rememberCoroutineScope()
    val favorites = books
        .filter { it.book.isFavorite }
        .sortedWith(
            compareBy<BookSummary> { it.book.shelfPosition ?: Int.MAX_VALUE }
                .thenBy { it.book.createdAt },
        )
    val visibleBooks = if (favoritesOnly) favorites else books

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Rounded.ArrowBack,
                            contentDescription = locale.text("Back", "Назад"),
                        )
                    }
                },
                title = {
                    LibraryTabs(
                        locale = locale,
                        onRecordings = onRecordings,
                        modifier = Modifier.padding(end = 12.dp),
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background.copy(alpha = .96f),
                ),
            )
        },
        floatingActionButton = {
            SmallFloatingActionButton(
                onClick = onAdd,
                shape = CircleShape,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(
                    Icons.Rounded.Add,
                    contentDescription = locale.text("Add book", "Добавить книгу"),
                )
            }
        },
    ) { padding ->
        when {
            loading -> Box(
                Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }

            books.isEmpty() -> EmptyState(
                title = locale.text("Your shelf is waiting", "Ваша полка ждёт"),
                message = locale.text(
                    "Add a picture book or create a story to begin.",
                    "Добавьте книжку с картинками или создайте свою историю.",
                ),
                actionText = locale.text("Add the first book", "Добавить первую книгу"),
                onAction = onAdd,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            )

            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    top = 10.dp,
                    end = 16.dp,
                    bottom = 88.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (!favoritesOnly && favorites.isNotEmpty()) {
                    item(key = "favorite-shelf") {
                        FavoriteShelf(
                            books = favorites,
                            locale = locale,
                            onBook = onBook,
                        )
                    }
                }

                item(key = "book-count") {
                    LibraryCountRow(
                        locale = locale,
                        bookCount = books.size,
                        favoriteCount = favorites.size,
                        favoritesOnly = favoritesOnly,
                        onToggleFavorites = { favoritesOnly = !favoritesOnly },
                    )
                }

                if (visibleBooks.isEmpty()) {
                    item(key = "no-favorites") {
                        NoFavorites(
                            locale = locale,
                            onShowAll = { favoritesOnly = false },
                        )
                    }
                } else {
                    items(visibleBooks, key = { it.book.id }) { summary ->
                        SwipeBookCard(
                            summary = summary,
                            locale = locale,
                            onClick = { onBook(summary.book.id) },
                            onPlay = {
                                viewModel.navigate(AppRoute.Reader(summary.book.id))
                            },
                            onFavorite = {
                                scope.launch {
                                    viewModel.runOperation {
                                        viewModel.repository.setFavorite(
                                            summary.book.id,
                                            !summary.book.isFavorite,
                                        )
                                    }
                                }
                            },
                            onDelete = { deleteTarget = summary },
                        )
                    }
                }
            }
        }
    }

    deleteTarget?.let { summary ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = {
                Text(locale.text("Delete this book?", "Удалить эту книгу?"))
            },
            text = {
                Text(
                    locale.text(
                        "“${summary.book.title}” and its pages will be removed from this device.",
                        "«${summary.book.title}» и все страницы будут удалены с устройства.",
                    ),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        deleteTarget = null
                        scope.launch { viewModel.deleteBook(summary.book.id) }
                    },
                ) {
                    Text(
                        locale.text("Delete", "Удалить"),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) {
                    Text(locale.text("Cancel", "Отмена"))
                }
            },
        )
    }
}

@Composable
private fun LibraryTabs(
    locale: UiLocale,
    onRecordings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        HeaderTab(
            text = locale.text("My Library", "Моя библиотека"),
            selected = true,
            onClick = {},
            modifier = Modifier.weight(1f),
        )
        HeaderTab(
            text = locale.text("My Recordings", "Мои записи"),
            selected = false,
            onClick = onRecordings,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun HeaderTab(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val borderColor = if (selected) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.outline.copy(alpha = .65f)
    }
    val backgroundColor = if (selected) {
        MaterialTheme.colorScheme.primary.copy(alpha = .12f)
    } else {
        Color.Transparent
    }
    Box(
        modifier = modifier
            .height(36.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(backgroundColor)
            .border(1.5.dp, borderColor, RoundedCornerShape(10.dp))
            .clickable(enabled = !selected, onClick = onClick)
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            color = if (selected) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun FavoriteShelf(
    books: List<BookSummary>,
    locale: UiLocale,
    onBook: (String) -> Unit,
) {
    Column {
        Text(
            text = locale.text("Bookshelf", "Книжная полка"),
            modifier = Modifier.padding(start = 2.dp, bottom = 6.dp),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Bold,
        )
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(130.dp),
        ) {
            LazyRow(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 7.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                items(books, key = { it.book.id }) { summary ->
                    FavoriteSpine(
                        summary = summary,
                        onClick = { onBook(summary.book.id) },
                    )
                }
            }
            Box(
                Modifier
                    .align(Alignment.BottomStart)
                    .width(6.dp)
                    .height(122.dp)
                    .background(
                        ShelfWoodDark,
                        RoundedCornerShape(topStart = 3.dp, bottomStart = 3.dp),
                    ),
            )
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .width(6.dp)
                    .height(122.dp)
                    .background(
                        ShelfWoodDark,
                        RoundedCornerShape(topEnd = 3.dp, bottomEnd = 3.dp),
                    ),
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(14.dp)
                .background(
                    ShelfWood,
                    RoundedCornerShape(bottomStart = 4.dp, bottomEnd = 4.dp),
                ),
        )
    }
}

@Composable
private fun FavoriteSpine(
    summary: BookSummary,
    onClick: () -> Unit,
) {
    val spineColor = remember(summary.book.id) {
        Color.hsv(
            hue = deterministicHue(summary.book.id),
            saturation = .56f,
            value = .68f,
        )
    }
    Box(
        modifier = Modifier
            .width(56.dp)
            .height(122.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(spineColor)
            .clickable(onClick = onClick),
    ) {
        Box(
            Modifier
                .padding(start = 4.dp)
                .width(2.dp)
                .height(122.dp)
                .background(Color.White.copy(alpha = .30f)),
        )
        Text(
            text = summary.book.title,
            modifier = Modifier
                .align(Alignment.Center)
                .width(102.dp)
                .graphicsLayer { rotationZ = 90f },
            color = Color.White.copy(alpha = .94f),
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 14.dp)
                .fillMaxWidth(.78f)
                .height(3.dp)
                .background(
                    Color.White.copy(alpha = .24f),
                    RoundedCornerShape(2.dp),
                ),
        )
    }
}

@Composable
private fun LibraryCountRow(
    locale: UiLocale,
    bookCount: Int,
    favoriteCount: Int,
    favoritesOnly: Boolean,
    onToggleFavorites: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(38.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = if (favoritesOnly) {
                favoriteCountLabel(locale, favoriteCount)
            } else {
                bookAndFavoriteCountLabel(locale, bookCount, favoriteCount)
            },
            modifier = Modifier.padding(start = 2.dp),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
        )
        IconButton(
            onClick = onToggleFavorites,
            modifier = Modifier.size(36.dp),
        ) {
            Icon(
                imageVector = if (favoritesOnly) Icons.Rounded.Star else Icons.Rounded.StarBorder,
                contentDescription = if (favoritesOnly) {
                    locale.text("Show all books", "Показать все книги")
                } else {
                    locale.text("Show favorites", "Показать избранное")
                },
                tint = if (favoritesOnly) FavoriteGold else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun NoFavorites(
    locale: UiLocale,
    onShowAll: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 42.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Rounded.StarBorder,
            contentDescription = null,
            modifier = Modifier.size(46.dp),
            tint = FavoriteGold.copy(alpha = .65f),
        )
        Spacer(Modifier.height(10.dp))
        Text(
            locale.text("No favorite books yet", "Пока нет избранных книг"),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            locale.text(
                "Tap a star beside a book to add it to this shelf.",
                "Нажмите звезду рядом с книгой, чтобы добавить её на полку.",
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = onShowAll) {
            Text(locale.text("Show all books", "Показать все книги"))
        }
    }
}

@Composable
private fun SwipeBookCard(
    summary: BookSummary,
    locale: UiLocale,
    onClick: () -> Unit,
    onPlay: () -> Unit,
    onFavorite: () -> Unit,
    onDelete: () -> Unit,
) {
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart) onDelete()
            false
        },
    )
    SwipeToDismissBox(
        state = dismissState,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            Box(
                Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(14.dp))
                    .background(MaterialTheme.colorScheme.errorContainer)
                    .padding(horizontal = 18.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Icon(
                    Icons.Rounded.Delete,
                    contentDescription = locale.text("Delete", "Удалить"),
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        },
    ) {
        BookCard(
            summary = summary,
            locale = locale,
            onClick = onClick,
            onPlay = onPlay,
            onFavorite = onFavorite,
        )
    }
}

@Composable
private fun BookCard(
    summary: BookSummary,
    locale: UiLocale,
    onClick: () -> Unit,
    onPlay: () -> Unit,
    onFavorite: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        shape = RoundedCornerShape(14.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            NativeImage(
                path = summary.book.coverImagePath,
                modifier = Modifier
                    .size(width = 60.dp, height = 80.dp)
                    .clip(RoundedCornerShape(8.dp)),
                contentDescription = summary.book.title,
                maxEdge = 360,
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = summary.book.title,
                    fontSize = 17.sp,
                    lineHeight = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                BookStatusRow(summary = summary, locale = locale)
                Text(
                    text = formatBookDate(summary.book.createdAt, locale),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    BookBadge(
                        label = when (summary.book.source) {
                            BookSource.DICTATION -> locale.text("Dictated", "Диктовка")
                            BookSource.PHOTOS -> locale.text("Photos", "Фото")
                        },
                    )
                    if (summary.book.hasDialogue) {
                        BookBadge(locale.text("Dialogue", "Диалоги"))
                    }
                }
            }
            Column(
                modifier = Modifier.width(36.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                IconButton(
                    onClick = onFavorite,
                    modifier = Modifier.size(36.dp),
                ) {
                    Icon(
                        imageVector = if (summary.book.isFavorite) {
                            Icons.Rounded.Star
                        } else {
                            Icons.Rounded.StarBorder
                        },
                        contentDescription = if (summary.book.isFavorite) {
                            locale.text("Remove from favorites", "Убрать из избранного")
                        } else {
                            locale.text("Add to favorites", "Добавить в избранное")
                        },
                        tint = if (summary.book.isFavorite) {
                            FavoriteGold
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
                if (summary.book.prepStatus == PrepStatus.READY && summary.pageCount > 0) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(BloomGreen.copy(alpha = .14f))
                            .border(1.5.dp, BloomGreen, CircleShape)
                            .clickable(onClick = onPlay),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Rounded.PlayArrow,
                            contentDescription = locale.text("Read", "Читать"),
                            modifier = Modifier.size(21.dp),
                            tint = BloomGreen,
                        )
                    }
                } else {
                    Spacer(Modifier.height(36.dp))
                }
            }
        }
    }
}

@Composable
private fun BookStatusRow(
    summary: BookSummary,
    locale: UiLocale,
) {
    val statusColor = when (summary.book.prepStatus) {
        PrepStatus.READY -> BloomGreen
        PrepStatus.PROCESSING -> PreparingAmber
        PrepStatus.FAILED -> BloomCoral
        PrepStatus.PENDING -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val statusText = when (summary.book.prepStatus) {
        PrepStatus.READY -> locale.text("Ready", "Готово")
        PrepStatus.PROCESSING -> locale.text("Preparing", "Подготовка")
        PrepStatus.FAILED -> locale.text("Needs attention", "Нужна проверка")
        PrepStatus.PENDING -> locale.text("Waiting", "Ожидание")
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(8.dp)
                .background(statusColor, CircleShape),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = statusText,
            style = MaterialTheme.typography.labelMedium,
            color = statusColor,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
        Text(
            text = locale.text(
                "  ·  ${summary.pageCount} pages · ${summary.cueCount} sounds",
                "  ·  ${summary.pageCount} стр. · ${summary.cueCount} звуков",
            ),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun BookBadge(
    label: String,
) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Text(
            text = label,
            fontSize = 11.sp,
            lineHeight = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

private fun deterministicHue(id: String): Float {
    var hash = 0L
    id.forEach { character ->
        hash = (hash * 31L + character.code) and 0xFFFF_FFFFL
    }
    return (hash % 360L).toFloat()
}

private fun formatBookDate(
    timestamp: Long,
    locale: UiLocale,
): String {
    val language = if (locale == UiLocale.RUSSIAN) {
        Locale.forLanguageTag("ru")
    } else {
        Locale.ENGLISH
    }
    val date = Calendar.getInstance().apply { timeInMillis = timestamp }
    val now = Calendar.getInstance()
    return when {
        isSameDay(date, now) -> {
            val pattern = if (locale == UiLocale.RUSSIAN) "HH:mm" else "h:mm a"
            "${locale.text("Today", "Сегодня")} ${
                SimpleDateFormat(pattern, language).format(date.time)
            }"
        }

        isYesterday(date, now) -> locale.text("Yesterday", "Вчера")
        else -> DateFormat.getDateInstance(DateFormat.MEDIUM, language).format(date.time)
    }
}

private fun isSameDay(
    first: Calendar,
    second: Calendar,
): Boolean =
    first.get(Calendar.ERA) == second.get(Calendar.ERA) &&
        first.get(Calendar.YEAR) == second.get(Calendar.YEAR) &&
        first.get(Calendar.DAY_OF_YEAR) == second.get(Calendar.DAY_OF_YEAR)

private fun isYesterday(
    date: Calendar,
    now: Calendar,
): Boolean {
    val yesterday = now.clone() as Calendar
    yesterday.add(Calendar.DAY_OF_YEAR, -1)
    return isSameDay(date, yesterday)
}

private fun bookAndFavoriteCountLabel(
    locale: UiLocale,
    bookCount: Int,
    favoriteCount: Int,
): String = if (locale == UiLocale.RUSSIAN) {
    "$bookCount ${russianPlural(bookCount, "книга", "книги", "книг")} · " +
        "$favoriteCount ${russianPlural(favoriteCount, "избранная", "избранные", "избранных")}"
} else {
    "$bookCount ${if (bookCount == 1) "book" else "books"} · " +
        "$favoriteCount ${if (favoriteCount == 1) "favorite" else "favorites"}"
}

private fun favoriteCountLabel(
    locale: UiLocale,
    favoriteCount: Int,
): String = if (locale == UiLocale.RUSSIAN) {
    "$favoriteCount ${russianPlural(favoriteCount, "избранная", "избранные", "избранных")}"
} else {
    "$favoriteCount ${if (favoriteCount == 1) "favorite" else "favorites"}"
}

private fun russianPlural(
    count: Int,
    one: String,
    few: String,
    many: String,
): String {
    val mod100 = count % 100
    val mod10 = count % 10
    return when {
        mod100 in 11..14 -> many
        mod10 == 1 -> one
        mod10 in 2..4 -> few
        else -> many
    }
}
