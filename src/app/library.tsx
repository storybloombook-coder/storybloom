import { Directory, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TactileButton from '../components/TactileButton';
import { deleteBook, listBookSummaries, type BookSummary } from '../lib/db';
import type { Book } from '../lib/types';

const STATUS: Record<Book['prepStatus'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#8e8e93' },
  processing: { label: 'Prepping…', color: '#e8a33d' },
  ready: { label: 'Ready', color: '#2fb344' },
  failed: { label: 'Prep failed', color: '#ff453a' },
};

const REVIEW_LABEL: Record<Book['reviewStatus'], string> = {
  unreviewed: 'Not reviewed',
  in_progress: 'Review started',
  approved: 'Approved',
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

  const [books, setBooks] = useState<BookSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => listBookSummaries().then(setBooks), []);

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
    Alert.alert(
      'Delete book?',
      `"${book.title}" and its ${book.pageCount} page${book.pageCount === 1 ? '' : 's'} will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteBook(book.id);
            // Remove the book's image files too (the DB delete only clears rows).
            try {
              const dir = new Directory(Paths.document, 'books', book.id);
              if (dir.exists) dir.delete();
            } catch {
              // Non-fatal: rows are already gone; a stale folder is harmless.
            }
            setBooks((prev) => prev.filter((b) => b.id !== book.id));
          },
        },
      ]
    );
  }

  function openBook(book: BookSummary) {
    router.push({ pathname: '/book/[id]', params: { id: book.id } });
  }

  const Badge = ({ label }: { label: string }) => (
    <View style={StyleSheet.flatten([styles.badge, { backgroundColor: badgeBackground }])}>
      <Text style={StyleSheet.flatten([styles.badgeText, { color: subColor }])}>{label}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <Stack.Screen options={{ headerShown: true, title: 'My Library' }} />

      {books.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: textColor }]}>Your library is empty</Text>
          <Text style={[styles.emptyText, { color: subColor }]}>
            Photograph a book’s pages and Storybloom will bring it to life.
          </Text>
          <TactileButton
            style={StyleSheet.flatten([styles.cta, { backgroundColor: '#208AEF' }])}
            onPress={() => router.push('/add-book')}
          >
            <Text style={styles.ctaLabel}>Add your first book</Text>
          </TactileButton>
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={subColor} />
          }
          ListHeaderComponent={
            <Text style={[styles.count, { color: subColor }]}>
              {books.length} book{books.length === 1 ? '' : 's'}
            </Text>
          }
          renderItem={({ item }) => {
            const status = STATUS[item.prepStatus];
            return (
              <Pressable
                onPress={() => openBook(item)}
                onLongPress={() => confirmDelete(item)}
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
                    <Badge label={item.source === 'pdf' ? 'PDF' : 'Photos'} />
                    {item.hasDialogue && <Badge label="Dialogue" />}
                    <Badge label={REVIEW_LABEL[item.reviewStatus]} />
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 21, marginBottom: 8 },
  cta: { borderRadius: 12, paddingVertical: 15, paddingHorizontal: 22, alignItems: 'center' },
  ctaLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },

  list: { padding: 16, gap: 12 },
  count: { fontSize: 13, fontWeight: '600', marginBottom: 4, marginLeft: 2 },

  card: { flexDirection: 'row', borderRadius: 14, padding: 12, marginBottom: 12, gap: 12 },
  cover: { width: 60, height: 80, borderRadius: 8 },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, gap: 4, justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '600' },

  statusRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 13, fontWeight: '600' },
  meta: { fontSize: 13 },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600' },
});
