// Plain node test of shelfPhysics.ts's solver. Run with:
//   node src/lib/__tests__/shelfPhysics.test.js
// No test framework (matches features/kolobok/__tests__'s own convention).
//
// A hand-written rigid-body solver's failure modes are stability ones --
// bodies sinking through the floor, stacks jittering forever, energy
// growing until everything explodes -- and none of those are things you can
// reliably catch by looking at a phone for a few seconds. That's what this
// is for. It strips the TypeScript with a regex rather than pulling in a
// compiler, which is enough for a file that's deliberately plain functions.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '../shelfPhysics.ts');

function loadModule() {
  let code = fs.readFileSync(SRC, 'utf8');
  // Drop type-only constructs: `export type X = {...};` blocks, `type X =
  // {...};` blocks, then parameter/return annotations.
  code = code.replace(/export type [\s\S]*?\n};\n/g, '');
  code = code.replace(/\ntype [\s\S]*?\n};\n/g, '\n');
  // Longest annotations first: stripping `: number` before `: number[][]`
  // would leave stray brackets behind and produce a syntax error.
  code = code.replace(/: Contact \| null/g, '');
  code = code.replace(/: number\[\]\[\]/g, '');
  code = code.replace(/: number\[\]/g, '');
  code = code.replace(/: Contact\[\]/g, '');
  code = code.replace(/: Body\[\]/g, '');
  code = code.replace(/: Body\b/g, '');
  code = code.replace(/: World\b/g, '');
  code = code.replace(/: number\b/g, '');
  code = code.replace(/: boolean\b/g, '');
  code = code.replace(/: void\b/g, '');
  code = code.replace(/\bexport /g, 'exports.__mark = 1; ');
  // Re-export by name at the end instead of parsing `export` properly.
  code += `
module.exports = { makeBody, corners, horizontalExtent, lowestY, step, isAsleep, wake, makeKinematic, restoreDynamics, driveHeld, orderByPosition };
`;
  const m = new Module(SRC, null);
  m._compile(code, SRC);
  return m.exports;
}

const P = loadModule();

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`ok - ${name}`);
  else {
    console.log(`FAIL - ${name} ${detail}`);
    failures += 1;
  }
}

const G = 1400;
function makeWorld(bodies, gx = 0) {
  return { bodies, leftWall: 0, rightWall: 400, gx, gy: -G };
}

function run(world, seconds, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) P.step(world, dt);
}

// 1. A single book dropped onto the shelf comes to rest ON it, not through
//    it, and stops moving.
{
  const b = P.makeBody(100, 60, 14, 40);
  const w = makeWorld([b]);
  run(w, 3);
  check('dropped book rests on the shelf', Math.abs(P.lowestY(b)) < 1.5,
    `(lowest ${P.lowestY(b).toFixed(2)})`);
  check('dropped book stops moving', Math.hypot(b.vx, b.vy) < 1,
    `(speed ${Math.hypot(b.vx, b.vy).toFixed(2)})`);
  check('dropped book stays upright', Math.abs(b.angle) < 0.05,
    `(angle ${b.angle.toFixed(3)})`);
}

// 2. Nothing sinks. The classic solver failure is a body slowly tunnelling
//    through the floor over many frames under sustained gravity.
{
  const b = P.makeBody(100, 40, 14, 40);
  const w = makeWorld([b]);
  run(w, 20);
  check('no sinking over 20s', P.lowestY(b) > -PENETRATION_TOLERANCE(),
    `(lowest ${P.lowestY(b).toFixed(3)})`);
}
function PENETRATION_TOLERANCE() { return 1.5; }

// 3. Energy doesn't grow. An unstable solver injects energy every frame and
//    the shelf eventually detonates.
{
  const bodies = [];
  for (let i = 0; i < 6; i++) bodies.push(P.makeBody(60 + i * 30, 40, 14, 40));
  const w = makeWorld(bodies);
  run(w, 10);
  let maxSpeed = 0;
  for (const b of bodies) maxSpeed = Math.max(maxSpeed, Math.hypot(b.vx, b.vy), Math.abs(b.omega) * 40);
  check('a row of 6 does not gain energy', maxSpeed < 5, `(max speed ${maxSpeed.toFixed(2)})`);
  let allOnShelf = true;
  for (const b of bodies) if (P.lowestY(b) < -1.5) allOnShelf = false;
  check('a row of 6 all stay on the shelf', allOnShelf);
}

// 4. Stacking: a book laid flat on top of another stays on top of it and
//    both settle. This is the behaviour the whole rewrite is for.
{
  const bottom = P.makeBody(200, 14, 14, 40, Math.PI / 2); // lying flat: 80 wide, 28 tall
  const top = P.makeBody(200, 60, 14, 40, Math.PI / 2);
  const w = makeWorld([bottom, top]);
  run(w, 4);
  check('stacked book stays above the one below',
    top.y > bottom.y + 10, `(top ${top.y.toFixed(1)}, bottom ${bottom.y.toFixed(1)})`);
  check('stack comes to rest',
    Math.hypot(top.vx, top.vy) < 1.5 && Math.hypot(bottom.vx, bottom.vy) < 1.5,
    `(top ${Math.hypot(top.vx, top.vy).toFixed(2)})`);
  check('bottom of the stack is on the shelf', Math.abs(P.lowestY(bottom)) < 1.5,
    `(lowest ${P.lowestY(bottom).toFixed(2)})`);
}

// 5. A fallen book really is wider than a standing one -- what makes it an
//    obstacle the rest of the row has to accommodate.
{
  const standing = P.makeBody(0, 40, 14, 40, 0);
  const fallen = P.makeBody(0, 14, 14, 40, Math.PI / 2);
  check('a fallen book occupies its full length',
    P.horizontalExtent(fallen) > P.horizontalExtent(standing) * 2.5,
    `(standing ${P.horizontalExtent(standing).toFixed(1)}, fallen ${P.horizontalExtent(fallen).toFixed(1)})`);
}

// 6. Tilt topples a book rather than teleporting it, and it ends up lying
//    down and STAYING down once gravity returns to vertical.
{
  const b = P.makeBody(200, 40, 14, 40);
  const w = makeWorld([b]);
  run(w, 0.5);
  w.gx = G * 0.9; // hard tilt
  run(w, 2.5);
  const toppled = Math.abs(b.angle) > 1.0;
  check('a hard tilt topples a book', toppled, `(angle ${b.angle.toFixed(2)})`);
  // Return gravity to vertical: it must NOT stand back up.
  w.gx = 0;
  P.wake(b);
  const angleAfterFall = b.angle;
  run(w, 3);
  check('a fallen book stays down when the phone levels',
    Math.abs(Math.abs(b.angle) - Math.abs(angleAfterFall)) < 0.6,
    `(was ${angleAfterFall.toFixed(2)}, now ${b.angle.toFixed(2)})`);
}

// 7. Walls hold. A row shoved hard sideways piles against the wall instead
//    of escaping the shelf.
{
  const bodies = [];
  for (let i = 0; i < 5; i++) bodies.push(P.makeBody(200 + i * 30, 40, 14, 40));
  const w = makeWorld(bodies, -G * 0.8);
  run(w, 4);
  let minX = Infinity;
  for (const b of bodies) {
    const pts = P.corners(b);
    for (const p of pts) minX = Math.min(minX, p[0]);
  }
  check('books stay inside the left wall', minX > -2, `(minX ${minX.toFixed(2)})`);
}

// 8. Everything eventually sleeps, so the frame loop can stop.
{
  const bodies = [];
  for (let i = 0; i < 4; i++) bodies.push(P.makeBody(80 + i * 32, 45, 14, 40));
  const w = makeWorld(bodies);
  run(w, 8);
  check('the shelf settles into sleep', P.isAsleep(w));
}

// 9. Held books hang from the finger. Grabbed dead centre there's no lever
//    arm and the book stays level; grabbed near a corner gravity has a
//    moment about the grip and it swings down — and either way the grabbed
//    point stays exactly under the finger.
{
  const centre = P.makeBody(200, 40, 14, 40);
  P.makeKinematic(centre);
  for (let i = 0; i < 120; i++) P.driveHeld(centre, 200, 90, 0, 0, 0, -G, 1 / 60);
  check('a book grabbed at its centre stays level', Math.abs(centre.angle) < 0.01,
    `(angle ${centre.angle.toFixed(3)})`);

  const corner = P.makeBody(200, 40, 14, 40);
  P.makeKinematic(corner);
  // Grabbed near the top corner: offset on BOTH axes, so gravity has a
  // moment about the grip.
  for (let i = 0; i < 120; i++) P.driveHeld(corner, 200, 90, 12, 34, 0, -G, 1 / 60);
  check('a book grabbed off-centre swings under gravity', Math.abs(corner.angle) > 0.25,
    `(angle ${corner.angle.toFixed(3)})`);
  // Whatever it did, the grabbed point must still be under the finger.
  const c = Math.cos(corner.angle);
  const s = Math.sin(corner.angle);
  const gx = corner.x + (12 * c - 34 * s);
  const gy = corner.y + (12 * s + 34 * c);
  check('the grabbed point stays under the finger',
    Math.hypot(gx - 200, gy - 90) < 0.01, `(off by ${Math.hypot(gx - 200, gy - 90).toFixed(3)})`);
  // And the swing has to settle rather than pendulum forever.
  check('a held swing damps out', Math.abs(corner.omega) < 0.6,
    `(omega ${corner.omega.toFixed(3)})`);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
