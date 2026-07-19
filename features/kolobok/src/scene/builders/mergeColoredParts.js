// mergeColoredParts.js — bakes several differently-colored, rigidly-attached
// primitive geometries (a body + belly patch + eyes + ...) into ONE
// BufferGeometry with a per-vertex `color` attribute, so they render as a
// single draw call via `<meshStandardMaterial vertexColors />` instead of
// one mesh per part. This is what makes the Phase 4 animals affordable
// under the 40-draw-call budget (CLAUDE.md) -- each animal has 6-10 ART_SPEC
// parts, but only the ones that genuinely need independent per-frame
// animation (an ear, a head, a tail segment) get their own mesh; everything
// else that just moves *with* its parent merges into one shape.

import { BufferAttribute, Color, Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const dummy = new Object3D();

/**
 * @param {Array<{geometry: import('three').BufferGeometry, color: string,
 *   position?: [number,number,number], rotation?: [number,number,number],
 *   scale?: [number,number,number]}>} parts
 */
export function mergeColoredParts(parts) {
  const geometries = parts.map(({
    geometry, color, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1],
  }) => {
    const geo = geometry.clone();
    dummy.position.set(...position);
    dummy.rotation.set(...rotation);
    dummy.scale.set(...scale);
    dummy.updateMatrix();
    geo.applyMatrix4(dummy.matrix);

    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const c = new Color(color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    return geo;
  });

  return mergeGeometries(geometries, false);
}
