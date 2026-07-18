# Kolobok main screen — circular greybox prototype

> **Implementing with Claude Code?** Start with `CLAUDE.md`, then `SPEC.md`.
> Full art, animation, story, weather, and strings specs live in `docs/`.
>
> NOTE: in this greybox, tapping a zone still navigates and the overlay has
> five dots. The final design supersedes this: navigation moves to the
> 3-plaque crossroads stone at the island center (SPEC.md "Navigation"),
> zones become story-only, and the dots become three menu buttons. This is
> implemented in Phase 3.

A turntable-island prototype of the Kolobok fairytale main screen for React Native.
Five story zones sit on the rim of a round forest island at 72° intervals; the camera
orbits the island, and Kolobok rolls along an inner circular path, keeping pace with
your view. The circle removes the fairytale's "ending" problem: the fox leads straight
back to Grandma's izba, and the story loops forever.

## What works in this greybox

- Swipe left/right to spin the camera around the island, with inertia and a soft
  snap to the nearest zone.
- Kolobok (yellow sphere, non-spinning eyes) rolls along his path with correct
  arc-length rotation and speed-based squash-and-stretch.
- Tap Kolobok: he hops and sings his song.
- Tap a zone landmark: the encounter line appears for ~1.6 s, then the screen
  raises a navigation request (currently `console.log`; wire your router in
  `MainScreen.jsx`).
- Bottom nav dots duplicate every destination (the guaranteed, accessible path);
  pressing one glides the camera to that zone.
- The zone the camera faces "breathes" gently and is announced in the top card.

## Install

Assumes an existing Expo (or bare RN with expo modules) project.

```
npx expo install expo-gl
npm i three @react-three/fiber zustand
npx expo install react-native-gesture-handler react-native-reanimated
```

Wrap your app root in `GestureHandlerRootView`, then render `MainScreen`
from `src/MainScreen.jsx`.

Known-good version pairing matters for R3F native — if you hit a blank canvas,
pin `three` to the version listed in the `@react-three/fiber` release notes for
your fiber version before debugging anything else.

## File map

```
src/
  config/zones.js        layout constants, zone list, circle math (single source of truth)
  state/sceneStore.js    zustand store (discrete events) + transient `orbit` object (per-frame)
  scene/CameraRig.jsx    orbit integration, inertia, soft snap, active-zone detection
  scene/Kolobok.jsx      rolling ball, squash-and-stretch, tap-to-sing
  scene/ZoneLandmarks.jsx greybox izba + animal totems, hitboxes, active pulse
  scene/Island.jsx       ground disc, path ring, instanced trees
  scene/KolobokScene.jsx scene root: lights, fog, composition
  MainScreen.jsx         canvas + gestures + UI overlay + navigation hook
```

## Architecture contract

- The scene never imports the router; the UI never touches the scene graph.
  They meet only in `sceneStore` (discrete events) and `orbit` (per-frame values).
- Gestures and animation mutate `orbit` directly — no React state at 60 fps.
- Zone taps play the encounter beat first, then raise `pendingNavigation`.
  The `useEffect` in `MainScreen` is interruptible: navigating away or a new
  encounter cancels the pending one.

## Tuning knobs

- `config/zones.js` — all radii, zone angles, colors, dialogue lines.
- `CameraRig.jsx` — `FRICTION`, `SNAP_SPEED`, `SNAP_THRESHOLD`.
- `Kolobok.jsx` — `FOLLOW_LAG` (how lazily he trails the camera), `LEAD`
  (where he sits in frame).
- `MainScreen.jsx` — swipe/fling sensitivity.

## Upgrade path (greybox -> production)

1. **Gestures to the UI thread.** Replace the `runOnJS` pan callbacks with
   reanimated shared values; read them in `useFrame` via `.value`. Do this
   before adding any heavy JS work to the app.
2. **GLB art pass.** Swap primitive geometry in `ZoneLandmarks` and `Kolobok`
   for Draco-compressed GLB models via `useGLTF`; add `glb` to
   `metro.config.js` `assetExts`.
3. **Encounter timelines.** Replace the single dialogue line with per-zone
   animation timelines (animal steps out, Kolobok sings, rolls on).
4. **Battery discipline.** Add a sleep mode after ~10 s idle (pause particles,
   slow the mixer), pause the canvas on `AppState` background and when a
   navigated screen fully covers it.
5. **Atmosphere.** Day/night color lerp from the device clock, gyro parallax
   via `expo-sensors`, haptics on taps via `expo-haptics`, song audio via
   `expo-audio`.
6. **Fox easter egg.** Five taps on the fox: she licks her lips, fade to
   black, Kolobok respawns at the izba — the loop restarts.
