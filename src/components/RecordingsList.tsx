// RecordingsList.tsx — every saved "My recordings" clip in one place: browse,
// preview, rename, delete. Embedded as one of the Library screen's two tabs
// (My Library / My Recordings) — not its own route, since recordings don't
// have a separate identity outside the library they're reused across.

import { createAudioPlayer } from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import ConfirmDeleteModal from './ConfirmDeleteModal';
import EditRecordingModal from './EditRecordingModal';
import StandaloneRecordModal, { type RecordKind } from './StandaloneRecordModal';
import SwipeableRow from './SwipeableRow';
import TactileButton from './TactileButton';
import { playFull } from '../lib/audio/playRange';
import { deleteRecording, listRecordings, renameRecording } from '../lib/db';
import type { Recording } from '../lib/types';

function originText(rec: Recording): string | null {
  if (rec.originBookTitle) {
    return [
      `“${rec.originBookTitle}”`,
      rec.originPageNumber != null ? `p.${rec.originPageNumber}` : null,
      rec.originLabel ? (rec.originLabel === 'Ambient' ? 'Ambient' : `“${rec.originLabel}”`) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  // Premade — recorded from My Recordings directly, with no page to
  // attribute it to yet.
  return rec.originLabel ?? null;
}

/** Every recording's originLabel is EXACTLY "Ambient" when it's an ambient
 *  bed (whether recorded standalone or for a page's ambient row) — anything
 *  else (a word's trigger text, "Sound effect", or null) means it's a
 *  one-shot sound effect. No schema field needed for this split. */
function recordingKind(rec: Recording): 'ambient' | 'sound' {
  return rec.originLabel === 'Ambient' ? 'ambient' : 'sound';
}

export default function RecordingsList() {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const subColor = isDark ? '#9a9a9e' : '#6b6b70';
  const cardBackground = isDark ? '#1c1c1e' : '#f4f4f6';
  const chipBackground = isDark ? '#2c2c2e' : '#e6e6ea';

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Recording | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Recording | null>(null);
  const [recordKind, setRecordKind] = useState<RecordKind | null>(null);
  const [editingRecording, setEditingRecording] = useState<Recording | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'ambient' | 'sound'>('all');
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    setRecordings(await listRecordings());
    setLoading(false);
  }, []);

  const visibleRecordings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recordings.filter((r) => {
      if (kindFilter !== 'all' && recordingKind(r) !== kindFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [recordings, search, kindFilter]);

  useFocusEffect(
    useCallback(() => {
      load();
      // Leaving the tab (or coming back to a changed list) shouldn't leave a
      // preview playing behind the scenes.
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
    <View style={styles.flex}>
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
            page, then "Record your own") show up here, reusable on any page — or record one ahead
            of time below and assign it to a word later.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.filterBar}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search recordings…"
              placeholderTextColor={subColor}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.searchInput, { color: textColor, backgroundColor: cardBackground }]}
            />
            <View style={styles.kindToggleRow}>
              {(['all', 'ambient', 'sound'] as const).map((k) => {
                const active = kindFilter === k;
                const label = k === 'all' ? 'All' : k === 'ambient' ? '🎵 Ambient' : '🔊 Sound effects';
                return (
                  <TactileButton
                    key={k}
                    style={[
                      styles.kindToggleBtn,
                      active
                        ? { backgroundColor: 'rgba(32,138,239,0.15)', borderColor: '#208AEF' }
                        : { backgroundColor: cardBackground, borderColor: chipBackground },
                    ]}
                    onPress={() => setKindFilter(k)}
                  >
                    <Text style={[styles.kindToggleLabel, { color: active ? '#208AEF' : subColor }]}>{label}</Text>
                  </TactileButton>
                );
              })}
            </View>
          </View>

          {visibleRecordings.length === 0 ? (
            <View style={styles.center}>
              <Text style={[styles.emptyText, { color: subColor }]}>No recordings match.</Text>
            </View>
          ) : (
            <FlatList
              data={visibleRecordings}
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
                      <Pressable hitSlop={8} style={styles.editBtn} onPress={() => setEditingRecording(item)}>
                        <Text style={styles.editIcon}>🎚️</Text>
                      </Pressable>
                    </View>
                  </SwipeableRow>
                );
              }}
            />
          )}
        </>
      )}

      <View style={styles.recordButtonRow}>
        <View style={styles.recordButtonWrap}>
          <TactileButton
            style={[styles.recordButton, { backgroundColor: cardBackground }]}
            onPress={() => setRecordKind('ambient')}
          >
            <Text style={styles.recordButtonEmoji}>🎵</Text>
            <Text style={[styles.recordButtonLabel, { color: textColor }]}>Record an Ambient</Text>
          </TactileButton>
        </View>
        <View style={styles.recordButtonWrap}>
          <TactileButton
            style={[styles.recordButton, { backgroundColor: cardBackground }]}
            onPress={() => setRecordKind('sound')}
          >
            <Text style={styles.recordButtonEmoji}>🔊</Text>
            <Text style={[styles.recordButtonLabel, { color: textColor }]}>Record a Sound</Text>
          </TactileButton>
        </View>
      </View>

      <StandaloneRecordModal
        visible={recordKind !== null}
        kind={recordKind ?? 'sound'}
        onClose={() => setRecordKind(null)}
        onSaved={load}
      />

      <EditRecordingModal
        visible={editingRecording !== null}
        recording={editingRecording}
        onClose={() => setEditingRecording(null)}
        onSaved={load}
      />

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
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyEmoji: { fontSize: 40, marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  recordButtonRow: { flexDirection: 'row', gap: 12, padding: 16, paddingTop: 0 },
  recordButtonWrap: { flex: 1 },
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
  },
  recordButtonEmoji: { fontSize: 20 },
  recordButtonLabel: { fontSize: 14, fontWeight: '600' },

  filterBar: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  searchInput: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 15 },
  kindToggleRow: { flexDirection: 'row', gap: 8 },
  kindToggleBtn: { flex: 1, borderRadius: 10, borderWidth: 1.5, paddingVertical: 8, alignItems: 'center' },
  kindToggleLabel: { fontSize: 13, fontWeight: '600' },

  list: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 14, paddingHorizontal: 4 },
  previewBtn: { paddingVertical: 14, paddingHorizontal: 10 },
  previewIcon: { fontSize: 18 },
  rowLabel: { flex: 1, paddingVertical: 12, paddingHorizontal: 2, gap: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  origin: { fontSize: 12 },
  editBtn: { paddingVertical: 14, paddingHorizontal: 10 },
  editIcon: { fontSize: 18 },

  // Rename modal — same shape as book/[id].tsx's own rename sheet.
  processingOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  renameCard: { width: '86%', borderRadius: 16, padding: 20, gap: 14 },
  renameTitle: { fontSize: 17, fontWeight: '700' },
  renameInput: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 15 },
  renameActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  renameBtn: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 20, alignItems: 'center' },
  renameBtnLabel: { fontSize: 15, fontWeight: '600' },
});
