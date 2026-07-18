import { Directory, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Bookshelf from '../components/Bookshelf';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import RecordingsList from '../components/RecordingsList';
import SwipeableRow from '../components/SwipeableRow';
import TactileButton from '../components/TactileButton';
import {
  deleteBook,
  getAllCues,
  getAllPages,
  listBookSummaries,
  setBookFavorite,
  updateShelfOrder,
  type BookSummary,
} from '../lib/db';
import {
  checkReadiness,
  warningLabel,
  type ReadinessReport,
  type ReadinessWarning,
} from '../lib/reader/readiness';
import type { Book, Cue } from '../lib/types';

const STATUS: Record<Book['prepStatus'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#8e8e93' },
  processing: { label: 'Prepping…', color: '#e8a33d' },
  ready: { label: 'Ready', color: '#2fb344' },
  failed: { label: 'Prep failed', color: '#ff453a' },
};

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export default function LibraryScreen() {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const subColor = isDark ? '#9a9a9e' : '#6b6b70';
  const backgroundColor = isDark ? '#000' : '#fff';
  const cardBackground = isDark ? '#1c1c1e' : '#f4f4f6';
  const badgeBackground = isDark ? '#2c2c2e' : '#e6e6ea';
  // Header tab pair (My Library / My Recordings) — same outline treatment as
  // the language-choice buttons on Create a Story, just sized for the header.
  const tabBorderColor = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';

  const [books, setBooks] = useState<BookSummary[]>([]);
  const [readinessByBook, setReadinessByBook] = useState<Map<string, ReadinessReport>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BookSummary | null>(null);
  const [missingFor, setMissingFor] = useState<{ title: string; warnings: ReadinessWarning[] } | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  // My Library / My Recordings — the two header tabs replace what used to be
  // a separate /recordings route; recordings aren't a thing outside the
  // library they're reused across, so a tab (not a whole new screen) is all
  // the separation this needs.
  const [viewMode, setViewMode] = useState<'books' | 'recordings'>('books');
  const sheetBackground = isDark ? '#1c1c1e' : '#fff';

  const favoriteCount = books.filter((b) => b.isFavorite).length;
  const visibleBooks = favoritesOnly ? books.filter((b) => b.isFavorite) : books;
  const shelfBooks = books
    .filter((b) => b.isFavorite)
    .sort((a, b) => (a.shelfPosition ?? Infinity) - (b.shelfPosition ?? Infinity));

  const load = useCallback(async () => {
    const [summaries, allPages, allCues] = await Promise.all([
      listBookSummaries(),
      getAllPages(),
      getAllCues(),
    ]);
    // Group cues by page (page ids are globally unique), then run the same
    // readiness check the book-detail gate uses, once per book.
    const cuesByPage = new Map<string, Cue[]>();
    for (const c of allCues) {
      const arr = cuesByPage.get(c.pageId) ?? [];
      arr.push(c);
      cuesByPage.set(c.pageId, arr);
    }
    const pagesByBook = new Map<string, typeof allPages>();
    for (const p of allPages) {
      const arr = pagesByBook.get(p.bookId) ?? [];
      arr.push(p);
      pagesByBook.set(p.bookId, arr);
    }
    const readiness = new Map<string, ReadinessReport>();
    for (const b of summaries) {
      readiness.set(b.id, checkReadiness(pagesByBook.get(b.id) ?? [], cuesByPage));
    }
    setBooks(summaries);
    setReadinessByBook(readiness);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  function confirmDelete(book: BookSummary) {
    setPendingDelete(book);
  }

  async function performDelete() {
    const book = pendingDelete;
    if (!book) return;
    setPendingDelete(null);
    await deleteBook(book.id);
    // Remove the book's image files too (the DB delete only clears rows).
    try {
      const dir = new Directory(Paths.document, 'books', book.id);
      if (dir.exists) dir.delete();
    } catch {
      // Non-fatal: rows are already gone; a stale folder is harmless.
    }
    setBooks((prev) => prev.filter((b) => b.id !== book.id));
  }

  function openBook(book: BookSummary) {
    router.push({ pathname: '/book/[id]', params: { id: book.id } });
  }

  async function handleShelfReorder(orderedIds: string[]) {
    // Optimistic: stamp the new shelfPosition locally so a re-render (e.g.
    // pull-to-refresh) doesn't briefly show the pre-drag order.
    const rank = new Map(orderedIds.map((id, i) => [id, i]));
    setBooks((prev) => prev.map((b) => (rank.has(b.id) ? { ...b, shelfPosition: rank.get(b.id)! } : b)));
    try {
      await updateShelfOrder(orderedIds);
    } catch {
      await load();
    }
  }

  async function toggleFavorite(book: BookSummary) {
    const next = !book.isFavorite;
    setBooks((prev) => prev.map((b) => (b.id === book.id ? { ...b, isFavorite: next } : b)));
    try {
      await setBookFavorite(book.id, next);
    } catch {
      // Revert the optimistic update if the write fails.
      setBooks((prev) => prev.map((b) => (b.id === book.id ? { ...b, isFavorite: !next } : b)));
    }
  }

  const Badge = ({ label }: { label: string }) => (
    <View style={StyleSheet.flatten([styles.badge, { backgroundColor: badgeBackground }])}>
      <Text style={StyleSheet.flatten([styles.badgeText, { color: subColor }])}>{label}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitleAlign: 'left',
          headerTitle: () => (
            <View style={styles.tabRow}>
              <TactileButton
                style={[
                  styles.tabBtn,
                  viewMode === 'books'
                    ? { backgroundColor: 'rgba(32,138,239,0.15)', borderColor: '#208AEF' }
                    : { borderColor: tabBorderColor },
                ]}
                onPress={() => setViewMode('books')}
              >
                <Text style={[styles.tabLabel, { color: viewMode === 'books' ? '#208AEF' : subColor }]}>
                  My Library
                </Text>
              </TactileButton>
              <TactileButton
                style={[
                  styles.tabBtn,
                  viewMode === 'recordings'
                    ? { backgroundColor: 'rgba(32,138,239,0.15)', borderColor: '#208AEF' }
                    : { borderColor: tabBorderColor },
                ]}
                onPress={() => setViewMode('recordings')}
              >
                <Text style={[styles.tabLabel, { color: viewMode === 'recordings' ? '#208AEF' : subColor }]}>
                  My Recordings
                </Text>
              </TactileButton>
            </View>
          ),
        }}
      />

      {viewMode === 'recordings' ? (
        <RecordingsList />
      ) : books.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: textColor }]}>Your library is empty</Text>
          <Text style={[styles.emptyText, { color: subColor }]}>
            Photograph a book’s pages and Storybloom will bring it to life.
          </Text>
          <TactileButton
            style={StyleSheet.flatten([
              styles.cta,
              { backgroundColor: 'rgba(32,138,239,0.15)', borderWidth: 2, borderColor: '#208AEF' },
            ])}
            onPress={() => router.push('/add-book')}
          >
            <Text style={styles.ctaLabel}>Add your first book</Text>
          </TactileButton>
        </View>
      ) : favoritesOnly && visibleBooks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyStar}>☆</Text>
          <Text style={[styles.emptyTitle, { color: textColor }]}>No favorites yet</Text>
          <Text style={[styles.emptyText, { color: subColor }]}>
            Tap the ☆ on any book to add it here.
          </Text>
          <TactileButton
            style={StyleSheet.flatten([styles.cta, { backgroundColor: badgeBackground }])}
            onPress={() => setFavoritesOnly(false)}
          >
            <Text style={[styles.ctaLabel, { color: textColor }]}>Show all books</Text>
          </TactileButton>
        </View>
      ) : (
        <FlatList
          data={visibleBooks}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={subColor} />
          }
          ListHeaderComponent={
            <>
              {!favoritesOnly && shelfBooks.length > 0 && (
                <Bookshelf
                  // Remount (fresh physics arrays, correctly sized) only when
                  // the SET of favorited ids changes — order-independent, so
                  // persisting a drag's new order doesn't itself reset it.
                  key={shelfBooks.map((b) => b.id).slice().sort().join(',')}
                  books={shelfBooks}
                  onOpen={openBook}
                  onReorder={handleShelfReorder}
                />
              )}
              <View style={styles.countRow}>
                <Text style={[styles.count, { color: subColor }]}>
                  {favoritesOnly
                    ? `${visibleBooks.length} favorite${visibleBooks.length === 1 ? '' : 's'}`
                    : `${books.length} book${books.length === 1 ? '' : 's'} · ${favoriteCount} favorite${favoriteCount === 1 ? '' : 's'}`}
                </Text>
                {/* The favorites toggle now lives here (not the header) —
                    always tappable, even at 0 favorites, so there's still a
                    way to discover/switch to the Favorites view. Same 36x36
                    tap target and 24pt star as the per-book star button. */}
                <TactileButton onPress={() => setFavoritesOnly((v) => !v)} style={styles.countStarBtn}>
                  <Text style={[styles.countStarIcon, { color: favoritesOnly ? '#f5b301' : subColor }]}>
                    {favoritesOnly ? '★' : '☆'}
                  </Text>
                </TactileButton>
              </View>
            </>
          }
          renderItem={({ item }) => {
            const status = STATUS[item.prepStatus];
            const readiness = readinessByBook.get(item.id);
            const canRead = (readiness?.storyPageCount ?? 0) > 0;
            const missingCount = readiness?.warnings.length ?? 0;
            return (
              <SwipeableRow onDelete={() => confirmDelete(item)}>
              <Pressable
                onPress={() => openBook(item)}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: cardBackground, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                {item.coverImagePath ? (
                  <Image source={{ uri: item.coverImagePath }} style={styles.cover} contentFit="cover" transition={120} />
                ) : (
                  <View style={[styles.cover, styles.coverEmpty, { backgroundColor: badgeBackground }]}>
                    <Text style={{ color: subColor, fontSize: 22 }}>📖</Text>
                  </View>
                )}

                <View style={styles.cardBody}>
                  <Text style={[styles.title, { color: textColor }]} numberOfLines={2}>
                    {item.title}
                  </Text>

                  <View style={styles.statusRow}>
                    <View style={[styles.dot, { backgroundColor: status.color }]} />
                    <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                    <Text style={[styles.meta, { color: subColor }]}>
                      {'  ·  '}
                      {item.pageCount} pg · {item.cueCount} cue{item.cueCount === 1 ? '' : 's'}
                    </Text>
                  </View>

                  <Text style={[styles.meta, { color: subColor }]}>{formatDate(item.createdAt)}</Text>

                  <View style={styles.badges}>
                    <Badge
                      label={item.source === 'dictation' ? '🎙️ Dictated' : 'Photos'}
                    />
                    {item.hasDialogue && <Badge label="Dialogue" />}
                    {missingCount > 0 && (
                      <Pressable
                        onPress={() => setMissingFor({ title: item.title, warnings: readiness!.warnings })}
                        hitSlop={6}
                      >
                        <View style={styles.warnChip}>
                          <Text style={styles.warnChipText}>⚠️ {missingCount}</Text>
                        </View>
                      </Pressable>
                    )}
                  </View>
                </View>

                <Pressable onPress={() => toggleFavorite(item)} hitSlop={10} style={styles.starButton}>
                  <Text style={[styles.starIcon, { color: item.isFavorite ? '#f5b301' : subColor }]}>
                    {item.isFavorite ? '★' : '☆'}
                  </Text>
                </Pressable>
                {canRead && (
                  <Pressable
                    onPress={() => router.push({ pathname: '/read/[id]', params: { id: item.id } })}
                    hitSlop={8}
                    style={styles.playButton}
                  >
                    <Text style={styles.playIcon}>▶</Text>
                  </Pressable>
                )}
              </Pressable>
              </SwipeableRow>
            );
          }}
        />
      )}

      <Modal
        visible={missingFor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setMissingFor(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setMissingFor(null)}>
          <Pressable style={StyleSheet.flatten([styles.sheet, { backgroundColor: sheetBackground }])}>
            <Text style={styles.deleteEmoji}>⚠️</Text>
            <Text style={StyleSheet.flatten([styles.sheetTitle, { color: textColor }])}>
              What’s missing in “{missingFor?.title}”
            </Text>
            <Text style={StyleSheet.flatten([styles.deleteMessage, { color: subColor }])}>
              Tap an item to jump to that page and fix it.
            </Text>
            <ScrollView style={{ alignSelf: 'stretch', maxHeight: 260 }}>
              {missingFor?.warnings.map((w, i) => (
                <Pressable
                  key={`${w.pageId}-${w.kind}-${i}`}
                  style={styles.missingRow}
                  onPress={() => {
                    setMissingFor(null);
                    router.push({ pathname: '/page/[id]', params: { id: w.pageId } });
                  }}
                >
                  <Text style={StyleSheet.flatten([styles.missingText, { color: textColor }])}>
                    {warningLabel(w)}
                  </Text>
                  <Text style={{ color: subColor }}>›</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.sheetButtonWrap}>
              <TactileButton
                style={StyleSheet.flatten([styles.button, { backgroundColor: badgeBackground }])}
                onPress={() => setMissingFor(null)}
              >
                <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>Close</Text>
              </TactileButton>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmDeleteModal
        visible={pendingDelete !== null}
        title={`Delete "${pendingDelete?.title}"?`}
        message={`This book and its ${pendingDelete?.pageCount ?? 0} page${pendingDelete?.pageCount === 1 ? '' : 's'} will be permanently removed.`}
        onConfirm={performDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },

  tabRow: { flexDirection: 'row', gap: 8, width: '100%' },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    gap: 6,
  },
  tabLabel: { fontSize: 13, fontWeight: '600' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 21, marginBottom: 8 },
  cta: { borderRadius: 12, paddingVertical: 15, paddingHorizontal: 22, alignItems: 'center' },
  ctaLabel: { color: '#208AEF', fontSize: 16, fontWeight: '600' },

  list: { padding: 16, gap: 12 },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    marginLeft: 2,
  },
  count: { fontSize: 13, fontWeight: '600' },
  countStarBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countStarIcon: { fontSize: 24 },

  card: { flexDirection: 'row', borderRadius: 14, padding: 12, gap: 12 },
  cover: { width: 60, height: 80, borderRadius: 8 },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, gap: 4, justifyContent: 'center', marginRight: 44 },
  title: { fontSize: 17, fontWeight: '600' },
  starButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starIcon: { fontSize: 24 },
  playButton: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(47,179,68,0.15)',
    borderWidth: 2,
    borderColor: '#2fb344',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // "▶" renders with visible whitespace on its right in the system font, so a
  // dead-center layout looks off-center to the eye — nudge it right to
  // visually balance instead of geometrically center.
  playIcon: { color: '#2fb344', fontSize: 15, marginLeft: 3 },
  warnChip: { backgroundColor: 'rgba(232,163,61,0.18)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  warnChipText: { color: '#e8a33d', fontSize: 11, fontWeight: '700' },
  emptyStar: { fontSize: 46, color: '#f5b301', opacity: 0.6 },
  missingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.2)',
  },
  missingText: { flex: 1, fontSize: 14, marginRight: 8 },

  statusRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 13, fontWeight: '600' },
  meta: { fontSize: 13 },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600' },

  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 12,
    alignItems: 'center',
  },
  deleteEmoji: { fontSize: 34 },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  deleteMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 4,
  },
  // TactileButton only styles its own inner view, not the Pressable that
  // actually sizes itself in the flex layout — so a plain wrapper carries the
  // real width/flex constraint. Needed here because `sheet` centers its
  // children (alignItems: 'center'), which otherwise shrinks buttons to text.
  sheetButtonWrap: { alignSelf: 'stretch' },
  button: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
});
