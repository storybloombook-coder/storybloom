// easterEggs.js — the hidden-interaction registry (EASTER_EGGS.md §1).
// A singleton manager: tap triggers with counts/windows, per-egg cooldowns,
// one-egg-at-a-time, suppression during story/encounters. Continuous egg
// animation values live on the transient `eggMotion` (read by
// PondAndGrandpa/Kolobok in their own useFrame); discrete beats go through
// store actions. Ticked from AtmosphereDirector's frame loop.

import * as Haptics from 'expo-haptics';
import { useSceneStore } from '../state/sceneStore';
import { createTimeline } from './timeline';

export const eggMotion = {
  rodPitch: 0,     // radians added to Grandpa's rod pitch
  floatYank: 0,    // 0..1 float lifted out of the water
  fishT: -1,       // -1 hidden; 0..1 progress through the fish arc/flip
  fishKind: null,  // 'silver' | 'gold' | 'boot'
  rippleBurst: 0,  // increment -> PondAndGrandpa spawns a 3-ring ripple
  headShake: 0,    // grandpa head shake amount (boot catch)

  // owl (EASTER_EGGS.md §2 owl). Live feedback: now a two-stage interaction
  // (appear + look around, THEN either a tap triggers the wing flap + fade,
  // OR it times out and flies away) rather than one fixed-length auto-
  // playing beat -- that needs to react to an interrupt (the tap) mid-
  // flight, which a linear createTimeline can't express, so Owl.jsx now owns
  // its OWN phase progression entirely (reading/writing these fields
  // directly every frame) instead of a timeline driving it from the outside.
  owlTreeIdx: -1,       // which spruce is hosting the owl, -1 = none
  owlPhase: 'idle',     // 'idle' | 'popping' | 'lookaround' | 'flapping' | 'flyaway' | 'fadeout'
  owlPhaseT: 0,         // seconds elapsed in the CURRENT phase

  // hedgehog (live feedback #7 rework): "any number of hedgehogs" simultaneous
  // journeys don't fit this module's single shared "one egg at a time" active
  // slot, so it's fully self-contained in Vegetation.jsx/Hedgehog.jsx now
  // (see Vegetation.jsx's own hedgehogPool export) -- no eggMotion fields here.

  // moon-wink (EASTER_EGGS.md §2 moon-wink)
  moonWinkBurst: 0, // increment -> Sky.jsx plays the crater-wink + sparkles

  // chimney smoke spheres (EASTER_EGGS.md §2 smoke-rings, reworked twice
  // now): burst counter -- ZoneAmbience.jsx's IzbaAmbience spawns 3
  // staggered gray spheres straight from the pipe on each increment.
  // Live feedback: the trigger is now a long press instead of a tap --
  // "long press closes the pipe (no smoke), release makes smoke go out."
  // ZoneLandmarks.jsx's onPointerDown/Up (chimney-proximity-gated, same
  // spot the old tap discrimination lived) set chimneyHeld directly since
  // it needs to react to press/release, not a single discrete event; the
  // burst itself still fires (via eggManager.tapChimney -> this counter)
  // only on release.
  chimneySmokeBurst: 0,
  chimneyHeld: false,
};

// Dev override (EASTER_EGGS.md §3): 'silver' | 'boot' | 'gold' | null.
export const eggs = { forceCatch: null };

const now = () => Date.now();

function suppressed() {
  // User feedback: "eastereggs should be available during story mode." So
  // the autoplaying tale (story.mode === 'playing') no longer blocks the
  // ambient discovery eggs -- only a USER-initiated encounter does (an
  // animal dialogue the user tapped into). A story-driven encounter
  // (encounter.story) is part of the tale and must NOT suppress, matching
  // the same "story visits don't count as a real encounter" logic
  // ZoneLandmarks.jsx already uses.
  const encounter = useSceneStore.getState().encounter;
  return !!encounter && !encounter.story;
}

function eggCtx() {
  const s = useSceneStore.getState();
  return {
    setNarration: s.setNarration,
    setFadeBlack: s.setFadeBlack,
    setStoryEncounter: s.setStoryEncounter,
    onGulp: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
    onRebirth: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  };
}

// ---------------------------------------------------------------- eggs

/** Weighted catch (EASTER_EGGS.md §2 grandpa-fishing). Gold runs the same
 *  beats at half speed with the celebratory bubble; boot adds the sad head
 *  shake. Simplified vs spec: no accumulating boots pile, no gold sparkle
 *  orbit / island-wide celebration (deferred). */
function runFishing(ctx) {
  const roll = eggs.forceCatch ?? (() => {
    const r = Math.random();
    return r < 0.05 ? 'gold' : r < 0.3 ? 'boot' : 'silver';
  })();
  eggMotion.fishKind = roll;
  const slow = roll === 'gold' ? 2 : 1; // gold plays at x0.5 speed
  const s = (ms) => ms * slow;
  const lineKey = roll === 'gold' ? 'egg.goldfish' : roll === 'boot' ? 'egg.boot' : 'egg.fish';
  return createTimeline([
    { at: 0, dur: s(300), ease: 'easeOutCubic', update: (t) => { eggMotion.rodPitch = -(18 * Math.PI / 180) * t; } },
    { at: s(300), dur: s(400), ease: 'easeOutBack', update: (t) => { eggMotion.rodPitch = -(18 * Math.PI / 180) * (1 - t); eggMotion.floatYank = t; } },
    { at: s(300), call: () => { eggMotion.rippleBurst += 1; } },
    { at: s(700), dur: s(800), update: (t) => { eggMotion.fishT = t; } },
    { at: s(700), call: () => ctx.setNarration(lineKey, 'grandpa') },
    ...(roll === 'boot' ? [
      { at: s(900), dur: s(600), update: (t) => { eggMotion.headShake = Math.sin(t * Math.PI * 4) * (10 * Math.PI / 180); } },
    ] : []),
    { at: s(1500), dur: s(500), update: (t) => { eggMotion.fishT = 1 + t; } }, // release arc back to water
    { at: s(2000), call: () => { eggMotion.fishT = -1; eggMotion.floatYank = 0; eggMotion.headShake = 0; eggMotion.rippleBurst += 1; } },
    { at: s(2600), call: () => ctx.setNarration(null) },
    { at: s(2700), call: () => {} },
  ]);
}

// ---------------------------------------------------------------- owl

/** Triple-tap-a-spruce (EASTER_EGGS.md §2 owl). Live feedback: pop out and
 *  look around (restored from the original design) until TAPPED, which
 *  triggers the wing flap, then it ducks away -- Owl.jsx's own useFrame owns
 *  that whole phase progression (see eggMotion.owlPhase's own comment for
 *  why), so this just seeds the trigger and hands off to it. The returned
 *  timeline is a trivial instant no-op purely so this module's shared
 *  "active" slot frees up immediately -- the owl's actual multi-second
 *  visible lifetime does NOT hog it (matching cloud-rain/hedgehog's own
 *  "self-contained, not routed through the timeline" reasoning). */
function runOwl(ctx, treeIdx) {
  eggMotion.owlTreeIdx = treeIdx;
  eggMotion.owlPhase = 'popping';
  eggMotion.owlPhaseT = 0;
  return createTimeline([{ at: 0, call: () => {} }]);
}

// ---------------------------------------------------------------- moon-wink

function runMoonWink(ctx) {
  return createTimeline([
    { at: 0, call: () => { eggMotion.moonWinkBurst += 1; } },
    { at: 400, call: () => {} },
  ]);
}

const REGISTRY = [
  { id: 'grandpa-fishing', target: 'grandpa', count: 1, windowMs: 0, cooldownMs: 8000, run: runFishing },
];

const tapLog = {};      // target -> [timestamps]
const lastFired = {};   // cooldown key -> timestamp (REGISTRY uses egg.id; per-instance eggs use their own composite key)
let active = null;      // running timeline

/** Shared "am I actually allowed to fire, and if so do the bookkeeping"
 *  gate -- every trigger mechanism below (plain tap-count via REGISTRY,
 *  per-instance tap-count, distinct-tap-count, continuous gesture) ends
 *  here. `cooldownKey` is what per-egg (or per-instance, e.g. `owl-3` for
 *  the 4th spruce) cooldown is tracked under; `discoveryId` is what's
 *  reported to the counter/host callback (the egg's species-level id, e.g.
 *  `'owl'`, shared across every tree). */
function attemptFire(cooldownKey, cooldownMs, runFn, discoveryId = cooldownKey) {
  if (suppressed() || active) return false;
  const t = now();
  if (t - (lastFired[cooldownKey] ?? 0) < cooldownMs) return false;
  lastFired[cooldownKey] = t;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  active = runFn(eggCtx());
  useSceneStore.getState().recordEggFound(discoveryId);
  useSceneStore.getState().onEasterEgg?.(discoveryId);
  return true;
}

// Per-instance tap log, keyed by the CALLER's own id space -- separate from
// REGISTRY's `tapLog` (flat target strings like 'grandpa'/'fox') since this
// tracks many dynamic instances (one entry per spruce) rather than a
// handful of fixed targets.
const instanceTapLog = {};  // key (e.g. 'owl-3') -> [timestamps]

/** Triple-tap-ONE-spruce (owl). `treeIdx` is the logical tree index (0..13,
 *  i.e. `e.instanceId % spruce.length` -- see Vegetation.jsx's onTreeGrab
 *  for the same recovery), so each tree gets its own independent count AND
 *  its own independent 10s cooldown ("Cooldown 10 s per tree"). */
function tapSpruce(treeIdx) {
  if (suppressed() || active) return false;
  const t = now();
  const key = `owl-${treeIdx}`;
  instanceTapLog[key] = (instanceTapLog[key] ?? []).filter((x) => t - x <= 1200);
  instanceTapLog[key].push(t);
  if (instanceTapLog[key].length < 3) return false;
  instanceTapLog[key] = [];
  return attemptFire(key, 10000, (ctx) => runOwl(ctx, treeIdx), 'owl');
}

export const eggManager = {
  /** Report a tap on a named target. Returns true if an egg consumed it
   *  (caller should skip the normal tap reaction). */
  tap(target) {
    if (suppressed() || active) return false;
    const t = now();
    tapLog[target] = (tapLog[target] ?? []).filter((x) => t - x < 8000);
    tapLog[target].push(t);
    for (const egg of REGISTRY) {
      if (egg.target !== target) continue;
      if (t - (lastFired[egg.id] ?? 0) < egg.cooldownMs) continue;
      const recent = egg.windowMs
        ? tapLog[target].filter((x) => t - x <= egg.windowMs)
        : tapLog[target];
      if (recent.length >= egg.count) {
        lastFired[egg.id] = t;
        tapLog[target] = [];
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        active = egg.run(eggCtx());
        useSceneStore.getState().recordEggFound(egg.id);
        useSceneStore.getState().onEasterEgg?.(egg.id);
        return true;
      }
    }
    return false;
  },

  /** Triple-tap-a-spruce (owl) -- see tapSpruce above. */
  tapSpruce,

  /** One-shot, no counting: moon-wink / smoke-rings. Cloud-rain (EASTER_EGGS
   *  §2 cloud-drizzle's replacement) and the hedgehog/mushroom mechanic are
   *  both fully self-contained in Sky.jsx/Vegetation.jsx now -- neither fits
   *  this module's single shared "one egg at a time" active slot (3
   *  always-tappable 15s rain clouds; "any number of hedgehogs"
   *  simultaneously) -- both call recordEggFound directly instead of going
   *  through here. */
  tapMoon() {
    return attemptFire('moon-wink', 15000, runMoonWink, 'moon-wink');
  },
  // Live feedback: "make the smoke start as soon as you lift your finger" --
  // this used to route through attemptFire's shared 10s-per-key cooldown,
  // which silently swallowed the burst on every release that came within
  // 10s of the last one (exactly what a press-hold-release gesture invites,
  // unlike a rare triple-tap). Made fully self-contained instead, matching
  // cloud-rain/hedgehog's own "no cooldown, no shared active slot" pattern
  // above -- every release now fires, no exceptions.
  tapChimney() {
    eggMotion.chimneySmokeBurst += 1;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    useSceneStore.getState().recordEggFound('smoke-rings');
    useSceneStore.getState().onEasterEgg?.('smoke-rings');
    return true;
  },

  tick(dt) {
    if (active) {
      active.tick(dt);
      if (active.done) active = null;
    }
  },

  get running() { return !!active; },
};
