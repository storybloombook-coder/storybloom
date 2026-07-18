import { useEffect } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Canvas } from '@react-three/fiber/native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { KolobokScene } from './scene/KolobokScene';
import { orbit, useSceneStore } from './state/sceneStore';
import { ZONES, rad } from './config/zones';

const SWIPE_SENSITIVITY = 0.005;   // px -> radians
const FLING_SENSITIVITY = 0.00011; // px/s -> radians/frame

export function MainScreen({ onNavigate }) {
  const activeZone = useSceneStore((s) => s.activeZone);
  const encounter = useSceneStore((s) => s.encounter);
  const pendingNavigation = useSceneStore((s) => s.pendingNavigation);
  const requestNavigation = useSceneStore((s) => s.requestNavigation);
  const clearEncounter = useSceneStore((s) => s.clearEncounter);
  const consumeNavigation = useSceneStore((s) => s.consumeNavigation);

  // Encounter beat: show the line, then either navigate (zone tap)
  // or just fade (Kolobok's song). Interruptible — cleanup cancels it.
  useEffect(() => {
    if (!encounter) return undefined;
    const timer = setTimeout(() => {
      if (encounter.route) requestNavigation(encounter.route);
      else clearEncounter();
    }, encounter.route ? 1600 : 2200);
    return () => clearTimeout(timer);
  }, [encounter, requestNavigation, clearEncounter]);

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

  const goToZone = (zone) => {
    orbit.snapTarget = rad(zone.angleDeg);
  };

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
          <Text style={styles.zoneTitle}>{active?.label ?? ''}</Text>
          <Text style={styles.zoneHint}>Swipe to travel · tap a friend to visit</Text>
        </View>

        {encounter && (
          <View style={styles.bubble} pointerEvents="none">
            <Text style={styles.bubbleText}>{encounter.line}</Text>
          </View>
        )}

        <View style={styles.navRow}>
          {ZONES.map((z) => (
            <Pressable
              key={z.id}
              accessibilityRole="button"
              accessibilityLabel={z.label}
              onPress={() => goToZone(z)}
              style={[
                styles.navDot,
                { backgroundColor: z.color },
                activeZone === z.id && styles.navDotActive,
              ]}
            />
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
    gap: 14,
    marginBottom: 42,
  },
  navDot: { width: 18, height: 18, borderRadius: 9, opacity: 0.75 },
  navDotActive: {
    opacity: 1,
    transform: [{ scale: 1.35 }],
    borderWidth: 2,
    borderColor: '#ffffff',
  },
});
