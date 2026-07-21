# POLISH_SPEC.md — depth, air, and life (Phase 8)

The goal of this pass: the scene should never look like geometry on a disc.
Depth comes from shading and AIR (fog, mist, aerial perspective) — not from
more polygons. Life comes from one coherent wind and a world that reacts to
its hero. Budget for this entire phase: +6k tris, +6 draw calls, zero
shadow maps, zero post-processing.

## 1. Fake shadows (depth, part 1)

- **Blob shadows**: flat planes (y=0.02, renderOrder above ground) with a
  radial-gradient DataTexture — center `rgba(30,26,20,0.28)` fading to 0 at
  the rim, 64×64. One under: Kolobok (r=0.55), each animal (r = 0.5×their
  height), Grandpa+stump (0.4), the crossroads stone (ellipse 1.0×0.7),
  izba (rounded rect 1.9×1.5, opacity 0.22), owl/hedgehog when spawned.
  Instanced where shapes match (animals).
- **Kolobok's blob is animated**: scale = 1 − 0.55×(hopHeight/0.6),
  opacity = 0.28 × (1 − hopHeight/0.9); while rolling fast, stretch 1.25×
  along the velocity direction. This grounds every hop and dash.
- **Baked contact darkening**: when building the island's vertex colors,
  multiply brightness by up to −18% within r=0.9 of every tree/landmark/
  stone/pond base (smoothstep falloff). Static, free at runtime.
- **Sun-side shading bias**: nudge `directionalLight` position to the real
  solar azimuth (WEATHER_SPEC sun.js) so faceted models self-shade
  consistently with the visible sun. Costs nothing, reads as "lit".

## 2. Air: fog, mist, aerial perspective (depth, part 2)

- **Scene fog per phase** (extend `config/atmosphere.js` — fog color
  already exists; add near/far):

| phase   | near | far |
|---------|------|-----|
| day     | 17   | 32  |
| morning | 13   | 26  |
| sunrise/sunset | 12 | 24 |
| evening | 14   | 27  |
| night   | 12   | 24  |
| + weather overrides | fog state: 8/20 · rain: 13/25 · snow: 11/22 |

  Lerp near/far with the same 0.5/s atmosphere lerp.
- **Aerial perspective on the horizon rings** (replaces flat colors in
  ART_SPEC §13): three treeline layers at radii 19 / 24 / 29, base colors
  `#3a5238` / `#54705e` / `#6d8578`, each FINALLY colored as
  `mix(base, currentHorizonColor, k)` with k = 0.25 / 0.5 / 0.72, updated
  when the palette lerps. Hills use k=0.6. Distance is desaturation, not
  detail — and the layers parallax against each other as the camera orbits.
- **Ground mist**: 6 flattened translucent planes (2.2×0.9, soft-edged
  gradient texture, `#dfe6ea`) hovering y=0.15–0.35 around the island rim
  band, opacity by context: morning 0.16, evening 0.10, night 0.08, for
  10 min after rain ends 0.20, otherwise 0.04. They drift with the wind
  (§3) at 0.15× wind speed and slowly cross-fade position every ~40 s.
  Depth-write OFF to avoid sorting artifacts.
- **Vignette**: static RN overlay View (not GL) — radial gradient,
  transparent center → `rgba(20,16,10,0.16)` corners. Pointer-events none.

## 3. The wind system (life, part 1)

One global value everything reads (`src/scene/wind.js`, transient object):

- `wind.strength = base + gust`: base 0.35; gust = value-noise(t × 0.15)
  mapped to 0–0.65, so gusts swell over ~6 s. Weather modifies base:
  storm 0.9, rain 0.6, snow 0.45, fog 0.15.
- `wind.direction`: fixed unit vector (0.8, 0, 0.6), rotates 90° over
  10 min (imperceptible, keeps long sessions varied).
- **Phase-offset rule** (what makes gusts TRAVEL): every swaying object
  computes `phase = dot(position, wind.direction) × 0.9 + t × 2.2` and
  sways by `sin(phase) × amplitude × wind.strength`. You'll SEE a gust roll
  across the meadow, reach the birches, then lean the smoke.
- Consumers + amplitudes: grass tufts ±14°, flowers ±9° (replaces their
  fixed sway), canopy spheres squash-shift ±0.03, spruce tips ±3°, reeds
  ±10°, mist drift, chimney smoke lateral drift ×wind, falling leaves and
  feather inherit wind.direction × 0.4, clouds speed ×(1+strength×0.5).

## 4. Grass + hero reaction (life, part 2)

- **Grass tufts**: InstancedMesh, 80 instances of a 3-crossed-thin-cone
  tuft (12 tris each), color varied `#6f9b52`→`#86b25f` via instanceColor,
  biased to the hare arc (40%) and scattered elsewhere, obeying the 16°
  landmark keep-clear. Sway via §3 by rotating each instance matrix around
  its base (recompute matrices only for instances within camera-facing
  120° — cheap culling).
- **Bend-away**: instances within 0.55 of Kolobok's position lean away from
  him up to 28° (proportional to proximity), spring back over 400 ms with
  slight overshoot. Also applies to flowers. Same reaction (r=0.7) around
  an animal while it steps forward in an encounter.
- **Dust kick**: while |Kolobok roll speed| > 0.2, spawn 2 puffs/s behind
  him (tiny `#c2a06b` points, rise 0.15, fade 600 ms).

## 5. Never a static frame (life, part 3)

- **Idle camera breath**: when no gesture and no story, orbit.angle drifts
  ±0.007 rad on an 8 s sine, and camera height ±0.05 on a 13 s sine.
  Suspended the instant input arrives.
- **Pond glint**: the pond's roughness oscillates 0.22–0.3 on a 7 s sine,
  and a tiny white highlight quad (0.1×0.04, additive, opacity 0.35)
  slides slowly across the surface. Ambient fish splash: every 25–60 s a
  3-ring ripple + 4 droplet points, no Grandpa involvement.
- **Golden-hour pollen**: during sunrise/sunset/golden bands only — 20
  warm points `#ffe9b0`, size 0.05, opacity 0.3, drifting slowly with the
  wind at heights 0.3–1.5.
- **Distant birds**: every 20–45 s (day only), a V of 4 dark triangle
  sprites `#2e2e33` crosses the sky at height 8–10, radius ~17, over 12 s
  with a 2 Hz flap (scale-y pulse). ~30 tris of pure life.
- **God rays** (golden bands only): 3 additive transparent quads
  (4×0.5, opacity 0.06, `#ffdf9e`) angled from the sun azimuth through the
  scene, slowly crossfading. Remove outside golden bands — kitsch at noon,
  magic at sunset.

## 6. Ordering & guardrails

- Implementation order inside the phase: blob shadows → fog/aerial →
  wind+grass → reactions → never-static extras. Each step is independently
  shippable.
- All new textures via the existing procedural builders; all new motion
  obeys sleep mode (idle drift and mist keep running at half rate — they
  ARE the sleep look) and pauses with AppState.
- Transparent overdraw watch: mist + rays + vignette together must not
  exceed ~15% of screen pixels in transparent layers on the test device;
  drop mist planes to 4 if fill-rate bound.

## 7. Acceptance

- Toggling blob shadows off/on visibly changes perceived depth (dev flag
  `polish.shadows`); Kolobok's blob tracks hops and stretches on fast rolls.
- A gust visibly travels across the island in one direction; storm vs fog
  states produce clearly different motion energy.
- Grass parts around rolling Kolobok and springs back with overshoot.
- Horizon layers show three distinct depth tints that follow the sky
  through a full day cycle; morning shows rim mist that evening lacks.
- 30 fps held on the low-end test device with everything enabled; each §5
  feature has a dev kill-switch for the audit.
