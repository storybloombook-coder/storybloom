# STORY_SPEC.md — autoplaying story mode ("the tale tells itself")

The scene has two modes. **Story mode** (default on launch): a director plays
the complete Kolobok fairytale as a continuous ~64 s loop — Kolobok is born at
the izba, rolls around the island meeting each animal, is "caught" by the fox,
and is reborn at Grandma's oven, forever. **Free mode**: the existing behavior
— user swipes the camera, Kolobok follows, taps trigger encounters and
navigation. Any user input during the story hands control back gracefully;
idleness hands it back to the story.

## 1. Architecture

### Control inversion
- Free mode (existing): gestures drive `orbit.angle`; Kolobok chases the
  camera (`followCamera` drive).
- Story mode: the director drives Kolobok's path angle directly (`scripted`
  drive); the CAMERA chases Kolobok at `kolobokAngle - LEAD` with the same
  soft lag. Same math, inverted leader. Implement as
  `orbit.mode: 'user' | 'story'` on the transient object; `CameraRig` and
  `Kolobok` branch on it.

### New pieces
- `src/scene/StoryDirector.jsx` — mounts inside the Canvas; owns a chapter
  state machine ticked in `useFrame`; composes chapters from the timeline
  helper (`scene/timeline.js`). No React state per frame; chapter index and
  play state live on a transient `story` object exported from
  `state/sceneStore.js`:
  `story = { mode:'idle'|'playing'|'paused'|'off', chapter:0, idleClock:0 }`.
- Store additions (discrete): `narration: string|null` (narrator/dialogue
  line for the overlay bubble), `storyPlaying: boolean` (UI reacts: hint text
  changes, menu buttons dim to 60% opacity during story), actions
  `setNarration`, `setStoryPlaying`.
- Encounter timelines from ANIMATION_SPEC §4–5 accept `{ story:true }`:
  story variants use the STRINGS.md narration lines. (Since the navigation
  restructure, NO encounter navigates in any mode — navigation lives only
  on the crossroads stone.)
- `MainScreen.jsx` overlay gains a small circular button, bottom-right,
  40×40, accessibilityLabel "Play the tale": ▶ when story is off/paused,
  ❚❚ while playing. Manual control of the same state machine.

### Mode transitions
- Story mode exists only when `sceneMode === '3d'` (SPEC.md "Scene
  modes"); switching to flat tears the director down with the scene.
- Launch: after `sceneReady` + 1.5 s of no input → story starts at chapter 0.
- Any pan > 12 px, any tap on scene/landmarks, or a menu-button/plaque press →
  `interrupt()`: the current timeline cancels via the standard cancel path
  (actors `returnToIdle` over 300 ms, bubble fades, camera radius restores),
  `orbit.mode = 'user'`, `story.mode = 'paused'`. The gesture that caused the
  interrupt is honored immediately (the swipe pans, the tap starts its
  normal interactive encounter).
- Idle 8 s in free mode (no gestures, no running encounter, no pending
  navigation) → story resumes **from the start of the chapter that was
  interrupted** (never mid-beat). Before resuming, the camera glides to the
  chapter's start framing over 900 ms `easeInOutSine`.
- Stone-plaque/menu-button navigation or `pendingNavigation` → `story.mode = 'off'` until the
  screen regains focus, then treated like launch.
- Sleep mode (ANIMATION_SPEC §6) never triggers while the story plays —
  the story IS the idle behavior. The 10 s sleep timer only runs when
  `story.mode === 'off'`.

## 2. The loop at a glance (~64 s)

| # | chapter        | span (s) | camera |
|---|----------------|----------|--------|
| 0 | Birth          | 0–8      | pushed in on the izba, radius 11 |
| 1 | First road     | 8–13     | trailing, radius 13 |
| 2 | Hare           | 13–21    | push to 12.2 |
| 3 | Road           | 21–25    | 13 |
| 4 | Wolf           | 25–33    | 12.2 |
| 5 | Road           | 33–37    | 13 |
| 6 | Bear           | 37–45    | 12.2 |
| 7 | Road           | 45–49    | 13 |
| 8 | Fox finale     | 49–61    | slow push 12.2 → 10 |
| 9 | Rebirth        | 61–64    | cut (via black) back to izba framing, then loop to chapter 1 pacing |

Roads move Kolobok 72° in ~4.5 s (≈ 0.28 rad/s — brisk but readable), with
the bouncy-roll treatment from ANIMATION_SPEC §2 and occasional happy blinks.
During roads, every ~2 s spawn 3 song-note particles: he hums as he rolls.

## 3. Chapter scripts (times local to chapter, ms)

Dialogue below is the story variant; interactive encounters keep their
ANIMATION_SPEC lines. All bubbles display via `narration`.

### Chapter 0 — Birth (8 s)
| at | dur | action |
|----|-----|--------|
| 0 | 800 | Izba window emissive pulses to 1.6 regardless of time of day; chimney smoke rate ×2 |
| 400 | — | Narration: "Grandma scraped the flour bin and baked a little round bun..." |
| 1600 | 500 | Kolobok pops into existence on the windowsill point (izba angle, offset toward path, y+0.9): scale 0→1 `easeOutBack` |
| 2400 | 1200 | He looks around: face yaw −20° → +20° `easeInOutSine`, two blinks |
| 3800 | — | Narration: "...and set him on the windowsill to cool. But Kolobok had other plans." |
| 4600 | 700 | Windowsill wobble: body tilt ±6° twice, brows `sly` |
| 5600 | 700 | The jump: arc from sill to path point (h 0.5 above straight line), landing squash 30% for 150 ms, dust puff (6 gray particles) |
| 6600 | 1000 | Settles to `happy`, one proud 360° spin, rolls off — blend into chapter 1 speed |

### Chapters 2/4/6 — Hare / Wolf / Bear (8 s each)
Run the shared encounter timeline (ANIMATION_SPEC §4) with
`{navigate:false, story:true}`, stretched: multiply all `at`/`dur` by 1.45
so the beat breathes at cinematic pace (3300 ms → ~4.8 s), then pad with:
| +4800 | 1600 | Animal returns to idle; Kolobok rolls a few degrees, stops, turns his face back toward the animal, one cheeky blink |
| +6400 | 1600 | Narration: "And on he rolled — from <Grandma/the Hare/the Wolf> he'd gotten away..." (cumulative brag, per chapter) |

### Chapter 8 — Fox finale (12 s). The one time the tale wins.
| at | dur | action |
|----|-----|--------|
| 0 | 500 | Fox glides out, tail ×1.6 sway; narration: "But by the fox clearing sat someone very polite..." |
| 800 | — | Fox: "What a lovely song! Come closer, dear — I can't quite hear." |
| 1800 | 800 | Kolobok rolls to 0.5 in front of her, sings (open mouth, bob, notes) |
| 3400 | — | Fox: "Closer still, sweet thing... sit right on my nose." |
| 4400 | 900 | Kolobok hops onto her snout (arc to snout position, tiny wobble balance: tilt ±5° at 3 Hz) |
| 5800 | 600 | Fox tosses him up 0.9 (`easeOutCubic` up), head tilts back, mouth-open scale pulse |
| 6400 | 300 | Gulp: Kolobok scale 1→0 into the snout; screen fades to black over 300 ms (RN overlay) |
| 6900 | — | Narration on black: "...and SNAP! That is how the tale goes." |
| 8400 | — | While black: reset Kolobok + camera to izba framing; restore fox to idle |
| 8900 | 900 | Fade in; izba window glows; smoke puffs |
| 9800 | 1400 | Narration: "But Grandma just smiled — and baked another." Kolobok pops on the sill `easeOutBack` |
| 11200 | 800 | Hold, then loop → chapter 1 (skip the full birth after the first cycle; every 4th loop play chapter 0 in full) |

## 4. Reuse and consistency rules

- The fox easter egg (ANIMATION_SPEC §7) and the finale share the
  gulp/fade/rebirth beats — implement once as `foxCatchSequence(opts)` and
  parameterize the framing and narration.
- Haptics fire in story mode ONLY for the gulp (`impactAsync(Heavy)`) and
  rebirth pop (`notificationAsync(Success)`) — the story should feel watchable,
  not buzzy.
- Story narration bubble style: same bubble, but add a thin `#d9a441`
  left-accent border so narration reads distinct from interactive dialogue.
- All story motion respects reduced-motion: if the OS accessibility setting
  `isReduceMotionEnabled` (react-native AccessibilityInfo) is true, story
  mode does not autoplay; the ▶ button still allows manual play.

## 5. Acceptance criteria (story phase)

- Cold launch with no input: full loop plays, chapter timings within ±10%
  of the table in §2, and loops seamlessly.
- Swiping at ANY point during ANY chapter returns control within 600 ms
  with no stuck poses, orphaned bubbles, or camera jumps.
- 8 s of idleness resumes the story at the interrupted chapter's start with
  the 900 ms camera glide.
- Tap-encounters (interactive or story) never navigate; the crossroads stone plaques and their overlay twins always do, even mid-story (stone tap = interrupt + navigate).
- ▶/❚❚ button reflects and controls state; reduced-motion disables autoplay.
