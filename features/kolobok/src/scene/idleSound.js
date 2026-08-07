// idleSound.js — firing a sound on the frame a state machine flips.
//
// The scene's idle animation is all boolean state advanced inside useFrame:
// the wolf's `howling`, the hare's `hopping`, grandma's knit stroke. Playing
// a sound "when the wolf howls" means playing it on the ONE frame that flag
// goes true — check the flag directly and it retriggers sixty times a second
// for as long as the howl lasts.
//
// Two rules baked in here rather than left to each call site:
//
// 1. Only the zone you're facing makes noise. Five animals idling at once
//    would be a farmyard, and four of them are behind the camera. Every
//    character already knows its own isActiveZone.
// 2. Idle sound is quiet by default. These are background texture under a
//    story being read aloud at bedtime, not events — the one-shot pool is
//    shared with the effects that ARE events, and those should win.

import { playSlot } from '../services/soundLibrary';

/** Default volume for ambient idle noise. Deliberately well under the
 *  effects that respond to a tap: this is scenery, not feedback. */
export const IDLE_VOLUME = 0.45;

/** Per-trigger memory. One per sound per component, kept on the same ref the
 *  rest of that component's frame state lives on. */
export function makeEdge() {
  return { was: false };
}

/**
 * Play `slotId` on the frame `active` first becomes true, and not again
 * until it has gone false and back.
 *
 * `audible` is the gate — pass the component's isActiveZone (or whatever
 * decides this thing should be heard at all). When it's false the edge is
 * still TRACKED, so a howl that began off-camera doesn't fire late the
 * moment you happen to turn toward it.
 */
export function onRise(edge, active, audible, slotId, opts) {
  // A missing edge is a coding mistake -- someone added an onRise call and
  // forgot the matching `field: makeEdge()` on the component's state ref.
  // It used to throw, and because these run inside useFrame that took the
  // ENTIRE 3D scene down to the error boundary: one absent object, no
  // island. The mistake is caught before it ships (soundRegistry.test.js
  // cross-checks every call against its declaration), so this is purely a
  // blast radius limiter -- lose one sound, not the scene.
  if (!edge) return;
  const rising = active && !edge.was;
  edge.was = active;
  if (!rising || !audible) return;
  playSlot(slotId, { volume: IDLE_VOLUME, ...opts });
}

/** A little variation so a sound repeating every few seconds doesn't read as
 *  a tape loop. Returns options for onRise/playSlot. */
export function varied(volume = IDLE_VOLUME, spread = 0.12) {
  return {
    volume: volume * (1 - spread / 2 + Math.random() * spread),
    rate: 1 - spread + Math.random() * spread * 2,
  };
}
