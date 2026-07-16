// recordings.tsx — every saved "My recordings" clip in one place. The same
// list already shows inline in the sound picker (page/[id].tsx) while
// assigning a sound to a word/ambient, but that's buried mid-flow — this is
// a direct way to just browse, preview, rename, or delete them, reached from
// the Library screen's header.

import { createAudioPlayer } from 'expo-audio';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import SwipeableRow from '../components/SwipeableRow';
import TactileButton from '../components/TactileButton';
import { playFull } from '../lib/audio/playRange';
import { deleteRecording, listRecordings, renameRecording } from '../lib/db';
import type { Recording } from '../lib/types';

function originText(rec: Recording): string | null {
  if (!rec.originBookTitle) return null;
  return [
    `“${rec.originBookTitle}”`,
    rec.originPageNumber != null ? `p.${rec.originPageNumber}` : null,
    rec.originLabel ? (rec.originLabel === 'Ambient' ? 'Ambient' : `“${rec.originLabel}”`) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function RecordingsScreen() {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const subColor = isDark ? '#9a9a9e' : '#6b6b70';
  const backgroundColor = isDark ? '#000' : '#fff';
  const cardBackground = isDark ? '#1c1c1e' : '#f4f4f6';
  const chipBackground = isDark ? '#2c2c2e' : '#e6e6ea';

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Recording | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Recording | null>(null);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    setRecordings(await listRecordings());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      // Leaving the screen (or coming back to a changed list) shouldn't
      // leave a preview playing behind the scenes.
      return () => stopPreview();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  function stopPreview() {
    stopRef.current?.();
    stopRef.current = null;
    const p = playerRef.current;
    playerRef.current = null;
    if (p) {
      try {
        p.remove();
      } catch {}
    }
    setPreviewingId(null);
  }

  function togglePreview(rec: Recording) {
    if (previewingId === rec.id) {
      stopPreview();
      return;
    }
    stopPreview();
    const player = createAudioPlayer({ uri: rec.fileUri });
    playerRef.current = player;
    setPreviewingId(rec.id);
    const onEnd = () => {
      stopRef.current = null;
      setPreviewingId((cur) => (cur === rec.id ? null : cur));
    };
    stopRef.current = playFull(player, { onEnd });
  }

  function openRename(rec: Recording) {
    stopPreview();
    setNameDraft(rec.name);
    setRenaming(rec);
  }

  async function saveRename() {
    if (!renaming) return;
    const next = nameDraft.trim();
    setRenaming(null);
    if (!next || next === renaming.name) return;
    await renameRecording(renaming.id, next);
    await load();
  }

  async function performDelete() {
    const rec = pendingDelete;
    if (!rec) return;
    setPendingDelete(null);
    if (previewingId === rec.id) stopPreview();
    await deleteRecording(rec.id);
    setRecordings((prev) => prev.filter((r) => r.id !== rec.id));
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'My Recordings',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ paddingHorizontal: 6 }}>
              <Text style={{ fontSize: 22, color: subColor }}>←</Text>
            </Pressable>
          ),
        }}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#208AEF" />
        </View>
      ) : recordings.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🎙️</Text>
          <Text style={[styles.emptyTitle, { color: textColor }]}>No recordings yet</Text>
          <Text style={[styles.emptyText, { color: subColor }]}>
            Recordings you make for a word or an ambient sound (tap a word or the Ambient row in a
            page, then "Record your own") show up here, reusable on any page.
          </Text>
        </View>
      ) : (
        <FlatList
          data={recordings}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const previewing = previewingId === item.id;
            const origin = originText(item);
            return (
              <SwipeableRow onDelete={() => setPendingDelete(item)}>
                <View style={[styles.row, { backgroundColor: cardBackground }]}>
                  <Pressable hitSlop={8} style={styles.previewBtn} onPress={() => togglePreview(item)}>
                    <Text style={styles.previewIcon}>{previewing ? '⏹' : '▶️'}</Text>
                  </Pressable>
                  <Pressable style={styles.rowLabel} onPress={() => openRename(item)}>
                    <Text style={[styles.name, { color: textColor }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {origin && (
                      <Text style={[styles.origin, { color: subColor }]} numberOfLines={1}>
                        {origin}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </SwipeableRow>
            );
          }}
        />
      )}

      <ConfirmDeleteModal
        visible={pendingDelete !== null}
        title={`Delete "${pendingDelete?.name}"?`}
        message="This recording will be permanently removed. Any word or ambient still using it keeps playing until you replace it."
        onConfirm={performDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={styles.processingOverlay} onPress={() => setRenaming(null)}>
          <Pressable style={[styles.renameCard, { backgroundColor: cardBackground }]}>
            <Text style={[styles.renameTitle, { color: textColor }]}>Rename recording</Text>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              autoFocus
              selectTextOnFocus
              placeholder="Recording name"
              placeholderTextColor={subColor}
              style={[styles.renameInput, { color: textColor, backgroundColor: chipBackground }]}
              onSubmitEditing={saveRename}
              returnKeyType="done"
            />
            <View style={styles.renameActions}>
              <TactileButton style={[styles.renameBtn, { backgroundColor: chipBackground }]} onPress={() => setRenaming(null)}>
                <Text style={[styles.renameBtnLabel, { color: subColor }]}>Cancel</Text>
              </TactileButton>
              <TactileButton style={[styles.renameBtn, { backgroundColor: '#208AEF' }]} onPress={saveRename}>
                <Text style={[styles.renameBtnLabel, { color: '#fff' }]}>Save</Text>
              </TactileButton>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyEmoji: { fontSize: 40, marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  list: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 14, paddingHorizontal: 4 },
  previewBtn: { paddingVertical: 14, paddingHorizontal: 10 },
  previewIcon: { fontSize: 18 },
  rowLabel: { flex: 1, paddingVertical: 12, paddingHorizontal: 2, gap: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  origin: { fontSize: 12 },

  // Rename modal — same shape as book/[id].tsx's own rename sheet.
  processingOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  renameCard: { width: '86%', borderRadius: 16, padding: 20, gap: 14 },
  renameTitle: { fontSize: 17, fontWeight: '700' },
  renameInput: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 15 },
  renameActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  renameBtn: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 20, alignItems: 'center' },
  renameBtnLabel: { fontSize: 15, fontWeight: '600' },
});
