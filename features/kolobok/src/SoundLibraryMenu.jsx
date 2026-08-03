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
  Modal, View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
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

function SlotRow({
  slotId, locale, onPlay, onRecord, onReset, onToggleMute, busy, recording, previewing, refreshTick,
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
  // Live feedback: "no need for a prompt regarding sound duration" for
  // unlimited (My Ambience) slots -- durationMs there is only the
  // procedural default's own loop length, not a recording target, so
  // showing it here would read as a duration limit that doesn't exist.
  const durationLabel = slot.unlimited ? null : `${formatSeconds(slot.durationMs)}${t('sound.unit.seconds', locale)}`;

  // Live feedback: "when recording finishes, the record button should be
  // back to idle -- now it's red after recording." Rebuilt as a pulse
  // overlay that only MOUNTS while `recording` is true (rather than a
  // static-vs-animated style swap on the button's own fill/shadow) so
  // there's no way for a stale animated value to leave it looking "stuck" --
  // when recording ends the overlay is simply removed from the tree.
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
          style={[styles.actionBtnOuter, !muted && styles.muteBtnActiveOuter]}
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
          style={[styles.actionBtnOuter, styles.recordBtnOuter]}
          innerStyle={styles.actionBtnInner}
          disabled={busy}
          onPress={() => onRecord(slotId)}
        >
          <Text style={[styles.actionIcon, styles.recordIcon]}>●</Text>
          {recording && (
            <Animated.View pointerEvents="none" style={[styles.recordPulseOverlay, pulseStyle]} />
          )}
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

export function SoundLibraryMenu({ visible, onClose, locale }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [flowSlotId, setFlowSlotId] = useState(null);
  // 'idle' | 'countdown' | 'recording' | 'saved' | 'denied'
  const [phase, setPhase] = useState('idle');
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  // Collapsed by default -- tap a category header to expand it.
  const [expanded, setExpanded] = useState({});
  // Which loop slot (if any) is currently toggled on for an audible preview
  // (PLAY on a loop slot starts/stops a real loop instead of a one-shot).
  const [previewingLoopId, setPreviewingLoopId] = useState(null);
  const recordStartRef = useRef(0);
  const isMountedRef = useRef(true);
  // Holds the in-flight (or already-resolved) session-setup promise kicked
  // off by handleRecord, awaited once the countdown reaches zero -- see its
  // own comment below for why this can't just run sequentially after.
  const prepareRef = useRef(Promise.resolve());

  const busy = phase !== 'idle';
  const canClose = phase !== 'countdown' && phase !== 'recording';
  const flowSlot = flowSlotId ? getSlotDefinition(flowSlotId) : null;

  useEffect(() => () => { isMountedRef.current = false; }, []);

  // Countdown ticker: 3 -> 2 -> 1 -> start the real recording. Live
  // feedback: "the countdown feels like more than 3 seconds" -- it was:
  // setAudioModeAsync + recorder.prepareToRecordAsync used to run AFTER the
  // countdown finished (sequentially), and that native setup's own latency
  // (mic session init, first-recording-of-the-session overhead) added
  // unpredictable extra wait on top of the visual 3s. Now handleRecord
  // kicks that prep off immediately, in PARALLEL with the countdown ticking
  // (prepareRef); by the time countdown reaches zero it's normally already
  // resolved, so recorder.record() fires with no perceptible extra delay.
  useEffect(() => {
    if (phase !== 'countdown') return undefined;
    if (countdown <= 0) {
      let cancelled = false;
      (async () => {
        await prepareRef.current;
        if (cancelled || !isMountedRef.current) return;
        recorder.record();
        recordStartRef.current = Date.now();
        setElapsedMs(0);
        setPhase('recording');
      })();
      return () => { cancelled = true; };
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown]);

  // Live timer while actually capturing (30ms resolution).
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const interval = setInterval(() => setElapsedMs(Date.now() - recordStartRef.current), 30);
    return () => clearInterval(interval);
  }, [phase]);

  const finishRecording = async () => {
    try {
      await recorder.stop();
    } catch {
      // Same released-shared-object hazard as the unmount cleanup below --
      // if it's already gone there's nothing left to save.
      return;
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
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

  const handleRecord = async (slotId) => {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      setFlowSlotId(slotId);
      setPhase('denied');
      return;
    }
    if (previewingLoopId) {
      stopPreviewSlotLoop(previewingLoopId);
      setPreviewingLoopId(null);
    }
    setFlowSlotId(slotId);
    setCountdown(COUNTDOWN_START);
    setPhase('countdown');
    prepareRef.current = (async () => {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
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

  const toggleCategory = (catId) => {
    setExpanded((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  const flowLabel = flowSlot ? t(getSlotLabelKey(flowSlot.id), locale) : '';
  const flowTargetLabel = flowSlot ? `${formatSeconds(flowSlot.durationMs)}${t('sound.unit.seconds', locale)}` : '';
  const remainingLabel = flowSlot
    ? `${formatSeconds(Math.max(0, flowSlot.durationMs - elapsedMs))}${t('sound.unit.seconds', locale)}`
    : '';
  const elapsedLabel = `${formatSeconds(elapsedMs)}${t('sound.unit.seconds', locale)}`;

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => canClose && onClose?.()}>
      <Pressable style={styles.backdrop} onPress={canClose ? onClose : undefined} />
      <View style={styles.panel} pointerEvents="box-none">
        <View style={styles.header}>
          <Text style={styles.title}>{t('sound.title', locale)}</Text>
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
                  style={styles.categoryHeader}
                  onPress={() => toggleCategory(cat.id)}
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
                  />
                ))}
              </View>
            );
          })}
        </ScrollView>

        {busy && flowSlot && (
          <View style={styles.recordOverlay} pointerEvents="auto">
            <View style={styles.recordCard}>
              <Text style={styles.recordSlotLabel} numberOfLines={2}>{flowLabel}</Text>
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
                  <Text style={styles.recordTimer}>{flowSlot.unlimited ? elapsedLabel : remainingLabel}</Text>
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
  },
  categoryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8a5a2b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  categoryChevron: { fontSize: 13, color: '#8a5a2b', fontWeight: '700' },
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
  // Two-layer button (live feedback: "surrounded by a hexagon, should be a
  // circle" -- Android's elevation shadow/outline doesn't reliably compute a
  // round shape for a view with NO backgroundColor of its own (transparent),
  // falling back to a low-poly approximation instead. The FILL color now
  // lives on the OUTER view (the one that actually casts the shadow and
  // needs a real background for Android to derive a correct round outline);
  // the inner View (TactileButton's own, already overflow:hidden) only
  // centers content and clips it to the same radius. 37x37 -- 15% larger
  // than the previous 32x32, per live feedback.
  actionBtnOuter: {
    width: 37,
    height: 37,
    borderRadius: 18.5,
    backgroundColor: 'rgba(46,42,34,0.06)',
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
  actionIcon: { fontSize: 14, color: '#2e2a22' },
  muteBtnActiveOuter: { backgroundColor: 'rgba(46,42,34,0.14)' },
  recordBtnOuter: { backgroundColor: 'rgba(192,57,43,0.14)' },
  recordIcon: { color: '#c0392b' },
  // Only mounted while actively recording (see SlotRow) -- pulses opacity
  // over the button's existing round shape, clipped by the SAME inner
  // overflow:hidden view since it's rendered as a child inside TactileButton.
  recordPulseOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ff3b30',
  },
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
  // Fixed size regardless of phase (countdown/recording/saved/denied) so the
  // window never jumps around; marginTop leaves the dimmed sounds list
  // visibly peeking above it instead of the card touching the panel top.
  recordCard: {
    width: '100%',
    height: 260,
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
  // Round icon-only Stop button (live feedback: the old pill-with-text
  // "looked strange" -- a round button with a stop glyph inside, matching
  // every other action button's own round-with-shadow treatment + the
  // press-scale/haptic TactileButton already gives every button here).
  // backgroundColor lives on the outer layer for the same reason as
  // actionBtnOuter above (Android's elevation outline needs a real
  // background to compute a round shape, not a transparent one).
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
});
