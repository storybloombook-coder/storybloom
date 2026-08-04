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

import { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet, Switch,
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
} from 'expo-audio';
import {
  CATEGORIES,
  getSlotsByCategory,
  getSlotDefinition,
  getSlotLabelKey,
  isSlotOverridden,
  isSlotMuted,
  setSlotMuted,
  setAllSlotsMuted,
  isAnySlotUnmuted,
  previewSlot,
  previewSlotLoop,
  stopPreviewSlotLoop,
  resetSlotToDefault,
  saveRecordingForSlot,
} from './services/soundLibrary';
import { TactileButton } from './TactileButton';
import { t } from './config/strings';

const COUNTDOWN_START = 3;
const GLOW_HALF_MS = 400;

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

export function SoundLibraryMenu({ visible, onClose, locale }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [flowSlotId, setFlowSlotId] = useState(null);
  // 'idle' | 'countdown' | 'recording' | 'saved' | 'denied'
  const [phase, setPhase] = useState('idle');
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

  // Switch the OS audio session into recording-capable mode once, for the
  // WHOLE time this menu is open, rather than per recording. Live feedback:
  // "are we sure the 3-2-1 countdown takes 3 seconds?" -- it doesn't always,
  // because setAudioModeAsync (a real OS-level session-category switch, not
  // a cheap flag) used to run fresh on every single record tap AND get
  // reverted after every single take (see finishRecording's own comment) --
  // so every recording after the first was paying that cost again, racing
  // the very same 3s window. Doing it once here means by the time the user
  // ever taps record for the first time (which is always well after the
  // menu has been open for at least a moment), the session is already in
  // the right mode -- only recorder.prepareToRecordAsync() (much cheaper)
  // remains in the per-tap critical path.
  useEffect(() => {
    if (!visible) return undefined;
    setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {});
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
    try {
      await recorder.stop();
    } catch {
      // Same released-shared-object hazard as the unmount cleanup below --
      // if it's already gone there's nothing left to save.
      return;
    }
    // NOT reverting allowsRecording here anymore -- see the visible/mount
    // effect below for why. Flipping it back after every single take used
    // to make the NEXT recording pay for a full OS audio-session-mode
    // switch again, inside the very same 3s countdown window it's racing.
    if (!isMountedRef.current || !flowSlotId) return;
    if (recorder.uri) saveRecordingForSlot(flowSlotId, recorder.uri);
    setRefreshTick((v) => v + 1);
    setPhase('saved');
  };

  // Hard auto-stop at THIS slot's own target duration -- one-shots and
  // ambient loops alike (SOUND_SPEC.md §3's "hard cap, every slot" rule) --
  // except `unlimited` slots (My Ambience), which skip this entirely and
  // stop only via the manual Stop button (handleManualStop).
  useEffect(() => {
    if (phase !== 'recording' || !flowSlotId) return undefined;
    const slot = getSlotDefinition(flowSlotId);
    if (slot.unlimited) return undefined;
    const timer = setTimeout(() => finishRecording(), slot.durationMs);
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
    previewSlot(slotId);
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

  const handleRecord = (slotId) => {
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
                  <RecordingTimer
                    startedAt={recordStartedAt}
                    durationMs={flowSlot.durationMs}
                    unlimited={flowSlot.unlimited}
                    locale={locale}
                    style={styles.recordTimer}
                  />
                  <Text style={styles.recordStatus}>{t('sound.recording.recording', locale)}</Text>
                  {flowSlot.unlimited && (
                    <TactileButton
                      accessibilityRole="button"
                      accessibilityLabel={t('sound.recording.stopRecording', locale)}
                      style={styles.stopBtnOuter}
                      innerStyle={styles.stopBtnInner}
                      onPress={handleManualStop}
                    >
                      <Text style={styles.stopBtnIcon}>⏹</Text>
                    </TactileButton>
                  )}
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
