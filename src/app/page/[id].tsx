import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Directory, File as ExpoFile, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image as RNImage,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  useColorScheme,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import PhotoEditor from '../../components/PhotoEditor';
import TactileButton from '../../components/TactileButton';
import {
  AMBIENT_IDS,
  EFFECT_CATEGORIES,
  EFFECT_IDS,
  SCENE_VOCAB,
  SOUND_ALLOWLISTS,
  TRIGGER_VOCAB,
  type TriggerEntry,
} from '../../lib/ai/soundLibrary';
import { playFull, playRange } from '../../lib/audio/playRange';
import { resolveSoundSource } from '../../lib/audio/soundResolver';
import { cueAtRange, tokenize, type Token } from '../../lib/reader/text';
import {
  createCue,
  getBook,
  getCuesForPage,
  getPage,
  setCueReviewState,
  updateCueCharRange,
  updateCueSoundId,
  updateCueSoundTrim,
  updatePageAmbient,
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


type PickerTarget = { mode: 'add'; token: Token } | { mode: 'change'; cue: Cue } | { mode: 'ambient' };

/** The word/phrase a picker was opened for — drives its "Suggested" section. */
function pickerQueryWord(p: PickerTarget | null): string {
  if (!p) return '';
  if (p.mode === 'add') return p.token.text;
  if (p.mode === 'change') return p.cue.triggerText;
  return '';
}

/** Sound ids whose trigger vocabulary relates to `word` — a looser, bidirectional
 *  substring check (not the auto-matcher's strict whole-word rule), since this
 *  only ranks manual suggestions and a false positive here is just a skippable
 *  row, not a wrongly-fired sound. */
function relatedSoundIds(word: string, vocab: TriggerEntry[], allow: string[]): Set<string> {
  const w = word.trim().toLowerCase();
  const ids = new Set<string>();
  if (!w) return ids;
  for (const entry of vocab) {
    if (!allow.includes(entry.soundId)) continue;
    if (entry.triggers.some((t) => w.includes(t) || t.includes(w))) ids.add(entry.soundId);
  }
  return ids;
}

/** Sound ids matching free-text search, by id or by trigger vocabulary. */
function searchSoundIds(query: string, ids: string[], vocab: TriggerEntry[]): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return ids;
  return ids.filter((id) => {
    if (id.toLowerCase().includes(q)) return true;
    const entry = vocab.find((e) => e.soundId === id);
    return entry?.triggers.some((t) => t.includes(q)) ?? false;
  });
}
/** What a word-tap is about: an existing cue, or a bare word with none yet. */
type CueTarget = { cue: Cue } | { token: Token };
/** What the record-your-own sheet is recording for: a word cue, or the
 *  page's single ambient bed. */
type RecordTarget = CueTarget | 'ambient';

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

/** Fixed number of bars the waveform always renders, regardless of how long
 *  the recording is — keeps the trim UI a stable width to lay gestures out
 *  against instead of scrolling. */
const WAVEFORM_BARS = 56;

/** Downsamples raw per-poll amplitude samples into exactly `bars` values by
 *  averaging each bucket. */
function bucketWaveform(raw: number[], bars: number): number[] {
  if (raw.length === 0) return new Array(bars).fill(0.08);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = Math.floor((i / bars) * raw.length);
    const end = Math.max(start + 1, Math.floor(((i + 1) / bars) * raw.length));
    const slice = raw.slice(start, end);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    out.push(Math.max(0.08, avg));
  }
  return out;
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
  // Whether the word-detail sheet's own cue sound is currently playing —
  // drives the Play/Stop icon swap on that button.
  const [wordSoundPlaying, setWordSoundPlaying] = useState(false);
  const activeWordSoundStopRef = useRef<(() => void) | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  // Which library sound is previewing in the picker (its row shows Stop), plus
  // a dedicated player so previewing never disturbs the ambient/word players.
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const previewStopRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    setPickerSearch('');
    setExpandedCategories(new Set());
    // Closing (or switching) the picker stops any in-progress preview.
    stopPreview();
  }, [picker]);
  function toggleCategory(label: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }
  // Small action sheet for the page's single ambient bed — play / library /
  // record / remove, mirroring wordDetail's structure for word cues.
  const [ambientDetailOpen, setAmbientDetailOpen] = useState(false);
  // Instant visible feedback the moment a finger touches a word — separate
  // from `cue` highlighting, which only means "this word has a sound".
  const [pressedToken, setPressedToken] = useState<number | null>(null);
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [savingRecording, setSavingRecording] = useState(false);
  // Trim + fade editor for the just-captured recording, all in seconds.
  // Defaults: full clip, 1s fades on (clamped to half the trimmed length).
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [fadeInOn, setFadeInOn] = useState(true);
  const [fadeOutOn, setFadeOutOn] = useState(true);
  // 0..1 progress through [trimStart, trimEnd] while previewing; null when
  // nothing is playing — drives the moving playhead bar over the waveform.
  const [previewPlayhead, setPreviewPlayhead] = useState<number | null>(null);
  // Amplitude samples captured live from the recorder's metering (dB) while
  // recording, then bucketed into a fixed number of bars for display —
  // avoids needing to decode the finished file to draw a waveform.
  const [rawWaveform, setRawWaveform] = useState<number[]>([]);
  const [displayWaveform, setDisplayWaveform] = useState<number[]>([]);
  const [waveformWidth, setWaveformWidth] = useState(0);
  const startHandleX = useSharedValue(0);
  const endHandleX = useSharedValue(0);
  const startHandleDragStart = useSharedValue(0);
  const endHandleDragStart = useSharedValue(0);
  // Replaces every native Alert.alert on this screen with the app's own style.
  const [infoModal, setInfoModal] = useState<{ emoji: string; title: string; message: string } | null>(null);
  // Region re-scan: reuse PhotoEditor to crop to the text area, then OCR only
  // that crop (fewer errors, no illustration text). regionSrc opens the editor.
  const [regionSrc, setRegionSrc] = useState<WorkingImage | null>(null);
  const [rescanning, setRescanning] = useState(false);

  // Full-image zoom viewer, opened by tapping the page thumbnail. Its own
  // "Edit" button hands off to the existing re-scan/crop flow (openRegion).
  const [viewerOpen, setViewerOpen] = useState(false);
  const zoomScale = useSharedValue(1);
  const zoomSavedScale = useSharedValue(1);
  const zoomTranslateX = useSharedValue(0);
  const zoomTranslateY = useSharedValue(0);
  const zoomSavedTranslateX = useSharedValue(0);
  const zoomSavedTranslateY = useSharedValue(0);

  // Dictation fallback for bad OCR: the parent reads the page aloud instead of
  // correcting text by hand. Vosk is on-device, so this works for EN + RU.
  const [dictateOpen, setDictateOpen] = useState(false);
  const [dictateLang, setDictateLang] = useState<SpeechLang>('en');
  const [dictateStatus, setDictateStatus] = useState<'idle' | 'loading' | 'listening'>('idle');
  const [dictateFinal, setDictateFinal] = useState('');
  const [dictatePartial, setDictatePartial] = useState('');

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);
  const scrollRef = useRef<ScrollView>(null);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  // Whether the ambient bed is currently previewing — drives the Play/Stop
  // toggle in the ambient sheet. Ambient loops with no natural end, so without
  // this there'd be no way to stop it.
  const [ambientPlaying, setAmbientPlaying] = useState(false);
  const ambientPreviewStopRef = useRef<(() => void) | null>(null);
  const recognizerRef = useRef<ReturnType<typeof createVoskRecognizer> | null>(null);

  useEffect(() => {
    return () => {
      try {
        playerRef.current?.remove();
      } catch {}
      try {
        previewPlayerRef.current?.remove();
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

  // fadeIn/fadeOut are derived: 1s when the matching checkbox is on, clamped
  // to half the trimmed length so a fade can't outlast what's left to play.
  useEffect(() => {
    const maxFade = Math.max(0, (trimEnd - trimStart) / 2);
    setFadeIn(fadeInOn ? Math.min(1, maxFade) : 0);
    setFadeOut(fadeOutOn ? Math.min(1, maxFade) : 0);
  }, [trimStart, trimEnd, fadeInOn, fadeOutOn]);

  // Capture one amplitude sample (from the recorder's metering, in dB) per
  // poll while actively recording — this becomes the waveform, with no need
  // to decode the finished file.
  useEffect(() => {
    if (!recorderState.isRecording) return;
    const dB = recorderState.metering;
    if (typeof dB !== 'number') return;
    const normalized = Math.max(0, Math.min(1, (dB + 50) / 50));
    setRawWaveform((prev) => [...prev, normalized]);
  }, [recorderState.durationMillis, recorderState.isRecording]);

  // Once the waveform is measured on screen, snap both trim handles to the
  // full clip. Runs again if a re-record produces a different duration.
  useEffect(() => {
    if (waveformWidth > 0 && recordingDuration > 0) {
      startHandleX.value = 0;
      endHandleX.value = waveformWidth;
    }
  }, [waveformWidth, recordingDuration]);

  // Whichever word's sheet was showing "Stop" shouldn't still say that once
  // it closes or a different word is tapped.
  useEffect(() => {
    activeWordSoundStopRef.current?.();
    activeWordSoundStopRef.current = null;
    setWordSoundPlaying(false);
  }, [wordDetail]);

  function stopWordSound() {
    activeWordSoundStopRef.current?.();
    activeWordSoundStopRef.current = null;
    setWordSoundPlaying(false);
  }

  function playSound(cue: Cue) {
    const soundId = cue.soundId;
    if (!soundId) return;
    activeWordSoundStopRef.current?.();
    activeWordSoundStopRef.current = null;
    try {
      playerRef.current?.remove();
    } catch {}
    const source = resolveSoundSource(soundId);
    if (!source) {
      setInfoModal({
        emoji: '🔈',
        title: 'No sound for this',
        message: `"${soundId}" has no audio yet. Pick another sound, or record your own.`,
      });
      return;
    }
    const player = createAudioPlayer(source);
    playerRef.current = player;
    setWordSoundPlaying(true);
    const onEnd = () => {
      activeWordSoundStopRef.current = null;
      setWordSoundPlaying(false);
    };
    if (cue.soundEndMs != null) {
      activeWordSoundStopRef.current = playRange(player, {
        startSec: (cue.soundStartMs ?? 0) / 1000,
        endSec: cue.soundEndMs / 1000,
        fadeInSec: (cue.fadeInMs ?? 0) / 1000,
        fadeOutSec: (cue.fadeOutMs ?? 0) / 1000,
        onEnd,
      });
    } else {
      // A library sound (or legacy custom sound with no stored end) — play it
      // in full with a short fade in/out, through the same tracked path.
      activeWordSoundStopRef.current = playFull(player, { onEnd });
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
    // The "Correct text" input is still focused (keyboard up) when this is
    // tapped — dismiss it so the sheet's buttons aren't hidden behind it.
    Keyboard.dismiss();
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

  function openEditFromViewer() {
    setViewerOpen(false);
    openRegion();
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

  function openAmbientLibraryPicker() {
    stopAmbientPreview();
    setAmbientDetailOpen(false);
    setPicker({ mode: 'ambient' });
  }

  function openAmbientRecorder() {
    stopAmbientPreview();
    setAmbientDetailOpen(false);
    setRecordTarget('ambient');
    setRecordedUri(null);
  }

  async function removeAmbient() {
    if (!page) return;
    stopAmbientPreview();
    await updatePageAmbient(page.id, null);
    setAmbientDetailOpen(false);
    await reload();
  }

  function stopAmbientPreview() {
    ambientPreviewStopRef.current?.();
    ambientPreviewStopRef.current = null;
    try {
      playerRef.current?.pause();
    } catch {}
    setAmbientPlaying(false);
  }

  function stopPreview() {
    previewStopRef.current?.();
    previewStopRef.current = null;
    const p = previewPlayerRef.current;
    previewPlayerRef.current = null;
    if (p) {
      try {
        p.remove();
      } catch {}
    }
    setPreviewingId(null);
  }

  /** Play (or stop) a library sound from the picker, so a parent can hear a
   *  sound before choosing it. Only one previews at a time. */
  function togglePreview(id: string) {
    if (previewingId === id) {
      stopPreview();
      return;
    }
    stopPreview();
    const source = resolveSoundSource(id);
    if (!source) {
      setInfoModal({
        emoji: '🔈',
        title: 'No sound yet',
        message: `"${id}" has no audio bundled yet.`,
      });
      return;
    }
    const player = createAudioPlayer(source);
    previewPlayerRef.current = player;
    setPreviewingId(id);
    const onEnd = () => {
      previewStopRef.current = null;
      setPreviewingId((cur) => (cur === id ? null : cur));
    };
    // Play the whole clip with a short fade in/out (same path as a fired cue).
    previewStopRef.current = playFull(player, { onEnd });
  }

  function playAmbient() {
    if (!page?.ambientSoundId) return;
    // Tapping the button again while it's playing stops it (looping ambient has
    // no natural end, so this is the only way to stop the preview).
    if (ambientPlaying) {
      stopAmbientPreview();
      return;
    }
    try {
      playerRef.current?.remove();
    } catch {}
    const source = resolveSoundSource(page.ambientSoundId);
    if (!source) {
      setInfoModal({
        emoji: '🔈',
        title: 'No sound for this',
        message: `"${page.ambientSoundId}" has no audio yet. Pick another ambient, or record your own.`,
      });
      return;
    }
    const player = createAudioPlayer(source);
    playerRef.current = player;
    setAmbientPlaying(true);
    if (page.ambientEndMs != null) {
      // Custom recording with a trim window — play that range once.
      ambientPreviewStopRef.current = playRange(player, {
        startSec: (page.ambientStartMs ?? 0) / 1000,
        endSec: page.ambientEndMs / 1000,
        fadeInSec: (page.ambientFadeInMs ?? 0) / 1000,
        fadeOutSec: (page.ambientFadeOutMs ?? 0) / 1000,
        onEnd: () => {
          ambientPreviewStopRef.current = null;
          setAmbientPlaying(false);
        },
      });
    } else {
      // Ambient beds loop until stopped (via the button, or closing the sheet).
      player.loop = true;
      player.play();
      ambientPreviewStopRef.current = () => {
        try {
          player.pause();
        } catch {}
      };
    }
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
    setRawWaveform([]);
    setDisplayWaveform([]);
    setWaveformWidth(0);
    setPreviewPlayhead(null);
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function stopRecording() {
    await recorder.stop();
    const uri = recorder.uri;
    setRecordedUri(uri);
    setDisplayWaveform(bucketWaveform(rawWaveform, WAVEFORM_BARS));
    if (!uri) return;

    // Probe the clip's duration so the trim handles have real bounds, then
    // seed defaults: full clip, fades on (clamped to half the length).
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
        setFadeIn(fadeInOn ? f : 0);
        setFadeOut(fadeOutOn ? f : 0);
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
    const rangeSec = Math.max(0.001, trimEnd - trimStart);
    setPreviewPlayhead(0);
    playRange(player, {
      startSec: trimStart,
      endSec: trimEnd,
      fadeInSec: fadeIn,
      fadeOutSec: fadeOut,
      onTick: (t) => setPreviewPlayhead(Math.max(0, Math.min(1, (t - trimStart) / rangeSec))),
      onEnd: () => setPreviewPlayhead(null),
    });
  }

  function cancelRecording() {
    if (recorderState.isRecording) recorder.stop().catch(() => {});
    setRecordTarget(null);
    setRecordedUri(null);
    setPreviewPlayhead(null);
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

      if (recordTarget === 'ambient') {
        await updatePageAmbient(page.id, { soundId, startMs, endMs, fadeInMs, fadeOutMs });
      } else if ('cue' in recordTarget) {
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
    if (!picker || !page) return;
    stopPreview();
    if (picker.mode === 'ambient') {
      await updatePageAmbient(page.id, { soundId, startMs: null, endMs: null, fadeInMs: null, fadeOutMs: null });
    } else if (picker.mode === 'change') {
      await updateCueSoundId(picker.cue.id, soundId);
      if (picker.cue.reviewState === 'removed') await setCueReviewState(picker.cue.id, 'confirmed');
    } else {
      const word = picker.token.text.toLowerCase();
      const created = await createCue({
        pageId: page.id,
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

  function onWaveformLayout(e: LayoutChangeEvent) {
    setWaveformWidth(e.nativeEvent.layout.width);
  }

  const clampPx = (v: number, min: number, max: number) => {
    'worklet';
    return Math.max(min, Math.min(max, v));
  };

  const MIN_HANDLE_GAP_PX = 24;

  const startHandleGesture = Gesture.Pan()
    .onStart(() => {
      startHandleDragStart.value = startHandleX.value;
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
    })
    .onUpdate((e) => {
      const next = clampPx(startHandleDragStart.value + e.translationX, 0, endHandleX.value - MIN_HANDLE_GAP_PX);
      startHandleX.value = next;
      if (waveformWidth > 0 && recordingDuration > 0) {
        runOnJS(setTrimStart)((next / waveformWidth) * recordingDuration);
      }
    });

  const endHandleGesture = Gesture.Pan()
    .onStart(() => {
      endHandleDragStart.value = endHandleX.value;
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
    })
    .onUpdate((e) => {
      const next = clampPx(endHandleDragStart.value + e.translationX, startHandleX.value + MIN_HANDLE_GAP_PX, waveformWidth);
      endHandleX.value = next;
      if (waveformWidth > 0 && recordingDuration > 0) {
        runOnJS(setTrimEnd)((next / waveformWidth) * recordingDuration);
      }
    });

  const startHandleStyle = useAnimatedStyle(() => ({ left: startHandleX.value - 20 }));
  const endHandleStyle = useAnimatedStyle(() => ({ left: endHandleX.value - 20 }));
  const dimLeftStyle = useAnimatedStyle(() => ({ width: startHandleX.value }));
  const dimRightStyle = useAnimatedStyle(() => ({
    left: endHandleX.value,
    width: Math.max(0, waveformWidth - endHandleX.value),
  }));

  // Reset pan/zoom every time the viewer opens, so it never reopens on a
  // stale zoom level from the last time it was used.
  useEffect(() => {
    if (viewerOpen) {
      zoomScale.value = 1;
      zoomSavedScale.value = 1;
      zoomTranslateX.value = 0;
      zoomTranslateY.value = 0;
      zoomSavedTranslateX.value = 0;
      zoomSavedTranslateY.value = 0;
    }
  }, [viewerOpen]);

  const zoomPinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      zoomScale.value = clampPx(zoomSavedScale.value * e.scale, 1, 5);
    })
    .onEnd(() => {
      zoomSavedScale.value = zoomScale.value;
    });

  const zoomPanGesture = Gesture.Pan()
    .onUpdate((e) => {
      zoomTranslateX.value = zoomSavedTranslateX.value + e.translationX;
      zoomTranslateY.value = zoomSavedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      zoomSavedTranslateX.value = zoomTranslateX.value;
      zoomSavedTranslateY.value = zoomTranslateY.value;
    });

  const zoomGesture = Gesture.Simultaneous(zoomPinchGesture, zoomPanGesture);

  const zoomImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: zoomTranslateX.value },
      { translateY: zoomTranslateY.value },
      { scale: zoomScale.value },
    ],
  }));

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

  const pickerAllIds = picker?.mode === 'ambient' ? AMBIENT_IDS : EFFECT_IDS;
  const pickerVocab = picker?.mode === 'ambient' ? SCENE_VOCAB : TRIGGER_VOCAB;
  const pickerSearched = searchSoundIds(pickerSearch, pickerAllIds, pickerVocab);
  const pickerSuggestedIds = relatedSoundIds(pickerQueryWord(picker), pickerVocab, pickerAllIds);
  const pickerSuggested = pickerSearched.filter((id) => pickerSuggestedIds.has(id));
  const pickerRest = pickerSearched.filter((id) => !pickerSuggestedIds.has(id));
  const pickerSearching = pickerSearch.trim().length > 0;
  // Ambient has no category tree (only 18 ids) — group the rest only for effects.
  const pickerRestCategories =
    picker && picker.mode !== 'ambient'
      ? EFFECT_CATEGORIES.map((cat) => ({
          label: cat.label,
          ids: cat.ids.filter((id) => pickerRest.includes(id)),
        })).filter((cat) => cat.ids.length > 0)
      : null;

  // One picker row: a preview Play/Stop button (hear it before choosing) plus
  // the tappable label that actually assigns the sound.
  const renderSoundRow = (id: string) => {
    const kindIcon = picker?.mode === 'ambient' ? '🎵' : '🔊';
    const previewing = previewingId === id;
    return (
      <View key={id} style={styles.soundRow}>
        <Pressable hitSlop={8} style={styles.soundPreviewBtn} onPress={() => togglePreview(id)}>
          <Text style={styles.soundPreviewIcon}>{previewing ? '⏹' : '▶️'}</Text>
        </Pressable>
        <Pressable style={styles.soundRowLabel} onPress={() => chooseSound(id)}>
          <Text style={[styles.soundId, { color: textColor }]}>
            {kindIcon} {id}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor }]}>
      <Stack.Screen options={{ headerShown: true, title: `Page ${page.pageNumber}` }} />

      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, editing && styles.contentEditing]}
        keyboardShouldPersistTaps="handled"
      >
        {page.imagePath ? (
          <Pressable onPress={() => setViewerOpen(true)}>
            <Image source={{ uri: page.imagePath }} style={styles.image} contentFit="contain" transition={120} />
          </Pressable>
        ) : null}

        {editing && (
          <>
            <Text style={[styles.hint, { color: subColor }]}>Fix any OCR mistakes, then save.</Text>
            <TactileButton style={styles.dictateFrame} onPress={openDictation}>
              <Text style={styles.dictateFrameLabel}>🎙️ Dictate instead — read the page aloud</Text>
            </TactileButton>
            <View style={styles.editActions}>
              <TactileButton style={[styles.smallBtn, { backgroundColor: cardBackground }]} onPress={() => setEditing(false)}>
                <Text style={[styles.smallBtnLabel, { color: subColor }]}>Cancel</Text>
              </TactileButton>
              <TactileButton style={[styles.smallBtn, styles.softBlue]} onPress={saveText}>
                <Text style={[styles.smallBtnLabel, { color: '#208AEF' }]}>Save text</Text>
              </TactileButton>
            </View>
          </>
        )}

        {!editing && (
          <>
            <View style={styles.toolbar}>
              {page.imagePath ? (
                <View style={styles.toolBtnWrap}>
                  <TactileButton style={[styles.smallBtn, { backgroundColor: cardBackground }]} onPress={openRegion}>
                    <Text style={[styles.smallBtnLabel, { color: textColor }]}>🔲 Re-scan area</Text>
                  </TactileButton>
                </View>
              ) : null}
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

            <TactileButton
              style={[styles.ambientRow, { backgroundColor: cardBackground }]}
              onPress={() => setAmbientDetailOpen(true)}
            >
              <Text style={[styles.ambientRowLabel, { color: textColor }]}>
                {page.ambientSoundId ? `🎵 Ambient: ${soundLabel(page.ambientSoundId)}` : '🎵 Add ambient'}
              </Text>
            </TactileButton>

            <View style={styles.hintCard}>
              <Text style={[styles.hintPrimary, { color: textColor }]}>
                Tap a word below to attach a sound effect
              </Text>
              <Text style={[styles.hint, { color: subColor }]}>
                {activeCueCount} cue{activeCueCount === 1 ? '' : 's'} so far
              </Text>
            </View>
          </>
        )}

        {editing ? (
          <View style={styles.editWrap}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              style={[styles.input, { color: textColor, backgroundColor: inputBackground, borderColor: cardBackground }]}
              placeholder="Type the page's story text…"
              placeholderTextColor={subColor}
              onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250)}
            />
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
      </KeyboardAvoidingView>

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
                {wordDetail.cue.reviewState === 'removed' ? (
                  <View style={styles.wordGridRow}>
                    <View style={styles.wordGridCell}>
                      <TactileButton
                        style={[styles.wordGridButton, styles.wordGridOutline, { backgroundColor: cardBackground }]}
                        onPress={openLibraryPicker}
                      >
                        <Text style={styles.wordGridIcon}>🎵</Text>
                        <Text style={[styles.wordGridLabel, { color: textColor }]}>Change from library</Text>
                      </TactileButton>
                    </View>
                    <View style={styles.wordGridCell}>
                      <TactileButton
                        style={[styles.wordGridButton, styles.wordGridOutline, { backgroundColor: cardBackground }]}
                        onPress={openRecorder}
                      >
                        <Text style={styles.wordGridIcon}>🎤</Text>
                        <Text style={[styles.wordGridLabel, { color: textColor }]}>Record your own</Text>
                      </TactileButton>
                    </View>
                    <View style={styles.wordGridCell}>
                      <TactileButton
                        style={[
                          styles.wordGridButton,
                          { backgroundColor: 'rgba(47,179,68,0.15)', borderWidth: 2, borderColor: '#2fb344' },
                        ]}
                        onPress={() => {
                          const cue = wordDetail.cue;
                          setCueReviewState(cue.id, 'confirmed')
                            .then(reload)
                            .then(() => setWordDetail(null));
                        }}
                      >
                        <Text style={styles.wordGridIcon}>↩️</Text>
                        <Text style={[styles.wordGridLabel, { color: '#2fb344' }]}>Restore</Text>
                      </TactileButton>
                    </View>
                  </View>
                ) : (
                  <>
                    {/* 2x2 grid: library (TL) / play (TR) / record (BL) / remove (BR) */}
                    <View style={styles.wordGridRow}>
                      <View style={styles.wordGridCell}>
                        <TactileButton
                          style={[styles.wordGridButton, styles.wordGridOutline, { backgroundColor: cardBackground }]}
                          onPress={openLibraryPicker}
                        >
                          <Text style={styles.wordGridIcon}>🎵</Text>
                          <Text style={[styles.wordGridLabel, { color: textColor }]}>Change from library</Text>
                        </TactileButton>
                      </View>
                      <View style={styles.wordGridCell}>
                        <TactileButton
                          style={[styles.wordGridButton, styles.softBlue]}
                          onPress={() => (wordSoundPlaying ? stopWordSound() : playSound(wordDetail.cue))}
                          disabled={!wordDetail.cue.soundId}
                        >
                          <Text style={styles.wordGridIcon}>{wordSoundPlaying ? '⏹' : '▶️'}</Text>
                          <Text style={[styles.wordGridLabel, { color: '#208AEF' }]}>
                            {wordSoundPlaying ? 'Stop' : 'Play sound'}
                          </Text>
                        </TactileButton>
                      </View>
                    </View>
                    <View style={styles.wordGridRow}>
                      <View style={styles.wordGridCell}>
                        <TactileButton
                          style={[styles.wordGridButton, styles.wordGridOutline, { backgroundColor: cardBackground }]}
                          onPress={openRecorder}
                        >
                          <Text style={styles.wordGridIcon}>🎤</Text>
                          <Text style={[styles.wordGridLabel, { color: textColor }]}>Record your own</Text>
                        </TactileButton>
                      </View>
                      <View style={styles.wordGridCell}>
                        <TactileButton
                          style={[styles.wordGridButton, styles.destructiveButton]}
                          onPress={() => {
                            const cue = wordDetail.cue;
                            setCueReviewState(cue.id, 'removed')
                              .then(reload)
                              .then(() => setWordDetail(null));
                          }}
                        >
                          <Text style={styles.wordGridIcon}>🗑️</Text>
                          <Text style={[styles.wordGridLabel, { color: '#ff453a' }]}>Remove</Text>
                        </TactileButton>
                      </View>
                    </View>
                  </>
                )}
              </>
            ) : wordDetail ? (
              <>
                <Text style={[styles.sheetTitle, { color: textColor }]}>Add a sound for “{wordDetail.token.text}”</Text>
                <View style={styles.wordGridRow}>
                  <View style={styles.wordGridCell}>
                    <TactileButton
                      style={[styles.wordGridButton, styles.wordGridOutline, { backgroundColor: cardBackground }]}
                      onPress={openLibraryPicker}
                    >
                      <Text style={styles.wordGridIcon}>🎵</Text>
                      <Text style={[styles.wordGridLabel, { color: textColor }]}>Add from library</Text>
                    </TactileButton>
                  </View>
                  <View style={styles.wordGridCell}>
                    <TactileButton
                      style={[styles.wordGridButton, styles.wordGridOutline, { backgroundColor: cardBackground }]}
                      onPress={openRecorder}
                    >
                      <Text style={styles.wordGridIcon}>🎤</Text>
                      <Text style={[styles.wordGridLabel, { color: textColor }]}>Record your own</Text>
                    </TactileButton>
                  </View>
                </View>
              </>
            ) : null}
            <TactileButton style={styles.cancelRow} onPress={() => setWordDetail(null)}>
              <Text style={[styles.smallBtnLabel, { color: '#ff453a' }]}>Cancel</Text>
            </TactileButton>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Ambient tap — play / library / record your own / remove, for the page's single ambient bed */}
      <Modal
        visible={ambientDetailOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          stopAmbientPreview();
          setAmbientDetailOpen(false);
        }}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            stopAmbientPreview();
            setAmbientDetailOpen(false);
          }}
        >
          <Pressable style={[styles.sheet, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}>
            <Text style={[styles.sheetTitle, { color: textColor }]}>
              🎵 Ambient — {soundLabel(page.ambientSoundId)}
            </Text>
            {page.ambientSoundId ? (
              <>
                {/* 2x2 grid: library (TL) / play (TR) / record (BL) / remove (BR) */}
                <View style={styles.wordGridRow}>
                  <View style={styles.wordGridCell}>
                    <TactileButton
                      style={[styles.wordGridButton, styles.wordGridOutline, { backgroundColor: cardBackground }]}
                      onPress={openAmbientLibraryPicker}
                    >
                      <Text style={styles.wordGridIcon}>🎵</Text>
                      <Text style={[styles.wordGridLabel, { color: textColor }]}>Change from library</Text>
                    </TactileButton>
                  </View>
                  <View style={styles.wordGridCell}>
                    <TactileButton style={[styles.wordGridButton, styles.softBlue]} onPress={playAmbient}>
                      <Text style={styles.wordGridIcon}>{ambientPlaying ? '⏹' : '▶️'}</Text>
                      <Text style={[styles.wordGridLabel, { color: '#208AEF' }]}>
                        {ambientPlaying ? 'Stop' : 'Play ambient'}
                      </Text>
                    </TactileButton>
                  </View>
                </View>
                <View style={styles.wordGridRow}>
                  <View style={styles.wordGridCell}>
                    <TactileButton
                      style={[styles.wordGridButton, styles.wordGridOutline, { backgroundColor: cardBackground }]}
                      onPress={openAmbientRecorder}
                    >
                      <Text style={styles.wordGridIcon}>🎤</Text>
                      <Text style={[styles.wordGridLabel, { color: textColor }]}>Record your own</Text>
                    </TactileButton>
                  </View>
                  <View style={styles.wordGridCell}>
                    <TactileButton style={[styles.wordGridButton, styles.destructiveButton]} onPress={removeAmbient}>
                      <Text style={styles.wordGridIcon}>🗑️</Text>
                      <Text style={[styles.wordGridLabel, { color: '#ff453a' }]}>Remove</Text>
                    </TactileButton>
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.wordGridRow}>
                <View style={styles.wordGridCell}>
                  <TactileButton
                    style={[styles.wordGridButton, styles.wordGridOutline, { backgroundColor: cardBackground }]}
                    onPress={openAmbientLibraryPicker}
                  >
                    <Text style={styles.wordGridIcon}>🎵</Text>
                    <Text style={[styles.wordGridLabel, { color: textColor }]}>Add from library</Text>
                  </TactileButton>
                </View>
                <View style={styles.wordGridCell}>
                  <TactileButton
                    style={[styles.wordGridButton, styles.wordGridOutline, { backgroundColor: cardBackground }]}
                    onPress={openAmbientRecorder}
                  >
                    <Text style={styles.wordGridIcon}>🎤</Text>
                    <Text style={[styles.wordGridLabel, { color: textColor }]}>Record your own</Text>
                  </TactileButton>
                </View>
              </View>
            )}
            <TactileButton
              style={styles.cancelRow}
              onPress={() => {
                stopAmbientPreview();
                setAmbientDetailOpen(false);
              }}
            >
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
        <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={savingRecording ? undefined : cancelRecording}>
          <Pressable style={[styles.sheet, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}>
            <Text style={[styles.sheetTitle, { color: textColor }]}>
              {recordTarget === 'ambient'
                ? 'Record an ambient sound for this page'
                : `Record a sound for “${recordTarget && 'cue' in recordTarget ? recordTarget.cue.triggerText : recordTarget?.token.text ?? ''}”`}
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
                  <Text style={[styles.actionButtonLabel, { color: '#ff453a' }]}>⏹ Stop</Text>
                </TactileButton>
              </>
            ) : recordedUri ? (
              <>
                <Text style={[styles.recordHint, { color: subColor }]}>
                  Drag the edges to trim · {trimStart.toFixed(1)}s–{trimEnd.toFixed(1)}s of {recordingDuration.toFixed(1)}s
                </Text>

                {/* Play/re-record sit outside the waveform's own bounds — gives
                    the trim handles clear space on both sides so an edge-tap
                    doesn't get misread as the start of a drag. */}
                <View style={styles.waveformRow}>
                  <View style={styles.waveformSideCol}>
                    <TactileButton style={styles.waveformSideButton} onPress={playRecordingPreview}>
                      {/* The ▶ glyph's visual mass sits left of its own box in most fonts — nudge right to look centered. */}
                      <Text style={[styles.waveformSideButtonIcon, { color: '#fff', marginLeft: 2 }]}>▶</Text>
                    </TactileButton>
                    <Text style={[styles.waveformSideCaption, { color: subColor }]}>play</Text>
                  </View>

                  <View style={[styles.waveform, { flex: 1 }]} onLayout={onWaveformLayout}>
                    {displayWaveform.map((v, i) => (
                      <View
                        key={i}
                        style={[
                          styles.waveformBar,
                          { height: `${Math.round(v * 100)}%`, backgroundColor: isDark ? '#3a3a3c' : '#d0d0d5' },
                        ]}
                      />
                    ))}
                    <Animated.View style={[styles.waveformDim, dimLeftStyle, { left: 0 }]} />
                    <Animated.View style={[styles.waveformDim, dimRightStyle]} />
                    {previewPlayhead !== null && waveformWidth > 0 && recordingDuration > 0 && (
                      <View
                        pointerEvents="none"
                        style={[
                          styles.playheadBar,
                          {
                            left:
                              ((trimStart + previewPlayhead * (trimEnd - trimStart)) / recordingDuration) *
                              waveformWidth,
                          },
                        ]}
                      />
                    )}
                    {waveformWidth > 0 && (
                      <>
                        <GestureDetector gesture={startHandleGesture}>
                          <Animated.View style={[styles.waveformHandle, startHandleStyle]}>
                            <View style={styles.waveformHandleGrip} />
                          </Animated.View>
                        </GestureDetector>
                        <GestureDetector gesture={endHandleGesture}>
                          <Animated.View style={[styles.waveformHandle, endHandleStyle]}>
                            <View style={styles.waveformHandleGrip} />
                          </Animated.View>
                        </GestureDetector>
                      </>
                    )}
                  </View>

                  <View style={styles.waveformSideCol}>
                    <TactileButton
                      style={[styles.waveformSideButton, { borderColor: '#ff453a' }]}
                      onPress={startRecording}
                    >
                      <Text style={[styles.waveformSideButtonIcon, { color: '#ff453a' }]}>↻</Text>
                    </TactileButton>
                    <Text style={[styles.waveformSideCaption, { color: subColor }]}>Re-record</Text>
                  </View>
                </View>

                <View style={styles.checkboxRow}>
                  <TactileButton style={styles.checkbox} onPress={() => setFadeInOn((v) => !v)}>
                    <View style={[styles.checkboxBox, fadeInOn && styles.checkboxBoxChecked]}>
                      {fadeInOn && <Text style={styles.checkboxMark}>✓</Text>}
                    </View>
                    <Text style={[styles.checkboxLabel, { color: textColor }]}>Fade in (1s)</Text>
                  </TactileButton>
                  <TactileButton style={styles.checkbox} onPress={() => setFadeOutOn((v) => !v)}>
                    <View style={[styles.checkboxBox, fadeOutOn && styles.checkboxBoxChecked]}>
                      {fadeOutOn && <Text style={styles.checkboxMark}>✓</Text>}
                    </View>
                    <Text style={[styles.checkboxLabel, { color: textColor }]}>Fade out (1s)</Text>
                  </TactileButton>
                </View>

                <View style={styles.bottomActionsRow}>
                  <View style={styles.toolBtnWrap}>
                    <TactileButton
                      style={[styles.actionButton, { backgroundColor: cardBackground }]}
                      onPress={cancelRecording}
                      disabled={savingRecording}
                    >
                      <Text style={[styles.actionButtonLabel, { color: '#ff453a' }]}>Cancel</Text>
                    </TactileButton>
                  </View>
                  <View style={styles.toolBtnWrap}>
                    <TactileButton
                      style={[styles.actionButton, styles.softGreen]}
                      onPress={saveRecording}
                      disabled={savingRecording}
                    >
                      <Text style={[styles.actionButtonLabel, { color: '#2fb344' }]}>
                        {savingRecording ? 'Saving…' : '✅ Use this recording'}
                      </Text>
                    </TactileButton>
                  </View>
                </View>
              </>
            ) : (
              <TactileButton style={[styles.actionButton, styles.destructiveButton]} onPress={startRecording}>
                <Text style={[styles.actionButtonLabel, { color: '#ff453a' }]}>🎤 Start recording</Text>
              </TactileButton>
            )}

            {(recorderState.isRecording || !recordedUri) && (
              <TactileButton style={styles.cancelRow} onPress={cancelRecording} disabled={savingRecording}>
                <Text style={[styles.smallBtnLabel, { color: '#ff453a' }]}>Cancel</Text>
              </TactileButton>
            )}
          </Pressable>
        </Pressable>
        </GestureHandlerRootView>
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
                      ? styles.softBlue
                      : { backgroundColor: cardBackground, borderColor: langBorderColor },
                  ]}
                  onPress={() => setDictateLang('en')}
                  disabled={dictateStatus === 'listening'}
                >
                  <Text style={[styles.langBtnLabel, { color: dictateLang === 'en' ? '#208AEF' : textColor }]}>English</Text>
                </TactileButton>
              </View>
              <View style={styles.toolBtnWrap}>
                <TactileButton
                  style={[
                    styles.langBtn,
                    dictateLang === 'ru'
                      ? styles.softBlue
                      : { backgroundColor: cardBackground, borderColor: langBorderColor },
                  ]}
                  onPress={() => setDictateLang('ru')}
                  disabled={dictateStatus === 'listening'}
                >
                  <Text style={[styles.langBtnLabel, { color: dictateLang === 'ru' ? '#208AEF' : textColor }]}>Русский</Text>
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
                <Text style={[styles.actionButtonLabel, { color: '#ff453a' }]}>⏹ Stop</Text>
              </TactileButton>
            ) : (
              <TactileButton
                style={[styles.actionButton, styles.destructiveButton]}
                onPress={startDictation}
                disabled={dictateStatus === 'loading'}
              >
                <Text style={[styles.actionButtonLabel, { color: '#ff453a' }]}>
                  {dictateStatus === 'loading' ? 'Loading model…' : '🎙️ Start reading'}
                </Text>
              </TactileButton>
            )}

            {(dictateFinal || dictatePartial) && dictateStatus !== 'listening' && (
              <TactileButton style={[styles.actionButton, styles.softGreen]} onPress={useDictatedText}>
                <Text style={[styles.actionButtonLabel, { color: '#2fb344' }]}>✅ Use this text</Text>
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
            <TactileButton
              style={[styles.actionButton, styles.softBlue, styles.infoOkButton]}
              onPress={() => setInfoModal(null)}
            >
              <Text style={[styles.actionButtonLabel, { color: '#208AEF' }]}>OK</Text>
            </TactileButton>
          </View>
        </View>
      </Modal>

      {/* Sound picker */}
      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <Pressable style={styles.backdrop} onPress={() => setPicker(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}>
            <Text style={[styles.sheetTitle, { color: subColor }]}>
              {picker?.mode === 'add'
                ? `Add a sound for “${picker.token.text}”`
                : picker?.mode === 'ambient'
                  ? 'Choose an ambient sound'
                  : 'Choose a sound'}
            </Text>
            <TextInput
              style={[styles.pickerSearchInput, { backgroundColor: inputBackground, color: textColor }]}
              placeholder="Search sounds…"
              placeholderTextColor={subColor}
              value={pickerSearch}
              onChangeText={setPickerSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <ScrollView style={{ maxHeight: 360 }}>
              {pickerSuggested.length > 0 && (
                <Text style={[styles.pickerSectionLabel, { color: subColor }]}>Suggested</Text>
              )}
              {pickerSuggested.map(renderSoundRow)}
              {pickerSuggested.length > 0 && pickerRest.length > 0 && (
                <Text style={[styles.pickerSectionLabel, { color: subColor }]}>All sounds</Text>
              )}
              {pickerRestCategories === null
                ? pickerRest.map(renderSoundRow)
                : pickerRestCategories.map((cat) => {
                    const open = pickerSearching || expandedCategories.has(cat.label);
                    return (
                      <View key={cat.label}>
                        <Pressable style={styles.categoryHeader} onPress={() => toggleCategory(cat.label)}>
                          <Text style={[styles.categoryHeaderLabel, { color: textColor }]}>
                            {open ? '▾' : '▸'} {cat.label}
                          </Text>
                          <Text style={[styles.categoryHeaderCount, { color: subColor }]}>{cat.ids.length}</Text>
                        </Pressable>
                        {open && cat.ids.map(renderSoundRow)}
                      </View>
                    );
                  })}
              {pickerSearched.length === 0 && (
                <Text style={[styles.pickerEmpty, { color: subColor }]}>No sounds match “{pickerSearch}”.</Text>
              )}
            </ScrollView>
            <TactileButton style={styles.cancelRow} onPress={() => setPicker(null)}>
              <Text style={[styles.smallBtnLabel, { color: '#ff453a' }]}>Cancel</Text>
            </TactileButton>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
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

      {/* Full-image zoom viewer — pinch/pan to inspect the page; Edit hands off to re-scan/crop */}
      <Modal visible={viewerOpen} animationType="fade" onRequestClose={() => setViewerOpen(false)}>
        <GestureHandlerRootView style={styles.viewerRoot}>
          <GestureDetector gesture={zoomGesture}>
            <Animated.View style={[styles.viewerImageWrap, zoomImageStyle]}>
              <Image
                source={{ uri: page.imagePath }}
                style={styles.viewerImage}
                contentFit="contain"
              />
            </Animated.View>
          </GestureDetector>

          <View style={styles.viewerTopBar}>
            <TactileButton style={styles.viewerCircleButton} onPress={() => setViewerOpen(false)}>
              <Text style={styles.viewerCircleGlyph}>✕</Text>
            </TactileButton>
            <TactileButton style={[styles.viewerCircleButton, styles.viewerEditButton]} onPress={openEditFromViewer}>
              <Text style={styles.viewerEditLabel}>✏️ Edit</Text>
            </TactileButton>
          </View>
        </GestureHandlerRootView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 14 },
  // Room to scroll the text input clear above the keyboard while correcting text.
  contentEditing: { paddingBottom: 340 },

  image: { width: '100%', height: 220, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.12)' },

  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hint: { fontSize: 13, textAlign: 'center' },
  hintPrimary: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  hintCard: {
    borderWidth: 1.5,
    borderColor: '#208AEF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 2,
  },

  textCard: { borderRadius: 12, padding: 14 },
  flow: { fontSize: 17, lineHeight: 30 },
  empty: { fontSize: 14, fontStyle: 'italic' },

  editWrap: { gap: 10 },
  input: { minHeight: 160, borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 16, lineHeight: 24, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  dictateFrame: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: 'rgba(255,69,58,0.12)',
  },
  dictateFrameLabel: { color: '#ff453a', fontSize: 16, fontWeight: '600', textAlign: 'center' },

  ambientRow: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center' },
  ambientRowLabel: { fontSize: 14, fontWeight: '600' },

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
  soundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.2)',
  },
  soundPreviewBtn: { paddingVertical: 12, paddingHorizontal: 8 },
  soundPreviewIcon: { fontSize: 18 },
  soundRowLabel: { flex: 1, paddingVertical: 12, paddingHorizontal: 2 },
  soundId: { fontSize: 16 },
  pickerSearchInput: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 15, marginBottom: 8 },
  pickerSectionLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 8, marginBottom: 2 },
  pickerEmpty: { fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.2)',
  },
  categoryHeaderLabel: { fontSize: 15, fontWeight: '600' },
  categoryHeaderCount: { fontSize: 13 },
  cancelRow: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },

  actionButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  actionButtonLabel: { fontSize: 16, fontWeight: '600', color: '#fff' },
  // Soft-tint style: translucent accent fill + matching border, instead of a
  // solid vivid fill — used for every colored (non-neutral) button. Text/icon
  // color is set per-usage to match (actionButtonLabel's white doesn't fit).
  destructiveButton: { backgroundColor: 'rgba(255,69,58,0.15)', borderWidth: 2, borderColor: '#ff453a' },
  softBlue: { backgroundColor: 'rgba(32,138,239,0.15)', borderWidth: 2, borderColor: '#208AEF' },
  softGreen: { backgroundColor: 'rgba(47,179,68,0.15)', borderWidth: 2, borderColor: '#2fb344' },

  wordGridRow: { flexDirection: 'row', gap: 14, justifyContent: 'center' },
  wordGridCell: { width: 84 },
  wordGridButton: {
    width: 84,
    aspectRatio: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    gap: 4,
  },
  wordGridIcon: { fontSize: 20 },
  wordGridLabel: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  wordGridOutline: { borderWidth: 2, borderColor: '#fff' },

  recordStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff453a' },
  recordTimer: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  recordHint: { fontSize: 13, textAlign: 'center', marginBottom: 2 },
  waveformRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  // Top-align the row (rather than centering each column's full height,
  // caption text included) then nudge just the circle down by half the
  // waveform/circle height difference — (64-48)/2 — so the CIRCLE lines up
  // with the waveform's vertical middle instead of the whole column.
  waveformSideCol: { alignItems: 'center', gap: 4, paddingTop: 8 },
  waveformSideButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveformSideButtonIcon: {
    fontSize: 20,
    fontWeight: '700',
    width: 24,
    height: 24,
    lineHeight: 24,
    textAlign: 'center',
  },
  waveformSideCaption: { fontSize: 11, fontWeight: '600' },
  bottomActionsRow: { flexDirection: 'row', gap: 10 },
  waveform: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    position: 'relative',
    borderRadius: 8,
    paddingHorizontal: 4,
  },
  waveformBar: { flex: 1, borderRadius: 2, minHeight: 3 },
  waveformDim: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  playheadBar: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    width: 3,
    backgroundColor: '#fff',
    borderRadius: 1.5,
  },
  // Wide touch target (close to the ~44pt best-practice minimum) plus a
  // chunky white-bordered grip, extending past the waveform's own bounds —
  // easier to find and grab than a bare thin line.
  waveformHandle: {
    position: 'absolute',
    top: -10,
    bottom: -10,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveformHandleGrip: {
    width: 12,
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#208AEF',
    borderWidth: 2,
    borderColor: '#fff',
  },

  checkboxRow: { flexDirection: 'row', gap: 16, justifyContent: 'center' },
  checkbox: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(127,127,127,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxChecked: { backgroundColor: '#208AEF', borderColor: '#208AEF' },
  checkboxMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  checkboxLabel: { fontSize: 14, fontWeight: '600' },

  infoCard: { borderRadius: 16, padding: 24, alignItems: 'center', gap: 10, minWidth: 260, maxWidth: 320 },
  infoOkButton: { alignSelf: 'stretch', paddingHorizontal: 32 },
  infoEmoji: { fontSize: 32 },
  infoTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  infoMessage: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 6 },

  viewerRoot: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  viewerImageWrap: { flex: 1, width: '100%' },
  viewerImage: { width: '100%', height: '100%' },
  viewerTopBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  viewerCircleButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerCircleGlyph: { color: '#fff', fontSize: 20, fontWeight: '700' },
  viewerEditButton: {
    width: 'auto',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(32,138,239,0.15)',
    borderWidth: 2,
    borderColor: '#208AEF',
  },
  viewerEditLabel: { color: '#208AEF', fontSize: 15, fontWeight: '700' },
});
