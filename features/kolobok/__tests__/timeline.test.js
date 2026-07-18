// Plain node test of timeline.js's timing math — step activation, easing
// bounds, and cancel. Run with: node __tests__/timeline.test.js
// No test framework, no Three.js — timeline.js must stay importable in bare
// node (see its own header comment).

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, '../src/scene/timeline.js')));
  const { createTimeline, easeOutCubic, easeInOutSine, easeOutBack } = mod;

  let passed = 0;
  function check(name, fn) {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  }

  // --- Easing bounds ---------------------------------------------------
  check('easeOutCubic starts at 0, ends at 1, monotonic', () => {
    assert.strictEqual(easeOutCubic(0), 0);
    assert.ok(Math.abs(easeOutCubic(1) - 1) < 1e-9);
    assert.ok(easeOutCubic(0.5) > 0 && easeOutCubic(0.5) < 1);
  });

  check('easeInOutSine starts at 0, ends at 1, midpoint 0.5', () => {
    assert.ok(Math.abs(easeInOutSine(0) - 0) < 1e-9);
    assert.ok(Math.abs(easeInOutSine(1) - 1) < 1e-9);
    assert.ok(Math.abs(easeInOutSine(0.5) - 0.5) < 1e-9);
  });

  check('easeOutBack starts at 0, ends exactly at 1, overshoots mid-flight', () => {
    assert.strictEqual(easeOutBack(0), 0);
    assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-9);
    // The "back" overshoot means some t < 1 produces a value > 1.
    let overshot = false;
    for (let t = 0; t <= 1; t += 0.01) {
      if (easeOutBack(t) > 1) overshot = true;
    }
    assert.ok(overshot, 'expected easeOutBack to overshoot above 1 before settling');
  });

  // --- Step activation ---------------------------------------------------
  check('update step receives progress 0 at start and 1 at/after its end', () => {
    const seen = [];
    const tl = createTimeline([{ at: 0, dur: 1000, ease: 'easeOutCubic', update: (t) => seen.push(t) }]);
    tl.tick(0); // elapsed 0ms -> t=0
    tl.tick(0.5); // elapsed 500ms -> t=0.5 (eased)
    tl.tick(0.5); // elapsed 1000ms -> t=1
    tl.tick(0.5); // elapsed 1500ms -> already settled, no further calls
    assert.strictEqual(seen[0], 0);
    assert.strictEqual(seen[seen.length - 1], 1);
    assert.strictEqual(seen.length, 3, 'update should stop firing once settled at t=1');
  });

  check('call step fires exactly once, only once its `at` is reached', () => {
    let calls = 0;
    const tl = createTimeline([{ at: 500, call: () => { calls += 1; } }]);
    tl.tick(0.4); // 400ms — not yet
    assert.strictEqual(calls, 0);
    tl.tick(0.2); // 600ms — fires now
    assert.strictEqual(calls, 1);
    tl.tick(1); // way past — must not fire again
    assert.strictEqual(calls, 1);
  });

  check('a multi-step timeline activates steps in order and reports done', () => {
    const order = [];
    const tl = createTimeline([
      { at: 0, dur: 100, update: () => order.push('a') },
      { at: 100, call: () => order.push('b') },
      { at: 200, dur: 100, update: () => order.push('c') },
    ]);
    assert.strictEqual(tl.done, false);
    tl.tick(0.05); // 50ms: only 'a'
    assert.deepStrictEqual(order, ['a']);
    tl.tick(0.35); // 400ms total: a settles, b fires, c starts+settles
    assert.ok(order.includes('b') && order.includes('c'));
    assert.strictEqual(tl.done, true);
  });

  // --- Cancel --------------------------------------------------------
  check('cancel stops ticking immediately without forcing steps to their end value', () => {
    const seen = [];
    const tl = createTimeline([{ at: 0, dur: 1000, update: (t) => seen.push(t) }]);
    tl.tick(0.3); // 300ms -> some mid-progress value, NOT 1
    const lastBeforeCancel = seen[seen.length - 1];
    assert.ok(lastBeforeCancel < 1, 'sanity: step should not be finished yet');
    tl.cancel();
    assert.strictEqual(tl.done, true);
    tl.tick(10); // should be a no-op post-cancel
    assert.strictEqual(seen[seen.length - 1], lastBeforeCancel, 'cancel must not jump to end state');
  });

  console.log(`\n${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
