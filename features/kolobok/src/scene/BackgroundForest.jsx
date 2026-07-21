import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  DataTexture, DoubleSide, LinearFilter, Object3D, RGBAFormat, UnsignedByteType,
} from 'three';
import { makeRng } from './prng';
import { atmosphereLive } from '../state/sceneStore';

const dummy = new Object3D();
const rad = (deg) => (deg * Math.PI) / 180;

// Live feedback: the background still read as empty with sparse 3D cones.
// Classic trick from older 3D games -- a procedurally-generated tree
// silhouette (alpha cutout, zero binary assets per CLAUDE.md) on TWO
// perpendicular planes per tree ("cross-billboard": whichever plane is more
// edge-on to the camera still shows a full silhouette from the other one).
// Flat planes are far cheaper per tree than the old cone geometry, so the
// same triangle budget buys MUCH higher density.
function makeTreeSpriteTexture(w = 24, h = 40) {
  const rng = makeRng(95);
  const rowJitter = new Array(h).fill(0).map(() => (rng() * 2 - 1) * 0.12);
  const data = new Uint8Array(w * h * 4);
  const canopy = [0x3a, 0x52, 0x38];
  const trunk = [0x4a, 0x38, 0x28];
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1); // 0 = bottom, 1 = top
    for (let x = 0; x < w; x++) {
      const u = (x / (w - 1)) * 2 - 1; // -1..1
      const o = (y * w + x) * 4;
      let inside;
      let rgb;
      if (v < 0.15) {
        inside = Math.abs(u) < 0.06;
        rgb = trunk;
      } else {
        const cv = (v - 0.15) / 0.85;
        const width = Math.max(0, (1 - cv) * 0.8 + rowJitter[y]);
        inside = Math.abs(u) < width;
        rgb = canopy;
      }
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = inside ? 255 : 0;
    }
  }
  const texture = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// POLISH_SPEC §2 aerial perspective: three treeline layers, each blended
// `mix(base, currentHorizonColor, k)` -- distance reads as desaturation
// toward the sky's own color, not more detail. Each ring gets its OWN
// instancedMesh (not merged) since each needs a distinct, live-updated
// material color; three static per-instance colors couldn't track the
// horizon as it lerps through the day. Different radii per ring also means
// they naturally parallax against each other as the camera orbits. Counts
// roughly 3x the old cone version -- flat sprites afford it.
// Live feedback: as close as possible without the camera clipping through
// flat sprites. Checked every zone/story-chapter framing radius in
// zones.js/storyChapters.js -- the highest is 13.4 (Bear zone), so 14
// is the tightest margin that still keeps every camera position clear.
const RINGS = [
  {
    count: 60, radiusMin: 14, radiusMax: 16, base: '#3a5238', k: 0.25,
  },
  {
    count: 45, radiusMin: 17, radiusMax: 19, base: '#54705e', k: 0.5,
  },
  {
    count: 35, radiusMin: 20, radiusMax: 24, base: '#6d8578', k: 0.72,
  },
];
const HILLS_BASE = '#46603f';
const HILLS_K = 0.6;

const HILLS = [
  { angleDeg: 30, radius: 26, r: 7 },
  { angleDeg: 160, radius: 26, r: 9 },
  { angleDeg: 260, radius: 26, r: 6 },
];

// Live feedback: the island's edge (radius 8) to the treeline (radius 17+)
// was open void -- nothing filled it, so the trees/hills read as separate
// floating islands instead of one distant landscape. Three concentric
// ground bands close that gap, each fading further toward the live horizon
// color (same technique as the tree rings), positioned just under the
// island's own ground so it tucks under the edge with no visible seam.
const GROUND_BANDS = [
  {
    rIn: 8, rOut: 14, base: '#5f7a4a', k: 0.15,
  },
  {
    rIn: 14, rOut: 20, base: '#57705a', k: 0.42,
  },
  {
    rIn: 20, rOut: 34, base: '#5f7568', k: 0.78,
  },
];
const GROUND_Y = -0.08;

function hexToUnit(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const lerp = (a, b, t) => a + (b - a) * t;

/** Distant treeline + hill backdrop (ART_SPEC §13) so the island reads as
 *  floating in a world, not a void. Static positions (world scenery like
 *  the sky dome, doesn't rotate/track anything) but each ring/hill's
 *  MATERIAL color re-blends toward the live horizon color every frame
 *  (POLISH_SPEC §2), unlit + `fog` so the existing scene fog still adds
 *  its own depth fade on top. */
export function BackgroundForest() {
  const ringMatRefs = useRef([]);
  const hillsMatRef = useRef();
  const groundMatRefs = useRef([]);
  const ringBaseUnit = useMemo(() => RINGS.map((r) => hexToUnit(r.base)), []);
  const hillsBaseUnit = useMemo(() => hexToUnit(HILLS_BASE), []);
  const groundBaseUnit = useMemo(() => GROUND_BANDS.map((b) => hexToUnit(b.base)), []);
  const spriteTexture = useMemo(() => makeTreeSpriteTexture(), []);

  // Two plane instances per tree (a 90deg cross), sharing one geometry and
  // one instancedMesh per ring -- so `ring.count` trees cost 2*count
  // instances but still just ONE draw call.
  const ringMatrices = useMemo(() => RINGS.map((ring, ringIdx) => {
    // Widely-separated seeds (offsets 7 apart previously) so each ring's
    // FIRST few draws don't start correlated -- mulberry32 mixes well after
    // several calls, but nearby seeds can echo each other's early output,
    // which read as trees lining up radially across rings ("order"). A
    // handful of burned draws adds more separation on top of that.
    const rng = makeRng(400 + ringIdx * 617);
    for (let burn = 0; burn < 5; burn += 1) rng();
    const out = [];
    for (let i = 0; i < ring.count; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = ring.radiusMin + rng() * (ring.radiusMax - ring.radiusMin);
      const scaleXY = 1.6 + rng() * 1.6;
      const scaleY = scaleXY * (1.1 + rng() * 0.3);
      const baseYaw = rng() * Math.PI * 2;
      // The cross's own angle varied per tree (was always exactly 90deg) --
      // a fixed cross means every tree's two cards align identically, which
      // from a fixed camera angle reads as rows of identically-facing trees.
      const crossAngle = rad(70) + rng() * rad(40);
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      // Plane geometry is 1.8 tall (half-height 0.9), centered at its own
      // origin by default -- anchor the BOTTOM edge at ground level (y=0,
      // matching the main scene) by lifting the center up by that half-
      // height (scaled), with a small sink so trunks aren't all perfectly
      // flush. Previously this used a fixed y range with no relation to
      // the per-instance Y scale, so taller trees floated their base well
      // above ground while short ones sank into it.
      const halfHeight = 0.9 * scaleY;
      const y = halfHeight - rng() * 0.15;
      [0, crossAngle].forEach((extraYaw) => {
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, baseYaw + extraYaw, 0);
        dummy.scale.set(scaleXY, scaleY, 1);
        dummy.updateMatrix();
        out.push(dummy.matrix.clone());
      });
    }
    return out;
  }), []);

  const hillMatrices = useMemo(() => HILLS.map((h) => {
    const a = (h.angleDeg * Math.PI) / 180;
    // The hill is a sphere flattened to (h.r, h.r*0.22, h.r), so its
    // half-height above its own center is h.r*0.22. Sink the center to
    // -h.r*0.12 so most of the mound sits below y=0 (a mound, not a
    // floating ball) while its crown still crests to +h.r*0.1.
    dummy.position.set(Math.sin(a) * h.radius, -h.r * 0.12, Math.cos(a) * h.radius);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(h.r, h.r * 0.22, h.r);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  }), []);

  useFrame(() => {
    const hor = atmosphereLive.horizon;
    ringBaseUnit.forEach((base, i) => {
      const mat = ringMatRefs.current[i];
      if (!mat) return;
      mat.color.setRGB(
        lerp(base[0], hor[0], RINGS[i].k),
        lerp(base[1], hor[1], RINGS[i].k),
        lerp(base[2], hor[2], RINGS[i].k),
      );
    });
    if (hillsMatRef.current) {
      hillsMatRef.current.color.setRGB(
        lerp(hillsBaseUnit[0], hor[0], HILLS_K),
        lerp(hillsBaseUnit[1], hor[1], HILLS_K),
        lerp(hillsBaseUnit[2], hor[2], HILLS_K),
      );
    }
    groundBaseUnit.forEach((base, i) => {
      const mat = groundMatRefs.current[i];
      if (!mat) return;
      mat.color.setRGB(
        lerp(base[0], hor[0], GROUND_BANDS[i].k),
        lerp(base[1], hor[1], GROUND_BANDS[i].k),
        lerp(base[2], hor[2], GROUND_BANDS[i].k),
      );
    });
  });

  return (
    <group>
      {GROUND_BANDS.map((band, i) => (
        <mesh
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          position={[0, GROUND_Y, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[band.rIn, band.rOut, 48]} />
          <meshBasicMaterial ref={(m) => { groundMatRefs.current[i] = m; }} fog />
        </mesh>
      ))}
      {RINGS.map((ring, i) => (
        <instancedMesh
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          args={[undefined, undefined, ring.count * 2]}
          ref={(mesh) => {
            if (!mesh) return;
            ringMatrices[i].forEach((m, j) => mesh.setMatrixAt(j, m));
            mesh.instanceMatrix.needsUpdate = true;
          }}
        >
          <planeGeometry args={[1.1, 1.8]} />
          <meshBasicMaterial
            ref={(m) => { ringMatRefs.current[i] = m; }}
            map={spriteTexture}
            transparent
            alphaTest={0.4}
            side={DoubleSide}
            fog
          />
        </instancedMesh>
      ))}
      <instancedMesh
        args={[undefined, undefined, HILLS.length]}
        ref={(mesh) => {
          if (!mesh) return;
          hillMatrices.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
        }}
      >
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial ref={hillsMatRef} fog />
      </instancedMesh>
    </group>
  );
}
