// natureBeds.js — the looping background of the island.
//
// Eight `nature` slots existed from the start and none of them ever played:
// wind, rain, thunder, the pond, forest birds, night crickets, the fire in
// the izba, leaves. Unlike everything else in the registry these are LOOPS,
// not one-shots, so they don't hang off an animation edge — they're on
// whenever the world they describe is on, and they cross-fade when it
// changes.
//
// Two rules decide what's audible, and both exist because this plays while a
// story is read aloud at bedtime:
//
// 1. A bed's volume follows the thing it describes. Rain is as loud as the
//    rain is heavy (atmosphereLive.rainT), crickets only exist at night,
//    birds only in the day. At zero they're stopped outright rather than
//    left running silently, so a quiet night isn't paying for eight loops.
// 2. Everything ducks under a spoken line. The voice channel is a separate
//    player, so beds would otherwise talk straight over the narrator — see
//    DUCK_FACTOR.
//
// Zone beds (the pond, the izba fire, the wolf wood's leaves) additionally
// only play in their own zone. You should be able to hear where you are.

import { atmosphereLive, useSceneStore } from '../state/sceneStore';
import { playSlot, startSlotLoop, stopSlotLoop, updateSlotLoopVolume } from '../services/soundLibrary';

/** How far every bed drops while a line is being spoken. Not silence —
 *  the world shouldn't vanish mid-sentence, it should get out of the way. */
const DUCK_FACTOR = 0.35;
/** Below this a bed is stopped rather than played inaudibly. */
const CUTOFF = 0.02;
/** Per-second approach rate for volume changes, so weather turning on or a
 *  zone change doesn't switch a bed on like a light. */
const FADE_RATE = 1.2;

/** Base levels, before weather/zone/duck. Beds sit well under the effects and
 *  far under dialogue: they're the room, not the story. */
// ambience.thunder is deliberately NOT here: it's the only nature slot with
// loop:false, because a thunderclap is an event, not a bed. It fires off the
// storm's own lightning envelope instead — see tickNatureBeds.
const BED = {
  'ambience.wind': 0.22,
  'ambience.rain': 0.5,
  'ambience.pondRipple': 0.3,
  'ambience.forestBirds': 0.25,
  'ambience.nightCrickets': 0.28,
  'ambience.izbaFire': 0.32,
  'ambience.leaves': 0.2,
};

const live = {}; // slotId -> current volume actually applied

/** Target volume for each bed, given the world right now. 0 means "off". */
function targets(activeZone, isNight, speaking) {
  const L = atmosphereLive;
  const rain = Math.min(1, L.rainT ?? 0);
  const duck = speaking ? DUCK_FACTOR : 1;
  // Wind is always there, and picks up in weather.
  const windAmount = 0.5 + rain * 0.5;
  const out = {
    'ambience.wind': BED['ambience.wind'] * windAmount,
    'ambience.rain': BED['ambience.rain'] * rain,
    // The pond and the fire belong to their own zones.
    'ambience.pondRipple': activeZone === 'izba' ? BED['ambience.pondRipple'] : 0,
    'ambience.izbaFire': activeZone === 'izba' ? BED['ambience.izbaFire'] : 0,
    'ambience.leaves': activeZone === 'wolf' || activeZone === 'bear' ? BED['ambience.leaves'] : 0,
    // Birds by day, crickets by night — never both, and neither in the rain,
    // which is when real ones stop too.
    'ambience.forestBirds': !isNight ? BED['ambience.forestBirds'] * (1 - rain) : 0,
    'ambience.nightCrickets': isNight ? BED['ambience.nightCrickets'] * (1 - rain) : 0,
  };
  for (const k of Object.keys(out)) out[k] *= duck;
  return out;
}

/**
 * Bring every bed toward where the world says it should be. Call once per
 * frame with the elapsed seconds; it starts, stops and re-levels loops
 * itself. Cheap: eight comparisons and only touches a player when a level
 * has actually moved.
 */
const thunder = { was: false };

export function tickNatureBeds(dt) {
  const store = useSceneStore.getState();
  const speaking = !!store.narration || !!store.encounter?.line;
  const want = targets(store.activeZone, atmosphereLive.isNight, speaking);
  const k = 1 - Math.exp(-dt * FADE_RATE);

  // The clap rides the storm's own lightning envelope, which AtmosphereDirector
  // already spikes to 1 and decays. One per flash, not one per frame of it.
  const flashing = (atmosphereLive.flash ?? 0) > 0.6;
  if (flashing && !thunder.was) playSlot('ambience.thunder', { volume: speaking ? 0.45 : 0.8 });
  thunder.was = flashing;

  for (const slotId of Object.keys(BED)) {
    const now = live[slotId] ?? 0;
    const next = now + (want[slotId] - now) * k;
    if (next <= CUTOFF) {
      if (now > CUTOFF) {
        stopSlotLoop(slotId);
        live[slotId] = 0;
      }
      continue;
    }
    if (now <= CUTOFF) startSlotLoop(slotId);
    live[slotId] = next;
    updateSlotLoopVolume(slotId, next);
  }
}

/** Silence everything — leaving the scene, or muting. */
export function stopNatureBeds() {
  for (const slotId of Object.keys(BED)) {
    if ((live[slotId] ?? 0) > 0) stopSlotLoop(slotId);
    live[slotId] = 0;
  }
}
