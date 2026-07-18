# ANIMATION_SPEC.md — motion, timelines, encounters

All motion runs inside `useFrame` off refs; the zustand store only receives
discrete events (encounter started/ended, navigation request). Easings named
here: `easeOutCubic`, `easeInOutSine`, `easeOutBack` (overshoot 1.4) —
implement all three in `scene/timeline.js`.

## 1. Timeline helper (`scene/timeline.js`)

A tiny sequencer, no dependencies:

```js
const tl = createTimeline([
  { at: 0,    dur: 400, ease: 'easeOutCubic', update: (t) => {...} },
  { at: 400,  call: () => {...} },            // fire-once event
  { at: 1200, dur: 600, ease: 'easeInOutSine', update: (t) => {...} },
]);
tl.tick(deltaSeconds); tl.done; tl.cancel();
```

- `tick` advances an internal clock; each step's `update` receives eased
  local progress 0→1; `call` steps fire exactly once.
- `cancel()` stops immediately WITHOUT jumping to end state — callers are
  responsible for returning actors to idle pose over 300 ms (implement a
  shared `returnToIdle(refs)` per character that lerps pose back).
- Unit-test the timing math (step activation, easing bounds, cancel) in
  plain node — no Three.js imports in this file.

## 2. Kolobok

- **Roll** (exists): keep arc-length spin and speed-based squash
  (max 18%). Add: tiny path bounce — y += |sin(spin*2)| * 0.02 while
  |speed| > 0.15, so fast rolling reads as bouncy hops.
- **Blink**: every 3–5 s (randomized), eyelids close over 70 ms, hold 60 ms,
  open 90 ms. 15% of blinks are double-blinks. Suppress while singing.
- **Expressions** (brow + mouth poses, lerp 200 ms):
  - `neutral`: brows level, smile torus visible.
  - `happy` (during song): brows raised 0.03, tilted outward 18°.
  - `startled` (encounter starts): brows raised 0.05, straight; mouth
    swapped to small "o" (open-mouth mesh scaled 0.6); hold 400 ms then
    → `happy` as he sings.
  - `sly` (fox zone active): one brow raised, smile widened (scale x 1.15).
- **Hop** (tap): y follows sin curve, height 0.6, duration 450 ms,
  `easeOutCubic` up / gravity-like fall; squash 25% on landing for 120 ms.
- **Sing** (tap or encounter beat): open-mouth mesh on, smile hidden; body
  bobs ±0.05 at 2.2 Hz; song-note particles active; duration 2.2 s
  standalone, or as scripted inside encounter timelines (§4).

## 3. Animal idles (looping, phase-offset per animal so they never sync)

- **Hare**: small in-place hop every 2.5–4 s (h=0.12, 300 ms); ears
  independently twitch (±8° over 150 ms) at random 1–3 s intervals; nose
  area scales 1.02 at 4 Hz (sniffing).
- **Wolf**: slow head sweep left↔right ±25° over 4 s `easeInOutSine`;
  every ~12 s a howl: muzzle up 35° over 600 ms, hold 900 ms, down 500 ms.
- **Bear**: weight shift — body roll ±4° at 0.25 Hz; every ~10 s raises one
  arm and "scratches" (arm oscillates ±12° at 6 Hz for 900 ms) against the
  nearest spruce side.
- **Fox**: tail is always moving — S-curve sway, base ±14° at 0.4 Hz with
  the tip lagging 200 ms (drive tip from a delayed copy of the base angle);
  every ~8 s a slow head tilt 12° + half-lid blink (the sly look).
- **Active-zone bonus**: the zone the camera faces (store.activeZone) plays
  its idle 1.3× more frequently and adds a subtle body scale pulse
  (existing greybox pulse, reduced to ±2.5%).

## 4. Encounter timelines — hare, wolf, bear (same structure, per-flavor)

Trigger: tap on the animal (or its zone hitbox). Store gets
`startEncounter(zone)` immediately; navigation fires from the timeline's
final `call`, replacing the current fixed 1600 ms timeout in MainScreen —
move that responsibility into the timeline, keep the effect interruptible
(unmount/cancel clears it).

Shared beat structure (times in ms):

| at   | dur | action |
|------|-----|--------|
| 0    | 400 | Animal steps toward the path 0.6 units, `easeOutCubic`; Kolobok expression → `startled`; camera nudges 4% closer (orbit radius 13→12.5, restored at end) |
| 400  | —   | Speech bubble line 1: "<Animal>: Kolobok, Kolobok, I will eat you up!" |
| 1300 | 700 | Kolobok expression → `happy`; sing pose on; bubble line 2: the song; Kolobok does a defiant 360° spin in place (rotation around vertical axis, `easeInOutSine`) |
| 2600 | 400 | Animal reacts (flavor below); Kolobok rolls forward +14° along the path (temporarily override FOLLOW_LAG target) |
| 3000 | 300 | Animal steps back to its landmark spot; bubble fades |
| 3300 | —   | `call`: encounter ends, animal returns fully to idle. NO navigation — zones are story charm only; app navigation lives exclusively on the crossroads stone (SPEC.md "Navigation", ART_SPEC §12) |

Flavor of the 2600 ms reaction:
- Hare: startled vertical hop h=0.25.
- Wolf: short snap forward 0.15 and miss, head shake ±10° twice.
- Bear: slow heavy swipe (arm 40° arc over 350 ms) that misses.

Interruption: any other tap, menu-button/plaque press, or swipe > 40 px cancels the
timeline (`cancel()` + `returnToIdle` + bubble cleared + camera radius
restored + NO navigation).

## 5. Encounter timeline — fox (different: she flatters, never lunges)

| at   | dur | action |
|------|-----|--------|
| 0    | 500 | Fox glides 0.5 toward the path (smooth, no hop), tail sway amplitude ×1.6; Kolobok → `sly` mirrored curiosity |
| 500  | —   | Bubble: "Fox: What a lovely song... come closer, dear, I can't quite hear." |
| 1500 | 600 | Kolobok leans 8° toward the fox... then springs back `easeOutBack` and does the 360° spin (he's not falling for it today) |
| 2400 | —   | Bubble: Kolobok's song line |
| 3100 | 400 | Fox sits, tail wraps around paws, one slow deliberate blink directly "at the camera" |
| 3500 | —   | `call`: encounter ends; fox returns to idle. NO navigation (zones are story-only) |

## 6. Atmosphere motion

- **Day/night**: every frame lerp current sky/light/fog/window values toward
  the active palette (ART_SPEC §8) at rate 0.5/s. Sun+moon pivot angle maps
  phase progress to rotation (sun overhead at 13:00, moon at 01:00).
- **Clouds**: each cluster orbits the island at its own speed
  (0.004–0.009 rad/s) and bobs ±0.1.
- **Gyro parallax** (`expo-sensors` DeviceMotion at 30 Hz): camera height
  += tilt.pitch * 0.4, lateral lookAt offset += tilt.roll * 0.3, both
  clamped ±0.5 and smoothed (lerp 0.1). Disable while an encounter runs.
- **Sleep mode**: after 10 s with no gesture/tap — halve particle counts,
  skip every other frame (render at ~15 fps), pause cloud drift. Any input
  wakes instantly. After 60 s, also pause animal idles except the active
  zone. Implement as a `powerState` field on the transient `orbit` object.
- **AppState**: on background, stop the frameloop (`gl` invalidate pattern
  or a top-level `frameloop="never"` toggle); resume on active.

## 7. Fox easter egg (the "true ending", hidden)

Counter on fox taps within a 6 s window. On the 5th tap, instead of the
normal encounter:

| at   | dur | action |
|------|-----|--------|
| 0    | 600 | Camera pushes to orbit radius 10 toward the fox; all UI overlay fades (opacity 0) |
| 600  | 500 | Fox licks lips: snout scale pulse ×2, head tilt; Kolobok rolls 0.8 toward her, `startled` |
| 1100 | 400 | Screen fade to black (full-screen RN overlay, not GL) |
| 1500 | —   | While black: reset `orbit.angle` and Kolobok angle to izba (0°), Kolobok scale 0 |
| 1900 | 600 | Fade from black; izba window flashes warm; Kolobok pops scale 0→1 `easeOutBack` on the windowsill position (path point at izba angle, y+0.5), then hops down to the path |
| 2600 | —   | Bubble: "Grandma: Fresh out of the oven — again!" ; UI overlay returns |

No navigation. Haptic: `notificationAsync(Success)` on the respawn pop.

## 8. Haptics map (expo-haptics)

- Kolobok tap → `impactAsync(Light)`
- Zone tap (encounter start) → `impactAsync(Medium)`
- Soft snap settling on a new zone → `selectionAsync()`
- Easter egg respawn → `notificationAsync(Success)`

## 9. Zone ambient life

Rule: every zone runs a small always-on ambient set; the ACTIVE zone gets
its listed extras. All intervals randomized ±25%, all loops phase-offset so
nothing ever syncs. Models in ART_SPEC §11. Buildings never use the body
scale pulse — life happens *around* the izba, not to it.

### Izba (home — richest set)
- Always: chimney smoke; at evening/night the window emissive breathes ±10%
  at 0.1 Hz (firelight).
- Active: smoke spawn rate +30%. Every 20–35 s the Grandma silhouette
  crosses behind the pane over 1.8 s (also plays once during story ch. 0).
  Every ~15 s the ridge bird lands on the roof ridge, does three peck tilts
  (head −25°, 120 ms each), flies off with a straight-line fade (skip at
  night). Every ~12 s Kolobok turns his face toward the house and does one
  slow blink.
- **Izba tap beat** (replaces the generic step-forward beat from §4 — a
  house can't step): smoke burst ×6, window flashes warm 300 ms, bubble:
  "Grandma: Kolobok, where have you rolled off to again?", Kolobok pulls
  `sly` brows (caught sneaking out); beat ends at 1400 ms, no
  navigation (zones are story-only). Same interruption rules as §4.

### Hare meadow
- Always: flowers sway ±5° at 0.5 Hz; 2 butterflies flutter (wing flap
  8 Hz, wander speed 0.3, height 0.3–0.9, stay within the zone's ±36° arc).
- Active: third butterfly joins; every ~9 s one lands on a flower for 1.2 s
  (wings slow to 1 Hz), then resumes.

### Wolf forest
- Always: 3 fog wisps drift slowly (0.05 rad/s, opacity flutter ±0.03);
  spruce tips sway ±2° at 0.3 Hz.
- Active: wolf howl interval halves (~6 s); every ~25 s the crow crosses
  the zone overhead in a straight line over 2.5 s with a two-flap glide
  pattern and one head-bob mid-flight.

### Bear thicket
- Always: falling leaves (2 concurrent, spiral descent over 3.5 s: y linear
  down from 2.2, x/z circle r=0.15 at 1 Hz, rotation tumble); 3 bees orbit
  the honey log at 1.2 rad/s with ±0.05 vertical wobble.
- Active: 5 bees; when the bear does his scratching idle, the nearest
  mushroom wobbles ±8° for 400 ms (comic causality).

### Fox clearing
- Always: fox tail (never stops, per §3).
- Active: every ~20 s a feather spawns at height 1.8 and sways down over
  4 s (pendulum ±20° at 0.6 Hz, slight drift); every ~10 s the fox turns
  her head toward the camera for 800 ms — she watches YOU.

Performance: ambient systems obey sleep mode (ANIMATION_SPEC §6) — halved
when asleep, and inactive zones drop their "active" extras entirely.

## 10. Framing transitions

Per-zone camera framing values live in ART_SPEC §10 / `config/zones.js`.
`CameraRig` owns the easing (800 ms `easeInOutSine` on activeZone change);
encounter and story push-ins multiply on top of the zone framing and must
restore in reverse order (encounter restore first, then zone framing).
