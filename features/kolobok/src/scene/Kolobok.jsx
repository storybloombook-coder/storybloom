import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { AdditiveBlending, TorusGeometry } from 'three';
import {
  PATH_RADIUS, KOLOBOK_RADIUS, KOLOBOK_LEAD, KOLOBOK_FOLLOW_LAG, angleDelta,
} from '../config/zones';
import {
  orbit, encounterMotion, storyMotion, useSceneStore,
} from '../state/sceneStore';
import { createTimeline } from './timeline';
import { makeDoughTexture, makeRadialAlphaTexture } from './textures/proceduralTextures';
import { makeToonMaterial } from './materials/toonMaterial';
import { getSharedTexture } from './BlobShadow';
import { polish } from '../config/devFlags';

// ANIMATION_SPEC §4/§5: how far Kolobok rolls forward during a beat's react
// phase, and the extra target-angle offset it rides on top of the normal
// camera-follow lead.
const REACT_ROLL_BOOST = (14 * Math.PI) / 180;

const FOLLOW_LAG = KOLOBOK_FOLLOW_LAG;
const LEAD = KOLOBOK_LEAD;

// Every face metric below was hand-tuned when KOLOBOK_RADIUS was 0.6 --
// FACE_SCALE keeps them proportional to whatever the ball's radius actually
// is now, instead of floating fixed-size features outside a resized ball
// (exactly what broke when KOLOBOK_RADIUS dropped to 0.42: the eyes/brows
// kept their old absolute offsets and ended up outside the smaller dough).
const FACE_SCALE = KOLOBOK_RADIUS / 0.6;

// The `face` group sits at this local Y on the root; every face feature's
// declared Y is relative to that group, so a feature's ABSOLUTE height on
// the dough is FACE_Y_OFFSET + its own local Y. sphereSurfaceX() needs the
// absolute height to find where the surface actually is, so this has to be
// declared before any feature that calls it.
const FACE_Y_OFFSET = 0.08 * FACE_SCALE; // matches the `face` group's own position.y below

// sphereSurfaceX gives the actual forward (X) offset that sits ON the
// dough's surface at a given (absoluteY, z) measured from the dough's own
// center, so ANY face feature can hug the curve at its OWN height/depth
// instead of assuming one shared depth. The dough is a SPHERE, so the
// surface curves away (smaller available X) the further a feature sits
// from the equator -- a single hardcoded X can only ever be correct at one
// height. `1.02` is the "slightly proud of the surface" nudge so features
// read as sitting ON the face rather than sunk into it.
function sphereSurfaceX(absoluteY, z) {
  return Math.sqrt(Math.max(0, KOLOBOK_RADIUS ** 2 - absoluteY ** 2 - z ** 2)) * 1.02;
}

// Eye/brow placement, shared by both sides (z mirrors for left/right).
// EYE_X is now surface-derived (was a hardcoded 0.5 * FACE_SCALE, which
// left the eyes sunk into the dough at the smaller radius while the brows
// -- already surface-derived -- sat proud of it; that depth mismatch was
// what read as the brows floating forward of the eyes).
const EYE_Y = 0.12 * FACE_SCALE;
const EYE_Z = 0.2 * FACE_SCALE;
const EYE_X = sphereSurfaceX(FACE_Y_OFFSET + EYE_Y, EYE_Z);

// Brow: local Y (relative to the `face` group) sits above the eye; its
// surface X is computed at that higher absolute height, so it hugs the
// curve where it actually is instead of borrowing the eye's depth.
const BROW_Y = EYE_Y + 0.1 * FACE_SCALE;
const BROW_X = sphereSurfaceX(FACE_Y_OFFSET + BROW_Y, EYE_Z);

// Live feedback: eyebrows read as flat straight bars -- a gentle curved arc
// instead, matching a natural raised-brow shape. Deliberately does NOT
// touch position/rotation.z (the runtime browRaise/browTilt animation owns
// rotation.z exclusively, overwriting it every frame) -- only the GEOMETRY
// changes, from a straight box to a torus-ring segment occupying the same
// local plane (width along X, thin along Y/Z) the box did, so nothing about
// WHERE it sits or how it's driven changes, only its own shape.
const BROW_ARC = (40 * Math.PI) / 180;
const BROW_ARC_RADIUS = 0.234 * FACE_SCALE;
const BROW_ARC_TUBE = 0.017 * FACE_SCALE;
function makeBrowGeometry() {
  const geo = new TorusGeometry(BROW_ARC_RADIUS, BROW_ARC_TUBE, 8, 14, BROW_ARC);
  // TorusGeometry always starts its visible arc at local +X (u=0); bake a
  // ONE-TIME Z rotation (via the geometry itself, not the mesh's own
  // rotation.z) so the segment is centered on the ring's own "top" instead
  // -- reads as a symmetric brow curve rather than an off-center sliver.
  geo.rotateZ(Math.PI / 2 - BROW_ARC / 2);
  return geo;
}

// Mouth: sits low on the face. Same surface treatment as eyes/brows -- the
// old hardcoded EYE_X-based X (0.364) sat well inside the dough down here
// (true surface X at this height is ~0.42), so most of the big smile torus
// was buried and only the tips poked out, reading as a broken smile. The
// torus radii are also brought down from 0.52/0.112 -- at 0.52*FACE_SCALE
// the outer radius nearly equaled KOLOBOK_RADIUS itself, so the arc curved
// through the ball on both ends.
const MOUTH_Y = EYE_Y - 0.3 * FACE_SCALE;
const MOUTH_X = sphereSurfaceX(FACE_Y_OFFSET + MOUTH_Y, 0);
// A torusGeometry sweeps its arc from local angle 0, CCW in its XY plane,
// so a bare 0.7pi arc lives up in the upper-left quadrant, not centered --
// that off-center crescent is what read as "rotated to the side" no matter
// how the whole mesh was then spun. Keep the 0.7pi span but roll the arc's
// own midpoint down to bottom-center via SMILE_ARC_ROLL at the rotation.
const SMILE_ARC = Math.PI * 0.7;
const SMILE_OUTER_R = 0.18 * FACE_SCALE;
const SMILE_TUBE_R = 0.05 * FACE_SCALE;

// Expression poses (ANIMATION_SPEC §2) -- brow raise/tilt in local units/
// radians, smile widen as a scale factor. Poses are targets; Kolobok()
// lerps its live pose toward whichever of these is current over ~200ms.
const EXPRESSIONS = {
  neutral: { browRaise: 0, browTilt: 0, browAsymmetry: 0, smileScale: 1 },
  happy: { browRaise: 0.03, browTilt: (18 * Math.PI) / 180, browAsymmetry: 0, smileScale: 1 },
  startled: { browRaise: 0.05, browTilt: 0, browAsymmetry: 0, smileScale: 1 },
  sly: { browRaise: 0.02, browTilt: 0, browAsymmetry: 1, smileScale: 1.15 },
};
const EXPRESSION_LERP_SEC = 0.2;

// Blink timing (ANIMATION_SPEC §2), ms.
const BLINK_CLOSE_MS = 70;
const BLINK_HOLD_MS = 60;
const BLINK_OPEN_MS = 90;
const BLINK_DOUBLE_CHANCE = 0.15;

// Hop timing (ANIMATION_SPEC §2): 450ms total, easeOutCubic up / gravity
// fall, then a 120ms landing squash. The up/down split isn't spec'd beyond
// the 450ms total + named easings; 200/250 reads as a snappier rise than
// fall, which is what makes a hop feel like a hop instead of a lob.
const HOP_UP_MS = 200;
const HOP_DOWN_MS = 250;
const HOP_HEIGHT = 0.6;
const HOP_LAND_SQUASH_MS = 120;

const SING_DURATION_SEC = 2.2;
const SING_BOB_HZ = 2.2;
const SING_BOB_AMPLITUDE = 0.05;

// BACKLOG.md #15 companion: Kolobok's own ground shadow. Pinned to world Y
// ~0.02 (ground level) every frame rather than being a static child of
// `root`, since root's own Y carries the idle bob/hop/roll bounce/sing bob --
// a shadow that moved with those would float off the ground instead of
// staying pinned under him. Shrinks/fades slightly at hop apex (contact-
// shadow feel) and hides during posOverride beats (windowsill, fox's
// snout, etc.) where there's no ordinary "ground directly below" to anchor
// to. Opacity carries the same "15% deeper" bump as BlobShadow/tree shadows.
const KOLOBOK_SHADOW_R = KOLOBOK_RADIUS * 1.3;
const KOLOBOK_SHADOW_OPACITY = 0.28 * 1.15;

/** Kolobok: rolling bun with a non-spinning face (eyes, brows, mouth),
 *  blink, tap-to-hop-and-sing, and speed-based squash-and-stretch. Outer
 *  `root` group orients along the path tangent and carries position; inner
 *  `dough` mesh spins to roll; `face` group stays upright and must never
 *  inherit the dough's spin (ART_SPEC §2). All non-dough surface features
 *  (eyes, brows, mouth, specular) live under `face` so they share
 *  its yaw and never spin with the dough. */
export function Kolobok() {
  const root = useRef();
  const dough = useRef();
  const face = useRef();
  const leftEyelid = useRef();
  const rightEyelid = useRef();
  const leftBrow = useRef();
  const rightBrow = useRef();
  const smileMesh = useRef();
  const openMouthMesh = useRef();
  const shadowMesh = useRef();
  const shadowMaterial = useRef();

  const sing = useSceneStore((s) => s.sing);
  const encounter = useSceneStore((s) => s.encounter);
  const doughTexture = useMemo(() => makeDoughTexture(), []);
  const specularTexture = useMemo(() => makeRadialAlphaTexture(), []);
  const browGeometry = useMemo(() => makeBrowGeometry(), []);
  const shadowTexture = useMemo(() => getSharedTexture(), []);

  // VISUAL_QUALITY_SPEC §1: one toon material per distinct surface color.
  // Tiny features (eyes, brows, mouth) skip the rim -- not worth the extra
  // shader variant at that scale (same call the spec makes for mushrooms/
  // flowers/feathers).
  const materials = useMemo(() => ({
    dough: makeToonMaterial({ map: doughTexture, color: '#f2c14e', rimStrength: 0.35 }),
    eyeWhite: makeToonMaterial({ color: '#faf6ec', rimStrength: 0 }),
    eyePupil: makeToonMaterial({ color: '#3a2c1a', rimStrength: 0 }),
    eyelid: makeToonMaterial({ color: '#f2c14e', rimStrength: 0 }),
    brow: makeToonMaterial({ color: '#8a5a22', rimStrength: 0 }),
    smile: makeToonMaterial({ color: '#7a4a21', rimStrength: 0 }),
    mouthOuter: makeToonMaterial({ color: '#5c3317', rimStrength: 0 }),
    mouthInner: makeToonMaterial({ color: '#3a1c0f', rimStrength: 0 }),
  }), [doughTexture]);

  const state = useRef({
    angle: LEAD,
    spin: 0,

    // Idle bob accumulator -- driven by accumulated dt (not Date.now()) so
    // it scrubs/pauses with everything else that's time-driven.
    idleT: 0,

    // Blink
    nextBlinkIn: 3 + Math.random() * 2, // seconds until due
    blinkTimeline: null,
    eyelidClose: 0, // 0 open .. 1 closed
    blinkIsDouble: false,

    // Expression -- live (lerped) pose values, chasing `expressionTarget`.
    browRaise: 0,
    browTilt: 0,
    browAsymmetry: 0,
    smileScale: 1,
    expressionTarget: EXPRESSIONS.neutral,

    // Hop
    hopTimeline: null,
    hopY: 0,
    landSquash: 0, // 1 right on landing, decays to 0 over HOP_LAND_SQUASH_MS

    // Sing
    singing: false,
    singT: 0,

    // Encounter reactions (ANIMATION_SPEC §4/§5), driven by the transient
    // encounterMotion object rather than store state (it changes every
    // frame while a beat runs).
    encounterZoneWas: null, // edge-detect zone changes
    wasSinging: false,      // edge-detect encounterMotion.singing
    spinAngle: 0,           // additional rotation.y from the 360 spin beat

    // Story-mode request channels (STORY_SPEC §3), edge-detected.
    blinkBurstWas: 0,
    storyExpressionWas: null,
  });

  function startBlink(s, isDouble = false) {
    s.blinkIsDouble = isDouble;
    s.blinkTimeline = createTimeline([
      { at: 0, dur: BLINK_CLOSE_MS, ease: 'easeOutCubic', update: (t) => { s.eyelidClose = t; } },
      { at: BLINK_CLOSE_MS, dur: BLINK_HOLD_MS, update: () => { s.eyelidClose = 1; } },
      {
        at: BLINK_CLOSE_MS + BLINK_HOLD_MS,
        dur: BLINK_OPEN_MS,
        ease: 'easeOutCubic',
        update: (t) => { s.eyelidClose = 1 - t; },
      },
      {
        at: BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS,
        call: () => {
          s.blinkTimeline = null;
          if (!isDouble && Math.random() < BLINK_DOUBLE_CHANCE) {
            startBlink(s, true);
          } else {
            s.nextBlinkIn = 3 + Math.random() * 2;
          }
        },
      },
    ]);
  }

  function startHop(s) {
    s.hopTimeline = createTimeline([
      { at: 0, dur: HOP_UP_MS, ease: 'easeOutCubic', update: (t) => { s.hopY = t * HOP_HEIGHT; } },
      // Gravity-like fall: accelerating (slow start, fast finish) rather
      // than the symmetric ease the rise uses -- t*t approximates constant
      // acceleration from rest at the apex.
      { at: HOP_UP_MS, dur: HOP_DOWN_MS, update: (t) => { s.hopY = HOP_HEIGHT * (1 - t * t); } },
      {
        at: HOP_UP_MS + HOP_DOWN_MS,
        dur: HOP_LAND_SQUASH_MS,
        ease: 'easeOutCubic',
        update: (t) => { s.landSquash = 1 - t; },
      },
      {
        at: HOP_UP_MS + HOP_DOWN_MS + HOP_LAND_SQUASH_MS,
        call: () => { s.hopTimeline = null; s.hopY = 0; s.landSquash = 0; },
      },
    ]);
  }

  function startSing(s) {
    s.singing = true;
    s.singT = 0;
    s.expressionTarget = EXPRESSIONS.happy;
  }

  useFrame((_, delta) => {
    // See CameraRig's identical guard -- s.angle is an accumulator too, and
    // a non-finite delta on an early frame would permanently corrupt it.
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;

    // --- Encounter reactions (ANIMATION_SPEC §4/§5) ---
    // A new beat started (edge-triggered on zoneId changing to non-null):
    // startled, or the "sly mirrored curiosity" look specifically for fox.
    if (encounterMotion.zoneId !== s.encounterZoneWas) {
      if (encounterMotion.zoneId) {
        s.expressionTarget = encounterMotion.zoneId === 'fox' ? EXPRESSIONS.sly : EXPRESSIONS.startled;
      } else if (!s.singing) {
        s.expressionTarget = EXPRESSIONS.neutral;
      }
      s.encounterZoneWas = encounterMotion.zoneId;
    }
    // The beat's own "sing" window (edge-triggered): reuse the existing
    // tap-to-sing machinery rather than a parallel system. The window is
    // 700ms (1300-2000ms), shorter than a standalone tap-sing's own
    // SING_DURATION_SEC timer, so the falling edge here forces an early
    // stop when the encounter -- not a direct tap -- is what's driving it;
    // a standalone tap-sing has encounterMotion.zoneId === null throughout
    // and keeps running its own full timer untouched.
    if (encounterMotion.singing && !s.wasSinging) startSing(s);
    if (!encounterMotion.singing && s.wasSinging && encounterMotion.zoneId) s.singing = false;
    s.wasSinging = encounterMotion.singing;

    // --- Story-mode extras (STORY_SPEC §3), all edge-detected requests ---
    // Hard teleport (finale's while-black reset): consume-once, bypasses
    // the chase lag entirely so he's already at the izba when the screen
    // fades back in.
    if (storyMotion.teleportAngle !== null && storyMotion.teleportAngle !== undefined) {
      s.angle = storyMotion.teleportAngle;
      storyMotion.teleportAngle = null;
    }
    if (storyMotion.blinkBurst !== s.blinkBurstWas) {
      s.blinkBurstWas = storyMotion.blinkBurst;
      if (!s.blinkTimeline) startBlink(state.current);
    }
    if (storyMotion.expression !== s.storyExpressionWas) {
      s.storyExpressionWas = storyMotion.expression;
      if (storyMotion.expression) s.expressionTarget = EXPRESSIONS[storyMotion.expression] ?? EXPRESSIONS.neutral;
    }

    // Chase target: in story mode the director's scripted angle IS the
    // target (STORY_SPEC §1 control inversion -- camera follows him
    // instead); in free mode, the point slightly ahead of the camera. Both
    // add the temporary +14 deg roll-forward boost while a tapped animal
    // reacts (react phase only -- approach/retreat don't push Kolobok).
    const reactBoost = encounterMotion.zoneId && encounterMotion.phase === 'react'
      ? REACT_ROLL_BOOST * Math.sin(Math.min(encounterMotion.phaseT, 1) * Math.PI)
      : 0;
    const target = (orbit.mode === 'story' ? storyMotion.kolobokAngle : orbit.angle + LEAD) + reactBoost;
    // Kolobok's movement is INDEPENDENT of the camera: rotating the camera
    // (a user swipe) must never move him. So outside story mode he never
    // chases orbit.angle -- he only moves when the tale itself drives him
    // (storyMotion.kolobokAngle). The camera instead orbits AROUND him
    // (CameraRig's user-mode branch); driving both ways would feed back.
    const followFrozen = orbit.mode !== 'story';
    const d = followFrozen ? 0 : angleDelta(s.angle, target);
    const step = d * Math.min(1, FOLLOW_LAG * dt);
    s.angle += step;

    // 360 deg defiant spin mid-beat (ANIMATION_SPEC §4: "at 1300, 700ms"),
    // riding on top of the normal path-facing rotation applied below.
    // storyMotion.spinT is the story chapters' own spin channel (birth's
    // proud spin, finale beats) -- same visual, different driver.
    const spinT = encounterMotion.zoneId && encounterMotion.spinT > 0 && encounterMotion.spinT < 1
      ? encounterMotion.spinT
      : (storyMotion.spinT > 0 && storyMotion.spinT < 1 ? storyMotion.spinT : 0);
    s.spinAngle = spinT * Math.PI * 2;

    // Rolling: arc length travelled / ball radius = spin delta
    const arc = step * PATH_RADIUS;
    s.spin -= arc / KOLOBOK_RADIUS;

    // Roll speed drives both the existing squash and the new bouncy-hop
    // path bounce (ANIMATION_SPEC §2): while rolling fast, add a tiny
    // periodic lift so it reads as bouncing rather than gliding.
    const speed = Math.min(Math.abs(step) * 40, 1);
    const rollBounce = speed > 0.15 ? Math.abs(Math.sin(s.spin * 2)) * 0.02 : 0;

    // --- Blink state machine ---
    if (s.blinkTimeline) {
      s.blinkTimeline.tick(dt);
    } else if (!s.singing) {
      // Suppressed while singing (ANIMATION_SPEC §2).
      s.nextBlinkIn -= dt;
      if (s.nextBlinkIn <= 0) startBlink(s);
    }

    // --- Hop state machine ---
    if (s.hopTimeline) s.hopTimeline.tick(dt);

    // --- Sing (continuous body bob, not a timeline -- it's an
    // oscillation, not a sequence) ---
    let singBob = 0;
    if (s.singing) {
      s.singT += dt;
      singBob = Math.sin(s.singT * SING_BOB_HZ * Math.PI * 2) * SING_BOB_AMPLITUDE;
      if (s.singT >= SING_DURATION_SEC) {
        s.singing = false;
        s.expressionTarget = EXPRESSIONS.neutral;
      }
    }

    // --- Expression pose lerp (~200ms toward whatever's current target) ---
    const lerpAmt = Math.min(1, dt / EXPRESSION_LERP_SEC);
    s.browRaise += (s.expressionTarget.browRaise - s.browRaise) * lerpAmt;
    s.browTilt += (s.expressionTarget.browTilt - s.browTilt) * lerpAmt;
    s.browAsymmetry += (s.expressionTarget.browAsymmetry - s.browAsymmetry) * lerpAmt;
    s.smileScale += (s.expressionTarget.smileScale - s.smileScale) * lerpAmt;

    // Idle bob accumulator (dt-driven, replaces the old Date.now() phase).
    s.idleT += dt;

    if (root.current) {
      if (storyMotion.posOverride) {
        // Story beat has him off the path entirely (windowsill, arc jumps,
        // the fox's snout): position comes straight from the timeline;
        // idle bob/roll bounce are suppressed so he sits still.
        root.current.position.set(...storyMotion.posOverride);
      } else {
        const x = Math.sin(s.angle) * PATH_RADIUS;
        const z = Math.cos(s.angle) * PATH_RADIUS;
        const idleBob = Math.sin(s.idleT * 2.5) * 0.03;
        root.current.position.set(
          x,
          KOLOBOK_RADIUS + 0.3 + idleBob + rollBounce + s.hopY + singBob,
          z,
        );
      }
      // Face along the tangent of the circle, plus the defiant 360 spin
      // (ANIMATION_SPEC §4/§5) riding on top during its own beat window,
      // plus the story's windowsill-wobble/snout-balance body tilt.
      root.current.rotation.y = s.angle + Math.PI / 2 + s.spinAngle;
      root.current.rotation.z = storyMotion.bodyTilt;
      // Birth pop (0 -> 1) / finale gulp (1 -> 0). setScalar would fight
      // the dough's own squash scaling below, so scale the root instead.
      root.current.scale.setScalar(storyMotion.scale);
      // Publish world position + singing state for the particle pools
      // (notes/dust spawn at wherever he currently is, path or override).
      storyMotion.kolobokWorldPos[0] = root.current.position.x;
      storyMotion.kolobokWorldPos[1] = root.current.position.y;
      storyMotion.kolobokWorldPos[2] = root.current.position.z;
      storyMotion.kolobokSinging = s.singing;
      // POLISH_SPEC §4 dust kick reads this: 0..1 roll speed (same value
      // that already drives the squash-and-stretch below).
      storyMotion.kolobokSpeed = speed;
    }

    if (shadowMesh.current) {
      if (storyMotion.posOverride) {
        // Off the normal path plane (windowsill, arc jump, fox's snout) --
        // no ordinary ground directly below to anchor a flat shadow to.
        shadowMesh.current.visible = false;
      } else {
        shadowMesh.current.visible = true;
        // Counteract root's own Y (idle bob/roll bounce/hop/sing bob) so the
        // shadow stays pinned at ground level instead of floating with him.
        shadowMesh.current.position.y = 0.02 - root.current.position.y;
        // Contact-shadow feel: shrink/fade a touch at hop apex.
        const airLift = Math.min(1, s.hopY / HOP_HEIGHT);
        const shrink = 1 - airLift * 0.35;
        shadowMesh.current.scale.set(KOLOBOK_SHADOW_R * 2 * shrink, KOLOBOK_SHADOW_R * 2 * shrink, 1);
        if (shadowMaterial.current) shadowMaterial.current.opacity = KOLOBOK_SHADOW_OPACITY * (1 - airLift * 0.4);
      }
    }

    if (dough.current) {
      dough.current.rotation.x = s.spin;
      // Squash-and-stretch: continuous roll squash (max 18%, speed-driven)
      // plus the one-shot landing squash from a hop OR a story beat's own
      // squash channel (birth landing 30%), summed and clamped so nothing
      // over-squashes.
      const q = Math.min(0.35, speed * 0.18 + s.landSquash * 0.25 + storyMotion.squash);
      dough.current.scale.set(1 + q, 1 - q, 1 + q);
    }

    if (face.current) {
      // Keep the face looking outward toward the camera side -- deliberately
      // NOT reading dough.current.rotation, so the face never spins with it.
      // storyMotion.faceYaw adds the birth chapter's look-around. The
      // specular highlight lives under this group too, so it turns WITH the
      // face during the look-around instead of sliding off it.
      face.current.rotation.y = -Math.PI / 2 + storyMotion.faceYaw;
    }

    // Eyelids: 0 open .. 1 closed. Live feedback: the old rotation-based
    // "tuck the dome away when open" approach left it visibly drooped over
    // most of the eye at rest (rotating around X can't actually aim the
    // dome's pole -- fixed at local +Y -- toward the camera-facing side of
    // the eye; it only sweeps the pole through the Y-Z plane). Scale
    // sidesteps that entirely: at rest the lid is scaled to ~0 (genuinely
    // invisible, not just rotated out of the way), and grows to full size
    // only while actually blinking, at a fixed rotation that lets its
    // natural dome (JSX rotation=[0,0,0], pole on +Y) cover the eye from
    // the top down.
    const lidScale = Math.max(0.001, s.eyelidClose);
    if (leftEyelid.current) leftEyelid.current.scale.setScalar(lidScale);
    if (rightEyelid.current) rightEyelid.current.scale.setScalar(lidScale);

    // Brows: raise + tilt, mirrored outward for left/right, plus the sly
    // pose's one-brow asymmetry (left up, right down). browRaise/
    // browAsymmetry are EXPRESSIONS deltas (hand-tuned at the old radius),
    // scaled here at the point of use. Only Y is animated; X stays at the
    // JSX-declared surface-derived BROW_X so the brow keeps hugging the
    // dough curve.
    if (leftBrow.current) {
      leftBrow.current.position.y = BROW_Y + (s.browRaise + s.browAsymmetry * 0.02) * FACE_SCALE;
      leftBrow.current.rotation.z = (10 * Math.PI) / 180 + s.browTilt;
    }
    if (rightBrow.current) {
      rightBrow.current.position.y = BROW_Y + (s.browRaise - s.browAsymmetry * 0.02) * FACE_SCALE;
      rightBrow.current.rotation.z = -((10 * Math.PI) / 180 + s.browTilt);
    }

    // Mouth: smile torus visible unless singing (open-mouth mesh instead).
    if (smileMesh.current) {
      smileMesh.current.visible = !s.singing;
      smileMesh.current.scale.x = s.smileScale;
    }
    if (openMouthMesh.current) {
      openMouthMesh.current.visible = s.singing;
    }
  });

  const onTap = (e) => {
    e.stopPropagation();
    // BACKLOG.md #10: same guard as ZoneLandmarks.jsx -- don't re-trigger/
    // overwrite an encounter already running on 'kolobok' (most importantly
    // the tale's own finale beats, which set `encounter.story === true`
    // here too), and this no longer needs to pause the story either way
    // (StoryDirector's interrupt effect was removed).
    if (encounter?.id === 'kolobok') return;
    startHop(state.current);
    startSing(state.current);
    sing();
  };

  return (
    <group ref={root} onClick={onTap}>
      {polish.shadows && (
        <mesh
          ref={shadowMesh}
          position={[0, 0.02 - (KOLOBOK_RADIUS + 0.3), 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[KOLOBOK_SHADOW_R * 2, KOLOBOK_SHADOW_R * 2, 1]}
          renderOrder={1}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={shadowMaterial}
            map={shadowTexture}
            color="#1e1a14"
            transparent
            opacity={KOLOBOK_SHADOW_OPACITY}
            depthWrite={false}
          />
        </mesh>
      )}
      <mesh ref={dough} castShadow material={materials.dough}>
        <sphereGeometry args={[KOLOBOK_RADIUS, 32, 32]} />
      </mesh>

      {/* Everything below is on the `face` group so it shares the face's
          yaw (including the birth-chapter look-around) and never inherits
          the dough's roll spin. */}
      <group ref={face} position={[0, FACE_Y_OFFSET, 0]}>
        {/* VISUAL_QUALITY_SPEC §1 hero pass: a thin additive overlay
            standing in for a cheap fake specular (toon shading has no real
            specular model). Positioned on the upper-forward side, which is
            also the side the camera-follow framing keeps lit through most
            of the loop -- a fixed approximation of "toward the sun" rather
            than a full per-frame world-space recompute. Now under `face`,
            so it tracks the look-around instead of staying pinned to the
            body. */}
        <mesh
          position={[KOLOBOK_RADIUS * 0.7, KOLOBOK_RADIUS * 0.5, KOLOBOK_RADIUS * 0.6]}
          scale={[0.35 * FACE_SCALE, 0.35 * FACE_SCALE, 0.01]}
          rotation={[0, Math.atan2(0.7, 0.6), 0]}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={specularTexture} transparent opacity={0.15} blending={AdditiveBlending} depthWrite={false} />
        </mesh>

        {/* Eyes: whites + forward-offset pupils + a hemisphere eyelid per side */}
        {[1, -1].map((side) => (
          <group key={side} position={[EYE_X, EYE_Y, EYE_Z * side]}>
            <mesh material={materials.eyeWhite}>
              <sphereGeometry args={[0.11 * FACE_SCALE, 12, 12]} />
            </mesh>
            <mesh position={[0.06 * FACE_SCALE, 0, 0]} material={materials.eyePupil}>
              <sphereGeometry args={[0.055 * FACE_SCALE, 10, 10]} />
            </mesh>
            {/* Eyelid: hemisphere big enough to fully cover the eye white
                AND the forward-offset pupil (0.14 radius vs the 0.11 white
                and the pupil poking 0.06 forward), so a closed blink reads
                as shut rather than leaving the pupil peeking through.
                (BACKLOG #14 attempted a flatter cap here by shrinking theta
                while growing the radius to preserve the base width -- but a
                sphere's geometry sits relative to its CENTER, so that also
                pushed the rim ~0.24 units away from the eye, breaking it
                entirely. Reverted; needs a properly pivot-corrected fix
                later, not a blind radius/theta swap.) */}
            <mesh
              ref={side === 1 ? leftEyelid : rightEyelid}
              position={[0.03 * FACE_SCALE, 0.02 * FACE_SCALE, 0]}
              scale={0.001}
              material={materials.eyelid}
            >
              <sphereGeometry args={[0.14 * FACE_SCALE, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            </mesh>
          </group>
        ))}

        {/* Brows: a curved arc (see makeBrowGeometry above), not a flat bar.
            Both sides share the same geometry -- it's symmetric about its
            own center, so it doesn't need mirroring, only the existing
            position.z / rotation.z sign flip below (unchanged). */}
        <mesh ref={leftBrow} position={[BROW_X, BROW_Y, EYE_Z]} rotation={[0, 0, (10 * Math.PI) / 180]} material={materials.brow} geometry={browGeometry} />
        <mesh ref={rightBrow} position={[BROW_X, BROW_Y, -EYE_Z]} rotation={[0, 0, -((10 * Math.PI) / 180)]} material={materials.brow} geometry={browGeometry} />

        {/* Mouth: smile arc (default) + open-mouth ellipse (singing),
            visibility toggles. X is surface-derived (MOUTH_X) so the whole
            arc sits ON the dough rather than buried in it.

            The torus's arc sweeps from local angle 0 CCW in its XY plane,
            so the drawn crescent is centered on SMILE_ARC/2, NOT on 0.
            rotation.y = -90 stands the ring up to face the character's
            forward +X axis (same axis the pupils offset along). rotation.z
            then rolls the crescent so its own midpoint (SMILE_ARC/2) points
            straight down: a downward point is at -90 (-pi/2), so
            z = -pi/2 - SMILE_ARC/2 lands the middle of the arc at the
            bottom, giving a symmetric "u" that opens upward -- instead of
            the old lopsided arc that sat off to one side. */}
        <mesh
          ref={smileMesh}
          position={[MOUTH_X, MOUTH_Y, 0]}
          rotation={[0, -Math.PI / 2, -Math.PI / 2 - SMILE_ARC / 2]}
          material={materials.smile}
        >
          <torusGeometry args={[SMILE_OUTER_R, SMILE_TUBE_R, 8, 16, SMILE_ARC]} />
        </mesh>
        {/* The mouth surface sits on the face's +X axis, so X here is the
            forward/depth direction (into and out of the face), NOT the
            horizontal spread. The open ellipse must be widest across the
            face -- that's world Z -- and shallow in X, else it opens
            edge-on to the camera. So: X (depth) small, Y (vertical opening)
            medium, Z (left-right width) largest. The inner "throat" is
            recessed slightly INTO the face (-X) so it reads as depth behind
            the lips rather than poking out through them. */}
        <group ref={openMouthMesh} position={[MOUTH_X, MOUTH_Y + 0.02 * FACE_SCALE, 0]} visible={false}>
          <mesh scale={[0.05, 0.09, 0.3]} material={materials.mouthOuter}>
            <sphereGeometry args={[0.88 * FACE_SCALE, 12, 12]} />
          </mesh>
          <mesh position={[-0.02 * FACE_SCALE, 0, 0]} scale={[0.04, 0.06, 0.22]} material={materials.mouthInner}>
            <sphereGeometry args={[0.88 * FACE_SCALE, 10, 10]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
