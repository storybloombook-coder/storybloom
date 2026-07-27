import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { Object3D } from 'three';
import { makeToonMaterial } from './materials/toonMaterial';
import { makeRng } from './prng';

const rad = (deg) => (deg * Math.PI) / 180;

const BIRD_COUNT = 7;

// The crossroads boulder's three plaque blocks are static in HEIGHT but the
// column that carries them continuously re-yaws to face wherever the camera
// currently is (CrossroadsStone.jsx) -- so over a full orbit a block sweeps
// every azimuth at its own height (0.455-0.945 / 1.105-1.595 / 1.805-2.295
// around PLAQUE_HEIGHTS). A perch anywhere in those bands would eventually
// get swept by a passing plaque regardless of which side it's on. This sits
// in the one gap between the middle and top block, already including the
// boulder's own BASE_LIFT (-0.2) so it lines up with the rock as rendered.
const PERCH_Y = 1.5;
const PERCH_RADIUS = 0.78; // the boulder's own surface radius there, inset slightly

const BODY_R = 0.075;
const WING_LEN = 0.09;
const WING_THICK = 0.007;
const WING_DEPTH = 0.045;
const HIT_R = BODY_R * 2.4; // generous invisible tap target (mobile)

// Live feedback: 7 birds perched on the rock, fly away (not in a straight
// line) when tapped, then come back. Flight is 3 phases: a quick outward
// startle scatter (random direction each time), then a steep climb away
// from wherever the camera currently is, a hidden wait, then a swoop back
// down to the bird's own perch. Every moving phase adds a perpendicular
// sine wobble on top of the straight lerp so the path reads as a curved
// swoop rather than a straight line.
const SCATTER_DUR = 0.55;
const SCATTER_DIST = 1.6;
const SCATTER_RISE = 0.55;
const CLIMB_DUR = 1.2;
const CLIMB_DIST = 3.5;
const CLIMB_RISE = 5.5;
const RETURN_DUR = 1.6;
const AWAY_MIN_S = 4;
const AWAY_MAX_S = 9;
const LAND_SETTLE_MS = 180;

const WING_FLAP_HZ = 9;
const WING_FLAP_AMP = rad(50);

const dummy = new Object3D();

function makeBird(az) {
  const x = Math.sin(az) * PERCH_RADIUS;
  const z = Math.cos(az) * PERCH_RADIUS;
  return {
    mode: 'perched', // perched | scatter | climb | away | return | landing
    t: 0,
    perch: { x, y: PERCH_Y, z, az },
    pos: { x, y: PERCH_Y, z },
    from: { x, y: PERCH_Y, z },
    to: { x, y: PERCH_Y, z },
    yaw: az,
    wobbleAmp: 0,
    wobbleCycles: 1,
    wobbleSign: 1,
    awayDirX: 0,
    awayDirZ: 1,
    awayTimer: 0,
    landT: LAND_SETTLE_MS,
    landScale: 1,
    wingAngle: 0,
    visScale: 1,
    wingPhase: Math.random() * Math.PI * 2,
  };
}

/** BACKLOG live feedback: 7 simple birds perched on the crossroads boulder.
 *  Tap one and it startles away, climbs off into the sky away from the
 *  camera, waits off-screen a while, then swoops back to its own perch.
 *  The whole flock renders through 3 shared instancedMesh draw calls (body,
 *  wings, invisible hit target) -- each bird's independent flight state
 *  just writes a different matrix into its own instance slot every frame,
 *  the same technique KolobokParticles.jsx uses for its ray burst. */
export function Birds() {
  const bodyRef = useRef();
  const wingRef = useRef(); // 2 instances per bird: left then right
  const hitRef = useRef();
  const cameraRef = useRef();

  const material = useMemo(() => makeToonMaterial({ color: '#7a5738', rimStrength: 0.15 }), []);

  const perchAzimuths = useMemo(() => {
    const rng = makeRng(707);
    return new Array(BIRD_COUNT).fill(0).map((_, i) => (
      (i / BIRD_COUNT) * Math.PI * 2 + (rng() - 0.5) * rad(18)
    ));
  }, []);

  const state = useRef(null);
  if (!state.current) {
    state.current = { birds: perchAzimuths.map((az) => makeBird(az)) };
  }

  const launch = (i) => {
    const b = state.current.birds[i];
    if (b.mode !== 'perched' || !cameraRef.current) return;
    b.mode = 'scatter';
    b.t = 0;
    b.from = { ...b.pos };
    const escapeAz = Math.random() * Math.PI * 2;
    b.to = {
      x: b.perch.x + Math.sin(escapeAz) * SCATTER_DIST,
      y: b.perch.y + SCATTER_RISE,
      z: b.perch.z + Math.cos(escapeAz) * SCATTER_DIST,
    };
    b.wobbleAmp = 0.25 + Math.random() * 0.35;
    b.wobbleCycles = 1 + Math.random() * 1.3;
    b.wobbleSign = Math.random() < 0.5 ? 1 : -1;
    // Frozen once per flight (not recomputed every frame) so the climb's
    // own target doesn't chase a moving camera mid-flight.
    const cam = cameraRef.current;
    let awayDirX = b.to.x - cam.position.x;
    let awayDirZ = b.to.z - cam.position.z;
    const len = Math.hypot(awayDirX, awayDirZ) || 1;
    awayDirX /= len;
    awayDirZ /= len;
    b.awayDirX = awayDirX;
    b.awayDirZ = awayDirZ;
  };

  useFrame(({ camera }, delta) => {
    cameraRef.current = camera;
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const { birds } = state.current;

    birds.forEach((b) => {
      if (b.mode === 'perched') {
        b.pos = { ...b.perch };
        b.yaw = b.perch.az;
      } else if (b.mode === 'scatter' || b.mode === 'climb' || b.mode === 'return') {
        const dur = b.mode === 'scatter' ? SCATTER_DUR : b.mode === 'climb' ? CLIMB_DUR : RETURN_DUR;
        b.t += dt / dur;
        const raw = Math.min(1, b.t);
        const eased = 1 - (1 - raw) * (1 - raw); // easeOutQuad
        const px = b.from.x + (b.to.x - b.from.x) * eased;
        const py = b.from.y + (b.to.y - b.from.y) * eased;
        const pz = b.from.z + (b.to.z - b.from.z) * eased;
        // Perpendicular wobble in the horizontal plane, tapered to 0 at
        // both ends -- curves the path left-right without fighting the
        // phase's own climb/descent.
        const dirX = b.to.x - b.from.x;
        const dirZ = b.to.z - b.from.z;
        const dirLen = Math.hypot(dirX, dirZ) || 1;
        const perpX = -dirZ / dirLen;
        const perpZ = dirX / dirLen;
        const wobble = Math.sin(raw * Math.PI * b.wobbleCycles)
          * b.wobbleAmp * b.wobbleSign * Math.sin(raw * Math.PI);
        const prevX = b.pos.x;
        const prevZ = b.pos.z;
        const x = px + perpX * wobble;
        const z = pz + perpZ * wobble;
        b.pos = { x, y: py, z };
        const dx = x - prevX;
        const dz = z - prevZ;
        if (Math.hypot(dx, dz) > 0.001) b.yaw = Math.atan2(dx, dz);

        if (raw >= 1) {
          if (b.mode === 'scatter') {
            b.mode = 'climb';
            b.t = 0;
            b.from = { ...b.pos };
            b.to = {
              x: b.pos.x + b.awayDirX * CLIMB_DIST,
              y: b.pos.y + CLIMB_RISE,
              z: b.pos.z + b.awayDirZ * CLIMB_DIST,
            };
          } else if (b.mode === 'climb') {
            b.mode = 'away';
            b.awayTimer = AWAY_MIN_S + Math.random() * (AWAY_MAX_S - AWAY_MIN_S);
          } else if (b.mode === 'return') {
            b.mode = 'landing';
            b.landT = 0;
            b.pos = { ...b.perch };
            b.yaw = b.perch.az;
          }
        }
      } else if (b.mode === 'away') {
        b.awayTimer -= dt;
        if (b.awayTimer <= 0) {
          b.mode = 'return';
          b.t = 0;
          b.from = { ...b.pos };
          b.to = { ...b.perch };
          b.wobbleAmp = 0.25 + Math.random() * 0.35;
          b.wobbleCycles = 1 + Math.random() * 1.3;
          b.wobbleSign = Math.random() < 0.5 ? 1 : -1;
        }
      } else if (b.mode === 'landing') {
        b.landT += dt * 1000;
        if (b.landT >= LAND_SETTLE_MS) b.mode = 'perched';
      }

      // Landing settle: a small squash-then-recover bounce on touchdown.
      b.landScale = b.mode === 'landing'
        ? 1 - 0.2 * Math.sin(Math.min(1, b.landT / LAND_SETTLE_MS) * Math.PI)
        : 1;
      // Wing flap: fast while airborne, folded still while perched/away.
      const flying = b.mode === 'scatter' || b.mode === 'climb' || b.mode === 'return';
      b.wingAngle = flying
        ? Math.sin((Date.now() / 1000) * WING_FLAP_HZ * Math.PI * 2 + b.wingPhase) * WING_FLAP_AMP
        : 0;
      // Hidden while waiting off-screen -- instancedMesh has no per-instance
      // visibility, so scale to near-zero instead.
      b.visScale = b.mode === 'away' ? 0.001 : 1;
    });

    if (bodyRef.current && wingRef.current && hitRef.current) {
      birds.forEach((b, i) => {
        const s = b.visScale * b.landScale;
        dummy.position.set(b.pos.x, b.pos.y, b.pos.z);
        dummy.rotation.set(0, b.yaw, 0);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        bodyRef.current.setMatrixAt(i, dummy.matrix);
        hitRef.current.setMatrixAt(i, dummy.matrix);

        [1, -1].forEach((side, wi) => {
          dummy.position.set(
            b.pos.x + Math.sin(b.yaw + (Math.PI / 2) * side) * BODY_R * 0.7,
            b.pos.y,
            b.pos.z + Math.cos(b.yaw + (Math.PI / 2) * side) * BODY_R * 0.7,
          );
          dummy.rotation.set(0, b.yaw, side * b.wingAngle);
          dummy.scale.set(s, s, s);
          dummy.updateMatrix();
          wingRef.current.setMatrixAt(i * 2 + wi, dummy.matrix);
        });
      });
      bodyRef.current.instanceMatrix.needsUpdate = true;
      wingRef.current.instanceMatrix.needsUpdate = true;
      hitRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  const onTap = (e) => {
    e.stopPropagation();
    if (e.instanceId === undefined) return;
    launch(e.instanceId);
  };

  return (
    <group>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, BIRD_COUNT]} material={material}>
        <sphereGeometry args={[BODY_R, 8, 6]} />
      </instancedMesh>
      <instancedMesh ref={wingRef} args={[undefined, undefined, BIRD_COUNT * 2]} material={material}>
        <boxGeometry args={[WING_LEN, WING_THICK, WING_DEPTH]} />
      </instancedMesh>
      {/* Generous invisible hitbox, matching each bird's own transform every
          frame, so mobile taps land easily on a ~7.5cm bird. */}
      <instancedMesh ref={hitRef} args={[undefined, undefined, BIRD_COUNT]} onClick={onTap}>
        <sphereGeometry args={[HIT_R, 6, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}
