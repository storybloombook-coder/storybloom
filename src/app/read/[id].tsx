// read/[id].tsx — the Reader. Press ▶ Read on a book and this plays it back one
// page at a time: the page's ambient bed fades in and loops automatically, the
// mic listens as you read aloud (on-device Vosk) and fires cue sounds itself
// as it recognizes their trigger words, saying "next page"/"следующая
// страница" turns the page hands-free, and a highlighted word can still be
// tapped directly — the mic and the tap are just two ways to fire the same
// cue. A status pill under the header shows Listening/Starting up/Mic
// paused/Mic unavailable, and doubles as a mute toggle.
//
// Alignment (matching live speech to the page's known OCR text) is the hard
// part CLAUDE.md warns about — expect to retune ALIGN_LOOKAHEAD and watch for
// missed/duplicate fires on real books.
//
// A bouncing ball hops to sit above whichever word was most recently read,
// hopping forward as recognized speech advances the cursor (or backward if a
// tap rewinds it — see moveReadCursorTo). It needs each word's own on-screen
// position, which is why the page text renders as a flex-wrap row of
// individually-measured word chips instead of one native Text block.
//
// Reaching the end offers "Read again" or "Done" — no separate approval step.

import { createAudioPlayer, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import TactileButton from '../../components/TactileButton';
import { playFull, playLooping, playRange, playRangeLooping } from '../../lib/audio/playRange';
import { resolveSoundSource } from '../../lib/audio/soundResolver';
import { getBook, getCuesForBook, getPagesForBook } from '../../lib/db';
import { cueAtRange, tokenize, type Token } from '../../lib/reader/text';
import { createVoskRecognizer } from '../../lib/speech/vosk';
import { NEXT_PAGE_PHRASES, type RecognizedWord, type SpeechLang } from '../../lib/speech/types';
import { isReadablePage, type Book, type Cue, type Page } from '../../lib/types';

type Player = ReturnType<typeof createAudioPlayer>;
type MicStatus = 'idle' | 'loading' | 'listening' | 'muted' | 'error';

/** True if the char at index i is a Unicode letter — word-boundary aware
 *  search (JS's \b is ASCII-only and mishandles Cyrillic). */
function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /\p{L}/u.test(ch);
}

/** Whole-word index of `needle` in `hay` at or after `from`, or -1. */
function findWordFrom(hay: string, needle: string, from: number): number {
  if (!needle) return -1;
  let pos = Math.max(0, from);
  for (;;) {
    const idx = hay.indexOf(needle, pos);
    if (idx < 0) return -1;
    const before = hay[idx - 1];
    const after = hay[idx + needle.length];
    if (!isLetter(before) && !isLetter(after)) return idx;
    pos = idx + 1;
  }
}

/** Standard edit distance (insert/delete/substitute), O(len(a)*len(b)) —
 *  fine here since both sides are single words, never full sentences. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prevDiag = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, dp[j], dp[j - 1]);
      prevDiag = tmp;
    }
  }
  return dp[n];
}

/** Closest WORD token (by edit distance) to `word` within [from, from +
 *  lookahead], for when no EXACT match exists — Vosk's small models often
 *  get a word's ending slightly wrong, especially against Russian's rich
 *  inflection, and an exact-only search misses those entirely even though
 *  the word is clearly recognizable. Tolerance is tight and scales with
 *  word length (a 1-character slip on a 4-letter word is already a 25%
 *  difference) specifically to avoid this becoming a NEW source of the
 *  wrong-word-jump bugs the exact-match guards above exist to prevent. */
function findWordFuzzy(
  tokens: Token[],
  word: string,
  from: number,
  lookahead: number
): { start: number; end: number } | null {
  const maxDist = word.length <= 5 ? 1 : 2;
  let best: { start: number; end: number } | null = null;
  let bestDist = Infinity;
  for (const t of tokens) {
    if (t.isSpace || t.start < from || t.start > from + lookahead) continue;
    const candidate = t.text.toLowerCase();
    if (Math.abs(candidate.length - word.length) > maxDist) continue; // cheap pre-filter
    const dist = levenshtein(word, candidate);
    if (dist <= maxDist && dist < bestDist) {
      bestDist = dist;
      best = { start: t.start, end: t.end };
    }
  }
  return best;
}

/** Exact match first (cheap, and the common case); fuzzy fallback only
 *  when nothing exact is found nearby. Shared by both the primary
 *  alignment match and the "does this word recur nearby" ambiguity check
 *  below, so a fuzzy near-duplicate gets the same burst-fire protection an
 *  exact duplicate already does. */
function matchWordInWindow(
  ocrLower: string,
  tokens: Token[],
  word: string,
  from: number,
  lookahead: number
): { start: number; end: number } | null {
  if (lookahead < 0) return null;
  const idx = findWordFrom(ocrLower, word, from);
  if (idx >= 0 && idx <= from + lookahead) return { start: idx, end: idx + word.length };
  return findWordFuzzy(tokens, word, from, lookahead);
}

// How far ahead of the current read position a recognized word is still
// trusted to belong to — keeps a misheard/filler word from yanking the
// cursor (and cue-firing) far down the page. Shrunk from 180: that width made
// sense when the cursor only ever advanced on Vosk's FINAL result (one big
// batch of words after a pause, needing lots of headroom to catch up in one
// jump) — now that partial results drive it too (see handleTextRef below),
// each update covers much less new text, so a smaller, safer window suffices.
const ALIGN_LOOKAHEAD = 60;
// A short/common word (a, the, in, и, в...) matches too many places in a page
// to align against reliably on its own — a single misheard blip recognized as
// "the" could snap the cursor to some FAR-AWAY occurrence of "the" within
// ALIGN_LOOKAHEAD, and every cue between the old and new cursor position
// would then fire in one burst (this was the "duplicate word jumps to the
// wrong spot and every queued sound plays at once" bug). Words this short or
// shorter are skipped for alignment purposes — only longer, more distinctive
// words actually move the cursor.
const ALIGN_MIN_WORD_LENGTH = 3;
// Minimum gap between two "next page" ADVANCES. Not a dedupe-within-one-
// utterance guard (that used to be a ref reset by the page-change effect
// itself — see the removed nextPageFiredRef — which raced: goNext() changes
// `index`, which re-runs the per-page reset effect, which reset the guard
// BEFORE the same utterance's next partial arrived, so a single "next page"
// could fire many rapid page turns straight to the end). A plain timestamp
// cooldown has no such dependency on page-change side effects.
const NEXT_PAGE_COOLDOWN_MS = 1200;
// Below this, Vosk itself wasn't confident it heard the word right — trust it
// less for alignment purposes (see the confidence-aware filtering below).
// Only ever checked for a FINAL result: Vosk computes per-word confidence for
// a completed chunk, never for a still-in-progress partial (needs the
// react-native-vosk patch in patches/ — see speech/vosk.ts's onResultRaw use).
const LOW_CONFIDENCE_THRESHOLD = 0.5;

/** Unique lowercase words (Unicode-letter runs) found in a piece of text. */
function extractWords(text: string): string[] {
  const matches = text.toLowerCase().match(/\p{L}+/gu);
  return matches ? Array.from(new Set(matches)) : [];
}

// Gap between wrapped lines, in its resting state vs. expanded around
// whichever line the ball currently occupies (see RowGapSpacer/activeRowSV
// below) — expanded needs to fit BALL_SIZE + positionBallAt's own 6px
// clearance + the bounce's travel, with a little room to spare.
const NORMAL_ROW_GAP = 10;
const EXPANDED_ROW_GAP = 56;
// How long a row's gap takes to expand/collapse — was 260ms, halved to 130
// then halved again per feedback ("let's do twice faster").
const ROW_GAP_DURATION_MS = 65;

/** One inter-line gap in the reader's flowing text — a plain spacer whose
 *  height animates between resting and expanded depending on whether the
 *  ball currently sits on THIS row, so only the ball's own line pushes its
 *  neighbors apart while every other gap stays at its normal size. Must be
 *  its own component (not inlined) so each instance owns a single, stable
 *  useAnimatedStyle call, regardless of how many rows a given page wraps
 *  into. */
function RowGapSpacer({ rowIndex, activeRow }: { rowIndex: number; activeRow: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    height: withTiming(activeRow.value === rowIndex ? EXPANDED_ROW_GAP : NORMAL_ROW_GAP, {
      duration: ROW_GAP_DURATION_MS,
    }),
  }));
  return <Animated.View style={[{ width: '100%' }, style]} />;
}

// Bouncing-ball reading-position marker: hops to sit above whichever word was
// most recently read (the last token with end <= readCursor), sized/spaced
// against BALL_SIZE below.
const BALL_SIZE = 32;
// Idle vertical bob height, in px — was 12, reduced 15% then another 20% per
// feedback ("too bouncy", twice). Only the bob amplitude, not the
// squash/stretch it drives — that wasn't part of the ask.
const BALL_BOB_AMPLITUDE = 12 * 0.85 * 0.8;
// Extra upward lift layered on top of a hop's own X/Y spring, so a jump
// between words arcs up and back down (ballistic) instead of sliding in a
// straight line — see positionBallAt's ballArc trigger and ballStyle's use
// of it below.
const BALL_ARC_HEIGHT = 26;
const BALL_ARC_HALF_DURATION_MS = 130;

// How far the ambient bed ducks while the mic is actively listening — it
// loops continuously right through the parent's own speech, feeding back
// into the same mic Vosk is trying to recognize against. Full mute would
// make page turns/silence feel abrupt; a duck to a low murmur keeps the
// scene alive while giving the recognizer a much cleaner signal.
const AMBIENT_DUCK_VOLUME = 0.18;
const AMBIENT_DUCK_MS = 350;

function micDisplay(status: MicStatus, error: string | null): { label: string; color: string; bg: string } {
  switch (status) {
    case 'listening':
      return { label: 'Listening…', color: '#2fb344', bg: 'rgba(47,179,68,0.15)' };
    case 'muted':
      return { label: 'Mic paused — tap to resume', color: '#8e8e93', bg: 'rgba(142,142,147,0.15)' };
    case 'error':
      return { label: error ?? 'Mic unavailable — tap to retry', color: '#ff453a', bg: 'rgba(255,69,58,0.15)' };
    case 'loading':
    case 'idle':
    default:
      return { label: 'Starting up…', color: '#e8a33d', bg: 'rgba(232,163,61,0.15)' };
  }
}

/** Label + color for the dedicated listen-toggle button — action-oriented
 *  ("stop"/"start"), unlike micDisplay's status-oriented pill wording. */
function listenToggleDisplay(status: MicStatus): { label: string; color: string } {
  switch (status) {
    case 'listening':
      return { label: 'Stop Listening', color: '#ff453a' };
    case 'error':
      return { label: 'Retry Mic', color: '#ff453a' };
    case 'loading':
      return { label: 'Starting up…', color: '#8e8e93' };
    case 'muted':
    case 'idle':
    default:
      return { label: 'Start Listening', color: '#2fb344' };
  }
}

export default function ReaderScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const bookId = Array.isArray(params.id) ? params.id[0] : params.id;

  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const subColor = isDark ? '#9a9a9e' : '#6b6b70';
  const backgroundColor = isDark ? '#000' : '#fff';
  const cardBackground = isDark ? '#141416' : '#f4f4f6';

  const [book, setBook] = useState<Book | null>(null);
  const [storyPages, setStoryPages] = useState<Page[]>([]);
  const [cuesByPage, setCuesByPage] = useState<Map<string, Cue[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  // Which token is mid-press / mid-play, for a quick visual pop on tap.
  const [firingToken, setFiringToken] = useState<number | null>(null);
  const [micStatus, setMicStatus] = useState<MicStatus>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  // Mirrors readCursorRef into React state so the read-so-far highlight can
  // re-render as speech alignment advances — the ref alone is enough for the
  // alignment logic itself (cue firing), but nothing re-renders off a ref.
  const [readCursor, setReadCursor] = useState(0);

  const ambientPlayerRef = useRef<Player | null>(null);
  const ambientStopRef = useRef<(() => void) | null>(null);
  const ambientDuckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cuePlayerRef = useRef<Player | null>(null);
  const cueStopRef = useRef<(() => void) | null>(null);
  // Pre-created (but not yet playing) players for the CURRENT page's cues,
  // keyed by cue id — see the pre-warm effect below. createAudioPlayer, plus
  // playFull's own wait-for-duration poll, both take a real (if usually
  // small) amount of time for a player loading fresh from disk; firing a cue
  // used to always pay that cost at the exact moment it needed to sound
  // instant. Pre-creating each page's cue players as soon as the page loads
  // gives that load time to happen in the background well before they're
  // needed, so by the time a cue actually fires, `fireCue` can often just
  // grab an already-ready player instead of starting from scratch.
  const cuePlayerCacheRef = useRef<Map<string, Player>>(new Map());
  const recognizerRef = useRef<ReturnType<typeof createVoskRecognizer> | null>(null);
  // Kept fresh every render (see the no-deps effect below) so the ONE
  // long-lived onResult subscription (registered once, kept running across
  // page turns so listening never gaps) always aligns against the CURRENT
  // page/cues instead of whatever they were when it was first registered.
  const pageRef = useRef<Page | null>(null);
  const cuesRef = useRef<Cue[]>([]);
  const langRef = useRef<SpeechLang>('en');
  // The whole book's own vocabulary (every story page, not just the current
  // one) — built once per book/language and handed to the recognizer at
  // start() so listening doesn't need to gap/restart on every page turn.
  const vocabRef = useRef<string[]>([]);
  const handleTextRef = useRef<(text: string, isFinal: boolean) => void>(() => {});
  const readCursorRef = useRef(0);
  const firedCueIdsRef = useRef<Set<string>>(new Set());
  // Bouncing ball: each word's on-screen position (relative to the flow
  // container), captured live via onLayout since text can wrap differently
  // per device — filled in as words render, read fresh whenever the read
  // cursor advances to a new "current" word.
  const wordLayoutsRef = useRef<Map<number, { x: number; y: number; width: number; height: number }>>(new Map());
  const currentWordIndexRef = useRef(-1);
  const ballX = useSharedValue(0);
  const ballY = useSharedValue(0);
  const ballOpacity = useSharedValue(0);
  const ballBounce = useSharedValue(0);
  const ballArc = useSharedValue(0);
  // Which visual row (post-wrap line) each word landed in, and which token
  // starts each row — both derived from wordLayoutsRef once layout settles
  // (see recomputeRows), so the gap around the ball's own line can expand
  // while every other gap stays put. rowsVersion bumps only when the row
  // COUNT actually changes, to re-render with newly-known gaps inserted
  // without looping forever (inserting those gaps reshapes layout, which
  // re-fires onLayout, which would otherwise recompute and bump again).
  const wordRowRef = useRef<Map<number, number>>(new Map());
  const rowStartTokensRef = useRef<number[]>([]);
  const [rowsVersion, setRowsVersion] = useState(0);
  const activeRowSV = useSharedValue(-1);
  // A page's ~dozens of words all report onLayout in a tight burst as it
  // mounts (and again, briefly, after gap spacers first get inserted and
  // reshape things) — recomputing row structure on every single one of
  // those calls meant occasionally locking in a PARTIAL mid-burst snapshot
  // (e.g. only the first few words measured so far), which is what caused
  // both the visibly-wrong expanded gap and general jank from the resulting
  // cascade of re-renders. Debouncing collapses a whole burst into one
  // recompute after layout actually settles.
  const rowRecomputeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timestamp of the last "next page" advance — see NEXT_PAGE_COOLDOWN_MS.
  const lastNextPageAtRef = useRef(0);
  // How many of the CURRENT utterance's words (Vosk's growing partial hypo-
  // thesis, split on whitespace) have already been matched against the page.
  // A partial re-delivers the FULL utterance-so-far on every callback, not
  // just what's new — reprocessing already-consumed words against the
  // now-advanced cursor was the "jumps over a sentence" bug: if an early
  // word (or a similar one) recurs nearby, re-searching for it from the
  // ADVANCED cursor finds that LATER occurrence and snaps forward to it,
  // even though nothing new was actually said there. Only the words ADDED
  // since this count was last updated are matched. Reset to 0 at the start
  // of a fresh utterance (after a final) and on every page turn (a new
  // page's text is a different alignment target).
  const utteranceWordsConsumedRef = useRef(0);
  // Per-word confidence for the CURRENT final chunk (words array lines up
  // with that chunk's plain text 1:1, in order) — set by onResultWithConfidence
  // just before that same chunk's onResult callback runs (the patched native
  // module emits them in that order deliberately, see vosk.ts), so it's
  // already populated by the time handleTextRef needs it. Never set for a
  // partial — Vosk has no per-word confidence until a chunk is finalized.
  const lastFinalConfidenceRef = useRef<RecognizedWord[] | null>(null);

  useEffect(() => {
    setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [b, ps, cs] = await Promise.all([
        getBook(bookId),
        getPagesForBook(bookId),
        getCuesForBook(bookId),
      ]);
      if (cancelled) return;
      const story = ps.filter(isReadablePage).sort((a, b) => a.pageNumber - b.pageNumber);
      const map = new Map<string, Cue[]>();
      for (const c of cs) {
        const arr = map.get(c.pageId) ?? [];
        arr.push(c);
        map.set(c.pageId, arr);
      }
      setBook(b);
      setStoryPages(story);
      setCuesByPage(map);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const stopAmbient = useCallback(() => {
    if (ambientDuckTimerRef.current) clearInterval(ambientDuckTimerRef.current);
    ambientDuckTimerRef.current = null;
    ambientStopRef.current?.();
    ambientStopRef.current = null;
    const p = ambientPlayerRef.current;
    ambientPlayerRef.current = null;
    // Let the fade-out finish before freeing the native player.
    if (p) setTimeout(() => {
      try {
        p.remove();
      } catch {}
    }, 700);
  }, []);

  // Ramps the ambient bed's volume toward `target` over AMBIENT_DUCK_MS —
  // used to duck it while listening and restore it otherwise. A plain
  // interval (matching the style already used for fades in
  // lib/audio/playRange.ts) rather than Reanimated, since it's driving a
  // native player property, not a UI style. Only ONE ramp runs at a time;
  // starting a new one (e.g. mic status flips quickly) cancels the last.
  const rampAmbientVolume = useCallback((target: number) => {
    if (ambientDuckTimerRef.current) clearInterval(ambientDuckTimerRef.current);
    const player = ambientPlayerRef.current;
    if (!player) return;
    const start = player.volume;
    const startedAt = Date.now();
    ambientDuckTimerRef.current = setInterval(() => {
      const t = Math.min(1, (Date.now() - startedAt) / AMBIENT_DUCK_MS);
      try {
        player.volume = start + (target - start) * t;
      } catch {
        // Player was removed (e.g. page turned mid-ramp) — nothing left to animate.
        if (ambientDuckTimerRef.current) clearInterval(ambientDuckTimerRef.current);
        ambientDuckTimerRef.current = null;
        return;
      }
      if (t >= 1 && ambientDuckTimerRef.current) {
        clearInterval(ambientDuckTimerRef.current);
        ambientDuckTimerRef.current = null;
      }
    }, 40);
  }, []);

  // Duck the instant listening actually starts (not while merely loading),
  // and restore whenever it isn't — muted, error, or idle all mean nothing
  // is competing with the ambient bed for the mic's attention.
  useEffect(() => {
    rampAmbientVolume(micStatus === 'listening' ? AMBIENT_DUCK_VOLUME : 1);
  }, [micStatus, rampAmbientVolume]);

  const stopCue = useCallback(() => {
    cueStopRef.current?.();
    cueStopRef.current = null;
    const p = cuePlayerRef.current;
    cuePlayerRef.current = null;
    if (p) setTimeout(() => {
      try {
        p.remove();
      } catch {}
    }, 120);
  }, []);

  // Start (and, on change, stop) the current page's ambient bed.
  useEffect(() => {
    if (loading || finished) return;
    const page = storyPages[index];
    if (!page) return;
    const source = page.ambientSoundId ? resolveSoundSource(page.ambientSoundId) : null;
    if (source) {
      const player = createAudioPlayer(source);
      ambientPlayerRef.current = player;
      if (page.ambientEndMs != null) {
        // A parent's custom recording with a trim window — LOOP that range until
        // the page changes (ambient beds should never fall silent mid-page).
        ambientStopRef.current = playRangeLooping(player, {
          startSec: (page.ambientStartMs ?? 0) / 1000,
          endSec: page.ambientEndMs / 1000,
          fadeInSec: (page.ambientFadeInMs ?? 0) / 1000 || 0.6,
          fadeOutSec: (page.ambientFadeOutMs ?? 0) / 1000 || 0.5,
        });
      } else {
        ambientStopRef.current = playLooping(player, { fadeInSec: 0.6, fadeOutSec: 0.5 });
      }
    }
    return () => {
      stopAmbient();
      stopCue();
    };
  }, [index, loading, finished, storyPages, stopAmbient, stopCue]);

  // Safety net on unmount.
  useEffect(
    () => () => {
      stopAmbient();
      stopCue();
      if (rowRecomputeTimerRef.current) clearTimeout(rowRecomputeTimerRef.current);
    },
    [stopAmbient, stopCue]
  );

  // Keep the alignment refs current for whichever page is showing, and reset
  // the read position/fired-cue set on every page turn.
  useEffect(() => {
    const page = storyPages[index] ?? null;
    pageRef.current = page;
    cuesRef.current = page ? cuesByPage.get(page.id) ?? [] : [];
    readCursorRef.current = 0;
    firedCueIdsRef.current = new Set();
    utteranceWordsConsumedRef.current = 0;
    lastFinalConfidenceRef.current = null;
    setReadCursor(0);
    // A new page's tokens start over at index 0 — last page's measured word
    // positions don't apply, and the ball should hide until the new page's
    // words have been measured and the reader reaches the first one.
    wordLayoutsRef.current = new Map();
    currentWordIndexRef.current = -1;
    ballOpacity.value = 0;
    // Same story for row structure — a new page wraps differently, so last
    // page's row boundaries (and which one was "active") don't apply.
    if (rowRecomputeTimerRef.current) clearTimeout(rowRecomputeTimerRef.current);
    wordRowRef.current = new Map();
    rowStartTokensRef.current = [];
    setRowsVersion(0);
    activeRowSV.value = -1;
  }, [index, storyPages, cuesByPage]);

  // The ball's continuous up/down bounce — independent of its hop-to-word
  // position animation, runs for the lifetime of the screen.
  useEffect(() => {
    ballBounce.value = withRepeat(withTiming(1, { duration: 320 }), -1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-warm this page's cue players ahead of time (see cuePlayerCacheRef's
  // own comment) — and free the PREVIOUS page's, which fireCue may not have
  // consumed (a cue the reader skipped past without triggering).
  useEffect(() => {
    const cache = cuePlayerCacheRef.current;
    for (const p of cache.values()) {
      try {
        p.remove();
      } catch {}
    }
    cache.clear();
    for (const cue of cuesRef.current) {
      if (cue.reviewState === 'removed' || !cue.soundId) continue;
      const source = resolveSoundSource(cue.soundId);
      if (!source) continue;
      try {
        cache.set(cue.id, createAudioPlayer(source));
      } catch {}
    }
    return () => {
      for (const p of cache.values()) {
        try {
          p.remove();
        } catch {}
      }
      cache.clear();
    };
  }, [index, storyPages, cuesByPage]);

  useEffect(() => {
    langRef.current = (book?.language as SpeechLang) ?? 'en';
  }, [book]);

  useEffect(() => {
    const words = new Set<string>();
    for (const page of storyPages) {
      for (const w of extractWords(page.ocrText)) words.add(w);
    }
    for (const w of extractWords(NEXT_PAGE_PHRASES[langRef.current])) words.add(w);
    vocabRef.current = Array.from(words);
  }, [storyPages, book]);

  // Re-pointed every render (cheap — just a ref write) so the ONE persistent
  // onResult/onPartialResult subscriptions below always call into fresh
  // state/closures (goNext, fireCue) without needing to tear down and
  // re-register the recognizer — which would gap the listening across every
  // page turn. Shared by BOTH partial and final results (see startListening) —
  // partials arrive continuously as you speak (near-instant), while a FINAL
  // only arrives once Vosk decides the utterance ended (often 0.5-2s after
  // the word was actually said). Waiting for finals alone was the dominant
  // cause of the read-along highlight and cue sounds both lagging noticeably
  // behind actual speech. Safe to run on the same (still-growing) utterance
  // repeatedly: readCursorRef only ever advances forward, and a word already
  // behind it simply won't be found again nearby, so a partial's words and
  // the eventual final's (mostly-overlapping) words don't double-fire.
  useEffect(() => {
    handleTextRef.current = (text: string, isFinal: boolean) => {
      const lang = langRef.current;
      if (text.toLowerCase().includes(NEXT_PAGE_PHRASES[lang])) {
        // Only act on the FINAL result — a fleeting partial hypothesis can
        // still be revised away by the time Vosk settles, and page
        // navigation is high-stakes (skips content, unlike a cue sound)
        // enough to be worth the extra ~0.5-1s of latency versus a
        // partial-driven fire. NEXT_PAGE_COOLDOWN_MS on top guards against
        // Vosk emitting more than one final for what a human said as a
        // single utterance.
        if (isFinal) {
          const now = Date.now();
          if (now - lastNextPageAtRef.current > NEXT_PAGE_COOLDOWN_MS) {
            lastNextPageAtRef.current = now;
            goNext();
          }
        }
        return; // never align this utterance's words as page content, partial or final
      }
      const page = pageRef.current;
      if (page) {
        const ocrLower = page.ocrText.toLowerCase();
        const tokens = tokenize(page.ocrText);
        const words = text.toLowerCase().split(/\s+/).filter(Boolean);
        // Only the words ADDED since this utterance was last looked at — see
        // utteranceWordsConsumedRef's comment above for why re-matching
        // already-consumed words (Vosk re-delivers the FULL utterance-so-far
        // on every partial, not just what's new) was the "cursor jumps over
        // a sentence" bug whenever a word recurred nearby.
        const already = Math.min(utteranceWordsConsumedRef.current, words.length);
        const newWords = words.slice(already);
        utteranceWordsConsumedRef.current = words.length;
        // Per-word confidence for THIS chunk, if the patched native module
        // supplied it (finals only) and it lines up 1:1 with `words` — a
        // length mismatch means Vosk's text/result arrays disagreed for some
        // reason, so just skip confidence-aware filtering rather than risk
        // checking the wrong index.
        const confidence =
          isFinal && lastFinalConfidenceRef.current?.length === words.length
            ? lastFinalConfidenceRef.current
            : null;
        for (let wi = 0; wi < newWords.length; wi++) {
          const word = newWords[wi];
          // A word Vosk itself wasn't confident about is more likely a
          // coincidental mishear that happens to string-match some OTHER
          // nearby page word than a correct recognition — exactly the kind
          // of match that snaps the cursor to the wrong spot. Skip trusting
          // it for alignment; a later, clearer recognition of the same word
          // (this utterance's eventual final, or the reader repeating it)
          // will still catch it normally.
          const wordConfidence = confidence?.[already + wi]?.confidence;
          if (wordConfidence !== undefined && wordConfidence < LOW_CONFIDENCE_THRESHOLD) continue;
          // Short/common words (a, the, in, и, в...) match too many spots to
          // align against alone — see ALIGN_MIN_WORD_LENGTH above.
          if (word.length < ALIGN_MIN_WORD_LENGTH) continue;
          const from = readCursorRef.current;
          // Exact match first, falling back to a small edit-distance
          // tolerance when nothing exact is nearby (see findWordFuzzy) —
          // catches Vosk mis-hearing a word's ending without needing
          // better raw recognition at all.
          const match = matchWordInWindow(ocrLower, tokens, word, from, ALIGN_LOOKAHEAD);
          if (!match) continue; // not found nearby — skip, don't jump wildly
          const idx = match.start;
          const newCursor = match.end;
          // If this same word occurs AGAIN shortly after, we can't be sure
          // which occurrence was actually just heard — a single recognized
          // word is ambiguous evidence either way. Firing every queued cue
          // all the way back to the old cursor in that case was the "two
          // identical words nearby -> a burst of every sound in between"
          // bug: instead, only fire the cue(s) sitting AT this occurrence
          // itself, and let the earlier ones fire (as normal) if their own
          // trigger words get recognized directly.
          const nextSame = matchWordInWindow(ocrLower, tokens, word, newCursor, from + ALIGN_LOOKAHEAD - newCursor);
          const ambiguous = nextSame !== null;
          const fireFrom = ambiguous ? idx : from;
          for (const cue of cuesRef.current) {
            if (cue.reviewState === 'removed' || !cue.soundId || cue.charStart == null) continue;
            if (firedCueIdsRef.current.has(cue.id)) continue;
            if (cue.charStart >= fireFrom && cue.charStart < newCursor) {
              firedCueIdsRef.current.add(cue.id);
              const tokenIndex = tokens.findIndex(
                (t) => !t.isSpace && cue.charStart! >= t.start && cue.charStart! < t.end
              );
              fireCue(cue, tokenIndex);
            }
          }
          readCursorRef.current = newCursor;
          // setReadCursor below only fires ONCE, after this whole loop —
          // so if the batch of words in this single callback contains this
          // same word again (its own cumulative partial hypothesis
          // stuttering, or the reader saying it twice in one breath), the
          // loop would silently walk through THIS occurrence and settle on
          // the NEXT one before anything ever renders, which looks exactly
          // like the cursor "jumping ahead" instead of advancing steadily.
          // Stopping here instead means the visible position always lands
          // on the FIRST occurrence a recognized word could mean; reaching
          // the second one takes an actual subsequent recognition (the next
          // partial, or the eventual final), same as it would for a real
          // second read of that word.
          if (ambiguous) break;
        }
        // One state update per recognized result (not per word) — enough to
        // re-render the read-so-far highlight without spamming setState.
        setReadCursor(readCursorRef.current);
      }
      // A final closes out this utterance — the next partial starts a fresh
      // one, so its words should all be treated as new again.
      if (isFinal) {
        utteranceWordsConsumedRef.current = 0;
        lastFinalConfidenceRef.current = null; // consumed — don't let it leak into a later chunk
      }
    };
  });

  const startListening = useCallback(async () => {
    setMicStatus('loading');
    setMicError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setMicStatus('error');
        setMicError('Microphone access needed to listen while you read.');
        return;
      }
      let recognizer = recognizerRef.current;
      if (!recognizer) {
        recognizer = createVoskRecognizer();
        recognizerRef.current = recognizer;
        await recognizer.load(langRef.current);
      }
      await recognizer.start({
        lang: langRef.current,
        onPartial: (text) => handleTextRef.current(text, false),
        onResult: (text) => handleTextRef.current(text, true),
        onResultWithConfidence: (words) => {
          lastFinalConfidenceRef.current = words;
        },
        vocabulary: vocabRef.current,
      });
      setMicStatus('listening');
    } catch (e: any) {
      setMicStatus('error');
      setMicError(e?.message ?? String(e));
    }
  }, []);

  // Start listening once the book's loaded, and stop for good on unmount.
  useEffect(() => {
    if (loading || !book || storyPages.length === 0) return;
    startListening();
    return () => {
      recognizerRef.current?.stop().catch(() => {});
      recognizerRef.current?.unload().catch(() => {});
      recognizerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, book, storyPages.length]);

  async function toggleMic() {
    if (micStatus === 'listening') {
      await recognizerRef.current?.stop().catch(() => {});
      setMicStatus('muted');
    } else if (micStatus === 'muted') {
      try {
        await recognizerRef.current?.start({
          lang: langRef.current,
          onPartial: (text) => handleTextRef.current(text, false),
          onResult: (text) => handleTextRef.current(text, true),
          onResultWithConfidence: (words) => {
            lastFinalConfidenceRef.current = words;
          },
          vocabulary: vocabRef.current,
        });
        setMicStatus('listening');
      } catch (e: any) {
        setMicStatus('error');
        setMicError(e?.message ?? String(e));
      }
    } else if (micStatus === 'error') {
      startListening();
    }
  }

  // Stop listening at "The End" (nothing left to align against); resume if
  // the parent hits "Read again".
  useEffect(() => {
    if (finished) {
      recognizerRef.current?.stop().catch(() => {});
      setMicStatus('muted');
    } else if (micStatus === 'muted' && recognizerRef.current) {
      startListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  function fireCue(cue: Cue, tokenIndex: number) {
    if (!cue.soundId) return;
    stopCue();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setFiringToken(tokenIndex);
    // Reuse the pre-warmed player if this page's warm-up already created one
    // (see cuePlayerCacheRef) — its file load (and, inside playFull, the
    // wait-for-duration probe) has very likely already finished in the
    // background, so playback can start immediately instead of paying that
    // cost right now. Falls back to creating fresh if it's somehow missing
    // (e.g. a tap on a cue whose sound was just changed and hasn't been
    // re-warmed yet).
    const cache = cuePlayerCacheRef.current;
    let player = cache.get(cue.id);
    if (player) {
      cache.delete(cue.id); // consumed — fireCue's own stopCue()/cueStopRef now own its lifecycle
    } else {
      const source = resolveSoundSource(cue.soundId);
      if (!source) return; // missing asset — the readiness gate flags these up front
      player = createAudioPlayer(source);
    }
    cuePlayerRef.current = player;
    const onEnd = () => {
      cueStopRef.current = null;
      setFiringToken((t) => (t === tokenIndex ? null : t));
    };
    if (cue.soundEndMs != null) {
      cueStopRef.current = playRange(player, {
        startSec: (cue.soundStartMs ?? 0) / 1000,
        endSec: cue.soundEndMs / 1000,
        fadeInSec: (cue.fadeInMs ?? 0) / 1000,
        fadeOutSec: (cue.fadeOutMs ?? 0) / 1000,
        onEnd,
      });
    } else {
      // Library sound: play in full with a short fade in/out.
      cueStopRef.current = playFull(player, { onEnd });
    }
  }

  // Manual override for the auto-alignment cursor: tap any word to jump the
  // read-so-far position there — corrects a bad auto-jump (see the duplicate-
  // word guard above; still not foolproof) or lets a parent deliberately
  // rewind to reread a passage with a child. Moving backward un-fires cues
  // from the new position onward so they can trigger again on the reread;
  // moving forward silently marks skipped-over cues as fired (no burst of
  // catch-up sounds — same reasoning as the ambiguous-word guard).
  function moveReadCursorTo(token: Token) {
    const newCursor = token.start;
    const oldCursor = readCursorRef.current;
    if (newCursor === oldCursor) return;
    if (newCursor < oldCursor) {
      for (const cue of cuesRef.current) {
        if (cue.charStart != null && cue.charStart >= newCursor) {
          firedCueIdsRef.current.delete(cue.id);
        }
      }
    } else {
      for (const cue of cuesRef.current) {
        if (cue.charStart != null && cue.charStart >= oldCursor && cue.charStart < newCursor) {
          firedCueIdsRef.current.add(cue.id);
        }
      }
    }
    readCursorRef.current = newCursor;
    setReadCursor(newCursor);
  }

  /** Hops the ball to word `index`'s measured position, if known yet — a
   *  word rendered this session but not yet laid out (e.g. the very first
   *  frame after a page turn) simply isn't positioned until its own
   *  onWordLayout fires and calls this again. Returns whether it moved. */
  function positionBallAt(index: number): boolean {
    const pos = wordLayoutsRef.current.get(index);
    if (!pos) return false;
    const row = wordRowRef.current.get(index) ?? -1;
    // mass 0.85 (default 1) — 15% less inertia so the hop settles a touch
    // quicker/snappier instead of floating into place.
    ballX.value = withSpring(pos.x + pos.width / 2 - BALL_SIZE / 2, { damping: 16, stiffness: 180, mass: 0.85 });
    // activeRowSV (the row-gap expansion, see RowGapSpacer) only updates once
    // this spring actually SETTLES, not the instant the target changes — it
    // used to be set immediately alongside the cursor, but the spring can
    // take noticeably longer to physically arrive (especially hopping several
    // words/rows in one go), so the gap was visibly opening up well before
    // the ball got there. `finished` comes back false if a later
    // positionBallAt call retargets this spring before it settles (e.g. fast
    // reading re-triggering alignment); correctly skipped in that case, since
    // the ball never actually reached that row.
    ballY.value = withSpring(pos.y - BALL_SIZE - 6, { damping: 16, stiffness: 180, mass: 0.85 }, (finished) => {
      'worklet';
      if (finished) activeRowSV.value = row;
    });
    // Ballistic arc: a quick up-then-down lift layered on top of the X/Y
    // spring above, so the hop reads as a thrown hop rather than a straight
    // glide. Its own fixed duration is independent of the spring's (which
    // varies with hop distance) — good enough for the typical short hop this
    // drives; a long multi-row jump just has the arc finish a beat early.
    ballArc.value = withSequence(
      withTiming(1, { duration: BALL_ARC_HALF_DURATION_MS, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: BALL_ARC_HALF_DURATION_MS, easing: Easing.in(Easing.quad) })
    );
    ballOpacity.value = withTiming(1, { duration: 150 });
    return true;
  }

  /** Groups measured words into visual rows by shared Y position, so the
   *  gap around whichever row the ball occupies can expand independently of
   *  every other gap. Only bumps rowsVersion (triggering the re-render that
   *  actually inserts/moves the gap spacers) when the row COUNT changes —
   *  inserting those spacers reshapes the layout, re-firing onLayout for
   *  every word, which would otherwise recompute and bump again forever. */
  function recomputeRows() {
    const entries = Array.from(wordLayoutsRef.current.entries()).sort((a, b) => a[0] - b[0]);
    const rowOf = new Map<number, number>();
    const starts: number[] = [];
    let lastY: number | null = null;
    let row = -1;
    for (const [idx, pos] of entries) {
      if (lastY === null || Math.abs(pos.y - lastY) > 4) {
        row += 1;
        starts.push(idx);
        lastY = pos.y;
      }
      rowOf.set(idx, row);
    }
    // Comparing only .length (the original check) missed the case where the
    // row COUNT happens to come out the same across two recompute passes but
    // individual rows start at DIFFERENT token indices (e.g. once more words
    // finish measuring and a row's wrap point shifts by a word) — the JSX
    // then never re-renders with the corrected starts, so a RowGapSpacer
    // stays keyed to a stale rowIndex further down the page than where its
    // row actually begins now: activeRowSV briefly matching that stale index
    // (while chasing the ball to a DIFFERENT, correct row nearby) reads as a
    // large gap sitting right under the active line that shouldn't be there.
    const prev = rowStartTokensRef.current;
    const changed = starts.length !== prev.length || starts.some((v, i) => v !== prev[i]);
    wordRowRef.current = rowOf;
    rowStartTokensRef.current = starts;
    if (changed) setRowsVersion((v) => v + 1);
  }

  function onWordLayout(index: number, e: LayoutChangeEvent) {
    const { x, y, width, height } = e.nativeEvent.layout;
    wordLayoutsRef.current.set(index, { x, y, width, height });
    if (rowRecomputeTimerRef.current) clearTimeout(rowRecomputeTimerRef.current);
    rowRecomputeTimerRef.current = setTimeout(recomputeRows, 80);
    if (currentWordIndexRef.current === index) positionBallAt(index);
  }

  // Re-targets the ball whenever the read cursor advances (or rewinds) to a
  // different "current" word. Deliberately keyed on the word's START (not
  // its end, unlike the karaoke highlight) being behind the cursor: a tap or
  // ball-drop sets the cursor to the target word's OWN start (see
  // moveReadCursorTo, which keeps it that way on purpose so saying that word
  // again on a reread still finds it as a fresh forward match) — requiring
  // the word's END would mean the very word just dropped on never satisfies
  // its own condition, landing the ball one word early every time.
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const toks = tokenize(page.ocrText);
    let idx = -1;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (!t.isSpace && t.start <= readCursor) idx = i;
    }
    currentWordIndexRef.current = idx;
    // Only reset here when there's no ball to show at all — the row it
    // SHOULD expand for (a real target) is set inside positionBallAt's own
    // spring-settle callback below, not immediately.
    if (idx < 0 || !positionBallAt(idx)) {
      activeRowSV.value = -1;
      ballOpacity.value = withTiming(0, { duration: 100 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readCursor]);

  function goNext() {
    stopCue();
    if (index < storyPages.length - 1) {
      setIndex((i) => i + 1);
    } else {
      setFinished(true);
    }
  }

  function goPrev() {
    stopCue();
    if (index > 0) setIndex((i) => i - 1);
  }

  /** Nearest measured word to a drop point (both in flow-container-relative
   *  coordinates) — "nearest" rather than "inside" so a drop that lands in
   *  the gap between words/lines still resolves to something sensible. */
  function findClosestWordIndex(x: number, y: number): number {
    let best = -1;
    let bestDist = Infinity;
    for (const [i, pos] of wordLayoutsRef.current) {
      const cx = pos.x + pos.width / 2;
      const cy = pos.y + pos.height / 2;
      const dist = (cx - x) ** 2 + (cy - y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  function handleBallDrop(x: number, y: number) {
    const page = pageRef.current;
    if (!page) return;
    // The ball's own true center at drop time — NOT the "resting above a
    // word" offset positionBallAt applies, which only makes sense once it's
    // actually settled on a word. Reusing that offset here (as an earlier
    // version did) added a spurious ~40px downward error to hit-testing,
    // consistently biasing matches toward the wrong word/line.
    const dropCenterX = x + BALL_SIZE / 2;
    const dropCenterY = y + BALL_SIZE / 2;
    const idx = findClosestWordIndex(dropCenterX, dropCenterY);
    ballBounce.value = withRepeat(withTiming(1, { duration: 320 }), -1, true);
    if (idx < 0) {
      if (currentWordIndexRef.current >= 0) positionBallAt(currentWordIndexRef.current);
      return;
    }
    const toks = tokenize(page.ocrText);
    const token = toks[idx];
    if (!token) return;
    moveReadCursorTo(token);
    // Reposition immediately rather than waiting for the readCursor state
    // update to re-render and the [readCursor] effect to catch up on the
    // next tick — that round trip was the visible "delay" after a drop.
    currentWordIndexRef.current = idx;
    activeRowSV.value = wordRowRef.current.get(idx) ?? -1;
    positionBallAt(idx);
  }

  const ballDragStartX = useSharedValue(0);
  const ballDragStartY = useSharedValue(0);
  const ballDragGesture = Gesture.Pan()
    .hitSlop(14)
    .onStart(() => {
      ballDragStartX.value = ballX.value;
      ballDragStartY.value = ballY.value;
      ballBounce.value = 0; // hold still while dragging — bounce would fight the finger
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
    })
    .onUpdate((e) => {
      ballX.value = ballDragStartX.value + e.translationX;
      ballY.value = ballDragStartY.value + e.translationY;
    })
    .onEnd(() => {
      runOnJS(handleBallDrop)(ballX.value, ballY.value);
    });

  const ballStyle = useAnimatedStyle(() => {
    // Squash-and-stretch, driven by the same ballBounce value that already
    // drives the vertical bob so the two stay perfectly in sync: at the
    // BOTTOM of the bounce (value 0 — start of each cycle, and again every
    // time it returns low) the ball squashes as if compressed on impact;
    // at the top (value 1) it stretches slightly as if elongated mid-air.
    const scaleY = interpolate(ballBounce.value, [0, 1], [0.82, 1.08]);
    const scaleX = interpolate(ballBounce.value, [0, 1], [1.16, 0.94]);
    return {
      opacity: ballOpacity.value,
      transform: [
        { translateX: ballX.value },
        { translateY: ballY.value - ballBounce.value * BALL_BOB_AMPLITUDE - ballArc.value * BALL_ARC_HEIGHT },
        { scaleX },
        { scaleY },
      ],
    };
  });

  // The gap above the very FIRST line isn't a RowGapSpacer (there's no
  // previous row to insert one between) — it's the container's own
  // marginTop, animated the same way for when the ball is on row 0.
  const flowWrapStyle = useAnimatedStyle(() => ({
    marginTop: withTiming(activeRowSV.value === 0 ? EXPANDED_ROW_GAP : 16, { duration: ROW_GAP_DURATION_MS }),
  }));

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color="#2fb344" />
      </SafeAreaView>
    );
  }

  if (storyPages.length === 0) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={{ color: textColor, marginBottom: 16 }}>This book has no story pages to read.</Text>
        <TactileButton style={[styles.secondaryBtn, { backgroundColor: cardBackground }]} onPress={() => router.back()}>
          <Text style={[styles.secondaryLabel, { color: textColor }]}>Back</Text>
        </TactileButton>
      </SafeAreaView>
    );
  }

  if (finished) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.endEmoji}>🌸</Text>
        <Text style={[styles.endTitle, { color: textColor }]}>The End</Text>
        <Text style={[styles.endSub, { color: subColor }]}>
          {book?.title ? `You finished “${book.title}.”` : 'You finished the book.'}
        </Text>
        <View style={styles.endActions}>
          <TactileButton
            style={[styles.secondaryBtn, { backgroundColor: cardBackground }]}
            onPress={() => {
              setFinished(false);
              setIndex(0);
            }}
          >
            <Text style={[styles.secondaryLabel, { color: textColor }]}>↻  Read again</Text>
          </TactileButton>
          <TactileButton style={[styles.secondaryBtn, { backgroundColor: cardBackground }]} onPress={() => router.back()}>
            <Text style={[styles.secondaryLabel, { color: subColor }]}>Done</Text>
          </TactileButton>
        </View>
      </SafeAreaView>
    );
  }

  const page = storyPages[index];
  const cues = cuesByPage.get(page.id) ?? [];
  const tokens = tokenize(page.ocrText);
  const isLast = index === storyPages.length - 1;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={[styles.exit, { color: subColor }]}>✕</Text>
        </Pressable>
        <Text style={[styles.pageCount, { color: subColor }]}>
          Page {index + 1} of {storyPages.length}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {(() => {
        const mic = micDisplay(micStatus, micError);
        return (
          <Pressable onPress={toggleMic} style={styles.micRow}>
            <View style={[styles.micPill, { backgroundColor: mic.bg, borderColor: mic.color }]}>
              <View style={[styles.micDot, { backgroundColor: mic.color }]} />
              <Text style={[styles.micPillText, { color: mic.color }]} numberOfLines={1}>
                {mic.label}
              </Text>
            </View>
          </Pressable>
        );
      })()}

      <View style={styles.body}>
        {page.imagePath ? (
          <Image source={{ uri: page.imagePath }} style={styles.pageImage} contentFit="contain" transition={150} />
        ) : null}

        <ScrollView contentContainerStyle={styles.textWrap}>
          {page.ocrText.trim() ? (
            <Animated.View style={[styles.flowWrap, flowWrapStyle]}>
              <GestureDetector gesture={ballDragGesture}>
                <Animated.View style={[styles.ball, ballStyle]} />
              </GestureDetector>
              {(() => {
                // Built as a flat array (not one-node-per-token via .map)
                // because a gap spacer needs to be a DIRECT sibling of the
                // word/space Texts within flowWrap — its width:'100%' means
                // "100% of flowWrap," which only holds if it isn't nested
                // inside some other per-token wrapper. Row 0 needs no
                // spacer of its own (nothing above it to push apart from;
                // flowWrapStyle's marginTop handles the ball sitting there
                // instead); every later row's start token gets one inserted
                // right before it, whichever kind of token that happens to
                // be (a space-run wraps onto a new row just as often as a
                // word does).
                const rowStartAt = new Map(rowStartTokensRef.current.map((tokenIdx, row) => [tokenIdx, row]));
                const elements: React.ReactNode[] = [];
                tokens.forEach((t, i) => {
                  const rowStartingHere = rowStartAt.get(i);
                  if (rowStartingHere != null && rowStartingHere > 0) {
                    elements.push(<RowGapSpacer key={`gap-${i}`} rowIndex={rowStartingHere} activeRow={activeRowSV} />);
                  }
                  // Karaoke-style read-so-far highlight — driven by the same
                  // speech-alignment cursor that fires cues, so it tracks
                  // exactly as far as recognized speech has actually reached.
                  const isRead = !t.isSpace && t.end <= readCursor;
                  if (t.isSpace) {
                    // A literal line break in the OCR text (a page-photo's
                    // own line, not just a run of spaces) forces a wrap here
                    // too — a flex-wrap row of per-word chips doesn't
                    // otherwise know about newlines the way a single native
                    // Text block did.
                    if (t.text.includes('\n')) {
                      elements.push(<View key={`t-${i}`} style={styles.lineBreak} />);
                    } else {
                      elements.push(
                        <Text key={`t-${i}`} style={[styles.flowText, { color: textColor }]}>
                          {t.text}
                        </Text>
                      );
                    }
                    return;
                  }
                  const cue = cueAtRange(cues, t.start, t.end);
                  const active = cue && cue.reviewState !== 'removed' && !!cue.soundId;
                  if (!active) {
                    elements.push(
                      <Text
                        key={`t-${i}`}
                        onLayout={(e) => onWordLayout(i, e)}
                        onPress={() => moveReadCursorTo(t)}
                        style={[
                          styles.flowText,
                          isRead ? [styles.readWord, { color: textColor }] : { color: textColor },
                        ]}
                      >
                        {t.text}
                      </Text>
                    );
                    return;
                  }
                  const firing = firingToken === i;
                  elements.push(
                    <Text
                      key={`t-${i}`}
                      onLayout={(e) => onWordLayout(i, e)}
                      onPress={() => {
                        fireCue(cue!, i);
                        moveReadCursorTo(t);
                      }}
                      style={[
                        styles.flowText,
                        styles.cueWord,
                        {
                          // Already-spoken cue words get a touch more
                          // opacity — same blue, just a bit bolder — so the
                          // highlight still reads consistently across cue
                          // and plain text.
                          backgroundColor: firing
                            ? 'rgba(32,138,239,0.6)'
                            : isRead
                              ? 'rgba(32,138,239,0.4)'
                              : 'rgba(32,138,239,0.28)',
                          color: textColor,
                        },
                      ]}
                    >
                      {t.text}
                    </Text>
                  );
                });
                return elements;
              })()}
            </Animated.View>
          ) : (
            <Text style={[styles.noText, { color: subColor }]}>No text on this page — just turn the page.</Text>
          )}
          <Text style={[styles.hint, { color: subColor }]}>
            Tap a highlighted word to play its sound. Tap any word to jump the reading position
            there — handy for a reread or to fix a mis-tracked spot.
          </Text>
        </ScrollView>
      </View>

      {(() => {
        const listen = listenToggleDisplay(micStatus);
        return (
          <View style={styles.footer}>
            {/* TactileButton only sizes its own inner view — these wrappers are
                what actually carry flex:1 in the row layout (same fix already
                applied in create-story.tsx / library.tsx). */}
            <View style={styles.footerRow}>
              <View style={styles.footerHalf}>
                <TactileButton
                  style={[styles.navBack, { opacity: index === 0 ? 0.4 : 1 }]}
                  onPress={goPrev}
                >
                  <Text style={styles.navBackLabel}>← Previous page</Text>
                </TactileButton>
              </View>
              <View style={styles.footerHalf}>
                <TactileButton style={styles.navNext} onPress={goNext}>
                  <Text style={styles.navNextLabel}>{isLast ? 'Finish  ✓' : 'Next page  →'}</Text>
                </TactileButton>
              </View>
            </View>
            <View style={styles.footerRow}>
              <View style={styles.footerHalf}>
                <TactileButton
                  style={[styles.toLibraryBtn, { backgroundColor: cardBackground }]}
                  onPress={() => router.replace('/library')}
                >
                  <Text style={[styles.toLibraryLabel, { color: textColor }]}>To Library</Text>
                </TactileButton>
              </View>
              <View style={styles.footerHalf}>
                <TactileButton
                  style={[styles.toLibraryBtn, { backgroundColor: cardBackground }]}
                  onPress={toggleMic}
                  disabled={micStatus === 'loading'}
                >
                  <Text style={[styles.toLibraryLabel, { color: listen.color }]}>{listen.label}</Text>
                </TactileButton>
              </View>
            </View>
          </View>
        );
      })()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  exit: { fontSize: 22, fontWeight: '600' },
  pageCount: { fontSize: 14, fontWeight: '700' },

  micRow: { alignItems: 'center', paddingBottom: 8 },
  micPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
    maxWidth: '90%',
  },
  micDot: { width: 8, height: 8, borderRadius: 4 },
  micPillText: { fontSize: 13, fontWeight: '700' },

  body: { flex: 1 },
  pageImage: { width: '100%', height: 220, marginBottom: 8 },
  textWrap: { paddingHorizontal: 22, paddingVertical: 16, gap: 20 },
  // marginTop (animated, see flowWrapStyle) and the inter-row gaps (each an
  // animated RowGapSpacer, see recomputeRows) supply ALL vertical spacing —
  // deliberately no static value here, so only the ball's own line expands
  // rather than every line being permanently spaced out to fit it.
  flowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    position: 'relative',
  },
  flowText: { fontSize: 22, lineHeight: 36 },
  lineBreak: { width: '100%', height: 0 },
  cueWord: { borderRadius: 5, overflow: 'hidden' },
  // The karaoke-style "already spoken" highlight for plain (non-cue) words.
  readWord: { backgroundColor: 'rgba(255,213,79,0.35)', borderRadius: 3 },
  ball: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    backgroundColor: '#ff8a3d',
    borderWidth: 2,
    borderColor: '#fff',
  },
  noText: { fontSize: 16, fontStyle: 'italic', textAlign: 'center', marginTop: 30 },
  hint: { fontSize: 13, textAlign: 'center', fontStyle: 'italic' },

  footer: {
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
  },
  footerRow: { flexDirection: 'row', gap: 12 },
  footerHalf: { flex: 1 },
  navBack: {
    backgroundColor: 'rgba(47,179,68,0.15)',
    borderWidth: 2,
    borderColor: '#2fb344',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBackLabel: { color: '#2fb344', fontSize: 16, fontWeight: '800' },
  navNext: {
    backgroundColor: 'rgba(47,179,68,0.15)',
    borderWidth: 2,
    borderColor: '#2fb344',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navNextLabel: { color: '#2fb344', fontSize: 18, fontWeight: '800' },
  toLibraryBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  toLibraryLabel: { fontSize: 15, fontWeight: '700' },

  endEmoji: { fontSize: 52, marginBottom: 8 },
  endTitle: { fontSize: 30, fontWeight: '800' },
  endSub: { fontSize: 15, textAlign: 'center', marginTop: 8, marginBottom: 28 },
  endActions: { alignSelf: 'stretch', gap: 12 },
  secondaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  secondaryLabel: { fontSize: 16, fontWeight: '700' },
});
