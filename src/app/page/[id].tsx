import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import Slider from '@react-native-community/slider';
import { Directory, File as ExpoFile, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image as RNImage,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PhotoEditor from '../../components/PhotoEditor';
import TactileButton from '../../components/TactileButton';
import { EFFECT_IDS, SOUND_ALLOWLISTS } from '../../lib/ai/soundLibrary';
import {
  createCue,
  getBook,
  getCuesForPage,
  getPage,
  setCueReviewState,
  updateCueCharRange,
  updateCueSoundId,
  updateCueSoundTrim,
  updatePageOcrText,
} from '../../lib/db';
import { createVoskRecognizer } from '../../lib/speech/vosk';
import type { SpeechLang } from '../../lib/speech/types';
import type { Cue, Page } from '../../lib/types';
import { createVisionProvider } from '../../lib/vision';

type WorkingImage = { uri: string; width: number; height: number };

/** Case-insensitive first-occurrence range of a trigger in the text. */
function findRange(text: string, trigger: string): { start: number | null; end: number | null } {
  const idx = text.toLowerCase().indexOf(trigger.toLowerCase());
  if (idx < 0) return { start: null, end: null };
  return { start: idx, end: idx + trigger.length };
}

/** Split into word/space tokens carrying their char offsets so we can map each
 *  word back to a cue's [charStart, charEnd). */
interface Token {
  text: string;
  start: number;
  end: number;
  isSpace: boolean;
}
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let idx = 0;
  for (const part of text.split(/(\s+)/)) {
    if (part.length === 0) continue;
    const start = idx;
    idx += part.length;
    tokens.push({ text: part, start, end: idx, isSpace: /^\s+$/.test(part) });
  }
  return tokens;
}

function cueAtRange(cues: Cue[], start: number, end: number): Cue | undefined {
  return cues.find(
    (c) => c.charStart != null && c.charEnd != null && start < c.charEnd && end > c.charStart
  );
}

type PickerTarget = { mode: 'add'; token: Token } | { mode: 'change'; cue: Cue };
/** What a word-tap is about: an existing cue, or a bare word with none yet. */
type CueTarget = { cue: Cue } | { token: Token };

/** Custom parent recordings are stored as `custom:<file uri>` in soundId — no
 *  schema change needed, and it's directly playable with no lookup table. */
const CUSTOM_PREFIX = 'custom:';
function isCustomSound(soundId: string | null): boolean {
  return !!soundId && soundId.startsWith(CUSTOM_PREFIX);
}
function soundLabel(soundId: string | null): string {
  if (!soundId) return 'no sound';
  return isCustomSound(soundId) ? '🎤 your recording' : soundId;
}

/** Plays [startSec, endSec) of `player`, ramping volume in/out over the given
 *  fade durations. expo-audio has no built-in "stop at time" / fade API, so
 *  this polls currentTime on an interval — fine for short sound-effect clips,
 *  and it's the ONE playback path used for both live preview and saved cues,
 *  so what you hear while recording is exactly what plays later. */
function playRange(
  player: ReturnType<typeof createAudioPlayer>,
  opts: { startSec: number; endSec: number; fadeInSec: number; fadeOutSec: number }
) {
  const { startSec, endSec, fadeInSec, fadeOutSec } = opts;
  player.volume = fadeInSec > 0 ? 0 : 1;
  player.seekTo(startSec).then(() => player.play());
  const timer = setInterval(() => {
    if (!player.playing) {
      clearInterval(timer);
      return;
    }
    const t = player.currentTime;
    if (t >= endSec) {
      clearInterval(timer);
      player.pause();
      return;
    }
    const elapsed = t - startSec;
    const remaining = endSec - t;
    let vol = 1;
    if (fadeInSec > 0 && elapsed < fadeInSec) vol = Math.max(0, elapsed / fadeInSec);
    if (fadeOutSec > 0 && remaining < fadeOutSec) vol = Math.min(vol, Math.max(0, remaining / fadeOutSec));
    player.volume = vol;
  }, 50);
}

export default function PageEditorScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const pageId = Array.isArray(params.id) ? params.id[0] : params.id;

  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const subColor = isDark ? '#9a9a9e' : '#6b6b70';
  const backgroundColor = isDark ? '#000' : '#fff';
  const cardBackground = isDark ? '#1c1c1e' : '#f4f4f6';
  const inputBackground = isDark ? '#141416' : '#fff';
  // cardBackground === the sheet's own background in dark mode, so an
  // unselected toggle button needs its own border to stay visible.
  const langBorderColor = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';

  const [page, setPage] = useState<Page | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Tapping a word first opens this small action sheet (play / library / record
  // / remove), consistent whether the word already has a cue or not.
  const [wordDetail, setWordDetail] = useState<CueTarget | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  // Instant visible feedback the moment a finger touches a word — separate
  // from `cue` highlighting, which only means "this word has a sound".
  const [pressedToken, setPressedToken] = useState<number | null>(null);
  const [recordTarget, setRecordTarget] = useState<CueTarget | null>(null);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [savingRecording, setSavingRecording] = useState(false);
  // Trim + fade editor for the just-captured recording, all in seconds.
  // Defaults: full clip, 1s fades (clamped to half the trimmed length).
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  // Replaces every native Alert.alert on this screen with the app's own style.
  const [infoModal, setInfoModal] = useState<{ emoji: string; title: string; message: string } | null>(null);
  // Region re-scan: reuse PhotoEditor to crop to the text area, then OCR only
  // that crop (fewer errors, no illustration text). regionSrc opens the editor.
  const [regionSrc, setRegionSrc] = useState<WorkingImage | null>(null);
  const [rescanning, setRescanning] = useState(false);

  // Dictation fallback for bad OCR: the parent reads the page aloud instead of
  // correcting text by hand. Vosk is on-device, so this works for EN + RU.
  const [dictateOpen, setDictateOpen] = useState(false);
  const [dictateLang, setDictateLang] = useState<SpeechLang>('en');
  const [dictateStatus, setDictateStatus] = useState<'idle' | 'loading' | 'listening'>('idle');
  const [dictateFinal, setDictateFinal] = useState('');
  const [dictatePartial, setDictatePartial] = useState('');

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const recognizerRef = useRef<ReturnType<typeof createVoskRecognizer> | null>(null);

  useEffect(() => {
    return () => {
      try {
        playerRef.current?.remove();
      } catch {}
      recognizerRef.current?.unload().catch(() => {});
    };
  }, []);

  const reload = useCallback(async () => {
    if (!pageId) return;
    const [p, cs] = await Promise.all([getPage(pageId), getCuesForPage(pageId)]);
    setPage(p);
    setCues(cs);
    setLoading(false);
  }, [pageId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Keep fades valid whenever the trim range shrinks (a fade can't outlast
  // half of what's left after trimming).
  useEffect(() => {
    const maxFade = Math.max(0, (trimEnd - trimStart) / 2);
    setFadeIn((v) => Math.min(v, maxFade));
    setFadeOut((v) => Math.min(v, maxFade));
  }, [trimStart, trimEnd]);

  function playSound(cue: Cue) {
    const soundId = cue.soundId;
    if (!soundId) return;
    try {
      playerRef.current?.remove();
    } catch {}
    if (!isCustomSound(soundId)) {
      setInfoModal({
        emoji: '🔈',
        title: 'No audio bundled yet',
        message: `"${soundId}" is a library placeholder — no sound file is bundled for it yet. Try recording your own instead!`,
      });
      return;
    }
    const uri = soundId.slice(CUSTOM_PREFIX.length);
    const player = createAudioPlayer(uri);
    playerRef.current = player;
    if (cue.soundEndMs != null) {
      playRange(player, {
        startSec: (cue.soundStartMs ?? 0) / 1000,
        endSec: cue.soundEndMs / 1000,
        fadeInSec: (cue.fadeInMs ?? 0) / 1000,
        fadeOutSec: (cue.fadeOutMs ?? 0) / 1000,
      });
    } else {
      player.play();
    }
  }

  async function saveText() {
    if (!page) return;
    const next = draft;
    await updatePageOcrText(page.id, next);
    // Re-locate every cue against the corrected text so highlights + reading
    // alignment stay accurate. Triggers that no longer appear become unplaced.
    for (const c of cues) {
      const range = findRange(next, c.triggerText);
      if (range.start !== c.charStart || range.end !== c.charEnd) {
        await updateCueCharRange(c.id, range.start, range.end);
      }
    }
    setEditing(false);
    await reload();
  }

  function openDictation() {
    // Guess the language from the existing (possibly bad) OCR text so the
    // right model loads by default; the parent can still switch it.
    setDictateLang(/[Ѐ-ӿ]/.test(page?.ocrText ?? '') ? 'ru' : 'en');
    setDictateFinal('');
    setDictatePartial('');
    setDictateStatus('idle');
    setDictateOpen(true);
  }

  async function startDictation() {
    setDictateStatus('loading');
    try {
      if (!recognizerRef.current) recognizerRef.current = createVoskRecognizer();
      await recognizerRef.current.load(dictateLang);
      await recognizerRef.current.start({
        lang: dictateLang,
        onPartial: setDictatePartial,
        onResult: (text) => {
          setDictateFinal((prev) => (prev ? `${prev} ${text}` : text));
          setDictatePartial('');
        },
      });
      setDictateStatus('listening');
    } catch (e: any) {
      setDictateStatus('idle');
      setInfoModal({
        emoji: '🎙️',
        title: 'Dictation unavailable',
        message: e?.message ?? String(e),
      });
    }
  }

  async function stopDictation() {
    try {
      await recognizerRef.current?.stop();
    } catch {}
    setDictateStatus('idle');
  }

  function closeDictation() {
    if (dictateStatus === 'listening') recognizerRef.current?.stop().catch(() => {});
    setDictateOpen(false);
  }

  function useDictatedText() {
    const text = [dictateFinal, dictatePartial].filter(Boolean).join(' ').trim();
    if (text) setDraft(text);
    setDictateOpen(false);
  }

  function openRegion() {
    if (!page) return;
    RNImage.getSize(
      page.imagePath,
      (width, height) => setRegionSrc({ uri: page.imagePath, width, height }),
      () =>
        setInfoModal({
          emoji: '⚠️',
          title: 'Could not open image',
          message: 'The page image could not be measured.',
        })
    );
  }

  // PhotoEditor returns the cropped image; OCR just that crop and replace the
  // page text. Cues are re-located against the new text.
  async function handleRescan(cropped: WorkingImage) {
    setRegionSrc(null);
    if (!page) return;
    setRescanning(true);
    try {
      const out = await manipulateAsync(cropped.uri, [], {
        base64: true,
        compress: 0.9,
        format: SaveFormat.JPEG,
      });
      const book = await getBook(page.bookId);
      const vision = createVisionProvider();
      const result = await vision.preparePage({
        imageBase64: out.base64!,
        imageMimeType: 'image/jpeg',
        embeddedText: null,
        allowlists: SOUND_ALLOWLISTS,
        lang: book?.language,
      });
      await updatePageOcrText(page.id, result.ocr_text);
      for (const c of cues) {
        const r = findRange(result.ocr_text, c.triggerText);
        if (r.start !== c.charStart || r.end !== c.charEnd) {
          await updateCueCharRange(c.id, r.start, r.end);
        }
      }
      await reload();
      setInfoModal(
        result.ocr_text
          ? { emoji: '✅', title: 'Re-scanned', message: 'Updated the page text from the marked area.' }
          : { emoji: 'ℹ️', title: 'No text found', message: 'No text was found in that area.' }
      );
    } catch (e: any) {
      setInfoModal({ emoji: '⚠️', title: 'Re-scan failed', message: e?.message ?? String(e) });
    } finally {
      setRescanning(false);
    }
  }

  function onWordPress(token: Token) {
    const cue = cueAtRange(cues, token.start, token.end);
    setWordDetail(cue ? { cue } : { token });
  }

  function onUnplacedPress(cue: Cue) {
    setWordDetail({ cue });
  }

  function openLibraryPicker() {
    if (!wordDetail) return;
    setPicker('cue' in wordDetail ? { mode: 'change', cue: wordDetail.cue } : { mode: 'add', token: wordDetail.token });
    setWordDetail(null);
  }

  function openRecorder() {
    if (!wordDetail) return;
    setRecordTarget(wordDetail);
    setRecordedUri(null);
    setWordDetail(null);
  }

  async function startRecording() {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setInfoModal({
        emoji: '🎤',
        title: 'Microphone access needed',
        message: 'Allow microphone access to record a sound.',
      });
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    setRecordedUri(null);
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function stopRecording() {
    await recorder.stop();
    const uri = recorder.uri;
    setRecordedUri(uri);
    if (!uri) return;

    // Probe the clip's duration so the trim sliders have real bounds, then
    // seed defaults: full clip, 1s fades (clamped to half the length).
    const probe = createAudioPlayer(uri);
    let attempts = 0;
    const pollForDuration = () => {
      attempts += 1;
      if (probe.duration > 0 || attempts > 40) {
        const dur = probe.duration > 0 ? probe.duration : 1;
        const f = Math.min(1, dur / 2);
        setRecordingDuration(dur);
        setTrimStart(0);
        setTrimEnd(dur);
        setFadeIn(f);
        setFadeOut(f);
        probe.remove();
      } else {
        setTimeout(pollForDuration, 50);
      }
    };
    pollForDuration();
  }

  function playRecordingPreview() {
    if (!recordedUri) return;
    try {
      playerRef.current?.remove();
    } catch {}
    const player = createAudioPlayer(recordedUri);
    playerRef.current = player;
    playRange(player, {
      startSec: trimStart,
      endSec: trimEnd,
      fadeInSec: fadeIn,
      fadeOutSec: fadeOut,
    });
  }

  function cancelRecording() {
    if (recorderState.isRecording) recorder.stop().catch(() => {});
    setRecordTarget(null);
    setRecordedUri(null);
  }

  async function saveRecording() {
    if (!recordedUri || !recordTarget || !page) return;
    setSavingRecording(true);
    try {
      const dir = new Directory(Paths.document, 'recordings');
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`;
      const dest = new ExpoFile(dir, filename);
      await new ExpoFile(recordedUri).copy(dest);
      const soundId = `${CUSTOM_PREFIX}${dest.uri}`;
      const startMs = Math.round(trimStart * 1000);
      const endMs = Math.round(trimEnd * 1000);
      const fadeInMs = Math.round(fadeIn * 1000);
      const fadeOutMs = Math.round(fadeOut * 1000);

      if ('cue' in recordTarget) {
        await updateCueSoundTrim(recordTarget.cue.id, { soundId, startMs, endMs, fadeInMs, fadeOutMs });
        if (recordTarget.cue.reviewState === 'removed') await setCueReviewState(recordTarget.cue.id, 'confirmed');
      } else {
        const word = recordTarget.token.text.toLowerCase();
        const created = await createCue({
          pageId: page.id,
          type: 'keyword',
          triggerText: word,
          contextPhrase: null,
          charStart: recordTarget.token.start,
          charEnd: recordTarget.token.end,
          soundId,
          characterName: null,
          intensity: null,
          emotion: null,
          soundStartMs: startMs,
          soundEndMs: endMs,
          fadeInMs,
          fadeOutMs,
        });
        await setCueReviewState(created.id, 'confirmed');
      }

      setRecordTarget(null);
      setRecordedUri(null);
      await reload();
    } catch (e: any) {
      setInfoModal({ emoji: '⚠️', title: 'Could not save recording', message: e?.message ?? String(e) });
    } finally {
      setSavingRecording(false);
    }
  }

  async function chooseSound(soundId: string) {
    if (!picker) return;
    if (picker.mode === 'change') {
      await updateCueSoundId(picker.cue.id, soundId);
      if (picker.cue.reviewState === 'removed') await setCueReviewState(picker.cue.id, 'confirmed');
    } else {
      const word = picker.token.text.toLowerCase();
      const created = await createCue({
        pageId: page!.id,
        type: 'keyword',
        triggerText: word,
        contextPhrase: null,
        charStart: picker.token.start,
        charEnd: picker.token.end,
        soundId,
        characterName: null,
        intensity: null,
        emotion: null,
      });
      // The parent added it deliberately — treat as confirmed, not proposed.
      await setCueReviewState(created.id, 'confirmed');
    }
    setPicker(null);
    await reload();
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor }]}>
        <Stack.Screen options={{ headerShown: true, title: 'Page' }} />
        <ActivityIndicator size="large" color="#208AEF" />
      </SafeAreaView>
    );
  }
  if (!page) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor }]}>
        <Stack.Screen options={{ headerShown: true, title: 'Page' }} />
        <Text style={{ color: textColor }}>This page no longer exists.</Text>
      </SafeAreaView>
    );
  }

  const tokens = tokenize(page.ocrText);
  const activeCueCount = cues.filter((c) => c.reviewState !== 'removed').length;
  const unplaced = cues.filter((c) => c.charStart == null && c.reviewState !== 'removed');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor }]}>
      <Stack.Screen options={{ headerShown: true, title: `Page ${page.pageNumber}` }} />

      <ScrollView contentContainerStyle={styles.content}>
        <Image source={{ uri: page.imagePath }} style={styles.image} contentFit="contain" transition={120} />

        {editing ? (
          <Text style={[styles.hint, { color: subColor }]}>Fix any OCR mistakes, then save.</Text>
        ) : (
          <>
            <Text style={[styles.hintPrimary, { color: textColor }]}>
              👆 Tap a word below to attach a sound effect
            </Text>
            <Text style={[styles.hint, { color: subColor }]}>
              {activeCueCount} cue{activeCueCount === 1 ? '' : 's'} so far
            </Text>
          </>
        )}
        {!editing && (
          <View style={styles.toolbar}>
            <View style={styles.toolBtnWrap}>
              <TactileButton style={[styles.smallBtn, { backgroundColor: cardBackground }]} onPress={openRegion}>
                <Text style={[styles.smallBtnLabel, { color: textColor }]}>🔲 Re-scan area</Text>
              </TactileButton>
            </View>
            <View style={styles.toolBtnWrap}>
              <TactileButton
                style={[styles.smallBtn, { backgroundColor: cardBackground }]}
                onPress={() => {
                  setDraft(page.ocrText);
                  setEditing(true);
                }}
              >
                <Text style={[styles.smallBtnLabel, { color: textColor }]}>✏️ Correct text</Text>
              </TactileButton>
            </View>
          </View>
        )}

        {editing ? (
          <View style={styles.editWrap}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              style={[styles.input, { color: textColor, backgroundColor: inputBackground, borderColor: cardBackground }]}
              placeholder="Type the page's story text…"
              placeholderTextColor={subColor}
            />
            <TactileButton
              style={[styles.smallBtn, styles.dictateBtn, { backgroundColor: cardBackground }]}
              onPress={openDictation}
            >
              <Text style={[styles.smallBtnLabel, { color: textColor }]}>
                🎙️ Dictate instead — read the page aloud
              </Text>
            </TactileButton>
            <View style={styles.editActions}>
              <TactileButton style={[styles.smallBtn, { backgroundColor: cardBackground }]} onPress={() => setEditing(false)}>
                <Text style={[styles.smallBtnLabel, { color: subColor }]}>Cancel</Text>
              </TactileButton>
              <TactileButton style={[styles.smallBtn, { backgroundColor: '#208AEF' }]} onPress={saveText}>
                <Text style={[styles.smallBtnLabel, { color: '#fff' }]}>Save text</Text>
              </TactileButton>
            </View>
          </View>
        ) : (
          <View style={[styles.textCard, { backgroundColor: cardBackground }]}>
            {page.ocrText ? (
              <Text style={[styles.flow, { color: textColor }]}>
                {tokens.map((t, i) => {
                  if (t.isSpace) return <Text key={i}>{t.text}</Text>;
                  const cue = cueAtRange(cues, t.start, t.end);
                  const removed = cue?.reviewState === 'removed';
                  const bg = !cue
                    ? undefined
                    : removed
                      ? 'transparent'
                      : cue.type === 'character'
                        ? 'rgba(175,82,222,0.38)'
                        : 'rgba(32,138,239,0.38)';
                  const pressedBg = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.2)';
                  return (
                    <Text
                      key={i}
                      onPressIn={() => {
                        setPressedToken(i);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      onPressOut={() => setPressedToken(null)}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        onWordPress(t);
                      }}
                      style={{
                        backgroundColor: pressedToken === i ? pressedBg : bg,
                        textDecorationLine: removed ? 'line-through' : 'none',
                        color: removed ? subColor : textColor,
                      }}
                    >
                      {t.text}
                    </Text>
                  );
                })}
              </Text>
            ) : (
              <Text style={[styles.empty, { color: subColor }]}>
                No text was recognized. Tap “Correct text” to type it in.
              </Text>
            )}
          </View>
        )}

        {!editing && unplaced.length > 0 && (
          <View style={styles.unplaced}>
            <Text style={[styles.unplacedTitle, { color: subColor }]}>
              Cues not found in the text (tap to change / remove):
            </Text>
            {unplaced.map((c) => (
              <Pressable key={c.id} onPress={() => onUnplacedPress(c)}>
                <Text style={[styles.unplacedCue, { color: textColor }]}>
                  🔊 “{c.triggerText}” → {soundLabel(c.soundId)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Word tap — play / add or change from library / record your own / remove */}
      <Modal visible={wordDetail !== null} transparent animationType="slide" onRequestClose={() => setWordDetail(null)}>
        <Pressable style={styles.backdrop} onPress={() => setWordDetail(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}>
            {wordDetail && 'cue' in wordDetail ? (
              <>
                <Text style={[styles.sheetTitle, { color: textColor }]}>
                  “{wordDetail.cue.triggerText}”
                  {wordDetail.cue.reviewState === 'removed' ? ' — removed' : ` → ${soundLabel(wordDetail.cue.soundId)}`}
                </Text>
                {wordDetail.cue.reviewState !== 'removed' && wordDetail.cue.soundId && (
                  <TactileButton
                    style={[styles.actionButton, { backgroundColor: '#208AEF' }]}
                    onPress={() => playSound(wordDetail.cue)}
                  >
                    <Text style={styles.actionButtonLabel}>▶️ Play sound</Text>
                  </TactileButton>
                )}
                <TactileButton style={[styles.actionButton, { backgroundColor: cardBackground }]} onPress={openLibraryPicker}>
                  <Text style={[styles.actionButtonLabel, { color: textColor }]}>
                    🎵 {wordDetail.cue.soundId ? 'Change' : 'Add'} from library
                  </Text>
                </TactileButton>
                <TactileButton style={[styles.actionButton, { backgroundColor: cardBackground }]} onPress={openRecorder}>
                  <Text style={[styles.actionButtonLabel, { color: textColor }]}>🎤 Record your own</Text>
                </TactileButton>
                {wordDetail.cue.reviewState === 'removed' ? (
                  <TactileButton
                    style={[styles.actionButton, { backgroundColor: cardBackground }]}
                    onPress={() => {
                      const cue = wordDetail.cue;
                      setCueReviewState(cue.id, 'confirmed')
                        .then(reload)
                        .then(() => setWordDetail(null));
                    }}
                  >
                    <Text style={[styles.actionButtonLabel, { color: textColor }]}>Restore</Text>
                  </TactileButton>
                ) : (
                  <TactileButton
                    style={[styles.actionButton, styles.destructiveButton]}
                    onPress={() => {
                      const cue = wordDetail.cue;
                      setCueReviewState(cue.id, 'removed')
                        .then(reload)
                        .then(() => setWordDetail(null));
                    }}
                  >
                    <Text style={styles.actionButtonLabel}>Remove</Text>
                  </TactileButton>
                )}
              </>
            ) : wordDetail ? (
              <>
                <Text style={[styles.sheetTitle, { color: textColor }]}>Add a sound for “{wordDetail.token.text}”</Text>
                <TactileButton style={[styles.actionButton, { backgroundColor: cardBackground }]} onPress={openLibraryPicker}>
                  <Text style={[styles.actionButtonLabel, { color: textColor }]}>🎵 Add from library</Text>
                </TactileButton>
                <TactileButton style={[styles.actionButton, { backgroundColor: cardBackground }]} onPress={openRecorder}>
                  <Text style={[styles.actionButtonLabel, { color: textColor }]}>🎤 Record your own</Text>
                </TactileButton>
              </>
            ) : null}
            <TactileButton style={styles.cancelRow} onPress={() => setWordDetail(null)}>
              <Text style={[styles.smallBtnLabel, { color: '#ff453a' }]}>Cancel</Text>
            </TactileButton>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Record your own sound for this word */}
      <Modal
        visible={recordTarget !== null}
        transparent
        animationType="slide"
        onRequestClose={cancelRecording}
      >
        <Pressable style={styles.backdrop} onPress={savingRecording ? undefined : cancelRecording}>
          <Pressable style={[styles.sheet, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}>
            <Text style={[styles.sheetTitle, { color: textColor }]}>
              Record a sound for “
              {recordTarget ? ('cue' in recordTarget ? recordTarget.cue.triggerText : recordTarget.token.text) : ''}”
            </Text>

            {recorderState.isRecording ? (
              <>
                <View style={styles.recordStatusRow}>
                  <View style={styles.recordDot} />
                  <Text style={[styles.recordTimer, { color: textColor }]}>
                    {Math.floor((recorderState.durationMillis ?? 0) / 1000)}s
                  </Text>
                </View>
                <TactileButton style={[styles.actionButton, styles.destructiveButton]} onPress={stopRecording}>
                  <Text style={styles.actionButtonLabel}>⏹ Stop</Text>
                </TactileButton>
              </>
            ) : recordedUri ? (
              <>
                <Text style={[styles.recordHint, { color: subColor }]}>
                  Recording captured — trim it, add fades, then save.
                </Text>

                <Text style={[styles.trimLabel, { color: subColor }]}>
                  Start {trimStart.toFixed(1)}s
                </Text>
                <Slider
                  style={styles.trimSlider}
                  minimumValue={0}
                  maximumValue={recordingDuration}
                  value={trimStart}
                  thumbTintColor="#208AEF"
                  onValueChange={(v) => setTrimStart(Math.min(v, trimEnd - 0.1))}
                />

                <Text style={[styles.trimLabel, { color: subColor }]}>
                  End {trimEnd.toFixed(1)}s of {recordingDuration.toFixed(1)}s
                </Text>
                <Slider
                  style={styles.trimSlider}
                  minimumValue={0}
                  maximumValue={recordingDuration}
                  value={trimEnd}
                  thumbTintColor="#208AEF"
                  onValueChange={(v) => setTrimEnd(Math.max(v, trimStart + 0.1))}
                />

                <Text style={[styles.trimLabel, { color: subColor }]}>Fade in {fadeIn.toFixed(1)}s</Text>
                <Slider
                  style={styles.trimSlider}
                  minimumValue={0}
                  maximumValue={Math.max(0.1, (trimEnd - trimStart) / 2)}
                  value={fadeIn}
                  thumbTintColor="#e8a33d"
                  onValueChange={setFadeIn}
                />

                <Text style={[styles.trimLabel, { color: subColor }]}>Fade out {fadeOut.toFixed(1)}s</Text>
                <Slider
                  style={styles.trimSlider}
                  minimumValue={0}
                  maximumValue={Math.max(0.1, (trimEnd - trimStart) / 2)}
                  value={fadeOut}
                  thumbTintColor="#e8a33d"
                  onValueChange={setFadeOut}
                />

                <TactileButton style={[styles.actionButton, { backgroundColor: '#208AEF' }]} onPress={playRecordingPreview}>
                  <Text style={styles.actionButtonLabel}>▶️ Preview trimmed sound</Text>
                </TactileButton>
                <TactileButton style={[styles.actionButton, { backgroundColor: cardBackground }]} onPress={startRecording}>
                  <Text style={[styles.actionButtonLabel, { color: textColor }]}>🔁 Re-record</Text>
                </TactileButton>
                <TactileButton
                  style={[styles.actionButton, { backgroundColor: '#2fb344' }]}
                  onPress={saveRecording}
                  disabled={savingRecording}
                >
                  <Text style={styles.actionButtonLabel}>{savingRecording ? 'Saving…' : '✅ Use this recording'}</Text>
                </TactileButton>
              </>
            ) : (
              <TactileButton style={[styles.actionButton, { backgroundColor: '#ff453a' }]} onPress={startRecording}>
                <Text style={styles.actionButtonLabel}>🎤 Start recording</Text>
              </TactileButton>
            )}

            <TactileButton style={styles.cancelRow} onPress={cancelRecording} disabled={savingRecording}>
              <Text style={[styles.smallBtnLabel, { color: '#ff453a' }]}>Cancel</Text>
            </TactileButton>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Dictation fallback — parent reads the page aloud instead of correcting OCR by hand */}
      <Modal visible={dictateOpen} transparent animationType="slide" onRequestClose={closeDictation}>
        <Pressable style={styles.backdrop} onPress={dictateStatus === 'listening' ? undefined : closeDictation}>
          <Pressable style={[styles.sheet, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}>
            <Text style={[styles.sheetTitle, { color: textColor }]}>🎙️ Read the page aloud</Text>

            <View style={styles.langToggleRow}>
              <View style={styles.toolBtnWrap}>
                <TactileButton
                  style={[
                    styles.langBtn,
                    dictateLang === 'en'
                      ? { backgroundColor: '#208AEF', borderColor: '#208AEF' }
                      : { backgroundColor: cardBackground, borderColor: langBorderColor },
                  ]}
                  onPress={() => setDictateLang('en')}
                  disabled={dictateStatus === 'listening'}
                >
                  <Text style={[styles.langBtnLabel, { color: dictateLang === 'en' ? '#fff' : textColor }]}>English</Text>
                </TactileButton>
              </View>
              <View style={styles.toolBtnWrap}>
                <TactileButton
                  style={[
                    styles.langBtn,
                    dictateLang === 'ru'
                      ? { backgroundColor: '#208AEF', borderColor: '#208AEF' }
                      : { backgroundColor: cardBackground, borderColor: langBorderColor },
                  ]}
                  onPress={() => setDictateLang('ru')}
                  disabled={dictateStatus === 'listening'}
                >
                  <Text style={[styles.langBtnLabel, { color: dictateLang === 'ru' ? '#fff' : textColor }]}>Русский</Text>
                </TactileButton>
              </View>
            </View>

            <ScrollView style={[styles.dictateTranscript, { backgroundColor: inputBackground }]}>
              {dictateFinal || dictatePartial ? (
                <Text style={{ color: textColor, fontSize: 15, lineHeight: 21 }}>
                  {dictateFinal}
                  {dictatePartial ? <Text style={{ color: subColor }}>{dictateFinal ? ' ' : ''}{dictatePartial}</Text> : null}
                </Text>
              ) : (
                <Text style={{ color: subColor, fontSize: 14, fontStyle: 'italic' }}>
                  Recognized text will appear here as you read…
                </Text>
              )}
            </ScrollView>

            {dictateStatus === 'listening' ? (
              <TactileButton style={[styles.actionButton, styles.destructiveButton]} onPress={stopDictation}>
                <Text style={styles.actionButtonLabel}>⏹ Stop</Text>
              </TactileButton>
            ) : (
              <TactileButton
                style={[styles.actionButton, { backgroundColor: '#ff453a' }]}
                onPress={startDictation}
                disabled={dictateStatus === 'loading'}
              >
                <Text style={styles.actionButtonLabel}>
                  {dictateStatus === 'loading' ? 'Loading model…' : '🎙️ Start reading'}
                </Text>
              </TactileButton>
            )}

            {(dictateFinal || dictatePartial) && dictateStatus !== 'listening' && (
              <TactileButton style={[styles.actionButton, { backgroundColor: '#2fb344' }]} onPress={useDictatedText}>
                <Text style={styles.actionButtonLabel}>✅ Use this text</Text>
              </TactileButton>
            )}

            <TactileButton style={styles.cancelRow} onPress={closeDictation} disabled={dictateStatus === 'loading'}>
              <Text style={[styles.smallBtnLabel, { color: '#ff453a' }]}>Cancel</Text>
            </TactileButton>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Generic small info sheet — replaces every native Alert on this screen */}
      <Modal visible={infoModal !== null} transparent animationType="fade" onRequestClose={() => setInfoModal(null)}>
        <View style={styles.rescanOverlay}>
          <View style={[styles.infoCard, { backgroundColor: cardBackground }]}>
            <Text style={styles.infoEmoji}>{infoModal?.emoji}</Text>
            <Text style={[styles.infoTitle, { color: textColor }]}>{infoModal?.title}</Text>
            <Text style={[styles.infoMessage, { color: subColor }]}>{infoModal?.message}</Text>
            <TactileButton style={[styles.actionButton, { backgroundColor: '#208AEF' }]} onPress={() => setInfoModal(null)}>
              <Text style={styles.actionButtonLabel}>OK</Text>
            </TactileButton>
          </View>
        </View>
      </Modal>

      {/* Sound picker */}
      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}>
            <Text style={[styles.sheetTitle, { color: subColor }]}>
              {picker?.mode === 'add' ? `Add a sound for “${picker.token.text}”` : 'Choose a sound'}
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {EFFECT_IDS.map((id) => (
                <Pressable key={id} style={styles.soundRow} onPress={() => chooseSound(id)}>
                  <Text style={[styles.soundId, { color: textColor }]}>🔊 {id}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <TactileButton style={styles.cancelRow} onPress={() => setPicker(null)}>
              <Text style={[styles.smallBtnLabel, { color: '#ff453a' }]}>Cancel</Text>
            </TactileButton>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Region selector — reuse PhotoEditor to crop to the text area, then re-OCR */}
      <PhotoEditor
        visible={regionSrc !== null}
        source={regionSrc}
        onCancel={() => setRegionSrc(null)}
        onDone={handleRescan}
      />

      <Modal visible={rescanning} transparent animationType="fade">
        <View style={styles.rescanOverlay}>
          <View style={[styles.rescanCard, { backgroundColor: cardBackground }]}>
            <ActivityIndicator size="large" color="#208AEF" />
            <Text style={{ color: textColor }}>Re-scanning the marked area…</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 14 },

  image: { width: '100%', height: 220, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.12)' },

  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hint: { fontSize: 13 },
  hintPrimary: { fontSize: 15, fontWeight: '700' },

  textCard: { borderRadius: 12, padding: 14 },
  flow: { fontSize: 17, lineHeight: 30 },
  empty: { fontSize: 14, fontStyle: 'italic' },

  editWrap: { gap: 10 },
  input: { minHeight: 160, borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 16, lineHeight: 24, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  dictateBtn: { alignSelf: 'flex-start' },

  langToggleRow: { flexDirection: 'row', gap: 8 },
  langBtn: { width: '100%', borderRadius: 10, paddingVertical: 10, borderWidth: 1.5, alignItems: 'center' },
  langBtnLabel: { fontSize: 14, fontWeight: '600' },
  dictateTranscript: { minHeight: 90, maxHeight: 160, borderRadius: 12, padding: 12 },

  smallBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  // TactileButton only sizes its inner view, not the outer Pressable — a
  // flex:1 passed as TactileButton's `style` never reaches the row child
  // that actually needs it. This wrapper is the real flex:1 participant.
  toolBtnWrap: { flex: 1 },
  smallBtnLabel: { fontSize: 14, fontWeight: '600' },

  rescanOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  rescanCard: { borderRadius: 16, padding: 28, alignItems: 'center', gap: 14, minWidth: 240 },

  unplaced: { gap: 6 },
  unplacedTitle: { fontSize: 12, fontWeight: '600' },
  unplacedCue: { fontSize: 14, paddingVertical: 4 },

  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, gap: 8 },
  sheetTitle: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 6 },
  soundRow: { paddingVertical: 12, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.2)' },
  soundId: { fontSize: 16 },
  cancelRow: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },

  actionButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  actionButtonLabel: { fontSize: 16, fontWeight: '600', color: '#fff' },
  destructiveButton: { backgroundColor: '#ff453a' },

  recordStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff453a' },
  recordTimer: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  recordHint: { fontSize: 13, textAlign: 'center', marginBottom: 2 },
  trimLabel: { fontSize: 12, fontWeight: '600', marginBottom: -6 },
  trimSlider: { width: '100%', height: 32 },

  infoCard: { borderRadius: 16, padding: 24, alignItems: 'center', gap: 10, minWidth: 260, maxWidth: 320 },
  infoEmoji: { fontSize: 32 },
  infoTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  infoMessage: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 6 },
});
