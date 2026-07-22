import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, ConeGeometry,
  CylinderGeometry, DoubleSide, Matrix4, Object3D, Quaternion, SphereGeometry, Vector3,
} from 'three';
import {
  rad, pointOnCircle, POND_ANGLE_DEG, POND_RADIUS, PATH_RADIUS,
} from '../config/zones';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { eggMotion, eggManager } from './easterEggs';
import { makeToonMaterial } from './materials/toonMaterial';
import { makeRng } from './prng';

const dummy = new Object3D();

// ART_SPEC §14: pond at 324 deg, radius 5.6 (the free arc between fox and
// izba, rim side of the path).
const POND_ANGLE = rad(POND_ANGLE_DEG);
const POND_POS = pointOnCircle(POND_RADIUS, POND_ANGLE);

const RECAST_INTERVAL = 30;
const RIPPLE_COUNT = 3;

// Live feedback: the bridge should curve to match the path's own radius,
// not cut a straight chord across it. Bridge points are sampled directly
// on the WORLD path circle (radius PATH_RADIUS) around POND_ANGLE, then
// converted into this group's local space via the group's own transform
// matrix, inverted -- using three.js's actual matrix math rather than
// hand-derived trig avoids re-deriving (and risking getting backwards) the
// sign conventions the -90deg offset in Island.jsx's ring-gap math needed.
const BRIDGE_ARC_HALF_DEG = 17; // roughly the old straight bridge's half-length at PATH_RADIUS
const BRIDGE_SEGMENTS = 7;
const POND_GROUP_INVERSE = new Matrix4()
  .compose(
    new Vector3(...POND_POS),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), POND_ANGLE + Math.PI),
    new Vector3(1, 1, 1),
  )
  .invert();
const bridgeWorldToLocal = (worldAngle, worldRadius) => new Vector3(
  Math.sin(worldAngle) * worldRadius,
  0,
  Math.cos(worldAngle) * worldRadius,
).applyMatrix4(POND_GROUP_INVERSE);

// A shared, seeded irregular-radius profile so the water and its matte rim
// nest consistently (same wobble, rim just scaled a bit bigger) instead of
// two independently-random circles that wouldn't line up -- a real pond
// is never a perfect circle (POLISH_SPEC-adjacent art note, live feedback).
const POND_SEGMENTS = 20;
const pondProfile = (() => {
  const rng = makeRng(140);
  const arr = [];
  for (let i = 0; i < POND_SEGMENTS; i++) arr.push(1 + (rng() * 2 - 1) * 0.22);
  return arr;
})();

/** A flat fan-triangulated disc (built in the local XY plane, like
 *  THREE.CircleGeometry, so it takes the same `rotation={[-PI/2,0,0]}` to
 *  lie flat) whose rim radius follows `profile` -- an organic pond outline
 *  instead of a perfect circle. */
function makeBlobDiscGeometry(baseRadius, profile) {
  const n = profile.length;
  const positions = new Float32Array((n + 1) * 3);
  const uvs = new Float32Array((n + 1) * 2);
  uvs[0] = 0.5; uvs[1] = 0.5;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const r = baseRadius * profile[i];
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    positions[(i + 1) * 3] = x;
    positions[(i + 1) * 3 + 1] = y;
    positions[(i + 1) * 3 + 2] = 0;
    uvs[(i + 1) * 2] = 0.5 + Math.cos(angle) * 0.5;
    uvs[(i + 1) * 2 + 1] = 0.5 + Math.sin(angle) * 0.5;
  }
  const indices = [];
  for (let i = 0; i < n; i++) indices.push(0, i + 1, ((i + 1) % n) + 1);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** The pond + Grandpa fishing (ART_SPEC §14 / EASTER_EGGS.md §2): always-on
 *  ambient (float bob, ~30s recasts with ripples) plus the tap-egg catch
 *  animation driven by eggMotion. 6 draw calls. */
export function PondAndGrandpa() {
  const rodRef = useRef();
  const floatRef = useRef();
  const fishRef = useRef();
  const fishMatRef = useRef();
  const headRef = useRef();
  const ripplesRef = useRef();
  const waterMatRef = useRef();
  const glintRef = useRef();
  const splashRipplesRef = useRef();
  const dropletsRef = useRef();

  // Reeds/cane scattered around the shore (8-12, up from the old fixed 2) --
  // seeded so placement is stable across reloads, keeping clear of Grandpa's
  // stump (~207 deg local, atan2(-0.6,-1.15)) so nothing pokes through him.
  const reedParts = useMemo(() => {
    const rng = makeRng(141);
    const GRANDPA_ANGLE = Math.atan2(-0.6, -1.15);
    const parts = [];
    let placed = 0;
    let guard = 0;
    while (placed < 10 && guard < 60) {
      guard += 1;
      const angle = rng() * Math.PI * 2;
      let d = Math.abs(angle - GRANDPA_ANGLE);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < rad(35)) continue; // too close to Grandpa's stump
      const r = 1.05 + rng() * 0.55;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = 0.32 + rng() * 0.28;
      parts.push({ geometry: new CylinderGeometry(0.018, 0.018, h, 5), color: '#5d8a3f', position: [x, h / 2, z] });
      parts.push({ geometry: new ConeGeometry(0.035, 0.11, 5), color: '#5d8a3f', position: [x, h + 0.035, z] });
      placed += 1;
    }
    return parts;
  }, []);

  // BACKLOG.md #6: a willow at the pond's edge (drooping canopy), replacing
  // the birch-in-water idea -- its own mesh/draw call (not merged into
  // matteGeometry) since it needs several DIFFERENT vertex colors
  // (trunk/canopy/fronds) and mergeColoredParts only bakes ONE flat color
  // per part list entry. Fronds are thin cylinders leaning outward+down
  // from the canopy at random (seeded) azimuths -- rotation.x tilts a
  // vertical cylinder toward local +Z, rotation.y then yaws that lean to
  // the desired azimuth (same sin/cos-around-Y convention as the rest of
  // the scene), so each frond droops out and down like real willow branches.
  const WILLOW_CANOPY_Y = 0.62;
  const willowGeometry = useMemo(() => {
    const rng = makeRng(777);
    const parts = [
      { geometry: new CylinderGeometry(0.05, 0.08, 0.5, 7), color: '#6b5d46', position: [0, 0.25, 0], rotation: [0, 0, rad(6)] },
      { geometry: new SphereGeometry(0.3, 8, 6), color: '#8fae5c', position: [0.02, WILLOW_CANOPY_Y, 0], scale: [1.2, 0.8, 1.2] },
    ];
    const FROND_COUNT = 12;
    for (let i = 0; i < FROND_COUNT; i++) {
      const angle = (i / FROND_COUNT) * Math.PI * 2 + rng() * 0.5;
      const len = 0.5 + rng() * 0.3;
      const tilt = rad(58) + rng() * rad(18); // mostly downward droop
      const rIn = 0.16 + rng() * 0.08;
      parts.push({
        geometry: new CylinderGeometry(0.01, 0.018, len, 4),
        color: '#9bb06a',
        position: [Math.sin(angle) * rIn, WILLOW_CANOPY_Y - 0.08, Math.cos(angle) * rIn],
        rotation: [tilt, angle, 0],
      });
    }
    return mergeColoredParts(parts);
  }, []);

  // Wooden arc bridge: stepped planks following the path's own curve (not a
  // straight chord -- live feedback), each plank/rail-segment oriented
  // along its local tangent so they visibly follow the bend, held up by
  // posts whose height is computed per-position so the rail stays level
  // while the deck beneath it arches.
  const bridgeParts = useMemo(() => {
    const parts = [];
    const DECK_Y = 0.1;
    const ARCH = 0.22;
    const RAIL_Y = DECK_Y + ARCH + 0.32;

    const points = [];
    for (let i = 0; i < BRIDGE_SEGMENTS; i++) {
      const t = i / (BRIDGE_SEGMENTS - 1);
      const worldAngle = rad(POND_ANGLE_DEG + (-BRIDGE_ARC_HALF_DEG + t * BRIDGE_ARC_HALF_DEG * 2));
      points.push(bridgeWorldToLocal(worldAngle, PATH_RADIUS));
    }
    const endToEnd = points[0].distanceTo(points[BRIDGE_SEGMENTS - 1]);
    const segLen = (endToEnd / (BRIDGE_SEGMENTS - 1)) * 1.15;

    const postXZ = []; // [{x,z,y}] per point per side, filled below, used for the rail segments after
    points.forEach((p, i) => {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(BRIDGE_SEGMENTS - 1, i + 1)];
      const tx = next.x - prev.x;
      const tz = next.z - prev.z;
      const tlen = Math.max(0.0001, Math.sqrt(tx * tx + tz * tz));
      const ux = tx / tlen;
      const uz = tz / tlen;
      const px = -uz; // perpendicular (rail/post side offset direction)
      const pz = ux;
      const yaw = Math.atan2(-uz, ux); // rotation.y aligning local +X with the tangent (ux,uz)
      const t = i / (BRIDGE_SEGMENTS - 1);
      const deckY = DECK_Y + Math.sin(t * Math.PI) * ARCH;

      parts.push({
        geometry: new BoxGeometry(segLen, 0.05, 0.55),
        color: '#8a6444',
        position: [p.x, deckY, p.z],
        rotation: [0, yaw, 0],
      });

      const postH = Math.max(0.02, RAIL_Y - deckY);
      [-0.28, 0.28].forEach((side) => {
        parts.push({
          geometry: new CylinderGeometry(0.02, 0.02, postH, 5),
          color: '#6b4c33',
          position: [p.x + px * side, deckY + postH / 2, p.z + pz * side],
        });
        postXZ.push({ i, side, x: p.x + px * side, z: p.z + pz * side });
      });
    });

    // Rail: short segments connecting each pair of consecutive posts on the
    // same side, at the level RAIL_Y, each oriented along ITS OWN tangent
    // (so the rail follows the curve too, not one straight bar across it).
    [-0.28, 0.28].forEach((side) => {
      for (let i = 0; i < BRIDGE_SEGMENTS - 1; i++) {
        const a = postXZ.find((p) => p.i === i && p.side === side);
        const b = postXZ.find((p) => p.i === i + 1 && p.side === side);
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        const yaw = Math.atan2(-dz, dx);
        parts.push({
          geometry: new BoxGeometry(len * 1.05, 0.035, 0.035),
          color: '#8a6444',
          position: [(a.x + b.x) / 2, RAIL_Y, (a.z + b.z) / 2],
          rotation: [0, yaw, 0],
        });
      }
    });
    return parts;
  }, []);

  // Water (the one shiny surface) + everything matte merged separately.
  const matteGeometry = useMemo(() => mergeColoredParts([
    // Irregular shore rim, nested just outside the water's own blob profile
    // (same seeded wobble, slightly larger) -- a real pond, not a lathed disc.
    { geometry: makeBlobDiscGeometry(1.62, pondProfile), color: '#8fc0d8', position: [0, 0.005, 0], rotation: [-Math.PI / 2, 0, 0] },
    { geometry: new CylinderGeometry(0.09, 0.09, 0.01, 10), color: '#4f7d45', position: [-0.5, 0.03, 0.6] }, // lily pad
    // Stump.
    { geometry: new CylinderGeometry(0.14, 0.16, 0.22, 8), color: '#6b4c33', position: [-1.15, 0.11, -0.6] },
    ...reedParts,
    ...bridgeParts,
  ]), [reedParts, bridgeParts]);

  const grandpaGeometry = useMemo(() => mergeColoredParts([
    { geometry: new CapsuleGeometry(0.17, 0.24, 3, 8), color: '#8a7862', position: [0, 0.42, 0] }, // kaftan body
    { geometry: new SphereGeometry(0.05, 6, 6), color: '#4a4038', position: [0.08, 0.06, 0.12] },  // boots
    { geometry: new SphereGeometry(0.05, 6, 6), color: '#4a4038', position: [-0.08, 0.06, 0.12] },
  ]), []);

  const headGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.13, 10, 8), color: '#e8c8a8', position: [0, 0, 0] },
    { geometry: new ConeGeometry(0.09, 0.16, 6), color: '#d8d8d2', position: [0, -0.1, 0.09], rotation: [0.5, 0, 0] }, // beard
    { geometry: new CylinderGeometry(0.09, 0.11, 0.06, 8), color: '#8a6444', position: [0, 0.11, 0] }, // cap
    { geometry: new SphereGeometry(0.05, 6, 6), color: '#8a6444', position: [0, 0.15, 0] },
  ]), []);

  const rodGeometry = useMemo(() => mergeColoredParts([
    { geometry: new CylinderGeometry(0.008, 0.012, 0.7, 5), color: '#6b4c33', position: [0, 0.35, 0] },
    // Line: thin cylinder from tip angled down toward the float area.
    { geometry: new CylinderGeometry(0.003, 0.003, 0.55, 3), color: '#e8e4da', position: [0, 0.44, 0.26], rotation: [rad(65), 0, 0] },
  ]), []);

  const fishGeometry = useMemo(() => mergeColoredParts([
    { geometry: new CapsuleGeometry(0.05, 0.1, 2, 6), color: '#b8c4cc', rotation: [0, 0, Math.PI / 2] },
    { geometry: new ConeGeometry(0.04, 0.07, 4), color: '#b8c4cc', position: [0.11, 0, 0], rotation: [0, 0, -Math.PI / 2] },
  ]), []);

  // Grandpa (VISUAL_QUALITY_SPEC §1 hero pass) -- water/matte pond scenery
  // and the color-swapped fish/boot stay MeshStandardMaterial per spec
  // ("leave... water... as-is") and to avoid complicating the fish's live
  // color/emissive swap (fish/boot/gold) with the toon pipeline.
  const grandpaMaterials = useMemo(() => ({
    body: makeToonMaterial({ vertexColors: true, color: '#8a7862', rimStrength: 0.35 }),
    head: makeToonMaterial({ vertexColors: true, color: '#e8c8a8', rimStrength: 0.35 }),
    rod: makeToonMaterial({ vertexColors: true, color: '#6b4c33', rimStrength: 0.35 }),
  }), []);

  const state = useRef({
    nextRecastIn: 8,
    recastT: -1,
    ripples: new Array(RIPPLE_COUNT).fill(0).map(() => ({ t: 2 })),
    rippleWas: 0,
  });

  // POLISH_SPEC §5 pond glint + ambient fish splash (no Grandpa involvement
  // -- an independent event from his own recast/catch cycle above).
  const glintState = useRef({ phase: Math.random() * Math.PI * 2 });
  const splashState = useRef({
    nextIn: 25 + Math.random() * 35,
    t: -1,
    x: 0,
    z: 0,
    ripples: new Array(RIPPLE_COUNT).fill(0).map(() => ({ t: 2 })),
    droplets: new Array(4).fill(0).map(() => ({ t: 2, vx: 0, vz: 0 })),
  });
  const dropletGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(4 * 3), 3));
    return geo;
  }, []);

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    const t = Date.now();

    // Idle recast every ~30s (skipped while an egg catch is running).
    if (!eggManager.running) {
      if (s.recastT < 0) {
        s.nextRecastIn -= dt;
        if (s.nextRecastIn <= 0) { s.recastT = 0; s.nextRecastIn = RECAST_INTERVAL * (0.85 + Math.random() * 0.3); }
      } else {
        s.recastT += dt / 0.9;
        if (s.recastT >= 1) { s.recastT = -1; s.rippleWas -= 1; /* force a ripple below */ }
      }
    }
    const recastSweep = s.recastT >= 0 ? Math.sin(s.recastT * Math.PI) * rad(35) : 0;

    if (rodRef.current) rodRef.current.rotation.x = rad(-40) + recastSweep + eggMotion.rodPitch;
    if (headRef.current) headRef.current.rotation.z = eggMotion.headShake;

    // Float: gentle bob, lifted by the yank.
    if (floatRef.current) {
      const bob = Math.sin(t / 1000 * Math.PI * 2 * 0.4) * 0.02;
      floatRef.current.position.y = 0.03 + bob + eggMotion.floatYank * 0.5;
    }

    // Fish/boot: hidden until fishT >= 0. 0..1 = arc from water to hands
    // (with two flips); 1..2 = release arc back to the water.
    if (fishRef.current) {
      const ft = eggMotion.fishT;
      fishRef.current.visible = ft >= 0;
      if (ft >= 0) {
        const phase = Math.min(ft, 1);
        const back = Math.max(0, ft - 1);
        const x = 0.35 - (phase - back) * 0.9;
        const y = 0.15 + Math.sin((phase - back) * Math.PI) * 0.7;
        fishRef.current.position.set(x, Math.max(0.1, y), 0.45);
        fishRef.current.rotation.z = eggMotion.fishKind === 'boot' ? ft * 2 : Math.sin(phase * Math.PI * 2) * Math.PI;
        const isBoot = eggMotion.fishKind === 'boot';
        fishRef.current.scale.set(isBoot ? 0.9 : 1, isBoot ? 1.4 : 1, isBoot ? 0.9 : 1);
        if (fishMatRef.current) {
          fishMatRef.current.color.set(isBoot ? '#4a4038' : '#b8c4cc');
          fishMatRef.current.emissive.set(eggMotion.fishKind === 'gold' ? '#ffd27a' : '#000000');
          fishMatRef.current.emissiveIntensity = eggMotion.fishKind === 'gold' ? 0.6 + Math.sin(t / 150) * 0.3 : 0;
        }
      }
    }

    // Ripples: spawn a 3-ring set whenever rippleBurst bumps (or recast).
    if (eggMotion.rippleBurst !== s.rippleWas) {
      s.rippleWas = eggMotion.rippleBurst;
      s.ripples.forEach((r, i) => { r.t = -i * 0.25; });
    }
    if (ripplesRef.current) {
      const mesh = ripplesRef.current;
      let anyAlive = false;
      s.ripples.forEach((r, i) => {
        r.t += dt;
        const alive = r.t >= 0 && r.t < 1;
        if (alive) anyAlive = true;
        const sc = alive ? 0.1 + r.t * 0.5 : 0.0001;
        dummy.position.set(0.35, 0.03, 0.45); // float's water spot
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = anyAlive;
    }

    // --- Pond glint (POLISH_SPEC §5): roughness breathes 0.22-0.3 on a 7s
    // sine, a tiny highlight quad slides slowly across the surface ---
    if (waterMatRef.current) {
      waterMatRef.current.roughness = 0.26 + Math.sin(t / 1000 / 7 * Math.PI * 2) * 0.04;
    }
    if (glintRef.current) {
      const gs = glintState.current;
      gs.phase += dt * 0.15;
      glintRef.current.position.set(Math.sin(gs.phase) * 0.6, 0.03, Math.cos(gs.phase * 0.7) * 0.5);
    }

    // --- Ambient fish splash (POLISH_SPEC §5): every 25-60s, independent
    // of Grandpa's own recast/catch cycle above ---
    const sp = splashState.current;
    if (sp.t < 0) {
      sp.nextIn -= dt;
      if (sp.nextIn <= 0) {
        sp.t = 0;
        sp.nextIn = 25 + Math.random() * 35;
        const a = Math.random() * Math.PI * 2;
        const r = 0.5 + Math.random() * 0.7;
        sp.x = Math.sin(a) * r;
        sp.z = Math.cos(a) * r;
        sp.ripples.forEach((r2, i) => { r2.t = -i * 0.25; });
        sp.droplets.forEach((d) => {
          const da = Math.random() * Math.PI * 2;
          d.t = 0; d.vx = Math.cos(da) * 0.3; d.vz = Math.sin(da) * 0.3;
        });
      }
    } else {
      sp.t += dt;
      if (sp.t > 1.2) sp.t = -1;
    }
    if (splashRipplesRef.current) {
      const mesh = splashRipplesRef.current;
      let anyRippleAlive = false;
      sp.ripples.forEach((r2, i) => {
        r2.t += dt;
        const alive = r2.t >= 0 && r2.t < 1;
        if (alive) anyRippleAlive = true;
        const sc = alive ? 0.06 + r2.t * 0.35 : 0.0001;
        dummy.position.set(sp.x, 0.03, sp.z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = anyRippleAlive;
    }
    if (dropletsRef.current) {
      const positions = dropletGeometry.attributes.position;
      const active = sp.t >= 0 && sp.t < 0.5;
      sp.droplets.forEach((d, i) => {
        if (!active) { positions.setXYZ(i, 0, -10, 0); return; }
        const dt2 = sp.t;
        positions.setXYZ(i, sp.x + d.vx * dt2, 0.05 + Math.sin(dt2 * Math.PI) * 0.25, sp.z + d.vz * dt2);
      });
      positions.needsUpdate = true;
      dropletGeometry.computeBoundingSphere();
      dropletsRef.current.visible = active;
    }
  });

  const onTapGrandpa = (e) => {
    e.stopPropagation();
    eggManager.tap('grandpa');
  };

  const waterGeometry = useMemo(() => makeBlobDiscGeometry(1.5, pondProfile), []);

  return (
    <group position={POND_POS} rotation={[0, POND_ANGLE + Math.PI, 0]}>
      {/* Water: the one shiny surface in the scene, irregular per
          pondProfile (a perfect circle read as a stamped-out shape, not a
          pond). y=0.025, clearly above the matte rim's top face
          (0.005-ish) -- they used to be exactly coplanar over their full
          overlap, which z-fought (flickered) every frame since the
          renderer had no consistent winner for which coincident triangle
          was "on top". */}
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} geometry={waterGeometry}>
        <meshStandardMaterial ref={waterMatRef} color="#6fa8c8" roughness={0.25} side={DoubleSide} />
      </mesh>

      {/* POLISH_SPEC §5 pond glint: a tiny additive highlight sliding
          slowly across the water (roughness itself breathes in the
          material above, via waterMatRef in the frame loop). */}
      <mesh ref={glintRef} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.1, 0.04]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.35} blending={AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* Small sandy beach along one stretch of shore, between the water's
          edge and the grass -- an open arc away from Grandpa's stump and
          the reed clusters. */}
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.35, 1.85, 16, 1, rad(70), rad(50)]} />
        <meshStandardMaterial color="#d9c17a" roughness={1} side={DoubleSide} />
      </mesh>
      <mesh geometry={matteGeometry}>
        <meshStandardMaterial vertexColors roughness={0.9} side={DoubleSide} />
      </mesh>

      {/* Willow, roughly opposite Grandpa's stump so it clears him/the
          reeds/the beach arc -- BACKLOG.md #6. Live feedback: moved further
          out from the water's edge, into the open ground between the
          pond's rim and the island's own outer edge (was right at the
          rim, local radius ~2.04; now ~3.0, same angular direction). */}
      <mesh geometry={willowGeometry} position={[2.8, 0, 1.1]} rotation={[0, rad(15), 0]}>
        <meshStandardMaterial vertexColors roughness={0.85} side={DoubleSide} />
      </mesh>

      {/* Grandpa on his stump, facing the water */}
      <group position={[-1.15, 0.22, -0.6]} rotation={[0, rad(35), 0]} onClick={onTapGrandpa}>
        <mesh geometry={grandpaGeometry} material={grandpaMaterials.body} />
        <group ref={headRef} position={[0, 0.72, 0]}>
          <mesh geometry={headGeometry} material={grandpaMaterials.head} />
        </group>
        <group ref={rodRef} position={[0.14, 0.45, 0.12]} rotation={[rad(-40), 0, 0]}>
          <mesh geometry={rodGeometry} material={grandpaMaterials.rod} />
        </group>
        {/* Generous hitbox */}
        <mesh position={[0, 0.4, 0]} visible={false}>
          <sphereGeometry args={[0.8, 6, 6]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      </group>

      {/* Float on the water in front of him */}
      <mesh ref={floatRef} position={[0.35, 0.03, 0.45]}>
        <sphereGeometry args={[0.03, 8, 6]} />
        <meshStandardMaterial color="#c0452e" roughness={0.6} />
      </mesh>

      {/* Fish / golden fish / boot (kind-swapped via color/scale) */}
      <mesh ref={fishRef} geometry={fishGeometry} visible={false}>
        <meshStandardMaterial ref={fishMatRef} color="#b8c4cc" roughness={0.5} />
      </mesh>

      {/* Expanding ripple rings */}
      <instancedMesh ref={ripplesRef} args={[undefined, undefined, RIPPLE_COUNT]} visible={false}>
        <ringGeometry args={[0.8, 1, 20]} />
        <meshBasicMaterial color="#cfe4f0" transparent opacity={0.4} depthWrite={false} />
      </instancedMesh>

      {/* Ambient fish splash (POLISH_SPEC §5): its own ripple set + 4
          droplet points, independent of Grandpa's fishing above. */}
      <instancedMesh ref={splashRipplesRef} args={[undefined, undefined, RIPPLE_COUNT]} visible={false}>
        <ringGeometry args={[0.6, 0.75, 16]} />
        <meshBasicMaterial color="#cfe4f0" transparent opacity={0.35} depthWrite={false} />
      </instancedMesh>
      <points ref={dropletsRef} geometry={dropletGeometry} visible={false}>
        <pointsMaterial color="#cfe4f0" size={0.03} transparent opacity={0.6} depthWrite={false} />
      </points>
    </group>
  );
}
