// Plain-node regression tests for the one-finger Canvas drag controller.
// Run with: node features/kolobok/__tests__/singlePointerDrag.test.js
/* global __dirname */

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const mod = await import(pathToFileURL(
    path.join(__dirname, '../src/scene/singlePointerDrag.js'),
  ));
  const { createSinglePointerDrag } = mod;

  let passed = 0;
  function check(name, fn) {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  }

  const point = (id, x, y, time) => ({
    id, x, y, time,
  });

  check('one pointer activates and supplies the full drag without a second pointer', () => {
    const events = [];
    const drag = createSinglePointerDrag({
      threshold: 4,
      onStart: () => events.push(['start']),
      onChange: (event) => events.push(['change', event.changeX, event.changeY]),
      onEnd: () => events.push(['end']),
    });

    assert.strictEqual(drag.pointerDown(point(7, 10, 20, 0)), true);
    drag.pointerMove(point(7, 16, 18, 16));
    drag.pointerMove(point(7, 21, 18, 32));
    drag.pointerUp(point(7, 21, 18, 40));

    assert.deepStrictEqual(events, [
      ['start'],
      ['change', 6, -2],
      ['change', 5, 0],
      ['end'],
    ]);
  });

  check('sub-threshold tap never starts a drag or suppresses its click', () => {
    let starts = 0;
    const drag = createSinglePointerDrag({ onStart: () => { starts += 1; } });

    drag.pointerDown(point(1, 10, 10, 0));
    drag.pointerMove(point(1, 12, 11, 20));
    drag.pointerUp(point(1, 12, 11, 30));

    assert.strictEqual(starts, 0);
    assert.strictEqual(drag.consumeClickSuppression(), false);
  });

  check('a camera drag suppresses exactly one generated R3F click', () => {
    const drag = createSinglePointerDrag();
    drag.pointerDown(point(1, 0, 0, 0));
    drag.pointerMove(point(1, 5, 0, 20));
    drag.pointerUp(point(1, 5, 0, 30));

    assert.strictEqual(drag.consumeClickSuppression(), true);
    assert.strictEqual(drag.consumeClickSuppression(), false);
  });

  check('a second pointer cannot take over the active one', () => {
    const changes = [];
    const drag = createSinglePointerDrag({
      onChange: ({ changeX }) => changes.push(changeX),
    });

    assert.strictEqual(drag.pointerDown(point(1, 0, 0, 0)), true);
    assert.strictEqual(drag.pointerDown(point(2, 100, 0, 1)), false);
    assert.strictEqual(drag.pointerMove(point(2, 120, 0, 10)), false);
    drag.pointerMove(point(1, 8, 0, 20));
    drag.pointerUp(point(1, 8, 0, 30));

    assert.deepStrictEqual(changes, [8]);
  });

  check('cancel releases an active drag without adding fling', () => {
    let cancelled = 0;
    let ended = 0;
    const drag = createSinglePointerDrag({
      onCancel: () => { cancelled += 1; },
      onEnd: () => { ended += 1; },
    });

    drag.pointerDown(point(3, 0, 0, 0));
    drag.pointerMove(point(3, 10, 0, 10));
    assert.strictEqual(drag.pointerCancel(point(3, 10, 0, 20)), true);
    assert.strictEqual(cancelled, 1);
    assert.strictEqual(ended, 0);
    assert.strictEqual(drag.isDragging(), false);
  });

  check('release velocity follows the recent motion of the active pointer', () => {
    let released;
    const drag = createSinglePointerDrag({
      onEnd: (event) => { released = event; },
    });

    drag.pointerDown(point(4, 0, 0, 0));
    drag.pointerMove(point(4, 5, 0, 50));
    drag.pointerMove(point(4, 15, 0, 100));
    drag.pointerUp(point(4, 15, 0, 110));

    assert.ok(Math.abs(released.velocityX - 150) < 1e-9);
    assert.strictEqual(released.velocityY, 0);
  });

  console.log(`\n${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
