import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import {
  BoxGeometry, ConeGeometry, Object3D, SphereGeometry,
} from 'three';
import { useSceneStore } from '../state/sceneStore';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { makeToonMaterial } from './materials/toonMaterial';

const dummy = new Object3D();

// Live feedback #7: "tap the willow 3x -> 3 magpies fly out... random
// S-shape... disappear into the sky... return after 15 seconds, and then
// the easter egg can be repeated." All 3 launch and return TOGETHER as one
// group (not independently tappable like Birds.jsx's crossroads flock), so
// a single shared cycle clock (magpieCycle) drives all 3 -- simpler than a
// per-magpie state machine since they're never out of sync with each other.
const MAGPIE_COUNT = 3;
// Live feedback: "fly 30% slower" -- speed x0.7 means duration /0.7 for the
// same distance (was a flat 1.8s each way).
const FLIGHT_SPEED_MULT = 0.7;
const LAUNCH_S = 1.8 / FLIGHT_SPEED_MULT; // fly up and away, S-shaped
const AWAY_S = 15; // "return after 15 seconds"
const RETURN_S = 1.8 / FLIGHT_SPEED_MULT; // same S-path in reverse (mirrors
// Hedgehog.jsx's own "returns along the same trajectory" convention)
const WING_FLAP_HZ = 8;
const WING_FLAP_AMP = (50 * Math.PI) / 180;
const BODY_R = 0.09;
const WING_LEN = 0.13;
const WING_THICK = 0.01;
const WING_DEPTH = 0.06;

/** Shared cycle state + per-magpie flight targets, module-level (like
 *  easterEggs.js's own eggMotion / Vegetation.jsx's hedgehogPool) so
 *  PondAndGrandpa.jsx's willow-tap handler can trigger this without a store
 *  round-trip, and this component can own its own useFrame independently. */
export const magpieCycle = { active: false, phase: 'hidden', t: 0 };
export const magpies = new Array(MAGPIE_COUNT).fill(0).map(() => ({
  toX: 0, toY: 0, toZ: 0, seed: 0, wingPhase: Math.random() * Math.PI * 2,
}));
let originX = 0;
let originY = 0;
let originZ = 0;

/** Sends the whole flock out from (ox,oy,oz) -- ignored if a cycle is
 *  already in flight, so "the easter egg can be repeated" only once ALL 3
 *  are back and hidden. Each magpie gets its own random escape angle/
 *  distance/height and S-curve seed, so the 3 disperse rather than flying
 *  in an identical clump. */
export function launchMagpies(ox, oy, oz) {
  if (magpieCycle.active) return;
  magpieCycle.active = true;
  magpieCycle.phase = 'launch';
  magpieCycle.t = 0;
  originX = ox;
  originY = oy;
  originZ = oz;
  magpies.forEach((m) => {
    const escapeAngle = Math.random() * Math.PI * 2;
    const dist = 3 + Math.random() * 2.5;
    const height = 6 + Math.random() * 3;
    m.toX = ox + Math.sin(escapeAngle) * dist;
    m.toY = oy + height;
    m.toZ = oz + Math.cos(escapeAngle) * dist;
    m.seed = Math.random();
  });
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  useSceneStore.getState().recordEggFound('magpie');
}

/** A true S-curve (not just a single-sided bulge): a full sine cycle across
 *  the horizontal-plane perpendicular offset means the path bulges one way
 *  then the other, tapering to exactly 0 at both ends (start = the willow,
 *  end = this magpie's own escape point) -- reads as an actual "S" rather
 *  than a "C". The vertical climb (dy) is a plain linear lerp on top. */
function magpiePathPoint(t, toX, toY, toZ, seed) {
  const dx = toX - originX;
  const dy = toY - originY;
  const dz = toZ - originZ;
  const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
  const px = -dz / len;
  const pz = dx / len;
  const side = seed < 0.5 ? 1 : -1;
  const amp = len * (0.15 + seed * 0.2) * side;
  const wobble = Math.sin(t * Math.PI * 2) * amp;
  return [originX + dx * t + px * wobble, originY + dy * t, originZ + dz * t + pz * wobble];
}

/** Magpies (live feedback #7): hidden until the willow is tapped 3 times,
 *  then the whole flock flies out along a random S-path, vanishes for 15s,
 *  and flies back along the same path in reverse. magpieCycle/magpies above
 *  are the entire interface -- PondAndGrandpa.jsx's onWillowGrab triggers it
 *  via launchMagpies(), this component only ever reads/advances it. */
export function Magpies() {
  const bodyRef = useRef();
  const wingRef = useRef();

  const bodyGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(BODY_R, 8, 6), color: '#1a1a1a', position: [0, 0, 0] },
    {
      geometry: new SphereGeometry(BODY_R * 0.7, 6, 6),
      color: '#f2f2f2',
      scale: [0.85, 0.75, 0.85],
      position: [0, -0.015, 0.02],
    },
    // Magpies' signature long tail -- the one detail that reads "magpie"
    // rather than just "small black bird" at this scale.
    {
      geometry: new ConeGeometry(BODY_R * 0.22, BODY_R * 2.1, 4),
      color: '#1a1a1a',
      position: [0, -0.01, -BODY_R * 1.4],
      rotation: [Math.PI / 2, 0, 0],
    },
  ]), []);

  const wingGeometry = useMemo(() => new BoxGeometry(WING_LEN, WING_THICK, WING_DEPTH), []);

  const materials = useMemo(() => ({
    body: makeToonMaterial({ vertexColors: true, color: '#1a1a1a', rimStrength: 0.35 }),
    wing: makeToonMaterial({ color: '#1a1a1a', rimStrength: 0.35 }),
  }), []);

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const c = magpieCycle;
    if (!c.active) {
      if (bodyRef.current) bodyRef.current.visible = false;
      if (wingRef.current) wingRef.current.visible = false;
      return;
    }

    c.t += dt;
    if (c.phase === 'launch' && c.t >= LAUNCH_S) {
      c.phase = 'away';
      c.t = 0;
    } else if (c.phase === 'away' && c.t >= AWAY_S) {
      c.phase = 'return';
      c.t = 0;
    } else if (c.phase === 'return' && c.t >= RETURN_S) {
      c.phase = 'hidden';
      c.t = 0;
      c.active = false;
    }

    const visible = c.phase === 'launch' || c.phase === 'return';
    if (bodyRef.current) bodyRef.current.visible = visible;
    if (wingRef.current) wingRef.current.visible = visible;
    if (!visible) return;

    // sT: 0..1 progress along the physical willow->escape-point curve,
    // regardless of direction -- launch counts it up, return counts the
    // SAME curve back down (retracing it), matching Hedgehog.jsx's own
    // approach/return convention.
    const sT = c.phase === 'launch' ? c.t / LAUNCH_S : 1 - c.t / RETURN_S;
    const dirSign = c.phase === 'launch' ? 1 : -1;

    magpies.forEach((m, i) => {
      const [x, y, z] = magpiePathPoint(sT, m.toX, m.toY, m.toZ, m.seed);
      const aheadT = Math.min(1, Math.max(0, sT + dirSign * 0.02));
      const [nx, , nz] = magpiePathPoint(aheadT, m.toX, m.toY, m.toZ, m.seed);
      const yaw = Math.atan2(nx - x, nz - z);

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      if (bodyRef.current) bodyRef.current.setMatrixAt(i, dummy.matrix);

      m.wingPhase += dt * WING_FLAP_HZ * Math.PI * 2;
      const flap = Math.sin(m.wingPhase) * WING_FLAP_AMP;
      [1, -1].forEach((side, wi) => {
        dummy.position.set(
          x + Math.sin(yaw + (Math.PI / 2) * side) * BODY_R * 0.6,
          y,
          z + Math.cos(yaw + (Math.PI / 2) * side) * BODY_R * 0.6,
        );
        dummy.rotation.set(0, yaw, side * flap);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        if (wingRef.current) wingRef.current.setMatrixAt(i * 2 + wi, dummy.matrix);
      });
    });
    if (bodyRef.current) bodyRef.current.instanceMatrix.needsUpdate = true;
    if (wingRef.current) wingRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={bodyRef} args={[bodyGeometry, materials.body, MAGPIE_COUNT]} visible={false} />
      <instancedMesh
        ref={wingRef}
        args={[wingGeometry, materials.wing, MAGPIE_COUNT * 2]}
        visible={false}
      />
    </group>
  );
}
