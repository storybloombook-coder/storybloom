import { useEffect, useRef, useState } from 'react';
import {
  Animated, AppState, StyleSheet, View, Text, Pressable,
} from 'react-native';
import { Canvas } from '@react-three/fiber/native';
import { KolobokScene } from './scene/KolobokScene';
import { createSinglePointerDrag } from './scene/singlePointerDrag';
import { TactileButton } from './TactileButton';
import { SoundLibraryMenu } from './SoundLibraryMenu';
import GlassGlare from './GlassGlare';
import { useDeviceTilt } from './useDeviceTilt';
import {
  orbit, story, bubbleAnchor, useSceneStore,
} from './state/sceneStore';
import { refreshWeather } from './services/weather';
import { ZONES } from './config/zones';
import { t } from './config/strings';

const SWIPE_SENSITIVITY = 0.005;   // px -> radians
const FLING_SENSITIVITY = 0.00011; // px/s -> radians/frame
// grandpa-fishing (REGISTRY) + owl/moon-wink/smoke-rings (their own
// dedicated eggManager methods) + cloud-drizzle/hedgehog/magpie (fully
// self-contained in Sky.jsx/Vegetation.jsx/Magpies.jsx respectively, each
// calling recordEggFound directly -- see their own comments).
// Kept as a constant here rather than derived from the registry itself
// since most of these aren't represented as REGISTRY rows at all.
const TOTAL_EGGS = 7;
const VERTICAL_SENSITIVITY = 0.01; // px -> pitchOffset units (free-look drag)
const PITCH_OFFSET_MAX = 1.6;
const BUBBLE_WRAP_WIDTH = 280; // must match styles.bubbleWrap.width below

function createCameraDragController() {
  return createSinglePointerDrag({
    threshold: 4,
    onStart: () => {
      orbit.freeLookActive = true;
    },
    onChange: (event) => {
      story.lastInputAt = Date.now();
      orbit.lastDragAt = Date.now();
      if (orbit.mode === 'story') orbit.lookingAway = true;
      orbit.snapTarget = null;
      orbit.angle += -event.changeX * SWIPE_SENSITIVITY;
      orbit.velocity = 0;
      // Free-look: vertical drag nudges camera height/tilt on top of
      // whichever framing (zone or story) is active; CameraRig eases this
      // back to 0 the instant freeLookActive goes false below.
      orbit.pitchOffset = Math.max(
        -PITCH_OFFSET_MAX,
        Math.min(
          PITCH_OFFSET_MAX,
          orbit.pitchOffset - event.changeY * VERTICAL_SENSITIVITY,
        ),
      );
    },
    onEnd: (event) => {
      orbit.velocity = -event.velocityX * FLING_SENSITIVITY;
      orbit.freeLookActive = false;
    },
    onCancel: () => {
      orbit.velocity = 0;
      orbit.freeLookActive = false;
    },
  });
}

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
export function Scene3D({ onNavigate, focused = true, onLocaleChange }) {
  const activeZone = useSceneStore((s) => s.activeZone);
  const encounter = useSceneStore((s) => s.encounter);
  const narration = useSceneStore((s) => s.narration);
  const storyPlaying = useSceneStore((s) => s.storyPlaying);
  const storyCompleted = useSceneStore((s) => s.storyCompleted);
  const fadeBlack = useSceneStore((s) => s.fadeBlack);
  const pendingNavigation = useSceneStore((s) => s.pendingNavigation);
  const locale = useSceneStore((s) => s.locale);
  const setLocale = useSceneStore((s) => s.setLocale);
  const requestNavigation = useSceneStore((s) => s.requestNavigation);
  const consumeNavigation = useSceneStore((s) => s.consumeNavigation);
  const discoveredEggCount = useSceneStore((s) => s.discoveredEggs.length);
  // One accelerometer subscription shared by every button's own GlassGlare
  // below -- see useDeviceTilt's own comment for why.
  const { tiltX, tiltY } = useDeviceTilt();

  // Live feedback: tapping the egg counter shows a small tooltip underneath
  // it, auto-hiding after a few seconds (tapping again re-shows it).
  const [showEggTooltip, setShowEggTooltip] = useState(false);
  const eggTooltipTimer = useRef(null);
  const onEggCounterTap = () => {
    setShowEggTooltip(true);
    if (eggTooltipTimer.current) clearTimeout(eggTooltipTimer.current);
    eggTooltipTimer.current = setTimeout(() => setShowEggTooltip(false), 2500);
  };
  useEffect(() => () => {
    if (eggTooltipTimer.current) clearTimeout(eggTooltipTimer.current);
  }, []);

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

  // Dialogue bubble anchor: BubbleAnchor.jsx (inside the Canvas) projects
  // the current speaker's world position to screen space every GL frame and
  // publishes it to the transient `bubbleAnchor` bridge; this rAF loop reads
  // it and drives the bubble's left/bottom imperatively via Animated, so it
  // tracks the speaker smoothly without a React re-render every frame (same
  // "outside React" reasoning as `orbit`/`storyMotion`, just bridged across
  // the Canvas/RN boundary instead of read directly in a useFrame).
  const bubbleLeft = useRef(new Animated.Value(-1000)).current;
  const bubbleBottom = useRef(new Animated.Value(140)).current;
  useEffect(() => {
    let raf;
    const tick = () => {
      if (bubbleAnchor.visible) {
        bubbleLeft.setValue(bubbleAnchor.centerX - BUBBLE_WRAP_WIDTH / 2);
        bubbleBottom.setValue(bubbleAnchor.bottom);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bubbleLeft, bubbleBottom]);

  // R3F-native's Canvas already owns a JS PanResponder for scene-object
  // taps. Wrapping it in RNGH created two competing responder systems: the
  // Canvas won the first finger, and RNGH often activated only after a
  // second finger arrived. CameraDragShield listens inside R3F's existing
  // responder instead, so one finger can steer immediately while scene-
  // object taps continue to use that same input stream.
  const [dragController] = useState(createCameraDragController);

  useEffect(() => () => {
    dragController.pointerCancel();
  }, [dragController]);

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

  // Sound-library menu (SOUND_SPEC.md §2): identical 40x40 circle, stacked
  // directly above the eye toggle on the same right-side column.
  const [soundMenuOpen, setSoundMenuOpen] = useState(false);

  // Live feedback: on the 2D->3D fade, the Canvas visibly "resized smaller
  // twice then stretched" -- expo-gl creates its GL surface at a default
  // size the instant it mounts (mid-transition, before layout settles) then
  // corrects in a couple of steps. Fix: measure THIS container once via
  // onLayout (the real post-layout box, NOT useWindowDimensions -- that
  // over-measured and split the layout in an earlier attempt) and don't
  // mount the Canvas until we can hand it that exact pixel size, so the
  // surface is born full-size and only ever fades in.
  // Live feedback (still reported, worse than described): "switch between 2d
  // and 3d is not done fully" -- a screenshot showed the Canvas PERMANENTLY
  // stuck at a too-narrow width (not a transient jump that settles). Root
  // cause: onLayout can fire mid-transition with a stale/transient
  // measurement, and since nothing else about this View's own layout
  // changes afterward, onLayout simply never fires again to correct it --
  // the debounce below only helps when a SECOND onLayout event actually
  // arrives, which isn't guaranteed. Fix: independently re-verify the real
  // current size a few times over the following ~1.5s via the root View's
  // own measureInWindow (an imperative, on-demand measurement, NOT another
  // onLayout-driven callback) and correct if it disagrees with what's
  // currently applied -- a "trust but verify" safety net on top of the
  // existing onLayout path rather than a replacement for it.
  const [canvasSize, setCanvasSize] = useState(null);
  const canvasSizeTimer = useRef(null);
  const rootViewRef = useRef(null);
  const recheckTimers = useRef([]);
  useEffect(() => () => {
    if (canvasSizeTimer.current) clearTimeout(canvasSizeTimer.current);
    recheckTimers.current.forEach(clearTimeout);
  }, []);
  const applyCanvasSize = (width, height) => {
    setCanvasSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  };
  const scheduleRecheck = () => {
    recheckTimers.current.forEach(clearTimeout);
    recheckTimers.current = [150, 500, 1200].map((delay) => setTimeout(() => {
      rootViewRef.current?.measureInWindow((_x, _y, w, h) => {
        if (w > 0 && h > 0) applyCanvasSize(w, h);
      });
    }, delay));
  };
  const onRootLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    if (canvasSizeTimer.current) clearTimeout(canvasSizeTimer.current);
    if (canvasSize === null) {
      applyCanvasSize(width, height);
      scheduleRecheck();
    } else {
      canvasSizeTimer.current = setTimeout(() => applyCanvasSize(width, height), 120);
    }
  };

  const onMainMenu = () => requestNavigation('/');
  const onToggleLocale = () => {
    const next = locale === 'ru' ? 'en' : 'ru';
    setLocale(next);
    // Live feedback: "language changes throughout the entire app" -- bubble
    // this up to the app shell (see MainScreen.jsx's own comment) so the 2D
    // home screen picks it up too, not just this scene's own store.
    onLocaleChange?.(next);
  };

  const active = ZONES.find((z) => z.id === activeZone);
  // Story narration wins the bubble slot; interactive dialogue otherwise.
  const bubbleText = narration ?? encounter?.line;

  return (
    <View ref={rootViewRef} style={styles.root} onLayout={onRootLayout}>
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        {canvasSize ? (
          <Canvas
            style={{ width: canvasSize.width, height: canvasSize.height }}
            dpr={2}
            gl={{ antialias: true }}
            frameloop={frameloop}
            camera={{ fov: 45, near: 0.5, far: 60 }}
          >
            <KolobokScene dragController={dragController} />
          </Canvas>
        ) : null}
      </View>

      {/* UI overlay: real RN views, screen-reader friendly */}
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.zoneCard} pointerEvents="none">
          <Text style={styles.zoneTitle}>{active ? t(`zone.${active.id}`, locale) : ''}</Text>
          <Text style={styles.zoneHint}>{t('ui.hint', locale)}</Text>
        </View>

        {/* Easter-egg discovery counter, top-right -- see TOTAL_EGGS' own
            comment for what's counted. Deliberately unlabeled (just "N/7"):
            EASTER_EGGS.md never specifies UI copy for this, and a bare
            fraction reads as "there's more to find" without spelling out
            what, which fits the hidden/discoverable spirit of the feature.
            Live feedback: tapping it now shows a small tooltip underneath. */}
        <View style={styles.eggCounterColumn} pointerEvents="box-none">
          <Pressable style={styles.eggCounterWrap} onPress={onEggCounterTap}>
            <Text style={styles.eggCounterText}>{discoveredEggCount}/{TOTAL_EGGS}</Text>
          </Pressable>
          {showEggTooltip && (
            <View style={styles.eggTooltipWrap} pointerEvents="none">
              <Text style={styles.eggTooltipText}>{t('ui.eggTooltip', locale)}</Text>
            </View>
          )}
        </View>

      </View>

      {/* Dialogue bubble: anchored above whoever is actually speaking
          (BubbleAnchor.jsx projects their world position to screen space
          every frame; the rAF loop above feeds it into these two Animated
          values), rather than a single fixed screen position. */}
      {bubbleText && (
        <Animated.View
          style={[styles.bubbleWrap, { left: bubbleLeft, bottom: bubbleBottom }]}
          pointerEvents="none"
        >
          <View style={[styles.bubble, narration && styles.narrationBubble]}>
            <Text style={styles.bubbleText}>{bubbleText}</Text>
          </View>
        </Animated.View>
      )}

      {/* ▶ / ❚❚ / restart (STORY_SPEC §1 + one-round loop stop): bottom-
          right, 40x40, controls the tale. Once a full round finishes the
          loop stops itself (see StoryDirector's 'stopped' mode) and this
          swaps to a restart icon; tapping it starts back at chapter 0. */}
      <TactileButton
        accessibilityRole="button"
        accessibilityLabel={
          storyPlaying ? t('ui.pauseTale', locale)
            : storyCompleted ? t('ui.restartTale', locale)
              : t('ui.playTale', locale)
        }
        onPress={onPlayPause}
        style={styles.storyButton}
        innerStyle={styles.buttonVisual}
        hitSlop={8}
      >
        <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
        <Text style={styles.storyButtonText}>{storyPlaying ? '❚❚' : storyCompleted ? '⟲' : '▶'}</Text>
      </TactileButton>

      {/* Eye toggle: identical 40x40 circle, stacked directly above the
          play/pause button. ON (default) = Kolobok chases the camera and it
          soft-snaps onto zones, same as always; OFF = a genuinely detached
          free camera (CameraRig.jsx skips the zone soft-snap, Kolobok.jsx
          freezes his own angle) -- dimmed background is the only visual
          state change, same eye glyph either way. */}
      <TactileButton
        accessibilityRole="button"
        accessibilityLabel={cameraFollow ? t('ui.disableFollow', locale) : t('ui.enableFollow', locale)}
        onPress={onToggleFollow}
        style={[styles.storyButton, styles.followButton]}
        innerStyle={[styles.buttonVisual, !cameraFollow && styles.followButtonOff]}
        hitSlop={8}
      >
        <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
        <Text style={styles.storyButtonText}>👁</Text>
      </TactileButton>

      {/* Sound-library button: identical 40x40 circle, stacked directly
          above the eye toggle. Opens the SoundLibraryMenu modal, listing
          every fixed sound slot grouped by category (SOUND_SPEC.md §2). */}
      <TactileButton
        accessibilityRole="button"
        accessibilityLabel={t('ui.soundLibrary', locale)}
        onPress={() => setSoundMenuOpen(true)}
        style={[styles.storyButton, styles.soundButton]}
        innerStyle={styles.buttonVisual}
        hitSlop={8}
      >
        <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
        <Text style={styles.storyButtonText}>♪</Text>
      </TactileButton>

      {/* Main-menu button: identical 40x40 circle, mirrored to the play/
          pause button on the opposite side of the screen. Labelled "2D"
          (not a hamburger glyph) so leaving the scene reads as the exact
          mirror of the home screen's "3D" button that got you in here --
          same coordinates too (see MainScreen/home screen styles), so the
          swap between the two screens feels like one continuous control
          rather than two unrelated buttons. */}
      <TactileButton
        accessibilityRole="button"
        accessibilityLabel={t('ui.mainMenu', locale)}
        onPress={onMainMenu}
        style={[styles.storyButton, styles.menuButton]}
        innerStyle={styles.buttonVisual}
        hitSlop={8}
      >
        <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
        <Text style={styles.storyButtonText}>2D</Text>
      </TactileButton>

      {/* Language toggle: identical 40x40 circle, stacked directly above the
          main-menu button (mirroring how the eye toggle stacks above
          play/pause). Shows the language a tap switches TO, matching the
          menu labels' own convention of showing the destination, not the
          current state. */}
      <TactileButton
        accessibilityRole="button"
        accessibilityLabel={t('ui.switchLanguage', locale)}
        onPress={onToggleLocale}
        style={[styles.storyButton, styles.localeButton]}
        innerStyle={styles.buttonVisual}
        hitSlop={8}
      >
        <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
        <Text style={styles.storyButtonText}>{locale === 'ru' ? 'EN' : 'RU'}</Text>
      </TactileButton>

      {/* Finale fade-to-black overlay; never intercepts touches. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, styles.fadeOverlay, { opacity: fadeOpacity }]}
      />

      <Vignette />

      <SoundLibraryMenu
        visible={soundMenuOpen}
        onClose={() => setSoundMenuOpen(false)}
        locale={locale}
      />
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
  eggCounterColumn: {
    position: 'absolute',
    top: 64,
    right: 14,
    alignItems: 'flex-end',
  },
  eggCounterWrap: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eggCounterText: { fontSize: 13, fontWeight: '700', color: '#2e2a22' },
  eggTooltipWrap: {
    marginTop: 6,
    maxWidth: 160,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  eggTooltipText: { fontSize: 12, color: '#2e2a22', textAlign: 'center' },
  // Absolutely positioned (left/bottom driven by the rAF loop above) rather
  // than laid out in the flex overlay, so it can track wherever the actual
  // speaker projects to on screen. Fixed width (matching BUBBLE_WRAP_WIDTH)
  // so the anchor math -- centerX minus half this width -- lines up with
  // where the content actually renders; children center within it.
  bubbleWrap: {
    position: 'absolute',
    width: BUBBLE_WRAP_WIDTH,
    alignItems: 'center',
  },
  bubble: {
    maxWidth: '90%',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  // STORY_SPEC §4: narration reads distinct from interactive dialogue via a
  // thin left accent in the izba gold.
  narrationBubble: {
    borderLeftWidth: 3,
    borderLeftColor: '#d9a441',
  },
  bubbleText: { fontSize: 15, color: '#2e2a22', textAlign: 'center' },
  // Position/size only -- this is the OUTER TactileButton Pressable's own
  // style (it owns the touch target since these are laid out via
  // position:absolute). Visual look lives in buttonVisual below, on the
  // inner view that actually scales/darkens on press.
  storyButton: {
    position: 'absolute',
    right: 14,
    bottom: 96,
    width: 40,
    height: 40,
  },
  buttonVisual: {
    borderRadius: 20,
    // Translucent (was 0.85) -- same reasoning as menuPill above, so the
    // GlassGlare rim/hotspot riding on top actually reads against it.
    backgroundColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyButtonText: { fontSize: 13, fontWeight: '700', color: '#2e2a22' },
  followButton: { bottom: 144 }, // stacked directly above storyButton (96 + 40 + 8 gap)
  followButtonOff: { backgroundColor: 'rgba(255,255,255,0.22)' },
  soundButton: { bottom: 192 }, // stacked directly above followButton (144 + 40 + 8 gap)
  menuButton: { left: 14, right: undefined }, // mirrored to storyButton's right:14
  localeButton: { left: 14, right: undefined, bottom: 144 }, // stacked above menuButton
  fadeOverlay: { backgroundColor: '#000000' },
  vignetteAnchor: { position: 'absolute', width: 0, height: 0 },
});
