// SoundLibraryMenu.jsx — the "My Recordings"-style menu behind the new
// musical-note button (SOUND_SPEC.md §2). Lists every fixed sound slot
// grouped by category; PLAY always previews audibly, RECORD runs the
// mandatory 3-2-1 countdown then hard-stops at that slot's own durationMs
// (SOUND_SPEC.md §3 — every recording gets the countdown, every slot has a
// fixed cap), RESET drops the user's recording back to the procedural
// default. The list itself is read-only structure: no add/remove, ever.

import { useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet,
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
  previewSlot,
  resetSlotToDefault,
  saveRecordingForSlot,
} from './services/soundLibrary';
import { t } from './config/strings';

const COUNTDOWN_START = 3;

function SlotRow({
  slotId, locale, onPlay, onRecord, onReset, busy, overrideVersion,
}) {
  // overrideVersion is unused directly -- its only job is to be a changing
  // prop so this row re-renders (and re-reads the manifest) after a
  // save/reset, since isSlotOverridden reads a plain in-memory cache rather
  // than a React/zustand store.
  const overridden = isSlotOverridden(slotId);
  const labelKey = getSlotLabelKey(slotId);
  const label = t(labelKey, locale);
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelWrap}>
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
        <View style={[styles.badge, overridden && styles.badgeCustom]}>
          <Text style={[styles.badgeText, overridden && styles.badgeTextCustom]}>
            {t(overridden ? 'sound.badge.custom' : 'sound.badge.default', locale)}
          </Text>
        </View>
      </View>
      <View style={styles.rowActions}>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('sound.action.record', locale)}: ${label}`}
          hitSlop={8}
          style={[styles.actionBtn, styles.recordBtn]}
          disabled={busy}
          onPress={() => onRecord(slotId)}
        >
          <Text style={[styles.actionIcon, styles.recordIcon]}>●</Text>
        </Pressable>
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
  const [overrideVersion, setOverrideVersion] = useState(0);

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
        setPhase('recording');
      })();
      return () => { cancelled = true; };
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown]);

  // Hard auto-stop at THIS slot's own target duration -- one-shots and
  // ambient loops alike (SOUND_SPEC.md §3's "hard cap, every slot" rule).
  useEffect(() => {
    if (phase !== 'recording' || !flowSlotId) return undefined;
    const slot = getSlotDefinition(flowSlotId);
    const timer = setTimeout(async () => {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      if (recorder.uri) saveRecordingForSlot(flowSlotId, recorder.uri);
      setOverrideVersion((v) => v + 1);
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
    setOverrideVersion((v) => v + 1);
  };

  const dismissFlow = () => {
    setPhase('idle');
    setFlowSlotId(null);
  };

  const flowSlot = flowSlotId ? getSlotDefinition(flowSlotId) : null;
  const flowLabel = flowSlot ? t(getSlotLabelKey(flowSlot.id), locale) : '';

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
            return (
              <View key={cat.id} style={styles.categorySection}>
                <Text style={styles.categoryTitle}>{t(cat.labelKey, locale)}</Text>
                {slots.map((slot) => (
                  <SlotRow
                    key={slot.id}
                    slotId={slot.id}
                    locale={locale}
                    busy={busy}
                    overrideVersion={overrideVersion}
                    onPlay={handlePlay}
                    onRecord={handleRecord}
                    onReset={handleReset}
                  />
                ))}
              </View>
            );
          })}
        </ScrollView>

        {busy && flowSlot && (
          <View style={styles.recordOverlay} pointerEvents="auto">
            <View style={styles.recordCard}>
              <Text style={styles.recordSlotLabel} numberOfLines={1}>{flowLabel}</Text>
              {phase === 'countdown' && (
                <>
                  <Text style={styles.recordBig}>{countdown > 0 ? countdown : '●'}</Text>
                  <Text style={styles.recordStatus}>{t('sound.recording.getReady', locale)}</Text>
                </>
              )}
              {phase === 'recording' && (
                <>
                  <Text style={styles.recordDot}>●</Text>
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
  categorySection: { marginBottom: 18 },
  categoryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8a5a2b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  rowLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 15, color: '#2e2a22', flexShrink: 1 },
  badge: {
    backgroundColor: 'rgba(46,42,34,0.08)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeCustom: { backgroundColor: 'rgba(138,90,43,0.18)' },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#6b6558' },
  badgeTextCustom: { color: '#8a5a2b' },
  rowActions: { flexDirection: 'row', gap: 4 },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(46,42,34,0.06)',
  },
  actionIcon: { fontSize: 14, color: '#2e2a22' },
  recordBtn: { backgroundColor: 'rgba(192,57,43,0.14)' },
  recordIcon: { color: '#c0392b' },
  recordOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,16,10,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordCard: {
    width: '78%',
    backgroundColor: 'rgba(255,251,244,0.98)',
    borderRadius: 18,
    paddingVertical: 26,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 8,
  },
  recordSlotLabel: { fontSize: 14, fontWeight: '700', color: '#8a5a2b', marginBottom: 4 },
  recordBig: { fontSize: 48, fontWeight: '800', color: '#2e2a22' },
  recordDot: { fontSize: 32, color: '#c0392b' },
  recordStatus: { fontSize: 14, color: '#2e2a22', textAlign: 'center' },
  recordBody: { fontSize: 12, color: '#6b6558', textAlign: 'center', marginTop: 2 },
  dismissBtn: { marginTop: 10, paddingHorizontal: 16, paddingVertical: 8 },
  dismissText: { fontSize: 14, fontWeight: '600', color: '#8a5a2b' },
});
