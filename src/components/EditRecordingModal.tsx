// EditRecordingModal.tsx — re-trim/re-fade (or replace entirely, via
// re-record) an ALREADY-SAVED recording from My Recordings. Same drag-to-trim
// waveform editor as StandaloneRecordModal / page/[id].tsx's record sheet: it
// opens straight into the trim editor, seeded from the recording's own
// stored envelope (startMs/endMs/fadeInMs/fadeOutMs) and duration, with the
// right-side "↻ Re-record" button available too (records a fresh clip and,
// on Save, copies it in as the recording's new permanent file — see
// pendingUri below).
//
// The waveform bars for the ORIGINAL clip are a flat placeholder, not real
// amplitude — unlike a fresh recording (where each bar is a live metering
// sample captured while recording), there's no cheap way to pull amplitude
// back out of an already-encoded m4a file without a PCM decode step this app
// doesn't have. The trim handles and preview playback work exactly the same
// either way; only the visual peaks are honest-but-flat instead of real.
// (Re-recording via the ↻ button DOES get a real waveform, same as a fresh
// recording, since it's captured live from that point on.)

import * as Haptics from 'expo-haptics';
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Directory, File as ExpoFile, Paths } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { playRange } from '../lib/audio/playRange';
import { updateRecordingTrim } from '../lib/db';
import type { Recording } from '../lib/types';
import TactileButton from './TactileButton';

const WAVEFORM_BARS = 56;
const MIN_HANDLE_GAP_PX = 24;
const PLACEHOLDER_WAVEFORM = new Array(WAVEFORM_BARS).fill(0.45);

function bucketWaveform(raw: number[], bars: number): number[] {
  if (raw.length === 0) return PLACEHOLDER_WAVEFORM;
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

export default function EditRecordingModal({
  visible,
  recording,
  onClose,
  onSaved,
}: {
  visible: boolean;
  recording: Recording | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const subColor = isDark ? '#9a9a9e' : '#6b6b70';
  const cardBackground = isDark ? '#1c1c1e' : '#fff';

  const [recordingDuration, setRecordingDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [fadeInOn, setFadeInOn] = useState(true);
  const [fadeOutOn, setFadeOutOn] = useState(true);
  const [previewPlayhead, setPreviewPlayhead] = useState<number | null>(null);
  const [waveformWidth, setWaveformWidth] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the parent chooses to re-record instead of just re-trimming —
  // from then on the editor operates on THIS fresh clip (its own full-length
  // trim range) instead of the original file, and Save copies it in as the
  // recording's new permanent file.
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  // Real amplitude, captured live only while re-recording (see PLACEHOLDER_WAVEFORM
  // for why the ORIGINAL clip can't get the same treatment).
  const [rawWaveform, setRawWaveform] = useState<number[]>([]);
  const [displayWaveform, setDisplayWaveform] = useState<number[]>(PLACEHOLDER_WAVEFORM);

  const startHandleX = useSharedValue(0);
  const endHandleX = useSharedValue(0);
  const startHandleDragStart = useSharedValue(0);
  const endHandleDragStart = useSharedValue(0);

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);
  const previewPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const previewStopRef = useRef<(() => void) | null>(null);

  const activeUri = pendingUri ?? recording?.fileUri ?? null;

  // Seed every field from the recording's own stored envelope each time a
  // (different) one is opened for editing.
  useEffect(() => {
    if (!visible || !recording) return;
    setError(null);
    setPreviewPlayhead(null);
    setPendingUri(null);
    setRawWaveform([]);
    setDisplayWaveform(PLACEHOLDER_WAVEFORM);
    const durSec = (recording.durationMs ?? 0) / 1000;
    if (durSec > 0) {
      setRecordingDuration(durSec);
      setTrimStart((recording.startMs ?? 0) / 1000);
      setTrimEnd((recording.endMs ?? recording.durationMs ?? 0) / 1000);
    } else {
      // Fallback for older rows saved without a durationMs — probe the file.
      const probe = createAudioPlayer(recording.fileUri);
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        if (probe.duration > 0 || attempts > 40) {
          const dur = probe.duration > 0 ? probe.duration : 1;
          setRecordingDuration(dur);
          setTrimStart(0);
          setTrimEnd(dur);
          probe.remove();
        } else {
          setTimeout(poll, 50);
        }
      };
      poll();
    }
    setFadeInOn((recording.fadeInMs ?? 0) > 0);
    setFadeOutOn((recording.fadeOutMs ?? 0) > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, recording?.id]);

  // One amplitude sample per poll while actively re-recording, from the
  // recorder's own metering — becomes the waveform with no need to decode
  // the finished file (same trick as a fresh recording).
  useEffect(() => {
    if (!recorderState.isRecording) return;
    const dB = recorderState.metering;
    if (typeof dB !== 'number') return;
    const normalized = Math.max(0, Math.min(1, (dB + 50) / 50));
    setRawWaveform((prev) => [...prev, normalized]);
  }, [recorderState.durationMillis, recorderState.isRecording]);

  // Derived: 1s fades when the matching checkbox is on, clamped to half the
  // trimmed length — same rule as recording a fresh clip.
  useEffect(() => {
    const maxFade = Math.max(0, (trimEnd - trimStart) / 2);
    setFadeIn(fadeInOn ? Math.min(1, maxFade) : 0);
    setFadeOut(fadeOutOn ? Math.min(1, maxFade) : 0);
  }, [trimStart, trimEnd, fadeInOn, fadeOutOn]);

  useEffect(() => {
    if (waveformWidth > 0 && recordingDuration > 0) {
      startHandleX.value = (trimStart / recordingDuration) * waveformWidth;
      endHandleX.value = (trimEnd / recordingDuration) * waveformWidth;
    }
    // Only re-snap when the waveform first measures or a different recording
    // loads — NOT on every trimStart/trimEnd change, which would fight the
    // user's own drag (that already writes startHandleX/endHandleX directly).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveformWidth, recording?.id]);

  function stopPreview() {
    previewStopRef.current?.();
    previewStopRef.current = null;
    setPreviewPlayhead(null);
  }

  function togglePreview() {
    if (!activeUri) return;
    if (previewPlayhead !== null) {
      stopPreview();
      return;
    }
    try {
      previewPlayerRef.current?.remove();
    } catch {}
    const player = createAudioPlayer(activeUri);
    previewPlayerRef.current = player;
    const rangeSec = Math.max(0.001, trimEnd - trimStart);
    setPreviewPlayhead(0);
    previewStopRef.current = playRange(player, {
      startSec: trimStart,
      endSec: trimEnd,
      fadeInSec: fadeIn,
      fadeOutSec: fadeOut,
      onTick: (t) => setPreviewPlayhead(Math.max(0, Math.min(1, (t - trimStart) / rangeSec))),
      onEnd: () => {
        previewStopRef.current = null;
        setPreviewPlayhead(null);
      },
    });
  }

  async function startReRecording() {
    setError(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone access is required to re-record.');
      return;
    }
    stopPreview();
    setRawWaveform([]);
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function stopReRecording() {
    await recorder.stop();
    const uri = recorder.uri;
    setDisplayWaveform(bucketWaveform(rawWaveform, WAVEFORM_BARS));
    if (!uri) return;
    setPendingUri(uri);

    const probe = createAudioPlayer(uri);
    let attempts = 0;
    const poll = () => {
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
        setTimeout(poll, 50);
      }
    };
    poll();
  }

  function handleClose() {
    stopPreview();
    if (recorderState.isRecording) recorder.stop().catch(() => {});
    onClose();
  }

  async function handleSave() {
    if (!recording) return;
    setSaving(true);
    setError(null);
    try {
      let fileUri = recording.fileUri;
      let durationMs = recording.durationMs;
      if (pendingUri) {
        const dir = new Directory(Paths.document, 'recordings');
        if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`;
        const dest = new ExpoFile(dir, filename);
        await new ExpoFile(pendingUri).copy(dest);
        fileUri = dest.uri;
        durationMs = Math.round(recordingDuration * 1000);
      }
      await updateRecordingTrim(recording.id, {
        fileUri,
        durationMs,
        startMs: Math.round(trimStart * 1000),
        endMs: Math.round(trimEnd * 1000),
        fadeInMs: Math.round(fadeIn * 1000),
        fadeOutMs: Math.round(fadeOut * 1000),
      });
      stopPreview();
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  function onWaveformLayout(e: { nativeEvent: { layout: { width: number } } }) {
    setWaveformWidth(e.nativeEvent.layout.width);
  }

  const clampPx = (v: number, min: number, max: number) => {
    'worklet';
    return Math.max(min, Math.min(max, v));
  };

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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.backdrop} onPress={saving ? undefined : handleClose}>
            <Pressable style={[styles.sheet, { backgroundColor: cardBackground }]}>
              <Text style={[styles.sheetTitle, { color: textColor }]} numberOfLines={1}>
                Edit “{recording?.name}”
              </Text>

              {recorderState.isRecording ? (
                <>
                  <View style={styles.recordStatusRow}>
                    <View style={styles.recordDot} />
                    <Text style={[styles.recordTimer, { color: textColor }]}>
                      {Math.floor((recorderState.durationMillis ?? 0) / 1000)}s
                    </Text>
                  </View>
                  <TactileButton style={[styles.actionButton, styles.destructiveButton]} onPress={stopReRecording}>
                    <Text style={[styles.actionButtonLabel, { color: '#ff453a' }]}>⏹ Stop</Text>
                  </TactileButton>
                </>
              ) : (
                <>
              <Text style={[styles.recordHint, { color: subColor }]}>
                Drag the edges to trim · {trimStart.toFixed(1)}s–{trimEnd.toFixed(1)}s of{' '}
                {recordingDuration.toFixed(1)}s
              </Text>

              <View style={styles.waveformRow}>
                <View style={styles.waveformSideCol}>
                  <TactileButton style={styles.waveformSideButton} onPress={togglePreview}>
                    <Text
                      style={[
                        styles.waveformSideButtonIcon,
                        { color: '#fff', marginLeft: previewPlayhead !== null ? 0 : 2 },
                      ]}
                    >
                      {previewPlayhead !== null ? '⏹' : '▶'}
                    </Text>
                  </TactileButton>
                  <Text style={[styles.waveformSideCaption, { color: subColor }]}>
                    {previewPlayhead !== null ? 'stop' : 'play'}
                  </Text>
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
                    onPress={startReRecording}
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
                </>
              )}

              {error && <Text style={styles.errorText}>{error}</Text>}

              {!recorderState.isRecording && (
              <View style={styles.bottomActionsRow}>
                <View style={styles.toolBtnWrap}>
                  <TactileButton
                    style={[styles.actionButton, { backgroundColor: isDark ? '#2c2c2e' : '#e6e6ea' }]}
                    onPress={handleClose}
                    disabled={saving}
                  >
                    <Text style={[styles.actionButtonLabel, { color: '#ff453a' }]}>Cancel</Text>
                  </TactileButton>
                </View>
                <View style={styles.toolBtnWrap}>
                  <TactileButton style={[styles.actionButton, styles.softGreen]} onPress={handleSave} disabled={saving}>
                    <Text style={[styles.actionButtonLabel, { color: '#2fb344' }]}>
                      {saving ? 'Saving…' : '✅ Save changes'}
                    </Text>
                  </TactileButton>
                </View>
              </View>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, gap: 8 },
  sheetTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center', marginBottom: 2 },
  recordHint: { fontSize: 13, textAlign: 'center', marginBottom: 2 },
  recordStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff453a' },
  recordTimer: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  destructiveButton: { backgroundColor: 'rgba(255,69,58,0.15)', borderWidth: 2, borderColor: '#ff453a' },

  waveformRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
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
  waveformSideButtonIcon: { fontSize: 20, fontWeight: '700', width: 24, height: 24, lineHeight: 24, textAlign: 'center' },
  waveformSideCaption: { fontSize: 11, fontWeight: '600' },
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
  playheadBar: { position: 'absolute', top: 2, bottom: 2, width: 3, backgroundColor: '#fff', borderRadius: 1.5 },
  waveformHandle: { position: 'absolute', top: -10, bottom: -10, width: 40, alignItems: 'center', justifyContent: 'center' },
  waveformHandleGrip: { width: 12, height: '100%', borderRadius: 6, backgroundColor: '#208AEF', borderWidth: 2, borderColor: '#fff' },

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

  errorText: { color: '#ff453a', fontSize: 13, textAlign: 'center' },

  bottomActionsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  toolBtnWrap: { flex: 1 },
  actionButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  actionButtonLabel: { fontSize: 16, fontWeight: '600', color: '#fff' },
  softGreen: { backgroundColor: 'rgba(47,179,68,0.15)', borderWidth: 2, borderColor: '#2fb344' },
});
