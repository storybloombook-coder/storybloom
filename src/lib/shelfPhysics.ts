// shelfPhysics.ts — a small 2D rigid-body solver for the bookshelf.
//
// WHY THIS EXISTS
// The shelf used to model each book as a 1D particle whose ROTATION was a
// spring pulled toward an angle derived from the phone's tilt. That has no
// notion of a book having a shape, which made three reported behaviours
// unreachable rather than merely mistuned:
//   - a fallen book stood back up, because "fallen" was re-derived from the
//     current tilt every frame instead of being a state the book was in;
//   - a book could never rest against its neighbour, because a leaning book
//     had no width to lean with;
//   - a fallen book still occupied its narrow standing slot, so nothing was
//     displaced by it and nothing could lie on top of it.
// All three need books to be actual rectangles that collide as rectangles.
//
// SCOPE
// Deliberately small: oriented boxes, a floor, two walls, gravity, and
// sequential-impulse contacts with friction. No joints, no continuous
// collision, no broad phase — a shelf holds under a dozen books, so an
// O(n^2) narrow phase over ~10 bodies is nothing.
//
// WORKLET-SAFE
// Pure functions over plain arrays and objects, no imports, no classes, no
// closures over module state. Everything here has to be callable from inside
// a Reanimated worklet on the UI thread, which rules out anything that would
// need to cross the bridge. Kept in its own module (rather than inline in
// Bookshelf.tsx) so it can be run and verified in bare node — see
// shelfPhysics.test.js. Stability is the whole game with a hand-written
// solver, and "looks fine on my phone" is not a way to establish it.

export type Body = {
  /** Center position, px. y is measured UP from the shelf surface. */
  x: number;
  y: number;
  /** Radians. 0 = standing upright. */
  angle: number;
  vx: number;
  vy: number;
  /** Angular velocity, rad/s. */
  omega: number;
  /** Split-impulse pseudo-velocities: move position out of penetration and
   *  are then thrown away, so correcting overlap can't add real energy. */
  pvx: number;
  pvy: number;
  pomega: number;
  halfW: number;
  halfH: number;
  /** 0 = immovable (a book held by the finger drives everything else). */
  invMass: number;
  invInertia: number;
  /** Frames this body has been slow enough to count as at rest. */
  restFrames: number;
  sleeping: boolean;
};

export type World = {
  bodies: Body[];
  /** Inner faces of the end walls, px. */
  leftWall: number;
  rightWall: number;
  /** Gravity in px/s^2. gx comes from the phone's tilt. */
  gx: number;
  gy: number;
};

// Books are heavy, dead things: they don't bounce, and they don't slide
// easily. Restitution near zero is what stops a dropped book pogoing, and
// high friction is what lets a leaning book actually stay leaning instead
// of sliding out from under itself.
const RESTITUTION = 0.02;
const FRICTION = 0.55;
// Sequential impulses converge on stacks; one pass does not. 8 is enough for
// the 2-3 book piles a shelf produces, and cheap at this body count.
const SOLVER_ITERATIONS = 16;
// Penetration is corrected with SPLIT IMPULSE: a second, parallel set of
// "pseudo" velocities that push overlap apart and are used only when
// integrating position, then discarded. Folding the correction into the real
// velocity solve (the textbook Baumgarte term) feeds in energy that nothing
// takes back out, so bodies hover at a few px/s forever and the shelf never
// sleeps -- the stability test caught exactly that. Dropping the correction
// altogether is worse still: without it nothing resists overlap and stacks
// sink. SLOP leaves a sliver of allowed overlap so a resting contact doesn't
// flip between touching and apart.
const BAUMGARTE = 0.25;
const PENETRATION_SLOP = 0.5;
// Corners within this distance of a surface still count as contacts -- see
// staticContacts for why an exact test made resting books rock.
const CONTACT_MARGIN = 0.8;
// A body this slow for this many frames stops integrating. Without sleeping,
// a stack never fully settles: tiny residual impulses keep trickling through
// it forever and the shelf visibly shivers.
const SLEEP_LINEAR = 3;
const SLEEP_ANGULAR = 0.05;
const SLEEP_FRAMES = 30;

export function makeBody(
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  angle = 0,
): Body {
  'worklet';
  // Uniform density: mass from area, inertia from the rectangle formula.
  // Scaled down so the numbers stay in a range where a px/s^2 gravity and a
  // px-sized body produce sane impulses.
  const mass = (halfW * 2 * halfH * 2) / 1000;
  const inertia = (mass * ((halfW * 2) ** 2 + (halfH * 2) ** 2)) / 12;
  return {
    x,
    y,
    angle,
    vx: 0,
    vy: 0,
    omega: 0,
    pvx: 0,
    pvy: 0,
    pomega: 0,
    halfW,
    halfH,
    invMass: 1 / mass,
    invInertia: 1 / inertia,
    restFrames: 0,
    sleeping: false,
  };
}

/** The four corners of a body, world space. */
export function corners(b: Body): number[][] {
  'worklet';
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const out: number[][] = [];
  const sx = [-1, 1, 1, -1];
  const sy = [-1, -1, 1, 1];
  for (let i = 0; i < 4; i++) {
    const lx = sx[i] * b.halfW;
    const ly = sy[i] * b.halfH;
    out.push([b.x + lx * c - ly * s, b.y + lx * s + ly * c]);
  }
  return out;
}

/** How far this body reaches horizontally — its own width when upright, its
 *  height when flat. This is what makes a fallen book an obstacle rather
 *  than something the row passes through. */
export function horizontalExtent(b: Body): number {
  'worklet';
  const c = Math.abs(Math.cos(b.angle));
  const s = Math.abs(Math.sin(b.angle));
  return b.halfW * c + b.halfH * s;
}

/** Lowest corner height — 0 when a body is resting on the shelf. */
export function lowestY(b: Body): number {
  'worklet';
  const pts = corners(b);
  let lo = pts[0][1];
  for (let i = 1; i < 4; i++) if (pts[i][1] < lo) lo = pts[i][1];
  return lo;
}

type Contact = {
  ai: number;
  /** -1 for a static contact (floor/wall). */
  bi: number;
  /** Contact point, world space. */
  px: number;
  py: number;
  /** Unit normal, pointing from A toward B. */
  nx: number;
  ny: number;
  depth: number;
  /** Impulse accumulated across solver iterations. Clamping the TOTAL rather
   *  than each iteration's increment is what makes sequential impulses
   *  actually converge -- clamping per-iteration lets a contact that pushed
   *  too hard early never take any of it back, so a resting stack keeps a
   *  few px/s of residual forever and never sleeps. */
  jn: number;
  jt: number;
};

/** Separating-axis test between two oriented boxes, producing a TWO-POINT
 *  manifold for face-to-face contact via Sutherland-Hodgman clipping.
 *
 *  The two points are the whole reason stacking works. With a single contact
 *  point, a book lying flat on another has nothing stopping it rotating
 *  about that point, so it rocks corner to corner indefinitely and the
 *  stack never sleeps -- which is precisely what the stability test showed
 *  when this was a one-point approximation. A flat contact needs to be
 *  described as flat. */
function boxContacts(a: Body, ai: number, b: Body, bi: number, out: Contact[]): void {
  'worklet';
  const ca = corners(a);
  const cb = corners(b);
  const acos = Math.cos(a.angle);
  const asin = Math.sin(a.angle);
  const bcos = Math.cos(b.angle);
  const bsin = Math.sin(b.angle);
  const axes = [[acos, asin], [-asin, acos], [bcos, bsin], [-bsin, bcos]];

  let bestDepth = Infinity;
  let bestAxis = -1;
  let bnx = 0;
  let bny = 0;
  for (let k = 0; k < axes.length; k++) {
    const nx = axes[k][0];
    const ny = axes[k][1];
    let aMin = Infinity; let aMax = -Infinity;
    let bMin = Infinity; let bMax = -Infinity;
    for (let i = 0; i < 4; i++) {
      const pa = ca[i][0] * nx + ca[i][1] * ny;
      if (pa < aMin) aMin = pa;
      if (pa > aMax) aMax = pa;
      const pb = cb[i][0] * nx + cb[i][1] * ny;
      if (pb < bMin) bMin = pb;
      if (pb > bMax) bMax = pb;
    }
    if (aMax < bMin || bMax < aMin) return; // a gap on any axis = no contact
    const depth = Math.min(aMax - bMin, bMax - aMin);
    if (depth < bestDepth) {
      bestDepth = depth;
      bestAxis = k;
      // Orient from A toward B.
      const dot = (b.x - a.x) * nx + (b.y - a.y) * ny;
      bnx = dot < 0 ? -nx : nx;
      bny = dot < 0 ? -ny : ny;
    }
  }
  if (bestAxis < 0) return;

  // The face that owns the separating axis is the REFERENCE; the other body
  // presents the INCIDENT face, which gets clipped against it.
  const refIsA = bestAxis < 2;
  const refPts = refIsA ? ca : cb;
  const incPts = refIsA ? cb : ca;
  // Normal pointing out of the reference body toward the incident one.
  const rnx = refIsA ? bnx : -bnx;
  const rny = refIsA ? bny : -bny;

  const faceIndex = (pts: number[][], nx: number, ny: number) => {
    let best = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const ex = pts[j][0] - pts[i][0];
      const ey = pts[j][1] - pts[i][1];
      const len = Math.hypot(ex, ey) || 1;
      // Outward normal of a CCW edge.
      const fnx = ey / len;
      const fny = -ex / len;
      const d = fnx * nx + fny * ny;
      if (d > bestDot) { bestDot = d; best = i; }
    }
    return best;
  };

  const rf = faceIndex(refPts, rnx, rny);
  const r0 = refPts[rf];
  const r1 = refPts[(rf + 1) % 4];
  // Incident face is the one facing most directly back at the reference.
  const inf = faceIndex(incPts, -rnx, -rny);
  let i0 = incPts[inf];
  let i1 = incPts[(inf + 1) % 4];

  // Clip the incident segment against the reference face's two side planes.
  const ex = r1[0] - r0[0];
  const ey = r1[1] - r0[1];
  const elen = Math.hypot(ex, ey) || 1;
  const tx = ex / elen;
  const ty = ey / elen;

  const clip = (p0: number[], p1: number[], nx2: number, ny2: number, off: number) => {
    const d0 = p0[0] * nx2 + p0[1] * ny2 - off;
    const d1 = p1[0] * nx2 + p1[1] * ny2 - off;
    const keep: number[][] = [];
    if (d0 <= 0) keep.push(p0);
    if (d1 <= 0) keep.push(p1);
    if (d0 * d1 < 0) {
      const t = d0 / (d0 - d1);
      keep.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
    }
    return keep;
  };

  let seg = clip(i0, i1, -tx, -ty, -(r0[0] * tx + r0[1] * ty));
  if (seg.length < 2) return;
  [i0, i1] = [seg[0], seg[1]];
  seg = clip(i0, i1, tx, ty, r1[0] * tx + r1[1] * ty);
  if (seg.length < 2) return;

  // Keep whichever clipped points are actually behind the reference face.
  const refOff = r0[0] * rnx + r0[1] * rny;
  for (let i = 0; i < seg.length; i++) {
    const depth = refOff - (seg[i][0] * rnx + seg[i][1] * rny);
    if (depth < 0) continue;
    out.push({ ai, bi, px: seg[i][0], py: seg[i][1], nx: bnx, ny: bny, depth, jn: 0, jt: 0 });
  }
}

/** Floor and wall contacts for one body — one per penetrating corner, so a
 *  book lying flat gets two floor contacts and actually stays flat instead
 *  of rocking on a single point. */
function staticContacts(b: Body, i: number, world: World, out: Contact[]): void {
  'worklet';
  const pts = corners(b);
  for (let k = 0; k < 4; k++) {
    const cx = pts[k][0];
    const cy = pts[k][1];
    // CONTACT_MARGIN, not zero: a book at rest sits a hair above the shelf,
    // and with an exact test whichever corner happened to be a fraction
    // higher dropped out of the manifold that frame. The contact set then
    // flickered between two points and one, and on a one-point frame there
    // was nothing to stop it rotating -- so it rocked corner to corner
    // forever and never slept. Including near-touching corners keeps the
    // manifold stable; their depth is negative, so they contribute no push
    // until something actually presses in.
    if (cy < CONTACT_MARGIN) out.push({ ai: i, bi: -1, px: cx, py: cy, nx: 0, ny: -1, depth: -cy, jn: 0, jt: 0 });
    if (cx < world.leftWall + CONTACT_MARGIN) {
      out.push({ ai: i, bi: -1, px: cx, py: cy, nx: -1, ny: 0, depth: world.leftWall - cx, jn: 0, jt: 0 });
    }
    if (cx > world.rightWall - CONTACT_MARGIN) {
      out.push({ ai: i, bi: -1, px: cx, py: cy, nx: 1, ny: 0, depth: cx - world.rightWall, jn: 0, jt: 0 });
    }
  }
}

function applyImpulse(b: Body, ix: number, iy: number, rx: number, ry: number): void {
  'worklet';
  if (b.invMass === 0) return;
  b.vx += ix * b.invMass;
  b.vy += iy * b.invMass;
  b.omega += (rx * iy - ry * ix) * b.invInertia;
}

function applyPseudoImpulse(b: Body, ix: number, iy: number, rx: number, ry: number): void {
  'worklet';
  if (b.invMass === 0) return;
  b.pvx += ix * b.invMass;
  b.pvy += iy * b.invMass;
  b.pomega += (rx * iy - ry * ix) * b.invInertia;
}

/** One simulation step. `dt` in seconds, clamped by the caller. */
export function step(world: World, dt: number): void {
  'worklet';
  const bodies = world.bodies;
  const n = bodies.length;

  // --- integrate velocity -------------------------------------------------
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    if (b.sleeping || b.invMass === 0) continue;
    b.vx += world.gx * dt;
    b.vy += world.gy * dt;
  }

  // --- find contacts ------------------------------------------------------
  const contacts: Contact[] = [];
  for (let i = 0; i < n; i++) {
    staticContacts(bodies[i], i, world, contacts);
    for (let j = i + 1; j < n; j++) {
      // Cheap reject before the full SAT: if the centers are further apart
      // than the two bodies' diagonals combined they cannot be touching.
      const a = bodies[i];
      const b = bodies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const ra = Math.hypot(a.halfW, a.halfH);
      const rb = Math.hypot(b.halfW, b.halfH);
      if (dx * dx + dy * dy > (ra + rb) * (ra + rb)) continue;
      boxContacts(a, i, b, j, contacts);
    }
  }

  // Anything in contact with a moving body has to wake up, or a stack can be
  // hit and simply absorb it.
  for (let k = 0; k < contacts.length; k++) {
    const c = contacts[k];
    const a = bodies[c.ai];
    const b = c.bi >= 0 ? bodies[c.bi] : null;
    if (b && (!a.sleeping || !b.sleeping)) {
      a.sleeping = false;
      b.sleeping = false;
      a.restFrames = 0;
      b.restFrames = 0;
    }
  }

  // --- resolve ------------------------------------------------------------
  for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
    for (let k = 0; k < contacts.length; k++) {
      const c = contacts[k];
      const A = bodies[c.ai];
      const B = c.bi >= 0 ? bodies[c.bi] : null;

      const rax = c.px - A.x;
      const ray = c.py - A.y;
      const rbx = B ? c.px - B.x : 0;
      const rby = B ? c.py - B.y : 0;

      // Relative velocity at the contact point.
      const avx = A.vx - A.omega * ray;
      const avy = A.vy + A.omega * rax;
      const bvx = B ? B.vx - B.omega * rby : 0;
      const bvy = B ? B.vy + B.omega * rbx : 0;
      const rvx = bvx - avx;
      const rvy = bvy - avy;

      const relN = rvx * c.nx + rvy * c.ny;
      // Effective mass along the normal.
      const raCrossN = rax * c.ny - ray * c.nx;
      const rbCrossN = B ? rbx * c.ny - rby * c.nx : 0;
      let invMassSum = A.invMass + raCrossN * raCrossN * A.invInertia;
      if (B) invMassSum += B.invMass + rbCrossN * rbCrossN * B.invInertia;
      if (invMassSum === 0) continue;

      // No positional bias here on purpose -- see POSITION_CORRECTION. This
      // solves velocity only, so a resting stack converges to zero motion
      // instead of being nudged every frame.
      // Accumulate-then-clamp: work out the running total this contact
      // should have applied, clamp THAT at zero, and apply only the
      // difference. Clamping each iteration's own increment instead lets an
      // early over-push stand forever, which is what left resting bodies
      // drifting at a few px/s and stopped the shelf ever sleeping.
      const rawJn = (-(1 + RESTITUTION) * relN) / invMassSum;
      const oldJn = c.jn;
      c.jn = Math.max(0, oldJn + rawJn);
      const jn = c.jn - oldJn;

      applyImpulse(A, -jn * c.nx, -jn * c.ny, rax, ray);
      if (B) applyImpulse(B, jn * c.nx, jn * c.ny, rbx, rby);

      // Friction along the tangent, clamped to the Coulomb cone. This is
      // what holds a leaning book up and stops a stack sliding apart.
      const tx = -c.ny;
      const ty = c.nx;
      const avx2 = A.vx - A.omega * ray;
      const avy2 = A.vy + A.omega * rax;
      const bvx2 = B ? B.vx - B.omega * rby : 0;
      const bvy2 = B ? B.vy + B.omega * rbx : 0;
      const relT = (bvx2 - avx2) * tx + (bvy2 - avy2) * ty;
      const raCrossT = rax * ty - ray * tx;
      const rbCrossT = B ? rbx * ty - rby * tx : 0;
      let invMassT = A.invMass + raCrossT * raCrossT * A.invInertia;
      if (B) invMassT += B.invMass + rbCrossT * rbCrossT * B.invInertia;
      if (invMassT === 0) continue;
      // Same accumulate-then-clamp, against the Coulomb cone of the TOTAL
      // normal impulse rather than this iteration's slice.
      const rawJt = -relT / invMassT;
      const maxF = c.jn * FRICTION;
      const oldJt = c.jt;
      c.jt = Math.max(-maxF, Math.min(maxF, oldJt + rawJt));
      const jt = c.jt - oldJt;

      applyImpulse(A, -jt * tx, -jt * ty, rax, ray);
      if (B) applyImpulse(B, jt * tx, jt * ty, rbx, rby);

      // Split impulse: the same normal constraint again, but on the pseudo
      // velocities and driven by how deep the overlap is. These move
      // position only (see the integrate step) and are discarded after, so
      // pushing bodies apart never shows up as real motion.
      const bias = (BAUMGARTE / dt) * Math.max(0, c.depth - PENETRATION_SLOP);
      if (bias > 0) {
        const pavx = A.pvx - A.pomega * ray;
        const pavy = A.pvy + A.pomega * rax;
        const pbvx = B ? B.pvx - B.pomega * rby : 0;
        const pbvy = B ? B.pvy + B.pomega * rbx : 0;
        const relPN = (pbvx - pavx) * c.nx + (pbvy - pavy) * c.ny;
        let jp = (bias - relPN) / invMassSum;
        if (jp < 0) jp = 0;
        applyPseudoImpulse(A, -jp * c.nx, -jp * c.ny, rax, ray);
        if (B) applyPseudoImpulse(B, jp * c.nx, jp * c.ny, rbx, rby);
      }
    }
  }

  // --- integrate position + sleep ----------------------------------------
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    if (b.sleeping || b.invMass === 0) continue;
    // Real velocity plus the pseudo velocity, which is then discarded --
    // penetration gets corrected, the correction leaves no momentum behind.
    b.x += (b.vx + b.pvx) * dt;
    b.y += (b.vy + b.pvy) * dt;
    b.angle += (b.omega + b.pomega) * dt;
    b.pvx = 0;
    b.pvy = 0;
    b.pomega = 0;

    const slow = Math.hypot(b.vx, b.vy) < SLEEP_LINEAR && Math.abs(b.omega) < SLEEP_ANGULAR;
    b.restFrames = slow ? b.restFrames + 1 : 0;
    if (b.restFrames > SLEEP_FRAMES) {
      b.sleeping = true;
      b.vx = 0;
      b.vy = 0;
      b.omega = 0;
    }
  }
}

/** True once every body has come to rest — lets the caller skip the frame
 *  loop entirely, the same early-out the old shelf had. */
export function isAsleep(world: World): boolean {
  'worklet';
  for (let i = 0; i < world.bodies.length; i++) {
    if (!world.bodies[i].sleeping && world.bodies[i].invMass !== 0) return false;
  }
  return true;
}

export function wake(b: Body): void {
  'worklet';
  b.sleeping = false;
  b.restFrames = 0;
}

/** Hand a body to the finger: zero inverse mass makes it immovable by
 *  everything else while still shoving everything it touches, which is
 *  exactly what dragging should feel like. */
export function makeKinematic(b: Body): void {
  'worklet';
  b.invMass = 0;
  b.invInertia = 0;
  b.sleeping = false;
  b.restFrames = 0;
}

/** Give it back to the simulation on release. Recomputes from the same
 *  formula makeBody uses, so the two can't drift apart. */
export function restoreDynamics(b: Body): void {
  'worklet';
  const mass = (b.halfW * 2 * b.halfH * 2) / 1000;
  const inertia = (mass * ((b.halfW * 2) ** 2 + (b.halfH * 2) ** 2)) / 12;
  b.invMass = 1 / mass;
  b.invInertia = 1 / inertia;
  b.sleeping = false;
  b.restFrames = 0;
}

/** Left-to-right order by position — the shelf's order is wherever the
 *  books physically ended up, not a list the physics has to be told about. */
export function orderByPosition(bodies: Body[]): number[] {
  'worklet';
  const idx: number[] = [];
  for (let i = 0; i < bodies.length; i++) idx.push(i);
  idx.sort((a, b) => bodies[a].x - bodies[b].x);
  return idx;
}
