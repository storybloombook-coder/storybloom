import { useEffect, useRef, useState } from 'react';
import {
  Animated, AppState, PixelRatio, StyleSheet, View, Text, Pressable,
} from 'react-native';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Canvas } from '@react-three/fiber/native';
import { KolobokScene } from './scene/KolobokScene';
import { createSinglePointerDrag } from './scene/singlePointerDrag';
import { TactileButton } from './TactileButton';
import { SoundLibraryMenu } from './SoundLibraryMenu';
import { isMasterEnabled, setMasterEnabled } from './services/soundEngine';
import { playSlot, prewarmSlots, setAmbienceSuspended, syncMyAmbience } from './services/soundLibrary';
import GlassGlare from './GlassGlare';
import { useDeviceTilt } from './useDeviceTilt';
import {
  atmosphereLive, orbit, story, bubbleAnchor, useSceneStore,
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
// How often the day/night ambience is re-checked. The only input is whether
// the sun is up, which moves once a day -- this just has to be sooner than a
// child would notice the wrong one playing.
const AMBIENCE_SYNC_MS = 5000;
const BUBBLE_WRAP_WIDTH = 280; // must match styles.bubbleWrap.width below

// Render resolution, decided ONCE per process and never touched again.
//
// Live feedback: "I see how the resolution switches sometimes and this is
// not good at all -- idle time passes, resolution shrinks then stretches
// back... and with the resolution change the tap area shrinks and there are
// missclicks." That was a regression from making AdaptiveQuality re-measure
// continuously: every switch reallocates the GL drawing buffer, which pops
// visibly AND reprojects the scene's raycast targets, so taps landed off
// their intended object. Runtime dpr changes are simply not worth that --
// the scene now picks one value and stays there for the whole session.
//
// min(density, 2): never render ABOVE the panel's real pixel density (pure
// waste on low-density devices), and never above 2 regardless. On a ~2.6x
// flagship this lands at 2 -- below native, so slightly soft but cheap;
// CLAUDE.md's "cap dpr at 1.5" predates the toon/rim-light pass and would
// be visibly mushy on a screen this dense, so the cap lives here instead.
// `antialias` is off on the Canvas to pay for it: MSAA is a heavy per-
// fragment cost on mobile GPUs and buys little at this density, and
// rendering more pixels without it beats fewer pixels with it.
const RENDER_DPR = Math.min(PixelRatio.get(), 2);

// Corner button stack. The burger sits at BURGER_BOTTOM (exactly where the
// eye toggle used to live) and never moves; everything else collapses onto
// it when closed and fans out from it when open -- two slots downward
// (play/pause, camera lock) and three upward (eye, sound library, mute).
const BURGER_BOTTOM = 144;
const STACK_GAP = 48; // 40px button + 8px gap, matching the old fixed stack
const STACK_SLIDE_MS = 260;

/** Slide/fade for one button in the burger stack. `bottom` is where the
 *  button sits when the menu is OPEN; closed, it rides back to the burger's
 *  own slot and fades out. Reanimated (not RN Animated) because
 *  TactileButton's outer element is a Reanimated-wrapped Pressable, which
 *  can't consume an RN Animated.Value style. */
function useStackSlide(openSv, bottom) {
  return useAnimatedStyle(() => ({
    opacity: openSv.value,
    // translateY is positive downward, while `bottom` grows upward -- hence
    // the sign flip. At open=0 every button lands exactly on BURGER_BOTTOM.
    transform: [{ translateY: (1 - openSv.value) * (bottom - BURGER_BOTTOM) }],
  }));
}

function createCameraDragController() {
  return createSinglePointerDrag({
    threshold: 4,
    onStart: () => {
      if (orbit.rotationLocked) return;
      orbit.freeLookActive = true;
    },
    onChange: (event) => {
      // Camera-lock button: swallow the drag's camera effect entirely, but
      // let the gesture itself run so singlePointerDrag's own click
      // suppression still behaves exactly as before -- taps keep working,
      // the view just doesn't move. Deliberately gated here rather than by
      // detaching the responder, which would change tap handling too.
      if (orbit.rotationLocked) return;
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
      // No fling either -- otherwise releasing a locked drag would still
      // spin the camera afterwards, which is the exact thing being locked.
      orbit.velocity = orbit.rotationLocked ? 0 : -event.velocityX * FLING_SENSITIVITY;
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
    playSlot('ui.eggCounterTap');
    setShowEggTooltip(true);
    if (eggTooltipTimer.current) clearTimeout(eggTooltipTimer.current);
    eggTooltipTimer.current = setTimeout(() => setShowEggTooltip(false), 2500);
  };
  useEffect(() => () => {
    if (eggTooltipTimer.current) clearTimeout(eggTooltipTimer.current);
  }, []);

  // Encounter beat lifecycle (show bubble, fade, clear) is owned by the
  // directors' timelines; this component only renders the current text.

  // Render every default sound to its WAV cache up front, a few per tick.
  // Otherwise the first play of each slot synthesizes it synchronously on
  // the JS thread at the exact moment it was wanted -- a stall right when
  // something is trying to be heard, on the thread this scene is bound by.
  useEffect(() => {
    prewarmSlots();
  }, []);

  // The recorded day/night ambience loops. Polled rather than driven off a
  // render: the only input that changes is whether the sun is up, which
  // moves once a day -- a subscription would re-render the whole scene for
  // it. syncMyAmbience only acts on a real change, so this is a comparison
  // every few seconds. Stops on unmount so leaving the scene leaves silence.
  useEffect(() => {
    syncMyAmbience(atmosphereLive.isNight);
    const id = setInterval(() => syncMyAmbience(atmosphereLive.isNight), AMBIENCE_SYNC_MS);
    return () => {
      clearInterval(id);
      setAmbienceSuspended(true);
      setAmbienceSuspended(false);
    };
  }, []);

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
  //
  // Sound-library menu (SOUND_SPEC.md §2): declared up here rather than next
  // to its own handler below because the frameloop gate needs it. Live
  // feedback: "the recording timer is lagging" / "the 3-2-1 countdown
  // doesn't take 3 seconds." Both are JS-thread starvation, not audio bugs
  // -- the menu is a translucent modal, so the whole 3D scene kept
  // rendering at full rate behind it and every setTimeout/setInterval the
  // recorder UI depends on landed late. The scene is almost entirely
  // occluded while the menu is open (full-width panel over a 45%-dark
  // backdrop), so freezing it there costs nearly nothing visually and hands
  // the entire frame budget to the recording UI.
  const [soundMenuOpen, setSoundMenuOpen] = useState(false);
  const frameloop = (appActive && focused && !soundMenuOpen) ? 'always' : 'never';

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
    playSlot('ui.playPause');
    story.lastInputAt = Date.now();
    if (storyPlaying) story.pauseRequest = true;
    else story.playRequest = true;
  };

  // Eye-toggle button: orbit.cameraFollow is transient (read every frame by
  // CameraRig/Kolobok, not a store field), so it needs its own local state
  // purely to re-render the icon/tint -- this component is the only writer.
  const [cameraFollow, setCameraFollow] = useState(orbit.cameraFollow);
  const onToggleFollow = () => {
    playSlot('ui.eyeToggle');
    orbit.cameraFollow = !orbit.cameraFollow;
    setCameraFollow(orbit.cameraFollow);
  };

  // Camera-lock button, same transient-plus-local-mirror shape as the eye
  // toggle above (orbit.rotationLocked is read by the drag controller, not
  // by React). Always starts unlocked: it's a deliberate "let me tap things
  // without the view sliding" mode, not a preference worth persisting.
  const [rotationLocked, setRotationLocked] = useState(orbit.rotationLocked);
  const onToggleRotationLock = () => {
    playSlot('ui.eyeToggle');
    orbit.rotationLocked = !orbit.rotationLocked;
    // A drag can be mid-flight when the lock engages; drop any fling the
    // camera was already carrying so it stops now rather than coasting on.
    if (orbit.rotationLocked) orbit.velocity = 0;
    setRotationLocked(orbit.rotationLocked);
  };

  // Burger: collapses the whole right-hand column behind one button. Closed
  // by default so the scene starts uncluttered. menuExpanded (React state)
  // exists alongside the shared value purely to drive `disabled` -- a
  // collapsed button is at opacity 0 but would still be tappable otherwise,
  // and an invisible live button under the burger is the worst kind of
  // mis-tap.
  const [menuExpanded, setMenuExpanded] = useState(false);
  const menuOpen = useSharedValue(0);
  const onToggleButtonMenu = () => {
    const next = !menuExpanded;
    playSlot(next ? 'ui.menuOpen' : 'ui.menuClose');
    setMenuExpanded(next);
    menuOpen.value = withTiming(next ? 1 : 0, { duration: STACK_SLIDE_MS });
  };
  const lockSlide = useStackSlide(menuOpen, BURGER_BOTTOM - STACK_GAP * 2);
  const playSlide = useStackSlide(menuOpen, BURGER_BOTTOM - STACK_GAP);
  const eyeSlide = useStackSlide(menuOpen, BURGER_BOTTOM + STACK_GAP);
  const soundSlide = useStackSlide(menuOpen, BURGER_BOTTOM + STACK_GAP * 2);
  const muteSlide = useStackSlide(menuOpen, BURGER_BOTTOM + STACK_GAP * 3);

  const onToggleSoundMenu = () => {
    playSlot(soundMenuOpen ? 'ui.menuClose' : 'ui.menuOpen');
    setSoundMenuOpen((v) => !v);
  };

  // Master mute toggle: identical 40x40 circle, stacked directly above the
  // sound-library button. Mirrors soundEngine's own module-level flag in
  // local state purely to re-render the icon/tint, same as cameraFollow
  // above -- this component is the only writer.
  const [soundMuted, setSoundMuted] = useState(!isMasterEnabled());
  const onToggleMute = () => {
    const next = !soundMuted;
    setMasterEnabled(!next);
    setSoundMuted(next);
  };

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
    playSlot('ui.langToggle');
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
            dpr={RENDER_DPR}
            gl={{ antialias: false }}
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
        style={[styles.storyButton, playSlide]}
        innerStyle={styles.buttonVisual}
        hitSlop={8}
        disabled={!menuExpanded}
      >
        <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
        <Text style={styles.storyButtonText}>{storyPlaying ? '❚❚' : storyCompleted ? '⟲' : '▶'}</Text>
      </TactileButton>

      {/* Camera lock: identical 40x40 circle, stacked directly BELOW the
          play/pause button. Locked = swipes no longer orbit the camera, so
          animals/props can be tapped without the view sliding away under
          the finger. Off by default, dimmed while off -- same tint
          convention as the eye toggle below. */}
      <TactileButton
        accessibilityRole="button"
        accessibilityLabel={t(rotationLocked ? 'ui.unlockCamera' : 'ui.lockCamera', locale)}
        onPress={onToggleRotationLock}
        style={[styles.storyButton, styles.cameraLockButton, lockSlide]}
        innerStyle={[styles.buttonVisual, !rotationLocked && styles.followButtonOff]}
        hitSlop={8}
        disabled={!menuExpanded}
      >
        <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
        <Text style={styles.storyButtonText}>{rotationLocked ? '🔒' : '🔓'}</Text>
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
        style={[styles.storyButton, styles.followButton, eyeSlide]}
        innerStyle={[styles.buttonVisual, !cameraFollow && styles.followButtonOff]}
        hitSlop={8}
        disabled={!menuExpanded}
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
        onPress={onToggleSoundMenu}
        style={[styles.storyButton, styles.soundButton, soundSlide]}
        innerStyle={styles.buttonVisual}
        hitSlop={8}
        disabled={!menuExpanded}
      >
        <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
        <Text style={[styles.storyButtonText, styles.soundButtonIcon]}>♪</Text>
      </TactileButton>

      {/* Master mute toggle: identical 40x40 circle, stacked directly
          above the sound-library button. */}
      <TactileButton
        accessibilityRole="button"
        accessibilityLabel={t(soundMuted ? 'ui.unmuteSound' : 'ui.muteSound', locale)}
        onPress={onToggleMute}
        style={[styles.storyButton, styles.muteButton, muteSlide]}
        innerStyle={[styles.buttonVisual, soundMuted && styles.followButtonOff]}
        hitSlop={8}
        disabled={!menuExpanded}
      >
        <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
        <Text style={styles.storyButtonText}>{soundMuted ? '🔇' : '🔊'}</Text>
      </TactileButton>

      {/* Burger: the one control in this column that's always visible, and
          the anchor the other five collapse onto. Rendered AFTER them so it
          stays on top while they slide out from underneath it. Solid fill
          (the rest are translucent) so it reads as the group's handle rather
          than one more peer. */}
      <TactileButton
        accessibilityRole="button"
        accessibilityState={{ expanded: menuExpanded }}
        accessibilityLabel={t(menuExpanded ? 'ui.closeControls' : 'ui.openControls', locale)}
        onPress={onToggleButtonMenu}
        style={[styles.storyButton, styles.burgerButton]}
        innerStyle={[styles.buttonVisual, styles.burgerVisual]}
        hitSlop={8}
      >
        <GlassGlare tiltX={tiltX} tiltY={tiltY} radius={20} intensity={0.4} />
        <Text style={[styles.storyButtonText, styles.burgerIcon]}>{menuExpanded ? '✕' : '☰'}</Text>
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
        onClose={onToggleSoundMenu}
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
  // An actual egg, not a pill: taller than it is wide with every corner at
  // 50%, which resolves to a true ellipse (RN takes percentage radii, and
  // 50% is the practical ceiling -- two adjacent corners summing past 100%
  // of a side get scaled back down, so anything larger just returns to an
  // ellipse anyway). Warm shell cream rather than plain white so it reads as
  // an egg on its own, before you notice the count inside.
  eggCounterWrap: {
    width: 34,
    height: 44,
    backgroundColor: 'rgba(253,246,232,0.55)',
    borderTopLeftRadius: '50%',
    borderTopRightRadius: '50%',
    borderBottomLeftRadius: '50%',
    borderBottomRightRadius: '50%',
    borderWidth: 1,
    borderColor: 'rgba(138,90,43,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eggCounterText: { fontSize: 12, fontWeight: '700', color: '#2e2a22' },
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
  // All five fan out from the burger at BURGER_BOTTOM (144): two below it,
  // three above, one STACK_GAP apart. These are the OPEN positions -- the
  // useStackSlide transform rides each one back onto the burger when closed.
  cameraLockButton: { bottom: 48 },
  // play/pause keeps storyButton's own base bottom: 96 -- no override needed.
  burgerButton: { bottom: 144 },
  followButton: { bottom: 192 },
  followButtonOff: { backgroundColor: 'rgba(255,255,255,0.22)' },
  soundButton: { bottom: 240 },
  muteButton: { bottom: 288 },
  // Solid, unlike every other button in this column -- see the JSX comment.
  burgerVisual: { backgroundColor: '#fffbf4' },
  burgerIcon: { fontSize: 17 },
  soundButtonIcon: {
    fontSize: 25, // live feedback: 35% smaller than the previous 39
    // Live feedback: still read too low after the first attempt --
    // textAlignVertical only centers within an EXPLICIT height, and without
    // one Text just sizes to its own intrinsic (baseline-anchored) content,
    // so it had nothing to center against. Giving it the button's own 40x40
    // box + matching lineHeight gives Android real vertical space to center
    // the glyph in, with includeFontPadding stripping the ascender/descender
    // padding that was skewing it before.
    width: 40,
    height: 40,
    lineHeight: 40,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  menuButton: { left: 14, right: undefined }, // mirrored to storyButton's right:14
  localeButton: { left: 14, right: undefined, bottom: 144 }, // stacked above menuButton
  fadeOverlay: { backgroundColor: '#000000' },
  vignetteAnchor: { position: 'absolute', width: 0, height: 0 },
});
