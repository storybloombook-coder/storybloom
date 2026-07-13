import { Directory, File as ExpoFile, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
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
import type { BookLanguage } from '../lib/types';

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
  const subColor = isDark ? '#9a9a9e' : '#6b6b70';
  const backgroundColor = isDark ? '#000' : '#fff';
  const buttonBackground = isDark ? '#1c1c1e' : '#f2f2f2';
  const sheetBackground = isDark ? '#1c1c1e' : '#fff';
  // buttonBackground === sheetBackground in dark mode, so an unselected
  // toggle button needs its own border to stay visible against the sheet.
  const langBorderColor = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';

  const [pages, setPages] = useState<Page[]>([]);
  // Which initial square the parent tapped — lets "Next Photo" continue the
  // SAME modality (library vs camera) instead of always defaulting to camera.
  const [captureMode, setCaptureMode] = useState<'library' | 'camera' | null>(null);
  // Photo currently open in the editor; editIndex is set when re-editing an
  // existing page (vs. a brand-new photo, editIndex null).
  const [editingSource, setEditingSource] = useState<Page | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  // Remaining un-edited photos from a multi-select library pick — each one
  // opens in the editor in turn as the previous is confirmed/cancelled.
  const [editQueue, setEditQueue] = useState<Page[]>([]);
  // Size of the current library batch, for the "Photo X of Y" editor label.
  const [batchTotal, setBatchTotal] = useState(0);

  // Shared across every DraggableThumb so siblings can wiggle/shift live
  // while one of them is being dragged.
  const draggingIndex = useSharedValue(-1);
  const targetIndex = useSharedValue(-1);

  const [titleModalVisible, setTitleModalVisible] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [bookLanguage, setBookLanguage] = useState<BookLanguage>('en');
  const [processing, setProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [resultModal, setResultModal] = useState<{ title: string; message: string; success: boolean } | null>(
    null
  );
  // Dev-only readout of what the vision pipeline produced per page (raw OCR
  // text, confidence, matched cues) so we can judge on-device OCR quality.
  const [debugPages, setDebugPages] = useState<DebugPageInfo[]>([]);

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
    setBatchTotal(0);
    setEditIndex(index);
    setEditingSource(pages[index]);
  }

  /** Opens the next queued photo in the editor, or closes the editor once the
   *  queue (from a multi-select library pick) is empty. */
  function openNextInQueue(queue: Page[]) {
    if (queue.length === 0) {
      setBatchTotal(0);
      setEditingSource(null);
      setEditIndex(null);
      return;
    }
    const [next, ...rest] = queue;
    setEditQueue(rest);
    setEditIndex(null);
    setEditingSource(next);
  }

  function handleEditorDone(result: Page) {
    if (editIndex === null) {
      setPages((prev) => [...prev, result]);
    } else {
      setPages((prev) => prev.map((p, i) => (i === editIndex ? result : p)));
    }
    openNextInQueue(editQueue);
  }

  function handleEditorCancel() {
    // Cancelling a queued library photo just skips it (not added); a
    // brand-new camera shot or an existing-page re-edit simply closes.
    openNextInQueue(editQueue);
  }

  async function takePhoto() {
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
      setBatchTotal(0);
      setEditIndex(null);
      setEditingSource({ uri: asset.uri, width: asset.width, height: asset.height });
    }
  }

  async function pickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Photo library access is required to add pages.');
      return;
    }
    // The OS's own crop UI can't combine with multi-select, but that only
    // rules out ITS editor — ours is a separate screen, so each picked photo
    // still gets a turn in it, one after another via editQueue.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets.length > 0) {
      const queue: Page[] = result.assets.map((a) => ({
        uri: a.uri,
        width: a.width,
        height: a.height,
      }));
      setBatchTotal(queue.length);
      openNextInQueue(queue);
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

      const book = await createBook({ title, source: 'photos', language: bookLanguage });
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
            lang: bookLanguage,
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
      if (__DEV__ && debugPages.length > 0) {
        // Still captured for troubleshooting, just not blocking navigation —
        // log it instead of holding the screen on a manual "Continue" tap.
        console.log('[prep debug]', JSON.stringify(debugPages, null, 2));
      }
      setDebugPages([]);

      if (failureCount > 0) {
        setResultModal({
          title: 'Book prepped with some errors',
          message: `${pages.length - failureCount} of ${pages.length} page(s) processed successfully. Check your Gemini API key and connection for the rest.`,
          success: false,
        });
        // Stays up until the parent taps through — this one's worth reading.
      } else {
        setResultModal({ title: 'Book ready! 🌱', message: `"${title}" was prepped successfully.`, success: true });
        setTimeout(() => {
          setResultModal(null);
          router.replace('/library');
        }, 1600);
      }
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
            No pages yet — add photos below to get started.
          </Text>
        </View>
      )}

      <View style={styles.footer}>
        {pages.length === 0 && (
          <>
          <View style={styles.squareButtonRow}>
            <View style={styles.squareButtonWrap}>
              <TactileButton
                style={StyleSheet.flatten([styles.squareButton, { backgroundColor: buttonBackground }])}
                onPress={() => {
                  setCaptureMode('library');
                  pickFromLibrary();
                }}
              >
                <Text style={styles.squareButtonEmoji}>🖼️</Text>
                <Text style={StyleSheet.flatten([styles.squareButtonLabel, { color: textColor }])}>
                  Add Pictures
                </Text>
                <Text style={StyleSheet.flatten([styles.squareButtonCaption, { color: subColor }])}>
                  from your library or files
                </Text>
              </TactileButton>
            </View>
            <View style={styles.squareButtonWrap}>
              <TactileButton
                style={StyleSheet.flatten([styles.squareButton, { backgroundColor: buttonBackground }])}
                onPress={() => {
                  setCaptureMode('camera');
                  takePhoto();
                }}
              >
                <Text style={styles.squareButtonEmoji}>📷</Text>
                <Text style={StyleSheet.flatten([styles.squareButtonLabel, { color: textColor }])}>
                  Make Photos
                </Text>
                <Text style={StyleSheet.flatten([styles.squareButtonCaption, { color: subColor }])}>
                  using your camera
                </Text>
              </TactileButton>
            </View>
          </View>
          <TactileButton
            style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}
            onPress={pickFile}
          >
            <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>
              Add a File (PDF)
            </Text>
          </TactileButton>
          </>
        )}
        {pages.length > 0 && (
          <>
            <View style={styles.squareButtonRow}>
              <View style={styles.squareButtonWrap}>
                <TactileButton
                  style={StyleSheet.flatten([styles.squareButton, { backgroundColor: buttonBackground }])}
                  onPress={finishCapture}
                >
                  <Text style={styles.squareButtonEmoji}>✅</Text>
                  <Text style={StyleSheet.flatten([styles.squareButtonLabel, { color: textColor }])}>
                    Done
                  </Text>
                  <Text style={StyleSheet.flatten([styles.squareButtonCaption, { color: subColor }])}>
                    {pages.length} page{pages.length === 1 ? '' : 's'}
                  </Text>
                </TactileButton>
              </View>
              <View style={styles.squareButtonWrap}>
                <TactileButton
                  style={StyleSheet.flatten([styles.squareButton, { backgroundColor: buttonBackground }])}
                  onPress={captureMode === 'library' ? pickFromLibrary : takePhoto}
                >
                  <Text style={styles.squareButtonEmoji}>{captureMode === 'library' ? '🖼️' : '📷'}</Text>
                  <Text style={StyleSheet.flatten([styles.squareButtonLabel, { color: textColor }])}>
                    {captureMode === 'library' ? 'Next Picture' : 'Next Photo'}
                  </Text>
                  <Text style={StyleSheet.flatten([styles.squareButtonCaption, { color: subColor }])}>
                    {captureMode === 'library' ? 'from your library or files' : 'using your camera'}
                  </Text>
                </TactileButton>
              </View>
            </View>
            <TactileButton
              style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}
              onPress={() => router.back()}
            >
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>
                Cancel
              </Text>
            </TactileButton>
          </>
        )}
      </View>

      <PhotoEditor
        visible={editingSource !== null}
        source={editingSource}
        queueLabel={batchTotal > 1 ? `Photo ${batchTotal - editQueue.length} of ${batchTotal}` : undefined}
        onCancel={handleEditorCancel}
        onDone={handleEditorDone}
      />

      <Modal
        visible={titleModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTitleModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.keyboardAvoider}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
              <Text style={StyleSheet.flatten([styles.langLabel, { color: textColor }])}>
                What language is this book?
              </Text>
              <View style={styles.langToggleRow}>
                <View style={styles.langBtnWrap}>
                  <TactileButton
                    style={StyleSheet.flatten([
                      styles.langBtn,
                      bookLanguage === 'en'
                        ? { backgroundColor: 'rgba(32,138,239,0.15)', borderColor: '#208AEF' }
                        : { backgroundColor: buttonBackground, borderColor: langBorderColor },
                    ])}
                    onPress={() => setBookLanguage('en')}
                  >
                    <Text style={StyleSheet.flatten([styles.langBtnLabel, { color: bookLanguage === 'en' ? '#208AEF' : textColor }])}>
                      English
                    </Text>
                  </TactileButton>
                </View>
                <View style={styles.langBtnWrap}>
                  <TactileButton
                    style={StyleSheet.flatten([
                      styles.langBtn,
                      bookLanguage === 'ru'
                        ? { backgroundColor: 'rgba(32,138,239,0.15)', borderColor: '#208AEF' }
                        : { backgroundColor: buttonBackground, borderColor: langBorderColor },
                    ])}
                    onPress={() => setBookLanguage('ru')}
                  >
                    <Text style={StyleSheet.flatten([styles.langBtnLabel, { color: bookLanguage === 'ru' ? '#208AEF' : textColor }])}>
                      Русский
                    </Text>
                  </TactileButton>
                </View>
              </View>
              <TactileButton
                style={StyleSheet.flatten([styles.button, styles.doneButton])}
                onPress={startProcessing}
              >
                <Text style={StyleSheet.flatten([styles.buttonLabel, { color: '#208AEF' }])}>
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
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={processing} transparent animationType="fade">
        <View style={styles.processingOverlay}>
          <View style={StyleSheet.flatten([styles.processingCard, { backgroundColor: sheetBackground }])}>
            <ActivityIndicator size="large" color="#208AEF" />
            <Text style={StyleSheet.flatten([styles.processingText, { color: textColor }])}>
              {progressText}
            </Text>
          </View>
        </View>
      </Modal>

      <Modal visible={resultModal !== null} transparent animationType="fade">
        <View style={styles.processingOverlay}>
          <View style={StyleSheet.flatten([styles.processingCard, { backgroundColor: sheetBackground }])}>
            <Text style={styles.resultEmoji}>{resultModal?.success ? '✅' : '⚠️'}</Text>
            <Text style={StyleSheet.flatten([styles.resultTitle, { color: textColor }])}>
              {resultModal?.title}
            </Text>
            <Text style={StyleSheet.flatten([styles.processingText, { color: textColor }])}>
              {resultModal?.message}
            </Text>
            {resultModal && !resultModal.success && (
              <TactileButton
                style={StyleSheet.flatten([styles.button, styles.doneButton])}
                onPress={() => {
                  setResultModal(null);
                  router.replace('/library');
                }}
              >
                <Text style={StyleSheet.flatten([styles.buttonLabel, { color: '#208AEF' }])}>OK</Text>
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
    backgroundColor: 'rgba(32,138,239,0.15)',
    borderWidth: 2,
    borderColor: '#208AEF',
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
  squareButtonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  squareButtonWrap: {
    flex: 1,
  },
  squareButton: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 6,
  },
  squareButtonEmoji: {
    fontSize: 34,
  },
  squareButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  squareButtonCaption: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
    textTransform: 'lowercase',
  },
  keyboardAvoider: {
    flex: 1,
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
  langLabel: {
    fontSize: 14,
    fontWeight: '600',
    alignSelf: 'flex-start',
  },
  langToggleRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  // TactileButton only sizes its inner view, not the Pressable — so `flex: 1`
  // on langBtn (applied via TactileButton's style prop) never reaches the
  // actual row child. This wrapper is the real flex:1 participant.
  langBtnWrap: { flex: 1 },
  langBtn: {
    width: '100%',
    borderRadius: 10,
    paddingVertical: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  langBtnLabel: {
    fontSize: 15,
    fontWeight: '600',
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
  resultEmoji: {
    fontSize: 40,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
});
