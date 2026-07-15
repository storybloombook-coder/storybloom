// ConfirmDeleteModal.tsx — the bottom-sheet "delete this?" confirmation,
// shared by the library screen (books) and the book-detail page list
// (pages), so swipe-to-reveal-a-bin always ends in the same confirmation
// step rather than deleting immediately on tap.

import { Modal, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import TactileButton from './TactileButton';

export default function ConfirmDeleteModal({
  visible,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const subColor = isDark ? '#9a9a9e' : '#6b6b70';
  const sheetBackground = isDark ? '#1c1c1e' : '#fff';
  const badgeBackground = isDark ? '#2c2c2e' : '#e6e6ea';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={[styles.sheet, { backgroundColor: sheetBackground }]}>
          <Text style={styles.emoji}>🗑️</Text>
          <Text style={[styles.title, { color: textColor }]}>{title}</Text>
          <Text style={[styles.message, { color: subColor }]}>{message}</Text>
          <View style={styles.buttonWrap}>
            <TactileButton style={[styles.button, styles.deleteButton]} onPress={onConfirm}>
              <Text style={[styles.buttonLabel, { color: '#ff453a' }]}>{confirmLabel}</Text>
            </TactileButton>
          </View>
          <View style={styles.buttonWrap}>
            <TactileButton style={[styles.button, { backgroundColor: badgeBackground }]} onPress={onCancel}>
              <Text style={[styles.buttonLabel, { color: textColor }]}>Cancel</Text>
            </TactileButton>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 12,
    alignItems: 'center',
  },
  emoji: { fontSize: 34 },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  message: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 4 },
  // TactileButton only styles its own inner view, not the Pressable that
  // actually sizes itself in the flex layout — so a plain wrapper carries the
  // real width/flex constraint. Needed here because `sheet` centers its
  // children (alignItems: 'center'), which otherwise shrinks buttons to text.
  buttonWrap: { alignSelf: 'stretch' },
  button: { width: '100%', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  deleteButton: { backgroundColor: 'rgba(255,69,58,0.15)', borderWidth: 2, borderColor: '#ff453a' },
  buttonLabel: { fontSize: 17, fontWeight: '600', color: '#fff' },
});
