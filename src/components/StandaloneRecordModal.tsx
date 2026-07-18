// StandaloneRecordModal.tsx — record a premade ambient or sound clip that
// isn't tied to any page/word yet, straight from the My Recordings tab. Same
// waveform trim + fade editor as page/[id].tsx's "Record your own" sheet (see
// its own comments for why each piece is built the way it is) — kept as a
// separate copy rather than a shared import because the page editor's version
// is wired tightly to ITS OWN record target (word cue / ambient / page id),
// while this one only ever writes a standalone Recording row.

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
  type LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { playRange } from '../lib/audio/playRange';
import { createRecording } from '../lib/db';
import PulsingDot from './PulsingDot';
import TactileButton from './TactileButton';

export type RecordKind = 'ambient' | 'sound';

const WAVEFORM_BARS = 56;
const MIN_HANDLE_GAP_PX = 24;

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

export default function StandaloneRecordModal({
  visible,
  kind,
  onClose,
  onSaved,
}: {
  visible: boolean;
  kind: RecordKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const subColor = isDark ? '#9a9a9e' : '#6b6b70';
  const cardBackground = isDark ? '#1c1c1e' : '#fff';
  const inputBackground = isDark ? '#141416' : '#f4f4f6';

  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [fadeInOn, setFadeInOn] = useState(true);
  const [fadeOutOn, setFadeOutOn] = useState(true);
  const [previewPlayhead, setPreviewPlayhead] = useState<number | null>(null);
  const [rawWaveform, setRawWaveform] = useState<number[]>([]);
  const [displayWaveform, setDisplayWaveform] = useState<number[]>([]);
  const [waveformWidth, setWaveformWidth] = useState(0);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startHandleX = useSharedValue(0);
  const endHandleX = useSharedValue(0);
  const startHandleDragStart = useSharedValue(0);
  const endHandleDragStart = useSharedValue(0);

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);
  const previewPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const previewStopRef = useRef<(() => void) | null>(null);

  const title = kind === 'ambient' ? 'Record an ambient sound' : 'Record a sound';
  const originLabel = kind === 'ambient' ? 'Ambient' : 'Sound effect';

  // Derived: 1s fades when the matching checkbox is on, clamped to half the
  // trimmed length so a fade can't outlast what's left to play.
  useEffect(() => {
    const maxFade = Math.max(0, (trimEnd - trimStart) / 2);
    setFadeIn(fadeInOn ? Math.min(1, maxFade) : 0);
    setFadeOut(fadeOutOn ? Math.min(1, maxFade) : 0);
  }, [trimStart, trimEnd, fadeInOn, fadeOutOn]);

  // One amplitude sample per poll while actively recording, from the
  // recorder's own metering — becomes the waveform with no need to decode
  // the finished file.
  useEffect(() => {
    if (!recorderState.isRecording) return;
    const dB = recorderState.metering;
    if (typeof dB !== 'number') return;
    const normalized = Math.max(0, Math.min(1, (dB + 50) / 50));
    setRawWaveform((prev) => [...prev, normalized]);
  }, [recorderState.durationMillis, recorderState.isRecording]);

  useEffect(() => {
    if (waveformWidth > 0 && recordingDuration > 0) {
      startHandleX.value = 0;
      endHandleX.value = waveformWidth;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveformWidth, recordingDuration]);

  function reset() {
    setRecordedUri(null);
    setRecordingDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setRawWaveform([]);
    setDisplayWaveform([]);
    setWaveformWidth(0);
    setName('');
    setPreviewPlayhead(null);
    setError(null);
  }

  function stopPreview() {
    previewStopRef.current?.();
    previewStopRef.current = null;
    setPreviewPlayhead(null);
  }

  async function startRecording() {
    setError(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone access is required to record a sound.');
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
    // Recording mode routes audio playback quietly on Android -- flip back to
    // normal playback now that we're done capturing.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = recorder.uri;
    setRecordedUri(uri);
    setDisplayWaveform(bucketWaveform(rawWaveform, WAVEFORM_BARS));
    if (!uri) return;

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
    if (previewPlayhead !== null) {
      stopPreview();
      return;
    }
    try {
      previewPlayerRef.current?.remove();
    } catch {}
    const player = createAudioPlayer(recordedUri);
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

  function handleClose() {
    stopPreview();
    if (recorderState.isRecording) {
      recorder.stop().catch(() => {});
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    }
    reset();
    onClose();
  }

  async function handleSave() {
    if (!recordedUri) return;
    setSaving(true);
    setError(null);
    try {
      const dir = new Directory(Paths.document, 'recordings');
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`;
      const dest = new ExpoFile(dir, filename);
      await new ExpoFile(recordedUri).copy(dest);

      const startMs = Math.round(trimStart * 1000);
      const endMs = Math.round(trimEnd * 1000);
      const fadeInMs = Math.round(fadeIn * 1000);
      const fadeOutMs = Math.round(fadeOut * 1000);

      await createRecording({
        name: name.trim() || `${originLabel} ${new Date().toLocaleDateString()}`,
        fileUri: dest.uri,
        durationMs: Math.round(recordingDuration * 1000),
        startMs,
        endMs,
        fadeInMs,
        fadeOutMs,
        originBookId: null,
        originBookTitle: null,
        originPageNumber: null,
        originLabel,
      });

      stopPreview();
      reset();
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  function onWaveformLayout(e: LayoutChangeEvent) {
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
              <Text style={[styles.sheetTitle, { color: textColor }]}>{title}</Text>

              {recorderState.isRecording ? (
                <>
                  <View style={styles.recordStatusRow}>
                    <PulsingDot size={10} />
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
                    Drag the edges to trim · {trimStart.toFixed(1)}s–{trimEnd.toFixed(1)}s of{' '}
                    {recordingDuration.toFixed(1)}s
                  </Text>

                  <View style={styles.waveformRow}>
                    <View style={styles.waveformSideCol}>
                      <TactileButton style={styles.waveformSideButton} onPress={playRecordingPreview}>
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

                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder={`Name this ${originLabel.toLowerCase()} (optional) — find it later`}
                    placeholderTextColor={subColor}
                    style={[styles.nameInput, { color: textColor, backgroundColor: inputBackground }]}
                    returnKeyType="done"
                  />

                  {error && <Text style={styles.errorText}>{error}</Text>}

                  <View style={styles.bottomActionsRow}>
                    <View style={styles.toolBtnWrap}>
                      <TactileButton
                        style={[styles.actionButton, { backgroundColor: inputBackground }]}
                        onPress={handleClose}
                        disabled={saving}
                      >
                        <Text style={[styles.actionButtonLabel, { color: '#ff453a' }]}>Cancel</Text>
                      </TactileButton>
                    </View>
                    <View style={styles.toolBtnWrap}>
                      <TactileButton
                        style={[styles.actionButton, styles.softGreen]}
                        onPress={handleSave}
                        disabled={saving}
                      >
                        <Text style={[styles.actionButtonLabel, { color: '#2fb344' }]}>
                          {saving ? 'Saving…' : '✅ Use this recording'}
                        </Text>
                      </TactileButton>
                    </View>
                  </View>
                </>
              ) : (
                <>
                  {error && <Text style={styles.errorText}>{error}</Text>}
                  <TactileButton style={[styles.actionButton, styles.destructiveButton]} onPress={startRecording}>
                    <Text style={[styles.actionButtonLabel, { color: '#ff453a' }]}>🎤 Start recording</Text>
                  </TactileButton>
                </>
              )}

              {(recorderState.isRecording || !recordedUri) && (
                <TactileButton style={styles.cancelRow} onPress={handleClose} disabled={saving}>
                  <Text style={[styles.smallBtnLabel, { color: '#ff453a' }]}>Cancel</Text>
                </TactileButton>
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
  sheetTitle: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 6 },

  recordStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  recordTimer: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  recordHint: { fontSize: 13, textAlign: 'center', marginBottom: 2 },

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
  waveformSideButtonIcon: {
    fontSize: 20,
    fontWeight: '700',
    width: 24,
    height: 24,
    lineHeight: 24,
    textAlign: 'center',
  },
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

  nameInput: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 15, marginBottom: 4 },
  errorText: { color: '#ff453a', fontSize: 13, textAlign: 'center' },

  bottomActionsRow: { flexDirection: 'row', gap: 10 },
  toolBtnWrap: { flex: 1 },
  actionButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  actionButtonLabel: { fontSize: 16, fontWeight: '600', color: '#fff' },
  destructiveButton: { backgroundColor: 'rgba(255,69,58,0.15)', borderWidth: 2, borderColor: '#ff453a' },
  softGreen: { backgroundColor: 'rgba(47,179,68,0.15)', borderWidth: 2, borderColor: '#2fb344' },
  cancelRow: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  smallBtnLabel: { fontSize: 14, fontWeight: '600' },
});
