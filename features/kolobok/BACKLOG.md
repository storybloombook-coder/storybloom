# BACKLOG.md — open items from live device review

Not a spec doc -- a running list of user-requested fixes/features called
out during on-device testing, captured here so work survives a switch to a
different PC/session. Check items off (or delete them) as they land; add
new ones the same way rather than losing them in chat history.

Dated 2026-07-21. File/line references below point at the state of the
code as of that session -- verify they still apply before trusting them.

## Open items

1. ~~**Animal wet-shake**~~ -- DONE, confirmed on device against real rain.

2. ~~**Tree grab/release spring**~~ -- DONE, scoped down from a live
   continuous drag to press-to-pull/release-to-spring (see below for why).
   Confirmed "okay-ish" on device -- user flagged it may get revisited later
   but not blocking, move on for now.

3. ~~**Stronger rain + puddles**~~ -- DONE (this backlog entry was stale;
   already implemented). `src/scene/WeatherSystems.jsx`: `RAIN_COUNT` bumped
   220 -> 380; a 6-spot puddle system (`PUDDLE_SPOTS`, kept clear of zone
   landmarks/pond) plus pothole puddles (BACKLOG #16) share one `wetness`
   ramp that fills fast while raining and drains slowly after.

4. ~~**Birth-chapter forward-then-snap-back bug**~~ -- DROPPED, user said
   "keep as it is." Not investigating further.

5. ~~**Fox-catch VFX**~~ -- DONE (`src/scene/KolobokParticles.jsx`: light-ray
   instancedMesh + smoke `points`, triggered via `storyMotion.catchBurstId`
   bumped at the gulp beat in `foxCatchSteps()`, `src/scene/storyChapters.js`).
   Rays originate from Kolobok's position, 8-10 per burst at randomized
   angles (re-rolled each trigger, not evenly spaced). Confirmed on device.

6. ~~**Willow instead of birch in water**~~ -- DONE (`src/scene/PondAndGrandpa.jsx`
   `willowGeometry`: trunk + squashed canopy sphere + 12 seeded drooping
   fronds, own mesh/draw call so it can carry its own vertex colors
   independent of `matteGeometry`). Placed at local `[1.9, 0, 0.75]`,
   roughly opposite Grandpa's stump, just outside the water rim's max
   wobble radius. Confirmed on device.

7. ~~**Grass over the bridge/road seam**~~ -- DONE (`src/scene/Island.jsx`:
   moss clumps, not grass tufts -- live feedback preferred rounded mossy
   bushes). Two systems: `usePathEdgeMossMatrices` hugs both edges of the
   path ring all the way around the island (skipping the bridge-gap arc),
   and `useBridgeSeamMossMatrices` spans the path's FULL width right at the
   two seam angles where the bridge deck meets the path. Confirmed on
   device.
   - **Bonus fix, found while testing this**: the distant background
     treeline (`src/scene/BackgroundForest.jsx` `makeTreeSpriteTexture`)
     was reported upside-down. After a lot of thrashing on the wrong
     theory (`texture.flipY`, `PlaneGeometry`-UV mapping, row-reversal --
     none of which were it), the actual fix was much simpler: revert the
     pixel-buffer index to the original `o = (y * w + x) * 4` -- the bug
     had been introduced by an earlier edit, not present in the true
     original code. Confirmed fixed on device.

8. ~~**Collision should persist while overlapping, not fire once**~~ -- DONE
   (`src/scene/Vegetation.jsx`, birch + spruce blocks). While overlapping,
   holds at full push (direction re-tracked every frame) instead of
   running a fixed-duration spring that could settle to zero mid-overlap;
   the spring-back/settle only starts once they've actually separated.
   Confirmed on device.

9. ~~**Crossroads stone rework**~~ -- DONE for now, user said "keep it as is,
   move to the next item" (`src/scene/CrossroadsStone.jsx`, several live-
   feedback rounds). Landed: stone is STATIC (no longer yaws to face the
   camera); the three plaques live in their own rotating `plaqueGroupRef`
   column that chases the camera instead; each plaque is a curved
   cylinder-wall panel (not a flat box) sized to its own radius via a
   lathe-style `RADIUS_PROFILE` (wide bulge near the base, narrower waist,
   narrower still near the top -- base is deliberately wider than the
   middle, per live feedback); grooves are recessed directly into the
   boulder's own geometry (not a floating ring) with a dark accent torus
   sitting slightly BEHIND each plaque's radius; dust spills continuously
   while the column is actively rotating, not just on tap; labels widened
   (176px texture) to stop clipping ("Create a Story" was showing as "EATE
   A STO"); buttons sized +50% per request. Not pixel-perfect against the
   reference boulder photo the user shared, but confirmed acceptable to
   move on -- revisit proportions/contrast later if it comes up again.

10. ~~**Tap-to-interrupt only when not already in dialogue**~~ -- DONE.
    `StoryDirector.jsx`'s encounter-interrupt effect no longer calls
    `stopStory('paused')` at all -- a tap's own encounter beat (still the
    normal approach/react/greeting reaction) now plays underneath the
    autoplaying tale, which keeps ticking (narration still wins the shared
    bubble slot over `encounter.line`, so no visual clash). `ZoneLandmarks.jsx`
    and `Kolobok.jsx`'s own tap handlers both gained a guard
    (`if (encounter?.id === zone.id) return;`) so tapping a character
    that's already mid-dialogue -- including the tale's OWN scripted visit
    to that same zone (`encounter.story === true`) -- is a no-op instead of
    overwriting/desyncing it. Confirmed on device: tapped an animal mid-
    narration, story kept playing (narration text + pause button unchanged).

11. ~~**Kolobok dust kick**~~ -- DONE, confirmed on device (`src/scene/DustTrail.jsx`
    POLISH_SPEC §4). Puffs now drift with `wind.direction`/`wind.strength`
    (same convention as GoldenHourExtras' pollen) instead of just rising
    in place. Live feedback also asked for the wind to visibly affect
    trees and chimney smoke too -- both added in the same pass:
    `Vegetation.jsx`'s birch/spruce now sway ambiently via `windSway()`
    (`TREE_SWAY_AMPLITUDE`, much smaller than grass's) whenever not
    actively being pushed by Kolobok, and `ZoneAmbience.jsx`'s chimney
    smoke leans downwind as it rises (drift scales with `p.t`, same
    `wind.direction`/`wind.strength` convention). Confirmed on device.

12. ~~**Trees must not grow out of the road**~~ -- DONE. `placement.js`'s
    `scatterNonOverlappingTrees` now rejects any candidate radius within
    `PATH_HALF_WIDTH + 0.15` of `PATH_RADIUS` (both now shared constants
    from `zones.js`, along with a new `POND_RADIUS`, so Island.jsx's own
    ring geometry can't drift out of sync with the keep-clear check).
    Also added a pond keep-clear (a spruce had spawned right at the
    water's edge) and, per live feedback, THREE deliberate hand-placed
    exceptions in `Vegetation.jsx`'s `SPRUCE_PLANTS`: two "roadside"
    spruces (different sizes) positioned to overlap the path just enough
    that Kolobok reliably brushes/pushes them, and one "pondside" spruce
    near the willow, just off the water's edge. Confirmed on device.

13. ~~**Grass density**~~ -- DONE. `GRASS_COUNT` 80 -> 112, flower count
    16 -> 23 (`src/scene/Vegetation.jsx`) per live feedback "grass with
    flowers a little thicker". Confirmed on device.

14. **Kolobok eyelids look wrong**: currently read as "protruding sticks"
    rather than arched lids. `src/scene/Kolobok.jsx` eyelid mesh is a
    partial-sphere shell (`sphereGeometry(..., 0, PI*2, 0, PI/2)`) -- needs
    an actual arch/brow-ridge shape reworked, likely a flatter curved arc
    profile rather than a hemisphere slice.

15. ~~**Tree shadows**~~ -- DONE. `Vegetation.jsx` gained two instanced flat
    blob shadows (birch + spruce, one draw call each), ground-anchored and
    static (the collision lean pivots from the tree's own ground point, so
    the shadow never needs to move even mid-spring), sharing BlobShadow.jsx's
    texture/look via a newly-exported `getSharedTexture()`. Live feedback:
    all shadows bumped 15% deeper (`BlobShadow.jsx` default opacity
    0.28->0.322, tree shadows 0.24->0.276) -- one shared bump since
    BlobShadow.jsx is every other shadow's single source of truth. Also
    added a Kolobok-specific ground shadow (he had none): pinned to world Y
    ~0.02 every frame (counteracts root's own idle-bob/roll-bounce/hop/sing-
    bob Y so it doesn't float with him), shrinks/fades slightly at hop apex
    for a contact-shadow feel, hidden during posOverride story beats
    (windowsill/snout) where there's no ordinary ground below. Confirmed on
    device.

16. **A few random potholes + small hills**: sparse terrain variation on
    the main island ground (`src/scene/Island.jsx`), weather-reactive
    (e.g., potholes fill with water/reflect during rain, dust/dry look
    otherwise). Keep it sparse ("just a few"), not a full terrain system.

17. ~~**Reeds shouldn't press into the bridge**~~ -- DONE, confirmed on
    device ("all good"). `src/scene/PondAndGrandpa.jsx`: precomputed
    `BRIDGE_LOCAL_POINTS` (the bridge centerline sampled in pond-local space
    via the existing `bridgeWorldToLocal`, same points `bridgeParts` uses)
    and added a keep-clear in `reedParts` -- a candidate reed is rejected if
    it lands within `BRIDGE_CLEARANCE` (0.6) of any bridge point in the
    local XZ plane, same shape as the existing Grandpa-stump reject.

## Parked (explicitly "for later, not now")

(none currently -- Crossroads signpost redesign was dropped, superseded by
item 9's stone-with-orbiting-plaques rework.)
