import { Directory, File as ExpoFile, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import DraggablePageCard, { PAGE_LIST_GAP } from '../../components/DraggablePageCard';
import PhotoEditor from '../../components/PhotoEditor';
import TactileButton from '../../components/TactileButton';
import { SOUND_ALLOWLISTS } from '../../lib/ai/soundLibrary';
import {
  createCue,
  createPage,
  deletePage,
  getBook,
  getCuesForBook,
  getPagesForBook,
  reorderPages,
  setBookPrepStatus,
  updateBookTitle,
  updatePagePrepResult,
} from '../../lib/db';
import { checkReadiness, warningLabel } from '../../lib/reader/readiness';
import type { Book, Cue, Page } from '../../lib/types';
import { createVisionProvider } from '../../lib/vision';

type WorkingImage = { uri: string; width: number; height: number };

function findCharRange(ocrText: string, triggerText: string): { start: number | null; end: number | null } {
  const idx = ocrText.toLowerCase().indexOf(triggerText.toLowerCase());
  if (idx < 0) return { start: null, end: null };
  return { start: idx, end: idx + triggerText.length };
}

const STATUS: Record<Book['prepStatus'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#8e8e93' },
  processing: { label: 'Prepping…', color: '#e8a33d' },
  ready: { label: 'Ready', color: '#2fb344' },
  failed: { label: 'Prep failed', color: '#ff453a' },
};

// Fixed bottom-center trash-bin zone, "popped in" only while dragging a page.
// Computed once from the window size — the bin's own style below must match.
const BIN_SIZE = 72;
const BIN_BOTTOM_OFFSET = 32;
const BIN_HIT_PADDING = 28; // generous extra margin so it's easy to hit
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const BIN_BOUNDS = {
  left: (SCREEN_W - BIN_SIZE) / 2 - BIN_HIT_PADDING,
  right: (SCREEN_W + BIN_SIZE) / 2 + BIN_HIT_PADDING,
  top: SCREEN_H - BIN_BOTTOM_OFFSET - BIN_SIZE - BIN_HIT_PADDING,
  bottom: SCREEN_H - BIN_BOTTOM_OFFSET + BIN_HIT_PADDING,
};

function TrashBin({
  draggingIndex,
  binHover,
}: {
  draggingIndex: SharedValue<number>;
  binHover: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const active = draggingIndex.value !== -1;
    return {
      opacity: withTiming(active ? 1 : 0, { duration: 150 }),
      transform: [{ scale: withTiming(active ? (binHover.value ? 1.2 : 1) : 0.6, { duration: 150 }) }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.trashBin, style]}>
      <Text style={styles.trashBinIcon}>🗑️</Text>
    </Animated.View>
  );
}

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
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [warningsOpen, setWarningsOpen] = useState(false);

  async function saveTitle() {
    if (!book) return;
    const next = titleDraft.trim();
    setRenaming(false);
    if (!next || next === book.title) return;
    setBook({ ...book, title: next });
    await updateBookTitle(book.id, next);
  }

  const draggingIndex = useSharedValue(-1);
  const targetIndex = useSharedValue(-1);
  const binHover = useSharedValue(0);
  const itemHeights = useSharedValue<number[]>([]);

  // Adding more pages to this already-saved book: multi-select library picks
  // (or a single camera shot) queue up one at a time in the same PhotoEditor
  // used at creation time; once the queue's empty, every edited photo is run
  // through the vision pipeline and appended.
  const [editingSource, setEditingSource] = useState<WorkingImage | null>(null);
  const [editQueue, setEditQueue] = useState<WorkingImage[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);
  const [readyPages, setReadyPages] = useState<WorkingImage[]>([]);
  const [addingPages, setAddingPages] = useState(false);
  const [addProgress, setAddProgress] = useState('');

  const load = useCallback(async () => {
    if (!bookId) return;
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
  }, [bookId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    itemHeights.value = new Array(pages.length).fill(0);
  }, [pages.length]);

  // Once the edit queue drains (every queued photo confirmed or skipped),
  // run the accumulated batch through the vision pipeline and append it.
  useEffect(() => {
    if (editingSource === null && readyPages.length > 0 && !addingPages) {
      const toProcess = readyPages;
      setReadyPages([]);
      processNewPages(toProcess);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingSource, readyPages, addingPages]);

  function openNextInQueue(queue: WorkingImage[]) {
    if (queue.length === 0) {
      setEditingSource(null);
      setBatchTotal(0);
      return;
    }
    const [next, ...rest] = queue;
    setEditQueue(rest);
    setEditingSource(next);
  }

  function handleEditorDone(result: WorkingImage) {
    setReadyPages((prev) => [...prev, result]);
    openNextInQueue(editQueue);
  }

  function handleEditorCancel() {
    openNextInQueue(editQueue);
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Camera access is required to photograph pages.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled) {
      const asset = result.assets[0];
      setBatchTotal(0);
      setEditingSource({ uri: asset.uri, width: asset.width, height: asset.height });
    }
  }

  async function pickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Photo library access is required to add pages.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets.length > 0) {
      const queue: WorkingImage[] = result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
      setBatchTotal(queue.length);
      openNextInQueue(queue);
    }
  }

  async function processNewPages(newPhotos: WorkingImage[]) {
    if (!book) return;
    setAddingPages(true);
    try {
      const vision = createVisionProvider();
      const bookDir = new Directory(Paths.document, 'books', book.id);
      if (!bookDir.exists) bookDir.create({ intermediates: true, idempotent: true });

      let anyDialogue = book.hasDialogue;
      let nextPageNumber = pages.length + 1;

      for (let i = 0; i < newPhotos.length; i++) {
        setAddProgress(`Adding page ${nextPageNumber} (${i + 1} of ${newPhotos.length})…`);
        const photo = newPhotos[i];
        const destFile = new ExpoFile(bookDir, `page-${Date.now()}-${i}.jpg`);
        await new ExpoFile(photo.uri).copy(destFile);

        const pageRow = await createPage({ bookId: book.id, pageNumber: nextPageNumber, imagePath: destFile.uri });
        nextPageNumber += 1;

        try {
          const base64 = await destFile.base64();
          const result = await vision.preparePage({
            imageBase64: base64,
            imageMimeType: 'image/jpeg',
            embeddedText: null,
            allowlists: SOUND_ALLOWLISTS,
            lang: book.language,
          });

          await updatePagePrepResult(pageRow.id, {
            pageType: result.page_type,
            ocrText: result.ocr_text,
            backgroundScene: result.background_scene,
            ambientSoundId: result.ambient_sound_id,
          });

          for (const kw of result.keyword_cues) {
            const range = findCharRange(result.ocr_text, kw.trigger_text);
            await createCue({
              pageId: pageRow.id,
              type: 'keyword',
              triggerText: kw.trigger_text,
              contextPhrase: kw.context_phrase ?? null,
              charStart: range.start,
              charEnd: range.end,
              soundId: kw.sound_id,
              characterName: null,
              intensity: null,
              emotion: null,
            });
          }

          for (const ch of result.character_cues) {
            anyDialogue = true;
            const range = findCharRange(result.ocr_text, ch.trigger_text);
            await createCue({
              pageId: pageRow.id,
              type: 'character',
              triggerText: ch.trigger_text,
              contextPhrase: null,
              charStart: range.start,
              charEnd: range.end,
              soundId: ch.voice_id,
              characterName: ch.character_name ?? null,
              intensity: ch.intensity ?? null,
              emotion: ch.emotion ?? null,
            });
          }
        } catch (err: any) {
          console.warn('Prep failed for new page:', err?.message ?? err);
        }
      }

      if (anyDialogue !== book.hasDialogue) {
        await setBookPrepStatus(book.id, book.prepStatus, anyDialogue);
      }
      await load();
    } finally {
      setAddingPages(false);
      setAddProgress('');
    }
  }

  function onMeasured(index: number, height: number) {
    const next = itemHeights.value.slice();
    next[index] = height;
    itemHeights.value = next;
  }

  async function handleReorder(from: number, to: number) {
    setPages((prev) => {
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      reorderPages(next.map((p) => p.id)).catch(() => {});
      return next;
    });
  }

  async function handleDeletePage(index: number) {
    const page = pages[index];
    if (!page) return;
    const remaining = pages.filter((_, i) => i !== index);
    setPages(remaining);
    await deletePage(page.id);
    if (page.imagePath) {
      try {
        const file = new ExpoFile(page.imagePath);
        if (file.exists) file.delete();
      } catch {
        // Non-fatal — the row is already gone; a stale file is harmless.
      }
    }
    // Renumber the remaining pages to close the gap.
    await reorderPages(remaining.map((p) => p.id));
    await load();
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
  const readiness = checkReadiness(pages, cuesByPage);
  const canRead = storyPages.length > 0;

  const AmbientChip = ({ active }: { active: boolean }) => (
    <View style={[styles.chip, styles.ambientChip, { backgroundColor: chipBackground }]}>
      <View style={[styles.ambientDot, { backgroundColor: active ? '#2fb344' : '#ff453a' }]} />
      <Text style={[styles.chipText, { color: subColor }]}>Ambient</Text>
    </View>
  );

  const SoundsChip = ({ count }: { count: number }) => (
    <View style={[styles.chip, styles.ambientChip, { backgroundColor: chipBackground }]}>
      <View style={[styles.ambientDot, { backgroundColor: count > 0 ? '#2fb344' : '#ff453a' }]} />
      <Text style={[styles.chipText, { color: subColor }]}>
        {count > 0 ? `🔊 ${count} sound${count === 1 ? '' : 's'}` : 'No sounds'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <Stack.Screen options={{ headerShown: true, title: book.title }} />

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: 150 }]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              setTitleDraft(book.title);
              setRenaming(true);
            }}
            hitSlop={8}
            style={styles.titleRow}
          >
            <Text style={[styles.bookTitle, { color: textColor }]} numberOfLines={2}>
              {book.title}
            </Text>
            <Text style={[styles.titleEdit, { color: subColor }]}>✏️</Text>
          </Pressable>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: status.color }]} />
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
          <Text style={[styles.summary, { color: subColor }]}>
            {pages.length} page{pages.length === 1 ? '' : 's'} · {storyPages.length} story · {totalCues} cue
            {totalCues === 1 ? '' : 's'}
            {book.hasDialogue ? ' · has dialogue' : ''}
          </Text>
          {pages.length > 1 && (
            <Text style={[styles.reorderHint, { color: subColor }]}>
              Long-press a page to reorder it, or drag it to the bin below to delete.
            </Text>
          )}
        </View>

        {pages.map((item, index) => {
          const cues = cuesByPage.get(item.id) ?? [];
          const activeCueCount = cues.filter((c) => c.reviewState !== 'removed').length;
          return (
            <DraggablePageCard
              key={item.id}
              index={index}
              draggingIndex={draggingIndex}
              targetIndex={targetIndex}
              itemHeights={itemHeights}
              binHover={binHover}
              binBounds={BIN_BOUNDS}
              onReorder={handleReorder}
              onDelete={handleDeletePage}
              onMeasured={onMeasured}
            >
              <Pressable
                onPress={() => router.push({ pathname: '/page/[id]', params: { id: item.id } })}
                style={({ pressed }) => [styles.pageCard, { backgroundColor: cardBackground, opacity: pressed ? 0.7 : 1 }]}
              >
                <View style={styles.pageTop}>
                  {item.imagePath ? (
                    <Image source={{ uri: item.imagePath }} style={styles.thumb} contentFit="cover" transition={120} />
                  ) : (
                    <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: chipBackground }]}>
                      <Text style={{ fontSize: 20 }}>📝</Text>
                    </View>
                  )}
                  <View style={styles.pageInfo}>
                    <Text style={[styles.pageNo, { color: textColor }]}>
                      Page {item.pageNumber}
                    </Text>
                    <Text style={[styles.pageMeta, { color: subColor }]}>{item.pageType.replace(/_/g, ' ')}</Text>
                    <View style={styles.chipRow}>
                      <SoundsChip count={activeCueCount} />
                      <AmbientChip active={!!item.ambientSoundId} />
                    </View>
                  </View>
                  <Text style={[styles.chevron, { color: subColor }]}>›</Text>
                </View>

                {item.ocrText ? (
                  <Text style={[styles.ocr, { color: textColor }]} numberOfLines={3} ellipsizeMode="tail">
                    {item.ocrText}
                  </Text>
                ) : (
                  <Text style={[styles.ocrEmpty, { color: subColor }]}>No text recognized on this page.</Text>
                )}
              </Pressable>
            </DraggablePageCard>
          );
        })}

        <View style={styles.squareButtonRow}>
          <View style={styles.squareButtonWrap}>
            <TactileButton style={[styles.squareButton, { backgroundColor: cardBackground }]} onPress={pickFromLibrary}>
              <Text style={styles.squareButtonEmoji}>🖼️</Text>
              <Text style={[styles.squareButtonLabel, { color: textColor }]}>Add Pictures</Text>
              <Text style={[styles.squareButtonCaption, { color: subColor }]}>from your library or files</Text>
            </TactileButton>
          </View>
          <View style={styles.squareButtonWrap}>
            <TactileButton style={[styles.squareButton, { backgroundColor: cardBackground }]} onPress={takePhoto}>
              <Text style={styles.squareButtonEmoji}>📷</Text>
              <Text style={[styles.squareButtonLabel, { color: textColor }]}>Take Photo</Text>
              <Text style={[styles.squareButtonCaption, { color: subColor }]}>using your camera</Text>
            </TactileButton>
          </View>
        </View>
      </ScrollView>

      <TrashBin draggingIndex={draggingIndex} binHover={binHover} />

      {/* Pre-flight gate + the primary "Read" action, pinned bottom (thumb). */}
      <View style={[styles.readBar, { backgroundColor, borderTopColor: chipBackground }]}>
        {warningsOpen && readiness.warnings.length > 0 && (
          <View style={[styles.warnPanel, { backgroundColor: cardBackground }]}>
            <ScrollView style={{ maxHeight: 180 }}>
              {readiness.warnings.map((w, i) => (
                <Pressable
                  key={`${w.pageId}-${w.kind}-${i}`}
                  style={styles.warnRow}
                  onPress={() => {
                    setWarningsOpen(false);
                    router.push({ pathname: '/page/[id]', params: { id: w.pageId } });
                  }}
                >
                  <Text style={[styles.warnText, { color: textColor }]}>{warningLabel(w)}</Text>
                  <Text style={[styles.chevron, { color: subColor }]}>›</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
        <View style={styles.readBarRow}>
          <Pressable
            style={styles.readStatus}
            disabled={readiness.warnings.length === 0}
            onPress={() => setWarningsOpen((v) => !v)}
          >
            {readiness.ready ? (
              <>
                <Text style={styles.readStatusIcon}>✅</Text>
                <Text style={[styles.readStatusText, { color: '#2fb344' }]} numberOfLines={2}>
                  Ready · {readiness.storyPageCount} page{readiness.storyPageCount === 1 ? '' : 's'} ·{' '}
                  {readiness.soundCount} sound{readiness.soundCount === 1 ? '' : 's'}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.readStatusIcon}>{warningsOpen ? '▾' : '⚠️'}</Text>
                <Text style={[styles.readStatusText, { color: '#e8a33d' }]} numberOfLines={2}>
                  {readiness.warnings.length} thing{readiness.warnings.length === 1 ? '' : 's'} to check
                </Text>
              </>
            )}
          </Pressable>
          <TactileButton
            style={[styles.readButton, { opacity: canRead ? 1 : 0.4 }]}
            onPress={() => {
              if (!canRead) return;
              setWarningsOpen(false);
              router.push({ pathname: '/read/[id]', params: { id: book.id } });
            }}
          >
            <Text style={styles.readButtonLabel}>▶  Read</Text>
          </TactileButton>
        </View>
      </View>

      <PhotoEditor
        visible={editingSource !== null}
        source={editingSource}
        queueLabel={batchTotal > 1 ? `Photo ${batchTotal - editQueue.length} of ${batchTotal}` : undefined}
        onCancel={handleEditorCancel}
        onDone={handleEditorDone}
      />

      <Modal visible={addingPages} transparent animationType="fade">
        <View style={styles.processingOverlay}>
          <View style={[styles.processingCard, { backgroundColor: cardBackground }]}>
            <ActivityIndicator size="large" color="#208AEF" />
            <Text style={{ color: textColor }}>{addProgress || 'Adding pages…'}</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={renaming} transparent animationType="fade" onRequestClose={() => setRenaming(false)}>
        <Pressable style={styles.processingOverlay} onPress={() => setRenaming(false)}>
          <Pressable style={[styles.renameCard, { backgroundColor: cardBackground }]}>
            <Text style={[styles.renameTitle, { color: textColor }]}>Rename book</Text>
            <TextInput
              value={titleDraft}
              onChangeText={setTitleDraft}
              autoFocus
              selectTextOnFocus
              placeholder="Book title"
              placeholderTextColor={subColor}
              style={[styles.renameInput, { color: textColor, backgroundColor: chipBackground }]}
              onSubmitEditing={saveTitle}
              returnKeyType="done"
            />
            <View style={styles.renameActions}>
              <TactileButton style={[styles.renameBtn, { backgroundColor: chipBackground }]} onPress={() => setRenaming(false)}>
                <Text style={[styles.renameBtnLabel, { color: subColor }]}>Cancel</Text>
              </TactileButton>
              <TactileButton style={[styles.renameBtn, { backgroundColor: '#208AEF' }]} onPress={saveTitle}>
                <Text style={[styles.renameBtnLabel, { color: '#fff' }]}>Save</Text>
              </TactileButton>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },

  list: { padding: 16, gap: PAGE_LIST_GAP },
  header: { marginBottom: 8, gap: 6 },

  readBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  warnPanel: { borderRadius: 12, marginBottom: 10, overflow: 'hidden' },
  warnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.2)',
  },
  warnText: { flex: 1, fontSize: 14, marginRight: 8 },
  readBarRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  readStatus: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  readStatusIcon: { fontSize: 18 },
  readStatusText: { flex: 1, fontSize: 14, fontWeight: '700' },
  readButton: {
    backgroundColor: '#2fb344',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 30,
    alignItems: 'center',
  },
  readButtonLabel: { color: '#fff', fontSize: 17, fontWeight: '800' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bookTitle: { flex: 1, fontSize: 24, fontWeight: '800' },
  titleEdit: { fontSize: 15, opacity: 0.7 },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 14, fontWeight: '700' },
  summary: { fontSize: 13 },
  reorderHint: { fontSize: 12, fontStyle: 'italic', marginTop: 2 },

  pageCard: { borderRadius: 14, padding: 12, gap: 10 },
  pageTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumb: { width: 54, height: 72, borderRadius: 8 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  pageInfo: { flex: 1, gap: 4 },
  pageNo: { fontSize: 16, fontWeight: '600' },
  pageMeta: { fontSize: 13, textTransform: 'capitalize' },
  chevron: { fontSize: 28, fontWeight: '300', marginLeft: 4 },

  ocr: { fontSize: 14, lineHeight: 20 },
  ocrEmpty: { fontSize: 13, fontStyle: 'italic' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 11, fontWeight: '600' },
  ambientChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ambientDot: { width: 7, height: 7, borderRadius: 3.5 },

  squareButtonRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  squareButtonWrap: { flex: 1 },
  squareButton: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 6,
  },
  squareButtonEmoji: { fontSize: 34 },
  squareButtonLabel: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  squareButtonCaption: { fontSize: 12, fontWeight: '400', textAlign: 'center', textTransform: 'lowercase' },

  processingOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  processingCard: { borderRadius: 16, padding: 28, alignItems: 'center', gap: 14, minWidth: 240 },

  trashBin: {
    position: 'absolute',
    bottom: BIN_BOTTOM_OFFSET,
    left: (SCREEN_W - BIN_SIZE) / 2,
    width: BIN_SIZE,
    height: BIN_SIZE,
    borderRadius: BIN_SIZE / 2,
    backgroundColor: 'rgba(255,69,58,0.15)',
    borderWidth: 2,
    borderColor: '#ff453a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashBinIcon: { fontSize: 30 },

  renameCard: { width: '86%', borderRadius: 16, padding: 20, gap: 14 },
  renameTitle: { fontSize: 17, fontWeight: '700' },
  renameInput: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, fontSize: 17 },
  renameActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  renameBtn: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 20, alignItems: 'center' },
  renameBtnLabel: { fontSize: 15, fontWeight: '600' },
});
