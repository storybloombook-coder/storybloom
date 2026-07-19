import { useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  ZONES, nearestZone, rad, angleDelta,
} from '../config/zones';
import { orbit, useSceneStore } from '../state/sceneStore';
import { createTimeline } from './timeline';

const FRICTION = 0.94;        // per-frame velocity decay
const SNAP_SPEED = 3.2;       // how eagerly we ease toward a zone
const SNAP_THRESHOLD = 0.012; // below this |velocity|, soft snap kicks in
const FRAMING_EASE_MS = 800;  // ART_SPEC §10: per-zone camera framing transition

const IZBA_FRAMING = ZONES.find((z) => z.id === 'izba').framing;

export function CameraRig() {
  const lastActive = useRef('izba');
  const setActiveZone = useSceneStore((s) => s.setActiveZone);

  // Live camera framing (radius/height/lookAtY), eased toward whichever
  // zone is active (ART_SPEC §10: 800ms easeInOutSine per transition).
  // Pre-seeded at izba's framing so mounting doesn't pop in from zero.
  const framing = useRef({
    radius: IZBA_FRAMING.radius,
    height: IZBA_FRAMING.height,
    lookAtY: IZBA_FRAMING.lookAtY,
    from: { ...IZBA_FRAMING },
    to: { ...IZBA_FRAMING },
    timeline: null,
  });

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

    // 4. Publish active zone + (re)start a framing transition when it
    // changes, BEFORE using framing.current below to place the camera.
    const zone = nearestZone(orbit.angle);
    const f = framing.current;
    if (zone.id !== lastActive.current) {
      lastActive.current = zone.id;
      setActiveZone(zone.id);
      f.from = { radius: f.radius, height: f.height, lookAtY: f.lookAtY };
      f.to = zone.framing;
      f.timeline = createTimeline([
        {
          at: 0,
          dur: FRAMING_EASE_MS,
          ease: 'easeInOutSine',
          update: (t) => {
            f.radius = f.from.radius + (f.to.radius - f.from.radius) * t;
            f.height = f.from.height + (f.to.height - f.from.height) * t;
            f.lookAtY = f.from.lookAtY + (f.to.lookAtY - f.from.lookAtY) * t;
          },
        },
      ]);
    }
    if (f.timeline) f.timeline.tick(dt);

    // 5. Place camera on its orbit, always looking at the island center
    camera.position.set(
      Math.sin(orbit.angle) * f.radius,
      f.height,
      Math.cos(orbit.angle) * f.radius,
    );
    camera.lookAt(0, f.lookAtY, 0);
  });

  return null;
}
