import { useFrame } from '@react-three/fiber/native';
import { Vector3 } from 'three';
import { ZONES, ZONE_RADIUS, rad } from '../config/zones';
import { bubbleAnchor, storyMotion, useSceneStore } from '../state/sceneStore';
import { GRANDPA_WORLD_POS } from './PondAndGrandpa';

// Rough head-height above ground for each anchor kind -- not per-character
// precise, just enough that the bubble reads as "above them" rather than
// "at their feet". Kolobok is a small rolling ball (much lower than the
// zone animals), so he gets his own, smaller offset.
const HEAD_OFFSET_ZONE = 1.6;
const HEAD_OFFSET_KOLOBOK = 0.9;
const BUBBLE_GAP = 18; // px between the speaker's head point and the bubble's tail

const v = new Vector3();

/** Projects whoever is currently "speaking" (STORY_SPEC narration wins the
 *  shared bubble slot over an interactive encounter.line, same priority
 *  Scene3D.jsx already uses) from world space to screen space every frame,
 *  publishing the result to `bubbleAnchor` for Scene3D's RN overlay to read.
 *  Mounted inside the Canvas (KolobokScene.jsx) purely for the `camera`/
 *  `size` it needs from useFrame -- renders nothing itself. */
export function BubbleAnchor() {
  useFrame(({ camera, size }) => {
    const s = useSceneStore.getState();
    const enc = s.encounter;
    // Narration's OWN speaker (default 'kolobok') decides the anchor now --
    // previously any narration was hardcoded to Kolobok's position, which is
    // wrong for Grandpa's fishing-catch lines (EASTER_EGGS.md §2: narrated
    // via the same setNarration channel, tagged narrationSpeaker='grandpa').
    const speaking = s.narration ? s.narrationSpeaker : (enc?.line ? enc.id : null);
    if (!speaking) {
      bubbleAnchor.visible = false;
      return;
    }

    let wx;
    let wy;
    let wz;
    if (speaking === 'kolobok') {
      wx = storyMotion.kolobokWorldPos[0];
      wy = storyMotion.kolobokWorldPos[1] + HEAD_OFFSET_KOLOBOK;
      wz = storyMotion.kolobokWorldPos[2];
    } else if (speaking === 'grandpa') {
      wx = GRANDPA_WORLD_POS.x;
      wy = GRANDPA_WORLD_POS.y;
      wz = GRANDPA_WORLD_POS.z;
    } else {
      const zone = ZONES.find((z) => z.id === speaking);
      if (!zone) {
        bubbleAnchor.visible = false;
        return;
      }
      const a = rad(zone.angleDeg);
      wx = Math.sin(a) * ZONE_RADIUS;
      wy = HEAD_OFFSET_ZONE;
      wz = Math.cos(a) * ZONE_RADIUS;
    }

    v.set(wx, wy, wz).project(camera);
    // Behind the camera -- projecting would flip to the wrong side of the
    // screen; just leave the bubble at its last known good spot.
    if (v.z > 1) {
      bubbleAnchor.visible = false;
      return;
    }
    const screenX = (v.x * 0.5 + 0.5) * size.width;
    const screenY = (1 - (v.y * 0.5 + 0.5)) * size.height;
    bubbleAnchor.centerX = screenX;
    bubbleAnchor.bottom = size.height - screenY + BUBBLE_GAP;
    bubbleAnchor.visible = true;
  });

  return null;
}
