import { useEffect } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Canvas } from '@react-three/fiber/native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { KolobokScene } from './scene/KolobokScene';
import { orbit, useSceneStore } from './state/sceneStore';
import { ZONES } from './config/zones';
import { MENU } from './config/menu';
import { t } from './config/strings';

const SWIPE_SENSITIVITY = 0.005;   // px -> radians
const FLING_SENSITIVITY = 0.00011; // px/s -> radians/frame
const ENCOUNTER_DURATION_MS = 2200; // zones never navigate -- always just fade

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
  const pendingNavigation = useSceneStore((s) => s.pendingNavigation);
  const locale = useSceneStore((s) => s.locale);
  const requestNavigation = useSceneStore((s) => s.requestNavigation);
  const clearEncounter = useSceneStore((s) => s.clearEncounter);
  const consumeNavigation = useSceneStore((s) => s.consumeNavigation);

  // Encounter beat: show the line, then fade. Zones never navigate (SPEC.md
  // "Navigation" -- only the crossroads stone does). Interruptible —
  // cleanup cancels it.
  useEffect(() => {
    if (!encounter) return undefined;
    const timer = setTimeout(clearEncounter, ENCOUNTER_DURATION_MS);
    return () => clearTimeout(timer);
  }, [encounter, clearEncounter]);

  // The one place the scene touches your router: host passes onNavigate.
  useEffect(() => {
    if (!pendingNavigation) return;
    if (onNavigate) onNavigate(pendingNavigation);
    else console.log('[kolobok] navigate ->', pendingNavigation);
    consumeNavigation();
  }, [pendingNavigation, onNavigate, consumeNavigation]);

  // Greybox gesture wiring: JS-thread callbacks writing into the
  // transient `orbit` object. Upgrade path: reanimated shared values
  // read inside useFrame for fully UI-thread panning.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onChange((e) => {
      orbit.snapTarget = null;
      orbit.angle += -e.changeX * SWIPE_SENSITIVITY;
      orbit.velocity = 0;
    })
    .onEnd((e) => {
      orbit.velocity = -e.velocityX * FLING_SENSITIVITY;
    });

  const active = ZONES.find((z) => z.id === activeZone);

  return (
    <View style={styles.root}>
      <GestureDetector gesture={pan}>
        <Canvas
          style={StyleSheet.absoluteFill}
          dpr={[1, 1.5]}
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

        {encounter && (
          <View style={styles.bubble} pointerEvents="none">
            <Text style={styles.bubbleText}>{encounter.line}</Text>
          </View>
        )}

        {/* The crossroads stone's accessibility twin (SPEC.md "Navigation"):
            mirrors the 3D plaques 1:1 so the menu never depends on tapping
            precisely inside the Canvas. Zone travel stays gesture-only. */}
        <View style={styles.navRow}>
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
  bubbleText: { fontSize: 15, color: '#2e2a22', textAlign: 'center' },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 42,
    paddingHorizontal: 16,
  },
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
});
