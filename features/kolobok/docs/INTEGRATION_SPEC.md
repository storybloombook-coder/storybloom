# INTEGRATION_SPEC.md — the scene earns its job (Phase 11)

Three features that connect the fairytale to the host app's real function
and to sharing: the messenger magpie (badges), photo mode, and the egg
tally. All host-facing via props; the package stays router- and
storage-agnostic.

## 1. Messenger magpie (badges → navigation)

The folk mail carrier: сорока (magpie). When the host app has something
waiting, she delivers.

- **Prop**: `badges: { [menuId]: boolean | number }` on MainScreen (e.g.
  `{ two: 3 }`). Clearing badges is the host's job (pass updated prop).
- **Magpie model** (ART-style, ≤ 500 tris): ridge-bird build ×1.2, black
  `#22262b` with white belly + wing patches `#efeeea`, long tail (flat box
  0.18). Carries a letter: white quad 0.07×0.05 in the beak while any
  badge is UNSEEN.
- **Behavior**: on first appearance of any badge → she flies in from the
  background treeline over 1.6 s (two-flap glide) and lands on the
  crossroads stone's crown; idle: tail flicks ±12° every ~4 s, head tilts.
  The plaque of each badged menu gets a glowing dot (sphere r=0.025,
  emissive matching that menu's accent, 1.2 s pulse) at its corner; if the
  badge is a number ≤ 9, stamp it on the dot with the bitmap font.
  When ALL badges clear → she flies off with the letter gone.
- **Tap**: tapping the magpie plays a two-hop + wing-flutter (500 ms), then
  `requestNavigation(route of the highest-count badge)`. Plaque taps work
  as normal. Sound: `blip` rate 1.2; egg-style light haptic.
- **Overlay twins**: the three pill buttons show standard RN badge dots
  (accessibility: label appends ", N new" / «, N новых»).
- Story mode: magpie still lands (badges outrank theater), but the story
  does not pause for her.

## 2. Photo mode

- **Enter**: camera icon (top-left, 44pt, strings `ui.photo` EN "Photo" /
  RU «Фото»). UI overlay fades out 250 ms (except a shutter button, an
  exit ×, and nothing else); story pauses; idle camera breath stays on.
- **Framing controls**: existing orbit swipe + pinch-to-zoom mapping to
  orbit radius 9–16 (reanimated pinch, clamp + rubber-band at ends) +
  the gyro parallax. Vignette stays (it flatters).
- **Shutter**: `GLView.takeSnapshotAsync` (the fiber-native canvas exposes
  the underlying GLView; capture at device resolution) → share via
  `expo-sharing.shareAsync(uri)`. Haptic `impactAsync(Medium)` + a 120 ms
  white flash View at opacity 0.6. No watermark by default;
  `photoWatermark` prop can enable a small bottom-right bitmap-font
  "Kolobok" stamp.
- **Exit**: × or Android back → UI fades back, story resumes per its
  normal idle rules.

## 3. Egg tally (the quiet collector's itch)

- The BACK of the crossroads stone (the face away from the plaques) gets a
  small carved tally plaque 0.4×0.16: bitmap-font "N / 8" with emissive
  0.25 — discoverable only by someone who spins the camera to look behind
  the stone. No UI, no popups, ever.
- Count = unique eggs discovered this install. Source of truth:
  `foundEggs: string[]` prop (host persists; updates flow in), combined
  with this session's in-memory finds; `onEasterEgg(id)` already reports
  new finds out.
- At 8/8 the plaque's carve turns gold `#ffd27a` and one sparkle burst
  plays the first time it's SEEN at 8/8 (camera facing the stone's back).

## 4. Acceptance
- Setting/clearing the `badges` prop flies the magpie in/out, dots the
  right plaques with correct counts, and her tap navigates to the
  highest-count route; overlay buttons show accessible badge labels.
- Photo mode captures at device resolution and opens the OS share sheet;
  story pause/resume around it is clean; Android back exits.
- Tally shows persisted + session finds, renders in bitmap font, and the
  8/8 gold moment fires exactly once per install.
- All three features dead-code-eliminate cleanly in flat mode (no GL, no
  magpie, but overlay badge dots on the pill buttons still work).
