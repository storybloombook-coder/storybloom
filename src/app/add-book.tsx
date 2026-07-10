import { Directory, File as ExpoFile, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';
import DraggableThumb, { THUMB_SIZE } from '../components/DraggableThumb';
import PhotoEditor from '../components/PhotoEditor';
import TactileButton from '../components/TactileButton';
import { SOUND_ALLOWLISTS } from '../lib/ai/soundLibrary';
import { createVisionProvider } from '../lib/vision';
import { createBook, createCue, createPage, setBookPrepStatus, updatePagePrepResult } from '../lib/db';

const GRID_GAP = 12;
const GRID_PADDING = 16;
const GRID_CELL = THUMB_SIZE + GRID_GAP;
const GRID_COLUMNS = Math.max(
  1,
  Math.floor((Dimensions.get('window').width - GRID_PADDING * 2 + GRID_GAP) / GRID_CELL)
);

type Page = {
  uri: string;
  width: number;
  height: number;
};

function findCharRange(ocrText: string, triggerText: string): { start: number | null; end: number | null } {
  const idx = ocrText.toLowerCase().indexOf(triggerText.toLowerCase());
  if (idx < 0) return { start: null, end: null };
  return { start: idx, end: idx + triggerText.length };
}

interface DebugPageInfo {
  page: number;
  mode: string;
  ocrId: string;
  pageType: string;
  confidence?: number;
  ocrText: string;
  ambient: string | null;
  keywords: string[];
  charCueCount: number;
}

export default function AddBookScreen() {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const backgroundColor = isDark ? '#000' : '#fff';
  const buttonBackground = isDark ? '#1c1c1e' : '#f2f2f2';
  const sheetBackground = isDark ? '#1c1c1e' : '#fff';

  const [photoSourceVisible, setPhotoSourceVisible] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);
  // Photo currently open in the editor; editIndex is set when re-editing an
  // existing page (vs. a brand-new camera shot, editIndex null).
  const [editingSource, setEditingSource] = useState<Page | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);

  // Shared across every DraggableThumb so siblings can wiggle/shift live
  // while one of them is being dragged.
  const draggingIndex = useSharedValue(-1);
  const targetIndex = useSharedValue(-1);

  const [titleModalVisible, setTitleModalVisible] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  // Dev-only readout of what the vision pipeline produced per page (raw OCR
  // text, confidence, matched cues) so we can judge on-device OCR quality.
  const [debugPages, setDebugPages] = useState<DebugPageInfo[]>([]);

  function continueToLibrary() {
    setDebugPages([]);
    router.replace('/library');
  }

  function addPages(assets: ImagePicker.ImagePickerAsset[]) {
    setPages((prev) => [
      ...prev,
      ...assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height })),
    ]);
  }

  function removePage(index: number) {
    setPages((prev) => prev.filter((_, i) => i !== index));
  }

  function reorderPages(from: number, to: number) {
    setPages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function editPage(index: number) {
    setEditIndex(index);
    setEditingSource(pages[index]);
  }

  function handleEditorDone(result: Page) {
    if (editIndex === null) {
      setPages((prev) => [...prev, result]);
    } else {
      setPages((prev) => prev.map((p, i) => (i === editIndex ? result : p)));
    }
    setEditingSource(null);
    setEditIndex(null);
  }

  function handleEditorCancel() {
    setEditingSource(null);
    setEditIndex(null);
  }

  async function takePhoto() {
    setPhotoSourceVisible(false);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Camera access is required to photograph pages.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled) {
      // Opens our own crop/angle/rotate editor instead of the OS's built-in one.
      const asset = result.assets[0];
      setEditIndex(null);
      setEditingSource({ uri: asset.uri, width: asset.width, height: asset.height });
    }
  }

  async function pickFromLibrary() {
    setPhotoSourceVisible(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Photo library access is required to add pages.');
      return;
    }
    // Multi-select and per-photo crop/rotate are mutually exclusive on both
    // platforms, so existing photos come in as-is (no edit step here).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      addPages(result.assets);
    }
  }

  function pickFile() {
    // expo-document-picker's cache-copied files aren't reliably readable by
    // any expo-file-system API (new or legacy) in this Expo Go environment —
    // confirmed a real read failure, not a timing issue, across three
    // independent attempts. Converting to photos and using the library
    // picker (which does work) is the practical path until that's resolved.
    Alert.alert(
      'PDF import unavailable right now',
      'Reading PDF files isn’t working in this Expo Go setup. Convert the PDF’s pages to photos (e.g. a PDF-to-JPG app, or "print to image") and add them with "Choose from Library" instead — same prep pipeline either way.'
    );
  }

  function finishCapture() {
    setTitleInput('');
    setTitleModalVisible(true);
  }

  async function startProcessing() {
    const title = titleInput.trim() || 'Untitled Book';
    setTitleModalVisible(false);
    setProcessing(true);
    setProgressText('Creating book…');
    setDebugPages([]);

    try {
      // Build the vision pipeline BEFORE creating the book, so a missing API
      // key (or no available vision path) fails here without leaving an orphan
      // book stuck in 'processing'. Swappable: on-device OCR where available
      // (auto-upgrades once the Tesseract dev build lands), cloud in Expo Go.
      const vision = createVisionProvider();

      const book = await createBook({ title, source: 'photos' });
      const bookDir = new Directory(Paths.document, 'books', book.id);
      bookDir.create({ intermediates: true, idempotent: true });

      let anyDialogue = false;
      let failureCount = 0;

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        setProgressText(`Prepping page ${i + 1} of ${pages.length}…`);

        const destFile = new ExpoFile(bookDir, `page-${i + 1}.jpg`);
        await new ExpoFile(page.uri).copy(destFile);

        const pageRow = await createPage({
          bookId: book.id,
          pageNumber: i + 1,
          imagePath: destFile.uri,
        });

        try {
          const base64 = await destFile.base64();
          const result = await vision.preparePage({
            imageBase64: base64,
            imageMimeType: 'image/jpeg',
            embeddedText: null,
            allowlists: SOUND_ALLOWLISTS,
          });

          await updatePagePrepResult(pageRow.id, {
            pageType: result.page_type,
            ocrText: result.ocr_text,
            backgroundScene: result.background_scene,
            ambientSoundId: result.ambient_sound_id,
          });

          if (__DEV__) {
            setDebugPages((prev) => [
              ...prev,
              {
                page: i + 1,
                mode: vision.mode,
                ocrId: vision.ocrId,
                pageType: result.page_type,
                confidence: result.ocrConfidence,
                ocrText: result.ocr_text,
                ambient: result.ambient_sound_id,
                keywords: result.keyword_cues.map((k) => `${k.trigger_text}→${k.sound_id ?? 'none'}`),
                charCueCount: result.character_cues.length,
              },
            ]);
          }

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
          failureCount++;
          console.warn(`Prep failed for page ${i + 1}:`, err?.message ?? err);
        }
      }

      await setBookPrepStatus(book.id, failureCount === pages.length ? 'failed' : 'ready', anyDialogue);

      setProcessing(false);
      setPages([]);

      // In dev, hold on the debug readout instead of navigating away so we can
      // inspect the raw OCR/cues; "Continue to Library" dismisses it.
      if (__DEV__) return;

      if (failureCount > 0) {
        Alert.alert(
          'Book prepped with some errors',
          `${pages.length - failureCount} of ${pages.length} page(s) processed successfully. Check your Gemini API key and connection for the rest.`
        );
      } else {
        Alert.alert('Book ready!', `"${title}" was prepped successfully.`);
      }
      router.replace('/library');
    } catch (err: any) {
      setProcessing(false);
      Alert.alert('Something went wrong', err?.message ?? String(err));
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Add a Book' }} />

      {pages.length > 0 ? (
        <ScrollView contentContainerStyle={styles.thumbGrid}>
          {pages.map((page, index) => (
            <DraggableThumb
              key={page.uri}
              index={index}
              uri={page.uri}
              columns={GRID_COLUMNS}
              totalCount={pages.length}
              textColor={textColor}
              draggingIndex={draggingIndex}
              targetIndex={targetIndex}
              onReorder={reorderPages}
              onEdit={editPage}
              onRemove={removePage}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.emptyState}>
          <Text style={StyleSheet.flatten([styles.emptyStateText, { color: textColor }])}>
            No pages yet — add photos or a PDF below.
          </Text>
        </View>
      )}

      <View style={styles.footer}>
        <TactileButton
          style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}
          onPress={() => setPhotoSourceVisible(true)}
        >
          <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>
            Add Pictures / Photos
          </Text>
        </TactileButton>
        {pages.length === 0 ? (
          <TactileButton
            style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}
            onPress={pickFile}
          >
            <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>
              Add a File (PDF)
            </Text>
          </TactileButton>
        ) : (
          <TactileButton
            style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}
            onPress={takePhoto}
          >
            <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>
              Next Photo
            </Text>
          </TactileButton>
        )}
        {pages.length > 0 && (
          <TactileButton
            style={StyleSheet.flatten([styles.button, styles.doneButton])}
            onPress={finishCapture}
          >
            <Text style={StyleSheet.flatten([styles.buttonLabel, { color: '#fff' }])}>
              Done — {pages.length} page{pages.length === 1 ? '' : 's'}
            </Text>
          </TactileButton>
        )}
      </View>

      <Modal
        visible={photoSourceVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPhotoSourceVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPhotoSourceVisible(false)}>
          <Pressable style={StyleSheet.flatten([styles.sheet, { backgroundColor: sheetBackground }])}>
            <Text style={StyleSheet.flatten([styles.sheetTitle, { color: textColor }])}>
              Add Pictures / Photos
            </Text>
            <TactileButton
              style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}
              onPress={takePhoto}
            >
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>
                Take Photo
              </Text>
            </TactileButton>
            <TactileButton
              style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}
              onPress={pickFromLibrary}
            >
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>
                Choose from Library
              </Text>
            </TactileButton>
            <TactileButton style={styles.cancelButton} onPress={() => setPhotoSourceVisible(false)}>
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: '#ff453a' }])}>
                Cancel
              </Text>
            </TactileButton>
          </Pressable>
        </Pressable>
      </Modal>

      <PhotoEditor
        visible={editingSource !== null}
        source={editingSource}
        onCancel={handleEditorCancel}
        onDone={handleEditorDone}
      />

      <Modal
        visible={titleModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTitleModalVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setTitleModalVisible(false)}>
          <Pressable style={StyleSheet.flatten([styles.sheet, { backgroundColor: sheetBackground }])}>
            <Text style={StyleSheet.flatten([styles.sheetTitle, { color: textColor }])}>
              Name this book
            </Text>
            <TextInput
              value={titleInput}
              onChangeText={setTitleInput}
              placeholder="e.g. Bedtime Frog"
              placeholderTextColor={isDark ? '#888' : '#999'}
              style={StyleSheet.flatten([
                styles.titleInput,
                { color: textColor, backgroundColor: buttonBackground },
              ])}
              autoFocus
            />
            <TactileButton
              style={StyleSheet.flatten([styles.button, styles.doneButton])}
              onPress={startProcessing}
            >
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: '#fff' }])}>
                Start Processing ({pages.length} page{pages.length === 1 ? '' : 's'})
              </Text>
            </TactileButton>
            <TactileButton style={styles.cancelButton} onPress={() => setTitleModalVisible(false)}>
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: '#ff453a' }])}>
                Cancel
              </Text>
            </TactileButton>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={processing || (__DEV__ && debugPages.length > 0)}
        transparent
        animationType="fade"
      >
        <View style={styles.processingOverlay}>
          <View style={StyleSheet.flatten([styles.processingCard, { backgroundColor: sheetBackground }])}>
            {processing && <ActivityIndicator size="large" color="#208AEF" />}
            <Text style={StyleSheet.flatten([styles.processingText, { color: textColor }])}>
              {processing ? progressText : 'Prep debug — review OCR & cues'}
            </Text>

            {__DEV__ && debugPages.length > 0 && (
              <ScrollView style={styles.debugScroll}>
                {debugPages.map((d) => (
                  <View
                    key={d.page}
                    style={StyleSheet.flatten([
                      styles.debugCard,
                      { borderColor: isDark ? '#333' : '#e0e0e0' },
                    ])}
                  >
                    <Text style={StyleSheet.flatten([styles.debugTitle, { color: textColor }])}>
                      p{d.page} · {d.pageType} · {d.mode}/{d.ocrId}
                      {d.confidence != null ? ` · ${Math.round(d.confidence * 100)}%` : ''}
                    </Text>
                    <Text
                      style={StyleSheet.flatten([styles.debugMono, { color: textColor }])}
                      numberOfLines={5}
                    >
                      {d.ocrText || '(no text recognized)'}
                    </Text>
                    <Text style={StyleSheet.flatten([styles.debugMeta, { color: isDark ? '#7fb0d8' : '#3a6ea5' }])}>
                      amb: {d.ambient ?? '—'} · kw: {d.keywords.join(', ') || '—'} · dlg: {d.charCueCount}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}

            {!processing && (
              <TactileButton
                style={StyleSheet.flatten([styles.button, styles.doneButton])}
                onPress={continueToLibrary}
              >
                <Text style={StyleSheet.flatten([styles.buttonLabel, { color: '#fff' }])}>
                  Continue to Library
                </Text>
              </TactileButton>
            )}
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyStateText: {
    fontSize: 16,
    opacity: 0.6,
    textAlign: 'center',
  },
  thumbGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    padding: 16,
  },
  footer: {
    padding: 24,
    gap: 12,
  },
  button: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  doneButton: {
    backgroundColor: '#208AEF',
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
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
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    opacity: 0.6,
    marginBottom: 4,
  },
  cancelButton: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  titleInput: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 17,
  },
  processingOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  processingCard: {
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    gap: 16,
    minWidth: 220,
    maxWidth: '92%',
  },
  processingText: {
    fontSize: 15,
    textAlign: 'center',
  },
  debugScroll: {
    maxHeight: 360,
    width: '100%',
  },
  debugCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    gap: 4,
  },
  debugTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  debugMono: {
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    lineHeight: 16,
  },
  debugMeta: {
    fontSize: 11,
  },
});
