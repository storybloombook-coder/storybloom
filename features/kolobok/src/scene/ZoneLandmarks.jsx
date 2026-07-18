import { useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { ZONES, ZONE_RADIUS, rad } from '../config/zones';
import { useSceneStore } from '../state/sceneStore';

// One greybox landmark. Izba gets a house silhouette, animals get a
// body + head totem sized per character. All of this is placeholder
// geometry to be swapped for GLB models in the art pass.
function Landmark({ zone }) {
  const group = useRef();
  const isActive = useSceneStore((s) => s.activeZone === zone.id);
  const startEncounter = useSceneStore((s) => s.startEncounter);

  const a = rad(zone.angleDeg);
  const pos = [Math.sin(a) * ZONE_RADIUS, 0, Math.cos(a) * ZONE_RADIUS];

  useFrame(() => {
    if (!group.current) return;
    // Gentle breathing pulse on the zone the camera faces
    const t = Date.now() / 500;
    const s = isActive ? 1 + Math.sin(t) * 0.04 : 1;
    group.current.scale.set(s, s, s);
  });

  const onTap = (e) => {
    e.stopPropagation();
    startEncounter(zone);
  };

  const scale = zone.id === 'bear' ? 1.35 : zone.id === 'hare' ? 0.75 : 1;

  return (
    <group ref={group} position={pos} rotation={[0, a + Math.PI, 0]} onClick={onTap}>
      {zone.id === 'izba' ? (
        <>
          <mesh position={[0, 0.85, 0]}>
            <boxGeometry args={[1.7, 1.1, 1.3]} />
            <meshStandardMaterial color={zone.color} roughness={0.9} />
          </mesh>
          <mesh position={[0, 1.75, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[1.35, 0.9, 4]} />
            <meshStandardMaterial color="#a5602f" roughness={0.9} />
          </mesh>
        </>
      ) : (
        <>
          <mesh position={[0, 0.6 * scale, 0]}>
            <cylinderGeometry args={[0.35 * scale, 0.45 * scale, 1.0 * scale, 12]} />
            <meshStandardMaterial color={zone.color} roughness={0.85} />
          </mesh>
          <mesh position={[0, 1.3 * scale, 0]}>
            <sphereGeometry args={[0.32 * scale, 16, 16]} />
            <meshStandardMaterial color={zone.color} roughness={0.85} />
          </mesh>
        </>
      )}
      {/* Generous invisible hitbox so taps land easily on mobile */}
      <mesh position={[0, 1, 0]} visible={false}>
        <sphereGeometry args={[1.7, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

export function ZoneLandmarks() {
  return (
    <>
      {ZONES.map((z) => (
        <Landmark key={z.id} zone={z} />
      ))}
    </>
  );
}
