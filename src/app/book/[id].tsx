import { Directory, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TactileButton from '../../components/TactileButton';
import { deleteBook, getBook, getCuesForBook, getPagesForBook } from '../../lib/db';
import type { Book, Cue, Page } from '../../lib/types';

const STATUS: Record<Book['prepStatus'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#8e8e93' },
  processing: { label: 'Prepping…', color: '#e8a33d' },
  ready: { label: 'Ready', color: '#2fb344' },
  failed: { label: 'Prep failed', color: '#ff453a' },
};

export default function BookDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const bookId = Array.isArray(params.id) ? params.id[0] : params.id;

  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const subColor = isDark ? '#9a9a9e' : '#6b6b70';
  const backgroundColor = isDark ? '#000' : '#fff';
  const cardBackground = isDark ? '#1c1c1e' : '#f4f4f6';
  const chipBackground = isDark ? '#2c2c2e' : '#e6e6ea';

  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [cuesByPage, setCuesByPage] = useState<Map<string, Cue[]>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bookId) return;
    (async () => {
      const [b, ps, cs] = await Promise.all([
        getBook(bookId),
        getPagesForBook(bookId),
        getCuesForBook(bookId),
      ]);
      const grouped = new Map<string, Cue[]>();
      for (const c of cs) {
        const arr = grouped.get(c.pageId) ?? [];
        arr.push(c);
        grouped.set(c.pageId, arr);
      }
      setBook(b);
      setPages(ps);
      setCuesByPage(grouped);
      setLoading(false);
    })();
  }, [bookId]);

  function confirmDelete() {
    if (!book) return;
    Alert.alert('Delete book?', `"${book.title}" and its pages will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteBook(book.id);
          try {
            const dir = new Directory(Paths.document, 'books', book.id);
            if (dir.exists) dir.delete();
          } catch {
            // Non-fatal — rows are gone; a leftover folder is harmless.
          }
          router.back();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.center, { backgroundColor }]}>
        <Stack.Screen options={{ headerShown: true, title: 'Book' }} />
        <ActivityIndicator size="large" color="#208AEF" />
      </SafeAreaView>
    );
  }

  if (!book) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.center, { backgroundColor }]}>
        <Stack.Screen options={{ headerShown: true, title: 'Book' }} />
        <Text style={{ color: textColor }}>This book no longer exists.</Text>
      </SafeAreaView>
    );
  }

  const status = STATUS[book.prepStatus];
  const storyPages = pages.filter((p) => p.pageType === 'story' || p.pageType === 'illustration_only');
  const totalCues = [...cuesByPage.values()].reduce((n, arr) => n + arr.length, 0);

  const Chip = ({ label }: { label: string }) => (
    <View style={[styles.chip, { backgroundColor: chipBackground }]}>
      <Text style={[styles.chipText, { color: subColor }]}>{label}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <Stack.Screen options={{ headerShown: true, title: book.title }} />

      <FlatList
        data={pages}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: status.color }]} />
              <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
            </View>
            <Text style={[styles.summary, { color: subColor }]}>
              {pages.length} page{pages.length === 1 ? '' : 's'} · {storyPages.length} story · {totalCues} cue
              {totalCues === 1 ? '' : 's'}
              {book.hasDialogue ? ' · has dialogue' : ''}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const cues = cuesByPage.get(item.id) ?? [];
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/page/[id]', params: { id: item.id } })}
              style={({ pressed }) => [styles.pageCard, { backgroundColor: cardBackground, opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={styles.pageTop}>
                <Image source={{ uri: item.imagePath }} style={styles.thumb} contentFit="cover" transition={120} />
                <View style={styles.pageInfo}>
                  <Text style={[styles.pageNo, { color: textColor }]}>
                    Page {item.pageNumber}
                  </Text>
                  <Text style={[styles.pageMeta, { color: subColor }]}>{item.pageType.replace(/_/g, ' ')}</Text>
                  {item.ambientSoundId && <Chip label={`🎵 ${item.ambientSoundId}`} />}
                </View>
                <Text style={[styles.chevron, { color: subColor }]}>›</Text>
              </View>

              {item.ocrText ? (
                <Text style={[styles.ocr, { color: textColor }]}>{item.ocrText}</Text>
              ) : (
                <Text style={[styles.ocrEmpty, { color: subColor }]}>No text recognized on this page.</Text>
              )}

              {cues.length > 0 && (
                <View style={styles.cues}>
                  {cues.map((c) => (
                    <Text key={c.id} style={[styles.cue, { color: subColor }]}>
                      {c.type === 'character' ? '🗣' : '🔊'} “{c.triggerText}” → {c.soundId ?? 'none'}
                      {c.reviewState === 'removed' ? ' (removed)' : ''}
                    </Text>
                  ))}
                </View>
              )}
            </Pressable>
          );
        }}
        ListFooterComponent={
          <TactileButton style={styles.deleteButton} onPress={confirmDelete}>
            <Text style={styles.deleteLabel}>Delete book</Text>
          </TactileButton>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },

  list: { padding: 16, gap: 12 },
  header: { marginBottom: 8, gap: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 14, fontWeight: '700' },
  summary: { fontSize: 13 },

  pageCard: { borderRadius: 14, padding: 12, marginBottom: 12, gap: 10 },
  pageTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumb: { width: 54, height: 72, borderRadius: 8 },
  pageInfo: { flex: 1, gap: 4 },
  pageNo: { fontSize: 16, fontWeight: '600' },
  pageMeta: { fontSize: 13, textTransform: 'capitalize' },
  chevron: { fontSize: 28, fontWeight: '300', marginLeft: 4 },

  ocr: { fontSize: 14, lineHeight: 20 },
  ocrEmpty: { fontSize: 13, fontStyle: 'italic' },

  cues: { gap: 3, marginTop: 2 },
  cue: { fontSize: 13, lineHeight: 18 },

  chip: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 11, fontWeight: '600' },

  deleteButton: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: 'rgba(255,69,58,0.12)',
  },
  deleteLabel: { color: '#ff453a', fontSize: 16, fontWeight: '600' },
});
