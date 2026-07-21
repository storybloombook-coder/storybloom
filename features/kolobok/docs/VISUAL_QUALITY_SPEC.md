# VISUAL_QUALITY_SPEC.md — shading and light polish (Phase 12)

Everything here is a SHADING and LIGHT upgrade, not a geometry upgrade —
same triangle budget, same procedural-texture rule, same 30 fps target.
This is what turns "3D prototype" into "storybook illustration." Order
matters less than in other phases; §1 and §6 give the biggest jump per
hour of work, so do those first if time is short.

## 1. Toon ramp shading (the biggest lever)

Replace `MeshStandardMaterial` with `MeshToonMaterial` on all HERO and
CHARACTER surfaces: Kolobok, hare/wolf/bear/fox, Grandpa, owl, hedgehog,
magpie, izba walls/roof, crossroads stone. Leave ground, sky, water, and
particles as-is (they want smooth gradients, not banded ones).

- **Gradient map**: `THREE.MeshToonMaterial.gradientMap` — a 4×1
  `DataTexture`, `NearestFilter` (hard steps are the point), built per
  base color by `makeToonRamp(baseHex)` in `proceduralTextures.js`:
  - step 0 (shadow, 0.0): base color darkened 35% AND hue-shifted ~15°
    toward violet/blue (mix 12% with `#2a2a55`) — cool shadow, not gray.
  - step 1 (mid, 0.33): base darkened 12%, no hue shift.
  - step 2 (light, 0.66): base as-is.
  - step 3 (highlight, 1.0): base lightened 18%, warmed 8% toward
    `#fff2d6`.
  - This warm-light/cool-shadow bias is THE storybook signal — never skip
    the hue shift even under time pressure.
- Existing speckle/stripe/noise textures move to the material's `map`
  slot as before; `gradientMap` works alongside `map` (toon shading
  modulates the texture, doesn't replace it).
- Kolobok hero pass: give his dough a slightly glossier feel by adding a
  small `specular`-style highlight via a second thin overlay sphere
  (scale 1.01, additive, radial gradient, opacity 0.15, positioned toward
  the current sun direction — cheap fake specular without leaving toon
  shading, which has no real specular model).

## 2. Rim light (separation from background)

Inject a fresnel rim into hero materials via `onBeforeCompile` (works on
`MeshToonMaterial` and `MeshStandardMaterial` alike):

```glsl
// fragment shader injection, before final output
float rim = 1.0 - max(dot(normalize(vViewDir), normalize(vNormal)), 0.0);
rim = pow(rim, 2.2) * uRimStrength;
gl_FragColor.rgb += uRimColor * rim;
```
(`vViewDir`/`vNormal` via a small vertex-shader varying add; `uRimColor`/
`uRimStrength` as uniforms updated per frame — cheap, no allocation.)

- `uRimStrength`: 0.35 characters, 0.2 buildings/stone.
- `uRimColor`: sampled from the CURRENT atmosphere palette's horizon
  color, warmed 20% — so the rim goes gold at sunset, cool blue-white at
  night, neutral cream by day. This single line ties rim light to the
  weather/time system already built.
- Skip rim on tiny props (mushrooms, flowers, feathers) — not worth the
  shader variant.

## 3. Light rig

Replace the current `ambientLight` + single `directionalLight` with:

- `HemisphereLight(skyColor, groundColor, intensity)`: `skyColor` = current
  palette zenith; `groundColor` = `#5a4a38` (warm earth) blended 20%
  toward the current ground tint; intensity 0.55 day, 0.25 night (already
  have the day/night lerp — hook into it).
- `directionalLight` (the "sun"): keep position at real solar azimuth/
  elevation (WEATHER_SPEC), intensity from the existing palette table,
  color warmed 6% versus current.
- Add one dim `directionalLight` fill from the OPPOSITE horizontal
  direction, intensity 0.12 (0.05 night), color cool `#8fa8d8` — this is
  what keeps toon shadow-side faces from going pure-flat-dark and reads as
  "bounce light from the sky."
- Total light cost: 3 lights, no shadow maps on any — unchanged perf
  contract.

## 4. Adaptive anti-aliasing and resolution

- Enable `antialias: true` on the GL context config (expo-gl / R3F
  `gl={{ antialias: true }}`).
- Adaptive dpr: on scene mount, run 5 s at `dpr=2.0`; if the rolling
  average frame time stays ≤ 34 ms (≈29 fps), keep 2.0; otherwise drop to
  1.5, re-check once more after 5 s, floor at 1.25. Store the chosen value
  for the session (no per-frame thrashing). Log the choice behind
  `perf.hud` for the ship-readiness gate.
- This is the cheapest-per-pixel visual upgrade available; jaggy edges
  read as "unfinished" more than almost anything else.

## 5. Organic shape warmth

- **Vertex jitter**: for canopy spheres, the crossroads stone, ground
  skirt, and hill mounds — on geometry creation, displace each vertex
  along its normal by `± (0.015–0.03) × radius` using the seeded PRNG
  (same seed policy as textures, so it's stable across reloads, not
  per-frame noise). Skip on anything with a flat hitbox requirement
  (landmark hitboxes stay separate invisible primitives, already the
  case).
- **Puffier canopies**: build birch/spruce canopy clusters from 2–3
  overlapping icosahedron-based blobs (icosahedron radius jittered per
  §above) rather than plain UV spheres — icosahedra facet more
  interestingly under toon shading. Darken the bottom-facing ~30% of each
  canopy's vertices by 15% (fake AO) at build time via vertex colors.
- **Ground blending**: where ART_SPEC §6 currently blends 1 tint per
  zone, add a second finer noise layer mixing in one neighboring tone at
  15% in soft clumps (radius 1.5–2.5, Perlin-ish via layered sine, seeded)
  so grass reads as textured turf, not a flat fill.

## 6. Global color grade (coherence pass)

- `src/config/palette.js`: a curated master swatch list (~20 hexes) that
  EVERY material color in the project is snapped to or derived from
  (existing ART_SPEC hexes already cluster tightly — this formalizes it;
  update any outliers found during implementation to the nearest swatch
  or a 10%-lerp toward it).
- `grade(hex)` helper: +6% saturation, shadows (post-ramp step 0 only)
  nudged further 4% toward `#2a2a55`, applied once at texture/material
  build time — NOT a per-frame post-process (no bloom/LUT pass; keeps the
  zero-post-processing rule from CLAUDE.md/POLISH_SPEC intact).
- Run every existing hex in ART_SPEC through `grade()` when implementing
  this phase; this phase is allowed to adjust prior specs' colors by up to
  ~10% to fit the master swatch — note any such adjustment in a short
  comment where the color is defined.

## 7. Acceptance

- Toggling `gradientMap` on/off (dev flag `quality.toon`) visibly changes
  Kolobok from soft-gradient to banded-illustration shading; shadow bands
  are visibly cooler-toned than lit bands, not just darker.
- Rim light visible on characters at all times of day, color shifts with
  the current palette (gold at sunset, cool at night).
- Removing the fill light (dev flag `quality.fillLight`) visibly flattens
  shadow-side faces to near-black — confirms it's doing work.
- Adaptive dpr settles within 10 s of mount and is logged; edges show no
  visible jaggies on the test device at the chosen dpr.
- A before/after screenshot pair (same camera angle, izba zone, day) shows
  a clear improvement in perceived polish — this is the practical
  "prettier" bar the implementing agent should target.
- 30 fps budget from CLAUDE.md still holds with all of Phase 12 enabled.
