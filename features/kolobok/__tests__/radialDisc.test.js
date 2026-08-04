// Standalone check of the adaptive makeRadialDisc topology (mirrors the
// implementation in features/kolobok/src/scene/Island.jsx).
const MIN_RING_SEGMENTS = 12;

function makeRadialDisc(radius, rings, rimSegments) {
  const verts = [0, 0, 0];
  const ringStart = [0];
  const ringCount = [1];
  for (let ring = 1; ring <= rings; ring += 1) {
    const rr = (ring / rings) * radius;
    const count = Math.max(MIN_RING_SEGMENTS, Math.round((rimSegments * ring) / rings));
    ringStart.push(verts.length / 3);
    ringCount.push(count);
    for (let s = 0; s < count; s += 1) {
      const a = (s / count) * Math.PI * 2;
      verts.push(Math.cos(a) * rr, Math.sin(a) * rr, 0);
    }
  }
  const idx = [];
  for (let s = 0; s < ringCount[1]; s += 1) {
    idx.push(0, ringStart[1] + s, ringStart[1] + ((s + 1) % ringCount[1]));
  }
  for (let ring = 1; ring < rings; ring += 1) {
    const inBase = ringStart[ring];
    const outBase = ringStart[ring + 1];
    const nIn = ringCount[ring];
    const nOut = ringCount[ring + 1];
    let i = 0;
    let j = 0;
    while (i < nIn || j < nOut) {
      const takeInner = j >= nOut || (i < nIn && (i + 1) / nIn <= (j + 1) / nOut);
      if (takeInner) {
        idx.push(inBase + (i % nIn), outBase + (j % nOut), inBase + ((i + 1) % nIn));
        i += 1;
      } else {
        idx.push(inBase + (i % nIn), outBase + (j % nOut), outBase + ((j + 1) % nOut));
        j += 1;
      }
    }
  }
  return { verts, idx, ringCount, ringStart };
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`ok - ${name}`);
  else { console.log(`FAIL - ${name} ${detail}`); failures += 1; }
}

const RADIUS = 8;
const { verts, idx, ringCount } = makeRadialDisc(RADIUS, 56, 340);
const triCount = idx.length / 3;
const vertCount = verts.length / 3;

console.log(`triangles: ${triCount}, vertices: ${vertCount}`);
console.log(`rim ring segments: ${ringCount[56]} (was 340 uniform)`);

// 1. No degenerate triangles (repeated index).
let degenerate = 0;
for (let t = 0; t < triCount; t += 1) {
  const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
  if (a === b || b === c || a === c) degenerate += 1;
}
check('no degenerate triangles', degenerate === 0, `(${degenerate} found)`);

// 2. Watertight: every undirected edge is shared by exactly 2 triangles,
//    except the outer rim, whose edges belong to 1.
const edges = new Map();
for (let t = 0; t < triCount; t += 1) {
  const tri = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
  for (let e = 0; e < 3; e += 1) {
    const u = tri[e];
    const v = tri[(e + 1) % 3];
    const key = u < v ? `${u}_${v}` : `${v}_${u}`;
    edges.set(key, (edges.get(key) || 0) + 1);
  }
}
let boundary = 0;
let bad = 0;
for (const [, n] of edges) {
  if (n === 2) continue;
  if (n === 1) boundary += 1;
  else bad += 1;
}
check('no edge shared by >2 triangles', bad === 0, `(${bad} found)`);
check('boundary edges == rim segment count', boundary === ringCount[56],
  `(boundary ${boundary}, rim ${ringCount[56]})`);

// 3. Consistent CCW winding in the XY plane (positive signed area).
let negative = 0;
for (let t = 0; t < triCount; t += 1) {
  const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
  const ax = verts[a * 3]; const ay = verts[a * 3 + 1];
  const bx = verts[b * 3]; const by = verts[b * 3 + 1];
  const cx = verts[c * 3]; const cy = verts[c * 3 + 1];
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (cross <= 0) negative += 1;
}
check('all triangles wound CCW', negative === 0, `(${negative} negative)`);

// 4. Total area matches a disc of this radius (catches gaps/overlaps that
//    edge counting alone could miss).
let area = 0;
for (let t = 0; t < triCount; t += 1) {
  const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
  const ax = verts[a * 3]; const ay = verts[a * 3 + 1];
  const bx = verts[b * 3]; const by = verts[b * 3 + 1];
  const cx = verts[c * 3]; const cy = verts[c * 3 + 1];
  area += ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
}
// A 340-gon inscribed in r=8 is very slightly smaller than the true circle.
const ideal = Math.PI * RADIUS * RADIUS;
check('total area within 0.5% of a full disc', Math.abs(area - ideal) / ideal < 0.005,
  `(area ${area.toFixed(2)} vs ${ideal.toFixed(2)})`);

// 5. Tangential spacing stays near-uniform (the whole point of the change).
let minSp = Infinity;
let maxSp = 0;
for (let ring = 1; ring <= 56; ring += 1) {
  const rr = (ring / 56) * RADIUS;
  const sp = (2 * Math.PI * rr) / ringCount[ring];
  if (ring >= 4) { minSp = Math.min(minSp, sp); maxSp = Math.max(maxSp, sp); }
}
console.log(`tangential spacing (rings 4+): ${minSp.toFixed(3)} - ${maxSp.toFixed(3)}`);
check('spacing stays under 0.2 everywhere', maxSp < 0.2, `(max ${maxSp.toFixed(3)})`);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
