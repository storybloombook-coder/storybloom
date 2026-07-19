import { useEffect, useRef, useState } from 'react';
import {
  Animated, AppState, StyleSheet, View, Text, Pressable,
} from 'react-native';
import { Canvas } from '@react-three/fiber/native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { KolobokScene } from './scene/KolobokScene';
import { orbit, story, useSceneStore } from './state/sceneStore';
import { refreshWeather } from './services/weather';
import { ZONES } from './config/zones';
import { MENU } from './config/menu';
import { t } from './config/strings';

const SWIPE_SENSITIVITY = 0.005;   // px -> radians
const FLING_SENSITIVITY = 0.00011; // px/s -> radians/frame
const STORY_INTERRUPT_PAN_PX = 12; // STORY_SPEC §1: any pan > 12px interrupts

// The actual 3D branch (Canvas, gesture wiring, the zone card + encounter
// bubble + the stone's accessibility-twin pill row -- all of it only makes
// sense over a moving scene). Deliberately its own file: MainScreen
// conditionally `require()`s this module rather than import-ing it
// statically, so three/@react-three/fiber/expo-gl are never even evaluated
// when the app is in flat mode (see MainScreen.jsx).
//
// No onError prop here: this R3F-native version's Canvas doesn't expose one
// -- it catches its own internal errors and re-throws them during render
// instead (confirmed by reading react-three-fiber-native's source), which
// MainScreen's wrapping ErrorBoundary already catches. That's the real
// rescue path; a second onError plumbing line would just be dead code.
export function Scene3D({ onNavigate }) {
  const activeZone = useSceneStore((s) => s.activeZone);
  const encounter = useSceneStore((s) => s.encounter);
  const narration = useSceneStore((s) => s.narration);
  const storyPlaying = useSceneStore((s) => s.storyPlaying);
  const fadeBlack = useSceneStore((s) => s.fadeBlack);
  const pendingNavigation = useSceneStore((s) => s.pendingNavigation);
  const locale = useSceneStore((s) => s.locale);
  const requestNavigation = useSceneStore((s) => s.requestNavigation);
  const consumeNavigation = useSceneStore((s) => s.consumeNavigation);

  // Encounter beat lifecycle (show bubble, fade, clear) is owned by the
  // directors' timelines; this component only renders the current text.

  // The one place the scene touches your router: host passes onNavigate.
  useEffect(() => {
    if (!pendingNavigation) return;
    if (onNavigate) onNavigate(pendingNavigation);
    else console.log('[kolobok] navigate ->', pendingNavigation);
    consumeNavigation();
  }, [pendingNavigation, onNavigate, consumeNavigation]);

  // AppState pause (ANIMATION_SPEC §6 / WEATHER_SPEC §6): backgrounded ->
  // stop the frameloop entirely (no renders, no weather requests); active ->
  // resume + a foreground weather refresh (service debounces to 1 per 5min).
  const [frameloop, setFrameloop] = useState('always');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      setFrameloop(st === 'active' ? 'always' : 'never');
      if (st === 'active') {
        refreshWeather().then((w) => useSceneStore.getState().setWeatherState(w));
      }
    });
    return () => sub.remove();
  }, []);

  // Finale gulp fade (STORY_SPEC §3 ch8): plain RN Animated (no new deps).
  // Out = 300ms to black; in = 900ms back, matching the chapter table.
  const fadeOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeOpacity, {
      toValue: fadeBlack ? 1 : 0,
      duration: fadeBlack ? 300 : 900,
      useNativeDriver: true,
    }).start();
  }, [fadeBlack, fadeOpacity]);

  // Gesture wiring: JS-thread callbacks writing into the transient `orbit`
  // object. In story mode a pan past 12px raises the interrupt flag
  // (StoryDirector consumes it and hands control back); orbit.angle keeps
  // accumulating regardless, which is harmless mid-story since CameraRig
  // overwrites it every frame until the handback actually happens.
  const panAccum = useRef(0);
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onBegin(() => { panAccum.current = 0; })
    .onChange((e) => {
      story.lastInputAt = Date.now();
      panAccum.current += Math.abs(e.changeX);
      if (orbit.mode === 'story' && panAccum.current > STORY_INTERRUPT_PAN_PX) {
        story.interruptRequest = true;
      }
      orbit.snapTarget = null;
      orbit.angle += -e.changeX * SWIPE_SENSITIVITY;
      orbit.velocity = 0;
    })
    .onEnd((e) => {
      orbit.velocity = -e.velocityX * FLING_SENSITIVITY;
    });

  const onPlayPause = () => {
    story.lastInputAt = Date.now();
    if (storyPlaying) story.pauseRequest = true;
    else story.playRequest = true;
  };

  const active = ZONES.find((z) => z.id === activeZone);
  // Story narration wins the bubble slot; interactive dialogue otherwise.
  const bubbleText = narration ?? encounter?.line;

  return (
    <View style={styles.root}>
      <GestureDetector gesture={pan}>
        <Canvas
          style={StyleSheet.absoluteFill}
          dpr={[1, 1.5]}
          frameloop={frameloop}
          camera={{ fov: 45, near: 0.5, far: 60 }}
        >
          <KolobokScene />
        </Canvas>
      </GestureDetector>

      {/* UI overlay: real RN views, screen-reader friendly */}
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.zoneCard} pointerEvents="none">
          <Text style={styles.zoneTitle}>{active ? t(`zone.${active.id}`, locale) : ''}</Text>
          <Text style={styles.zoneHint}>{t('ui.hint', locale)}</Text>
        </View>

        {bubbleText && (
          <View
            style={[styles.bubble, narration && styles.narrationBubble]}
            pointerEvents="none"
          >
            <Text style={styles.bubbleText}>{bubbleText}</Text>
          </View>
        )}

        {/* The crossroads stone's accessibility twin (SPEC.md "Navigation"):
            mirrors the 3D plaques 1:1 so the menu never depends on tapping
            precisely inside the Canvas. Zone travel stays gesture-only.
            Dimmed to 60% while the tale plays (STORY_SPEC §1) -- still
            tappable: stone/menu navigation always works, even mid-story. */}
        <View style={[styles.navRow, storyPlaying && styles.navRowDimmed]}>
          {MENU.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={t(item.labelKey, locale)}
              onPress={() => requestNavigation(item.route)}
              style={styles.menuPill}
            >
              <Text style={styles.menuPillText}>{t(item.labelKey, locale)}</Text>
              <View style={[styles.menuPillUnderline, { backgroundColor: item.accent }]} />
            </Pressable>
          ))}
        </View>
      </View>

      {/* ▶ / ❚❚ (STORY_SPEC §1): bottom-right, 40x40, controls the tale. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={storyPlaying ? t('ui.pauseTale', locale) : t('ui.playTale', locale)}
        onPress={onPlayPause}
        style={styles.storyButton}
        hitSlop={8}
      >
        <Text style={styles.storyButtonText}>{storyPlaying ? '❚❚' : '▶'}</Text>
      </Pressable>

      {/* Finale fade-to-black overlay; never intercepts touches. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, styles.fadeOverlay, { opacity: fadeOpacity }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#bfe3f2' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  zoneCard: { alignItems: 'center', marginTop: 64 },
  zoneTitle: { fontSize: 22, fontWeight: '600', color: '#2e2a22' },
  zoneHint: { fontSize: 13, color: '#4a463c', marginTop: 4, opacity: 0.8 },
  bubble: {
    alignSelf: 'center',
    maxWidth: '80%',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 8,
  },
  // STORY_SPEC §4: narration reads distinct from interactive dialogue via a
  // thin left accent in the izba gold.
  narrationBubble: {
    borderLeftWidth: 3,
    borderLeftColor: '#d9a441',
  },
  bubbleText: { fontSize: 15, color: '#2e2a22', textAlign: 'center' },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 42,
    paddingHorizontal: 16,
  },
  navRowDimmed: { opacity: 0.6 },
  menuPill: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
  },
  menuPillText: { fontSize: 13, fontWeight: '600', color: '#2e2a22', textAlign: 'center' },
  menuPillUnderline: { width: 22, height: 3, borderRadius: 2, marginTop: 6 },
  storyButton: {
    position: 'absolute',
    right: 14,
    bottom: 96,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyButtonText: { fontSize: 13, fontWeight: '700', color: '#2e2a22' },
  fadeOverlay: { backgroundColor: '#000000' },
});
