// storyChapters.js — chapter timeline builders for story mode (STORY_SPEC
// §2-§3). Each builder returns a "composite" (one or more timelines ticked
// together -- see composeTimelines) plus that chapter's start state, so
// StoryDirector can both play it and cleanly RE-play it from the start
// after an interrupt (STORY_SPEC §1: resume "from the start of the chapter
// that was interrupted, never mid-beat").
//
// Continuous values write into the transient storyMotion/encounterMotion
// objects; discrete beats (narration, encounter phase, fade) go through the
// ctx actions, which map to zustand store calls.

import {
  ZONE_RADIUS, PATH_RADIUS, KOLOBOK_RADIUS, ZONES, rad, pointOnCircle,
} from '../config/zones';
import { encounterMotion, storyMotion } from '../state/sceneStore';
import { createTimeline } from './timeline';
import { buildSharedBeat } from './encounterBeats';

const PATH_Y = KOLOBOK_RADIUS + 0.3; // Kolobok's resting height on the path

export const ZONE_ANGLE = Object.fromEntries(ZONES.map((z) => [z.id, rad(z.angleDeg)]));

// Birth/rebirth staging points at the izba (angle 0). The sill sits just
// proud of the izba's CENTER-facing wall (box spans radius 5.55..6.85).
// On-device review showed the roof cone occludes a wall-hugging sill from
// the default camera azimuth, so: the sill floats 0.35 off the wall, and
// birth/rebirth pin Kolobok's angle at izba + BIRTH_STAGE so the camera
// (which sits a further KOLOBOK_LEAD around) views the sill face from
// ~44 deg aside -- clear of the roofline -- easing back to the izba angle
// before the next road chapter so the roll-off never backtracks.
const BIRTH_STAGE = rad(30);
const SILL_POS = [0, 1.05, 5.2];
const IZBA_PATH_POS = [Math.sin(0) * PATH_RADIUS, PATH_Y, Math.cos(0) * PATH_RADIUS];

// Per-chapter camera framings. Radii/heights start from STORY_SPEC §2's
// table, tightened after live review (2026-07-19): during encounter
// chapters the camera now looks AT the encounter spot on the rim (the
// zone's ground point) instead of the island center, so Kolobok and the
// animal hold the middle of the frame instead of hugging the edge.
// `lookAt` is a full [x,y,z] target; chapters without one keep the
// center-look (lookAtY only), e.g. roads, where the roll itself is the
// subject.
const encounterLook = (zoneId, y = 0.9) => {
  const p = pointOnCircle(5.2, ZONE_ANGLE[zoneId]);
  return [p[0], y, p[2]];
};
const FRAMING = {
  birth: { radius: 12, height: 5.2, lookAtY: 1.6, lookAt: [0, 1.2, 4.2] },
  road: { radius: 13, height: 6.5, lookAtY: 1.2 },
  hare: { radius: 13.2, height: 5.9, lookAtY: 1.1, lookAt: encounterLook('hare') },
  wolf: { radius: 13.2, height: 6.3, lookAtY: 1.3, lookAt: encounterLook('wolf') },
  bear: { radius: 13.2, height: 6.5, lookAtY: 1.4, lookAt: encounterLook('bear') },
  foxStart: { radius: 13.2, height: 5.9, lookAtY: 1.1, lookAt: encounterLook('fox') },
  foxPush: { radius: 10.8, height: 5.6, lookAtY: 1.0, lookAt: encounterLook('fox', 0.8) },
};

/** Ticks several timelines in lockstep; done when all are done. Lets a
 *  chapter run its stretched encounter beat and its own pad beats as
 *  separate step lists without merging their step arrays. */
function composeTimelines(...timelines) {
  return {
    get done() { return timelines.every((tl) => tl.done); },
    tick(dt) { timelines.forEach((tl) => tl.tick(dt)); },
    cancel() { timelines.forEach((tl) => tl.cancel()); },
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------------------------------------------------------------- chapters

// Extra spec-ms inserted before the pop so Grandma's kneading/shaping is
// actually visible in the window for a few seconds, not just implied by the
// glow -- every beat from the old "pop" onward shifts back by this same
// amount so their relative pacing is unchanged.
const COOKING_DELTA = 3200;

/** Chapter 0 — Birth (~11s, STORY_SPEC §3 + a visible cooking lead-in). */
function buildBirth(ctx) {
  const tl = createTimeline([
    { at: 0, dur: 800, update: (t) => { storyMotion.windowGlow = t; } },
    { at: 0, call: () => { storyMotion.smokeBoost = 2; storyMotion.scale = 0; storyMotion.posOverride = [...SILL_POS]; storyMotion.grandmaCooking = true; } },
    { at: 400, call: () => ctx.setNarration('story.bake1') },
    { at: 2200, call: () => ctx.setNarration('story.bake1b') },
    // Kneading stops just before the dough appears on the sill.
    { at: 1600 + COOKING_DELTA - 200, call: () => { storyMotion.grandmaCooking = false; } },
    { at: 1600 + COOKING_DELTA, dur: 500, ease: 'easeOutBack', update: (t) => { storyMotion.scale = Math.max(0, t); } },
    // Look around: -20 deg -> +20 deg, two blinks along the way.
    { at: 2400 + COOKING_DELTA, dur: 1200, ease: 'easeInOutSine', update: (t) => { storyMotion.faceYaw = rad(-20 + 40 * t); } },
    { at: 2500 + COOKING_DELTA, call: () => { storyMotion.blinkBurst += 1; } },
    { at: 3200 + COOKING_DELTA, call: () => { storyMotion.blinkBurst += 1; } },
    { at: 3600 + COOKING_DELTA, dur: 200, update: (t) => { storyMotion.faceYaw = rad(20) * (1 - t); } },
    { at: 3800 + COOKING_DELTA, call: () => ctx.setNarration('story.bake2') },
    // Windowsill wobble: +-6 deg twice, sly brows.
    { at: 4600 + COOKING_DELTA, dur: 700, update: (t) => { storyMotion.bodyTilt = Math.sin(t * Math.PI * 4) * rad(6); } },
    { at: 4600 + COOKING_DELTA, call: () => { storyMotion.expression = 'sly'; } },
    // The jump: sill -> path, parabolic arc h=0.5 over the straight line.
    {
      at: 5600 + COOKING_DELTA,
      dur: 700,
      ease: 'easeInOutSine',
      update: (t) => {
        const p = lerp3(SILL_POS, IZBA_PATH_POS, t);
        p[1] += Math.sin(t * Math.PI) * 0.5;
        storyMotion.posOverride = p;
      },
    },
    { at: 6300 + COOKING_DELTA, call: () => { storyMotion.squash = 0.3; storyMotion.dustBurstId += 1; } },
    { at: 6300 + COOKING_DELTA, dur: 150, update: (t) => { storyMotion.squash = 0.3 * (1 - t); } },
    // Settle: happy, one proud 360, release overrides, roll off -- easing
    // the staged angle back to the izba so road chapter 1 starts in place.
    { at: 6600 + COOKING_DELTA, call: () => { storyMotion.expression = 'happy'; storyMotion.posOverride = null; } },
    { at: 6600 + COOKING_DELTA, dur: 1000, ease: 'easeInOutSine', update: (t) => { storyMotion.spinT = t; } },
    { at: 6600 + COOKING_DELTA, dur: 1400, ease: 'easeInOutSine', update: (t) => { storyMotion.kolobokAngle = ZONE_ANGLE.izba + BIRTH_STAGE * (1 - t); } },
    { at: 7600 + COOKING_DELTA, call: () => { storyMotion.windowGlow = 0; storyMotion.smokeBoost = 1; storyMotion.spinT = 0; ctx.setNarration(null); } },
    { at: 8000 + COOKING_DELTA, call: () => {} },
  ]);
  return { composite: composeTimelines(tl), startAngle: ZONE_ANGLE.izba + BIRTH_STAGE, framing: { ...FRAMING.birth } };
}

/** Road chapters (1/3/5/7): 72 deg in 4.5s, hum notes every ~2s. The
 *  destination is always the next zone clockwise (+72 deg -- never the
 *  short way back around the ring). */
function buildRoad(fromZone) {
  return (ctx) => {
    const from = ZONE_ANGLE[fromZone];
    const to = from + rad(72);
    const tl = createTimeline([
      { at: 0, call: () => { ctx.setNarration(null); storyMotion.expression = 'neutral'; } },
      { at: 0, dur: 4500, update: (t) => { storyMotion.kolobokAngle = lerp(from, to, t); } },
      { at: 100, call: () => { storyMotion.noteBurstId += 1; } },
      { at: 2100, call: () => { storyMotion.noteBurstId += 1; } },
      { at: 4100, call: () => { storyMotion.noteBurstId += 1; } },
      { at: 4500, call: () => { storyMotion.kolobokAngle = to; } },
    ]);
    return { composite: composeTimelines(tl), startAngle: from, framing: { ...FRAMING.road } };
  };
}

/** Animal chapters (2/4/6): the shared beat stretched 1.45x + the §3 pads
 *  (cheeky look-back, cumulative brag). ~8s total. */
function buildAnimalChapter(zoneId, bragKey) {
  const lineKeys = { eat: `line.eat.${zoneId}`, song: 'song.full' };
  return (ctx) => {
    const angle = ZONE_ANGLE[zoneId];
    const beat = buildSharedBeat({
      timeScale: 1.45,
      setPhase: ctx.setStoryEncounterPhase,
      setLine: (name) => ctx.setNarration(lineKeys[name]),
    });
    const pads = createTimeline([
      { at: 0, call: () => { ctx.setStoryEncounter(zoneId); encounterMotion.zoneId = zoneId; encounterMotion.phase = 'approach'; } },
      // Beat ends at 3300*1.45 = 4785: animal back to idle.
      { at: 4800, call: () => { ctx.setStoryEncounter(null); encounterMotion.zoneId = null; encounterMotion.phase = null; } },
      // Roll a few degrees, stop, look back at the animal, cheeky blink.
      { at: 4800, dur: 900, ease: 'easeInOutSine', update: (t) => { storyMotion.kolobokAngle = angle + rad(6) * t; } },
      { at: 5900, dur: 500, ease: 'easeInOutSine', update: (t) => { storyMotion.faceYaw = rad(30) * Math.sin(t * Math.PI); } },
      { at: 6100, call: () => { storyMotion.blinkBurst += 1; } },
      { at: 6400, call: () => ctx.setNarration(bragKey) },
      { at: 8000, call: () => {} },
    ]);
    return { composite: composeTimelines(beat, pads), startAngle: angle, framing: { ...FRAMING[zoneId] } };
  };
}

/** The gulp -> fade -> rebirth tail (STORY_SPEC §4: shared by the finale
 *  and, in Phase 7, the fox easter egg -- same beats, parameterized
 *  narration/haptics hooks). Returns a STEP ARRAY offset to `at0` so the
 *  caller can splice it into its own timeline. */
export function foxCatchSteps(ctx, at0 = 0) {
  // Captured on the toss's first frame so the 0.9 rise is an absolute
  // offset from wherever he was sitting (snout for the finale; the egg may
  // stage him differently), not a frame-rate-dependent accumulation.
  let tossBase = null;
  return [
    // Toss up 0.9 + fox head tilts back.
    {
      at: at0,
      dur: 600,
      ease: 'easeOutCubic',
      update: (t) => {
        if (storyMotion.posOverride) {
          if (!tossBase) tossBase = [...storyMotion.posOverride];
          storyMotion.posOverride = [tossBase[0], tossBase[1] + 0.9 * t, tossBase[2]];
        }
        storyMotion.foxHeadPitch = t;
      },
    },
    // Gulp: scale to 0, screen fades to black (RN overlay, 300ms).
    { at: at0 + 600, dur: 300, update: (t) => { storyMotion.scale = 1 - t; } },
    { at: at0 + 600, call: () => { ctx.setFadeBlack(true); ctx.onGulp?.(); } },
    { at: at0 + 1100, call: () => ctx.setNarration('story.snap') },
    // While black: reset everything to the izba (staged like the birth so
    // the rebirth pop is framed clear of the roofline).
    {
      at: at0 + 2600,
      call: () => {
        storyMotion.posOverride = null;
        storyMotion.teleportAngle = ZONE_ANGLE.izba + BIRTH_STAGE;
        storyMotion.kolobokAngle = ZONE_ANGLE.izba + BIRTH_STAGE;
        storyMotion.foxHeadPitch = 0;
        storyMotion.framing = { ...FRAMING.birth };
        ctx.setStoryEncounter(null);
        encounterMotion.zoneId = null;
        encounterMotion.phase = null;
        encounterMotion.phaseT = 0;
      },
    },
    // Fade back in (RN side: 900ms), window glows, smoke puffs.
    { at: at0 + 3100, call: () => { ctx.setFadeBlack(false); storyMotion.windowGlow = 1; storyMotion.smokeBoost = 2; } },
    // Rebirth pop on the sill.
    { at: at0 + 4000, call: () => { ctx.setNarration('story.rebirth'); storyMotion.posOverride = [...SILL_POS]; ctx.onRebirth?.(); } },
    { at: at0 + 4000, dur: 500, ease: 'easeOutBack', update: (t) => { storyMotion.scale = Math.max(0, t); } },
    // Quick hop down to the path so the next road chapter starts grounded.
    {
      at: at0 + 5400,
      dur: 500,
      ease: 'easeInOutSine',
      update: (t) => {
        const p = lerp3(SILL_POS, IZBA_PATH_POS, t);
        p[1] += Math.sin(t * Math.PI) * 0.4;
        storyMotion.posOverride = p;
      },
    },
    {
      at: at0 + 5900,
      call: () => {
        storyMotion.posOverride = null;
        storyMotion.windowGlow = 0;
        storyMotion.smokeBoost = 1;
        ctx.setNarration(null);
      },
    },
    // Ease the staged angle back to the izba so the looping road chapter
    // picks him up exactly where it expects to start.
    { at: at0 + 5900, dur: 300, ease: 'easeInOutSine', update: (t) => { storyMotion.kolobokAngle = ZONE_ANGLE.izba + BIRTH_STAGE * (1 - t); } },
  ];
}

/** Chapter 8 — Fox finale (12s): the one time the tale wins. */
function buildFoxFinale(ctx) {
  const foxAngle = ZONE_ANGLE.fox;
  // Fox glides 0.5 toward the path during the intro; her snout surface ends
  // up ~0.3 further in and ~0.65 up from her ground point. Kolobok's
  // POSITION is his CENTER (see Kolobok.jsx / PATH_Y's own "+ KOLOBOK_RADIUS"
  // convention), so resting ON that surface means the center sits one
  // radius above it -- omitting this made him sink into the fox's face.
  const snoutPos = pointOnCircle(ZONE_RADIUS - 0.5 - 0.3, foxAngle);
  snoutPos[1] = 0.65 + KOLOBOK_RADIUS;
  const pathPoint = pointOnCircle(PATH_RADIUS, foxAngle);
  pathPoint[1] = PATH_Y;

  const tl = createTimeline([
    { at: 0, call: () => { ctx.setStoryEncounter('fox'); encounterMotion.zoneId = 'fox'; encounterMotion.phase = 'approach'; ctx.setNarration('story.fox.intro'); } },
    { at: 0, dur: 500, ease: 'easeInOutSine', update: (t) => { encounterMotion.phaseT = t; } },
    { at: 800, call: () => ctx.setNarration('line.fox.flatter') },
    // Kolobok rolls right up to her and sings.
    { at: 1800, dur: 800, ease: 'easeInOutSine', update: (t) => { storyMotion.kolobokAngle = foxAngle + rad(4) * t; } },
    { at: 1800, call: () => { encounterMotion.singing = true; } },
    { at: 3200, call: () => { encounterMotion.singing = false; } },
    { at: 3400, call: () => ctx.setNarration('story.fox.closer') },
    // Hop onto the snout: arc from the path point up to the snout. The
    // camera also starts its slow push 12.2 -> 10 here (STORY_SPEC §2):
    // swapping in a new framing object retargets CameraRig's 900ms ease.
    { at: 4400, call: () => { storyMotion.framing = { ...FRAMING.foxPush }; } },
    {
      at: 4400,
      dur: 900,
      ease: 'easeInOutSine',
      update: (t) => {
        const p = lerp3(pathPoint, snoutPos, t);
        p[1] += Math.sin(t * Math.PI) * 0.35;
        storyMotion.posOverride = p;
      },
    },
    // Balance wobble on the snout: +-5 deg at 3Hz until the toss.
    { at: 5300, dur: 500, update: (t) => { storyMotion.bodyTilt = Math.sin(t * Math.PI * 2 * 1.5) * rad(5); } },
    { at: 5800, call: () => { storyMotion.bodyTilt = 0; } },
    // §4-shared gulp/fade/rebirth tail, offset to 5800 (toss at 5800,
    // gulp 6400, snap 6900, reset 8400, fade-in 8900, pop 9800, down
    // 11200, done 11700 -- matching the §3 chapter-8 table).
    ...foxCatchSteps(ctx, 5800),
    { at: 12000, call: () => {} },
  ]);
  return { composite: composeTimelines(tl), startAngle: foxAngle, framing: { ...FRAMING.foxStart } };
}

// Chapter order (STORY_SPEC §2). Loop: after 8, back to 1 (or 0 every 4th).
export const CHAPTERS = [
  buildBirth,                                       // 0
  buildRoad('izba'),                                // 1: izba -> hare
  buildAnimalChapter('hare', 'story.brag.grandma'), // 2
  buildRoad('hare'),                                // 3: hare -> wolf
  buildAnimalChapter('wolf', 'story.brag.hare'),    // 4
  buildRoad('wolf'),                                // 5: wolf -> bear
  buildAnimalChapter('bear', 'story.brag.wolf'),    // 6
  buildRoad('bear'),                                // 7: bear -> fox
  buildFoxFinale,                                   // 8
];
