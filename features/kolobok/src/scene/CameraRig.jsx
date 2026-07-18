import { useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  ORBIT_RADIUS, CAMERA_HEIGHT, nearestZone, rad, angleDelta,
} from '../config/zones';
import { orbit, useSceneStore } from '../state/sceneStore';

const FRICTION = 0.94;        // per-frame velocity decay
const SNAP_SPEED = 3.2;       // how eagerly we ease toward a zone
const SNAP_THRESHOLD = 0.012; // below this |velocity|, soft snap kicks in

export function CameraRig() {
  const lastActive = useRef('izba');
  const setActiveZone = useSceneStore((s) => s.setActiveZone);

  useFrame(({ camera }, delta) => {
    // Guard against a non-finite delta (possible on an early frame before
    // R3F's clock has a previous timestamp to diff against) -- unguarded,
    // it multiplies into orbit.angle below and corrupts it permanently
    // (NaN + anything stays NaN forever, since orbit.angle is an
    // accumulator).
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;

    // 1. Explicit snap request (nav button pressed)
    if (orbit.snapTarget !== null) {
      const d = angleDelta(orbit.angle, orbit.snapTarget);
      orbit.angle += d * Math.min(1, SNAP_SPEED * dt * 1.6);
      orbit.velocity = 0;
      if (Math.abs(d) < 0.005) orbit.snapTarget = null;
    } else {
      // 2. Gesture inertia
      orbit.angle += orbit.velocity;
      orbit.velocity *= FRICTION;

      // 3. Soft snap: once nearly still, settle onto the nearest zone
      if (Math.abs(orbit.velocity) < SNAP_THRESHOLD) {
        const zone = nearestZone(orbit.angle);
        const d = angleDelta(orbit.angle, rad(zone.angleDeg));
        orbit.angle += d * Math.min(1, SNAP_SPEED * dt);
      }
    }

    // 4. Place camera on its orbit, always looking at the island center
    camera.position.set(
      Math.sin(orbit.angle) * ORBIT_RADIUS,
      CAMERA_HEIGHT,
      Math.cos(orbit.angle) * ORBIT_RADIUS,
    );
    camera.lookAt(0, 1.2, 0);

    // 5. Publish active zone as a discrete event (only when it changes)
    const zone = nearestZone(orbit.angle);
    if (zone.id !== lastActive.current) {
      lastActive.current = zone.id;
      setActiveZone(zone.id);
    }
  });

  return null;
}
