// Small, platform-independent one-pointer drag state machine.
//
// Scene3D feeds this from an event-only object inside R3F's built-in
// PanResponder. Sharing that input stream avoids the competing
// GestureDetector/PanResponder race that used to cancel one-finger drags.

const DEFAULT_THRESHOLD = 4;
const VELOCITY_WINDOW_MS = 120;

function validPoint(point) {
  return point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && Number.isFinite(point.time);
}

export function createSinglePointerDrag({
  threshold = DEFAULT_THRESHOLD,
  onStart = () => {},
  onChange = () => {},
  onEnd = () => {},
  onCancel = () => {},
} = {}) {
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;
  let suppressClick = false;
  let samples = [];

  const resetPointer = () => {
    pointerId = null;
    dragging = false;
    samples = [];
  };

  const remember = (point) => {
    const last = samples[samples.length - 1];
    const time = last ? Math.max(last.time, point.time) : point.time;
    const sample = { x: point.x, y: point.y, time };

    if (last && last.time === time) samples[samples.length - 1] = sample;
    else samples.push(sample);

    const cutoff = time - VELOCITY_WINDOW_MS;
    while (samples.length > 2 && samples[1].time < cutoff) samples.shift();
  };

  const velocity = () => {
    if (samples.length < 2) return { velocityX: 0, velocityY: 0 };
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = last.time - first.time;
    if (elapsed <= 0) return { velocityX: 0, velocityY: 0 };
    return {
      velocityX: ((last.x - first.x) / elapsed) * 1000,
      velocityY: ((last.y - first.y) / elapsed) * 1000,
    };
  };

  const pointerDown = (point) => {
    if (pointerId !== null || !validPoint(point)) return false;
    pointerId = point.id;
    startX = point.x;
    startY = point.y;
    lastX = point.x;
    lastY = point.y;
    suppressClick = false;
    samples = [];
    remember(point);
    return true;
  };

  const pointerMove = (point) => {
    if (pointerId === null || point.id !== pointerId || !validPoint(point)) return false;

    const totalX = point.x - startX;
    const totalY = point.y - startY;
    remember(point);

    if (!dragging) {
      if (Math.hypot(totalX, totalY) < threshold) return true;
      dragging = true;
      suppressClick = true;
      onStart();
    }

    const changeX = point.x - lastX;
    const changeY = point.y - lastY;
    lastX = point.x;
    lastY = point.y;
    if (changeX !== 0 || changeY !== 0) onChange({ changeX, changeY });
    return true;
  };

  const pointerUp = (point) => {
    if (pointerId === null || point.id !== pointerId || !validPoint(point)) return false;

    // Some native streams report the final coordinate only on touch-end.
    // Route that last delta through the same threshold/change logic.
    if (point.x !== lastX || point.y !== lastY) pointerMove(point);

    if (dragging) onEnd(velocity());
    resetPointer();
    return true;
  };

  const pointerCancel = (point) => {
    if (pointerId === null || (point && point.id !== pointerId)) return false;
    if (dragging) onCancel();
    suppressClick = false;
    resetPointer();
    return true;
  };

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    isDragging: () => dragging,
    consumeClickSuppression: () => {
      const shouldSuppress = suppressClick;
      suppressClick = false;
      return shouldSuppress;
    },
    clearClickSuppression: () => {
      suppressClick = false;
    },
  };
}
