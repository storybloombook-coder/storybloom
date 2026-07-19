// Single source of truth for the circular layout.
// Everything — camera, Kolobok, landmarks, nav buttons — derives from these.

export const ORBIT_RADIUS = 13;      // camera distance from island center
export const CAMERA_HEIGHT = 6.5;    // camera height above ground
export const ZONE_RADIUS = 6.2;      // landmarks sit on this ring
export const PATH_RADIUS = 4.6;      // Kolobok rolls on this ring
export const ISLAND_RADIUS = 8;
export const KOLOBOK_RADIUS = 0.6;

// Kolobok <-> camera follow geometry, shared by BOTH follow directions
// (free mode: Kolobok chases orbit.angle + LEAD; story mode: the camera
// chases kolobokAngle - LEAD -- STORY_SPEC §1 "same math, inverted leader").
export const KOLOBOK_LEAD = -0.45;      // radians ahead of the camera
export const KOLOBOK_FOLLOW_LAG = 2.4;  // chase catch-up rate (1/s)

// Per-zone camera framing (ART_SPEC §10) -- orbit radius / camera height /
// lookAt-y to ease toward when this zone becomes active, and the ground
// vertex-tint blended in within its 36° arc (ART_SPEC §6). Story chapter 0
// overrides izba's framing (radius 11, height 5.2, lookAt y 1.6) -- that's
// STORY_SPEC's concern, applied on top of this table, not stored here.
export const ZONES = [
  {
    id: 'izba', label: "Grandma's izba", route: 'Home', angleDeg: 0, color: '#d9a441',
    framing: { radius: 12.6, height: 6.0, lookAtY: 1.2 },
    groundTint: '#8fae62',
  },
  {
    id: 'hare', label: 'Hare meadow', route: 'SectionOne', angleDeg: 72, color: '#8fbf6a',
    framing: { radius: 12.8, height: 6.3, lookAtY: 1.1 },
    groundTint: '#94bc63',
  },
  {
    id: 'wolf', label: 'Wolf forest', route: 'SectionTwo', angleDeg: 144, color: '#6f8fa8',
    framing: { radius: 13.3, height: 6.8, lookAtY: 1.3 },
    groundTint: '#5f7f4e',
  },
  {
    id: 'bear', label: 'Bear thicket', route: 'SectionThree', angleDeg: 216, color: '#8a6f52',
    framing: { radius: 13.4, height: 7.0, lookAtY: 1.4 },
    groundTint: '#587348',
  },
  {
    id: 'fox', label: 'Fox clearing', route: 'SectionFour', angleDeg: 288, color: '#d97742',
    framing: { radius: 12.8, height: 6.2, lookAtY: 1.1 },
    groundTint: '#9aa85e',
  },
];

export const ENCOUNTER_LINES = {
  izba: 'Grandma: "Kolobok, where have you rolled off to again?"',
  hare: 'Hare: "Kolobok, Kolobok, I will eat you up!"',
  wolf: 'Wolf: "Kolobok, Kolobok, I will eat you up!"',
  bear: 'Bear: "Kolobok, Kolobok, I will eat you up!"',
  fox:  'Fox: "Come closer, dear, I can\'t quite hear your lovely song..."',
};

export const SONG =
  '"I ran away from Grandma, I ran away from Grandpa — and I\'ll run away from you!"';

export const rad = (deg) => (deg * Math.PI) / 180;

// Angle convention: 0 = +Z axis, increasing counter-clockwise (matches Math.sin/cos below).
export const pointOnCircle = (radius, angleRad) => [
  Math.sin(angleRad) * radius,
  0,
  Math.cos(angleRad) * radius,
];

// Normalize any angle to [0, 2PI)
export const normalize = (a) => {
  const TWO_PI = Math.PI * 2;
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
};

// Shortest signed distance from angle a to angle b (radians, in [-PI, PI])
export const angleDelta = (a, b) => {
  let d = normalize(b) - normalize(a);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export const nearestZone = (angleRad) => {
  let best = ZONES[0];
  let bestDist = Infinity;
  for (const z of ZONES) {
    const d = Math.abs(angleDelta(angleRad, rad(z.angleDeg)));
    if (d < bestDist) {
      bestDist = d;
      best = z;
    }
  }
  return best;
};
