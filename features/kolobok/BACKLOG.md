# BACKLOG.md — open items from live device review

Not a spec doc -- a running list of user-requested fixes/features called
out during on-device testing, captured here so work survives a switch to a
different PC/session. Check items off (or delete them) as they land; add
new ones the same way rather than losing them in chat history.

Dated 2026-07-21. File/line references below point at the state of the
code as of that session -- verify they still apply before trusting them.

## Open items

1. **Animal wet-shake**: when hit by rain/snow, animals (Bear/Fox/Hare/Wolf,
   `src/scene/characters/`) should play a shake-off animation (side-to-side
   body wiggle) while it's raining/snowing on them, throwing off water/snow
   drops. Needs a "is it currently precipitating on me" signal -- probably
   just `atmosphereLive.rainT`/`snowT` > threshold, gated per-animal so they
   don't all shake in lockstep (stagger via a per-animal timer/phase).

2. **Tree grab/release spring**: trees (`src/scene/Vegetation.jsx`) should be
   "firmly attached at the base" but grabbable-feeling -- when
   pulled/released they spring. This may already be partly covered by the
   Kolobok<->tree collision spring-back (base-anchored pivot + sideways
   push, see `applyCollisionMatrix`) -- re-check on device whether that
   reads as "grab and release" or whether a genuine tap-and-drag interaction
   is wanted here instead.

3. **Stronger rain + puddles**: `src/scene/WeatherSystems.jsx` rain system
   (`RAIN_COUNT`, streak sprites) -- increase density/visual weight, and add
   a puddle system (a handful of flattened reflective-ish disc decals that
   fade in while raining, persist briefly after, fade out -- similar
   lifecycle to the ground-mist "10 min after rain ends" rule already there).

4. **Birth-chapter forward-then-snap-back bug**: right after spawning,
   Kolobok rolls forward some distance then jumps sharply backward -- a real
   bug, not intended. Likely in `src/scene/storyChapters.js` `buildBirth`
   (the COOKING_DELTA-shifted timeline) or the birth->road angle handoff --
   check `storyMotion.kolobokAngle` easing around the jump-off-the-sill and
   settle-back-to-izba-angle steps (`at: 6600+COOKING_DELTA` block) for a
   sign/direction mismatch.

5. **Fox-catch VFX**: when Kolobok is eaten, add rays of light radiating
   outward (~4 Kolobok-radii reach) plus a smoke puff where he was, smoke
   dissipating after a few seconds. Lives in `foxCatchSteps()` in
   `src/scene/storyChapters.js`, around the gulp/fade beat.

6. **Willow instead of birch in water**: a willow variant (drooping canopy)
   growing AT the pond's edge, replacing/supplementing a birch there.
   Probably a new tree-part builder in `src/scene/PondAndGrandpa.jsx` or a
   willow-specific geometry added to `Vegetation.jsx`'s birch builder,
   positioned at the pond rim.

7. **Grass over the bridge/road seam**: where the wooden bridge
   (`src/scene/PondAndGrandpa.jsx`, `bridgeParts`) meets the dirt path
   (`src/scene/Island.jsx`, path ring gap), the seam should be covered with
   grass so it doesn't read as a hard cut.

8. **Collision should persist while overlapping, not fire once**: tree
   collision (`src/scene/Vegetation.jsx`, birch/spruce bend-state) currently
   triggers once on entry and runs its own fixed-duration spring regardless
   of whether Kolobok is still touching it. Change to: reaction continues
   /re-triggers for as long as the objects are still intersecting, only
   settling once they've actually separated.

9. **Crossroads stone rework** (bigger item, see also the parked "signpost"
   idea below): boulder should be bigger/heavier at its base (like a real
   boulder, not a uniform blob) -- `src/scene/CrossroadsStone.jsx`
   `boulderGeometry`. The three menu plaques should sit in carved grooves at
   three height levels on a STATIONARY stone; the plaques/buttons themselves
   move in a circular path behind the camera as they "rotate" through
   view, with dust spilling from the grooves/joints as they move. This is a
   substantial redesign of `CrossroadsStone.jsx`'s current model (stone
   itself yaws to face the camera; this would flip it to stone-static,
   buttons-orbiting).

10. **Tap-to-interrupt only when not already in dialogue**: tapping a
    character should never interrupt the autoplaying tale -- it should only
    play a tap/greeting animation, and ONLY when that character isn't
    currently mid-encounter-dialogue. Related to the recent
    `orbit.lookingAway` camera change (dragging no longer pauses the story);
    this is the equivalent fix for TAPS specifically. Check
    `EncounterDirector.jsx` / `StoryDirector.jsx`'s encounter-interrupt
    effect (`if (encounter && !encounter.story && story.mode === 'playing')
    stopStory('paused')`) -- likely needs to become "play a quick tap
    reaction, don't stopStory" when a tale is already playing.

11. **Kolobok dust kick** -- DONE this session (`src/scene/DustTrail.jsx`,
    POLISH_SPEC §4). Re-verify on device it actually reads as "blown by the
    wind" (currently the puffs just rise+fade, no wind-drift lateral
    motion applied -- consider adding `wind.direction`-scaled drift to
    match the ground-mist/pollen convention).

12. **Trees must not grow out of the road**: placement (`scatterAngles` /
    `scatterNonOverlappingTrees` in `src/scene/builders/placement.js`) needs
    a keep-clear band around `PATH_RADIUS` (currently only checks distance
    from landmark centers, not from the path ring itself) -- trunks
    shouldn't spawn ON the path, though overhanging canopy/branches across
    it are fine.

13. **Grass density**: increase `GRASS_COUNT` (`src/scene/Vegetation.jsx`,
    currently 80) further.

14. **Kolobok eyelids look wrong**: currently read as "protruding sticks"
    rather than arched lids. `src/scene/Kolobok.jsx` eyelid mesh is a
    partial-sphere shell (`sphereGeometry(..., 0, PI*2, 0, PI/2)`) -- needs
    an actual arch/brow-ridge shape reworked, likely a flatter curved arc
    profile rather than a hemisphere slice.

15. **Tree shadows**: blob shadows exist for Kolobok/animals/landmarks
    (`src/scene/BlobShadow.jsx`, POLISH_SPEC §1) but NOT for
    birch/spruce -- add blob shadows under the foreground trees too.

16. **A few random potholes + small hills**: sparse terrain variation on
    the main island ground (`src/scene/Island.jsx`), weather-reactive
    (e.g., potholes fill with water/reflect during rain, dust/dry look
    otherwise). Keep it sparse ("just a few"), not a full terrain system.

17. **Reeds shouldn't press into the bridge**: reed placement
    (`src/scene/PondAndGrandpa.jsx`, `reedParts`) needs to keep clear of the
    bridge's footprint (around `BRIDGE_ARC_HALF_DEG`/local Z near the path
    crossing), same idea as the existing Grandpa-stump keep-clear check.

## Parked (explicitly "for later, not now")

- **Crossroads signpost redesign**: replace the stone with a signpost;
  instead of a fixed menu, three buttons rotate with a delay toward the
  viewer's position with springy movement. (Partially superseded/merged
  into item 9 above, which the user described in more concrete "grooves +
  orbiting buttons" terms on the same stone base -- reconcile the two
  before implementing either.)
