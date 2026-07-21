# CLAUDE.md — working agreement for this repo

You are implementing an interactive 3D main screen for a React Native app,
based on the Kolobok fairytale. The full brief lives in:

- `SPEC.md` — mission, architecture, phases, acceptance criteria. Read first.
- `docs/ART_SPEC.md` — every model, texture, and material, with exact
  dimensions and hex values.
- `docs/ANIMATION_SPEC.md` — every animation and encounter timeline, with
  exact timings and easings.
- `docs/STORY_SPEC.md` — the autoplaying full-story cinematic loop:
  chapters, control inversion, interrupt/resume rules.
- `docs/WEATHER_SPEC.md` — live weather + true solar daylight from the
  user's location, with fallbacks.
- `docs/STRINGS.md` — the complete EN/RU copy deck.
- `docs/EASTER_EGGS.md` — the easter egg registry and all hidden
  interactions (incl. Grandpa fishing at the pond).
- `docs/POLISH_SPEC.md` — Phase 8: fake shadows, fog/mist/aerial depth,
  the wind system, reactive grass, living-frame details.
- `docs/SOUND_SPEC.md` — Phase 9: procedural audio engine and recipes.
- `docs/SEASONS_SPEC.md` — Phase 10: seasons and holiday props.
- `docs/INTEGRATION_SPEC.md` — Phase 11: badge magpie, photo mode,
  egg tally.
- `docs/VISUAL_QUALITY_SPEC.md` — Phase 12: toon shading, rim light,
  light rig, adaptive AA/dpr, shape warmth, global color grade.
- `README.md` — the existing greybox baseline and its architecture contract.

## Hard constraints

- **No external asset files.** No .glb, .png, .jpg, .mp3 downloads or imports.
  All geometry is built from Three.js primitives/BufferGeometry in code; all
  textures are generated as `THREE.DataTexture` from `Uint8Array`; all
  animation is code-driven in `useFrame` or via the timeline helper you will
  build. This is deliberate: the app must work with zero binary assets.
- **Allowed dependencies only:** `three`, `@react-three/fiber`, `zustand`,
  `expo-gl`, `react-native-gesture-handler`, `react-native-reanimated`,
  `expo-haptics`, `expo-sensors`, `expo-location`, `expo-localization`,
  `expo-audio`, `expo-file-system`, `expo-sharing` (the last three only
  from their phases: sound renders WAVs into cache at first launch — the
  repo still ships zero binary assets; sharing is for photo mode only).
  Do not add drei, physics engines, tween libraries, i18n frameworks, or
  anything else without being asked.
- **Network:** the ONLY permitted endpoint is `api.open-meteo.com`
  (weather, per docs/WEATHER_SPEC.md), via plain `fetch`, max one request
  per 5 minutes, never while backgrounded. Everything else stays offline.
- **Localization:** every user-visible string goes through `t()` from
  `src/config/strings.js` (EN/RU per docs/STRINGS.md). No hardcoded copy.
- **Never `setState` inside `useFrame`.** Per-frame values mutate refs or the
  transient `orbit` object. The zustand store is for discrete events only.
- **The scene never imports the router; the UI never touches the scene
  graph.** They communicate only via `src/state/sceneStore.js`.
- **Performance budget:** ≤ 50k triangles on screen, ≤ 40 draw calls
  (instance aggressively), no real-time shadows, `dpr` capped at 1.5,
  target 30 fps on low-end Android. Check triangle counts as you build.
- Keep `src/config/zones.js` the single source of truth for layout. New
  tunables go in config files, not magic numbers in components.

## Conventions

- JavaScript + JSX (no TypeScript migration unless asked).
- One component per file under `src/scene/`, shared builders under
  `src/scene/builders/`, textures under `src/scene/textures/`.
- Every animal component exposes the same interface:
  `{ zone, mode }` where mode ∈ 'idle' | 'encounter' | 'retreat'.
- Comment the *why* on any math that isn't obvious (angle wrapping,
  arc-length rolling, easing choices).

## Working style

- Implement in the phase order defined in SPEC.md; each phase must leave the
  app runnable. Do not start a later phase with an earlier one broken.
- After each phase, verify against that phase's acceptance criteria in
  SPEC.md and report which boxes pass.
- If the device/simulator is unavailable, still ensure the bundle compiles
  (`npx expo export --platform android` as a smoke check).
