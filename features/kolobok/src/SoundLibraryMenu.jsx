// SoundLibraryMenu.jsx — the "My Recordings"-style menu behind the new
// musical-note button (SOUND_SPEC.md §2). Lists every fixed sound slot
// grouped by category (collapsed by default, tap a category to expand);
// MUTE toggles whether this slot ever plays in the scene (every slot starts
// muted), PLAY always previews audibly regardless of that mute state,
// RECORD runs the mandatory 3-2-1 countdown then hard-stops at that slot's
// own durationMs (SOUND_SPEC.md §3), RESET drops the user's recording back
// to the procedural default. The list itself is read-only structure: no
// add/remove, ever.

import { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet, Animated,
} from 'react-native';
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
  resetSlotToDefault,
  saveRecordingForSlot,
} from './services/soundLibrary';
import { t } from './config/strings';

const COUNTDOWN_START = 3;

function formatSeconds(ms) {
  return (ms / 1000).toFixed(2);
}

function SlotRow({
  slotId, locale, onPlay, onRecord, onReset, onToggleMute, busy, recording, refreshTick,
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
  const durationLabel = `${formatSeconds(slot.durationMs)}${t('sound.unit.seconds', locale)}`;

  // useState's lazy initializer (not useRef().current) -- same "created
  // once, stable across renders" Animated.Value idiom, but reading it in
  // render doesn't trip react-hooks/refs the way a bare ref access does.
  const [glow] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!recording) {
      glow.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 400, useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration: 400, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, glow]);
  // Both an Android cue (elevation/backgroundColor -- shadowRadius/
  // shadowOpacity are iOS-only and silently do nothing on Android, the
  // primary target platform per CLAUDE.md) and an iOS one (the shadow
  // props), so the pulse actually reads on-device either way.
  const glowShadowRadius = glow.interpolate({ inputRange: [0, 1], outputRange: [4, 14] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  const glowElevation = glow.interpolate({ inputRange: [0, 1], outputRange: [4, 14] });
  const glowColor = glow.interpolate({ inputRange: [0, 1], outputRange: ['#c0392b', '#ff6b5b'] });

  return (
    <View style={styles.row}>
      <View style={styles.rowLabelWrap}>
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.rowDuration}>{durationLabel}</Text>
        <View style={[styles.badge, overridden && styles.badgeCustom]}>
          <Text style={[styles.badgeText, overridden && styles.badgeTextCustom]}>
            {t(overridden ? 'sound.badge.custom' : 'sound.badge.default', locale)}
          </Text>
        </View>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t(muted ? 'sound.action.unmute' : 'sound.action.mute', locale)}: ${label}`}
          hitSlop={8}
          style={[styles.actionBtn, !muted && styles.muteBtnActive]}
          disabled={busy}
          onPress={() => onToggleMute(slotId)}
        >
          <Text style={styles.actionIcon}>{muted ? '🔇' : '🔊'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('sound.action.play', locale)}: ${label}`}
          hitSlop={8}
          style={styles.actionBtn}
          disabled={busy}
          onPress={() => onPlay(slotId)}
        >
          <Text style={styles.actionIcon}>▶</Text>
        </Pressable>
        <Animated.View
          style={[
            styles.actionBtn,
            styles.recordBtn,
            recording && {
              backgroundColor: glowColor,
              elevation: glowElevation,
              shadowColor: '#ff3b30',
              shadowRadius: glowShadowRadius,
              shadowOpacity: glowOpacity,
              shadowOffset: { width: 0, height: 0 },
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('sound.action.record', locale)}: ${label}`}
            hitSlop={8}
            style={styles.actionBtnFill}
            disabled={busy}
            onPress={() => onRecord(slotId)}
          >
            <Text style={[styles.actionIcon, recording ? styles.recordIconActive : styles.recordIcon]}>●</Text>
          </Pressable>
        </Animated.View>
        {overridden && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('sound.action.reset', locale)}: ${label}`}
            hitSlop={8}
            style={styles.actionBtn}
            disabled={busy}
            onPress={() => onReset(slotId)}
          >
            <Text style={styles.actionIcon}>↺</Text>
          </Pressable>
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
  const recordStartRef = useRef(0);

  const busy = phase !== 'idle';
  const canClose = phase !== 'countdown' && phase !== 'recording';

  // Countdown ticker: 3 -> 2 -> 1 -> start the real recording.
  useEffect(() => {
    if (phase !== 'countdown') return undefined;
    if (countdown <= 0) {
      let cancelled = false;
      (async () => {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
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

  // Live hundredths-of-a-second timer while actually capturing.
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const interval = setInterval(() => setElapsedMs(Date.now() - recordStartRef.current), 30);
    return () => clearInterval(interval);
  }, [phase]);

  // Hard auto-stop at THIS slot's own target duration -- one-shots and
  // ambient loops alike (SOUND_SPEC.md §3's "hard cap, every slot" rule).
  useEffect(() => {
    if (phase !== 'recording' || !flowSlotId) return undefined;
    const slot = getSlotDefinition(flowSlotId);
    const timer = setTimeout(async () => {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      if (recorder.uri) saveRecordingForSlot(flowSlotId, recorder.uri);
      setRefreshTick((v) => v + 1);
      setPhase('saved');
    }, slot.durationMs);
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
  useEffect(() => () => {
    if (recorder.isRecording) recorder.stop().catch(() => {});
  }, [recorder]);

  const handlePlay = (slotId) => previewSlot(slotId);

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
    setFlowSlotId(slotId);
    setCountdown(COUNTDOWN_START);
    setPhase('countdown');
  };

  const handleReset = (slotId) => {
    resetSlotToDefault(slotId);
    setRefreshTick((v) => v + 1);
  };

  const dismissFlow = () => {
    setPhase('idle');
    setFlowSlotId(null);
  };

  const toggleCategory = (catId) => {
    setExpanded((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  const flowSlot = flowSlotId ? getSlotDefinition(flowSlotId) : null;
  const flowLabel = flowSlot ? t(getSlotLabelKey(flowSlot.id), locale) : '';
  const flowTargetLabel = flowSlot ? `${formatSeconds(flowSlot.durationMs)}${t('sound.unit.seconds', locale)}` : '';

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
                {isOpen && slots.map((slot) => (
                  <SlotRow
                    key={slot.id}
                    slotId={slot.id}
                    locale={locale}
                    busy={busy}
                    recording={phase === 'recording' && flowSlotId === slot.id}
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
              <Text style={styles.recordTarget}>{t('sound.recording.target', locale)}: {flowTargetLabel}</Text>
              {phase === 'countdown' && (
                <>
                  <Text style={styles.recordBig}>{countdown > 0 ? countdown : '●'}</Text>
                  <Text style={styles.recordStatus}>{t('sound.recording.getReady', locale)}</Text>
                </>
              )}
              {phase === 'recording' && (
                <>
                  <Text style={styles.recordTimer}>{formatSeconds(elapsedMs)}{t('sound.unit.seconds', locale)}</Text>
                  <Text style={styles.recordStatus}>{t('sound.recording.recording', locale)}</Text>
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
  // Explicit shadow/elevation -- live feedback: the row buttons read as
  // flat tinted circles with no visual affordance that they're tappable.
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(46,42,34,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  // recordBtn is an Animated.View wrapper (so its own shadow can pulse while
  // recording) with a plain Pressable filling it -- actionBtn's shadow
  // above still applies to the wrapper at rest.
  actionBtnFill: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  actionIcon: { fontSize: 14, color: '#2e2a22' },
  muteBtnActive: { backgroundColor: 'rgba(46,42,34,0.14)' },
  recordBtn: { backgroundColor: 'rgba(192,57,43,0.14)', padding: 0 },
  recordIcon: { color: '#c0392b' },
  recordIconActive: { color: '#fff' },
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
  recordStatus: { fontSize: 14, color: '#7a3350', textAlign: 'center' },
  recordBody: { fontSize: 12, color: '#7a3350', textAlign: 'center', marginTop: 2, opacity: 0.85 },
  dismissBtn: { marginTop: 10, paddingHorizontal: 16, paddingVertical: 8 },
  dismissText: { fontSize: 14, fontWeight: '600', color: '#7a3350' },
});
