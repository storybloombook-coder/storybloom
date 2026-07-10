import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TactileButton from '../../components/TactileButton';
import { EFFECT_IDS } from '../../lib/ai/soundLibrary';
import {
  createCue,
  getCuesForPage,
  getPage,
  setCueReviewState,
  updateCueCharRange,
  updateCueSoundId,
  updatePageOcrText,
} from '../../lib/db';
import type { Cue, Page } from '../../lib/types';

/** Case-insensitive first-occurrence range of a trigger in the text. */
function findRange(text: string, trigger: string): { start: number | null; end: number | null } {
  const idx = text.toLowerCase().indexOf(trigger.toLowerCase());
  if (idx < 0) return { start: null, end: null };
  return { start: idx, end: idx + trigger.length };
}

/** Split into word/space tokens carrying their char offsets so we can map each
 *  word back to a cue's [charStart, charEnd). */
interface Token {
  text: string;
  start: number;
  end: number;
  isSpace: boolean;
}
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let idx = 0;
  for (const part of text.split(/(\s+)/)) {
    if (part.length === 0) continue;
    const start = idx;
    idx += part.length;
    tokens.push({ text: part, start, end: idx, isSpace: /^\s+$/.test(part) });
  }
  return tokens;
}

function cueAtRange(cues: Cue[], start: number, end: number): Cue | undefined {
  return cues.find(
    (c) => c.charStart != null && c.charEnd != null && start < c.charEnd && end > c.charStart
  );
}

type PickerTarget = { mode: 'add'; token: Token } | { mode: 'change'; cue: Cue };

export default function PageEditorScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const pageId = Array.isArray(params.id) ? params.id[0] : params.id;

  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const subColor = isDark ? '#9a9a9e' : '#6b6b70';
  const backgroundColor = isDark ? '#000' : '#fff';
  const cardBackground = isDark ? '#1c1c1e' : '#f4f4f6';
  const inputBackground = isDark ? '#141416' : '#fff';

  const [page, setPage] = useState<Page | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [picker, setPicker] = useState<PickerTarget | null>(null);

  const reload = useCallback(async () => {
    if (!pageId) return;
    const [p, cs] = await Promise.all([getPage(pageId), getCuesForPage(pageId)]);
    setPage(p);
    setCues(cs);
    setLoading(false);
  }, [pageId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function saveText() {
    if (!page) return;
    const next = draft;
    await updatePageOcrText(page.id, next);
    // Re-locate every cue against the corrected text so highlights + reading
    // alignment stay accurate. Triggers that no longer appear become unplaced.
    for (const c of cues) {
      const range = findRange(next, c.triggerText);
      if (range.start !== c.charStart || range.end !== c.charEnd) {
        await updateCueCharRange(c.id, range.start, range.end);
      }
    }
    setEditing(false);
    await reload();
  }

  function onWordPress(token: Token) {
    const cue = cueAtRange(cues, token.start, token.end);
    if (!cue) {
      setPicker({ mode: 'add', token });
      return;
    }
    if (cue.reviewState === 'removed') {
      Alert.alert(`"${cue.triggerText}" — removed`, 'This word plays no sound.', [
        { text: 'Restore', onPress: () => setCueReviewState(cue.id, 'confirmed').then(reload) },
        { text: 'Change sound', onPress: () => setPicker({ mode: 'change', cue }) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      Alert.alert(
        `"${cue.triggerText}" → ${cue.soundId ?? 'none'}`,
        cue.type === 'character' ? 'Character cue' : 'Keyword cue',
        [
          { text: 'Change sound', onPress: () => setPicker({ mode: 'change', cue }) },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => setCueReviewState(cue.id, 'removed').then(reload),
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    }
  }

  async function chooseSound(soundId: string) {
    if (!picker) return;
    if (picker.mode === 'change') {
      await updateCueSoundId(picker.cue.id, soundId);
      if (picker.cue.reviewState === 'removed') await setCueReviewState(picker.cue.id, 'confirmed');
    } else {
      const word = picker.token.text.toLowerCase();
      const created = await createCue({
        pageId: page!.id,
        type: 'keyword',
        triggerText: word,
        contextPhrase: null,
        charStart: picker.token.start,
        charEnd: picker.token.end,
        soundId,
        characterName: null,
        intensity: null,
        emotion: null,
      });
      // The parent added it deliberately — treat as confirmed, not proposed.
      await setCueReviewState(created.id, 'confirmed');
    }
    setPicker(null);
    await reload();
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor }]}>
        <Stack.Screen options={{ headerShown: true, title: 'Page' }} />
        <ActivityIndicator size="large" color="#208AEF" />
      </SafeAreaView>
    );
  }
  if (!page) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor }]}>
        <Stack.Screen options={{ headerShown: true, title: 'Page' }} />
        <Text style={{ color: textColor }}>This page no longer exists.</Text>
      </SafeAreaView>
    );
  }

  const tokens = tokenize(page.ocrText);
  const activeCueCount = cues.filter((c) => c.reviewState !== 'removed').length;
  const unplaced = cues.filter((c) => c.charStart == null && c.reviewState !== 'removed');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor }]}>
      <Stack.Screen options={{ headerShown: true, title: `Page ${page.pageNumber}` }} />

      <ScrollView contentContainerStyle={styles.content}>
        <Image source={{ uri: page.imagePath }} style={styles.image} contentFit="contain" transition={120} />

        <View style={styles.toolbar}>
          <Text style={[styles.hint, { color: subColor }]}>
            {editing ? 'Fix any OCR mistakes, then save.' : `Tap a word to add a sound · ${activeCueCount} cue${activeCueCount === 1 ? '' : 's'}`}
          </Text>
          {!editing ? (
            <TactileButton
              style={[styles.smallBtn, { backgroundColor: cardBackground }]}
              onPress={() => {
                setDraft(page.ocrText);
                setEditing(true);
              }}
            >
              <Text style={[styles.smallBtnLabel, { color: textColor }]}>✏️ Correct text</Text>
            </TactileButton>
          ) : null}
        </View>

        {editing ? (
          <View style={styles.editWrap}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              style={[styles.input, { color: textColor, backgroundColor: inputBackground, borderColor: cardBackground }]}
              placeholder="Type the page's story text…"
              placeholderTextColor={subColor}
            />
            <View style={styles.editActions}>
              <TactileButton style={[styles.smallBtn, { backgroundColor: cardBackground }]} onPress={() => setEditing(false)}>
                <Text style={[styles.smallBtnLabel, { color: subColor }]}>Cancel</Text>
              </TactileButton>
              <TactileButton style={[styles.smallBtn, { backgroundColor: '#208AEF' }]} onPress={saveText}>
                <Text style={[styles.smallBtnLabel, { color: '#fff' }]}>Save text</Text>
              </TactileButton>
            </View>
          </View>
        ) : (
          <View style={[styles.textCard, { backgroundColor: cardBackground }]}>
            {page.ocrText ? (
              <Text style={[styles.flow, { color: textColor }]}>
                {tokens.map((t, i) => {
                  if (t.isSpace) return <Text key={i}>{t.text}</Text>;
                  const cue = cueAtRange(cues, t.start, t.end);
                  const removed = cue?.reviewState === 'removed';
                  const bg = !cue
                    ? undefined
                    : removed
                      ? 'transparent'
                      : cue.type === 'character'
                        ? 'rgba(175,82,222,0.28)'
                        : 'rgba(32,138,239,0.28)';
                  return (
                    <Text
                      key={i}
                      onPress={() => onWordPress(t)}
                      style={{
                        backgroundColor: bg,
                        textDecorationLine: removed ? 'line-through' : 'none',
                        color: removed ? subColor : textColor,
                      }}
                    >
                      {t.text}
                    </Text>
                  );
                })}
              </Text>
            ) : (
              <Text style={[styles.empty, { color: subColor }]}>
                No text was recognized. Tap “Correct text” to type it in.
              </Text>
            )}
          </View>
        )}

        {!editing && unplaced.length > 0 && (
          <View style={styles.unplaced}>
            <Text style={[styles.unplacedTitle, { color: subColor }]}>
              Cues not found in the text (tap to change / remove):
            </Text>
            {unplaced.map((c) => (
              <Pressable
                key={c.id}
                onPress={() =>
                  Alert.alert(`"${c.triggerText}" → ${c.soundId ?? 'none'}`, 'Not located in the current text.', [
                    { text: 'Change sound', onPress: () => setPicker({ mode: 'change', cue: c }) },
                    { text: 'Remove', style: 'destructive', onPress: () => setCueReviewState(c.id, 'removed').then(reload) },
                    { text: 'Cancel', style: 'cancel' },
                  ])
                }
              >
                <Text style={[styles.unplacedCue, { color: textColor }]}>
                  🔊 “{c.triggerText}” → {c.soundId ?? 'none'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Sound picker */}
      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}>
            <Text style={[styles.sheetTitle, { color: subColor }]}>
              {picker?.mode === 'add' ? `Add a sound for “${picker.token.text}”` : 'Choose a sound'}
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {EFFECT_IDS.map((id) => (
                <Pressable key={id} style={styles.soundRow} onPress={() => chooseSound(id)}>
                  <Text style={[styles.soundId, { color: textColor }]}>🔊 {id}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <TactileButton style={styles.cancelRow} onPress={() => setPicker(null)}>
              <Text style={[styles.smallBtnLabel, { color: '#ff453a' }]}>Cancel</Text>
            </TactileButton>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 14 },

  image: { width: '100%', height: 220, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.12)' },

  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  hint: { flex: 1, fontSize: 13 },

  textCard: { borderRadius: 12, padding: 14 },
  flow: { fontSize: 17, lineHeight: 30 },
  empty: { fontSize: 14, fontStyle: 'italic' },

  editWrap: { gap: 10 },
  input: { minHeight: 160, borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 16, lineHeight: 24, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },

  smallBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  smallBtnLabel: { fontSize: 14, fontWeight: '600' },

  unplaced: { gap: 6 },
  unplacedTitle: { fontSize: 12, fontWeight: '600' },
  unplacedCue: { fontSize: 14, paddingVertical: 4 },

  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, gap: 8 },
  sheetTitle: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 6 },
  soundRow: { paddingVertical: 12, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.2)' },
  soundId: { fontSize: 16 },
  cancelRow: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
});
