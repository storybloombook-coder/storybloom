import { Link } from 'expo-router';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import TactileButton from '../components/TactileButton';
import { t, useLocaleStore } from '../lib/i18n';

// Looping background: a short (10s, already 2x slow-motion), cropped,
// blurred, and darkened capture of the 3D scene's own opening establishing
// shot (the crossroads stone + izba, static camera -- see
// assets/videos/menu-background.mp4's own history for how it was made).
// Muted and non-interactive -- purely decorative behind the menu.
const BACKGROUND_VIDEO = require('../../assets/videos/menu-background.mp4');

export default function HomeScreen() {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const backgroundColor = isDark ? '#000' : '#fff';
  // Solid-ish fill (55% opacity) so the buttons read clearly over the
  // busier background video, with the light border (see styles.button/
  // cornerButton) still outlining each one.
  const buttonBackground = isDark ? 'rgba(28,28,30,0.55)' : 'rgba(242,242,242,0.55)';
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  const backgroundPlayer = useVideoPlayer(BACKGROUND_VIDEO, (player) => {
    player.loop = true;
    player.muted = true;
    player.play();
  });

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <VideoView
        player={backgroundPlayer}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        pointerEvents="none"
      />
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
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
  // Matches the 3D scene's own menuButton coordinates exactly
  // (features/kolobok/src/Scene3D.jsx: left:14, bottom:96, 40x40) -- that
  // button is this one's mirror (labelled "2D", returns here), so keeping
  // both at the identical screen position makes the swap between the two
  // screens read as one continuous button instead of two unrelated ones.
  cornerButtonWrap: {
    position: 'absolute',
    left: 14,
    bottom: 96,
    width: 40,
    height: 40,
  },
  // Matches the 3D scene's own localeButton coordinates exactly (stacked
  // directly above menuButton there: bottom:144 = 96 + 40 + 8 gap).
  langButtonWrap: {
    position: 'absolute',
    left: 14,
    bottom: 144,
    width: 40,
    height: 40,
  },
  cornerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  cornerButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
});
