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
};

// Dev override (EASTER_EGGS.md §3): 'silver' | 'boot' | 'gold' | null.
export const eggs = { forceCatch: null };

const now = () => Date.now();

function suppressed() {
  return story.mode === 'playing' || !!useSceneStore.getState().encounter;
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
    { at: s(700), call: () => ctx.setNarration(lineKey) },
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

const REGISTRY = [
  { id: 'grandpa-fishing', target: 'grandpa', count: 1, windowMs: 0, cooldownMs: 8000, run: runFishing },
  { id: 'fox-catch', target: 'fox', count: 5, windowMs: 6000, cooldownMs: 30000, run: runFoxCatch },
];

const tapLog = {};      // target -> [timestamps]
const lastFired = {};   // id -> timestamp
let active = null;      // running timeline

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
        useSceneStore.getState().onEasterEgg?.(egg.id);
        return true;
      }
    }
    return false;
  },

  tick(dt) {
    if (active) {
      active.tick(dt);
      if (active.done) active = null;
    }
  },

  get running() { return !!active; },
};
