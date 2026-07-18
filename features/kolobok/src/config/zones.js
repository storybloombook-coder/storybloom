// Single source of truth for the circular layout.
// Everything — camera, Kolobok, landmarks, nav buttons — derives from these.

export const ORBIT_RADIUS = 13;      // camera distance from island center
export const CAMERA_HEIGHT = 6.5;    // camera height above ground
export const ZONE_RADIUS = 6.2;      // landmarks sit on this ring
export const PATH_RADIUS = 4.6;      // Kolobok rolls on this ring
export const ISLAND_RADIUS = 8;
export const KOLOBOK_RADIUS = 0.6;

export const ZONES = [
  { id: 'izba', label: "Grandma's izba", route: 'Home',         angleDeg: 0,   color: '#d9a441' },
  { id: 'hare', label: 'Hare meadow',    route: 'SectionOne',   angleDeg: 72,  color: '#8fbf6a' },
  { id: 'wolf', label: 'Wolf forest',    route: 'SectionTwo',   angleDeg: 144, color: '#6f8fa8' },
  { id: 'bear', label: 'Bear thicket',   route: 'SectionThree', angleDeg: 216, color: '#8a6f52' },
  { id: 'fox',  label: 'Fox clearing',   route: 'SectionFour',  angleDeg: 288, color: '#d97742' },
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
