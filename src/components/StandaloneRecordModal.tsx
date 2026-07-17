// StandaloneRecordModal.tsx — record a premade ambient or sound clip that
// isn't tied to any page/word yet, straight from the My Recordings tab. Saved
// the same way as a page's "Record your own" flow (see page/[id].tsx's
// saveRecording), just without a page/cue to attach to — it only ever writes
// a Recording row, ready to be picked from "My recordings" in any picker.

import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Directory, File as ExpoFile, Paths } from 'expo-file-system';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { playRange } from '../lib/audio/playRange';
import { createRecording } from '../lib/db';
import TactileButton from './TactileButton';

export type RecordKind = 'ambient' | 'sound';

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
  const inputBackground = isDark ? '#2c2c2e' : '#e6e6ea';

  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [name, setName] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);
  const previewPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const previewStopRef = useRef<(() => void) | null>(null);

  const title = kind === 'ambient' ? 'Record an ambient sound' : 'Record a sound';
  const originLabel = kind === 'ambient' ? 'Ambient' : 'Sound effect';

  function reset() {
    setRecordedUri(null);
    setRecordingDuration(0);
    setName('');
    setPreviewing(false);
    setError(null);
  }

  function stopPreview() {
    previewStopRef.current?.();
    previewStopRef.current = null;
    setPreviewing(false);
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
    setRecordingDuration(0);
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function stopRecording() {
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;
    setRecordedUri(uri);

    const probe = createAudioPlayer(uri);
    let attempts = 0;
    const pollForDuration = () => {
      attempts += 1;
      if (probe.duration > 0 || attempts > 40) {
        setRecordingDuration(probe.duration > 0 ? probe.duration : 1);
        probe.remove();
      } else {
        setTimeout(pollForDuration, 50);
      }
    };
    pollForDuration();
  }

  function togglePreview() {
    if (!recordedUri) return;
    if (previewing) {
      stopPreview();
      return;
    }
    try {
      previewPlayerRef.current?.remove();
    } catch {}
    const player = createAudioPlayer(recordedUri);
    previewPlayerRef.current = player;
    setPreviewing(true);
    const dur = Math.max(0.001, recordingDuration);
    const fade = Math.min(0.5, dur / 2);
    previewStopRef.current = playRange(player, {
      startSec: 0,
      endSec: dur,
      fadeInSec: fade,
      fadeOutSec: fade,
      onEnd: () => setPreviewing(false),
    });
  }

  function handleClose() {
    stopPreview();
    if (recorderState.isRecording) recorder.stop().catch(() => {});
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

      const durationMs = Math.round(recordingDuration * 1000);
      const fadeMs = Math.round(Math.min(0.5, recordingDuration / 2) * 1000);

      await createRecording({
        name: name.trim() || `${originLabel} ${new Date().toLocaleDateString()}`,
        fileUri: dest.uri,
        durationMs,
        startMs: 0,
        endMs: durationMs,
        fadeInMs: fadeMs,
        fadeOutMs: fadeMs,
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.sheet, { backgroundColor: cardBackground }]}>
          <Text style={[styles.title, { color: textColor }]}>{title}</Text>

          {recorderState.isRecording ? (
            <View style={styles.recordingRow}>
              <View style={styles.recDot} />
              <Text style={[styles.recordingTime, { color: textColor }]}>
                {Math.floor((recorderState.durationMillis ?? 0) / 1000)}s
              </Text>
            </View>
          ) : recordedUri ? (
            <>
              <View style={styles.previewRow}>
                <Pressable style={styles.previewBtn} onPress={togglePreview} hitSlop={8}>
                  <Text style={styles.previewIcon}>{previewing ? '⏹' : '▶️'}</Text>
                </Pressable>
                <Text style={[styles.previewDuration, { color: subColor }]}>
                  {recordingDuration.toFixed(1)}s recorded
                </Text>
              </View>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={`${originLabel} name (optional)`}
                placeholderTextColor={subColor}
                style={[styles.nameInput, { color: textColor, backgroundColor: inputBackground }]}
              />
            </>
          ) : (
            <Text style={[styles.hint, { color: subColor }]}>
              Tap "Start recording" and make your sound — you can preview it before saving.
            </Text>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}

          {recorderState.isRecording ? (
            <TactileButton
              style={[styles.actionButton, { backgroundColor: 'rgba(255,69,58,0.15)', borderWidth: 2, borderColor: '#ff453a' }]}
              onPress={stopRecording}
            >
              <Text style={[styles.actionLabel, { color: '#ff453a' }]}>Stop recording</Text>
            </TactileButton>
          ) : (
            <TactileButton
              style={[styles.actionButton, { backgroundColor: 'rgba(255,69,58,0.15)', borderWidth: 2, borderColor: '#ff453a' }]}
              onPress={startRecording}
            >
              <Text style={[styles.actionLabel, { color: '#ff453a' }]}>
                {recordedUri ? 'Record again' : 'Start recording'}
              </Text>
            </TactileButton>
          )}

          <View style={styles.footerRow}>
            <TactileButton style={[styles.smallBtn, { backgroundColor: inputBackground }]} onPress={handleClose}>
              <Text style={[styles.smallBtnLabel, { color: subColor }]}>Cancel</Text>
            </TactileButton>
            <TactileButton
              style={[styles.smallBtn, { backgroundColor: '#208AEF' }]}
              onPress={handleSave}
              disabled={!recordedUri || saving}
            >
              <Text style={[styles.smallBtnLabel, { color: '#fff' }]}>{saving ? 'Saving…' : 'Save'}</Text>
            </TactileButton>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { width: '88%', borderRadius: 16, padding: 20, gap: 14 },
  title: { fontSize: 17, fontWeight: '700' },
  hint: { fontSize: 14, lineHeight: 20 },
  recordingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff453a' },
  recordingTime: { fontSize: 16, fontWeight: '600' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  previewBtn: { padding: 6 },
  previewIcon: { fontSize: 22 },
  previewDuration: { fontSize: 14 },
  nameInput: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 15 },
  errorText: { color: '#ff453a', fontSize: 13 },
  actionButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  actionLabel: { fontSize: 16, fontWeight: '600' },
  footerRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  smallBtn: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 20, alignItems: 'center' },
  smallBtnLabel: { fontSize: 15, fontWeight: '600' },
});
