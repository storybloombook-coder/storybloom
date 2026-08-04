import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import {
  BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Object3D, SphereGeometry,
} from 'three';
import { storyMotion } from '../state/sceneStore';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { rad } from '../config/zones';
import { wind } from './wind';
import { eggMotion } from './easterEggs';
import { makeToonMaterial } from './materials/toonMaterial';
import { getSharedTexture } from './BlobShadow';

const dummy = new Object3D();
const shadowDummy = new Object3D();

// ============================================================ Izba ========
// ART_SPEC §11 + ANIMATION_SPEC §9. Chimney smoke is always-on (a Points
// pool); grandma's silhouette + the ridge bird are izba's "active" extras.
const SMOKE_COUNT = 24;

// Chimney smoke spheres (EASTER_EGGS.md §2, reworked per live feedback): on
// tap, 3 gray semi-transparent spheres emerge from the pipe along the SAME
// rise/sway/wind path as normal smoke, each sized to exactly 2x the pipe's
// own diameter (CHIMNEY_PIPE_TOP_R below must match ZoneLandmarks.jsx's own
// IzbaChimney cylinder top radius -- same "this file already duplicates the
// pipe's own geometry knowledge" precedent as the chimneyPos prop's default
// just below), individually varied +/-20% in size, staggered by a small gap
// so they emerge as a visible sequence rather than one clump.
const PUFF_PER_BURST = 3;
// Live feedback: "when tapped again on the pipe, the bubbles already in
// progress shouldn't disappear -- they should just be added to the new
// ones." The pool used to be exactly PUFF_PER_BURST, so a second tap had
// nowhere to put new bubbles and re-seeded the same three mid-flight. A
// deeper pool lets bursts overlap; a new burst claims whichever slots are
// free and leaves anything still rising alone. Four bursts' worth is
// comfortably more than the ~3.6s rise+stagger can consume at tap speed,
// and if a child does out-tap it the oldest simply isn't replaced (nothing
// visibly resets, the extra tap just adds no new bubble).
const PUFF_POOL = PUFF_PER_BURST * 4;
// Live feedback: "make the pipe twice as tall and twice as wide" -- doubled
// to match ZoneLandmarks.jsx's own IzbaChimney cylinder top radius.
const CHIMNEY_PIPE_TOP_R = 0.11;
const PUFF_BASE_R = CHIMNEY_PIPE_TOP_R * 2; // sphere diameter = 2x pipe diameter -> sphere radius = pipe diameter
const PUFF_SIZE_VARIANCE = 0.2;
// Live feedback: "increase the time between when the balls appear" -- was 0.3.
const PUFF_GAP_S = 0.6;
const PUFF_RISE_S = 3;
// Live feedback: "let them fly 3 times higher than now" -- was 1.5.
const PUFF_RISE_HEIGHT = 4.5;
// Live feedback: "don't make them just disappear, let them completely
// shrink" -- was an instant scale=0.001 snap the moment the rise finished.
// Expressed as a fraction of PUFF_RISE_S so it plugs into the same
// normalized `t` the rise already uses.
const PUFF_SHRINK_S = 1.2;
const PUFF_SHRINK_FRAC = PUFF_SHRINK_S / PUFF_RISE_S;
// Live feedback: "bubbles coming from the pipe should have shadows and
// light effects as cloud spheres" -- PUFF_SHADOW_Y is a fixed height near
// the roof surface below the chimney (ZoneLandmarks.jsx's CHIMNEY_LOCAL/
// makeIzbaRoofBase put the surface there at ~1.41; chimneyPos[1] below is
// the pipe's own TOP, now 1.95 after the pipe doubled in height), tracking
// each puff's own sway/wind but pinned to that one height rather than
// following the puff's own rise.
const PUFF_SHADOW_Y_OFFSET = -0.54;
// Live feedback: "the default smoke disappears and bubbles rise; after 6
// seconds, the smoke continues to billow" -- the normal ambient puffs pause
// (hidden, not reset -- its own simulation keeps advancing underneath so it
// picks back up mid-flow rather than restarting) for this whole window,
// comfortably longer than the 3 bubbles' own ~3.6s rise+stagger.
const SMOKE_SUPPRESS_S = 6;
// Live feedback: "if possible, make the smoke fade in and out smoothly" --
// both the press-triggered hide and the post-6s reappear used to be a hard
// `visible = true/false` snap. Eased via opacity instead: SMOKE_BASE_OPACITY
// is the pointsMaterial's normal resting opacity, and each frame nudges
// toward 0 (suppressed) or back to base over SMOKE_FADE_S.
const SMOKE_BASE_OPACITY = 0.55;
const SMOKE_FADE_S = 0.5;

// Live feedback: "when you tap a bubble, it should pop with a dust
// animation and a vibration feedback." Motes fly outward from where the
// bubble was and shrink to nothing over POP_DUST_S. Shrinking (not fading)
// carries the dissipation because these share one instanced material, so
// per-instance opacity isn't available -- the same trick the puffs' own
// shrink tail already uses.
const POP_DUST_PER_POP = 8;
const POP_DUST_POOL = POP_DUST_PER_POP * 3;
const POP_DUST_S = 0.55;
const POP_DUST_SPREAD = 0.26;
const POP_DUST_RISE = 0.1;
const POP_DUST_R = 0.05;

// Live feedback: "make sure grandma doesn't disappear when Kolobok shows
// up, but instead sits down on the stool by the window and knits" -- the
// old "crosses the window every 20-35s" idle only ever ran while
// isActiveZone anyway, so most of the time Kolobok was actually visiting,
// she simply wasn't there. Replaced with an always-visible seated pose.
// Live feedback (round 2): the window sits on the wall the default camera
// angle never actually shows (it faces the door side instead), so a spot
// "by the window" was never visible from a normal visit -- "just position
// her in the middle of the house" instead, dead center of the wall
// footprint, camera-angle-agnostic. Live feedback (round 3): "she should
// knit ALWAYS when not cooking Kolobok, in story mode and non-story mode"
// -- this is now unconditional (see the frame loop below), no longer
// gated on isActiveZone/story state at all.
const STOOL_X = 0;
const STOOL_Z = 0;
const STOOL_SEAT_H = 0.16;
const STOOL_COLOR = '#5a4530';

export function IzbaAmbience({ isActiveZone, chimneyPos = [0.55, 1.95, 0.15] }) {
  const smokeRef = useRef();
  const smokeMaterialRef = useRef();
  const grandmaRef = useRef();
  const birdRef = useRef();

  const smokeGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(SMOKE_COUNT * 3), 3));
    return geo;
  }, []);
  const smokeState = useRef(
    new Array(SMOKE_COUNT).fill(0).map(() => ({ t: Math.random(), drift: Math.random() * Math.PI * 2 })),
  );

  const puffRef = useRef();
  const puffShadowRef = useRef();
  const popDustRef = useRef();
  // Live feedback: "shadows and light effects as cloud spheres" -- same
  // toon material + rimStrength=0.35 treatment Sky.jsx's own clouds use
  // ("apply the same lighting effect to the clouds as on the characters"),
  // instead of the old bare unlit meshBasicMaterial.
  const puffMaterial = useMemo(() => {
    const m = makeToonMaterial({ color: '#7a756c', rimStrength: 0.35 });
    m.transparent = true;
    m.opacity = 0.55;
    m.fog = false;
    // Live feedback: "I see the bubbles from all angles but not when I look
    // at it behind the house" -- every OTHER transparent material in this
    // file explicitly sets depthWrite=false (see the smoke pointsMaterial,
    // puffShadowRef, wispsRef, etc. just below); this one lost it when it
    // moved from a JSX <meshBasicMaterial depthWrite={false}> to this
    // JS-constructed toon material. Without it, the puffs write real depth
    // values, so from some viewing angles the (also transparent) roof/
    // window/gable geometry behind them ends up depth-sorted incorrectly
    // and the puffs disappear behind it instead of blending on top.
    m.depthWrite = false;
    // Live feedback (round 2): "I can see now how they [the puffs] are
    // hiding behind the background forest" -- BackgroundForest.jsx's own
    // sprites use alphaTest (an opaque-queue, depth-writing cutout
    // technique) at a large distance, and depended on winning the depth
    // test the OLD way (puffs also writing real depth); depthWrite=false
    // alone wasn't enough once something else nearby writes depth first.
    // A small foreground effect like this should just never be occluded by
    // the distant backdrop at all -- depthTest off, plus a generous
    // renderOrder so it still draws on top of/after everything else.
    m.depthTest = false;
    return m;
  }, []);
  // Reuses BlobShadow's own shared radial-alpha texture/tint (same "flat
  // radial-falloff plane, dark center fading to nothing" every other
  // shadow in this codebase uses) rather than allocating a new one.
  const puffShadowTexture = useMemo(() => getSharedTexture(), []);
  // seen: burst-counter edge-detect, seeded from the counter's CURRENT value
  // at mount (same anti-replay pattern as every other burst tracker in this
  // codebase -- see KolobokParticles.jsx's own catchBurstWas for the full
  // reasoning). t < 0 = still waiting its own stagger delay; 0..1 = rising;
  // >= 1 = parked/done.
  const puffState = useRef({
    seen: eggMotion.chimneySmokeBurst,
    // px/py/pz cache each puff's live world position every frame, so popping
    // one can spawn its dust exactly where the bubble was without recomputing
    // the sway/wind/rise chain outside the frame loop.
    puffs: new Array(PUFF_POOL).fill(0).map(() => ({
      t: 1 + PUFF_SHRINK_FRAC, radius: PUFF_BASE_R, drift: 0, px: 0, py: 0, pz: 0,
    })),
    dust: new Array(POP_DUST_POOL).fill(0).map(() => ({
      t: 1, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0,
    })),
    // -1 = normal smoke showing as usual; 0..SMOKE_SUPPRESS_S seconds =
    // counting up while normal smoke stays hidden.
    smokeSuppressS: -1,
    smokeOpacity: SMOKE_BASE_OPACITY,
  });

  /** Live feedback: "when you tap a bubble, it should pop with a dust
   *  animation and a vibration feedback." e.instanceId identifies which
   *  bubble in the instanced pool was hit. Guarded on the puff actually
   *  being mid-rise: parked slots sit at y=-5 at ~zero scale, and a stray
   *  ray shouldn't be able to "pop" one that isn't on screen. */
  const popPuff = (e) => {
    const i = e.instanceId;
    const pu = puffState.current;
    const p = pu.puffs[i];
    if (!p || p.t < 0 || p.t >= 1 + PUFF_SHRINK_FRAC || eggMotion.chimneyHeld) return;
    e.stopPropagation();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Retire the bubble instantly -- past the shrink tail, so the shared
    // loop parks it this frame AND the slot reads as free for the next
    // burst to claim.
    p.t = 1 + PUFF_SHRINK_FRAC;
    let spawned = 0;
    for (let d = 0; d < pu.dust.length && spawned < POP_DUST_PER_POP; d += 1) {
      const mote = pu.dust[d];
      if (mote.t < 1) continue;
      // Random point on a sphere, biased outward from where the bubble was.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      mote.dx = Math.sin(phi) * Math.cos(theta);
      mote.dy = Math.cos(phi);
      mote.dz = Math.sin(phi) * Math.sin(theta);
      mote.x = p.px;
      mote.y = p.py;
      mote.z = p.pz;
      mote.t = 0;
      spawned += 1;
    }
  };

  const grandmaGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.09, 8, 6), color: '#3a3229', position: [0, 0.62, 0] },
    { geometry: new SphereGeometry(0.16, 6, 6), color: '#3a3229', position: [0, 0.32, 0], scale: [0.9, 1.2, 0.5] },
    { geometry: new ConeGeometry(0.1, 0.14, 6), color: '#3a3229', position: [0, 0.66, 0.03], rotation: [0.3, 0, 0] },
  ]), []);

  // Live feedback: "sits down on the stool by the window and knits" -- a
  // small static stool (seat + 4 legs) under her, plus a pair of tiny
  // knitting needles nested as a CHILD of the grandmaRef mesh below (so
  // they inherit her own sway/rotation automatically instead of needing
  // their own per-frame code).
  const stoolGeometry = useMemo(() => {
    const legLen = STOOL_SEAT_H - 0.01;
    const legOffsets = [[0.07, 0.07], [-0.07, 0.07], [0.07, -0.07], [-0.07, -0.07]];
    return mergeColoredParts([
      { geometry: new CylinderGeometry(0.1, 0.1, 0.02, 8), color: STOOL_COLOR, position: [0, STOOL_SEAT_H, 0] },
      ...legOffsets.map(([lx, lz]) => ({
        geometry: new CylinderGeometry(0.012, 0.012, legLen, 6),
        color: STOOL_COLOR,
        position: [lx, legLen / 2, lz],
      })),
    ]);
  }, []);
  const needlesGeometry = useMemo(() => mergeColoredParts([
    { geometry: new CylinderGeometry(0.004, 0.004, 0.14, 4), color: '#8a8478', position: [-0.03, 0.34, 0.08], rotation: [rad(70), 0, rad(-15)] },
    { geometry: new CylinderGeometry(0.004, 0.004, 0.14, 4), color: '#8a8478', position: [0.03, 0.34, 0.08], rotation: [rad(70), 0, rad(15)] },
  ]), []);

  const birdGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.05, 6, 6), color: '#5a6470', position: [0, 0, 0] },
    { geometry: new SphereGeometry(0.035, 6, 6), color: '#5a6470', position: [0, 0.04, 0.06] },
    { geometry: new ConeGeometry(0.02, 0.05, 4), color: '#d9a441', position: [0, 0.04, 0.1], rotation: [Math.PI / 2, 0, 0] },
  ]), []);

  const state = useRef({
    birdNextIn: 10 + Math.random() * 8,
    birdT: -1,
    birdPhase: 'land', // land -> peck -> fly
  });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    const now = Date.now();

    // Chimney smoke spheres: burst-counter edge-detect starts all 3 puffs at
    // once, each with its own stagger delay (negative t counts up to 0
    // before it actually starts rising) and its own +/-20% random size --
    // also starts the normal-smoke suppression window (see smokeSuppressS's
    // own comment). Runs BEFORE the normal-smoke block below so a fresh
    // trigger this same frame is already reflected there.
    const pu = puffState.current;
    if (eggMotion.chimneySmokeBurst !== pu.seen) {
      pu.seen = eggMotion.chimneySmokeBurst;
      pu.smokeSuppressS = 0;
      // Claim only FREE slots (finished, or never started) -- anything still
      // rising from an earlier tap keeps its own t and carries on untouched,
      // so bursts stack instead of replacing each other.
      let started = 0;
      for (let i = 0; i < pu.puffs.length && started < PUFF_PER_BURST; i += 1) {
        const p = pu.puffs[i];
        if (p.t < 1 + PUFF_SHRINK_FRAC) continue;
        p.t = -started * PUFF_GAP_S;
        p.radius = PUFF_BASE_R * (1 + (Math.random() * 2 - 1) * PUFF_SIZE_VARIANCE);
        p.drift = Math.random() * Math.PI * 2;
        started += 1;
      }
    }
    if (puffRef.current) {
      pu.puffs.forEach((p, i) => {
        // Live feedback: "when the finger is on the pipe, let the smoke
        // disappear, but also let the motion animation end" -- a puff burst
        // still mid-rise from an earlier release kept climbing even while
        // the pipe was held closed again (only the AMBIENT smoke below was
        // gated by chimneyHeld). Gating both the advance AND `active` here
        // makes a fresh press instantly park/hide any puff in flight, not
        // just freeze it floating in place.
        //
        // Live feedback (round 2): "don't make them just disappear, let
        // them completely shrink" -- t's own range now extends past 1 into
        // a shrink tail (1..1+PUFF_SHRINK_FRAC) instead of parking the
        // instant the rise finishes; rise/sway-drift freeze at their t=1
        // values (Math.min(p.t,1)) while sway itself keeps using the
        // unclamped p.t so it keeps gently oscillating through the shrink
        // instead of freezing solid.
        if (!eggMotion.chimneyHeld && p.t < 1 + PUFF_SHRINK_FRAC) p.t += dt / PUFF_RISE_S;
        const active = !eggMotion.chimneyHeld && p.t >= 0 && p.t < 1 + PUFF_SHRINK_FRAC;
        const shrinkProgress = Math.max(0, Math.min(1, (p.t - 1) / PUFF_SHRINK_FRAC));
        const scale = p.radius * (1 - shrinkProgress);
        let px = chimneyPos[0];
        let pz = chimneyPos[2];
        if (active) {
          const riseT = Math.min(p.t, 1);
          const rise = riseT * PUFF_RISE_HEIGHT;
          const sway = Math.sin(p.t * Math.PI * 2 + p.drift) * 0.15;
          const windDriftX = wind.direction[0] * wind.strength * riseT * 0.5;
          const windDriftZ = wind.direction[2] * wind.strength * riseT * 0.5;
          px = chimneyPos[0] + sway + windDriftX;
          pz = chimneyPos[2] + sway * 0.6 + windDriftZ;
          dummy.position.set(px, chimneyPos[1] + rise, pz);
          dummy.scale.setScalar(scale);
          // Remembered for popPuff, which runs outside this loop.
          p.px = px;
          p.py = chimneyPos[1] + rise;
          p.pz = pz;
        } else {
          // Still waiting its own stagger delay, or already done -- parked
          // well below the ground either way.
          dummy.position.set(chimneyPos[0], -5, chimneyPos[2]);
          dummy.scale.setScalar(0.001);
        }
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        puffRef.current.setMatrixAt(i, dummy.matrix);

        // Live feedback: "bubbles... should have shadows... as cloud
        // spheres" -- same technique Sky.jsx's cloudShadowRef uses, tracking
        // this same puff's own sway/wind but pinned to a fixed height near
        // the roof surface instead of following its rise. Shrinks in sync
        // with the puff above.
        if (puffShadowRef.current) {
          if (active) {
            shadowDummy.position.set(px, chimneyPos[1] + PUFF_SHADOW_Y_OFFSET, pz);
            shadowDummy.scale.setScalar(scale * 2.2);
          } else {
            shadowDummy.position.set(chimneyPos[0], -5, chimneyPos[2]);
            shadowDummy.scale.setScalar(0.001);
          }
          shadowDummy.rotation.set(-Math.PI / 2, 0, 0);
          shadowDummy.updateMatrix();
          puffShadowRef.current.setMatrixAt(i, shadowDummy.matrix);
        }
      });
      puffRef.current.instanceMatrix.needsUpdate = true;
      if (puffShadowRef.current) puffShadowRef.current.instanceMatrix.needsUpdate = true;
      // An InstancedMesh keeps its OWN boundingSphere, computed once from
      // whatever the instance matrices held at that moment and then cached
      // forever. These puffs sit parked at y=-5 at ~zero scale until the
      // first tap, so that cached sphere is a speck under the ground -- and
      // three.js uses it for BOTH frustum culling and the raycast's early-out.
      //
      // Live feedback, and this one cause explains both halves of it: "tap
      // the pipe, smoke disappears but bubbles are not visible; rotate the
      // scene 180 to see the house from the distance and the bubbles are
      // there... but the bubbles are not popping." Invisible because the
      // whole mesh was frustum-culled whenever that speck at y=-5 fell
      // outside the view (rotating far enough away brings it back inside,
      // which is exactly why the far view worked); unpoppable because
      // raycast bails on the same stale sphere before ever testing an
      // instance. Recomputing after each matrix write fixes both. Called
      // rather than nulling: with the sphere already allocated this reuses
      // it, where nulling makes three allocate a fresh one every frame.
      puffRef.current.computeBoundingSphere();
      if (puffShadowRef.current) puffShadowRef.current.computeBoundingSphere();
    }

    // Pop dust: motes fly outward from the popped bubble on an easeOut arc
    // (fast spray, quick settle) while shrinking to nothing.
    if (popDustRef.current) {
      pu.dust.forEach((d, i) => {
        if (d.t < 1) d.t += dt / POP_DUST_S;
        if (d.t < 1) {
          const ease = 1 - (1 - d.t) * (1 - d.t);
          dummy.position.set(
            d.x + d.dx * POP_DUST_SPREAD * ease,
            d.y + d.dy * POP_DUST_SPREAD * ease + POP_DUST_RISE * ease,
            d.z + d.dz * POP_DUST_SPREAD * ease,
          );
          dummy.scale.setScalar(POP_DUST_R * (1 - d.t));
        } else {
          dummy.position.set(0, -5, 0);
          dummy.scale.setScalar(0.001);
        }
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        popDustRef.current.setMatrixAt(i, dummy.matrix);
      });
      popDustRef.current.instanceMatrix.needsUpdate = true;
      // Same stale-bounds trap as the puffs above -- these park at y=-5 too,
      // so without this the dust would be culled away exactly when it fires.
      popDustRef.current.computeBoundingSphere();
    }

    // Live feedback: "the default smoke disappears... after 6 seconds, the
    // smoke continues to billow" -- advance/expire the suppression window
    // started above, then hide (not reset) the normal smoke system while
    // it's active; its own simulation keeps running underneath so it picks
    // back up mid-flow rather than restarting once it reappears.
    if (pu.smokeSuppressS >= 0) {
      pu.smokeSuppressS += dt;
      if (pu.smokeSuppressS >= SMOKE_SUPPRESS_S) pu.smokeSuppressS = -1;
    }
    // Live feedback: chimney reworked to a press-and-hold gesture -- "long
    // press closes the pipe (no smoke), release makes smoke go out." While
    // held, normal smoke is hidden AND its own simulation is frozen (not
    // just hidden) so it reads as genuinely "closed" rather than quietly
    // building up out of view; ZoneLandmarks.jsx's onZoneRelease fires the
    // bubble-burst (which starts the timed smokeSuppressS window above) the
    // instant the press ends.
    const smokeSuppressed = pu.smokeSuppressS >= 0 || eggMotion.chimneyHeld;

    // --- Chimney smoke: always on, +30% spawn rate when active, and the
    // story's birth/rebirth beats double it (storyMotion.smokeBoost) ---
    if (smokeRef.current) {
      const targetOpacity = smokeSuppressed ? 0 : SMOKE_BASE_OPACITY;
      pu.smokeOpacity += (targetOpacity - pu.smokeOpacity) * Math.min(1, dt / SMOKE_FADE_S);
      smokeRef.current.visible = pu.smokeOpacity > 0.01;
      if (smokeMaterialRef.current) smokeMaterialRef.current.opacity = pu.smokeOpacity;
      const rate = (isActiveZone ? 1.3 : 1) * storyMotion.smokeBoost;
      const positions = smokeGeometry.attributes.position;
      smokeState.current.forEach((p, i) => {
        if (eggMotion.chimneyHeld) return; // frozen mid-puff while "closed"
        p.t += dt * rate * 0.4;
        if (p.t > 1) {
          p.t = 0;
          p.drift = Math.random() * Math.PI * 2;
        }
        const rise = p.t * 1.5;
        const sway = Math.sin(p.t * Math.PI * 2 + p.drift) * 0.15;
        // Live feedback: "the wind should gently rustle... the smoke" --
        // same wind.direction-scaled drift convention as GoldenHourExtras'
        // pollen/DustTrail's puffs, growing with rise (t) so the smoke
        // visibly leans further downwind the higher it climbs, same as
        // real chimney smoke, layered on top of the existing flutter sway.
        const windDriftX = wind.direction[0] * wind.strength * p.t * 0.5;
        const windDriftZ = wind.direction[2] * wind.strength * p.t * 0.5;
        positions.setXYZ(
          i,
          chimneyPos[0] + sway + windDriftX,
          chimneyPos[1] + rise,
          chimneyPos[2] + sway * 0.6 + windDriftZ,
        );
      });
      positions.needsUpdate = true;
      smokeGeometry.computeBoundingSphere();
    }

    // --- Birth chapter: kneading/shaping motion takes over the same
    // silhouette instead of the seated idle below (STORY_SPEC's birth
    // chapter toggles this while Kolobok is still dough on the sill). ---
    if (storyMotion.grandmaCooking) {
      if (grandmaRef.current) {
        grandmaRef.current.visible = true;
        // Side-to-side kneading sway + a small bob, faster/tighter than the
        // knitting idle so it reads as "working," not "sitting."
        grandmaRef.current.position.x = Math.sin(now / 260) * 0.1;
        grandmaRef.current.position.y = Math.abs(Math.sin(now / 260)) * 0.03;
        // z is untouched by the knitting idle below too, but set explicitly
        // here so this phase never depends on whatever the OTHER phase last
        // left it at.
        grandmaRef.current.position.z = 0;
        grandmaRef.current.rotation.z = Math.sin(now / 260) * rad(6);
      }
      return;
    }

    // --- Live feedback (round 3): "grandma should knit always when not
    // cooking Kolobok -- in story mode and non-story mode. This is her
    // idle state when not cooking." -- unconditional now, not gated on
    // isActiveZone/story state at all; the cooking branch above already
    // takes priority via its own early return. A gentle rocking sway
    // (slower/calmer than the kneading above) reads as repetitive
    // needle-work. ---
    if (grandmaRef.current) {
      grandmaRef.current.visible = true;
      grandmaRef.current.position.x = STOOL_X;
      grandmaRef.current.position.y = STOOL_SEAT_H;
      grandmaRef.current.position.z = STOOL_Z;
      grandmaRef.current.rotation.z = Math.sin(now / 500) * rad(3);
    }

    // --- Active-only: ridge bird lands, pecks x3, flies off, every ~15s ---
    if (isActiveZone) {
      if (s.birdT < 0) {
        s.birdNextIn -= dt;
        if (s.birdNextIn <= 0) { s.birdT = 0; s.birdPhase = 'land'; s.birdNextIn = 15; }
      } else {
        s.birdT += dt;
      }
    }
    if (birdRef.current) {
      const visible = isActiveZone && s.birdT >= 0 && s.birdT < 3.2;
      birdRef.current.visible = visible;
      if (visible) {
        const peckCycle = (s.birdT % 0.6) / 0.6;
        const pecking = s.birdT < 2.2;
        birdRef.current.rotation.x = pecking && peckCycle < 0.4 ? -((25 * Math.PI) / 180) * Math.sin(peckCycle * Math.PI * 2.5) : 0;
        birdRef.current.position.x = pecking ? 0 : (s.birdT - 2.2) * 1.5;
        birdRef.current.position.y = pecking ? 0 : (s.birdT - 2.2) * 0.4;
      } else if (s.birdT >= 3.2) {
        s.birdT = -1;
      }
    }
  });

  return (
    <group>
      <points ref={smokeRef} geometry={smokeGeometry}>
        <pointsMaterial
          ref={smokeMaterialRef}
          color="#c8c4bc"
          size={0.18}
          transparent
          opacity={SMOKE_BASE_OPACITY}
          depthWrite={false}
        />
      </points>
      {/* Live feedback: "bubbles... should have shadows... as cloud
          spheres" -- same flat radial-falloff shadow plane Sky.jsx's own
          cloudShadowRef uses. */}
      <instancedMesh ref={puffShadowRef} args={[undefined, undefined, PUFF_POOL]} renderOrder={1}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={puffShadowTexture} color="#1e1a14" transparent opacity={0.28} depthWrite={false} fog={false} />
      </instancedMesh>
      {/* Pop dust (live feedback): sits in the same never-occluded layer as
          the bubbles themselves, so a pop right in front of the roof reads
          as clearly as one against the sky. */}
      <instancedMesh ref={popDustRef} args={[undefined, undefined, POP_DUST_POOL]} renderOrder={3}>
        <sphereGeometry args={[1, 6, 5]} />
        <meshBasicMaterial color="#cfc6b6" transparent opacity={0.75} depthWrite={false} depthTest={false} fog={false} />
      </instancedMesh>
      {/* Chimney smoke spheres (live feedback, reworked): actual sphere
          meshes now (not Points) since each one needs its own independent
          size -- a PointsMaterial's `size` is one shared value for the
          whole pool, which can't express "vary by +/-20% each". */}
      <instancedMesh
        ref={puffRef}
        args={[undefined, undefined, PUFF_POOL]}
        material={puffMaterial}
        renderOrder={2}
        onClick={popPuff}
      >
        <sphereGeometry args={[1, 10, 8]} />
      </instancedMesh>
      {/* Live feedback: "sits down on the stool by the window and knits" --
          static stool (doesn't sway with her) at the same spot the frame
          loop above parks grandmaRef. */}
      <mesh geometry={stoolGeometry} position={[STOOL_X, 0, STOOL_Z]}>
        <meshStandardMaterial vertexColors roughness={0.8} />
      </mesh>
      <mesh ref={grandmaRef} geometry={grandmaGeometry} position={[0, 0, 0]} visible={false}>
        <meshBasicMaterial vertexColors />
        {/* Nested so the needles inherit grandma's own position/rotation
            (sway) automatically instead of needing their own per-frame code. */}
        <mesh geometry={needlesGeometry}>
          <meshStandardMaterial vertexColors roughness={0.6} />
        </mesh>
      </mesh>
      <mesh ref={birdRef} geometry={birdGeometry} position={[0, 1.85, -0.05]} visible={false}>
        <meshStandardMaterial vertexColors roughness={0.8} />
      </mesh>
    </group>
  );
}

// ======================================================= Hare meadow ======
export function HareAmbience({ isActiveZone }) {
  const butterfliesRef = useRef();
  const count = 3; // 2 always + 1 active-only (hidden via scale when inactive)

  const wanderState = useRef(
    new Array(count).fill(0).map((_, i) => ({
      angle: (i / count) * Math.PI * 2,
      radius: 0.6 + Math.random() * 0.9,
      heightPhase: Math.random() * Math.PI * 2,
      landedT: -1,
      nextLandIn: 6 + Math.random() * 6,
    })),
  );

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const mesh = butterfliesRef.current;
    if (!mesh) return;
    let idx = 0;
    wanderState.current.forEach((b, i) => {
      const active = i < 2 || isActiveZone;
      if (active && i === 2 && b.landedT < 0) {
        b.nextLandIn -= dt;
        if (b.nextLandIn <= 0) { b.landedT = 0; b.nextLandIn = 9; }
      }
      if (b.landedT >= 0) {
        b.landedT += dt;
        if (b.landedT > 1.2) b.landedT = -1;
      }
      b.angle += dt * 0.3;
      const landed = b.landedT >= 0;
      const height = landed ? 0.35 : 0.3 + Math.sin(b.heightPhase + b.angle * 2) * 0.3 + 0.3;
      const x = Math.sin(b.angle) * b.radius;
      const z = Math.cos(b.angle) * b.radius;
      const flapHz = landed ? 1 : 8;
      const flap = Math.sin(Date.now() / 1000 * Math.PI * 2 * flapHz) * 0.4;

      for (let w = 0; w < 2; w++) {
        const side = w === 0 ? 1 : -1;
        dummy.position.set(x, height, z);
        dummy.rotation.set(0, b.angle, side * (0.5 + flap * 0.5));
        dummy.scale.set(active ? 1 : 0, active ? 1 : 0, active ? 1 : 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
        mesh.setColorAt(idx, BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length]);
        idx += 1;
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={butterfliesRef} args={[undefined, undefined, count * 2]}>
      <planeGeometry args={[0.06, 0.05]} />
      <meshBasicMaterial side={DoubleSide} transparent opacity={0.9} />
    </instancedMesh>
  );
}
const BUTTERFLY_COLORS = [new Color('#e8a8c8'), new Color('#e8e26e'), new Color('#e0e9f2')];

// ======================================================== Wolf forest =====
export function WolfAmbience({ isActiveZone }) {
  const wispsRef = useRef();
  const wispsMaterialRef = useRef();
  const crowRef = useRef();

  const crowGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.055, 6, 6), color: '#2e2e33', position: [0, 0, 0] },
    { geometry: new SphereGeometry(0.04, 6, 6), color: '#2e2e33', position: [0, 0.045, 0.07] },
  ]), []);

  const state = useRef({ wispPhase: [0, 2, 4].map((v) => v), crowNextIn: 20 + Math.random() * 10, crowT: -1 });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;

    if (wispsRef.current) {
      const mesh = wispsRef.current;
      s.wispPhase = s.wispPhase.map((p) => p + dt * 0.05);
      s.wispPhase.forEach((p, i) => {
        const r = 1.1 + i * 0.3;
        dummy.position.set(Math.sin(p) * r, 0.08, Math.cos(p) * r);
        dummy.rotation.set(0, p, 0);
        dummy.scale.set(1.4, 0.25, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      // Per-instance opacity isn't supported on a shared-material
      // instancedMesh without a custom shader; approximated as one shared
      // flutter across all three wisps together rather than independently.
      if (wispsMaterialRef.current) {
        wispsMaterialRef.current.opacity = 0.12 + Math.sin(Date.now() / 800) * 0.03;
      }
    }

    if (isActiveZone) {
      if (s.crowT < 0) {
        s.crowNextIn -= dt;
        if (s.crowNextIn <= 0) { s.crowT = 0; s.crowNextIn = 25; }
      } else {
        s.crowT += dt;
        if (s.crowT > 2.5) s.crowT = -1;
      }
    }
    if (crowRef.current) {
      const visible = isActiveZone && s.crowT >= 0;
      crowRef.current.visible = visible;
      if (visible) {
        const t = s.crowT / 2.5;
        crowRef.current.position.set(-1.5 + t * 3, 2.4 + Math.sin(t * Math.PI * 4) * 0.08, 0.4);
        crowRef.current.rotation.z = Math.sin(t * 6) * 0.05;
      }
    }
  });

  return (
    <group>
      <instancedMesh ref={wispsRef} args={[undefined, undefined, 3]}>
        <sphereGeometry args={[0.25, 8, 6]} />
        <meshBasicMaterial ref={wispsMaterialRef} color="#cfd8de" transparent opacity={0.12} depthWrite={false} />
      </instancedMesh>
      <mesh ref={crowRef} geometry={crowGeometry} visible={false}>
        <meshBasicMaterial vertexColors />
      </mesh>
    </group>
  );
}

// ======================================================= Bear thicket =====
export function BearAmbience({ isActiveZone }) {
  const leavesRef = useRef();
  const beesRef = useRef();
  const logRef = useRef();

  const LEAF_COUNT = 2;
  const BEE_MAX = 5;

  const leafGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(LEAF_COUNT * 3), 3));
    return geo;
  }, []);
  const leafState = useRef(new Array(LEAF_COUNT).fill(0).map((_, i) => ({ t: i / LEAF_COUNT, angle: Math.random() * Math.PI * 2 })));

  const beeGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(BEE_MAX * 3), 3));
    return geo;
  }, []);
  // Live feedback: "wider arcs -- right now they're hiding in the bear."
  // The orbit was centered on [0,0,0] (this zone group's own origin, i.e.
  // exactly where the Bear character itself stands) with a tiny 0.2-0.3
  // radius -- easily occluded by the bear's own body. Recentered on the
  // honey log's position (see logRef's own [0.5,0.12,0.3] below, lifted a
  // bit above it) and widened well past the bear's silhouette.
  const BEE_ORBIT_CENTER = [0.5, 0.3, 0.3];
  const beeState = useRef(new Array(BEE_MAX).fill(0).map((_, i) => ({ angle: (i / BEE_MAX) * Math.PI * 2, r: 0.5 + Math.random() * 0.3 })));

  const logGeometry = useMemo(() => mergeColoredParts([
    { geometry: new CylinderGeometry(0.12, 0.12, 0.7, 8), color: '#6b4c33', rotation: [0, 0, Math.PI / 2] },
    { geometry: new SphereGeometry(0.08, 6, 6), color: '#e8c04a', position: [0.15, 0.1, 0], scale: [1, 0.4, 1] },
  ]), []);

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;

    if (leavesRef.current) {
      const positions = leafGeometry.attributes.position;
      leafState.current.forEach((l, i) => {
        l.t += dt / 3.5;
        if (l.t > 1) l.t = 0;
        const y = 2.2 - l.t * 2.2;
        const spiral = l.angle + l.t * Math.PI * 2 * 3.5;
        positions.setXYZ(i, Math.sin(spiral) * 0.15, y, Math.cos(spiral) * 0.15);
      });
      positions.needsUpdate = true;
      leafGeometry.computeBoundingSphere();
    }

    if (beesRef.current) {
      const positions = beeGeometry.attributes.position;
      const activeCount = isActiveZone ? BEE_MAX : 3;
      beeState.current.forEach((b, i) => {
        if (i >= activeCount) {
          positions.setXYZ(i, 0, -10, 0); // parked off-screen rather than a variable-length buffer
          return;
        }
        b.angle += dt * 1.2;
        const wobble = Math.sin(Date.now() / 300 + i) * 0.05;
        positions.setXYZ(
          i,
          BEE_ORBIT_CENTER[0] + Math.sin(b.angle) * b.r,
          BEE_ORBIT_CENTER[1] + wobble,
          BEE_ORBIT_CENTER[2] + Math.cos(b.angle) * b.r,
        );
      });
      positions.needsUpdate = true;
      beeGeometry.computeBoundingSphere();
    }
  });

  return (
    <group>
      <points ref={leavesRef} geometry={leafGeometry}>
        <pointsMaterial color="#c9a24b" size={0.09} depthWrite={false} />
      </points>
      <points ref={beesRef} geometry={beeGeometry}>
        <pointsMaterial color="#e8c04a" size={0.06} depthWrite={false} />
      </points>
      <mesh ref={logRef} geometry={logGeometry} position={[0.5, 0.12, 0.3]}>
        <meshStandardMaterial vertexColors roughness={0.9} />
      </mesh>
    </group>
  );
}

// ======================================================= Fox clearing =====
export function FoxAmbience({ isActiveZone }) {
  const featherRef = useRef();
  const state = useRef({ nextIn: 20, t: -1, driftAngle: 0 });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    if (isActiveZone) {
      if (s.t < 0) {
        s.nextIn -= dt;
        if (s.nextIn <= 0) { s.t = 0; s.nextIn = 20; s.driftAngle = 0; }
      } else {
        s.t += dt / 4;
        if (s.t >= 1) s.t = -1;
      }
    }
    if (featherRef.current) {
      const visible = isActiveZone && s.t >= 0;
      featherRef.current.visible = visible;
      if (visible) {
        s.driftAngle += dt * 0.6 * Math.PI * 2;
        featherRef.current.position.set(Math.sin(s.driftAngle) * 0.2, 1.8 - s.t * 1.8, 0);
        featherRef.current.rotation.z = Math.sin(s.driftAngle) * ((20 * Math.PI) / 180);
      }
    }
  });

  return (
    <mesh ref={featherRef} visible={false}>
      <planeGeometry args={[0.08, 0.03]} />
      <meshBasicMaterial color="#f2e8d8" side={DoubleSide} />
    </mesh>
  );
}
