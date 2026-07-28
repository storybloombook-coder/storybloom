import { Link } from 'expo-router';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TactileButton from '../components/TactileButton';
import { t, useLocaleStore } from '../lib/i18n';

export default function HomeScreen() {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const backgroundColor = isDark ? '#000' : '#fff';
  const buttonBackground = isDark ? '#1c1c1e' : '#f2f2f2';
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <View style={styles.container}>
        <Text style={[styles.title, { color: textColor }]}>{t('title', locale)}</Text>
        <Text style={[styles.subtitle, { color: textColor }]}>{t('subtitle', locale)}</Text>

        <View style={styles.menu}>
          <Link href="/add-book" asChild>
            <TactileButton style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}>
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>{t('addBook', locale)}</Text>
            </TactileButton>
          </Link>
          <Link href="/create-story" asChild>
            <TactileButton style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}>
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>{t('createStory', locale)}</Text>
            </TactileButton>
          </Link>
          <Link href="/library" asChild>
            <TactileButton style={StyleSheet.flatten([styles.button, { backgroundColor: buttonBackground }])}>
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>{t('myLibrary', locale)}</Text>
            </TactileButton>
          </Link>
        </View>
      </View>

      <View style={styles.cornerButtonWrap}>
        <Link href="/kolobok-preview" asChild>
          <TactileButton style={StyleSheet.flatten([styles.cornerButton, { backgroundColor: buttonBackground }])}>
            <Text style={StyleSheet.flatten([styles.cornerButtonLabel, { color: textColor }])}>3D</Text>
          </TactileButton>
        </Link>
      </View>

      {/* Language toggle: identical corner button, immediately to the
          right of the 3D preview button. Shows the language a tap
          switches TO (matches the same convention the 3D scene's own
          EN/RU toggle already uses). */}
      <View style={styles.langButtonWrap}>
        <TactileButton
          accessibilityRole="button"
          accessibilityLabel={t('switchLanguage', locale)}
          onPress={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
          style={StyleSheet.flatten([styles.cornerButton, { backgroundColor: buttonBackground }])}
        >
          <Text style={StyleSheet.flatten([styles.cornerButtonLabel, { color: textColor }])}>
            {locale === 'ru' ? 'EN' : 'RU'}
          </Text>
        </TactileButton>
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
  cornerButtonWrap: {
    position: 'absolute',
    left: 16,
    bottom: 16,
    width: 44,
    height: 44,
  },
  // Immediately to the right of cornerButtonWrap (left:16 + width:44 + an
  // 8px gap).
  langButtonWrap: {
    position: 'absolute',
    left: 68,
    bottom: 16,
    width: 44,
    height: 44,
  },
  cornerButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
});
