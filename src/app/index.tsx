import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Modal, Pressable, StyleSheet, Text, View,
  type StyleProp, type ViewStyle, useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { BlurView } from 'expo-blur';
import GlassGlare from '../components/GlassGlare';
import TactileButton from '../components/TactileButton';
import { t, useLocaleStore } from '../lib/i18n';
import { useDeviceTilt } from '../lib/useDeviceTilt';

// TEMPORARY: the dev-client APK currently installed for on-device testing
// predates expo-blur being added, so it has no native ExpoBlurView linked --
// rendering one crashes to the dev-client's own blank error screen. Flip
// this back to true (and delete GlassPane, using BlurView directly again)
// once a rebuilt dev-client/preview is available.
const USE_BLUR = false;

/** Swaps between the real frosted-glass BlurView and a flat semi-transparent
 *  tint with the exact same footprint, so every call site below doesn't
 *  need its own if/else -- see USE_BLUR above. */
function GlassPane({ tint, style }: { tint: 'light' | 'dark'; style: StyleProp<ViewStyle> }) {
  if (USE_BLUR) return <BlurView intensity={40} tint={tint} style={style} />;
  return <View style={[style, { backgroundColor: tint === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)' }]} />;
}

// Looping background: a short (10s, already 2x slow-motion), cropped,
// blurred, and darkened capture of the 3D scene's own opening establishing
// shot (the crossroads stone + izba, static camera -- see
// assets/videos/menu-background.mp4's own history for how it was made).
// Muted and non-interactive -- purely decorative behind the menu.
const BACKGROUND_VIDEO = require('../../assets/videos/menu-background.mp4');

// Kept out of the string table on purpose: it's an address, identical in
// every language, and duplicating it per locale is how one copy quietly
// goes stale.
const SUPPORT_EMAIL = 'storybloombook@gmail.com';

export default function HomeScreen() {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const backgroundColor = isDark ? '#000' : '#fff';
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  // One accelerometer subscription shared by every glass button's own
  // GlassGlare overlay below -- see lib/useDeviceTilt's own comment for why.
  const { tiltX, tiltY } = useDeviceTilt();
  const [infoOpen, setInfoOpen] = useState(false);

  const backgroundPlayer = useVideoPlayer(BACKGROUND_VIDEO, (player) => {
    player.loop = true;
    player.muted = true;
    player.play();
  });

  // The player's own .play() above only ever fires once, at creation --
  // expo-router keeps this screen mounted (not destroyed) when navigating
  // away, and coming back doesn't re-trigger it. Android in particular can
  // leave the underlying ExoPlayer paused after the view was hidden behind
  // another screen, so without this the background freezes on a static
  // frame the next time this screen regains focus instead of resuming.
  useFocusEffect(
    useCallback(() => {
      backgroundPlayer.play();
    }, [backgroundPlayer])
  );

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
        <Text style={[styles.title, { color: textColor }]}>{t('home.title', locale)}</Text>
        <Text style={[styles.subtitle, { color: textColor }]}>{t('home.subtitle', locale)}</Text>

        <View style={styles.menu}>
          <Link href="/add-book" asChild>
            <TactileButton style={styles.button}>
              <GlassPane tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={12} intensity={0.4} />
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>{t('home.addBook', locale)}</Text>
            </TactileButton>
          </Link>
          <Link href="/create-story" asChild>
            <TactileButton style={styles.button}>
              <GlassPane tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={12} intensity={0.4} />
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>{t('home.createStory', locale)}</Text>
            </TactileButton>
          </Link>
          <Link href="/library" asChild>
            <TactileButton style={styles.button}>
              <GlassPane tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={12} intensity={0.4} />
              <Text style={StyleSheet.flatten([styles.buttonLabel, { color: textColor }])}>{t('home.myLibrary', locale)}</Text>
            </TactileButton>
          </Link>
        </View>
      </View>

      <View style={styles.cornerButtonWrap}>
        <Link href="/kolobok-preview" asChild>
          <TactileButton style={styles.cornerButton}>
            <GlassPane tint={isDark ? 'dark' : 'light'} style={styles.cornerButtonBlur} />
            <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
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
          accessibilityLabel={t('home.switchLanguage', locale)}
          onPress={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
          style={styles.cornerButton}
        >
          <GlassPane tint={isDark ? 'dark' : 'light'} style={styles.cornerButtonBlur} />
          <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
          <Text style={StyleSheet.flatten([styles.cornerButtonLabel, { color: textColor }])}>
            {locale === 'ru' ? 'EN' : 'RU'}
          </Text>
        </TactileButton>
      </View>

      {/* Info: mirrors the 3D scene's burger exactly -- same size, same
          bottom offset, opposite corner -- so the two screens' controls
          land in the same places. */}
      <View style={styles.infoButtonWrap}>
        <TactileButton
          accessibilityRole="button"
          accessibilityLabel={t('home.infoLabel', locale)}
          onPress={() => setInfoOpen(true)}
          style={styles.cornerButton}
        >
          <GlassPane tint={isDark ? 'dark' : 'light'} style={styles.cornerButtonBlur} />
          <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
          <Text style={StyleSheet.flatten([styles.cornerButtonLabel, { color: textColor }])}>i</Text>
        </TactileButton>
      </View>

      <Modal
        visible={infoOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoOpen(false)}
      >
        <Pressable style={styles.infoBackdrop} onPress={() => setInfoOpen(false)}>
          {/* Claims the responder so taps on the card itself don't dismiss. */}
          <View style={styles.infoCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.infoTitle}>{t('home.infoTitle', locale)}</Text>
            <Text style={styles.infoBody}>{t('home.infoBody', locale)}</Text>
            <Text selectable style={styles.infoEmail}>{SUPPORT_EMAIL}</Text>
            <Pressable
              accessibilityRole="button"
              style={styles.infoDismiss}
              onPress={() => setInfoOpen(false)}
            >
              <Text style={styles.infoDismissText}>{t('common.close', locale)}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
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
    // A real frosted-glass pane (see the BlurView rendered as this
    // button's first child) rather than a flat tint -- the border is
    // brighter on top than the sides/bottom, like light catching the
    // top edge of a real glass panel.
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderTopColor: 'rgba(255,255,255,0.7)',
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
    borderColor: 'rgba(255,255,255,0.25)',
    borderTopColor: 'rgba(255,255,255,0.7)',
  },
  // Matches cornerButton's own circular radius so the BlurView clips to a
  // circle instead of a square corner poking out past the button's edge.
  cornerButtonBlur: {
    ...StyleSheet.absoluteFill,
    borderRadius: 20,
  },
  cornerButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  // Opposite corner to the 3D/language pair, at the same bottom offset the
  // 3D scene's burger uses, so the two screens' controls line up.
  infoButtonWrap: {
    position: 'absolute',
    right: 14,
    bottom: 144,
    width: 40,
    height: 40,
  },
  infoBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,16,10,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  infoCard: {
    backgroundColor: '#fffbf4',
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 22,
    gap: 10,
    alignItems: 'center',
  },
  infoTitle: { fontSize: 17, fontWeight: '700', color: '#2e2a22', textAlign: 'center' },
  infoBody: { fontSize: 14, lineHeight: 20, color: '#4a463c', textAlign: 'center' },
  // selectable on the <Text> itself so the address can be copied -- there's
  // no mail client guaranteed on a test device, and a dead mailto: link
  // would be worse than plain copyable text.
  infoEmail: { fontSize: 15, fontWeight: '700', color: '#8a5a2b', textAlign: 'center' },
  infoDismiss: { marginTop: 6, paddingHorizontal: 16, paddingVertical: 8 },
  infoDismissText: { fontSize: 14, fontWeight: '600', color: '#8a5a2b' },
});
