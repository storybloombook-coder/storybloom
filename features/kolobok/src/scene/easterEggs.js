// easterEggs.js — the hidden-interaction registry (EASTER_EGGS.md §1).
// A singleton manager: tap triggers with counts/windows, per-egg cooldowns,
// one-egg-at-a-time, suppression during story/encounters. Continuous egg
// animation values live on the transient `eggMotion` (read by
// PondAndGrandpa/Kolobok in their own useFrame); discrete beats go through
// store actions. Ticked from AtmosphereDirector's frame loop.

import * as Haptics from 'expo-haptics';
import {
  orbit, story, storyMotion, useSceneStore,
} from '../state/sceneStore';
import { createTimeline } from './timeline';
import { foxCatchSteps, ZONE_ANGLE } from './storyChapters';

export const eggMotion = {
  rodPitch: 0,     // radians added to Grandpa's rod pitch
  floatYank: 0,    // 0..1 float lifted out of the water
  fishT: -1,       // -1 hidden; 0..1 progress through the fish arc/flip
  fishKind: null,  // 'silver' | 'gold' | 'boot'
  rippleBurst: 0,  // increment -> PondAndGrandpa spawns a 3-ring ripple
  headShake: 0,    // grandpa head shake amount (boot catch)

  // owl (EASTER_EGGS.md §2 owl)
  owlTreeIdx: -1,     // which spruce (index into Vegetation's SPRUCE_PLANTS) is hosting the owl, -1 = none
  owlPopT: 0,         // 0..1 popped-out amount (canopy -> perched)
  owlSwivel: 0,       // radians, head yaw (±90°, the "owl-neck joke")
  owlBlinkBurst: 0,   // increment -> Owl plays its one slow blink

  // hedgehog (EASTER_EGGS.md §2 hedgehog)
  hedgehogT: -1,        // -1 hidden; 0..1 progress across the S-path
  hedgehogMushroomIdx: -1, // which mushroom it's carrying/took, -1 = none

  // moon-wink (EASTER_EGGS.md §2 moon-wink)
  moonWinkBurst: 0, // increment -> Sky.jsx plays the crater-wink + sparkles

  // cloud-drizzle (EASTER_EGGS.md §2 cloud-drizzle)
  cloudDrizzleCluster: -1, // which cloud cluster index (Sky.jsx cloudState) to darken+drizzle, -1 = none
  cloudDrizzleBurst: 0,    // increment -> Sky.jsx (re)starts that cluster's drizzle

  // smoke-rings (EASTER_EGGS.md §2 smoke-rings)
  smokeRingsRemaining: 0, // next N puffs spawned by ZoneAmbience's IzbaAmbience are ring sprites
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

/** The fox 5-tap catch (ANIMATION_SPEC §7), migrated into the registry per
 *  EASTER_EGGS.md: a mini story beat in free mode. Temporarily flips
 *  orbit.mode to 'story' so the existing camera/Kolobok scripted machinery
 *  (and the shared foxCatchSteps gulp->black->rebirth tail) just work. */
function runFoxCatch(ctx) {
  orbit.mode = 'story';
  storyMotion.kolobokAngle = ZONE_ANGLE.fox;
  storyMotion.framing = { radius: 10, height: 5.6, lookAtY: 1.0 };
  return createTimeline([
    { at: 0, dur: 500, ease: 'easeInOutSine', update: (t) => { storyMotion.foxHeadPitch = 0.3 * Math.sin(t * Math.PI); } },
    { at: 500, dur: 600, ease: 'easeInOutSine', update: (t) => { storyMotion.kolobokAngle = ZONE_ANGLE.fox + (4 * Math.PI / 180) * t; } },
    ...foxCatchSteps(ctx, 1100),
    {
      at: 7400,
      call: () => {
        storyMotion.framing = null;
        orbit.mode = 'user';
        story.lastInputAt = now(); // don't let the story auto-resume instantly
      },
    },
    { at: 7500, call: () => {} },
  ]);
}

// ---------------------------------------------------------------- owl

/** Triple-tap-a-spruce (EASTER_EGGS.md §2 owl). Pop out, swivel twice, one
 *  blink, duck back. Night-only emissive eyes / hoot pulses are the OWL
 *  COMPONENT's own concern (it can read the same day/night signal Sky.jsx
 *  uses), not modeled as extra eggMotion fields here. */
function runOwl(ctx, treeIdx) {
  eggMotion.owlTreeIdx = treeIdx;
  const swivelDeg = 90 * (Math.PI / 180);
  return createTimeline([
    { at: 0, dur: 250, ease: 'easeOutBack', update: (t) => { eggMotion.owlPopT = t; } },
    { at: 250, dur: 600, ease: 'easeInOutSine', update: (t) => { eggMotion.owlSwivel = Math.sin(t * Math.PI) * swivelDeg; } },
    { at: 850, dur: 600, ease: 'easeInOutSine', update: (t) => { eggMotion.owlSwivel = -Math.sin(t * Math.PI) * swivelDeg; } },
    { at: 1500, call: () => { eggMotion.owlSwivel = 0; eggMotion.owlBlinkBurst += 1; } },
    { at: 2800, dur: 250, ease: 'easeOutCubic', update: (t) => { eggMotion.owlPopT = 1 - t; } },
    { at: 3050, call: () => { eggMotion.owlPopT = 0; eggMotion.owlTreeIdx = -1; eggMotion.owlSwivel = 0; } },
    { at: 3150, call: () => {} },
  ]);
}

// ---------------------------------------------------------------- hedgehog

/** 3 distinct mushrooms within 4s (EASTER_EGGS.md §2 hedgehog). Waddles
 *  across over 6s carrying the third-tapped mushroom, which pops back out
 *  of the ground (respawns) 20s later -- that respawn is handled by
 *  whatever component owns the mushroom props (reading hedgehogMushroomIdx
 *  + a timestamp), not this timeline, since it long outlives the 6s walk. */
function runHedgehog(ctx, mushroomIdx) {
  eggMotion.hedgehogMushroomIdx = mushroomIdx;
  return createTimeline([
    { at: 0, dur: 6000, update: (t) => { eggMotion.hedgehogT = t; } },
    { at: 6000, call: () => { eggMotion.hedgehogT = -1; } },
    { at: 6100, call: () => {} },
  ]);
}

// ---------------------------------------------------------------- moon-wink

function runMoonWink(ctx) {
  return createTimeline([
    { at: 0, call: () => { eggMotion.moonWinkBurst += 1; } },
    { at: 400, call: () => {} },
  ]);
}

// ---------------------------------------------------------------- cloud-drizzle

function runCloudDrizzle(ctx, clusterIdx) {
  eggMotion.cloudDrizzleCluster = clusterIdx;
  return createTimeline([
    { at: 0, call: () => { eggMotion.cloudDrizzleBurst += 1; } },
    { at: 2000, call: () => { eggMotion.cloudDrizzleCluster = -1; } },
    { at: 2100, call: () => {} },
  ]);
}

// ---------------------------------------------------------------- smoke-rings

function runSmokeRings(ctx) {
  eggMotion.smokeRingsRemaining = 3;
  return createTimeline([
    { at: 0, call: () => {} },
  ]);
}

const REGISTRY = [
  { id: 'grandpa-fishing', target: 'grandpa', count: 1, windowMs: 0, cooldownMs: 8000, run: runFishing },
  { id: 'fox-catch', target: 'fox', count: 5, windowMs: 6000, cooldownMs: 30000, run: runFoxCatch },
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

/** Tap any mushroom (hedgehog) -- a single tap fires it immediately, that
 *  mushroom is the one it carries off. */
function tapMushroom(mushroomIdx) {
  return attemptFire('hedgehog', 45000, (ctx) => runHedgehog(ctx, mushroomIdx), 'hedgehog');
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

  /** 3-distinct-mushrooms (hedgehog) -- see tapMushroom above. */
  tapMushroom,

  /** One-shot, no counting: moon-wink / cloud-drizzle / smoke-rings. */
  tapMoon() {
    return attemptFire('moon-wink', 15000, runMoonWink, 'moon-wink');
  },
  tapCloud(clusterIdx) {
    return attemptFire(`cloud-${clusterIdx}`, 12000, (ctx) => runCloudDrizzle(ctx, clusterIdx), 'cloud-drizzle');
  },
  tapChimney() {
    return attemptFire('smoke-rings', 10000, runSmokeRings, 'smoke-rings');
  },

  tick(dt) {
    if (active) {
      active.tick(dt);
      if (active.done) active = null;
    }
  },

  get running() { return !!active; },
};
