// SoundLibraryMenu.jsx — the "My Recordings"-style menu behind the new
// musical-note button (SOUND_SPEC.md §2). Lists every fixed sound slot
// grouped by category (collapsed by default, tap a category to expand);
// MUTE toggles whether this slot ever plays in the scene (every slot starts
// muted), PLAY always previews audibly regardless of that mute state (loop
// slots toggle a real looping preview, one-shots just play once), RECORD
// runs the mandatory 3-2-1 countdown then hard-stops at that slot's own
// durationMs (SOUND_SPEC.md §3) -- except `unlimited` slots (My Ambience),
// which show a manual Stop button instead. RESET drops the user's recording
// back to the procedural default. The list itself is read-only structure:
// no add/remove, ever.
//
// Every action button is a TactileButton (round, shadowed, press-scale +
// haptic) rather than a plain Pressable -- live feedback: the old flat
// Pressable circles read as polygonal (Android's elevation shadow doesn't
// reliably follow borderRadius on a single unclipped layer) and had no
// click feedback. TactileButton's own two-layer structure (an unclipped
// outer Pressable carrying the shadow, an overflow:hidden inner View
// carrying the fill) fixes both at once.

import { memo, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet, Switch, PanResponder,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, interpolate,
} from 'react-native-reanimated';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  createAudioPlayer,
} from 'expo-audio';
import {
  CATEGORIES,
  getSlotsByCategory,
  getSlotDefinition,
  getSlotLabelKey,
  isSlotOverridden,
  getSlotTrim,
  getSlotUri,
  getSlotVolume,
  setSlotVolume,
  isSlotMuted,
  setSlotMuted,
  setAllSlotsMuted,
  isAnySlotUnmuted,
  previewSlotLoop,
  setAmbienceSuspended,
  stopPreviewSlotLoop,
  resetSlotToDefault,
  saveRecordingForSlot,
} from './services/soundLibrary';
import { TactileButton } from './TactileButton';
import { t } from './config/strings';

const COUNTDOWN_START = 3;
const GLOW_HALF_MS = 400;

// Every non-ambient slot now records a fixed 20s take and the user picks the
// piece they want out of it afterwards, rather than the recording being
// hard-cut at the slot's own (often very short) target length.
const SEGMENT_MS = 20000;
const WAVEFORM_BARS = 56;
// Metering sample interval while recording. 60ms gives ~330 samples across a
// full 20s take -- comfortably more than WAVEFORM_BARS, so every bar has
// several samples to take its peak from even on a short take.
const METER_POLL_MS = 60;
// ~12fps for playback position. Fast enough that a 2s clip's bar moves
// smoothly, slow enough that it costs nothing -- and it only ever
// re-renders the bar itself, never the menu.
const PROGRESS_POLL_MS = 80;
/** Shortest the pop-up player will stay open for. Loading a file into the
 *  player is asynchronous, so a window shorter than that load can close
 *  before anything is heard -- see startPlayerAt. */
const MIN_PLAY_WINDOW_MS = 700;

/** Buckets raw 0..1 amplitude samples down to WAVEFORM_BARS peaks, then
 *  normalizes to the loudest bar so a quiet take still shows shape. Falls
 *  back to a flat low strip when there's nothing usable (a silent take, or
 *  metering unavailable) -- the window is still positionable by ear with the
 *  play button, which beats a blank box that reads as broken. */
function buildWaveform(peaks) {
  const bars = new Array(WAVEFORM_BARS).fill(0);
  for (let i = 0; i < peaks.length; i += 1) {
    const bucket = Math.min(WAVEFORM_BARS - 1, Math.floor((i / peaks.length) * WAVEFORM_BARS));
    if (peaks[i] > bars[bucket]) bars[bucket] = peaks[i];
  }
  const max = Math.max(...bars);
  if (max > 0) for (let i = 0; i < bars.length; i += 1) bars[i] /= max;
  else bars.fill(0.22);
  return bars;
}

function formatSeconds(ms) {
  return (ms / 1000).toFixed(2);
}

// The `sound.slot.dialogue.*` labels (strings.js) are deliberately short
// previews (e.g. 'Narrator: "Grandma mixed a little dough..."') so they fit
// a single list row -- they are NOT what the scene actually says. This maps
// each dialogue slot back to the real full-text i18n key the scene plays
// (StoryDirector's NARRATION_SOUND_SLOT / EncounterDirector's
// LINE_SOUND_SLOT, inverted) so both the row's "read full phrase" icon and
// the recording popup can show the user the exact line they're voicing.
const DIALOGUE_FULL_TEXT_KEY = {
  'dialogue.kolobokSong': 'song.full',
  'dialogue.hareEat': 'line.eat.hare',
  'dialogue.wolfEat': 'line.eat.wolf',
  'dialogue.bearEat': 'line.eat.bear',
  'dialogue.foxFlatter': 'line.fox.flatter',
  'dialogue.foxCloser': 'story.fox.closer',
  'dialogue.grandmaTap': 'line.grandma.tap',
  'dialogue.bake1': 'story.bake1',
  'dialogue.bake1b': 'story.bake1b',
  'dialogue.bake2': 'story.bake2',
  'dialogue.bragGrandma': 'story.brag.grandma',
  'dialogue.bragHare': 'story.brag.hare',
  'dialogue.bragWolf': 'story.brag.wolf',
  'dialogue.bragBear': 'story.brag.bear',
  'dialogue.foxIntro': 'story.fox.intro',
  'dialogue.snap': 'story.snap',
  'dialogue.rebirth': 'story.rebirth',
  'dialogue.eggRebirth': 'story.egg.rebirth',
};

function SlotRow({
  slotId, locale, onPlay, onRecord, onReset, onToggleMute, onShowFullPhrase, busy, recording, previewing, refreshTick,
}) {
  // refreshTick is unused directly -- its only job is to be a changing prop
  // so this row re-renders (and re-reads the manifest) after a save/reset/
  // mute-toggle, since isSlotOverridden/isSlotMuted read a plain in-memory
  // cache rather than a React/zustand store.
  const overridden = isSlotOverridden(slotId);
  const muted = isSlotMuted(slotId);
  const slot = getSlotDefinition(slotId);
  const labelKey = getSlotLabelKey(slotId);
  const label = t(labelKey, locale);
  const fullPhraseKey = DIALOGUE_FULL_TEXT_KEY[slotId];
  // Live feedback: "no need for a prompt regarding sound duration" for
  // unlimited (My Ambience) slots -- durationMs there is only the
  // procedural default's own loop length, not a recording target, so
  // showing it here would read as a duration limit that doesn't exist.
  const durationLabel = slot.unlimited ? null : `${formatSeconds(slot.durationMs)}${t('sound.unit.seconds', locale)}`;

  // Live feedback: "when recording finishes, the record button should be
  // back to idle -- now it's red after recording." Pulses the dot's own
  // opacity while capturing -- the animated style is only ever IN the style
  // array while `recording` is true (`recording && pulseStyle`), so there's
  // no static-vs-animated swap that could leave a stale value looking
  // "stuck"; once recording ends the array entry is simply gone and the
  // icon's normal, fully-opaque color applies again.
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!recording) {
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(
      withSequence(withTiming(1, { duration: GLOW_HALF_MS }), withTiming(0, { duration: GLOW_HALF_MS })),
      -1,
      false,
    );
  }, [recording, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.35, 0.85]),
  }));

  return (
    <View style={styles.row}>
      <View style={styles.rowLabelWrap}>
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
        {fullPhraseKey && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('sound.action.readFullPhrase', locale)}
            hitSlop={10}
            disabled={busy}
            onPress={() => onShowFullPhrase(fullPhraseKey)}
          >
            <Text style={styles.infoIcon}>ⓘ</Text>
          </Pressable>
        )}
        {durationLabel && <Text style={styles.rowDuration}>{durationLabel}</Text>}
        <View style={[styles.badge, overridden && styles.badgeCustom]}>
          <Text style={[styles.badgeText, overridden && styles.badgeTextCustom]}>
            {t(overridden ? 'sound.badge.custom' : 'sound.badge.default', locale)}
          </Text>
        </View>
      </View>
      <View style={styles.rowActions}>
        <TactileButton
          accessibilityRole="button"
          accessibilityLabel={`${t(muted ? 'sound.action.unmute' : 'sound.action.mute', locale)}: ${label}`}
          hitSlop={8}
          style={styles.actionBtnOuter}
          innerStyle={styles.actionBtnInner}
          disabled={busy}
          onPress={() => onToggleMute(slotId)}
        >
          <Text style={styles.actionIcon}>{muted ? '🔇' : '🔊'}</Text>
        </TactileButton>
        <TactileButton
          accessibilityRole="button"
          accessibilityLabel={`${t('sound.action.play', locale)}: ${label}`}
          hitSlop={8}
          style={styles.actionBtnOuter}
          innerStyle={styles.actionBtnInner}
          disabled={busy}
          onPress={() => onPlay(slotId)}
        >
          <Text style={styles.actionIcon}>{previewing ? '⏹' : '▶'}</Text>
        </TactileButton>
        <TactileButton
          accessibilityRole="button"
          accessibilityLabel={`${t('sound.action.record', locale)}: ${label}`}
          hitSlop={8}
          style={styles.actionBtnOuter}
          innerStyle={styles.actionBtnInner}
          disabled={busy}
          onPress={() => onRecord(slotId)}
        >
          <Animated.Text style={[styles.actionIcon, styles.recordIcon, recording && pulseStyle]}>●</Animated.Text>
        </TactileButton>
        {overridden && (
          <TactileButton
            accessibilityRole="button"
            accessibilityLabel={`${t('sound.action.reset', locale)}: ${label}`}
            hitSlop={8}
            style={styles.actionBtnOuter}
            innerStyle={styles.actionBtnInner}
            disabled={busy}
            onPress={() => onReset(slotId)}
          >
            <Text style={styles.actionIcon}>↺</Text>
          </TactileButton>
        )}
      </View>
    </View>
  );
}

/** The live mm:ss readout during capture, deliberately its OWN component.
 *  Live feedback: "the recording timer is lagging." It was ticking state on
 *  the whole SoundLibraryMenu ~33x/second, and since SlotRow isn't memoized
 *  that re-rendered every expanded category and every row underneath the
 *  popup on every tick -- tens of components per frame, purely to repaint
 *  one number. Isolating it here means a tick re-renders exactly this one
 *  <Text>. The displayed value is derived from wall-clock `startedAt`
 *  rather than an accumulator, so a late/dropped tick self-corrects instead
 *  of the clock permanently falling behind. */
function RecordingTimer({ startedAt, durationMs, unlimited, locale, style }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 50);
    return () => clearInterval(id);
  }, []);
  const elapsedMs = Math.max(0, nowMs - startedAt);
  const shownMs = unlimited ? elapsedMs : Math.max(0, durationMs - elapsedMs);
  return <Text style={style}>{formatSeconds(shownMs)}{t('sound.unit.seconds', locale)}</Text>;
}

/** The trim strip: a waveform of the whole 20s take with a fixed-width
 *  window over it, dragged left/right to choose which part of the take
 *  becomes this slot's sound. The window's width is the slot's own target
 *  duration, so it can't be resized -- only positioned, which is what makes
 *  every slot come out exactly the length the scene expects. */
/** A scrub bar: filled progress, a draggable knob, and a live position that
 *  tracks playback. Isolated as its own component so the position tick
 *  re-renders this alone rather than the whole menu -- the same reason
 *  RecordingTimer and TrimBars are split out. */
function PlayheadBar({
  player, startMs, durationMs, playing, onSeek,
}) {
  const [posMs, setPosMs] = useState(0);
  const [width, setWidth] = useState(0);
  const [scrubMs, setScrubMs] = useState(null);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      try {
        setPosMs(Math.max(0, player.currentTime * 1000 - startMs));
      } catch { /* released */ }
    }, PROGRESS_POLL_MS);
    return () => clearInterval(id);
  }, [player, startMs, playing]);

  const liveRef = useRef(null);
  useEffect(() => { liveRef.current = { width, durationMs, onSeek }; });

  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (e) => {
      const l = liveRef.current;
      if (!l?.width) return;
      setScrubMs(Math.max(0, Math.min(1, e.nativeEvent.locationX / l.width)) * l.durationMs);
    },
    onPanResponderRelease: (e) => {
      const l = liveRef.current;
      if (!l?.width) return;
      const ms = Math.max(0, Math.min(1, e.nativeEvent.locationX / l.width)) * l.durationMs;
      setScrubMs(null);
      setPosMs(ms);
      l.onSeek(ms);
    },
  }));

  const shown = scrubMs ?? posMs;
  const frac = Math.max(0, Math.min(1, shown / Math.max(1, durationMs)));

  return (
    <View
      style={styles.scrubTrack}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={[styles.scrubFill, { width: `${frac * 100}%` }]} />
      {width > 0 && (
        <View pointerEvents="none" style={[styles.scrubKnob, { left: Math.max(0, frac * width - 8) }]} />
      )}
    </View>
  );
}

/** The bars alone, memoized on `waveform`. Live feedback: "bar movement
 *  lags." Dragging updates startMs on every move event, and the bars used to
 *  recolor themselves from it -- so all WAVEFORM_BARS re-rendered with fresh
 *  style arrays many times a second, which is what made the window stutter.
 *  Split out and independent of startMs, they render exactly once per take;
 *  a drag then only moves the three small overlay views. Heights are in
 *  pixels off the measured strip rather than percentages, which resolve
 *  unreliably for children of an absolutely-positioned flex row. */
const TrimBars = memo(function TrimBars({ waveform, height }) {
  return (
    <View style={styles.trimBars} pointerEvents="none">
      {waveform.map((v, i) => (
        <View
          key={i}
          style={[styles.trimBar, { height: Math.max(3, v * (height - 12)) }]}
        />
      ))}
    </View>
  );
});

/** Playhead line over the trim strip while a preview runs. Its own component
 *  for the same reason as everything else here: the tick must not re-render
 *  the bars or the parent. */
function TrimPlayhead({ player, takeMs, playing }) {
  const [atMs, setAtMs] = useState(0);
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      try { setAtMs(player.currentTime * 1000); } catch { /* released */ }
    }, PROGRESS_POLL_MS);
    return () => clearInterval(id);
  }, [player, playing]);
  if (!playing) return null;
  const frac = Math.max(0, Math.min(1, atMs / Math.max(1, takeMs)));
  return <View pointerEvents="none" style={[styles.trimPlayhead, { left: `${frac * 100}%` }]} />;
}

/** The balancer's track. Half its first width — it stands beside the waveform
 *  now, where a fat bar crowded it. */
const VOLUME_BAR_W = 17;
const VOLUME_DOT = 19;
/** Track height, matching the waveform it stands beside. FIXED on purpose:
 *  the dot travels a constant bar, rather than the bar resizing under it. */
const VOLUME_BAR_H = 72;
/** Setting a native player's volume is a bridge call; at touch rate that's
 *  the expensive part of the drag. 40ms is faster than anyone hears a step
 *  and roughly a third of the calls. */
const AUDIO_THROTTLE_MS = 40;
/** Padding around the visible bar that still counts as touching it. The bar
 *  is 17px wide; a target that small is genuinely hard to hit, so the column
 *  carrying the gesture is 44 wide with room above and below too. */
const VOLUME_TOUCH_W = 44;
const VOLUME_TOUCH_PAD = 14;

/** Vertical level control: drag the dot up for louder, down for quieter.
 *
 *  Vertical rather than the horizontal sliders elsewhere in this file because
 *  that's the direction volume runs everywhere else — a mixer fader, a phone's
 *  own volume keys. Up is more.
 *
 *  Reports continuously while dragging (so what you hear tracks your thumb)
 *  and once more on release (which is what gets written to the manifest) —
 *  the same split TrimStrip uses, for the same reason: persisting every frame
 *  of a drag would write the file dozens of times per gesture. */
function VolumeBar({ slotId, player, locale, onCommit }) {
  // Seeded from the SLOT, not from a prop mirrored in the parent's state.
  // One source of truth: the manifest. The parent keys this component by
  // slotId, so opening a different sound remounts it and it reads that
  // sound's own level — there's no window in which a level from the last
  // sound could be shown against this one.
  const level = useSharedValue(getSlotVolume(slotId));
  // Position lives on the UI thread. The first version put it in React state
  // and setState'd on every PanResponder move — a full re-render per touch
  // event, plus a native volume write, which is what made the drag lag the
  // thumb. Now the fill and the dot animate off a shared value and React
  // hears about the level exactly once, on release.
  const grantRef = useRef(1);
  const lastAudioAtRef = useRef(0);
  const liveRef = useRef({ player, onCommit, slotId });
  liveRef.current = { player, onCommit, slotId };

  const applyAudio = (v, force) => {
    const now = Date.now();
    if (!force && now - lastAudioAtRef.current < AUDIO_THROTTLE_MS) return;
    lastAudioAtRef.current = now;
    try {
      liveRef.current.player.volume = v;
    } catch {
      // Player already released — the chosen level is still kept.
    }
  };

  const clamp = (v) => Math.max(0, Math.min(1, v));
  /** A tap lands the level where the finger is. locationY is relative to the
   *  padded TOUCH column, so the pad comes off before mapping onto the track;
   *  the track's own height is a constant, so nothing has to be measured and
   *  there's no window where a stale measurement gives a wrong level. */
  const fromTouch = (locationY) => clamp(1 - (locationY - VOLUME_TOUCH_PAD) / VOLUME_BAR_H);

  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const v = fromTouch(e.nativeEvent.locationY);
      grantRef.current = v;
      level.value = v;
      applyAudio(v, true);
    },
    // The DRAG works off gestureState.dy from where the finger landed, not
    // off locationY per event. locationY is reported relative to whichever
    // view handled that particular touch, which during a fast drag isn't
    // reliably this one — the level jumped around instead of following the
    // thumb. A delta from the grant point can't do that. Up is negative dy,
    // and up means louder.
    onPanResponderMove: (_e, g) => {
      const v = clamp(grantRef.current - g.dy / VOLUME_BAR_H);
      level.value = v; // UI thread; no render
      applyAudio(v, false);
    },
    onPanResponderRelease: (_e, g) => {
      const v = clamp(grantRef.current - g.dy / VOLUME_BAR_H);
      level.value = v;
      applyAudio(v, true);
      liveRef.current.onCommit(liveRef.current.slotId, v);
    },
    onPanResponderTerminate: () => {
      liveRef.current.onCommit(liveRef.current.slotId, level.value);
    },
  }));

  // Filled portion grows from the BOTTOM, so the bar reads as a level rather
  // than a progress bar running the other way.
  const fillStyle = useAnimatedStyle(() => ({ height: `${level.value * 100}%` }));
  const dotStyle = useAnimatedStyle(() => ({ bottom: `${level.value * 100}%` }));

  // The thing you touch is deliberately much bigger than the thing you see.
  // A 17px-wide strip is well under any usable target size, and the dot
  // can't be one itself (it has to stay pointerEvents:none, or the finger
  // that grabs it reports coordinates relative to the DOT instead of the
  // track). So an invisible column carries the gesture, and the slim bar
  // just draws inside it.
  return (
    <View
      style={styles.volumeTouch}
      accessibilityRole="adjustable"
      accessibilityLabel={t('sound.action.balance', locale)}
      {...pan.panHandlers}
    >
      <View style={styles.volumeTrack} pointerEvents="none">
        <Animated.View style={[styles.volumeFill, fillStyle]} />
        <Animated.View style={[styles.volumeDot, dotStyle]} />
      </View>
    </View>
  );
}

/** Shortest window a range drag can squeeze to, so the two handles can never
 *  meet and leave a zero-length clip. */
const MIN_RANGE_MS = 500;

function TrimStrip({
  waveform, startMs, durMs, takeMs, locale, player, playing, onChangeStart,
  // `range` gives the strip TWO handles instead of one sliding window. Fixed
  // slots have a target length, so their window is a constant width you move;
  // an unlimited take (My Ambience) has no target, so both edges are yours.
  range = false,
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Live feedback (round 2): "sliding the piece of sound still feels laggy."
  // Memoizing the bars wasn't enough, because the position itself lived in
  // the PARENT -- so every move event re-rendered the whole menu: the
  // ScrollView, every expanded category, every SlotRow underneath the popup.
  // The drag now moves purely local state, and the parent is told only on
  // release. A move re-renders this component alone, and the bars inside it
  // are memoized away, so it comes down to three small views and a label.
  // Keyed on takeMs via the parent (see the <TrimStrip key=...>), so a new
  // take remounts this component and the initial value is simply the seed --
  // no effect syncing a prop into state, and no cascading render.
  const [localStart, setLocalStart] = useState(startMs);
  // Range mode (My Ambience) drags TWO edges, because an unlimited take has
  // no target length to slide a fixed window along — the window IS whatever
  // you choose. localEnd is only meaningful when `range` is set.
  const [localEnd, setLocalEnd] = useState(() => Math.min(takeMs, startMs + durMs));
  const effEnd = range ? localEnd : Math.min(takeMs, localStart + durMs);

  const liveRef = useRef(null);
  useEffect(() => {
    liveRef.current = {
      start: localStart, end: effEnd, range, width: size.width, durMs, takeMs, onChangeStart,
    };
  });
  const dragOriginRef = useRef(0);
  const dragEndOriginRef = useRef(0);
  const grabbedRef = useRef('start');

  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const l = liveRef.current;
      dragOriginRef.current = l?.start ?? 0;
      dragEndOriginRef.current = l?.end ?? 0;
      // Range mode: whichever edge the finger landed nearer is the one it
      // moves. A fixed-length slot has only one edge to drag, so it always
      // grabs the start.
      if (l?.range && l.width) {
        const x = e.nativeEvent.locationX;
        const span = Math.max(1, l.takeMs);
        const startX = l.width * (l.start / span);
        const endX = l.width * (l.end / span);
        grabbedRef.current = Math.abs(x - startX) <= Math.abs(x - endX) ? 'start' : 'end';
      } else {
        grabbedRef.current = 'start';
      }
    },
    onPanResponderMove: (_e, g) => {
      const l = liveRef.current;
      if (!l?.width || !l.takeMs) return;
      const deltaMs = (g.dx / l.width) * l.takeMs;
      if (!l.range) {
        // Fixed window: the whole selection slides, its width is the slot's.
        const maxStart = Math.max(0, l.takeMs - l.durMs);
        setLocalStart(Math.max(0, Math.min(maxStart, dragOriginRef.current + deltaMs)));
        return;
      }
      // Range: the grabbed edge moves alone, and can't cross the other one
      // or squeeze the window below MIN_RANGE_MS.
      if (grabbedRef.current === 'start') {
        const limit = l.end - MIN_RANGE_MS;
        setLocalStart(Math.max(0, Math.min(limit, dragOriginRef.current + deltaMs)));
      } else {
        const limit = l.start + MIN_RANGE_MS;
        setLocalEnd(Math.min(l.takeMs, Math.max(limit, dragEndOriginRef.current + deltaMs)));
      }
    },
    // Commit to the parent once, at the end of the gesture -- that's all
    // Confirm needs, and it keeps the expensive tree out of the drag.
    onPanResponderRelease: () => {
      const l = liveRef.current;
      if (l) l.onChangeStart(l.start, l.range ? l.end : undefined);
    },
  }));

  // Everything is a fraction of the REAL take length, not the 20s ceiling --
  // stopping early has to give a strip that spans only what was recorded.
  const span = Math.max(1, takeMs);
  const selLeft = size.width * (localStart / span);
  const selWidth = Math.max(12, size.width * Math.min(1, (effEnd - localStart) / span));

  return (
    <>
    <View
      style={styles.trimStrip}
      onLayout={(e) => setSize({
        width: e.nativeEvent.layout.width,
        height: e.nativeEvent.layout.height,
      })}
      {...pan.panHandlers}
    >
      {size.height > 0 && <TrimBars waveform={waveform} height={size.height} />}
      {size.width > 0 && (
        <>
          {/* Dim what falls outside the window, so the selection reads
              without the bars themselves needing to know about it. */}
          <View pointerEvents="none" style={[styles.trimMask, { left: 0, width: selLeft }]} />
          <View
            pointerEvents="none"
            style={[styles.trimMask, { left: selLeft + selWidth, right: 0 }]}
          />
          <View pointerEvents="none" style={[styles.trimWindow, { left: selLeft, width: selWidth }]} />
          <TrimPlayhead player={player} takeMs={takeMs} playing={playing} />
        </>
      )}
    </View>
    {/* Readout lives here rather than in the parent so it tracks the drag
        live -- the parent only hears about the new position on release. */}
    <Text style={styles.trimReadout}>
      {formatSeconds(localStart)}
      {' – '}
      {formatSeconds(effEnd)}
      {t('sound.unit.seconds', locale)}
      {'  /  '}
      {formatSeconds(takeMs)}
      {t('sound.unit.seconds', locale)}
    </Text>
    </>
  );
}

export function SoundLibraryMenu({ visible, onClose, locale }) {
  // isMeteringEnabled is what makes getStatus().metering populated, which is
  // now the waveform's only source -- see the metering poll below.
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  // One player does double duty: muted at 2x for the amplitude scan, then at
  // normal volume/rate for previewing the chosen window. Created lazily and
  // kept for the menu's lifetime -- a second native player just to preview
  // isn't worth it.
  const [editPlayer] = useState(() => createAudioPlayer(null, { updateInterval: 100 }));

  const [flowSlotId, setFlowSlotId] = useState(null);
  // 'idle' | 'countdown' | 'recording' | 'trimming' | 'saved' | 'denied'
  const [phase, setPhase] = useState('idle');
  // The just-recorded 20s take, held un-saved until the user confirms a
  // window in the trim editor (or discards it).
  const [pendingUri, setPendingUri] = useState(null);
  const [waveform, setWaveform] = useState([]);
  const [trimStartMs, setTrimStartMs] = useState(0);
  // Only meaningful for unlimited (range) slots; 0 means "use the fixed
  // window" and the fixed path ignores it entirely.
  const [trimEndMs, setTrimEndMs] = useState(0);
  // Actual length of the take, which is SEGMENT_MS only when it ran to the
  // auto-stop -- pressing Stop early makes it shorter, and the trim strip
  // has to span what was really recorded.
  const [takeMs, setTakeMs] = useState(SEGMENT_MS);
  const [trimPlaying, setTrimPlaying] = useState(false);
  const trimStopRef = useRef(null);
  // Pop-up player: { slotId, startMs, durMs } while open, null when closed.
  const [playerSlot, setPlayerSlot] = useState(null);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const playerStopRef = useRef(null);
  const scanPeaksRef = useRef([]);
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  // Wall-clock instant capture actually began -- drives RecordingTimer.
  const [recordStartedAt, setRecordStartedAt] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  // Collapsed by default -- tap a category header to expand it.
  const [expanded, setExpanded] = useState({});
  // Which loop slot (if any) is currently toggled on for an audible preview
  // (PLAY on a loop slot starts/stops a real loop instead of a one-shot).
  const [previewingLoopId, setPreviewingLoopId] = useState(null);
  // i18n key of the full phrase currently shown in the "read full phrase"
  // overlay (see DIALOGUE_FULL_TEXT_KEY) -- null when the overlay is closed.
  const [fullPhraseKey, setFullPhraseKey] = useState(null);
  // Wall-clock instant the 3-2-1 countdown should hit zero. Every tick
  // re-derives the digit from this instead of counting down blindly, so
  // drift can't accumulate -- see the countdown effect below.
  const countdownEndRef = useRef(0);
  const isMountedRef = useRef(true);
  // Holds the in-flight (or already-resolved) session-setup promise kicked
  // off by handleRecord, awaited once the countdown reaches zero -- see its
  // own comment below for why this can't just run sequentially after.
  const prepareRef = useRef(Promise.resolve());

  const busy = phase !== 'idle';
  const canClose = phase !== 'countdown' && phase !== 'recording';
  const flowSlot = flowSlotId ? getSlotDefinition(flowSlotId) : null;
  // Re-read on every render; refreshTick changing is what re-runs this after
  // any mute edit, same as SlotRow's own manifest reads.
  const anyUnmuted = isAnySlotUnmuted();

  useEffect(() => () => { isMountedRef.current = false; }, []);

  // Hold the session in PLAYBACK mode for as long as the menu is open, and
  // borrow recording mode only for the duration of an actual take.
  //
  // This menu used to park the session in recording mode the whole time it
  // was open, to keep an OS-level category switch out of the 3s countdown.
  // But a record-capable session attenuates and re-routes playback, so
  // previewing a clip in the trim editor came out inaudible -- and preview
  // is now a core part of the flow, not an afterthought. The switch moves
  // back into the per-tap prep, which runs in PARALLEL with the countdown
  // (see prepareRef) rather than after it, so the countdown doesn't pay for
  // it the way it originally did.
  useEffect(() => {
    if (!visible) return undefined;
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    return () => {
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    };
  }, [visible]);

  // Countdown: 3 -> 2 -> 1 -> capture starts. Exactly three seconds, and
  // exactly three visible steps.
  //
  // Live feedback: "the countdown doesn't take 3 seconds for 3-2-1 and 1
  // extra second before the recording starts -- it feels wrong." Two
  // separate causes, both fixed here:
  //
  // 1. THE EXTRA STEP. This used to render a 4th state -- countdown 0 drew
  //    a '●' and only THEN awaited prepareRef before flipping to
  //    'recording'. That dot was a real, visible 4th beat of unbounded
  //    length. Now hitting zero starts capture directly; there is no zero
  //    state to draw.
  // 2. THE DRIFT. Three chained setTimeout(1000)s each start counting only
  //    once the previous one has fired AND React has re-rendered, so every
  //    tick's own lateness was permanently baked into the total -- and this
  //    modal renders over a live 3D scene, so ticks land late a lot. Now
  //    each tick re-derives the digit from a fixed wall-clock deadline and
  //    schedules itself to the NEXT digit boundary, so a late tick corrects
  //    itself instead of pushing the finish line back.
  useEffect(() => {
    if (phase !== 'countdown') return undefined;
    let cancelled = false;
    let timer = null;

    const tick = () => {
      if (cancelled) return;
      const remainingMs = countdownEndRef.current - Date.now();
      if (remainingMs > 0) {
        setCountdown(Math.max(1, Math.ceil(remainingMs / 1000)));
        // Sleep only until the digit actually changes, not a flat 1000ms.
        const toBoundary = remainingMs - Math.floor(remainingMs / 1000) * 1000;
        timer = setTimeout(tick, toBoundary || 1000);
        return;
      }
      (async () => {
        const result = await prepareRef.current;
        if (cancelled || !isMountedRef.current) return;
        if (!result?.granted) {
          // `failed` is a genuine setup error, not a refused permission --
          // showing the "microphone access needed" card there would be
          // actively misleading, so just drop back to the list.
          if (result?.failed) {
            setPhase('idle');
            setFlowSlotId(null);
          } else {
            setPhase('denied');
          }
          return;
        }
        // The day/night ambience is looping under this. Silence it before the
        // microphone opens, or it lands on the take -- and then plays back
        // over the very loop it was recorded from.
        setAmbienceSuspended(true);
        recorder.record();
        setRecordStartedAt(Date.now());
        setPhase('recording');
      })();
    };

    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const finishRecording = async () => {
    setAmbienceSuspended(false);
    try {
      await recorder.stop();
    } catch {
      // Same released-shared-object hazard as the unmount cleanup below --
      // if it's already gone there's nothing left to save.
      return;
    }
    // Hand the session straight back to playback: the trim editor opens
    // next and its Play button has to actually be audible. The next take
    // re-borrows recording mode in its own parallel prep.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    if (!isMountedRef.current || !flowSlotId) return;
    const uri = recorder.uri;
    if (!uri) { setPhase('idle'); setFlowSlotId(null); return; }
    const slot = getSlotDefinition(flowSlotId);
    // EVERY take goes to the trim editor now, ambient included. It used to
    // save unlimited slots whole, on the grounds that with no target length
    // there was nothing to trim TO — but that confused "no fixed window" with
    // "no trimming": a loop still wants its silent lead-in and its fumble at
    // the end taken off. Unlimited slots get a two-handle strip instead of a
    // fixed one (see TrimStrip's `range`), so the window IS whatever you pick.
    const takenMs = Math.max(1, Date.now() - recordStartedAt);
    setPendingUri(uri);
    setWaveform(buildWaveform(scanPeaksRef.current));
    setTakeMs(takenMs);
    setTrimStartMs(0);
    // The whole take to begin with, so confirming without touching anything
    // keeps exactly what was recorded — the old behaviour, as the default.
    setTrimEndMs(slot?.unlimited ? takenMs : 0);
    setPhase('trimming');
  };

  // Load the take into the preview player as soon as the editor opens.
  //
  // Live feedback: "I can't hear what's happening in the clip when I click
  // Play." replace() used to happen inside the post-record scan effect --
  // removing that scan (metering made it unnecessary) took the only place
  // the player was ever given a source with it, so Play was seeking and
  // playing an empty player. Doing it on entry also means the file is
  // decoded and ready before the first tap rather than during it.
  useEffect(() => {
    if (phase !== 'trimming' || !pendingUri) return undefined;
    try {
      editPlayer.loop = false;
      // At THIS slot's own level, not 1. A balancer that every preview path
      // resets is no balancer at all — it's why a sound set to zero still
      // played at full volume.
      editPlayer.volume = getSlotVolume(flowSlotId);
      editPlayer.setPlaybackRate(1);
      editPlayer.replace(pendingUri);
    } catch { /* released */ }
    return () => {
      if (trimStopRef.current) { clearTimeout(trimStopRef.current); trimStopRef.current = null; }
      try { editPlayer.pause(); } catch { /* released */ }
    };
    // flowSlotId is in here because the level read above is that slot's. In
    // practice it changes in the same commit as pendingUri, so this doesn't
    // re-run any more often than before.
  }, [phase, pendingUri, editPlayer, flowSlotId]);

  // Waveform capture, live during the take.
  //
  // Live feedback: "sound bar waveform is still not there." The previous
  // approach replayed the finished file through a muted player and read PCM
  // via useAudioSampleListener -- but that hook checks
  // isAudioSamplingSupported and silently subscribes to nothing where the
  // platform can't deliver frames, which is this device: the strip came out
  // flat every time. The recorder's own metering is always available, so
  // sampling it WHILE recording gives a real amplitude trace and, as a
  // bonus, removes the whole post-processing step -- the editor now opens
  // the instant recording stops. Polled through getStatus() into a ref
  // rather than useAudioRecorderState, which would re-render the entire menu
  // several times a second for a value nothing renders.
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    scanPeaksRef.current = [];
    const id = setInterval(() => {
      let db;
      try { db = recorder.getStatus().metering; } catch { return; }
      if (typeof db !== 'number' || Number.isNaN(db)) return;
      // dBFS -> 0..1. -50dB is a fair noise floor for a phone mic in a room;
      // quieter than that is indistinguishable from silence anyway.
      scanPeaksRef.current.push(Math.max(0, Math.min(1, (db + 50) / 50)));
    }, METER_POLL_MS);
    return () => clearInterval(id);
  }, [phase, recorder]);


  // Hard auto-stop at THIS slot's own target duration -- one-shots and
  // ambient loops alike (SOUND_SPEC.md §3's "hard cap, every slot" rule) --
  // except `unlimited` slots (My Ambience), which skip this entirely and
  // stop only via the manual Stop button (handleManualStop).
  useEffect(() => {
    if (phase !== 'recording' || !flowSlotId) return undefined;
    const slot = getSlotDefinition(flowSlotId);
    if (slot.unlimited) return undefined;
    // Fixed 20s take for every non-ambient slot now, not the slot's own
    // (often sub-second) target length -- the user picks the piece they want
    // out of it in the trim editor afterwards. Stoppable early via the Stop
    // button, which every slot now has rather than only ambient ones.
    const timer = setTimeout(() => finishRecording(), SEGMENT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, flowSlotId]);

  // Brief "Saved!" flash, then back to the list.
  useEffect(() => {
    if (phase !== 'saved') return undefined;
    const timer = setTimeout(() => {
      setPhase('idle');
      setFlowSlotId(null);
    }, 900);
    return () => clearTimeout(timer);
  }, [phase]);

  // Don't leave a live recording running if the menu unmounts mid-flow.
  // Live feedback: crashed on some 3D->2D transitions with "Cannot use
  // shared object that was already released" sourced to this exact effect
  // -- recorder's own native object can already be torn down by the time
  // this cleanup runs (the ordering between this plain passive effect and
  // whatever internal mechanism useAudioRecorder uses to release its native
  // handle isn't guaranteed), so touching it here must never throw
  // synchronously during unmount.
  useEffect(() => () => {
    // Whatever else happens on the way out, the ambience must not stay
    // suspended -- closing the menu mid-countdown would otherwise leave the
    // scene permanently silent with no way to get it back.
    setAmbienceSuspended(false);
    try {
      if (recorder.isRecording) recorder.stop().catch(() => {});
    } catch {
      // Already released -- nothing to stop.
    }
  }, [recorder]);

  // Don't leave a preview loop playing after the menu closes/unmounts.
  useEffect(() => () => {
    if (previewingLoopId) stopPreviewSlotLoop(previewingLoopId);
  }, [previewingLoopId]);

  // Release the scan/preview player's native handle on unmount. Same
  // already-released hazard as the recorder cleanup above, hence the guard.
  useEffect(() => () => {
    try { editPlayer.remove(); } catch { /* already released */ }
  }, [editPlayer]);

  /** Open the pop-up player on a slot: load it, seek to its trim window (so
   *  what you hear is exactly what the scene plays), and start. */
  const openPlayer = (slotId) => {
    const uri = getSlotUri(slotId);
    if (!uri) return;
    const trim = getSlotTrim(slotId);
    const slot = getSlotDefinition(slotId);
    const startMs = trim?.startMs ?? 0;
    const durMs = trim?.durMs ?? slot?.durationMs ?? 0;
    setPlayerSlot({ slotId, startMs, durMs });
    try {
      editPlayer.loop = false;
      // Same reason as the trim editor: the pop-up player is where you check
      // a sound, so it has to sound the way that sound will.
      editPlayer.volume = getSlotVolume(slotId);
      editPlayer.setPlaybackRate(1);
      editPlayer.replace(uri);
    } catch { /* released */ }
    startPlayerAt(startMs, durMs);
  };

  const stopPlayer = () => {
    if (playerStopRef.current) { clearTimeout(playerStopRef.current); playerStopRef.current = null; }
    try { editPlayer.pause(); } catch { /* released */ }
    setPlayerPlaying(false);
  };

  const startPlayerAt = (startMs, durMs) => {
    if (playerStopRef.current) { clearTimeout(playerStopRef.current); playerStopRef.current = null; }
    setPlayerPlaying(true);
    editPlayer.seekTo(startMs / 1000).then(() => {
      editPlayer.play();
      // Stop at the end of the slot's own window rather than the end of the
      // file -- a trimmed take still holds the whole 20s recording.
      //
      // Floored, because `replace()` loads asynchronously and this timer
      // starts the moment seekTo resolves, which can be before the file is
      // ready to make a sound. Every slot in the interactions bank is
      // 90-300ms (blips, plops, thuds), so the window closed on them before
      // they were audible at all -- they read as simply not playing. The
      // floor only holds the player open longer; the audio still ends when
      // it ends.
      if (durMs > 0) {
        playerStopRef.current = setTimeout(
          () => setPlayerPlaying(false),
          Math.max(durMs, MIN_PLAY_WINDOW_MS),
        );
      }
    }).catch(() => setPlayerPlaying(false));
  };

  const closePlayer = () => {
    stopPlayer();
    setPlayerSlot(null);
  };

  const handlePlay = (slotId) => {
    const slot = getSlotDefinition(slotId);
    if (slot?.loop) {
      if (previewingLoopId === slotId) {
        stopPreviewSlotLoop(slotId);
        setPreviewingLoopId(null);
      } else {
        if (previewingLoopId) stopPreviewSlotLoop(previewingLoopId);
        previewSlotLoop(slotId);
        setPreviewingLoopId(slotId);
      }
      return;
    }
    // One-shots open the pop-up player, which shows position on a scrub bar
    // and lets you seek. Loops keep the plain toggle above: they're seamless
    // ambience, so a position readout on one would be meaningless.
    openPlayer(slotId);
  };

  const handleToggleMute = (slotId) => {
    setSlotMuted(slotId, !isSlotMuted(slotId));
    setRefreshTick((v) => v + 1);
  };

  const handleToggleAll = (next) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (previewingLoopId) {
      stopPreviewSlotLoop(previewingLoopId);
      setPreviewingLoopId(null);
    }
    setAllSlotsMuted(!next);
    setRefreshTick((v) => v + 1);
  };

  /** Live feedback: "when the sound is recorded already and you tap record,
   *  redirect to the pop-up with the recorded sound so the piece can be
   *  adjusted or re-recorded." So record on a slot that already has a take
   *  reopens the editor on it rather than immediately overwriting it -- ↻
   *  inside the editor is then the deliberate way to start over. Only
   *  applies where there's a stored waveform to rebuild the strip from
   *  (ambient slots never get one, and neither do takes saved before this
   *  existed); those fall through to recording as usual. */
  const reopenExistingTake = (slotId) => {
    const trim = getSlotTrim(slotId);
    if (!trim?.waveform?.length || !trim.takeMs) return false;
    const uri = getSlotUri(slotId);
    if (!uri) return false;
    setFlowSlotId(slotId);
    setPendingUri(uri);
    setWaveform(trim.waveform);
    setTakeMs(trim.takeMs);
    setTrimStartMs(trim.startMs ?? 0);
    // Range slots restore the end they were saved with, so reopening shows
    // the window you chose rather than the whole take again.
    setTrimEndMs(getSlotDefinition(slotId)?.unlimited
      ? (trim.startMs ?? 0) + (trim.durMs ?? trim.takeMs)
      : 0);
    setPhase('trimming');
    return true;
  };

  const handleRecord = (slotId, { forceNew = false } = {}) => {
    if (!forceNew && reopenExistingTake(slotId)) return;
    if (previewingLoopId) {
      stopPreviewSlotLoop(previewingLoopId);
      setPreviewingLoopId(null);
    }
    setFlowSlotId(slotId);
    setCountdown(COUNTDOWN_START);
    countdownEndRef.current = Date.now() + COUNTDOWN_START * 1000;
    setPhase('countdown');
    // Live feedback: "the countdown before recording doesn't last 3
    // seconds, it's longer" -- requestRecordingPermissionsAsync used to be
    // awaited BEFORE any of the state above, so on a slow permission round
    // trip the popup itself wouldn't appear until part of the 3s had
    // already silently ticked away. Folding it into this same parallel prep
    // means nothing runs before the countdown is on screen. The audio-mode
    // switch itself no longer happens here at all -- see the visible-effect
    // above, which does it once for the whole time the menu is open --
    // leaving only prepareToRecordAsync() (cheap) in this per-tap path.
    prepareRef.current = (async () => {
      try {
        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted) return { granted: false };
        // Borrow recording mode for this take (see the visible-effect above
        // for why it isn't held open). In parallel with the countdown, so
        // the 3s isn't spent waiting on it.
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        // expo-audio REJECTS prepareToRecordAsync outright if the recorder
        // is still prepared from a previous take ("AudioRecorder has
        // already been prepared. Stop or release the current session before
        // preparing again"). That never surfaced while the audio-mode
        // switch still ran per-tap -- it was implicitly resetting the
        // session each time -- so hoisting that to menu-open exposed it on
        // the SECOND recording. RecorderState.canRecord ("whether the
        // recorder is ready and able to record") is that prepared flag, so
        // only prepare when it isn't already usable. Cancelling mid-
        // countdown leaves it prepared-but-unused, which this also covers.
        if (!recorder.getStatus().canRecord) {
          await recorder.prepareToRecordAsync();
        }
        return { granted: true };
      } catch {
        // Never let this promise reject: on a cancelled or superseded flow
        // nothing is left awaiting it, and an unhandled rejection surfaces
        // as a red LogBox error over the whole scene.
        return { granted: false, failed: true };
      }
    })();
  };

  const handleReset = (slotId) => {
    resetSlotToDefault(slotId);
    setRefreshTick((v) => v + 1);
  };

  const handleManualStop = () => finishRecording();

  const stopTrimPreview = () => {
    if (trimStopRef.current) { clearTimeout(trimStopRef.current); trimStopRef.current = null; }
    try { editPlayer.pause(); } catch { /* released */ }
    setTrimPlaying(false);
  };

  /** Preview just the selected window, exactly the way the scene will play
   *  it once confirmed (seek to start, stop after the window's length), and
   *  toggle back to Stop while it runs. */
  const handlePreviewTrim = () => {
    if (!pendingUri || !flowSlot) return;
    if (trimPlaying) { stopTrimPreview(); return; }
    const windowMs = Math.max(1, Math.min(flowSlot.durationMs, takeMs - trimStartMs));
    editPlayer.volume = getSlotVolume(flowSlotId);
    editPlayer.setPlaybackRate(1);
    setTrimPlaying(true);
    editPlayer.seekTo(trimStartMs / 1000).then(() => {
      editPlayer.play();
      trimStopRef.current = setTimeout(stopTrimPreview, windowMs);
    }).catch(() => { setTrimPlaying(false); });
  };

  const handleConfirmTrim = () => {
    if (!pendingUri || !flowSlotId || !flowSlot) return;
    stopTrimPreview();
    saveRecordingForSlot(flowSlotId, pendingUri, {
      startMs: Math.round(trimStartMs),
      // A take stopped early can be shorter than the slot's target -- save
      // what actually exists rather than a window running past the file end.
      // Unlimited slots have no target length -- the window is exactly what
      // the two handles chose. Fixed slots keep the old rule.
      durMs: Math.round(flowSlot.unlimited
        ? Math.max(1, (trimEndMs || takeMs) - trimStartMs)
        : Math.min(flowSlot.durationMs, takeMs - trimStartMs)),
      takeMs: Math.round(takeMs),
      waveform,
    });
    setPendingUri(null);
    setRefreshTick((v) => v + 1);
    setPhase('saved');
  };

  /** Throw the take away and go straight back to recording it again. */
  const handleRetakeTrim = () => {
    stopTrimPreview();
    setPendingUri(null);
    setWaveform([]);
    // forceNew, or this would just reopen the very take being discarded.
    if (flowSlotId) handleRecord(flowSlotId, { forceNew: true });
  };

  const dismissFlow = () => {
    setPhase('idle');
    setFlowSlotId(null);
  };

  /** Live feedback: "if you click somewhere around the pop up, let it cancel
   *  the recording and be back to the library." Discards whatever was
   *  captured -- deliberately NOT finishRecording(), which would save it.
   *  Phase is cleared FIRST and synchronously so the hard-auto-stop effect's
   *  own cleanup cancels its pending timer before the await below can yield;
   *  otherwise a cancel landing near the target duration could still race
   *  finishRecording() and save the take the user just threw away. */
  const cancelFlow = () => {
    const wasRecording = phase === 'recording';
    setPhase('idle');
    setFlowSlotId(null);
    // Discards an un-confirmed take outright: the trim editor never wrote
    // anything to the slot, so dropping the reference is the whole undo.
    setPendingUri(null);
    setWaveform([]);
    // The edit player is SHARED with the pop-up player, so a level auditioned
    // for one slot must not follow the next one in. The chosen value is
    // already saved to the manifest by then; this only resets the preview.
    try {
      editPlayer.volume = 1;
    } catch {
      // Already released — nothing to restore.
    }
    stopTrimPreview();
    if (wasRecording) {
      try {
        recorder.stop().catch(() => {});
      } catch {
        // Already released -- nothing to stop.
      }
    }
  };

  const toggleCategory = (catId) => {
    setExpanded((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  // Live feedback: "when recording has started, the popup should show the
  // whole phrase" -- the row label is a deliberately short preview (see
  // DIALOGUE_FULL_TEXT_KEY), which is useless to actually read aloud while
  // recording. Swap in the real full line whenever this slot has one.
  const flowFullPhraseKey = flowSlot ? DIALOGUE_FULL_TEXT_KEY[flowSlot.id] : null;
  const flowLabel = flowSlot
    ? (flowFullPhraseKey ? t(flowFullPhraseKey, locale) : t(getSlotLabelKey(flowSlot.id), locale))
    : '';
  const flowTargetLabel = flowSlot ? `${formatSeconds(flowSlot.durationMs)}${t('sound.unit.seconds', locale)}` : '';

  const popupPulse = useSharedValue(0);
  useEffect(() => {
    if (phase !== 'recording') {
      popupPulse.value = 0;
      return;
    }
    popupPulse.value = withRepeat(
      withSequence(withTiming(1, { duration: GLOW_HALF_MS }), withTiming(0, { duration: GLOW_HALF_MS })),
      -1,
      false,
    );
  }, [phase, popupPulse]);
  const pulsingDotStyle = useAnimatedStyle(() => ({
    opacity: interpolate(popupPulse.value, [0, 1], [0.4, 1]),
    transform: [{ scale: interpolate(popupPulse.value, [0, 1], [0.85, 1.15]) }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android back mirrors the tap-outside gesture: during a take it
      // abandons that take rather than being swallowed, otherwise it closes
      // the whole library.
      onRequestClose={() => (busy ? cancelFlow() : onClose?.())}
    >
      <Pressable style={styles.backdrop} onPress={canClose ? onClose : undefined} />
      <View style={styles.panel} pointerEvents="box-none">
        <View style={styles.header}>
          <View style={styles.headerTitleGroup}>
            <Text style={styles.title}>{t('sound.title', locale)}</Text>
            {/* Bulk on/off for every slot in the library. Separate from the
                scene's own master-mute button, which stays: that silences
                the whole scene at the engine level, this decides which
                slots are armed to play at all. */}
            <Switch
              accessibilityRole="switch"
              accessibilityLabel={t('sound.action.toggleAll', locale)}
              value={anyUnmuted}
              disabled={busy}
              onValueChange={handleToggleAll}
              trackColor={{ false: 'rgba(46,42,34,0.22)', true: 'rgba(138,90,43,0.55)' }}
              thumbColor={anyUnmuted ? '#8a5a2b' : '#f4f0e8'}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('sound.close', locale)}
            hitSlop={8}
            style={styles.closeBtn}
            disabled={!canClose}
            onPress={onClose}
          >
            <Text style={styles.closeText}>{t('sound.close', locale)}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {CATEGORIES.map((cat) => {
            const slots = getSlotsByCategory(cat.id);
            if (slots.length === 0) return null;
            const isOpen = Boolean(expanded[cat.id]);
            return (
              <View key={cat.id} style={styles.categorySection}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  style={({ pressed }) => [styles.categoryHeader, pressed && styles.categoryHeaderPressed]}
                  // Haptic on onPress, NOT onPressIn: these headers live in a
                  // ScrollView, and onPressIn fires the moment a finger lands
                  // -- including when that finger is starting a scroll -- so
                  // tying feedback to it would buzz on every drag. onPress
                  // only fires on a real tap. Same Light impact TactileButton
                  // uses, so every control in the scene feels the same.
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    toggleCategory(cat.id);
                  }}
                >
                  <Text style={styles.categoryTitle}>{t(cat.labelKey, locale)}</Text>
                  <Text style={styles.categoryChevron}>{isOpen ? '▾' : '▸'}</Text>
                </Pressable>
                {isOpen && cat.id === 'myAmbience' && (
                  <Text style={styles.categoryTooltip}>{t('sound.myAmbienceTooltip', locale)}</Text>
                )}
                {isOpen && slots.map((slot) => (
                  <SlotRow
                    key={slot.id}
                    slotId={slot.id}
                    locale={locale}
                    busy={busy}
                    recording={phase === 'recording' && flowSlotId === slot.id}
                    previewing={previewingLoopId === slot.id}
                    refreshTick={refreshTick}
                    onPlay={handlePlay}
                    onRecord={handleRecord}
                    onReset={handleReset}
                    onToggleMute={handleToggleMute}
                    onShowFullPhrase={setFullPhraseKey}
                  />
                ))}
              </View>
            );
          })}
        </ScrollView>

        {busy && flowSlot && (
          <View style={styles.recordOverlay} pointerEvents="box-none">
            {/* Tap anywhere around the card to abandon this take. The card
                itself claims the responder so taps ON it don't fall through
                to this. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              accessibilityRole="button"
              accessibilityLabel={t('sound.recording.cancel', locale)}
              onPress={cancelFlow}
            />
            <View style={styles.recordCard} onStartShouldSetResponder={() => true}>
              <Text style={styles.recordSlotLabel}>{flowLabel}</Text>
              {!flowSlot.unlimited && (
                <Text style={styles.recordTarget}>{t('sound.recording.target', locale)}: {flowTargetLabel}</Text>
              )}
              {phase === 'countdown' && (
                <>
                  <Text style={styles.recordBig}>{countdown > 0 ? countdown : '●'}</Text>
                  <Text style={styles.recordStatus}>{t('sound.recording.getReady', locale)}</Text>
                </>
              )}
              {phase === 'recording' && (
                <>
                  <Animated.View style={[styles.recordingDot, pulsingDotStyle]} />
                  {/* Counts down the 20s TAKE, not the slot's target length
                      -- the slot length is what the trim window will be, and
                      showing that here would hit zero seconds into a
                      recording that keeps running. */}
                  <RecordingTimer
                    startedAt={recordStartedAt}
                    durationMs={SEGMENT_MS}
                    unlimited={flowSlot.unlimited}
                    locale={locale}
                    style={styles.recordTimer}
                  />
                  <Text style={styles.recordStatus}>{t('sound.recording.recording', locale)}</Text>
                  {/* Stop is available on EVERY slot now, not just ambient:
                      a fixed 20s take would otherwise be a long wait for a
                      half-second blip. */}
                  <TactileButton
                    accessibilityRole="button"
                    accessibilityLabel={t('sound.recording.stopRecording', locale)}
                    style={styles.stopBtnOuter}
                    innerStyle={styles.stopBtnInner}
                    onPress={handleManualStop}
                  >
                    <Text style={styles.stopBtnIcon}>⏹</Text>
                  </TactileButton>
                </>
              )}
              {phase === 'trimming' && (
                <>
                  <Text style={styles.recordStatus}>{t('sound.recording.trimHint', locale)}</Text>
                  {/* The balancer stands beside the waveform, not below it:
                      it's a property OF this sound, so it belongs next to the
                      sound rather than among the actions that finish the
                      edit. Always visible — a level worth setting is worth
                      seeing, and a button to reveal one control was a tap
                      that told you nothing. */}
                  <View style={styles.trimRow}>
                    <View style={styles.trimStripFlex}>
                      <TrimStrip
                        // Remount per take: the strip's drag position is local
                        // state seeded from startMs, so a new/reopened take
                        // needs a fresh instance rather than an effect syncing
                        // it back.
                        key={`${flowSlotId}:${takeMs}`}
                        waveform={waveform}
                        startMs={trimStartMs}
                        // For a range slot this seeds the second handle
                        // (start + durMs = end); for a fixed one it's the
                        // constant width of the window being slid.
                        durMs={flowSlot.unlimited
                          ? Math.max(1, (trimEndMs || takeMs) - trimStartMs)
                          : Math.min(flowSlot.durationMs, takeMs)}
                        takeMs={takeMs}
                        locale={locale}
                        player={editPlayer}
                        playing={trimPlaying}
                        range={!!flowSlot.unlimited}
                        onChangeStart={(startMs, endMs) => {
                          setTrimStartMs(startMs);
                          if (endMs !== undefined) setTrimEndMs(endMs);
                        }}
                      />
                    </View>
                    <VolumeBar
                      // Keyed by slot so opening a different sound builds a
                      // fresh bar seeded from THAT sound's own level.
                      key={`vol:${flowSlotId}`}
                      slotId={flowSlotId}
                      player={editPlayer}
                      locale={locale}
                      // The bar hands back the slot it was built for, not
                      // whatever flowSlotId happens to be by the time the
                      // finger lifts — so a level can only ever land on the
                      // sound it was set against.
                      onCommit={(id, v) => id && setSlotVolume(id, v)}
                    />
                  </View>
                  <View style={styles.trimActions}>
                    <TactileButton
                      accessibilityRole="button"
                      accessibilityLabel={t(trimPlaying ? 'sound.action.stop' : 'sound.action.play', locale)}
                      style={styles.trimBtnOuter}
                      innerStyle={styles.trimBtnInner}
                      onPress={handlePreviewTrim}
                    >
                      <Text style={styles.trimBtnIcon}>{trimPlaying ? '⏹' : '▶'}</Text>
                    </TactileButton>
                    <TactileButton
                      accessibilityRole="button"
                      accessibilityLabel={t('sound.recording.retake', locale)}
                      style={styles.trimBtnOuter}
                      innerStyle={styles.trimBtnInner}
                      onPress={handleRetakeTrim}
                    >
                      <Text style={styles.trimBtnIcon}>↻</Text>
                    </TactileButton>
                    <TactileButton
                      accessibilityRole="button"
                      accessibilityLabel={t('sound.recording.confirm', locale)}
                      style={[styles.trimBtnOuter, styles.trimBtnConfirm]}
                      innerStyle={styles.trimBtnInner}
                      onPress={handleConfirmTrim}
                    >
                      <Text style={[styles.trimBtnIcon, styles.trimBtnIconOnDark]}>✓</Text>
                    </TactileButton>
                    <TactileButton
                      accessibilityRole="button"
                      accessibilityLabel={t('sound.recording.cancel', locale)}
                      style={styles.trimBtnOuter}
                      innerStyle={styles.trimBtnInner}
                      onPress={cancelFlow}
                    >
                      <Text style={styles.trimBtnIcon}>✕</Text>
                    </TactileButton>
                  </View>
                </>
              )}
              {phase === 'saved' && (
                <Text style={styles.recordStatus}>{t('sound.recording.saved', locale)}</Text>
              )}
              {phase === 'denied' && (
                <>
                  <Text style={styles.recordStatus}>{t('sound.recording.permissionTitle', locale)}</Text>
                  <Text style={styles.recordBody}>{t('sound.recording.permissionBody', locale)}</Text>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.dismissBtn}
                    onPress={dismissFlow}
                  >
                    <Text style={styles.dismissText}>{t('sound.close', locale)}</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        )}

        {playerSlot && (
          <View style={styles.recordOverlay} pointerEvents="box-none">
            {/* Tap outside to close, same convention as the record popup. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              accessibilityRole="button"
              accessibilityLabel={t('sound.close', locale)}
              onPress={closePlayer}
            />
            <View style={styles.playerCard} onStartShouldSetResponder={() => true}>
              <Text style={styles.recordSlotLabel}>
                {t(DIALOGUE_FULL_TEXT_KEY[playerSlot.slotId] ?? getSlotLabelKey(playerSlot.slotId), locale)}
              </Text>
              <PlayheadBar
                // Remount per clip so the bar starts at the head, rather
                // than an effect resetting it after the fact.
                key={`${playerSlot.slotId}:${playerSlot.startMs}`}
                player={editPlayer}
                startMs={playerSlot.startMs}
                durationMs={playerSlot.durMs}
                playing={playerPlaying}
                onSeek={(ms) => startPlayerAt(playerSlot.startMs + ms, Math.max(1, playerSlot.durMs - ms))}
              />
              <Text style={styles.trimReadout}>
                {formatSeconds(playerSlot.durMs)}
                {t('sound.unit.seconds', locale)}
              </Text>
              <View style={styles.trimActions}>
                <TactileButton
                  accessibilityRole="button"
                  accessibilityLabel={t(playerPlaying ? 'sound.action.stop' : 'sound.action.play', locale)}
                  style={styles.trimBtnOuter}
                  innerStyle={styles.trimBtnInner}
                  onPress={() => (playerPlaying
                    ? stopPlayer()
                    : startPlayerAt(playerSlot.startMs, playerSlot.durMs))}
                >
                  <Text style={styles.trimBtnIcon}>{playerPlaying ? '⏹' : '▶'}</Text>
                </TactileButton>
                <TactileButton
                  accessibilityRole="button"
                  accessibilityLabel={t('sound.close', locale)}
                  style={styles.trimBtnOuter}
                  innerStyle={styles.trimBtnInner}
                  onPress={closePlayer}
                >
                  <Text style={styles.trimBtnIcon}>✕</Text>
                </TactileButton>
              </View>
            </View>
          </View>
        )}

        {fullPhraseKey && (
          <Pressable
            style={styles.fullPhraseOverlay}
            onPress={() => setFullPhraseKey(null)}
            accessibilityRole="button"
            accessibilityLabel={t('sound.close', locale)}
          >
            <View style={styles.fullPhraseCard}>
              <Text style={styles.fullPhraseText}>{t(fullPhraseKey, locale)}</Text>
              <Text style={styles.fullPhraseHint}>{t('sound.action.closeHint', locale)}</Text>
            </View>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,16,10,0.45)' },
  panel: {
    position: 'absolute',
    top: 72,
    left: 20,
    right: 20,
    bottom: 72,
    backgroundColor: 'rgba(255,251,244,0.97)',
    borderRadius: 22,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(46,42,34,0.1)',
  },
  headerTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  title: { fontSize: 18, fontWeight: '700', color: '#2e2a22' },
  closeBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  closeText: { fontSize: 14, fontWeight: '600', color: '#8a5a2b' },
  scrollContent: { padding: 16, paddingBottom: 28 },
  categorySection: { marginBottom: 10 },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    // Live feedback: the pressed tint "sticks to the text on the left and to
    // the icon to right". Padding widens the highlight past both; the
    // matching negative margin pulls the row back out to the same visual
    // alignment as the slot rows below it, so only the tint grows.
    paddingHorizontal: 10,
    marginHorizontal: -10,
  },
  categoryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8a5a2b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // 2x the old 13 -- the chevron is the only thing signalling these rows are
  // expandable at all, and at 13 it read as decoration next to the label.
  categoryChevron: { fontSize: 26, color: '#8a5a2b', fontWeight: '700' },
  categoryHeaderPressed: { backgroundColor: 'rgba(138,90,43,0.12)', borderRadius: 8 },
  categoryTooltip: {
    fontSize: 12,
    color: '#6b6558',
    fontStyle: 'italic',
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(46,42,34,0.06)',
    gap: 8,
  },
  rowLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowLabel: { fontSize: 15, color: '#2e2a22', flexShrink: 1 },
  // "Read full phrase" affordance for dialogue slots whose row label is a
  // shortened preview (see DIALOGUE_FULL_TEXT_KEY) -- small and inline
  // rather than a full TactileButton, since it's a secondary affordance next
  // to the label, not a peer of the row's 4 action buttons.
  infoIcon: { fontSize: 16, color: '#8a5a2b' },
  rowDuration: { fontSize: 12, color: '#8a5a2b', fontWeight: '600' },
  badge: {
    backgroundColor: 'rgba(46,42,34,0.08)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeCustom: { backgroundColor: 'rgba(138,90,43,0.18)' },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#6b6558' },
  badgeTextCustom: { color: '#8a5a2b' },
  rowActions: { flexDirection: 'row', gap: 6 },
  // Live feedback (confirmed against a reference screenshot): a plain
  // neutral gray circle with the icon glyph sitting directly on it -- NO
  // separate badge/colored shape behind it. Gray outer circle is also the
  // shadow-caster (Android's elevation/outline needs a real background to
  // compute a round shape, not a transparent one). Every button
  // (mute/play/record/reset) shares this exact same outer/inner pair with
  // no per-button override -- only the glyph (and its color, for record)
  // differs.
  actionBtnOuter: {
    width: 37,
    height: 37,
    borderRadius: 18.5,
    backgroundColor: '#b7b2a9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  actionBtnInner: {
    borderRadius: 18.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: { fontSize: 15, color: '#2e2a22' },
  recordIcon: { color: '#c0392b' },
  recordOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(20,16,10,0.4)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  // minHeight (not a fixed height) so the card holds its usual size
  // regardless of phase (countdown/recording/saved/denied) but can still
  // grow for a long dialogue phrase (live feedback: "the popup should show
  // the whole phrase" -- a full narration line can run to 2-3 lines, and a
  // fixed height would have clipped it). marginTop leaves the dimmed sounds
  // list visibly peeking above it instead of the card touching the panel top.
  recordCard: {
    width: '100%',
    minHeight: 260,
    marginTop: 40,
    backgroundColor: '#ffd6e8',
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  recordSlotLabel: { fontSize: 15, fontWeight: '700', color: '#7a3350', textAlign: 'center' },
  recordTarget: { fontSize: 12, color: '#7a3350', opacity: 0.8, marginBottom: 4 },
  recordBig: { fontSize: 48, fontWeight: '800', color: '#7a3350' },
  recordTimer: { fontSize: 40, fontWeight: '800', color: '#7a3350', fontVariant: ['tabular-nums'] },
  recordingDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#ff3b30' },
  recordStatus: { fontSize: 14, color: '#7a3350', textAlign: 'center' },
  recordBody: { fontSize: 12, color: '#7a3350', textAlign: 'center', marginTop: 2, opacity: 0.85 },
  dismissBtn: { marginTop: 10, paddingHorizontal: 16, paddingVertical: 8 },
  dismissText: { fontSize: 14, fontWeight: '600', color: '#7a3350' },
  // Round icon-only Stop button -- solid color circle + icon directly on
  // it, same plain treatment as every actionBtn above, just bigger and
  // colored (primary popup action) instead of neutral gray.
  stopBtnOuter: {
    marginTop: 6,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#7a3350',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  stopBtnInner: {
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBtnIcon: { fontSize: 26, color: '#fff' },
  // Pop-up player -----------------------------------------------------------
  playerCard: {
    width: '100%',
    marginTop: 40,
    backgroundColor: '#ffd6e8',
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
  },
  scrubTrack: {
    width: '100%',
    height: 26,
    justifyContent: 'center',
    // The visible rail is thinner than this; the extra height is touch
    // target, so the knob stays grabbable without a hairline-thin hitbox.
    marginTop: 2,
  },
  scrubFill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#7a3350',
  },
  scrubKnob: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#7a3350',
    borderWidth: 2,
    borderColor: '#ffd6e8',
  },
  // Trim editor -------------------------------------------------------------
  trimStrip: {
    width: '100%',
    height: 72,
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(122,51,80,0.10)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  trimBars: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  trimBar: {
    flex: 1,
    marginHorizontal: 0.5,
    borderRadius: 1,
    backgroundColor: '#7a3350',
  },
  // Dims the un-selected ends. Cheaper than recoloring every bar, and it
  // keeps TrimBars independent of the drag (see its own comment).
  trimMask: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,214,232,0.72)',
  },
  trimWindow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: '#7a3350',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  trimPlayhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#2e2a22',
  },
  trimReadout: {
    fontSize: 12,
    color: '#7a3350',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  trimActions: { flexDirection: 'row', gap: 14, marginTop: 8 },
  trimBtnOuter: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#f0dbe4',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 2,
    elevation: 3,
  },
  trimBtnInner: { borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  trimBtnConfirm: { backgroundColor: '#7a3350' },
  // The waveform and its balancer, side by side. The strip takes whatever
  // width is left so the bar's fixed column never squeezes it.
  // Top-aligned: both children carry the same marginTop, so the bar and the
  // waveform line up whatever their heights are.
  trimRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, alignSelf: 'stretch' },
  trimStripFlex: { flex: 1, justifyContent: 'center' },
  volumeTouch: {
    width: VOLUME_TOUCH_W,
    paddingVertical: VOLUME_TOUCH_PAD,
    alignItems: 'center',
    justifyContent: 'flex-start',
    // Pulls the TRACK's top up to meet the waveform's own marginTop, so the
    // two 72-tall boxes line up. Aligning their tops aligns their centres,
    // since they're the same height — the bar used to sit a whole pad lower
    // than the sound bar it stands beside.
    marginTop: 6 - VOLUME_TOUCH_PAD,
  },
  volumeTrack: {
    width: VOLUME_BAR_W,
    // EXPLICIT height, matching the waveform beside it. Without one the
    // track sized itself to its own percentage-height child, so raising the
    // level grew the whole BAR instead of moving the dot up a fixed one --
    // and the height onLayout reported back was meaningless, which is what
    // made the drag map to the wrong level.
    height: VOLUME_BAR_H,
    marginTop: 6,
    borderRadius: VOLUME_BAR_W / 2,
    backgroundColor: '#f0dbe4',
    // Without an edge the empty track is nearly the same value as the card
    // behind it, so a sound turned all the way down read as no control at
    // all rather than as one set to zero.
    borderWidth: 1,
    borderColor: 'rgba(122,51,80,0.35)',
    justifyContent: 'flex-end',
    // The dot is wider than the track and must not be clipped by it.
    overflow: 'visible',
  },
  volumeFill: {
    width: '100%',
    borderRadius: VOLUME_BAR_W / 2,
    backgroundColor: '#c98fab',
  },
  volumeDot: {
    position: 'absolute',
    alignSelf: 'center',
    width: VOLUME_DOT,
    height: VOLUME_DOT,
    borderRadius: VOLUME_DOT / 2,
    // Centres the dot ON the level rather than sitting above it.
    marginBottom: -VOLUME_DOT / 2,
    backgroundColor: '#7a3350',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  trimBtnIcon: { fontSize: 19, color: '#7a3350' },
  trimBtnIconOnDark: { color: '#fff' },
  // "Read full phrase" popup, triggered from a row's infoIcon. Simple
  // tap-anywhere-to-dismiss overlay (same layering approach as recordOverlay
  // above it in z-order isn't a concern -- the two are mutually exclusive,
  // since a row's infoIcon is disabled while busy/recording).
  fullPhraseOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(20,16,10,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  fullPhraseCard: {
    backgroundColor: '#fffbf4',
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 22,
    gap: 12,
  },
  fullPhraseText: { fontSize: 17, lineHeight: 24, color: '#2e2a22', textAlign: 'center' },
  fullPhraseHint: { fontSize: 12, color: '#8a5a2b', textAlign: 'center', opacity: 0.75 },
});
