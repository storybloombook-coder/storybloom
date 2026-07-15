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
// Reaching the end offers "Read again" or "Done" — no separate approval step.

import { createAudioPlayer, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TactileButton from '../../components/TactileButton';
import { playFull, playLooping, playRange, playRangeLooping } from '../../lib/audio/playRange';
import { resolveSoundSource } from '../../lib/audio/soundResolver';
import { getBook, getCuesForBook, getPagesForBook } from '../../lib/db';
import { cueAtRange, tokenize } from '../../lib/reader/text';
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
// cursor (and cue-firing) far down the page.
const ALIGN_LOOKAHEAD = 180;

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
  const recognizerRef = useRef<ReturnType<typeof createVoskRecognizer> | null>(null);
  // Kept fresh every render (see the no-deps effect below) so the ONE
  // long-lived onResult subscription (registered once, kept running across
  // page turns so listening never gaps) always aligns against the CURRENT
  // page/cues instead of whatever they were when it was first registered.
  const pageRef = useRef<Page | null>(null);
  const cuesRef = useRef<Cue[]>([]);
  const langRef = useRef<SpeechLang>('en');
  const handleResultRef = useRef<(text: string) => void>(() => {});
  const readCursorRef = useRef(0);
  const firedCueIdsRef = useRef<Set<string>>(new Set());

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
    setReadCursor(0);
  }, [index, storyPages, cuesByPage]);

  useEffect(() => {
    langRef.current = (book?.language as SpeechLang) ?? 'en';
  }, [book]);

  // Re-pointed every render (cheap — just a ref write) so the ONE persistent
  // onResult subscription below always calls into fresh state/closures
  // (goNext, fireCue) without needing to tear down and re-register the
  // recognizer — which would gap the listening across every page turn.
  useEffect(() => {
    handleResultRef.current = (text: string) => {
      const lang = langRef.current;
      if (text.toLowerCase().includes(NEXT_PAGE_PHRASES[lang])) {
        goNext();
        return;
      }
      const page = pageRef.current;
      if (!page) return;
      const ocrLower = page.ocrText.toLowerCase();
      const tokens = tokenize(page.ocrText);
      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      for (const word of words) {
        const from = readCursorRef.current;
        const idx = findWordFrom(ocrLower, word, from);
        if (idx < 0 || idx > from + ALIGN_LOOKAHEAD) continue; // not found nearby — skip, don't jump wildly
        const newCursor = idx + word.length;
        for (const cue of cuesRef.current) {
          if (cue.reviewState === 'removed' || !cue.soundId || cue.charStart == null) continue;
          if (firedCueIdsRef.current.has(cue.id)) continue;
          if (cue.charStart >= from && cue.charStart < newCursor) {
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
        onPartial: () => {},
        onResult: (text) => handleResultRef.current(text),
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
          onPartial: () => {},
          onResult: (text) => handleResultRef.current(text),
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
    const source = resolveSoundSource(cue.soundId);
    if (!source) return; // missing asset — the readiness gate flags these up front
    stopCue();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setFiringToken(tokenIndex);
    const player = createAudioPlayer(source);
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
            <Text style={[styles.flow, { color: textColor }]}>
              {tokens.map((t, i) => {
                // Karaoke-style read-so-far highlight — driven by the same
                // speech-alignment cursor that fires cues, so it tracks
                // exactly as far as recognized speech has actually reached.
                const isRead = !t.isSpace && t.end <= readCursor;
                if (t.isSpace) return <Text key={i}>{t.text}</Text>;
                const cue = cueAtRange(cues, t.start, t.end);
                const active = cue && cue.reviewState !== 'removed' && !!cue.soundId;
                if (!active) {
                  return (
                    <Text
                      key={i}
                      style={isRead ? [styles.readWord, { color: textColor }] : { color: textColor }}
                    >
                      {t.text}
                    </Text>
                  );
                }
                const firing = firingToken === i;
                return (
                  <Text
                    key={i}
                    onPress={() => fireCue(cue!, i)}
                    style={[
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
            </Text>
          ) : (
            <Text style={[styles.noText, { color: subColor }]}>No text on this page — just turn the page.</Text>
          )}
          <Text style={[styles.hint, { color: subColor }]}>Tap a highlighted word to play its sound.</Text>
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
  flow: { fontSize: 22, lineHeight: 36 },
  cueWord: { borderRadius: 5, overflow: 'hidden' },
  // The karaoke-style "already spoken" highlight for plain (non-cue) words.
  readWord: { backgroundColor: 'rgba(255,213,79,0.35)', borderRadius: 3 },
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
