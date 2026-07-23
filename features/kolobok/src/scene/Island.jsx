import { useMemo } from 'react';
import {
  BufferAttribute, BufferGeometry, Color, CylinderGeometry, Object3D,
} from 'three';
import {
  ISLAND_RADIUS, PATH_RADIUS, PATH_HALF_WIDTH, ZONES, rad, angleDelta, POND_ANGLE_DEG,
} from '../config/zones';
import { makeRng } from './prng';
import { makeSpeckle } from './textures/proceduralTextures';
import { jitterVertices } from './builders/vertexJitter';
import { SPRUCE_OCCUPIED } from './Vegetation';

const BASE_GRASS = [0x7a / 255, 0xa8 / 255, 0x5c / 255];

// The dirt path ring stops short on either side of Grandpa's pond -- the
// new wooden bridge (PondAndGrandpa.jsx, spanning local Z=1.0, i.e. world
// radius ~= POND radius(5.6) - 1.0 = PATH_RADIUS) picks up the crossing
// instead, so the path reads as going OVER the water, not through it.
// RingGeometry's own theta angle is offset -90deg from this project's
// zone-angle convention (`pointOnCircle`'s sin/cos), verified against a
// couple of known points (0deg -> world +Z, 90deg -> world +X) before
// picking this formula -- get the -90 backwards and the gap lands 90deg
// away from the pond instead of centered on it.
const BRIDGE_GAP_HALF_DEG = 20; // bridge itself spans ~34deg at PATH_RADIUS
const PATH_GAP_THETA_START = rad(POND_ANGLE_DEG - 90 + BRIDGE_GAP_HALF_DEG);
const PATH_GAP_THETA_LENGTH = rad(360 - BRIDGE_GAP_HALF_DEG * 2);

function hexToUnit(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// VISUAL_QUALITY_SPEC §5 ground blending: a handful of fixed random-phase
// sine pairs, summed, give smooth spatial "clumps" (soft blobs roughly
// 1.5-2.5 units across) without a real Perlin implementation. Computed once
// at module scope with its own PRNG stream so it's stable across reloads.
const CLUMP_WAVES = (() => {
  const rng = makeRng(61);
  return [0, 1, 2].map(() => ({
    freq: 1 / (1.5 + rng() * 1.0),
    phaseX: rng() * Math.PI * 2,
    phaseZ: rng() * Math.PI * 2,
  }));
})();
function clumpNoise01(x, z) {
  let sum = 0;
  for (const w of CLUMP_WAVES) sum += Math.sin(x * w.freq + w.phaseX) * Math.sin(z * w.freq + w.phaseZ);
  return 0.5 + 0.5 * (sum / CLUMP_WAVES.length);
}

// A filled disc built as concentric rings in the local XY plane -- same
// plane and outline CircleGeometry produced, but densely subdivided so the
// interior actually HAS vertices. CircleGeometry(r, N) is only a triangle
// fan: one center vertex + N rim vertices, nothing in between, so per-vertex
// terrain displacement (hills/potholes) and per-vertex dirt tinting had
// nothing in the interior to act on and silently did nothing. Ring/segment
// counts are chosen so vertex spacing stays well under the smallest pothole
// radius, giving every feature enough vertices to shape smoothly.
function makeRadialDisc(radius, rings, segments) {
  const geo = new BufferGeometry();
  const verts = [];
  verts.push(0, 0, 0); // center vertex
  for (let ring = 1; ring <= rings; ring += 1) {
    const rr = (ring / rings) * radius;
    for (let s = 0; s < segments; s += 1) {
      const a = (s / segments) * Math.PI * 2;
      verts.push(Math.cos(a) * rr, Math.sin(a) * rr, 0);
    }
  }
  const idx = [];
  // Innermost fan: center to first ring.
  for (let s = 0; s < segments; s += 1) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % segments);
    idx.push(0, a, b);
  }
  // Ring-to-ring quads (two triangles each).
  for (let ring = 1; ring < rings; ring += 1) {
    const base = 1 + (ring - 1) * segments;
    const next = 1 + ring * segments;
    for (let s = 0; s < segments; s += 1) {
      const s1 = (s + 1) % segments;
      const a = base + s;
      const b = base + s1;
      const c = next + s;
      const d = next + s1;
      idx.push(a, c, d, a, d, b);
    }
  }
  geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(idx);
  return geo;
}

function useGroundGeometry() {
  return useMemo(() => {
    const geo = makeRadialDisc(ISLAND_RADIUS, 56, 340);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const rng = makeRng(60);
    const tints = ZONES.map((z) => ({ angle: rad(z.angleDeg), rgb: hexToUnit(z.groundTint) }));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      // The disc is built flat in the local XY plane (see makeRadialDisc); the
      // mesh below rotates -90 around X to lay it on the ground. That rotation
      // sends local Y to world -Z (world Z = -local Y), not +Z -- get this
      // backwards and the whole tint pattern mirrors relative to where the
      // landmarks actually are (matches pointOnCircle's sin/cos convention
      // everywhere else in the scene once negated).
      const z = -pos.getY(i);
      const angle = Math.atan2(x, z);
      let [r, g, b] = BASE_GRASS;
      let closest = null;
      let secondClosest = null;
      for (const t of tints) {
        const angularDist = Math.abs(angleDelta(angle, t.angle));
        const withinArc = 1 - smoothstep(0, rad(36), angularDist);
        if (withinArc > 0) {
          r = r + (t.rgb[0] - r) * withinArc;
          g = g + (t.rgb[1] - g) * withinArc;
          b = b + (t.rgb[2] - b) * withinArc;
        }
        if (!closest || angularDist < closest.d) { secondClosest = closest; closest = { d: angularDist, rgb: t.rgb }; }
        else if (!secondClosest || angularDist < secondClosest.d) { secondClosest = { d: angularDist, rgb: t.rgb }; }
      }
      // Second, finer noise layer (ART_SPEC's own §6 tint stays the base
      // read): bleed 15% of the angularly-second-nearest zone's tone in
      // soft clumps so grass reads as textured turf, not a flat fill.
      if (secondClosest) {
        const clump = clumpNoise01(x, z) * 0.15;
        r = r + (secondClosest.rgb[0] - r) * clump;
        g = g + (secondClosest.rgb[1] - g) * clump;
        b = b + (secondClosest.rgb[2] - b) * clump;
      }
      // BACKLOG.md #16: darken toward exposed dirt inside a pothole's
      // radius -- live feedback: they need to read as darker than the
      // grass around them (not just a subtle geometric dip) to stand out.
      const potholeF = potholeFactorAt(x, z);
      if (potholeF > 0) {
        const soil = [0.24, 0.18, 0.13]; // dark exposed-earth tone
        r = r + (soil[0] - r) * potholeF;
        g = g + (soil[1] - g) * potholeF;
        b = b + (soil[2] - b) * potholeF;
      }
      const noise = (rng() * 2 - 1) * 0.05;
      colors[i * 3] = Math.min(1, Math.max(0, r + noise));
      colors[i * 3 + 1] = Math.min(1, Math.max(0, g + noise));
      colors[i * 3 + 2] = Math.min(1, Math.max(0, b + noise));
      pos.setZ(i, hillBumpAt(x, z) - potholeF * POTHOLE_DEPTH);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);
}

// BACKLOG.md #16: a handful of sparse terrain features -- gentle grass
// hills and shallow potholes, both scattered in OPEN grass only (never on
// the path/pond, clear of zone landmarks, clear of each other, and clear
// of spruce trees via the exported SPRUCE_OCCUPIED footprint -- live
// feedback: potholes must not land on the road or overlap other objects).
// Both are built flat in the ground disc's own local XY plane, which
// shares the identical `rotation={[-Math.PI/2,0,0]}` used everywhere else
// in this file and sends local Z to world Y (see useGroundGeometry's own
// `z = -pos.getY(i)` comment for the matching X/Z half of this same
// rotation) -- so displacing a vertex's local Z is exactly "raise/lower
// the ground here".
// Live feedback: 5 more of each (9 total apiece). The old band (5.45-7.0,
// 25deg/30deg zone/pond keep-clear) left only ~4 narrow ~22deg corridors
// between zone arcs -- just barely enough room for the original 4+4 (one
// per corridor). Fitting 9+9 without silently under-filling the random-
// rejection sampler (it fails quietly, not with an error) needs a bigger
// eligible area, not smaller features -- widened radial band + loosened
// keep-clear angles below, individual hill/pothole sizes unchanged.
const HILL_COUNT = 9;
const HILL_RADIUS = 1.1;
const HILL_HEIGHT = 0.16;
const POTHOLE_COUNT = 9;
const POTHOLE_RADIUS = 0.4;
const POTHOLE_DEPTH = 0.09;
// Open-grass band: outside the path ring by a clear margin, inside the
// outer treeline -- same band the hills use, so the two mutual keep-clear
// checks below are between comparable-sized features.
const OPEN_BAND_MIN_R = PATH_RADIUS + PATH_HALF_WIDTH + 0.4;
const OPEN_BAND_MAX_R = 7.4;

function tooCloseToLandmarks(angleRad) {
  const tooCloseToZone = ZONES.some((z) => Math.abs(angleDelta(angleRad, rad(z.angleDeg))) < rad(18));
  const tooCloseToPond = Math.abs(angleDelta(angleRad, rad(POND_ANGLE_DEG))) < rad(22);
  return tooCloseToZone || tooCloseToPond;
}

const HILL_SPOTS = (() => {
  const rng = makeRng(96);
  const out = [];
  let guard = 0;
  while (out.length < HILL_COUNT && guard < 6000) {
    guard += 1;
    const angleDeg = rng() * 360;
    const angleRad = rad(angleDeg);
    if (tooCloseToLandmarks(angleRad)) continue;
    const radius = OPEN_BAND_MIN_R + rng() * (OPEN_BAND_MAX_R - OPEN_BAND_MIN_R);
    const x = Math.sin(angleRad) * radius;
    const z = Math.cos(angleRad) * radius;
    const r = HILL_RADIUS * (0.85 + rng() * 0.3);
    if (SPRUCE_OCCUPIED.some((s) => Math.hypot(x - s.x, z - s.z) < r + s.r + 0.3)) continue;
    out.push({ x, z, r });
  }
  return out;
})();

// Exported so WeatherSystems.jsx can drop a matching puddle disc exactly in
// each crater's floor once it rains (same idea as Vegetation.jsx exporting
// SPRUCE_TOP_MATRICES for the snow-cap system).
export const POTHOLE_SPOTS = (() => {
  const rng = makeRng(97);
  const out = [];
  let guard = 0;
  while (out.length < POTHOLE_COUNT && guard < 8000) {
    guard += 1;
    const angleDeg = rng() * 360;
    const angleRad = rad(angleDeg);
    if (tooCloseToLandmarks(angleRad)) continue;
    const radius = OPEN_BAND_MIN_R + rng() * (OPEN_BAND_MAX_R - OPEN_BAND_MIN_R);
    const x = Math.sin(angleRad) * radius;
    const z = Math.cos(angleRad) * radius;
    const r = POTHOLE_RADIUS * (0.75 + rng() * 0.4);
    if (HILL_SPOTS.some((h) => Math.hypot(x - h.x, z - h.z) < r + h.r + 0.3)) continue;
    if (SPRUCE_OCCUPIED.some((s) => Math.hypot(x - s.x, z - s.z) < r + s.r + 0.3)) continue;
    out.push({ x, z, r });
  }
  return out;
})();
// Ground disc sits at world Y=0 (before its own hill/pothole displacement);
// at a crater's exact center the ground dips POTHOLE_DEPTH below that, so a
// puddle disc floats a hair above the crater floor (avoids z-fighting)
// rather than sitting at the flat, undipped ground height.
export const POTHOLE_PUDDLE_Y = -POTHOLE_DEPTH + 0.006;

function hillBumpAt(x, z) {
  let h = 0;
  for (const hill of HILL_SPOTS) {
    const d = Math.hypot(x - hill.x, z - hill.z);
    if (d < hill.r) h += Math.cos((d / hill.r) * (Math.PI / 2)) * HILL_HEIGHT;
  }
  return h;
}
// 0 outside every pothole, up to 1 at a crater's exact center -- shared by
// both the height dip AND the color darkening below, so the visual "hole"
// and the actual geometric dip always agree on where the crater is.
function potholeFactorAt(x, z) {
  let f = 0;
  for (const hole of POTHOLE_SPOTS) {
    const d = Math.hypot(x - hole.x, z - hole.z);
    if (d < hole.r) f = Math.max(f, Math.cos((d / hole.r) * (Math.PI / 2)));
  }
  return f;
}

function usePebbleMatrices() {
  return useMemo(() => {
    const rng = makeRng(70);
    const dummy = new Object3D();
    const matrices = [];
    for (let i = 0; i < 10; i++) {
      const angle = rng() * Math.PI * 2;
      const r = PATH_RADIUS + (rng() * 2 - 1) * 0.3;
      dummy.position.set(Math.sin(angle) * r, 0.02, Math.cos(angle) * r);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      const s = 0.7 + rng() * 0.6;
      dummy.scale.set(s, s * 0.6, s);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
    return matrices;
  }, []);
}

// BACKLOG.md #7: the dirt path ring stops PATH_GAP_HALF_DEG(20) short of the
// pond angle on each side, but the wooden bridge deck (PondAndGrandpa.jsx)
// only spans BRIDGE_ARC_HALF_DEG(17) -- a bare 3deg strip of plain ground
// between where each surface ends reads as a hard seam. Cover it, and the
// path's edges everywhere else too (live feedback, pointing at the path
// edges near the crossroads: "by edges I mean here and here"), with small
// rounded moss clumps (3 flattened spheres per clump, same clustered-
// spheres technique as Vegetation.jsx's foreground bushes, just smaller/
// flatter and mossier-colored) hugging just outside the path ring's inner
// and outer edges (PATH_RADIUS +/- 0.35), all the way around -- skipping
// the bridge-gap arc itself, which has no path edge to hug there.
const PATH_MOSS_CLUMPS = 26;
const MOSS_SPHERES_PER_CLUMP = 3;
function usePathEdgeMossMatrices() {
  return useMemo(() => {
    const rng = makeRng(90);
    const dummy = new Object3D();
    const matrices = [];
    let placed = 0;
    let guard = 0;
    while (placed < PATH_MOSS_CLUMPS && guard < 400) {
      guard += 1;
      const angleDeg = rng() * 360;
      const gapDist = Math.abs(angleDelta(rad(angleDeg), rad(POND_ANGLE_DEG)));
      if (gapDist < rad(BRIDGE_GAP_HALF_DEG + 3)) continue; // bridge gap: no path edge there
      const clumpAngle = rad(angleDeg);
      // Alternate which edge (inner/outer) each clump sits just outside of,
      // rather than scattering across the road itself.
      const edgeSide = rng() < 0.5 ? -1 : 1;
      const clumpR = PATH_RADIUS + edgeSide * (0.38 + rng() * 0.16);
      const cx = Math.sin(clumpAngle) * clumpR;
      const cz = Math.cos(clumpAngle) * clumpR;
      for (let i = 0; i < MOSS_SPHERES_PER_CLUMP; i++) {
        const jitterAngle = rng() * Math.PI * 2;
        const jitterR = rng() * 0.12;
        const sxz = 0.75 + rng() * 0.35;
        const sy = 0.42 + rng() * 0.16;
        dummy.position.set(cx + Math.cos(jitterAngle) * jitterR, sy * 0.16, cz + Math.sin(jitterAngle) * jitterR);
        dummy.rotation.set(0, rng() * Math.PI, 0);
        dummy.scale.set(sxz, sy, sxz);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
      }
      placed += 1;
    }
    return matrices;
  }, []);
}
function usePathEdgeMossColors(count) {
  return useMemo(() => {
    const rng = makeRng(91);
    const c1 = new Color('#4f6f38');
    const c2 = new Color('#6a8a48');
    return new Array(count).fill(0).map(() => c1.clone().lerp(c2, rng()));
  }, [count]);
}

// Live feedback (screenshot-annotated): the actual ask was the LINE where
// the bridge deck's edge meets the path's edge (the hard cut), not the
// path's edges in general -- a dedicated cluster spanning the path's FULL
// width right at each of the two seam angles (the midpoint between where
// the bridge deck ends and the path resumes, same as PondAndGrandpa.jsx's
// BRIDGE_ARC_HALF_DEG/BRIDGE_GAP_HALF_DEG straddle), layered on top of the
// edge-hugging ring above so the crossing itself reads as covered.
const BRIDGE_SEAM_CLUMPS_PER_SIDE = 3;
function useBridgeSeamMossMatrices() {
  return useMemo(() => {
    const rng = makeRng(190);
    const dummy = new Object3D();
    const matrices = [];
    [-1, 1].forEach((side) => {
      const center = POND_ANGLE_DEG + side * (BRIDGE_GAP_HALF_DEG - 1.5);
      for (let c = 0; c < BRIDGE_SEAM_CLUMPS_PER_SIDE; c++) {
        const clumpAngle = rad(center + (rng() * 2 - 1) * 2.5);
        const clumpR = PATH_RADIUS + (rng() * 2 - 1) * 0.42; // full path width, not just the edges
        const cx = Math.sin(clumpAngle) * clumpR;
        const cz = Math.cos(clumpAngle) * clumpR;
        for (let i = 0; i < MOSS_SPHERES_PER_CLUMP; i++) {
          const jitterAngle = rng() * Math.PI * 2;
          const jitterR = rng() * 0.12;
          const sxz = 0.75 + rng() * 0.35;
          const sy = 0.42 + rng() * 0.16;
          dummy.position.set(cx + Math.cos(jitterAngle) * jitterR, sy * 0.16, cz + Math.sin(jitterAngle) * jitterR);
          dummy.rotation.set(0, rng() * Math.PI, 0);
          dummy.scale.set(sxz, sy, sxz);
          dummy.updateMatrix();
          matrices.push(dummy.matrix.clone());
        }
      }
    });
    return matrices;
  }, []);
}

export function Island() {
  const groundGeo = useGroundGeometry();
  const pathTexture = useMemo(() => makeSpeckle('#c2a06b', '#a5825a', 128, 0.08), []);
  const pebbleMatrices = usePebbleMatrices();
  const pathEdgeMossMatrices = usePathEdgeMossMatrices();
  const bridgeSeamMossMatrices = useBridgeSeamMossMatrices();
  const pathMossMatrices = useMemo(
    () => [...pathEdgeMossMatrices, ...bridgeSeamMossMatrices],
    [pathEdgeMossMatrices, bridgeSeamMossMatrices],
  );
  const pathMossColors = usePathEdgeMossColors(pathMossMatrices.length);
  // VISUAL_QUALITY_SPEC §5: jitter the skirt so its rim doesn't read as a
  // perfect lathed cylinder edge.
  const skirtGeo = useMemo(
    () => jitterVertices(new CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS * 0.82, 0.6, 48, 1, true), ISLAND_RADIUS, 62),
    [],
  );

  return (
    <group>
      {/* Earth skirt (sides only -- the underside is never seen) */}
      <mesh position={[0, -0.3, 0]} geometry={skirtGeo}>
        <meshStandardMaterial color="#7a5c3e" roughness={1} />
      </mesh>

      {/* Vertex-tinted grass top */}
      <mesh geometry={groundGeo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <meshStandardMaterial vertexColors roughness={1} />
      </mesh>

      {/* Kolobok's dirt path ring, speckled, with scattered pebbles -- gapped
          where the bridge crosses Grandpa's pond (see PATH_GAP_ constants). */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PATH_RADIUS - PATH_HALF_WIDTH, PATH_RADIUS + PATH_HALF_WIDTH, 64, 1, PATH_GAP_THETA_START, PATH_GAP_THETA_LENGTH]} />
        <meshStandardMaterial map={pathTexture} roughness={1} />
      </mesh>
      <instancedMesh
        args={[undefined, undefined, pebbleMatrices.length]}
        ref={(mesh) => {
          if (!mesh) return;
          pebbleMatrices.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
        }}
      >
        <sphereGeometry args={[0.05, 6, 6]} />
        <meshStandardMaterial color="#9c9c94" roughness={0.9} />
      </instancedMesh>

      {/* Moss clumps hugging the path's edges, all the way around (BACKLOG.md #7) */}
      <instancedMesh
        args={[undefined, undefined, pathMossMatrices.length]}
        ref={(mesh) => {
          if (!mesh) return;
          pathMossMatrices.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
          pathMossColors.forEach((c, i) => mesh.setColorAt(i, c));
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }}
      >
        <sphereGeometry args={[0.16, 8, 6]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
    </group>
  );
}
