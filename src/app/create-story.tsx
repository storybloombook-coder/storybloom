// create-story.tsx — dictate an original story instead of photographing one.
//
// Same downstream pipeline as a photographed book: creates a Book + Pages in
// SQLite, then the existing page editor (src/app/page/[id].tsx) lets the
// parent attach sound effects and ambient exactly the same way. The only
// difference is where the text comes from — Vosk speech-to-text instead of
// OCR — and pages have no source photo (imagePath is '').

import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TactileButton from '../components/TactileButton';
import { createBook, createPage, setBookPrepStatus, updatePagePrepResult } from '../lib/db';
import { createVoskRecognizer } from '../lib/speech/vosk';
import type { SpeechLang } from '../lib/speech/types';
import type { BookLanguage } from '../lib/types';

type Phase = 'setup' | 'writing' | 'saving';

export default function CreateStoryScreen() {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const subColor = isDark ? '#9a9a9e' : '#6b6b70';
  const backgroundColor = isDark ? '#000' : '#fff';
  const cardBackground = isDark ? '#1c1c1e' : '#f4f4f6';
  const langBorderColor = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';

  const [phase, setPhase] = useState<Phase>('setup');
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<BookLanguage>('en');
  const [pages, setPages] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [dictateStatus, setDictateStatus] = useState<'idle' | 'loading' | 'listening'>('idle');
  const [dictateFinal, setDictateFinal] = useState('');
  const [dictatePartial, setDictatePartial] = useState('');
  const [infoModal, setInfoModal] = useState<{ emoji: string; title: string; message: string } | null>(null);

  const recognizerRef = useRef<ReturnType<typeof createVoskRecognizer> | null>(null);

  useEffect(() => {
    return () => {
      recognizerRef.current?.unload().catch(() => {});
    };
  }, []);

  function startStory() {
    if (!title.trim()) {
      setInfoModal({ emoji: '✏️', title: 'Name your story', message: 'Give your story a title before you start.' });
      return;
    }
    setPhase('writing');
  }

  async function startDictation() {
    setDictateStatus('loading');
    try {
      if (!recognizerRef.current) recognizerRef.current = createVoskRecognizer();
      await recognizerRef.current.load(language as SpeechLang);
      await recognizerRef.current.start({
        lang: language as SpeechLang,
        onPartial: setDictatePartial,
        onResult: (text) => {
          setDictateFinal((prev) => (prev ? `${prev} ${text}` : text));
          setDictatePartial('');
        },
      });
      setDictateStatus('listening');
    } catch (e: any) {
      setDictateStatus('idle');
      setInfoModal({ emoji: '🎙️', title: 'Dictation unavailable', message: e?.message ?? String(e) });
    }
  }

  async function stopDictation() {
    try {
      await recognizerRef.current?.stop();
    } catch {}
    setDictateStatus('idle');
    const text = [dictateFinal, dictatePartial].filter(Boolean).join(' ').trim();
    if (text) setDraft((prev) => (prev ? `${prev} ${text}` : text));
    setDictateFinal('');
    setDictatePartial('');
  }

  function discardCurrentPage() {
    if (dictateStatus === 'listening') recognizerRef.current?.stop().catch(() => {});
    setDictateStatus('idle');
    setDraft('');
    setDictateFinal('');
    setDictatePartial('');
  }

  function addPageAndContinue() {
    const text = draft.trim();
    if (!text) return;
    setPages((prev) => [...prev, text]);
    setDraft('');
  }

  async function finishStory() {
    const finalText = draft.trim();
    const allPages = finalText ? [...pages, finalText] : pages;
    if (allPages.length === 0) {
      setInfoModal({
        emoji: '📖',
        title: 'Nothing to save yet',
        message: 'Dictate (or type) at least one page before finishing.',
      });
      return;
    }
    setPhase('saving');
    try {
      const book = await createBook({ title: title.trim(), source: 'dictation', language });
      for (let i = 0; i < allPages.length; i++) {
        const page = await createPage({ bookId: book.id, pageNumber: i + 1, imagePath: '' });
        await updatePagePrepResult(page.id, {
          pageType: 'story',
          ocrText: allPages[i],
          backgroundScene: null,
          ambientSoundId: null,
        });
      }
      await setBookPrepStatus(book.id, 'ready', false);
      router.replace({ pathname: '/book/[id]', params: { id: book.id } });
    } catch (e: any) {
      setPhase('writing');
      setInfoModal({ emoji: '⚠️', title: 'Could not save story', message: e?.message ?? String(e) });
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Create a Story' }} />

      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView contentContainerStyle={styles.content}>
          {phase === 'setup' && (
            <View style={styles.setupWrap}>
              <Text style={styles.bigEmoji}>📖✨</Text>
              <Text style={[styles.setupTitle, { color: textColor }]}>Create a Story</Text>
              <Text style={[styles.setupSubtitle, { color: subColor }]}>
                Dictate your own fairytale, page by page — then add sound effects and ambient just
                like a photographed book.
              </Text>

              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Story title, e.g. The Brave Little Fox"
                placeholderTextColor={subColor}
                style={[styles.titleInput, { color: textColor, backgroundColor: cardBackground }]}
              />

              <Text style={[styles.langLabel, { color: textColor }]}>What language?</Text>
              <View style={styles.langToggleRow}>
                <View style={styles.langBtnWrap}>
                  <TactileButton
                    style={[
                      styles.langBtn,
                      language === 'en'
                        ? { backgroundColor: 'rgba(32,138,239,0.15)', borderColor: '#208AEF' }
                        : { backgroundColor: cardBackground, borderColor: langBorderColor },
                    ]}
                    onPress={() => setLanguage('en')}
                  >
                    <Text style={[styles.langBtnLabel, { color: language === 'en' ? '#208AEF' : textColor }]}>
                      English
                    </Text>
                  </TactileButton>
                </View>
                <View style={styles.langBtnWrap}>
                  <TactileButton
                    style={[
                      styles.langBtn,
                      language === 'ru'
                        ? { backgroundColor: 'rgba(32,138,239,0.15)', borderColor: '#208AEF' }
                        : { backgroundColor: cardBackground, borderColor: langBorderColor },
                    ]}
                    onPress={() => setLanguage('ru')}
                  >
                    <Text style={[styles.langBtnLabel, { color: language === 'ru' ? '#208AEF' : textColor }]}>
                      Русский
                    </Text>
                  </TactileButton>
                </View>
              </View>

              <TactileButton style={[styles.primaryButton, styles.dictateStartButton]} onPress={startStory}>
                <Text style={[styles.primaryButtonLabel, styles.dictateStartLabel]}>🎙️ Start dictating</Text>
              </TactileButton>
            </View>
          )}

          {phase === 'writing' && (
            <View style={styles.writingWrap}>
              <Text style={[styles.pageIndicator, { color: subColor }]}>Page {pages.length + 1}</Text>

              <TextInput
                value={draft}
                onChangeText={setDraft}
                multiline
                placeholder="Tap 'Start dictating' and read this page aloud, or type it yourself…"
                placeholderTextColor={subColor}
                style={[styles.draftInput, { color: textColor, backgroundColor: cardBackground, borderColor: cardBackground }]}
              />

              {dictateStatus === 'listening' && (dictateFinal || dictatePartial) ? (
                <View style={[styles.liveTranscript, { backgroundColor: cardBackground }]}>
                  <Text style={{ color: textColor, fontSize: 14, lineHeight: 20 }}>
                    {dictateFinal}
                    {dictatePartial ? (
                      <Text style={{ color: subColor }}>{dictateFinal ? ' ' : ''}{dictatePartial}</Text>
                    ) : null}
                  </Text>
                </View>
              ) : null}

              {dictateStatus === 'listening' ? (
                <TactileButton
                  style={[styles.actionButton, { backgroundColor: 'rgba(255,69,58,0.15)', borderWidth: 2, borderColor: '#ff453a' }]}
                  onPress={stopDictation}
                >
                  <Text style={[styles.actionButtonLabel, { color: '#ff453a' }]}>⏹ Stop dictating</Text>
                </TactileButton>
              ) : (
                <TactileButton
                  style={[styles.actionButton, { backgroundColor: 'rgba(255,69,58,0.15)', borderWidth: 2, borderColor: '#ff453a' }]}
                  onPress={startDictation}
                  disabled={dictateStatus === 'loading'}
                >
                  <Text style={[styles.actionButtonLabel, { color: '#ff453a' }]}>
                    {dictateStatus === 'loading' ? 'Loading model…' : '🎙️ Start dictating'}
                  </Text>
                </TactileButton>
              )}

              <View style={styles.writingActionsRow}>
                <TactileButton style={[styles.smallBtn, { backgroundColor: cardBackground }]} onPress={discardCurrentPage}>
                  <Text style={[styles.smallBtnLabel, { color: '#ff453a' }]}>Clear page</Text>
                </TactileButton>
                <TactileButton
                  style={[styles.smallBtn, { backgroundColor: cardBackground }]}
                  onPress={addPageAndContinue}
                  disabled={!draft.trim()}
                >
                  <Text style={[styles.smallBtnLabel, { color: textColor }]}>➕ Add page & continue</Text>
                </TactileButton>
              </View>

              {pages.length > 0 && (
                <Text style={[styles.hint, { color: subColor }]}>
                  {pages.length} page{pages.length === 1 ? '' : 's'} saved so far
                </Text>
              )}

              <TactileButton
                style={[styles.primaryButton, { backgroundColor: 'rgba(47,179,68,0.15)', borderWidth: 2, borderColor: '#2fb344' }]}
                onPress={finishStory}
              >
                <Text style={[styles.primaryButtonLabel, { color: '#2fb344' }]}>🏁 Finish story</Text>
              </TactileButton>
            </View>
          )}

          {phase === 'saving' && (
            <View style={styles.savingWrap}>
              <ActivityIndicator size="large" color="#208AEF" />
              <Text style={{ color: textColor }}>Saving your story…</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={infoModal !== null} transparent animationType="fade" onRequestClose={() => setInfoModal(null)}>
        <View style={styles.infoOverlay}>
          <View style={[styles.infoCard, { backgroundColor: cardBackground }]}>
            <Text style={styles.infoEmoji}>{infoModal?.emoji}</Text>
            <Text style={[styles.infoTitle, { color: textColor }]}>{infoModal?.title}</Text>
            <Text style={[styles.infoMessage, { color: subColor }]}>{infoModal?.message}</Text>
            <TactileButton
              style={[styles.primaryButton, { backgroundColor: 'rgba(32,138,239,0.15)', borderWidth: 2, borderColor: '#208AEF' }]}
              onPress={() => setInfoModal(null)}
            >
              <Text style={[styles.primaryButtonLabel, { color: '#208AEF' }]}>OK</Text>
            </TactileButton>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 20, gap: 14 },

  setupWrap: { gap: 12, alignItems: 'center', paddingTop: 24 },
  bigEmoji: { fontSize: 48 },
  setupTitle: { fontSize: 24, fontWeight: '800' },
  setupSubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  titleInput: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 17,
  },
  langLabel: { fontSize: 14, fontWeight: '600', alignSelf: 'flex-start' },
  langToggleRow: { flexDirection: 'row', gap: 8, width: '100%' },
  langBtnWrap: { flex: 1 },
  langBtn: { width: '100%', borderRadius: 10, paddingVertical: 12, borderWidth: 1.5, alignItems: 'center' },
  langBtnLabel: { fontSize: 15, fontWeight: '600' },

  writingWrap: { gap: 12 },
  pageIndicator: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  draftInput: {
    minHeight: 160,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  liveTranscript: { borderRadius: 12, padding: 12 },
  writingActionsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },

  hint: { fontSize: 13, textAlign: 'center' },

  savingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80 },

  actionButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  actionButtonLabel: { fontSize: 16, fontWeight: '600', color: '#fff' },

  primaryButton: { width: '100%', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  primaryButtonLabel: { color: '#fff', fontSize: 17, fontWeight: '700' },
  // The setup screen's dictate CTA: red, taller, with room to breathe above it.
  dictateStartButton: {
    marginTop: 24,
    paddingVertical: 20,
    backgroundColor: 'rgba(255,69,58,0.15)',
    borderWidth: 2,
    borderColor: '#ff453a',
  },
  dictateStartLabel: { color: '#ff453a', fontSize: 18 },

  smallBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  smallBtnLabel: { fontSize: 14, fontWeight: '600' },

  infoOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  infoCard: { borderRadius: 16, padding: 24, alignItems: 'center', gap: 10, minWidth: 260, maxWidth: 320 },
  infoEmoji: { fontSize: 32 },
  infoTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  infoMessage: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 6 },
});
