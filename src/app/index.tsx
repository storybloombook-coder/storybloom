import { Link, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TactileButton from '../components/TactileButton';

export default function HomeScreen() {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const backgroundColor = isDark ? '#000' : '#fff';
  const buttonBackground = isDark ? '#1c1c1e' : '#f2f2f2';
  const subtleBorder = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <View style={styles.container}>
        <Text style={[styles.title, { color: textColor }]}>Storybloom</Text>
        <Text style={[styles.subtitle, { color: textColor }]}>Read a book to life.</Text>

        <View style={styles.menu}>
          <Link href="/add-book" asChild>
            <TactileButton style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}>
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>Add a Book</Text>
            </TactileButton>
          </Link>
          <Link href="/create-story" asChild>
            <TactileButton style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}>
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>Create a Story</Text>
            </TactileButton>
          </Link>
          <View style={styles.splitRow}>
            <View style={styles.splitBtnWrap}>
              <TactileButton
                style={[styles.splitBtn, { backgroundColor: buttonBackground, borderColor: subtleBorder }]}
                onPress={() => router.push('/library')}
              >
                <Text style={[styles.buttonLabel, { color: textColor }]}>My Library</Text>
                {/* Own Pressable, not the button's onPress — jumps straight into
                    the Favorites-filtered view instead of the default all-books
                    one. The in-Library header star still toggles this too. */}
                <Pressable
                  hitSlop={10}
                  onPress={() => router.push({ pathname: '/library', params: { favorites: '1' } })}
                  style={styles.splitBtnStar}
                >
                  <Text style={styles.splitBtnStarIcon}>☆</Text>
                </Pressable>
              </TactileButton>
            </View>
            <View style={styles.splitBtnWrap}>
              <TactileButton
                style={[styles.splitBtn, { backgroundColor: buttonBackground, borderColor: subtleBorder }]}
                onPress={() => router.push('/recordings')}
              >
                <Text style={[styles.buttonLabel, { color: textColor }]}>My Recordings</Text>
              </TactileButton>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.6,
    marginBottom: 24,
  },
  menu: {
    width: '100%',
    gap: 12,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
  // My Library / My Recordings — same shape as the language-choice pair on
  // the Create a Story screen (equal-width, side-by-side, outlined).
  splitRow: { flexDirection: 'row', gap: 12, width: '100%' },
  splitBtnWrap: { flex: 1 },
  splitBtn: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitBtnStar: { position: 'absolute', top: 4, right: 6, padding: 6 },
  splitBtnStarIcon: { fontSize: 15, color: '#f5b301' },
});
