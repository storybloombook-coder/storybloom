import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  BufferAttribute, BufferGeometry, DataTexture, NearestFilter, Object3D, RGBAFormat, UnsignedByteType,
} from 'three';
import { atmosphereLive, orbit } from '../state/sceneStore';
import { makeRng } from './prng';
import { SPRUCE_TOP_MATRICES } from './Vegetation';
import { currentPhase } from '../config/atmosphere';
import { makeRadialAlphaTexture } from './textures/proceduralTextures';
import { wind } from './wind';
import { ISLAND_RADIUS, ZONES, POND_ANGLE_DEG } from '../config/zones';
import { POTHOLE_SPOTS, POTHOLE_PUDDLE_Y } from './Island';

const dummy = new Object3D();

// Live feedback: rain wasn't heavy enough. Was 220.
const RAIN_COUNT = 380;
const SNOW_COUNT = 160;
const FIREFLY_COUNT = 30;
const WISP_COUNT = 8;
const MIST_COUNT = 6;
const MIST_MOVE_INTERVAL_S = 40;
const MIST_MOVE_EASE_S = 6;
const RAIN_ENDED_MIST_MS = 10 * 60 * 1000;

// BACKLOG.md #3 puddles: a handful of fixed spots (seeded once, not
// per-frame), kept clear of zone landmarks and the pond. A single shared
// "wetness" value (fills fast while raining, drains slowly after) drives
// every puddle's opacity together -- simpler than per-puddle timers and
// looks natural enough at only 6 instances.
const PUDDLE_COUNT = 6;
const PUDDLE_FILL_RATE = 4;   // per second, while raining
const PUDDLE_DRAIN_RATE = 0.3; // per second, once rain stops
function angularDistDeg(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}
const PUDDLE_SPOTS = (() => {
  const rng = makeRng(260);
  const out = [];
  let guard = 0;
  while (out.length < PUDDLE_COUNT && guard < 300) {
    guard += 1;
    const angleDeg = rng() * 360;
    const radius = 1.4 + rng() * 3.2; // inside the path ring (PATH_RADIUS 4.6)
    const tooCloseToZone = ZONES.some((z) => angularDistDeg(angleDeg, z.angleDeg) < 30);
    const tooCloseToPond = angularDistDeg(angleDeg, POND_ANGLE_DEG) < 35;
    if (tooCloseToZone || tooCloseToPond) continue;
    const angleRad = (angleDeg * Math.PI) / 180;
    out.push({
      x: Math.sin(angleRad) * radius, z: Math.cos(angleRad) * radius, scale: 0.35 + rng() * 0.35,
    });
  }
  return out;
})();

// 2x8 vertical streak sprite for rain (WEATHER_SPEC §3) -- white core
// fading at the ends; tinted/faded by the material.
function makeStreakTexture() {
  const w = 2;
  const h = 8;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const a = Math.round(255 * Math.sin(((y + 0.5) / h) * Math.PI));
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data[o] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = a;
    }
  }
  const tex = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Rain, snow, island-wide fog wisps, night fireflies, and snow caps
 *  (WEATHER_SPEC §2-§4, ART_SPEC §9 fireflies). All driven by the ramp
 *  values AtmosphereDirector writes into atmosphereLive; particle updates
 *  halve under sleep mode (skip on odd frames). */
export function WeatherSystems() {
  const rainRef = useRef();
  const snowRef = useRef();
  const firefliesRef = useRef();
  const wispsRef = useRef();
  const wispsMatRef = useRef();
  const capsRef = useRef();
  const izbaCapsRef = useRef();
  const mistRef = useRef();
  const mistMatRef = useRef();
  const puddleMatRef = useRef();
  const wetness = useRef(0);

  const streakTexture = useMemo(() => makeStreakTexture(), []);
  const mistTexture = useMemo(() => makeRadialAlphaTexture(32), []);
  const puddleMatrices = useMemo(() => PUDDLE_SPOTS.map((p) => {
    dummy.position.set(p.x, 0.015, p.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(p.scale, p.scale, 1);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  }), []);
  // BACKLOG.md #16: potholes (Island.jsx) fill the same way regular
  // puddles do -- reusing the identical shared `wetness` ramp below rather
  // than a second timer, since it's the same "fills fast in rain, drains
  // slowly after" behavior, just sized/positioned to each crater exactly
  // (POTHOLE_PUDDLE_Y sits a hair above the crater's carved floor).
  const potholePuddleMatRef = useRef();
  const potholePuddleMatrices = useMemo(() => POTHOLE_SPOTS.map((p) => {
    dummy.position.set(p.x, POTHOLE_PUDDLE_Y, p.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(p.r * 0.85, p.r * 0.85, 1);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  }), []);

  // POLISH_SPEC §2 ground mist: 6 flattened planes drifting around the
  // island rim, each with its own current/target angle so they "slowly
  // cross-fade position" (ease toward a freshly-rolled target every ~40s)
  // rather than snapping. rainEndedAt tracks the last moment rainT/stormT
  // dropped below the "actively raining" threshold, for the 10-minute
  // afterglow bump in the opacity table below.
  const mistState = useRef((() => {
    const rng = makeRng(240);
    return new Array(MIST_COUNT).fill(0).map(() => {
      const angle = rng() * Math.PI * 2;
      const radius = ISLAND_RADIUS * (0.85 + rng() * 0.2);
      return {
        angle, radius, targetAngle: angle, targetRadius: radius, height: 0.15 + rng() * 0.2, nextMoveIn: rng() * MIST_MOVE_INTERVAL_S,
      };
    });
  })());
  const rainWasActive = useRef(false);
  const rainEndedAt = useRef(0);

  const rainGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(RAIN_COUNT * 3), 3));
    return geo;
  }, []);
  const rainState = useRef((() => {
    const rng = makeRng(200);
    return new Array(RAIN_COUNT).fill(0).map(() => ({
      x: (rng() * 2 - 1) * 9, z: (rng() * 2 - 1) * 9, y: 7 + rng() * 2,
    }));
  })());

  const snowGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(SNOW_COUNT * 3), 3));
    return geo;
  }, []);
  const snowState = useRef((() => {
    const rng = makeRng(210);
    return new Array(SNOW_COUNT).fill(0).map(() => ({
      x: (rng() * 2 - 1) * 9, z: (rng() * 2 - 1) * 9, y: rng() * 9, phase: rng() * Math.PI * 2,
    }));
  })());

  const fireflyGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(FIREFLY_COUNT * 3), 3));
    return geo;
  }, []);
  const fireflyState = useRef((() => {
    const rng = makeRng(220);
    return new Array(FIREFLY_COUNT).fill(0).map(() => ({
      angle: rng() * Math.PI * 2, radius: 1 + rng() * 6, height: 0.4 + rng() * 0.8,
      drift: 0.05 + rng() * 0.15, pulse: rng() * Math.PI * 2,
    }));
  })());
  const firefliesMatRef = useRef();

  const wispState = useRef((() => {
    const rng = makeRng(230);
    return new Array(WISP_COUNT).fill(0).map(() => ({
      phase: rng() * Math.PI * 2, radius: 1.5 + rng() * 5.5, height: 0.1 + rng() * 0.25,
    }));
  })());

  // Izba roof slabs x2 + chimney + stone crown caps (WEATHER_SPEC §4).
  // Izba sits at world [0,0,6.2] rotated PI; local +z -> world -z.
  const izbaCapMatrices = useMemo(() => {
    const out = [];
    const mk = (pos, scale) => {
      dummy.position.set(...pos);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(...scale);
      dummy.updateMatrix();
      out.push(dummy.matrix.clone());
    };
    mk([0, 2.05, 6.2], [1.5, 0.35, 1.5]);   // roof crown blob
    mk([0.55, 2.0, 6.05], [0.35, 0.2, 0.35]); // chimney-ish top
    mk([0, 2.16, 0], [0.5, 0.25, 0.5]);     // crossroads stone crown
    return out;
  }, []);

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const L = atmosphereLive;
    const sleeping = orbit.powerState === 'sleep';
    if (sleeping && orbit.frameParity) return; // halve particle work asleep

    const now = Date.now();

    // --- Rain ---
    if (rainRef.current) {
      const active = Math.floor(RAIN_COUNT * Math.min(1, L.rainT) * (sleeping ? 0.5 : 1));
      const positions = rainGeometry.attributes.position;
      rainState.current.forEach((p, i) => {
        if (i >= active) { positions.setXYZ(i, 0, -20, 0); return; }
        p.y -= 9 * dt;
        p.x += 0.6 * dt;
        if (p.y < 0) { p.y = 7 + Math.random() * 2; p.x = (Math.random() * 2 - 1) * 9; p.z = (Math.random() * 2 - 1) * 9; }
        positions.setXYZ(i, p.x, p.y, p.z);
      });
      positions.needsUpdate = true;
      rainGeometry.computeBoundingSphere();
      rainRef.current.visible = active > 0;
    }

    // --- Snow ---
    if (snowRef.current) {
      const active = Math.floor(SNOW_COUNT * Math.min(1, L.snowT) * (sleeping ? 0.5 : 1));
      const positions = snowGeometry.attributes.position;
      snowState.current.forEach((p, i) => {
        if (i >= active) { positions.setXYZ(i, 0, -20, 0); return; }
        p.y -= 1.1 * dt;
        if (p.y < 0) { p.y = 8 + Math.random(); p.x = (Math.random() * 2 - 1) * 9; p.z = (Math.random() * 2 - 1) * 9; }
        positions.setXYZ(i, p.x + Math.sin(now / 1000 + p.phase) * 0.3, p.y, p.z);
      });
      positions.needsUpdate = true;
      snowGeometry.computeBoundingSphere();
      snowRef.current.visible = active > 0;
    }

    // --- Fireflies (night only: sun below -6 or clock-night fallback) ---
    if (firefliesRef.current) {
      const night = L.sunElevation !== null ? L.sunElevation < -6 : (new Date().getHours() >= 21 || new Date().getHours() < 5);
      const active = night ? Math.floor(FIREFLY_COUNT * (sleeping ? 0.5 : 1)) : 0;
      const positions = fireflyGeometry.attributes.position;
      fireflyState.current.forEach((p, i) => {
        if (i >= active) { positions.setXYZ(i, 0, -20, 0); return; }
        p.angle += p.drift * dt;
        positions.setXYZ(i, Math.sin(p.angle) * p.radius, p.height + Math.sin(now / 900 + p.pulse) * 0.15, Math.cos(p.angle) * p.radius);
      });
      positions.needsUpdate = true;
      fireflyGeometry.computeBoundingSphere();
      firefliesRef.current.visible = active > 0;
      if (firefliesMatRef.current) {
        firefliesMatRef.current.opacity = 0.5 + Math.sin(now / 700) * 0.3;
      }
    }

    // --- Island-wide fog wisps (fog state) ---
    if (wispsRef.current) {
      const mesh = wispsRef.current;
      const vis = L.fogWispT;
      wispState.current.forEach((p, i) => {
        p.phase += 0.05 * dt;
        dummy.position.set(Math.sin(p.phase) * p.radius, p.height, Math.cos(p.phase) * p.radius);
        dummy.rotation.set(0, p.phase, 0);
        dummy.scale.set(1.4 * vis, 0.25 * vis, 1 * vis);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = vis > 0.02;
      if (wispsMatRef.current) wispsMatRef.current.opacity = 0.12 * vis;
    }

    // --- Snow caps: scale in/out with the snow ramp (4s fade) ---
    const capScale = Math.min(1, L.snowT);
    if (capsRef.current) {
      const mesh = capsRef.current;
      SPRUCE_TOP_MATRICES.forEach((m, i) => {
        dummy.matrix.copy(m);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        dummy.scale.multiplyScalar(capScale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = capScale > 0.02;
    }
    if (izbaCapsRef.current) {
      const mesh = izbaCapsRef.current;
      izbaCapMatrices.forEach((m, i) => {
        dummy.matrix.copy(m);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        dummy.scale.multiplyScalar(capScale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = capScale > 0.02;
    }

    // --- Ground mist (POLISH_SPEC §2) ---
    const raining = L.rainT > 0.3;
    if (raining) rainWasActive.current = true;
    else if (rainWasActive.current) { rainWasActive.current = false; rainEndedAt.current = now; }

    let mistOpacity;
    if (now - rainEndedAt.current < RAIN_ENDED_MIST_MS) mistOpacity = 0.20;
    else {
      const phase = currentPhase();
      mistOpacity = phase === 'morning' ? 0.16 : phase === 'evening' ? 0.10 : phase === 'night' ? 0.08 : 0.04;
    }

    if (mistRef.current) {
      const mesh = mistRef.current;
      mistState.current.forEach((m, i) => {
        m.nextMoveIn -= dt;
        if (m.nextMoveIn <= 0) {
          const rng = Math.random;
          m.targetAngle = rng() * Math.PI * 2;
          m.targetRadius = ISLAND_RADIUS * (0.85 + rng() * 0.2);
          m.nextMoveIn = MIST_MOVE_INTERVAL_S * (0.8 + rng() * 0.4);
        }
        const ease = Math.min(1, dt / MIST_MOVE_EASE_S);
        m.angle += (m.targetAngle - m.angle) * ease;
        m.radius += (m.targetRadius - m.radius) * ease;
        // Wind drift (§3): a slow tangential rotation scaled by wind
        // strength, on top of the cross-fade above.
        m.angle += wind.strength * 0.15 * 0.02 * dt;
        dummy.position.set(Math.sin(m.angle) * m.radius, m.height, Math.cos(m.angle) * m.radius);
        dummy.rotation.set(-Math.PI / 2, 0, m.angle);
        dummy.scale.set(2.2, 0.9, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mistMatRef.current) mistMatRef.current.opacity = mistOpacity;
    }

    // --- Puddles (BACKLOG.md #3): fill fast while raining, drain slowly
    // after -- one shared wetness value, not per-puddle timers. ---
    const rainSignal = Math.min(1, L.rainT);
    const wetRate = rainSignal > wetness.current ? PUDDLE_FILL_RATE : PUDDLE_DRAIN_RATE;
    wetness.current += (rainSignal - wetness.current) * Math.min(1, wetRate * dt);
    if (puddleMatRef.current) puddleMatRef.current.opacity = wetness.current * 0.55;
    if (potholePuddleMatRef.current) potholePuddleMatRef.current.opacity = wetness.current * 0.55;
  });

  return (
    <group>
      <points ref={rainRef} geometry={rainGeometry} visible={false}>
        <pointsMaterial map={streakTexture} color="#aebfd0" size={0.07} transparent opacity={0.65} depthWrite={false} />
      </points>
      <points ref={snowRef} geometry={snowGeometry} visible={false}>
        <pointsMaterial color="#ffffff" size={0.08} transparent opacity={0.9} depthWrite={false} />
      </points>
      <points ref={firefliesRef} geometry={fireflyGeometry} visible={false}>
        <pointsMaterial ref={firefliesMatRef} color="#ffe28a" size={0.09} transparent opacity={0.7} depthWrite={false} />
      </points>
      <instancedMesh ref={wispsRef} args={[undefined, undefined, WISP_COUNT]} visible={false}>
        <sphereGeometry args={[0.6, 8, 6]} />
        <meshBasicMaterial ref={wispsMatRef} color="#cfd8de" transparent opacity={0} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={capsRef} args={[undefined, undefined, SPRUCE_TOP_MATRICES.length]} visible={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#f2f5f8" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={izbaCapsRef} args={[undefined, undefined, 3]} visible={false}>
        <sphereGeometry args={[0.5, 8, 6]} />
        <meshStandardMaterial color="#f2f5f8" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={mistRef} args={[undefined, undefined, MIST_COUNT]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={mistMatRef}
          map={mistTexture}
          color="#dfe6ea"
          transparent
          opacity={0.04}
          depthWrite={false}
        />
      </instancedMesh>
      {/* Puddles (BACKLOG.md #3): static positions/matrices, only opacity
          animates (see wetness above) -- low roughness reads as standing
          water without needing a real reflection. */}
      <instancedMesh
        args={[undefined, undefined, PUDDLE_COUNT]}
        ref={(mesh) => {
          if (!mesh) return;
          puddleMatrices.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
        }}
      >
        <circleGeometry args={[1, 20]} />
        <meshStandardMaterial
          ref={puddleMatRef}
          color="#6f8590"
          roughness={0.2}
          transparent
          opacity={0}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      </instancedMesh>

      {/* Pothole puddles (BACKLOG.md #16): same look/behavior as the puddles
          above, just sized/positioned to each Island.jsx crater exactly. */}
      <instancedMesh
        args={[undefined, undefined, potholePuddleMatrices.length]}
        ref={(mesh) => {
          if (!mesh) return;
          potholePuddleMatrices.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
        }}
      >
        <circleGeometry args={[1, 20]} />
        <meshStandardMaterial
          ref={potholePuddleMatRef}
          color="#6f8590"
          roughness={0.2}
          transparent
          opacity={0}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      </instancedMesh>
    </group>
  );
}
