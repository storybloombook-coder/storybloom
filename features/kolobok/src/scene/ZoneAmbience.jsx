import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
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
const PUFF_COUNT = 3;
const CHIMNEY_PIPE_TOP_R = 0.055;
const PUFF_BASE_R = CHIMNEY_PIPE_TOP_R * 2; // sphere diameter = 2x pipe diameter -> sphere radius = pipe diameter
const PUFF_SIZE_VARIANCE = 0.2;
const PUFF_GAP_S = 0.3;
const PUFF_RISE_S = 3;
// Live feedback: "bubbles coming from the pipe should have shadows and
// light effects as cloud spheres" -- PUFF_SHADOW_Y is a fixed height near
// the roof surface below the chimney (ZoneLandmarks.jsx's CHIMNEY_LOCAL/
// makeIzbaRoofBase put the surface there at ~1.41; chimneyPos[1] below is
// the pipe's own TOP at 1.65), tracking each puff's own sway/wind but
// pinned to that one height rather than following the puff's own rise.
const PUFF_SHADOW_Y_OFFSET = -0.24;
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

export function IzbaAmbience({ isActiveZone, chimneyPos = [0.55, 1.65, 0.15] }) {
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
  // Live feedback: "shadows and light effects as cloud spheres" -- same
  // toon material + rimStrength=0.35 treatment Sky.jsx's own clouds use
  // ("apply the same lighting effect to the clouds as on the characters"),
  // instead of the old bare unlit meshBasicMaterial.
  const puffMaterial = useMemo(() => {
    const m = makeToonMaterial({ color: '#7a756c', rimStrength: 0.35 });
    m.transparent = true;
    m.opacity = 0.55;
    m.fog = false;
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
    puffs: new Array(PUFF_COUNT).fill(0).map(() => ({ t: 1, radius: PUFF_BASE_R, drift: 0 })),
    // -1 = normal smoke showing as usual; 0..SMOKE_SUPPRESS_S seconds =
    // counting up while normal smoke stays hidden.
    smokeSuppressS: -1,
    smokeOpacity: SMOKE_BASE_OPACITY,
  });

  const grandmaGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.09, 8, 6), color: '#3a3229', position: [0, 0.62, 0] },
    { geometry: new SphereGeometry(0.16, 6, 6), color: '#3a3229', position: [0, 0.32, 0], scale: [0.9, 1.2, 0.5] },
    { geometry: new ConeGeometry(0.1, 0.14, 6), color: '#3a3229', position: [0, 0.66, 0.03], rotation: [0.3, 0, 0] },
  ]), []);

  const birdGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.05, 6, 6), color: '#5a6470', position: [0, 0, 0] },
    { geometry: new SphereGeometry(0.035, 6, 6), color: '#5a6470', position: [0, 0.04, 0.06] },
    { geometry: new ConeGeometry(0.02, 0.05, 4), color: '#d9a441', position: [0, 0.04, 0.1], rotation: [Math.PI / 2, 0, 0] },
  ]), []);

  const state = useRef({
    grandmaNextIn: 20 + Math.random() * 15,
    grandmaT: -1, // -1 idle, 0..1 crossing
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
      pu.puffs.forEach((p, i) => {
        p.t = -i * PUFF_GAP_S;
        p.radius = PUFF_BASE_R * (1 + (Math.random() * 2 - 1) * PUFF_SIZE_VARIANCE);
        p.drift = Math.random() * Math.PI * 2;
      });
    }
    if (puffRef.current) {
      pu.puffs.forEach((p, i) => {
        // Live feedback: "when the finger is on the pipe, let the smoke
        // disappear, but also let the motion animation end" -- a puff burst
        // still mid-rise from an earlier release kept climbing even while
        // the pipe was held closed again (only the AMBIENT smoke below was
        // gated by chimneyHeld). Gating both the advance AND `rising` here
        // makes a fresh press instantly park/hide any puff in flight, not
        // just freeze it floating in place.
        if (!eggMotion.chimneyHeld && p.t < 1) p.t += dt / PUFF_RISE_S;
        const rising = !eggMotion.chimneyHeld && p.t >= 0 && p.t < 1;
        let px = chimneyPos[0];
        let pz = chimneyPos[2];
        if (rising) {
          const rise = p.t * 1.5;
          const sway = Math.sin(p.t * Math.PI * 2 + p.drift) * 0.15;
          const windDriftX = wind.direction[0] * wind.strength * p.t * 0.5;
          const windDriftZ = wind.direction[2] * wind.strength * p.t * 0.5;
          px = chimneyPos[0] + sway + windDriftX;
          pz = chimneyPos[2] + sway * 0.6 + windDriftZ;
          dummy.position.set(px, chimneyPos[1] + rise, pz);
          dummy.scale.setScalar(p.radius);
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
        // the roof surface instead of following its rise.
        if (puffShadowRef.current) {
          if (rising) {
            shadowDummy.position.set(px, chimneyPos[1] + PUFF_SHADOW_Y_OFFSET, pz);
            shadowDummy.scale.setScalar(p.radius * 2.2);
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
    // silhouette instead of the ambient crossing below (STORY_SPEC's birth
    // chapter toggles this while Kolobok is still dough on the sill). ---
    if (storyMotion.grandmaCooking) {
      if (grandmaRef.current) {
        grandmaRef.current.visible = true;
        // Side-to-side kneading sway + a small bob, faster/tighter than the
        // slow window-crossing walk so it reads as "working," not "passing by".
        grandmaRef.current.position.x = Math.sin(now / 260) * 0.1;
        grandmaRef.current.position.y = Math.abs(Math.sin(now / 260)) * 0.03;
        grandmaRef.current.rotation.z = Math.sin(now / 260) * rad(6);
      }
      return;
    }

    // --- Active-only: grandma silhouette crosses the window every 20-35s ---
    if (isActiveZone) {
      if (s.grandmaT < 0) {
        s.grandmaNextIn -= dt;
        if (s.grandmaNextIn <= 0) { s.grandmaT = 0; s.grandmaNextIn = 20 + Math.random() * 15; }
      } else {
        s.grandmaT += dt / 1.8;
        if (s.grandmaT >= 1) s.grandmaT = -1;
      }
    }
    if (grandmaRef.current) {
      grandmaRef.current.visible = s.grandmaT >= 0;
      if (s.grandmaT >= 0) {
        grandmaRef.current.position.x = -0.15 + s.grandmaT * 0.3;
        grandmaRef.current.position.y = 0;
        grandmaRef.current.rotation.z = 0;
      }
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
      <instancedMesh ref={puffShadowRef} args={[undefined, undefined, PUFF_COUNT]} renderOrder={1}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={puffShadowTexture} color="#1e1a14" transparent opacity={0.28} depthWrite={false} fog={false} />
      </instancedMesh>
      {/* Chimney smoke spheres (live feedback, reworked): actual sphere
          meshes now (not Points) since each one needs its own independent
          size -- a PointsMaterial's `size` is one shared value for the
          whole pool, which can't express "vary by +/-20% each". */}
      <instancedMesh ref={puffRef} args={[undefined, undefined, PUFF_COUNT]} material={puffMaterial}>
        <sphereGeometry args={[1, 10, 8]} />
      </instancedMesh>
      <mesh ref={grandmaRef} geometry={grandmaGeometry} position={[0, 0, 0]} visible={false}>
        <meshBasicMaterial vertexColors />
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
  const beeState = useRef(new Array(BEE_MAX).fill(0).map((_, i) => ({ angle: (i / BEE_MAX) * Math.PI * 2, r: 0.2 + Math.random() * 0.1 })));

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
        positions.setXYZ(i, Math.sin(b.angle) * b.r, 0.15 + wobble, Math.cos(b.angle) * b.r);
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
