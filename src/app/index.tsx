import { Link } from 'expo-router';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TactileButton from '../components/TactileButton';

export default function HomeScreen() {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const backgroundColor = isDark ? '#000' : '#fff';
  const buttonBackground = isDark ? '#1c1c1e' : '#f2f2f2';

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
          <Link href="/library" asChild>
            <TactileButton style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}>
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>My Library</Text>
            </TactileButton>
          </Link>
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
});
