import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import { BufferAttribute, BufferGeometry, Color, Object3D } from 'three';
import { angleDelta } from '../config/zones';
import { orbit, useSceneStore } from '../state/sceneStore';
import { MENU } from '../config/menu';
import { t } from '../config/strings';
import { createTimeline } from './timeline';
import { makeRng } from './prng';
import { makeNoiseGrain } from './textures/proceduralTextures';
import { makeLabelTexture } from './textures/bitmapFont';

const dummy = new Object3D();
const FACE_LERP_RATE = 2.5; // rad/s the stone yaws to catch up with the camera azimuth

const PLAQUE_HEIGHTS = [1.45, 1.05, 0.65];
const PLAQUE_Z = 0.5;
const PLAQUE_SIZE = [0.72, 0.26, 0.045];
const PLAQUE_HITBOX_SCALE = 1.6;

const PRESS_DEPTH = 0.02;
const PRESS_MS = 80;
const NAV_AT_MS = 250;
const EMISSIVE_IDLE = 0.35;
const EMISSIVE_PEAK = 1.2;

const DUST_COUNT = 4;
const DUST_COLOR = new Color('#c8c4bc');

/** One plaque: a self-contained mesh+material (own emissiveMap, so it can't
 *  be instanced with its siblings -- see Sky/Vegetation for where instancing
 *  *does* apply). Owns its own tap-beat timeline (ANIMATION_SPEC-style:
 *  press-in, emissive pulse, haptic, navigate) rather than sharing one
 *  timeline across all three, so tapping one never disturbs the others. */
function Plaque({ item, index, tilt, onDust }) {
  const meshRef = useRef();
  const materialRef = useRef();
  const locale = useSceneStore((s) => s.locale);
  const requestNavigation = useSceneStore((s) => s.requestNavigation);

  const label = t(item.labelKey, locale);
  const texture = useMemo(() => makeLabelTexture(label), [label]);

  const state = useRef({ timeline: null, press: 0, emissive: EMISSIVE_IDLE });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    if (s.timeline) s.timeline.tick(dt);
    if (meshRef.current) meshRef.current.position.z = PLAQUE_Z - s.press;
    if (materialRef.current) materialRef.current.emissiveIntensity = s.emissive;
  });

  const onTap = (e) => {
    e.stopPropagation();
    const s = state.current;
    if (s.timeline && !s.timeline.done) return; // already mid-beat
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDust(PLAQUE_HEIGHTS[index]);
    s.timeline = createTimeline([
      { at: 0, dur: PRESS_MS, ease: 'easeOutCubic', update: (v) => { s.press = v * PRESS_DEPTH; } },
      {
        at: PRESS_MS,
        dur: PRESS_MS * 1.5,
        update: (v) => { s.press = PRESS_DEPTH * (1 - v); },
      },
      { at: 0, dur: NAV_AT_MS, update: (v) => { s.emissive = EMISSIVE_IDLE + (EMISSIVE_PEAK - EMISSIVE_IDLE) * Math.sin(v * Math.PI); } },
      { at: NAV_AT_MS, call: () => { requestNavigation(item.route); } },
    ]);
  };

  return (
    <group position={[0, PLAQUE_HEIGHTS[index], 0]} rotation={[0, 0, tilt]}>
      <mesh ref={meshRef} position={[0, 0, PLAQUE_Z]} onClick={onTap}>
        <boxGeometry args={PLAQUE_SIZE} />
        <meshStandardMaterial
          ref={materialRef}
          color="#7a7a72"
          roughness={0.85}
          emissive="#ffd27a"
          emissiveMap={texture}
          emissiveIntensity={EMISSIVE_IDLE}
        />
      </mesh>
      {/* Generous invisible hitbox, ~1.6x the plaque, so mobile taps land easily */}
      <mesh position={[0, 0, PLAQUE_Z]} visible={false} onClick={onTap}>
        <boxGeometry args={[PLAQUE_SIZE[0] * PLAQUE_HITBOX_SCALE, PLAQUE_SIZE[1] * PLAQUE_HITBOX_SCALE, 0.3]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

/** The crossroads stone (ART_SPEC §12): the app's real 3D menu, sunk into
 *  the island center so the camera's permanent lookAt keeps it on screen at
 *  every rotation. Boulder + moss are instanced/shared; each plaque needs
 *  its own draw call because each carries a different baked label texture. */
export function CrossroadsStone() {
  const groupRef = useRef();
  const dustRef = useRef();
  const dustState = useRef({ timeline: null, y: 1 });

  const noiseTexture = useMemo(() => makeNoiseGrain('#8d8d85', 0.1), []);

  const tilts = useMemo(() => {
    const rng = makeRng(100);
    return MENU.map(() => (rng() * 2 - 1) * ((4 * Math.PI) / 180));
  }, []);

  const mossMatrices = useMemo(() => {
    const rng = makeRng(101);
    const spots = [
      { angleDeg: 20, y: 0.1 }, { angleDeg: 150, y: 0.05 }, { angleDeg: 260, y: 0.15 }, // base ring
      { angleDeg: 0, y: 2.05 }, // crown
    ];
    return spots.map((spot) => {
      const a = (spot.angleDeg * Math.PI) / 180;
      const r = spot.y > 1.5 ? 0.1 : 0.5;
      dummy.position.set(Math.sin(a) * r, spot.y, Math.cos(a) * r);
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, 0);
      dummy.scale.set(1, 0.6, 1);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });
  }, []);

  const dustGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(DUST_COUNT * 3), 3));
    return geo;
  }, []);

  const spawnDust = (height) => {
    const rng = makeRng(Date.now() % 1000);
    const positions = dustGeometry.attributes.position;
    for (let i = 0; i < DUST_COUNT; i++) {
      positions.setXYZ(
        i,
        (rng() - 0.5) * 0.5,
        height + (rng() - 0.5) * 0.15,
        PLAQUE_Z + 0.05,
      );
    }
    positions.needsUpdate = true;
    dustState.current.timeline = createTimeline([
      { at: 0, dur: 350, ease: 'easeOutCubic', update: (v) => { dustState.current.y = 1 - v; } },
    ]);
  };

  useFrame(({ camera }, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;

    if (groupRef.current) {
      const d = angleDelta(groupRef.current.rotation.y, orbit.angle);
      groupRef.current.rotation.y += d * Math.min(1, FACE_LERP_RATE * dt);
    }

    const ds = dustState.current;
    if (ds.timeline) ds.timeline.tick(dt);
    if (dustRef.current) {
      dustRef.current.visible = !!ds.timeline && !ds.timeline.done;
      dustRef.current.material.opacity = Math.max(0, ds.y);
    }
  });

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      <mesh position={[0, 0.975, 0]} scale={[1, 1.5, 0.65]}>
        <sphereGeometry args={[0.75, 8, 6]} />
        <meshStandardMaterial map={noiseTexture} color="#8d8d85" roughness={1} />
      </mesh>

      <instancedMesh
        args={[undefined, undefined, mossMatrices.length]}
        ref={(mesh) => {
          if (!mesh) return;
          mossMatrices.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
        }}
      >
        <sphereGeometry args={[0.18, 8, 6]} />
        <meshStandardMaterial color="#6f9b52" roughness={0.9} />
      </instancedMesh>

      {MENU.map((item, i) => (
        <Plaque key={item.id} item={item} index={i} tilt={tilts[i]} onDust={spawnDust} />
      ))}

      <points ref={dustRef} geometry={dustGeometry} visible={false}>
        <pointsMaterial color={DUST_COLOR} size={0.05} transparent opacity={0} depthWrite={false} />
      </points>
    </group>
  );
}
