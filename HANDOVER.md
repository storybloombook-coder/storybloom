# Storybloom — Handover

_Snapshot for picking up on another machine / another day. **Update this file
every time you commit + push meaningful work** — it's the first thing a fresh
session (or a fresh PC) should read. Keep it a CURRENT-STATE doc, not a
diary: fold facts into the sections below rather than stacking a new dated
essay on top — see "Open questions" for anything not yet verified._

- **Branch:** `feat/ondevice-vision-tesseract` (NOT `main` — main is far behind).
- **Everything is committed + pushed.** Latest: see `git log -1`.
- **To set up + run:** see **[SETUP.md](./SETUP.md)** (clone, `.env`, Vosk models, dev-client build, connect).

---

## Where the app is right now

The full loop works end to end, **fully on-device** (no cloud, no keys):

**capture → prep → library → per-page edit → readiness check → read aloud**

**Working:**
- **Capture/import** — photos + PDF, per-page crop/rotate editor, drag-reorder,
  add-more-pages, dictation (speak a story instead of photographing one).
- **Prep (on-device)** — Tesseract OCR (per the book's chosen language) + a local
  bilingual (EN/RU) trigger matcher assigns ambient + keyword cues. Tolerates
  common English inflections (`bark` also matches `barked`/`barking`). A
  dev-only debug readout shows raw OCR text + confidence + matched cues.
  **Confirmed working on real EN + RU camera photos** — English needed the
  "Re-scan area" crop tool to cut illustration-text noise; that's the fix,
  not a Tesseract quality problem.
- **Library** — rich cards (cover, counts, status, badges), **favorites ⭐**
  (star centered over the ▶ Play button, both fixed 36x36), a **▶ Play
  button** (bottom-right, soft-tint) that jumps straight into the Reader, an
  inline **"⚠️ N" readiness chip** that opens a "what's missing" sheet
  deep-linking to the page that needs fixing, **swipe left → delete bin**
  (with a confirm-delete bottom sheet, haptic tick at the open threshold),
  pull-to-refresh. A physical **Bookshelf** of favorited books sits above the
  list — tilt-gravity (via `expo-sensors`' Accelerometer), a drag-to-reorder
  physics system, spines at a fixed size (never shrink/scroll to cram more
  in); once more books are favorited than fit one shelf, the rest spill onto
  additional numbered shelves switched via a selector below (1, 2, 3…).
  Lifting a book off the shelf (drag it up) can visibly clip against the
  shelf's own scrollable-list boundary near the top of its range — known,
  accepted tradeoff (a tried fix that reserved growing/shrinking space above
  the shelf looked worse than the clipping itself, so it was reverted). The
  manual approval workflow (unreviewed/in_progress/approved,
  swipe-right-to-approve) was removed — the readiness gate already signals
  whether a book plays back well, so approval was a redundant second step.
  The `review_status` column/type are still in the schema (no migration) but
  nothing reads or writes them anymore.
- **Book detail** — per-page inspector, tap the title to rename, drag-reorder
  pages (long-press: neighbors visibly slide apart to preview the gap, a
  gentle no-bounce settle on drop), **swipe a page left → delete bin** (same
  confirm-delete pattern as the library), add pages, and a pinned
  **readiness gate + ▶ Read** bar (green "Ready" or amber "N things to
  check" with an expandable checklist; tapping "Ready" opens a popup
  summarizing what was checked). `DraggablePageCard`/`SwipeableRow` nesting
  is order-sensitive — see Gotchas if touching either.
- **Page editor** — tap a word to attach/remove a sound; correct OCR text;
  "Re-scan area" (crop → re-OCR just that region); record/trim/fade custom
  sounds per word; ambient play/stop toggle; ambient **loops its trim
  range** (both in the Reader and this editor's preview); an **"Apply to
  all pages"** toggle (styled as a tall 1x2 pill, top-left of the
  library/play/record/remove action grid) sets the current ambient on the
  whole book in one tap; recordings are **named and saved to a reusable "My
  recordings" library**, not just the one cue they were made for — the
  name defaults to the word/target recorded over, pre-filled but editable.
- **Sound picker** — a collapsible **"My recordings" section** at the top
  (your own named recordings, preview + reuse), search bar (by id or trigger
  word), a "Suggested" section ranked by relevance to the tapped word, the
  114 effects grouped into a collapsible category tree, and a **play/stop
  preview button on every row**.
- **My Recordings (Library screen's second header tab)** — a full browsing/
  management surface for every saved recording: search by name, filter by
  All/Ambient/Sounds, swipe-to-delete, tap to rename, and **Record an
  Ambient**/**Record a Sound** buttons to pre-make a clip with no page
  attached yet. Tapping a recording's 🎚️ icon reopens the editor to
  re-trim/re-fade it, or re-record it entirely (replaces the file, not just
  the envelope — `db.updateRecordingTrim()`).
- **Reader (`/read/[id]`)** — the payoff screen, and where milestone 7
  (speech recognition) landed: on-device Vosk **listens as you read aloud**,
  aligning recognized words against the page's known OCR text and firing
  cues itself (partials AND finals both drive alignment, for latency);
  saying "next page"/"следующая страница" turns the page hands-free
  (final-result-only + a cooldown, see Gotchas); the recognizer is
  grammar-constrained to the book's own vocabulary for accuracy, and now
  also **confidence-aware** — a word Vosk itself wasn't confident about
  (below 0.5, finals only — see Gotchas' patch-package entry) doesn't get
  trusted to move the cursor. A word can be tapped directly to fire it
  manually, or to jump the read position there (fix a bad auto-alignment
  jump, or reread a passage) — same effect as dragging the small
  **bouncing ball** that hops to sit above the most-recently-read word.
  Ambient bed fades in, loops per page, and **ducks to a low murmur while
  listening** (was feeding back into the same mic at full volume). Next/Back
  page turns; end screen offers Read again or Done.
- **Sound library** — 115 effects + 18 ambient, all real CC0 audio from
  Freesound, loudness-normalized (effects −16 LUFS, ambient −23 LUFS) with a
  short fade in/out. Voices (8) are still synth placeholders.

**Gemini is fully removed** — vision is on-device only. If the Tesseract
native module isn't present (e.g. Expo Go), `createVisionProvider` throws a
clear error instead of falling back.

**Dev/prod app separation** — the dev-client build has its own Android
package (`com.storybloom.app.dev`, name "**Storybloom Testing**", a
yellow-tinted icon) via `app.config.js` + `APP_VARIANT=development` (set in
`eas.json`'s `development` profile). It installs as a genuinely separate app
from any preview/production build permanently — they used to share
`com.storybloom.app` + the same signing key, so installing one silently
overwrote the other.

**Repo cleanup (2026-07-17):** removed `PdfImporter.tsx` (orphaned — PDF
import has been disabled since way back, see `add-book.tsx`'s `pickFile()`)
and 7 unused deps with zero references anywhere: `expo-camera` (the app
actually uses `expo-image-picker`'s camera launcher), `expo-document-picker`,
`@react-native-community/slider`, `expo-web-browser`, `@expo/ui`,
`expo-glass-effect`, `react-native-webview`. Deleted the fully-superseded
`CHANGES-TODO.md`; added a SUPERSEDED banner to `review-flow.md` (the manual
review screen it describes was replaced by the readiness gate — kept only
because "Try another," a real unbuilt gap, isn't documented anywhere else).

---

## Open questions (not yet verified live)

- **Today's reader/drag fixes** — next-page cooldown, duplicate-word cursor
  fix, drag-reorder first↔last swap fix. All reasoned from code tracing, not
  yet confirmed against real speech/gestures on-device.
- **Confidence-aware alignment** — the `0.5` confidence threshold is a first
  guess, untuned against real speech. Could be too aggressive (filtering out
  correct words) or not aggressive enough. Needs a read-aloud pass with some
  genuine mis-hears to tell.
- **Vosk grammar constraint** (book-vocabulary restriction) — not yet
  live-tested with real speech.
- **Bouncing-ball row-recompute debounce (80ms)** — wants a fresh live-test
  pass; row-structure recompute during a page's word-layout burst is
  timing-sensitive (see Gotchas if it visibly mis-places a gap).
- **Offline library-sound playback on a standalone (non-dev) build** — open
  across multiple sessions now, never confirmed either way. Install the
  latest preview/production build (NOT a dev client), go fully offline, tap
  a word with a matched effect.
- **A full multi-page book read-through** with the readiness gate + Reader
  end-to-end — only tested piecemeal so far.

---

## Latest dev-client build

Package `com.storybloom.app.dev`, name "Storybloom Testing" — installs
alongside any existing `com.storybloom.app` build, does not overwrite it.

- **Build:** https://expo.dev/accounts/alexstorybloom/projects/Storybloom/builds/05a71b4c-adc4-4bb4-9369-e6511e7276b5
  (includes confidence-aware alignment + all four 2026-07-17 reader/drag fixes)
- **Direct APK:** https://expo.dev/artifacts/eas/kZUls0seG2o6FIubNUZL4tEuxNzgTevLylI4VYo05yQ.apk
  (expires ~2 weeks after build; rebuild via `npx eas-cli build --platform
  android --profile development` if it 404s)
- Install: `adb install -r <file>.apk`, or open the build URL/QR on the phone.
- Then `npx expo start --dev-client` — USB: `adb reverse tcp:8081 tcp:8081`,
  use `localhost:8081` in the dev-client's connect screen; Wi-Fi: scan the
  Metro QR.
- **Rebuild only after native changes** (Kotlin, gradle, `app.config.js`
  plugins/permissions, new native npm deps, or a `patches/` change). Pure JS
  + asset changes just need a Metro reload.

---

## Next steps (suggested order)

1. **Real-book testing pass** — run the readiness gate + Reader on several
   full books to shake out edge cases: multi-page ambient transitions,
   ordering of many cues on a dense page, the "what's missing" chip's
   accuracy. Doubles as verification for everything in "Open questions."
2. **Character voices (milestone 8-10)** — still deliberately deferred. Known
   gap: even the manual "Change from library" picker offers sound *effects*
   for a dialogue cue, never the 8 *voices* — intentionally left broken until
   this milestone is built (see CLAUDE.md).
3. **"Try another"** — CLAUDE.md's review flow spec calls for a second,
   distinct action from "Swap" (manual pick): auto-cycle to the next-best
   candidate sound. Never built; `candidateSoundIds`/`ambientCandidates`
   exist in the data model with no UI consumer. See `review-flow.md`.
4. **ISBN/barcode capture** — VISION.md flags this as cheap to do now (the
   future book-matching key for community sharing). 0% built — no UI, no
   capture logic.
5. **More trigger-vocab coverage** — the offline matcher still has ~60
   effect ids with no trigger words at all (manual-assign only). Expand
   `TRIGGER_VOCAB` in `src/lib/ai/soundLibrary.ts` as real books surface gaps.
6. **App size** — ~170MB of bundled assets, ~90% of which is the two Vosk
   speech models (156MB). Discussed but not decided: defer them to a
   first-use download (like Tesseract's traineddata already works) instead
   of bundling.
7. **Polish sounds** — replace the 8 placeholder voices with real recordings;
   re-fetch any dud CC0 clips as they're noticed
   (`node scripts/fetch-freesound.mjs --only=<id>`).

---

## Handy commands

```bash
npx expo start --dev-client          # run (JS hot-reloads)
node node_modules/typescript/bin/tsc --noEmit   # typecheck (see Gotchas re: plain `npx tsc`)
node scripts/fetch-freesound.mjs                    # (re)build the sound library from Freesound (needs token)
node scripts/fetch-freesound.mjs --only=fx_some_id  # re-fetch just ONE sound
node scripts/gen-placeholder-sounds.mjs             # synth placeholders for any id without audio
node scripts/normalize-sounds.mjs                   # loudness-normalize all bundled sounds (needs ffmpeg-static, temp-install it)
npx eas-cli build --platform android --profile development   # new dev-client build
npx patch-package <pkg-name>         # regenerate patches/ after editing node_modules/<pkg>
```

## Recording trim model (by design, not a bug)

Trimming a recording (word cue, page ambient, or a standalone "My
Recordings" clip) is **non-destructive** everywhere in the app:
`startMs`/`endMs`/`fadeInMs`/`fadeOutMs` are stored as a playback envelope
next to a reference to the **full original file** — nothing ever physically
cuts/re-encodes audio (see `playRange` in `src/lib/audio/playRange.ts`).
Reopening an editor always shows the full clip with saved markers restored
— confirmed with the user as the preferred behavior over adding a native
audio-encoding dependency (e.g. `ffmpeg-kit-react-native`) just to make it
destructive.

## Gotchas learned this project

- **Commit before an EAS build** — EAS doesn't upload untracked files, so new
  modules/assets silently miss the build if uncommitted.
- **Not in git (recreate per machine):** `.env`, `node_modules/`, the Vosk
  models, generated `android/`.
- **Windows file locks:** if renaming/deleting model folders hits "Access
  denied", stop Metro/`node` (the file watcher) and retry.
- **Installing/uninstalling a dev-only npm package (e.g. `ffmpeg-static`)
  while Metro is running can crash it** — Metro's file watcher throws an
  uncaught `ENOENT` on the vanished temp directory. **Always stop Metro
  first**, do the npm install/uninstall, then restart Metro (`--clear` if
  the cache looks stale).
- **adb USB connection drops silently mid-session** — if the app shows a
  white screen or stops hot-reloading, check `adb devices` before assuming
  it's a code bug; replug + re-run `adb reverse tcp:8081 tcp:8081`.
- **`npx tsc` can resolve to the wrong package** — use
  `node node_modules/typescript/bin/tsc --noEmit` if you see a "This is not
  the tsc command you are looking for" message.
- **`DraggablePageCard` must be the OUTER wrapper, `SwipeableRow` nested
  INSIDE it** — never the other way. `SwipeableRow`'s own `overflow:
  'hidden'` clips anything that moves beyond its own row's bounds; as the
  outer element, a dragged page (needs to translate OVER neighboring rows)
  and the neighbors it displaces both get clipped the instant they move
  past their own row, and the dragged card's `zIndex` stops elevating it
  above other rows. Happened once already — see git history around commit
  `f02060a` if it resurfaces.
- **Two independent Reanimated transforms animating the SAME visual motion
  at once either compound into a bounce OR cause a visible snap.** Hit this
  in `DraggablePageCard` on drop: `translateY` (raw drag offset) and
  `layout={LinearTransition}` (old-slot→new-slot bridge) are separate
  transforms acting on the same card at once; animating both independently
  (mismatched durations/easings) compounded into a hard bounce. The fix:
  keep both animated, but give them the EXACT SAME duration + easing
  (`SETTLE_DURATION`/`SETTLE_EASING`) so they interpolate as one continuous
  motion. (Neighbor cards being shifted to preview a gap are different —
  instant-zero on drop IS correct there, no sync needed.) Bare
  `layout={LinearTransition}` defaults to a bouncy spring — `.duration(ms)`
  switches it to a plain eased timing with no overshoot.
- **White screen on the dev-client** almost always means it lost its network
  path to Metro — toggle WiFi first, don't assume a code bug. A genuine JS
  crash instead shows a red LogBox toast/overlay with an actual error
  message. Also: the dev-menu's own "Tools" bubble overlay can make an
  otherwise fully-rendering app LOOK broken in a screenshot if the overlay
  itself is what's on top.
- **`ExponentImagePicker` "Attempting to launch an unregistered
  ActivityResultLauncher"** — happens after heavy JS-only reload cycling
  without the native Activity restarting. Fix: fully force-stop + relaunch
  the app, not just a dev-menu Reload.
- **PowerShell `npx` fails with "running scripts is disabled on this
  system"** — Windows execution policy blocking `npx.ps1`. Use `npx.cmd
  <pkg>` instead, or `Set-ExecutionPolicy -Scope Process -ExecutionPolicy
  Bypass` for that one terminal session (not persistent, safe).
- **EAS Robot User tokens need the robot added as an actual account
  member**, not just a token generated — a token alone doesn't grant access;
  it needs to be a genuine member of the account/org. If in doubt, skip
  robot users and just `npx eas-cli login` with a normal account.
- **The EAS `preview` build profile has no OTA update mechanism** — a fully
  frozen JS+asset snapshot from build time; every future code change needs a
  brand-new preview build to test offline. Don't assume an existing preview
  APK reflects current code — check its build date/commit against `git log`.
- **adb screenshot coordinates need scaling** — the screenshot tool's own
  image preview is scaled down from the device's real resolution; eyeballed
  tap coordinates need multiplying by the scale factor before `adb shell
  input tap`. `uiautomator dump` + grepping `bounds="[...]"` gives exact
  device-pixel coordinates directly — far more reliable than eyeballing.
- **Sensor thresholds tuned in the abstract are usually wrong** — the
  Bookshelf's tilt-gravity did nothing because a spring constant
  (`STIFFNESS=90`) was ~30x stronger than the gravity constant meant to
  fight it, capping displacement at an invisible ~3px even at 90° tilt; the
  shake-to-mix threshold was tuned above what a real hand-shake actually
  produces (~1.0–1.5g observed). Both were fixed by watching real values —
  temporary `console.log`s tailed over `adb logcat` while physically
  tilting/shaking the connected phone — not by guessing better numbers.
- **Patching a third-party native module: use `patch-package`, and patch
  BOTH the source AND the compiled `.d.ts`.** Metro resolves a library's
  runtime JS via its package.json `"react-native"` field (often `src/`,
  bypassing the pre-built `lib/`), but `tsc` resolves TYPES via the
  `"types"` field (the pre-built `.d.ts`) — editing only `src/*.ts` typechecks
  fine at the library's own build time but leaves the CONSUMING app red
  under `tsc` until the shipped `.d.ts` is patched too. For a TurboModule
  (New Architecture) with `CodegenTypes.EventEmitter<T>` fields, adding a
  new native event needs the TS `Spec` interface updated (codegen reads it
  to generate the native abstract method) — the JS-callable subscription
  function is auto-generated from that, no hand-written glue needed on the
  JS side. Always add `"postinstall": "patch-package"` to `package.json`
  scripts and **verify it actually reapplies** by deleting the patched
  package from `node_modules` and reinstalling — this is what makes the
  patch survive EAS Build's fresh install, and a patch that silently stops
  reapplying is a build that "succeeds" while quietly reverting to
  unpatched behavior. See `patches/react-native-vosk+2.1.7.patch` for a
  worked example (added per-word confidence to Vosk's JS API).
