# EASTER_EGGS.md — hidden delights

Small discoverable interactions scattered through the scene. Models for new
actors are in ART_SPEC §14. Every egg follows the same contract so users
learn the scene rewards curiosity.

## 1. System (`src/scene/easterEggs.js`)

Registry of `{ id, trigger, cooldownMs, run(ctx) }` entries; a single
manager owns them:

- **Triggers**: `tap(targetId, count, windowMs)` (N taps on a hitbox within
  a window), `multiTap(targetIds, count, windowMs)` (taps on N DISTINCT
  targets), `gesture(fn)` (custom, e.g. camera revolutions).
- **One at a time**: while an egg runs, other triggers are ignored (taps
  still give their normal reactions).
- **Suppression**: no eggs during story chapters, encounters, or the fox
  catch; triggers don't accumulate while suppressed.
- **Cooldown** per egg (default 8 s) so nothing becomes a strobe toy.
- **Feedback contract**: every egg fires `impactAsync(Light)` on trigger
  and ends by returning all actors to their pre-egg state via the standard
  `returnToIdle` path. Eggs NEVER navigate and never show UI other than
  the shared bubble.
- **Host hook**: optional `onEasterEgg(id)` prop on MainScreen (analytics /
  achievements). Found-set kept in memory; persistence is the host's call.
- All dialogue via `t()` (strings added to docs/STRINGS.md).

## 2. The eggs

### `grandpa-fishing` — Grandpa at the pond (the crown jewel)
Grandpa is ALWAYS present (ambient, not hidden): sitting on a stump at the
pond (ART_SPEC §14), rod out, float bobbing ±0.02 at 0.4 Hz; every ~30 s he
recasts (rod sweep back-forth over 900 ms, float plops with 3-ring ripple).
Tap Grandpa (cooldown 8 s) → weighted catch:

| chance | catch | sequence (ms) |
|--------|-------|----------------|
| 70% | silver fish | 0–300 rod bends tip −18°; 300–700 yank up, fish arcs out with 6-drop splash; 700–1500 fish flips twice in his hands (roll ±180°); 1500–2000 he leans and releases it back, plop + ripple; bubble: `egg.fish` |
| 25% | old boot | same yank; the boot dangles sadly, rotating slowly; Grandpa's head shakes twice; 2200 he tosses it behind the stump (it stays there — boots ACCUMULATE, max 3, oldest despawns); bubble: `egg.boot` |
| 5% | golden fish | yank in slow-motion (×0.5 speed), fish emissive `#ffd27a` pulsing, 12 gold sparkle particles orbit it for 1.8 s; he bows slightly and releases; ALL zone ambient extras play once simultaneously (the island celebrates); bubble: `egg.goldfish` |

### `owl` — triple-tap a spruce
Trigger: 3 taps on any single spruce within 1.2 s. An owl (ART_SPEC §14)
pops from the canopy top over 250 ms `easeOutBack`, swivels its head a full
±90° twice (600 ms each, the owl-neck joke), does one slow blink, ducks
back at 2.8 s. At night its eyes are emissive `#ffd27a` and it hoots — no
audio, so the "hoot" is two body-scale pulses. Cooldown 10 s per tree.

### `hedgehog` — mushroom picker
Trigger: tap 3 DISTINCT mushrooms within 4 s. A hedgehog (ART_SPEC §14)
trundles across the bear arc along a gentle S over 6 s, carrying one
mushroom on its spines; the third tapped mushroom pops out of the ground
scale 1→0 as it "takes" it (respawns scale 0→1 after 20 s). Waddle: body
roll ±6° at 3 Hz. Cooldown 45 s.

### `dizzy` — spin the world too fast
Trigger: 3 full camera revolutions within 5 s (track cumulative
|Δorbit.angle|). Kolobok goes dizzy for 2 s: pupils orbit their eye whites
in circles (0.03 radius at 3 Hz), body sways ±8° at 1.2 Hz with a stagger
step, one hiccup-hop, then a head shake and back to normal. Suppresses his
blink during. Cooldown 20 s.

### `moon-wink` — tap the moon (night only)
The moon gets a generous hitbox; on tap, one crater scales to a closed-eye
line and back (a wink, 400 ms) and 3 tiny star sparkles pop beside it.
Cooldown 15 s.

### `cloud-drizzle` — tap a cloud
Not during rain/snow/storm states. The tapped cluster darkens to `#9aa4b2`
over 300 ms, emits a private 12-point drizzle beneath itself for 2 s,
brightens back. If it happens to drift over Kolobok, he looks up and does
the `startled` brows for 600 ms. Cooldown 12 s per cloud.

### `smoke-rings` — tap the chimney
The next 3 smoke puffs spawn as ring sprites (2× size, ring-shaped 16×16
DataTexture sprite) rising with a slow spin. Pure charm. Cooldown 10 s.

(Existing: the fox 5-tap catch remains as spec'd in ANIMATION_SPEC §7 —
it predates this registry; migrate its trigger into the registry with
`tap('fox', 5, 6000)` and suppression rules intact.)

## 3. Acceptance

- Each egg triggers per its rule, respects cooldown/suppression, and
  returns the scene to a clean idle state.
- Golden fish observed at forced probability override (`eggs.forceCatch`).
- No egg runs during story mode or encounters; triggers don't leak.
- All egg text renders in EN and RU.
- Combined new-actor budget ≤ 4k tris; no egg allocates in `useFrame`.
