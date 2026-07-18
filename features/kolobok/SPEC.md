# SPEC.md — Kolobok interactive main screen

## Mission

Turn the existing greybox prototype (see README.md) into a finished, art-complete
interactive 3D main screen: a circular "turntable island" telling the Kolobok
fairytale. The user spins the island by swiping; Kolobok — a living round bun —
rolls along a circular path past five story zones (Grandma's izba, hare meadow,
wolf forest, bear thicket, fox clearing). Tapping a zone plays a short story
encounter, then raises a navigation request into the host app. The screen is both
decoration and navigation.

On top of this, the scene plays the COMPLETE fairytale by itself: an
autoplaying ~64 s cinematic loop where Kolobok is baked at the izba, escapes
every animal, is caught by the fox, and is reborn at Grandma's oven — forever,
until the user touches the screen and takes over. Full behavior in
docs/STORY_SPEC.md.

The fairytale, for context: Grandma bakes a round bun (Kolobok); he comes alive
and rolls away. A hare, a wolf, and a bear each threaten to eat him; each time he
sings "I ran away from Grandma, I ran away from Grandpa — and I'll run away from
you!" and escapes. The fox flatters him, pretends to be deaf, lures him close,
and eats him. On our main screen the fox succeeds ONLY in the scripted story
loop and the hidden easter egg — both end with rebirth at the izba, so the
mascot is never simply "gone". In interactive free mode she never catches him.

## What already exists (do not rebuild, extend)

The greybox in `src/` is the baseline and its architecture contract is final:

- `config/zones.js` — layout constants, zone list, circle math.
- `state/sceneStore.js` — zustand store (discrete events) + transient `orbit`
  object (per-frame values). Gestures write to `orbit`; `useFrame` reads it.
- `scene/CameraRig.jsx` — orbit + inertia + soft snap + active zone detection.
- `scene/Kolobok.jsx` — rolling sphere w/ arc-length spin + squash-and-stretch.
- `scene/ZoneLandmarks.jsx`, `scene/Island.jsx` — placeholder geometry you will
  replace per docs/ART_SPEC.md.
- `MainScreen.jsx` — canvas, pan gesture, UI overlay, navigation hook.

## Deliverables

1. **Art pass** — all models, materials, and procedural textures per
   docs/ART_SPEC.md (Kolobok with a face, izba, hare, wolf, bear, fox,
   birches, spruces, bushes, mushrooms, flowers, ground with zone tinting,
   sky with sun/moon/clouds).
2. **Animation pass** — all idle behaviors, encounter timelines, Kolobok
   expressions, and the fox easter egg per docs/ANIMATION_SPEC.md, driven by
   a small timeline helper you build (`src/scene/timeline.js`).
3. **Story pass** — the autoplaying full-tale cinematic loop with
   interrupt/resume, per docs/STORY_SPEC.md.
4. **Atmosphere pass** — TRUE daylight and LIVE weather from the user's
   location per docs/WEATHER_SPEC.md (sunrise/sunset/twilight, clear/
   clouds/rain/snow/fog/storm), izba window glow, fireflies, chimney
   smoke, gyro parallax, background forest ring.
5. **Feel pass** — haptics on taps, sleep mode after idle, AppState pause.
6. **Localization** — every user-visible string in EN and RU per
   docs/STRINGS.md.
7. **Easter eggs** — the hidden-interaction registry and full egg set per
   docs/EASTER_EGGS.md (Grandpa fishing, owl, hedgehog, dizzy Kolobok,
   moon wink, cloud drizzle, smoke rings).

## Navigation: the crossroads stone (3-button menu)

The host app's main menu has exactly THREE destinations. They live on a
fairytale waymarker stone at the island center (model: ART_SPEC §12) — the
camera always looks at the center, so the menu is on screen at every
rotation. Zones do NOT navigate; their taps play story encounters only.

- `src/config/menu.js`: `MENU = [{ id:'one', labelKey:'ui.menu.one',
  route:'PLACEHOLDER_ROUTE_1', accent:'#d9a441' }, ...]` — three entries,
  accents `#d9a441` / `#8fbf6a` / `#d9722f`. Labels come from
  docs/STRINGS.md (currently PLACEHOLDER_MENU_1..3 — the only unresolved
  values in the package; swap them when the product owner supplies names).
- Tapping a stone plaque OR its overlay twin →
  `requestNavigation(menu.route)`.
- Host integration: `MainScreen` accepts an `onNavigate(route)` prop and
  calls it from the pendingNavigation effect (keep the console.log fallback
  when the prop is absent). This keeps the package router-agnostic — the
  host app wires react-navigation/expo-router in one line.
- Overlay: replace the five zone dots with three labeled pill buttons
  (bottom center, min height 44, `accessibilityRole="button"`, text from
  the menu label, accent underline per item). Zone travel remains
  gesture-only (swipe); the top zone card still names where you are.
- Deep links: `app://menu/{id}` → `onNavigate(route)`; `app://zone/{id}` →
  camera `snapTarget` to that zone (no navigation).

## Scene modes: 3D scene vs flat menu

`sceneMode: '3d' | 'flat'` — the whole experience has a flat fallback so
navigation NEVER depends on WebGL.

- Props on `MainScreen`: `initialSceneMode`, `onSceneModeChange(mode)`,
  `onSceneError(err)`. The host app persists the mode (this package adds no
  storage dependency). Default when `initialSceneMode` is absent:
  `AccessibilityInfo.isReduceMotionEnabled` → `flat`, else `3d`.
- **Flat mode** (`src/FlatMenu.jsx`): pure RN, zero three.js/GL cost — the
  3D branch is loaded via conditional `require()` so no Canvas, textures,
  or frame loop exist in flat mode. Layout: vertical stack of the three
  menu pill buttons (same `config/menu.js`, same accents, min height 56),
  on a `#f6e7c8` → `#efe0d0` gradient (two stacked Views, no libs), with a
  small static mascot mark: amber circle + two dot eyes built from Views.
  Same `onNavigate` contract, same accessibility labels.
- **Toggle**: small icon button, top-right corner in BOTH modes
  (labels `ui.toggle3d` / `ui.toggleFlat` from STRINGS.md, min touch 44).
  Switching to `3d` mounts the scene fresh; switching to `flat` unmounts it
  fully (GL released).
- **Auto-rescue**: an ErrorBoundary wraps the 3D branch. A mount crash or
  two GL context losses → switch to `flat`, call `onSceneError`, keep the
  toggle available to retry 3D. The user always has a working menu.
- Story mode, weather fetches, sensors, and haptics all exist ONLY inside
  the 3D branch; flat mode makes zero network requests and reads no
  sensors.

## Implementation phases (each must leave the app runnable)

### Phase 1 — Foundations
- `src/scene/textures/proceduralTextures.js`: DataTexture builders
  (speckle, stripes, noise) per ART_SPEC §1.
- `src/scene/timeline.js`: timeline helper per ANIMATION_SPEC §1.
- `src/config/atmosphere.js`: palette tables per ART_SPEC §8 +
  WEATHER_SPEC §1 (sunrise/sunset rows).
- `src/config/strings.js` + `t()` helper with full EN/RU deck per
  docs/STRINGS.md (expo-localization locale detection).
- `src/config/menu.js`: three menu entries per "Navigation" above.

Acceptance: app runs unchanged visually; helpers covered by a small
`__tests__/timeline.test.js` (plain node test of timing math).

### Phase 2 — Kolobok character
- Replace greybox ball: bread texture, crust tint, cheeks, full face
  (eyes, brows, mouth) per ART_SPEC §2; blink, expressions, hop, sing
  per ANIMATION_SPEC §2.

Acceptance: blink occurs every 3–5 s; tap → hop + sing with mouth animation;
rolling squash-and-stretch still works; face never spins with the dough.

### Phase 3 — Environment
- Island ground with per-zone vertex tinting; dirt path; birch + spruce
  instancing; bushes, mushrooms, flowers scattered per zone per ART_SPEC §4–6.
- Sky dome, sun/moon, clouds per ART_SPEC §7.
- Per-zone camera framing table per ART_SPEC §10 / ANIMATION_SPEC §10.
- Crossroads stone menu (ART_SPEC §12) incl. bitmap-font plaque labels,
  overlay pill buttons, `onNavigate` prop wiring; remove zone navigation.
- Background forest ring + hills (ART_SPEC §13); pre-built hidden snow
  caps (WEATHER_SPEC §4).
- Scene modes: `FlatMenu.jsx`, mode toggle, ErrorBoundary auto-rescue,
  conditional `require()` isolation per "Scene modes" above.

Acceptance: ≤ 45 draw calls (log `renderer.info.render.calls` in dev);
each zone visually distinct at a glance; camera framing eases per zone;
stone plaques + overlay buttons both fire `onNavigate` in RU and EN;
horizon shows treeline and hills through fog; flat mode renders and
navigates with no GL context created (verify via `renderer` absence);
forcing a throw inside the Canvas lands on FlatMenu; 30 fps maintained.

### Phase 4 — Characters and encounters
- Replace totems with hare, wolf, bear, fox models per ART_SPEC §3; idle
  loops per ANIMATION_SPEC §3; full encounter timelines per §4–5 (izba uses
  its own tap beat, §9), wired to zone taps and to the existing
  pendingNavigation flow (encounter first, navigation after — interruptible).
- Zone ambient life and micro-characters per ANIMATION_SPEC §9 and
  ART_SPEC §11 (grandma silhouette, ridge bird, butterflies, crow, fog
  wisps, bees, leaves, feather).

Acceptance: every zone tap plays its scripted beat then raises navigation;
tapping elsewhere mid-beat cancels cleanly; stone plaques and menu
buttons navigate; each
zone shows its ambient life, with active-zone extras appearing only on
the faced zone.

### Phase 5 — Story mode
- `src/scene/StoryDirector.jsx`, control inversion (`orbit.mode`), story
  variants of encounter timelines, birth + fox-finale + rebirth chapters,
  interrupt/resume rules, ▶/❚❚ overlay button — everything per
  docs/STORY_SPEC.md.

Acceptance: STORY_SPEC §5 in full (loop timing, 600 ms interrupt, 8 s
resume, reduced-motion opt-out).

### Phase 6 — Atmosphere, weather, and feel
- Location + Open-Meteo + solar position services, weather state mapping,
  rain/snow particles, snow caps, storm flashes, twilight blending — all
  per docs/WEATHER_SPEC.md.
- Window glow, fireflies, smoke, gyro parallax, haptics, idle sleep mode,
  AppState pause per ANIMATION_SPEC §6 and ART_SPEC §8. The sleep timer
  only runs when story mode is off (STORY_SPEC §1).

Acceptance: WEATHER_SPEC §6 in full (real sun cycle, 7 forceable weather
states with 4 s transitions, airplane-mode fallback, request budget); app
backgrounded → render loop paused; with story off, 10 s idle → particle
systems halved and frame skip active.

### Phase 7 — Easter eggs + polish
- Easter egg registry and ALL eggs per docs/EASTER_EGGS.md, including the
  pond + Grandpa (ART_SPEC §14) — Grandpa and the pond are ambient scene
  content and ship even before their egg logic.
- Fox easter egg per ANIMATION_SPEC §7 via the shared `foxCatchSequence`
  from STORY_SPEC §4, migrated into the registry.
- Final performance audit against the budget in CLAUDE.md; remove dead
  greybox code.

Acceptance: EASTER_EGGS.md §3 in full.

## Global acceptance criteria

- Zero binary assets in the repo; `git ls-files` shows only code and docs.
- All hex values, dimensions, and timings match the spec docs (they are the
  design system — do not freestyle values).
- Triangle count ≤ 50k, draw calls ≤ 40, dpr ≤ 1.5, no shadow maps.
- Screen reader path intact: the three overlay menu buttons carry
  accessibility labels and mirror the stone plaques 1:1; scene taps are
  never the only way to reach a destination.
- `MainScreen.jsx` remains the only file that knows a router exists, and
  only via the `onNavigate` prop.
- The three menu labels/routes are the ONLY permitted placeholders at
  completion; everything else ships final.
- Flat mode works with WebGL entirely unavailable (mock Canvas throw):
  menu renders, navigates, and toggles — in both locales.
