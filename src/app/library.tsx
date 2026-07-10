import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listBooks } from '../lib/db';
import type { Book } from '../lib/types';

const STATUS_LABEL: Record<Book['prepStatus'], string> = {
  pending: 'Pending',
  processing: 'Prepping…',
  ready: 'Ready',
  failed: 'Prep failed',
};

export default function LibraryScreen() {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const backgroundColor = isDark ? '#000' : '#fff';
  const rowBackground = isDark ? '#1c1c1e' : '#f2f2f2';

  const [books, setBooks] = useState<Book[]>([]);

  useFocusEffect(
    useCallback(() => {
      listBooks().then(setBooks);
    }, [])
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <Stack.Screen options={{ headerShown: true, title: 'My Library' }} />
      {books.length === 0 ? (
        <View style={styles.container}>
          <Text style={[styles.text, { color: textColor }]}>
            No books yet — add one to get started.
          </Text>
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={StyleSheet.flatten([styles.row, { backgroundColor: rowBackground }])}>
              <Text style={StyleSheet.flatten([styles.rowTitle, { color: textColor }])}>
                {item.title}
              </Text>
              <Text style={StyleSheet.flatten([styles.rowStatus, { color: textColor }])}>
                {STATUS_LABEL[item.prepStatus]}
                {item.hasDialogue ? ' · has dialogue' : ''}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { fontSize: 18, opacity: 0.7, textAlign: 'center' },
  list: { padding: 16, gap: 12 },
  row: { borderRadius: 12, padding: 16, marginBottom: 12 },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  rowStatus: { fontSize: 13, opacity: 0.6, marginTop: 4 },
});
