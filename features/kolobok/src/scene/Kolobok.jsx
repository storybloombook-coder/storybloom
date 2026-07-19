import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  PATH_RADIUS, KOLOBOK_RADIUS, KOLOBOK_LEAD, KOLOBOK_FOLLOW_LAG, angleDelta,
} from '../config/zones';
import {
  orbit, encounterMotion, storyMotion, useSceneStore,
} from '../state/sceneStore';
import { createTimeline } from './timeline';
import { makeDoughTexture } from './textures/proceduralTextures';

// ANIMATION_SPEC §4/§5: how far Kolobok rolls forward during a beat's react
// phase, and the extra target-angle offset it rides on top of the normal
// camera-follow lead.
const REACT_ROLL_BOOST = (14 * Math.PI) / 180;

const FOLLOW_LAG = KOLOBOK_FOLLOW_LAG;
const LEAD = KOLOBOK_LEAD;

// Eye/brow placement, shared by both sides (z mirrors for left/right).
const EYE_X = 0.5;
const EYE_Y = 0.12;
const EYE_Z = 0.2;
const CHEEK_ANGLE = (32 * Math.PI) / 180;

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

/** Kolobok: rolling bun with a non-spinning face (eyes, brows, mouth),
 *  blink, tap-to-hop-and-sing, and speed-based squash-and-stretch. Outer
 *  `root` group orients along the path tangent and carries position; inner
 *  `dough` mesh spins to roll; `face` group stays upright and must never
 *  inherit the dough's spin (ART_SPEC §2). */
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

  const sing = useSceneStore((s) => s.sing);
  const doughTexture = useMemo(() => makeDoughTexture(), []);

  const state = useRef({
    angle: LEAD,
    spin: 0,

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
    const d = angleDelta(s.angle, target);
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

    if (root.current) {
      if (storyMotion.posOverride) {
        // Story beat has him off the path entirely (windowsill, arc jumps,
        // the fox's snout): position comes straight from the timeline;
        // idle bob/roll bounce are suppressed so he sits still.
        root.current.position.set(...storyMotion.posOverride);
      } else {
        const x = Math.sin(s.angle) * PATH_RADIUS;
        const z = Math.cos(s.angle) * PATH_RADIUS;
        const idleBob = Math.sin(Date.now() / 400) * 0.03;
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
      // storyMotion.faceYaw adds the birth chapter's look-around.
      face.current.rotation.y = -Math.PI / 2 + storyMotion.faceYaw;
    }

    // Eyelids: 0 open .. 1 closed, hemisphere rotates down to cover the eye.
    const lidRot = -Math.PI * 0.6 * (1 - s.eyelidClose);
    if (leftEyelid.current) leftEyelid.current.rotation.x = lidRot;
    if (rightEyelid.current) rightEyelid.current.rotation.x = lidRot;

    // Brows: raise + tilt, mirrored outward for left/right, plus the sly
    // pose's one-brow asymmetry (left up, right down).
    if (leftBrow.current) {
      leftBrow.current.position.y = EYE_Y + 0.1 + s.browRaise + s.browAsymmetry * 0.02;
      leftBrow.current.rotation.z = (10 * Math.PI) / 180 + s.browTilt;
    }
    if (rightBrow.current) {
      rightBrow.current.position.y = EYE_Y + 0.1 + s.browRaise - s.browAsymmetry * 0.02;
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
    startHop(state.current);
    startSing(state.current);
    sing();
  };

  return (
    <group ref={root} onClick={onTap}>
      <mesh ref={dough} castShadow={false}>
        <sphereGeometry args={[KOLOBOK_RADIUS, 32, 32]} />
        <meshStandardMaterial map={doughTexture} roughness={0.8} />
      </mesh>

      {/* Cheeks -- flattened spheres at +-32 degrees around the face,
          slightly proud of the dough surface. */}
      <mesh position={[KOLOBOK_RADIUS * Math.cos(CHEEK_ANGLE) * 1.05, -0.02, KOLOBOK_RADIUS * Math.sin(CHEEK_ANGLE) * 1.05]} scale={[1, 0.6, 1]}>
        <sphereGeometry args={[0.09, 10, 10]} />
        <meshStandardMaterial color="#e89a5b" roughness={0.8} />
      </mesh>
      <mesh position={[KOLOBOK_RADIUS * Math.cos(CHEEK_ANGLE) * 1.05, -0.02, -KOLOBOK_RADIUS * Math.sin(CHEEK_ANGLE) * 1.05]} scale={[1, 0.6, 1]}>
        <sphereGeometry args={[0.09, 10, 10]} />
        <meshStandardMaterial color="#e89a5b" roughness={0.8} />
      </mesh>

      <group ref={face} position={[0, 0.08, 0]}>
        {/* Eyes: whites + forward-offset pupils + a hemisphere eyelid per side */}
        {[1, -1].map((side) => (
          <group key={side} position={[EYE_X, EYE_Y, EYE_Z * side]}>
            <mesh>
              <sphereGeometry args={[0.11, 12, 12]} />
              <meshStandardMaterial color="#faf6ec" roughness={0.5} />
            </mesh>
            <mesh position={[0.06, 0, 0]}>
              <sphereGeometry args={[0.055, 10, 10]} />
              <meshStandardMaterial color="#3a2c1a" roughness={0.4} />
            </mesh>
            <mesh
              ref={side === 1 ? leftEyelid : rightEyelid}
              position={[0, 0.02, 0]}
              rotation={[-Math.PI * 0.6, 0, 0]}
            >
              <sphereGeometry args={[0.115, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#f2c14e" roughness={0.8} />
            </mesh>
          </group>
        ))}

        {/* Brows */}
        <mesh ref={leftBrow} position={[EYE_X, EYE_Y + 0.1, EYE_Z]} rotation={[0, 0, (10 * Math.PI) / 180]}>
          <boxGeometry args={[0.16, 0.035, 0.05]} />
          <meshStandardMaterial color="#8a5a22" roughness={0.8} />
        </mesh>
        <mesh ref={rightBrow} position={[EYE_X, EYE_Y + 0.1, -EYE_Z]} rotation={[0, 0, -((10 * Math.PI) / 180)]}>
          <boxGeometry args={[0.16, 0.035, 0.05]} />
          <meshStandardMaterial color="#8a5a22" roughness={0.8} />
        </mesh>

        {/* Mouth: smile arc (default) + open-mouth ellipse (singing), visibility toggles */}
        <mesh ref={smileMesh} position={[EYE_X + 0.02, EYE_Y - 0.22, 0]} rotation={[Math.PI / 2, 0, Math.PI]}>
          <torusGeometry args={[0.13, 0.028, 8, 16, Math.PI * 0.7]} />
          <meshStandardMaterial color="#7a4a21" roughness={0.7} />
        </mesh>
        <group ref={openMouthMesh} position={[EYE_X + 0.03, EYE_Y - 0.2, 0]} visible={false}>
          <mesh scale={[0.5, 0.14, 0.05]}>
            <sphereGeometry args={[0.22, 12, 12]} />
            <meshStandardMaterial color="#5c3317" roughness={0.7} />
          </mesh>
          <mesh position={[0.02, 0, 0]} scale={[0.35, 0.1, 0.04]}>
            <sphereGeometry args={[0.22, 10, 10]} />
            <meshStandardMaterial color="#3a1c0f" roughness={0.7} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
