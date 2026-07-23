import { useMemo } from 'react';
import { makeRadialAlphaTexture } from './textures/proceduralTextures';
import { polish } from '../config/devFlags';

// One 64x64 radial-alpha texture shared by every blob shadow in the scene
// (tinted per-instance via the material's `color`, so this is the only
// texture object ever created for the whole feature).
let sharedTexture;
export function getSharedTexture() {
  if (!sharedTexture) sharedTexture = makeRadialAlphaTexture(64);
  return sharedTexture;
}

/** POLISH_SPEC §1 static blob shadow: a flat radial-falloff plane, dark
 *  center fading to nothing at the rim. Static shadows (everything except
 *  Kolobok, whose blob animates with his hop/roll -- see Kolobok.jsx) just
 *  render one of these as a child of whatever group already tracks their
 *  owner's position. */
// Live feedback: shadows should read 15% deeper/darker -- 0.28 * 1.15.
export function BlobShadow({
  radiusX = 0.5, radiusZ = 0.5, opacity = 0.322, y = 0.02,
}) {
  const texture = useMemo(() => getSharedTexture(), []);
  if (!polish.shadows) return null;
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[radiusX * 2, radiusZ * 2, 1]} renderOrder={1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} color="#1e1a14" transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}
