/* eslint-disable react/no-unknown-property -- R3F intrinsic props are valid native scene props. */
import { useEffect, useRef } from 'react';

function dragPoint(event) {
  const nativeEvent = event.nativeEvent ?? event;
  return {
    id: nativeEvent.identifier ?? nativeEvent.pointerId ?? event.pointerId ?? 0,
    x: nativeEvent.pageX ?? nativeEvent.locationX ?? nativeEvent.offsetX,
    y: nativeEvent.pageY ?? nativeEvent.locationY ?? nativeEvent.offsetY,
    time: nativeEvent.timestamp ?? event.timeStamp ?? Date.now(),
  };
}

// A custom zero-distance raycast makes this event-only object the first hit
// everywhere on the Canvas without tying it to the moving camera's world
// transform. It still allows every event to propagate to the visible scene.
function alwaysHit(raycaster, intersections) {
  intersections.push({
    distance: 0,
    point: raycaster.ray.origin.clone(),
    object: this,
  });
}

// The shield participates in R3F's own PanResponder, avoiding a competing
// native gesture recognizer. Only the synthetic click following a real drag
// is stopped; plain taps keep propagating to the visible scene objects.
export function CameraDragShield({ dragController }) {
  const clickResetTimer = useRef();

  useEffect(() => () => {
    if (clickResetTimer.current) clearTimeout(clickResetTimer.current);
  }, []);

  const onPointerDown = (event) => {
    dragController.pointerDown(dragPoint(event));
  };
  const onPointerMove = (event) => {
    dragController.pointerMove(dragPoint(event));
  };
  const onPointerUp = (event) => {
    if (!dragController.pointerUp(dragPoint(event))) return;
    // R3F dispatches its synthetic click immediately after pointer-up.
    // Leave the shield armed for that synchronous event, then clear it so
    // a long drag (which generates no click) cannot affect the next tap.
    if (clickResetTimer.current) clearTimeout(clickResetTimer.current);
    clickResetTimer.current = setTimeout(dragController.clearClickSuppression, 0);
  };
  const onClick = (event) => {
    if (dragController.consumeClickSuppression()) event.stopPropagation();
  };

  return (
    <object3D
      raycast={alwaysHit}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
    />
  );
}
