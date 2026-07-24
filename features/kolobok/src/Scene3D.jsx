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
const VERTICAL_SENSITIVITY = 0.01; // px -> pitchOffset units (free-look drag)
const PITCH_OFFSET_MAX = 1.6;

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
export function Scene3D({ onNavigate, focused = true }) {
  const activeZone = useSceneStore((s) => s.activeZone);
  const encounter = useSceneStore((s) => s.encounter);
  const narration = useSceneStore((s) => s.narration);
  const storyPlaying = useSceneStore((s) => s.storyPlaying);
  const storyCompleted = useSceneStore((s) => s.storyCompleted);
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
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      setAppActive(st === 'active');
      if (st === 'active') {
        refreshWeather().then((w) => useSceneStore.getState().setWeatherState(w));
      }
    });
    return () => sub.remove();
  }, []);
  // `focused` (from the host route's useIsFocused, see kolobok-preview.tsx):
  // router.push keeps THIS screen mounted underneath whatever it navigated
  // to, and nothing else pauses a mounted-but-hidden Canvas -- without this,
  // the whole scene (including any autoplaying tale) keeps ticking while the
  // user is on another screen, then visibly "catches up" on return instead
  // of resuming from where they left it. Same frameloop knob as the AppState
  // pause above, just gated on a second condition.
  const frameloop = (appActive && focused) ? 'always' : 'never';

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
  // object. In story mode, dragging no longer pauses the tale -- it just
  // marks `orbit.lookingAway` so CameraRig stops correcting orbit.angle back
  // toward the story's tracked azimuth (Kolobok/narration keep going
  // regardless); CameraRig itself clears the flag and resumes the auto-
  // follow after 15s of no input (story.lastInputAt below).
  // Camera panning is single-finger drag. minDistance(4) means a stationary
  // touch (a tap) never activates the pan, so single taps still fall through
  // to the Canvas's own pointer handling to reach Kolobok/plaques/animals --
  // only an actual drag past that small threshold moves the camera. Kept low
  // so the drag engages promptly instead of feeling sticky at the start.
  // freeLookActive is set in onStart (fires only once the gesture actually
  // ACTIVATES, i.e. past minDistance), not onBegin (fires on every touch-
  // down, activated or not) -- onBegin here left a plain tap with freeLook
  // stuck true forever (onEnd never followed to reset it), which locked the
  // camera into "steering" mode after literally any tap. Live feedback:
  // "when screen tapped nothing should happen."
  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .minDistance(4)
    .runOnJS(true)
    .onStart(() => { orbit.freeLookActive = true; })
    .onChange((e) => {
      story.lastInputAt = Date.now();
      orbit.lastDragAt = Date.now();
      if (orbit.mode === 'story') orbit.lookingAway = true;
      orbit.snapTarget = null;
      orbit.angle += -e.changeX * SWIPE_SENSITIVITY;
      orbit.velocity = 0;
      // Free-look: vertical drag nudges camera height/tilt on top of
      // whichever framing (zone or story) is active; CameraRig eases this
      // back to 0 the instant freeLookActive goes false below.
      orbit.pitchOffset = Math.max(
        -PITCH_OFFSET_MAX,
        Math.min(PITCH_OFFSET_MAX, orbit.pitchOffset - e.changeY * VERTICAL_SENSITIVITY),
      );
    })
    .onEnd((e) => {
      orbit.velocity = -e.velocityX * FLING_SENSITIVITY;
      orbit.freeLookActive = false;
    });

  const onPlayPause = () => {
    story.lastInputAt = Date.now();
    if (storyPlaying) story.pauseRequest = true;
    else story.playRequest = true;
  };

  // Eye-toggle button: orbit.cameraFollow is transient (read every frame by
  // CameraRig/Kolobok, not a store field), so it needs its own local state
  // purely to re-render the icon/tint -- this component is the only writer.
  const [cameraFollow, setCameraFollow] = useState(orbit.cameraFollow);
  const onToggleFollow = () => {
    orbit.cameraFollow = !orbit.cameraFollow;
    setCameraFollow(orbit.cameraFollow);
  };

  const onMainMenu = () => requestNavigation('/');

  const active = ZONES.find((z) => z.id === activeZone);
  // Story narration wins the bubble slot; interactive dialogue otherwise.
  const bubbleText = narration ?? encounter?.line;

  return (
    <View style={styles.root}>
      <GestureDetector gesture={pan}>
        <Canvas
          style={StyleSheet.absoluteFill}
          dpr={2}
          gl={{ antialias: true }}
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

      {/* ▶ / ❚❚ / restart (STORY_SPEC §1 + one-round loop stop): bottom-
          right, 40x40, controls the tale. Once a full round finishes the
          loop stops itself (see StoryDirector's 'stopped' mode) and this
          swaps to a restart icon; tapping it starts back at chapter 0. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          storyPlaying ? t('ui.pauseTale', locale)
            : storyCompleted ? t('ui.restartTale', locale)
              : t('ui.playTale', locale)
        }
        onPress={onPlayPause}
        style={styles.storyButton}
        hitSlop={8}
      >
        <Text style={styles.storyButtonText}>{storyPlaying ? '❚❚' : storyCompleted ? '⟲' : '▶'}</Text>
      </Pressable>

      {/* Eye toggle: identical 40x40 circle, stacked directly above the
          play/pause button. ON (default) = Kolobok chases the camera and it
          soft-snaps onto zones, same as always; OFF = a genuinely detached
          free camera (CameraRig.jsx skips the zone soft-snap, Kolobok.jsx
          freezes his own angle) -- dimmed background is the only visual
          state change, same eye glyph either way. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cameraFollow ? t('ui.disableFollow', locale) : t('ui.enableFollow', locale)}
        onPress={onToggleFollow}
        style={[styles.storyButton, styles.followButton, !cameraFollow && styles.followButtonOff]}
        hitSlop={8}
      >
        <Text style={styles.storyButtonText}>👁</Text>
      </Pressable>

      {/* Main-menu button: identical 40x40 circle, mirrored to the play/
          pause button on the opposite side of the screen. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('ui.mainMenu', locale)}
        onPress={onMainMenu}
        style={[styles.storyButton, styles.menuButton]}
        hitSlop={8}
      >
        <Text style={styles.storyButtonText}>☰</Text>
      </Pressable>

      {/* Finale fade-to-black overlay; never intercepts touches. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, styles.fadeOverlay, { opacity: fadeOpacity }]}
      />

      <Vignette />
    </View>
  );
}

// POLISH_SPEC §2 vignette: plain RN overlay (not GL), transparent center ->
// rgba(20,16,10,0.16) at the corners. RN has no gradient primitive without
// a new dependency CLAUDE.md doesn't list, so this fakes the radial falloff
// with 3 concentric, low-opacity circles per corner, each centered exactly
// ON that corner point (negative left/top-or-right/bottom offsets) so only
// a quarter of each circle shows -- their overlap near the corner and
// falloff toward its edges approximates a soft radial gradient without
// ever needing a true one.
const VIGNETTE_RINGS = [
  { r: 190, alpha: 0.05 },
  { r: 120, alpha: 0.06 },
  { r: 60, alpha: 0.05 },
];
function VignetteCorner({ top, bottom, left, right }) {
  const hKey = left !== undefined ? 'left' : 'right';
  const vKey = top !== undefined ? 'top' : 'bottom';
  return (
    <View style={[styles.vignetteAnchor, { [vKey]: 0, [hKey]: 0 }]} pointerEvents="none">
      {VIGNETTE_RINGS.map((ring) => (
        <View
          key={ring.r}
          style={{
            position: 'absolute',
            width: ring.r * 2,
            height: ring.r * 2,
            borderRadius: ring.r,
            backgroundColor: `rgba(20,16,10,${ring.alpha})`,
            [vKey]: -ring.r,
            [hKey]: -ring.r,
          }}
        />
      ))}
    </View>
  );
}
function Vignette() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <VignetteCorner top left />
      <VignetteCorner top right />
      <VignetteCorner bottom left />
      <VignetteCorner bottom right />
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
  followButton: { bottom: 144 }, // stacked directly above storyButton (96 + 40 + 8 gap)
  followButtonOff: { backgroundColor: 'rgba(255,255,255,0.4)' },
  menuButton: { left: 14, right: undefined }, // mirrored to storyButton's right:14
  fadeOverlay: { backgroundColor: '#000000' },
  vignetteAnchor: { position: 'absolute', width: 0, height: 0 },
});
