# ART_SPEC.md — models, textures, materials

All units are world units (Kolobok's radius = 0.6, defined in config/zones.js).
All colors are given as exact hex. All geometry is Three.js primitives or
BufferGeometry built in code. All textures are `THREE.DataTexture` built from
`Uint8Array` — never canvas, never image files. Materials are
`MeshStandardMaterial` unless stated; keep `roughness` high (0.7–1.0),
`metalness` 0 everywhere. Style target: soft low-poly storybook — chunky
silhouettes, flat friendly colors, no realism.

## 1. Procedural texture builders (`scene/textures/proceduralTextures.js`)

Each returns a configured DataTexture (`RGBAFormat`, `sRGBColorSpace`,
`NearestFilter` mag / `LinearFilter` min, `RepeatWrapping`).

- `makeSpeckle(base, speckle, size=128, density=0.04, jitter=0.06)`
  Fill with `base`; randomly darken `density` of pixels to `speckle`; add
  ±`jitter` per-pixel value noise to every pixel for a hand-painted feel.
- `makeStripes(base, stripe, size=128, count=7, thickness=0.06, horizontal=true)`
  Horizontal dashes of `stripe` on `base`: `count` rows, each dash 20–60% of
  width at random x offset (birch bark).
- `makeNoiseGrain(base, amount=0.08, size=64)` — pure value noise tint.
- `makeRadialGradientData(inner, outer, size=128)` — for the sky dome and the
  bread crust (see §2).

Seed all randomness from a fixed constant so textures are stable across
reloads (simple mulberry32 PRNG in the same file).

## 2. Kolobok

The hero. Overinvest here — he carries the screen.

- **Dough ball**: sphere r=0.6, 32×32 segs. Texture: `makeRadialGradientData`
  mapped so the "top" of the bun shades from base `#f2c14e` (equator/bottom)
  to baked crust `#c98a2e` (top pole), overlaid with speckle pass
  (`#a86f24`, density 0.03) for flour spots. Achieve the overlay by composing
  both passes into one Uint8Array before creating the texture.
- **Cheeks**: two flattened spheres r=0.09 (scale y 0.6), `#e89a5b`,
  positioned at ±32° around the face center, slightly proud of the surface.
- **Eyes** (on the non-spinning face group): whites — spheres r=0.11
  `#faf6ec`; pupils — spheres r=0.055 `#3a2c1a` offset forward 0.06.
  Eyelids for blinking: hemisphere shells r=0.115 in dough base color,
  rotated closed/open (see ANIMATION_SPEC §2).
- **Brows**: boxes 0.16×0.035×0.05, `#8a5a22`, 0.1 above eyes, slight
  outward tilt (±10°). They animate for expressions.
- **Mouth**: a `TorusGeometry` arc (r=0.13, tube=0.028, arc=PI*0.7) in
  `#7a4a21`, rotated to a smile. For the singing pose swap to an ellipse
  "open mouth": flattened sphere 0.11×0.14×0.05, `#5c3317`, with inner
  darker sphere. Both exist; visibility toggles.
- Face group faces outward along the path tangent exactly as in the greybox
  (`face.rotation.y = -PI/2` relative to root) and must never inherit the
  dough spin.

Triangle budget: ≤ 3.5k.

## 3. Animals (`scene/characters/`)

Shared builder `makeAnimal(spec)` assembling: body (capsule = cylinder +
sphere caps), head (sphere), snout (flattened sphere), ears, eyes (black
sphere pair r=0.05), tail, feet (4 flattened spheres). Every animal returns
named refs `{ root, head, ears, tail, body }` for animation. Heights below
are total standing height; all stand on y=0 at their zone position, facing
the island center (already handled by ZoneLandmarks placement).

- **Hare** — height 0.9. Fur `#d8d8d2`, belly patch `#efeeea`, inner ear
  `#e8b7b0`. Ears: two capsules 0.34 long, r=0.05, tilted back 15°, inner
  face colored via a second thin capsule. Tail: sphere r=0.07 `#efeeea`.
  Sits on haunches (body tilted back 20°).
- **Wolf** — height 1.5. Fur `#7d8a96`, belly `#aab4bd`, snout tip
  `#3d444b`. Pointed ears: cones h=0.16 r=0.07. Tail: capsule 0.4, droops
  30° down. Slightly forward-leaning stance.
- **Bear** — height 2.0, the bulkiest silhouette (body radius ×1.5 of the
  wolf's). Fur `#8a6444`, muzzle `#b08a62`, inner ear `#6b4c33`. Round ears:
  spheres r=0.1. No visible tail. Arms: two capsules hanging at sides —
  needed for the scratching idle.
- **Fox** — height 1.3. Fur `#d9722f`, chest + tail tip `#f2e8d8`, paws and
  ear tips `#5c3317`. The tail is her signature: capsule 0.55 long,
  r=0.12 at base tapering (use two segments), tip sphere in cream, held in a
  gentle S-curve, animated constantly (ANIMATION_SPEC §3). Narrow snout
  (snout scaled 1.4 long, 0.7 wide). Eyes half-lidded: eyelid shells at 40°.

Triangle budget: ≤ 2.5k each.

## 4. Grandma's izba

- **Log walls**: 6 stacked horizontal cylinders per wall, r=0.11, length
  1.8 (front/back) and 1.4 (sides), `#b3844f` with `makeNoiseGrain`
  (#8a6136 grain). Corner log ends protrude 0.12 (classic сруб look) —
  achieve by making side logs longer than the wall, visible caps `#8a6136`.
- **Roof**: two plank slabs (boxes 2.2×0.06×1.1) meeting at 42°, `#a5602f`;
  ridge beam cylinder r=0.06 `#7a4423`. Decorative gable board: thin box
  with 3 small notches (tiny box cutouts skipped — fake with 3 dark boxes
  `#7a4423` spaced along the edge) as a nod to carved trim.
- **Window**: box frame 0.4×0.4×0.05 `#e8dcc8`, inner pane 0.3×0.3 plane,
  material `MeshStandardMaterial` with `emissive #ffb84d`,
  `emissiveIntensity` 0 by day → 1.4 at night (ANIMATION_SPEC §6).
  Carved наличник frame: 4 thin cream boxes around the pane.
- **Chimney**: box 0.18×0.4×0.18 `#9c9c94` on the roof; smoke particle
  anchor point at its top (particles in §9).
- **Porch**: two steps (boxes) + tiny bench, `#b3844f`.

Triangle budget: ≤ 4k.

## 5. Vegetation (all instanced — one InstancedMesh per species)

- **Birch** (12 instances, hare + fox arcs and scattered): trunk cylinder
  r=0.07 h=1.6, texture `makeStripes('#e8e4da', '#3f3a33')`; canopy: 2–3
  overlapping spheres r≈0.4 squashed 0.8, `#9fc46a` with noise grain.
  Because trunk and canopy differ, use two InstancedMeshes sharing the same
  matrix list.
- **Spruce** (14 instances, dense in wolf + bear arcs): 3 stacked cones
  (r 0.55/0.4/0.26, h 0.7/0.6/0.5, overlapping 30%), `#4f7d45` (wolf arc
  instances tinted darker `#3e6338` via instanceColor); trunk stub r=0.06
  `#6b4c33`.
- **Bush** (10): 3 clustered spheres r≈0.2, `#6f9b52`.
- **Mushroom** (8, bear arc): stem cylinder r=0.03 h=0.1 `#efeeea`, cap
  flattened sphere r=0.08 `#c0452e` with white speckle texture (density
  0.12) — мухомор.
- **Flowers** (16, hare meadow arc): stem thin cylinder h=0.12 `#5d8a3f`,
  head sphere r=0.035; instanceColor alternating `#e8e26e` / `#e0e9f2` /
  `#e8a8c8`.

Placement: keep the existing "no vegetation within 16° of a zone landmark"
rule; bias each species to its home arc (±36° of its zone) with 30%
scattered anywhere. Seeded PRNG, same seed as textures.

## 6. Ground and path

- **Island**: replace the flat-color cylinder top with a `CircleGeometry`
  (r=8, 64 segs) using **vertex colors**: base grass `#7aa85c`, blended per
  vertex toward the nearest zone's ground tint within its 36° arc —
  izba `#8fae62`, hare `#94bc63` (fresh meadow), wolf `#5f7f4e`,
  bear `#587348` (darkest), fox `#9aa85e` (dry gold-green). Blend factor =
  smoothstep over angular distance. Add ±0.05 value noise per vertex.
  Skirt: keep the cylinder side, `#7a5c3e` (earth).
- **Path ring**: keep radius/width; texture `makeSpeckle('#c2a06b',
  '#a5825a', density 0.08)`; add 10 flattened pebble spheres r≈0.05
  `#9c9c94` scattered on the ring (instanced).

## 7. Sky, sun, moon, clouds

- **Sky dome**: sphere r=28, `BackSide`, `MeshBasicMaterial` with a vertical
  gradient DataTexture (`makeRadialGradientData` variant, 1×64 pixels,
  bottom `horizon` → top `zenith` colors from the palette table §8).
  Replace the flat `<color attach="background">`.
- **Sun / moon**: circles r=1.2 / 0.9, `MeshBasicMaterial`, sun `#ffe9a8`,
  moon `#e8ecf4` with 3 darker `#c8cedd` crater dots; both mounted on a
  pivot that rotates with time of day (only one visibly above horizon).
- **Clouds**: 5 clusters of 3 squashed spheres (scale y 0.45), `#ffffff`
  opacity 0.85 day / `#a8b0c8` 0.5 night, drifting slowly (ANIMATION_SPEC
  §6), at height 9–12, radius 16–20 (outside the island, inside the dome).

## 8. Time-of-day palette (`config/atmosphere.js`)

NOTE: docs/WEATHER_SPEC.md supersedes the fixed hour table as the DRIVER —
real solar elevation from the user's location selects and blends these
palettes (plus the sunrise/sunset rows defined there), and live weather
modulates them. The hour table below remains the fallback when location is
unavailable. The palette rows themselves stay the color anchors either way.

Export `PALETTES` keyed by phase; all consumers lerp between neighbors.

| phase   | zenith    | horizon   | dirLight  | dirInt | ambient | fog       | window |
|---------|-----------|-----------|-----------|--------|---------|-----------|--------|
| morning | `#a8cfe4` | `#f4dfc0` | `#fff2dd` | 1.0    | 0.65    | `#e4ded2` | 0      |
| day     | `#8ec4e0` | `#cfe8f2` | `#ffffff` | 1.1    | 0.70    | `#bfe3f2` | 0      |
| evening | `#7a86b8` | `#f0b57e` | `#ffcf9e` | 0.9    | 0.55    | `#e0b394` | 0.8    |
| night   | `#141b33` | `#2c3555` | `#7d8fc4` | 0.35   | 0.30    | `#1c2440` | 1.4    |

Phase from device hour: morning 5–10, day 10–17, evening 17–21, night 21–5.
Lerp over 30 real minutes at boundaries (or instantly when a dev override
`atmosphere.forcePhase` is set — implement that override for testing).

## 9. Particles (single Points system per effect, ≤ 60 points each)

- **Chimney smoke**: 24 points spawning at the chimney top, rising 1.5 with
  sideways sine drift, scale up + fade over 3 s, gray `#c8c4bc`, size 0.18.
  Active always; slower at night.
- **Fireflies** (night only): 30 points, warm `#ffe28a`, size 0.09, random
  slow wander at height 0.4–1.2 over the whole island, opacity pulsing
  individually (phase offset per point).
- **Song notes**: 6 points spawned above Kolobok while singing, rising and
  fading over 1.2 s, `#ffffff`. Points, not glyphs — abstract sparkle is
  fine at this scale.

## 10. Per-zone camera framing (`config/zones.js` — add `framing` per zone)

When a zone becomes active, ease orbit radius / camera height / lookAt-y to
its framing over 800 ms `easeInOutSine`. Encounter push-ins multiply on top
(radius × 0.96) and restore in reverse order.

| zone | radius | height | lookAt y | intent |
|------|--------|--------|----------|--------|
| izba | 12.6 | 6.0 | 1.2 | cozy lean-in; home |
| hare | 12.8 | 6.3 | 1.1 | light, open meadow |
| wolf | 13.3 | 6.8 | 1.3 | slightly imposing |
| bear | 13.4 | 7.0 | 1.4 | most imposing |
| fox  | 12.8 | 6.2 | 1.1 | intimate, close |

Story chapter 0 overrides izba framing to radius 11, height 5.2, lookAt y
1.6 (windowsill-centered), per STORY_SPEC.

## 11. Micro-characters and zone props (all ≤ 150 tris each)

- **Grandma silhouette** (izba): flat dark shape behind the window pane —
  head sphere r=0.09, body half-capsule 0.16 wide, headscarf triangle prism —
  all `#3a3229`, `MeshBasicMaterial` (unlit), z just inside the pane.
  Translates across the pane; never leaves the window.
- **Ridge bird** (izba): body sphere r=0.05 `#5a6470`, head sphere r=0.035,
  beak cone 0.02 `#d9a441`, tail flat box. Sits on the roof ridge beam.
- **Butterflies** (hare, 3): two plane wings 0.06×0.05 hinged at a 0.015
  body; instanceColor `#e8a8c8` / `#e8e26e` / `#e0e9f2`; double-sided
  basic material.
- **Crow** (wolf, 1): dark bird `#2e2e33`, same build as ridge bird ×1.3,
  wings as two planes for a simple flap.
- **Fog wisps** (wolf, 3): flattened spheres scale (1.4, 0.25, 1.0),
  `#cfd8de`, `transparent`, opacity 0.12, near ground level of the wolf arc.
- **Honey log + bees** (bear): fallen log cylinder r=0.12 l=0.7 `#6b4c33`
  with a `#e8c04a` drip patch (small flattened sphere); bees = 5 points
  `#e8c04a`, size 0.06.
- **Falling leaves** (bear): 8-point particle pool, `#c9a24b`, size 0.09.
- **Feather** (fox, 1): single plane 0.08×0.03, `#f2e8d8`, double-sided.

## 12. The crossroads stone (the app's real menu — island center)

The three-button main menu lives on a fairytale waymarker stone (камень на
распутье) at the island center (0, 0, 0) — inside Kolobok's path ring, so
the camera's permanent lookAt keeps it on screen at every rotation.

- **Boulder**: sphere r=0.75 scaled (1.0, 1.5, 0.65), 8×6 segments — the low
  segment count IS the faceted rock look. `#8d8d85`, roughness 1, with
  `makeNoiseGrain('#8d8d85', 0.1)`. Sits sunk 0.15 into the ground. Total
  height ≈ 2.1.
- **Moss**: 3 flattened spheres r≈0.18 `#6f9b52` around the base + one on
  the crown.
- **Plaques** (the three buttons): rounded boxes 0.72×0.26×0.045 at heights
  1.45 / 1.05 / 0.65 on the front face, slight 4° random tilts (hand-carved
  feel). Base `#7a7a72`; each carries an inscription strip: a DataTexture
  rendering the menu label (STRINGS.md `ui.menu.*`) as carved glyphs —
  emissive `#ffd27a`, emissiveIntensity 0.35 idle. Since text-to-texture
  from arbitrary strings is hard without canvas, implement a tiny 5×7 pixel
  bitmap font (A–Z, А–Я, 0–9) in code and stamp labels into the texture's
  Uint8Array; ≤ 14 chars, ellipsis beyond.
- **Facing**: the stone yaws to face the camera — lerp its rotation.y toward
  the camera azimuth at 2.5/s. The lag makes it feel physical, not
  billboarded. (A magic stone turning to meet the traveler is perfectly
  in-genre.)
- **Tap beat** (per plaque, generous invisible box hitbox ×1.6): plaque
  presses in 0.02 over 80 ms, emissive pulses to 1.2, 4 dust-mote particles
  `#c8c4bc`, haptic `impactAsync(Medium)`; at 250 ms →
  `requestNavigation(menuId)`. This is the ONLY 3D object that navigates.
- Accessibility twin: three real RN buttons in the overlay (SPEC.md
  "Navigation") mirror the plaques 1:1.

Triangle budget: ≤ 1.5k.

## 13. Background forest ring (depth beyond the island)

A distant treeline so the island floats in a world, not a void:

- Ring of instanced spruce silhouettes at radius 19–24, y from −1 to 0
  (slightly sunken → reads as beyond the horizon), 40 instances, scale
  1.8–3.2, single dark color `#3a5238` (no texture — silhouettes), fog does
  the atmospheric fade. Second sparse ring at 26–30, 20 instances, `#2e4230`.
- 3 low hill mounds: spheres r 6–9 scaled (1, 0.22, 1) at radius ~26,
  `#46603f`.
- All static, one InstancedMesh + 3 meshes ≈ 4 draw calls. These live
  outside the island and do NOT rotate with anything — they're world
  scenery like the sky dome.

## 14. The pond and the easter egg cast (docs/EASTER_EGGS.md)

- **Pond**: flattened ellipse disc 1.5×1.05 at angle 324°, radius 5.6
  (the free arc between fox and izba, on the rim side of the path), y=0.015.
  Water `#6fa8c8`, `MeshStandardMaterial` roughness 0.25 (the one shiny
  surface in the scene), lighter rim ring `#8fc0d8` width 0.08. Two reeds
  (thin cylinders h=0.5 + cone tips `#5d8a3f`) and one lily pad (circle
  r=0.09 `#4f7d45` with a notch faked by a water-color wedge). Ripples:
  3 pooled expanding rings (RingGeometry, opacity fade) spawned on demand.
- **Grandpa (Дед)**: sits on a stump (cylinder r=0.14 h=0.22 `#6b4c33`)
  facing the water. Body capsule 0.34 `#8a7862` (kaftan), head sphere
  r=0.13 `#e8c8a8`, beard: flattened cone 0.14 `#d8d8d2`, cap: tiny
  cylinder+sphere `#8a6444`, boots: two dark boxes. Rod: thin cylinder
  l=0.7 r=0.008 `#6b4c33` held at 40°; line: cylinder r=0.003 `#e8e4da`
  from tip to float; float: sphere r=0.03, top half `#c0452e`, bottom
  `#efeeea`. Named refs `{ rod, line, float, head, arms }` for the catch
  animation. ≤ 900 tris.
- **Silver fish**: flattened capsule 0.16 `#b8c4cc` with tail fin (two
  triangles); **golden fish**: same mesh, `#e8b84a`, emissive `#ffd27a`.
  **Old boot**: box+cylinder 0.14 `#4a4038`, sole flap slightly open (5°).
- **Owl**: body sphere r=0.11 scaled (1, 1.25, 0.9) `#8a7154`, belly patch
  `#c4ad8c`, two ear tufts (tiny cones), eyes: white spheres r=0.038 +
  pupils, beak cone `#d9a441`. Head is a SEPARATE sphere r=0.085 stacked on
  the body so it can swivel ±90°. Spawns from spruce canopy tops. ≤ 600 tris.
- **Hedgehog**: body half-sphere r=0.1 `#6b5a48`; spines: 24 tiny cones
  h=0.05 instanced over the back `#4a4038`; snout cone `#8a7862` with a
  dot nose; carries one mushroom (reuse §5 mushroom mesh) on top. ≤ 700 tris
  incl. spines.
