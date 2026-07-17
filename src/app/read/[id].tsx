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
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
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
import { NEXT_PAGE_PHRASES, type SpeechLang } from '../../lib/speech/types';
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

/** Unique lowercase words (Unicode-letter runs) found in a piece of text. */
function extractWords(text: string): string[] {
  const matches = text.toLowerCase().match(/\p{L}+/gu);
  return matches ? Array.from(new Set(matches)) : [];
}

// Bouncing-ball reading-position marker: hops to sit above whichever word was
// most recently read (the last token with end <= readCursor), sized/spaced
// against BALL_SIZE below.
const BALL_SIZE = 32;

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
  // Guards against firing "next page" twice for the SAME utterance — Vosk
  // sends partials continuously, then one final; if the phrase is caught by
  // an early partial and again by the final (same words, same utterance), the
  // second one must not advance a SECOND page. Reset after every final (the
  // utterance boundary), ready for the next one.
  const nextPageFiredRef = useRef(false);

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
    nextPageFiredRef.current = false;
    setReadCursor(0);
    // A new page's tokens start over at index 0 — last page's measured word
    // positions don't apply, and the ball should hide until the new page's
    // words have been measured and the reader reaches the first one.
    wordLayoutsRef.current = new Map();
    currentWordIndexRef.current = -1;
    ballOpacity.value = 0;
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
      // Already advanced the page for THIS utterance — ignore the rest of it
      // (a later partial, or the eventual final, repeating the same "next
      // page" phrase plus whatever else was said) rather than aligning its
      // leftover words against the page we just turned to. Only clears once
      // the utterance actually ends.
      if (nextPageFiredRef.current) {
        if (isFinal) nextPageFiredRef.current = false;
        return;
      }
      const lang = langRef.current;
      if (text.toLowerCase().includes(NEXT_PAGE_PHRASES[lang])) {
        nextPageFiredRef.current = true;
        goNext();
        if (isFinal) nextPageFiredRef.current = false;
        return;
      }
      const page = pageRef.current;
      if (page) {
        const ocrLower = page.ocrText.toLowerCase();
        const tokens = tokenize(page.ocrText);
        const words = text.toLowerCase().split(/\s+/).filter(Boolean);
        for (const word of words) {
          // Short/common words (a, the, in, и, в...) match too many spots to
          // align against alone — see ALIGN_MIN_WORD_LENGTH above.
          if (word.length < ALIGN_MIN_WORD_LENGTH) continue;
          const from = readCursorRef.current;
          const idx = findWordFrom(ocrLower, word, from);
          if (idx < 0 || idx > from + ALIGN_LOOKAHEAD) continue; // not found nearby — skip, don't jump wildly
          const newCursor = idx + word.length;
          // If this same word occurs AGAIN shortly after, we can't be sure
          // which occurrence was actually just heard — a single recognized
          // word is ambiguous evidence either way. Firing every queued cue
          // all the way back to the old cursor in that case was the "two
          // identical words nearby -> a burst of every sound in between"
          // bug: instead, only fire the cue(s) sitting AT this occurrence
          // itself, and let the earlier ones fire (as normal) if their own
          // trigger words get recognized directly.
          const nextSame = findWordFrom(ocrLower, word, newCursor);
          const ambiguous = nextSame >= 0 && nextSame <= from + ALIGN_LOOKAHEAD;
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
        }
        // One state update per recognized result (not per word) — enough to
        // re-render the read-so-far highlight without spamming setState.
        setReadCursor(readCursorRef.current);
      }
      if (isFinal) nextPageFiredRef.current = false;
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
    // mass 0.85 (default 1) — 15% less inertia so the hop settles a touch
    // quicker/snappier instead of floating into place.
    ballX.value = withSpring(pos.x + pos.width / 2 - BALL_SIZE / 2, { damping: 16, stiffness: 180, mass: 0.85 });
    ballY.value = withSpring(pos.y - BALL_SIZE - 6, { damping: 16, stiffness: 180, mass: 0.85 });
    ballOpacity.value = withTiming(1, { duration: 150 });
    return true;
  }

  function onWordLayout(index: number, e: LayoutChangeEvent) {
    const { x, y, width, height } = e.nativeEvent.layout;
    wordLayoutsRef.current.set(index, { x, y, width, height });
    if (currentWordIndexRef.current === index) positionBallAt(index);
  }

  // Re-targets the ball whenever the read cursor advances (or rewinds) to a
  // different "current" word — the last non-space token already behind the
  // cursor, same word the karaoke highlight just caught up to.
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const toks = tokenize(page.ocrText);
    let idx = -1;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (!t.isSpace && t.end <= readCursor) idx = i;
    }
    currentWordIndexRef.current = idx;
    if (idx < 0 || !positionBallAt(idx)) {
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
    // Invert positionBallAt's own offset to recover an approximate
    // word-center point from where the ball itself was dropped.
    const dropCenterX = x + BALL_SIZE / 2;
    const dropTopY = y + BALL_SIZE + 6;
    const idx = findClosestWordIndex(dropCenterX, dropTopY);
    if (idx < 0) {
      if (currentWordIndexRef.current >= 0) positionBallAt(currentWordIndexRef.current);
      ballBounce.value = withRepeat(withTiming(1, { duration: 320 }), -1, true);
      return;
    }
    const toks = tokenize(page.ocrText);
    const token = toks[idx];
    if (token) moveReadCursorTo(token);
    ballBounce.value = withRepeat(withTiming(1, { duration: 320 }), -1, true);
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

  const ballStyle = useAnimatedStyle(() => ({
    opacity: ballOpacity.value,
    transform: [{ translateX: ballX.value }, { translateY: ballY.value - ballBounce.value * 12 }],
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
            <View style={styles.flowWrap}>
              <GestureDetector gesture={ballDragGesture}>
                <Animated.View style={[styles.ball, ballStyle]} />
              </GestureDetector>
              {tokens.map((t, i) => {
                // Karaoke-style read-so-far highlight — driven by the same
                // speech-alignment cursor that fires cues, so it tracks
                // exactly as far as recognized speech has actually reached.
                const isRead = !t.isSpace && t.end <= readCursor;
                if (t.isSpace) {
                  // A literal line break in the OCR text (a page-photo's own
                  // line, not just a run of spaces) forces a wrap here too —
                  // a flex-wrap row of per-word chips doesn't otherwise know
                  // about newlines the way a single native Text block did.
                  if (t.text.includes('\n')) return <View key={i} style={styles.lineBreak} />;
                  return (
                    <Text key={i} style={[styles.flowText, { color: textColor }]}>
                      {t.text}
                    </Text>
                  );
                }
                const cue = cueAtRange(cues, t.start, t.end);
                const active = cue && cue.reviewState !== 'removed' && !!cue.soundId;
                if (!active) {
                  return (
                    <Text
                      key={i}
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
                }
                const firing = firingToken === i;
                return (
                  <Text
                    key={i}
                    onLayout={(e) => onWordLayout(i, e)}
                    onPress={() => {
                      fireCue(cue!, i);
                      moveReadCursorTo(t);
                    }}
                    style={[
                      styles.flowText,
                      styles.cueWord,
                      {
                        // Already-spoken cue words get a touch more opacity —
                        // same blue, just a bit bolder — so the highlight
                        // still reads consistently across cue and plain text.
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
              })}
            </View>
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
  // marginTop leaves headroom above the first line for the ball to bounce
  // into without clipping against the container's own top edge.
  // rowGap/marginTop leave enough headroom above EVERY line (not just the
  // first) for the bigger ball plus its bounce to sit between lines without
  // overlapping the line above.
  flowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    position: 'relative',
    marginTop: 54,
    rowGap: 54,
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
