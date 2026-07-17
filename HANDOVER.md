# Storybloom — Handover

_Snapshot for picking up on another machine / another day. **Update this file
every time you commit + push meaningful work** — it's the first thing a fresh
session (or a fresh PC) should read._

- **Branch:** `feat/ondevice-vision-tesseract` (NOT `main` — main is far behind).
- **Everything is committed + pushed.** Latest: see `git log -1`.
- **To set up + run:** see **[SETUP.md](./SETUP.md)** (clone, `.env`, Vosk models, dev-client build, connect).

---

## Later still same day (2026-07-17, third session) — confidence-aware alignment implemented

**The "investigated, NOT implemented" item from the previous session log below
(search "Confidence-aware alignment") is now DONE**, via a `patch-package`
patch to `react-native-vosk` (see `patches/react-native-vosk+2.1.7.patch`,
committed and reapplied automatically on every `npm install` via the new
`postinstall` script — **verified this survives a fresh install** by deleting
`node_modules/react-native-vosk` and reinstalling).

- The native module's `onResult` now ALSO emits a new `onResultRaw` event
  with the full, unparsed Vosk hypothesis JSON (which includes per-word
  `conf` — previously discarded down to just the `"text"` field), emitted
  deliberately BEFORE the existing `onResult` text event so a
  confidence-aware handler can rely on the confidence already being
  available for that same chunk rather than racing it.
- `speech/vosk.ts` parses it into `{word, confidence}[]` and forwards it via
  a new optional `onResultWithConfidence` callback on `SpeechRecognizer`.
- `read/[id].tsx`'s alignment loop now SKIPS using a word to advance the
  cursor/fire a cue if Vosk's own confidence for it is below `0.5` (finals
  only — Vosk has no per-word confidence for a partial). A low-confidence
  recognition is more likely a coincidental mishear that happens to
  string-match some unrelated nearby page word than a correct one — exactly
  the failure mode behind several of today's earlier cursor-jump bugs (see
  the "Later same day" section below), so this should reduce them further.
- **iOS's `Vosk.mm` was deliberately NOT patched** — this project doesn't
  build/test iOS (see CLAUDE.md: Android is the target). If iOS is ever
  built, it needs the equivalent change or the TS `Spec`'s new
  `onResultRaw` field will make iOS's codegen mismatch.
- **Not yet verified on-device** — needs a fresh dev-client build (Kotlin
  native change) and a real read-aloud pass with some genuinely mis-heard
  words to confirm low-confidence filtering actually reduces bad jumps
  rather than just silently doing nothing (or, worse, filtering out CORRECT
  words too aggressively — `0.5` is a first guess, not tuned against real
  speech yet).

---

## Later same day (2026-07-17, second session) — dev/prod app separation, 4 reader/drag bugs

**Dev-client can no longer clobber a preview/production install.** The dev
client and a preview build shared the Android package `com.storybloom.app`
(+ the same EAS-managed signing key), so Android treated a preview install
as an UPDATE to the same app — installing an offline preview build silently
wiped out the dev-client testing app. Converted `app.json` → `app.config.js`
so the `development` EAS profile (via `APP_VARIANT=development`, set in
`eas.json`'s `env`) gets its own package id `com.storybloom.app.dev`, its
own name ("**Storybloom Testing**"), and a distinct icon tint (yellow) — it
now installs as a genuinely separate app, permanently, alongside whatever
preview/production build is also on the device. Needed (and triggered) a
fresh dev-client build — EAS correctly generated it its own keystore, since
it's a distinct app identity. Build `91a6f410`, queued a long time
(free-tier) — check `eas build:list` if the link below has gone stale.

**Four live-testing bugs fixed** (all in `src/app/read/[id].tsx` /
`src/components/DraggablePageCard.tsx`), reasoned from careful code tracing
— **the reader ones are NOT yet re-verified live** (need a real "next page"
utterance + a book with a repeated word, on the new build):

1. **"next page" jumped straight to the finish screen.** The `nextPageFiredRef`
   dedupe-guard (meant to stop one utterance firing goNext() twice) was
   ITSELF reset by the per-page `useEffect` that `goNext()` triggers via
   `setIndex` — so the guard cleared before the SAME utterance's next Vosk
   partial arrived (partials keep re-delivering the full utterance-so-far),
   and each subsequent partial fired ANOTHER page turn, racing through the
   whole book. Replaced with a plain `Date.now()` cooldown
   (`NEXT_PAGE_COOLDOWN_MS`, no dependency on page-change side effects) and
   gated to only act on `isFinal` (page turns are high-stakes enough to be
   worth the extra ~0.5-1s wait for Vosk to settle, unlike a cue sound).
2. **Read-cursor jumping over sentences on a repeated/similar word.** Vosk's
   `onPartial` delivers the FULL utterance-so-far every callback, not just
   what's new — but the alignment loop re-split `text` and re-matched EVERY
   word from scratch each time, always searching from the current cursor. An
   early word already matched in a prior partial got RE-matched against the
   now-advanced cursor; if it (or a similar word) recurred within
   `ALIGN_LOOKAHEAD`, the search landed on the LATER occurrence and snapped
   the cursor past everything between — explains exactly "jumps over
   sentences" whenever a word repeats. Added `utteranceWordsConsumedRef` to
   track how many words of the CURRENT utterance have already been matched,
   so only the newly-added tail is processed per callback (reset on
   `isFinal`, and on every page turn).
3. **Ball squash-and-stretch** — cosmetic ask, done: `scaleX`/`scaleY` now
   interpolate off the same `ballBounce` value already driving the vertical
   bob, squashing at the bottom of each bounce, stretching slightly at the
   top.
4. **Page drag-reorder was swapping the first and last page.**
   `computeTargetIndex` builds every slot's position by summing
   `itemHeights`, which starts at 0 for every card until each one's
   `onLayout` fires. With several still-zero heights, the position math
   collapses toward the top FOR EVERY CARD (each card's own cumulative
   offset shrinks toward 0 too) — so even a modest drag distance walks
   through many near-zero-width "slots" in one pass and overshoots to the
   LAST index; a last-card drag's cumulative starts near 0 for the identical
   reason, so it just as easily overshoots to the FIRST index. Added a
   fallback (use the dragged card's own — definitely already measured,
   since it's mid-drag — height for any still-zero slot) in both
   `computeTargetIndex` and the neighbor "make room" shift math. **This one
   is reasoned from code only, not yet confirmed against a live drag** —
   there was no way to synthesize a real Pan gesture without the user's
   phone in hand; re-test and report back if it recurs so real device logs
   can be added.

**New dev-client APK** (package `com.storybloom.app.dev`, name "Storybloom
Testing" — installs alongside any existing `com.storybloom.app` build, does
NOT overwrite it):
- Build: https://expo.dev/accounts/alexstorybloom/projects/Storybloom/builds/91a6f410-6904-4585-b4b6-b862f397837d
- Once finished, get the APK URL from that build page (or `eas build:list`)
  and `adb install -r <file>.apk`, or open the link on the phone directly.

---

## This session (2026-07-17) — My Recordings overhaul, reader bouncing ball, EAS build

**My Recordings tab (`RecordingsList.tsx`):**
- Search bar (filters by name) + an All/🎵 Ambient/🔊 Sounds filter toggle
  (kind inferred from `originLabel === 'Ambient'` vs anything else — no
  schema change).
- Two new record buttons, styled with the app's red record-action frame:
  **Record an Ambient** / **Record a Sound** — pre-make a clip with no page
  yet attached, via a new `StandaloneRecordModal` that duplicates the page
  editor's full waveform trim + fade editor (drag handles, live metering
  waveform, fade toggles), not a stripped-down version.
- New `EditRecordingModal` — re-open an *already-saved* recording's editor
  later. Waveform bars for the original clip are an honest flat placeholder
  (no cheap way to re-derive amplitude from an already-encoded file without
  a PCM decode step this app doesn't have); its own **↻ Re-record** button
  DOES get a real live waveform, and replaces the recording's file entirely
  on save. `db.updateRecordingTrim()` is new, takes fileUri+durationMs too
  so a re-record can swap the file, not just the envelope.
- Recording trim stays **non-destructive** by deliberate choice (confirmed
  with the user) — see the dedicated section below.

**Reader (`src/app/read/[id].tsx`):**
- **Vosk grammar constraint** — the recognizer is now handed the book's own
  vocabulary (every story page + the "next page" phrase) via a new
  `vocabulary` option threaded through `SpeechRecognizer.start()` down to
  `react-native-vosk`'s `grammar` param. Restricts what the small Russian
  model can guess, which is the standard high-leverage accuracy lever for
  a constrained-domain small model. Not yet live-tested with real speech.
- **Duplicate-word burst-fire fix** — when a recognized word occurs again
  shortly after in the text, a single match no longer bulk-fires every
  queued cue back to the last confirmed cursor position (only the cue at
  that exact occurrence fires). This was the "two identical words → every
  sound plays at once" bug from earlier sessions.
- **Duplicate-word CURSOR jump fix** (a follow-up report the above didn't
  cover) — `setReadCursor` only fires once per recognized-speech callback,
  after processing every word in that callback's text. If a single batch's
  words matched the same nearby word twice, the loop silently walked
  through the first occurrence and settled on the second before anything
  ever rendered — visually a jump, not "moving steady." The alignment loop
  now stops advancing further in that same batch the moment it hits an
  ambiguous match; reaching a second occurrence needs an actual subsequent
  recognition event.
- **Tap any word to reposition** the read cursor (fix a bad auto-jump, or
  rewind to reread a passage). Rewinding un-fires cues from that point so
  they can trigger again; jumping ahead silently marks skipped cues as
  fired instead of bursting them.
- **Bouncing-ball reading-position indicator** — the page text now renders
  as a flex-wrap row of individually-measured word chips (`onLayout` per
  word) instead of one native `Text` block, so a small ball can hop and
  bounce to sit above whichever word was most recently read. It's
  **draggable** — pan it onto any word to reposition, same effect as
  tapping. Dynamic per-line spacing: lines sit at normal gaps everywhere
  except the ball's own current row, which expands to fit it, collapsing
  the instant it moves on (needs knowing where lines actually wrap, only
  knowable after layout — see `recomputeRows`/`RowGapSpacer` in that file).
  Row-structure recompute is **debounced** (80ms) — doing it synchronously
  on every single word's `onLayout` call (which fires in a tight burst per
  page) could lock in a partial mid-burst snapshot, both misplacing the
  expanded gap and causing a visible re-render cascade/jank. This part in
  particular wants a fresh live-test pass now that it's debounced.
- **Ambient ducks while listening** — it was looping at full volume right
  through the parent's own speech, feeding back into the same mic Vosk
  recognizes through. Now ramps down to a low murmur (not full mute, so
  page turns don't feel abrupt) the instant `micStatus === 'listening'`,
  and restores otherwise (`rampAmbientVolume` in `read/[id].tsx`).
- **Fuzzy alignment fallback** — `matchWordInWindow` tries an exact match
  first, then falls back to a small edit-distance-tolerant match
  (`findWordFuzzy`, tolerance scales with word length) when nothing exact
  is nearby. Vosk's small models often get a word's ending slightly wrong,
  especially against Russian's rich inflection; catches those without
  needing better raw recognition. The existing ambiguous-nearby-duplicate
  guard (previous bullet) now covers fuzzy near-duplicates too, since both
  the primary match and that check go through the same function.
- **Confidence-aware alignment — investigated, NOT implemented.** Vosk's
  raw JSON output does include per-word confidence
  (`{"result":[{"conf":...,"word":...}]}`), but `react-native-vosk`'s
  native wrapper discards it before it reaches JS (see
  `VoskModule.kt`'s `parseHypothesis`, which extracts only the `"text"`
  field — iOS's `Vosk.mm` does the same). Using it would need a
  `patch-package` patch to the native module (Android + iOS) to emit the
  full hypothesis instead, plus a native rebuild to test — bigger scope
  than the two fixes above, explicitly deferred rather than attempted.

**EAS build:** a `preview`-profile Android build was kicked off this
session under the `alexstorybloom` account (matches `app.json`'s
`"owner"`) — build page:
https://expo.dev/accounts/alexstorybloom/projects/Storybloom/builds/7e176012-9212-46e0-8a84-2b175368eee7 .
Like the `dc76bac`-based one before it, **this predates tonight's Recordings
overhaul and Reader work** — see the "no OTA updates" gotcha below before
assuming it reflects current code.

---

## This session (2026-07-16) — sound fixes + an offline-testing preview build

- **Ambient now loops until the page turns** — a trimmed CUSTOM ambient
  recording used to play its trim range once and go silent (library ambient
  already looped correctly). Added `playRangeLooping` in
  `lib/audio/playRange.ts`, used by both the Reader and the editor's ambient
  preview.
- **"Apply to all pages"** — new action in the ambient sheet
  (`db.applyAmbientToAllPages`) sets the current page's ambient (sound + trim/
  fade) on every page of the book in one write. Styled as a tall 1x2
  toggle-shaped pill positioned top-left of the existing 2x2 ambient action
  grid (library/play/record/remove) — reads as its own book-wide action, not
  a fifth grid member.
- **Recording preview ▶ now toggles to a real stop control** — tapping it
  while playing stops playback (icon flips to ⏹, caption to "stop"); it used
  to only ever fire, with no way to stop a preview early.
- **Named, reusable recording library ("My recordings")** — recordings were
  already saved permanently to `documents/recordings/` per-cue, but had no
  name/index, so a good take couldn't be found again. Added a `recordings`
  table (schema v7) + `Recording` type + db CRUD (`createRecording`,
  `listRecordings`, `renameRecording`, `deleteRecording`), a name field when
  saving a new recording, and a "My recordings" section at the top of the
  sound picker (preview + tap-to-reuse) so any past recording can be applied
  to a different word/page later.

### ⚠️ Diagnosed but only PARTLY explained: library sounds are silent when the
### phone is offline, in the DEV client
This is expected dev-client behavior, not a code bug — **but it hasn't been
verified fixed** (the preview build below finished after this session ended;
nobody has confirmed sounds actually play offline on it yet). In a dev build,
every bundled asset (including all `require()`'d sound files) is served by
Metro over the network at runtime, not packaged into the APK — so unplugging
from the dev PC / losing wifi means cues still visually "fire" but produce no
audio, while a parent's own recordings (real `file://` uris already on the
device) keep working. A **preview/production** EAS build (`expo export`)
embeds the JS bundle + all assets into the APK instead, so this should not
happen there. **First thing to check next session:** install the preview APK
below, go fully offline, and confirm library sounds play.

- **Preview build:** queued at 21:09, finished ~07:57 (unusually long free-tier
  queue — ~10h45m, most of it sitting in `IN_QUEUE`; not a build failure).
  Commit: `4245a07b`-triggered, built from `dc76bac` (BEFORE the four sound
  fixes above — those landed in `0b3170f`, after this build was already
  queued). So this APK can verify the offline-playback question but does NOT
  have the ambient-loop/apply-to-all/recording-library UI yet; expect a
  follow-up preview build once those are confirmed working.
- **Direct APK download:**
  https://expo.dev/artifacts/eas/ibpmHsKwATOrjEXL1USFh1FqKA0toI4Hcn5867ngE1M.apk
  (expires ~2 weeks after build; rebuild via `npx eas-cli build --platform
  android --profile preview` if it 404s)
- Install the same way as a dev-client APK: `adb install -r <file>.apk`, or
  open the URL/QR on the phone directly.
- This is a **preview** build (`eas.json`'s `preview` profile — internal
  distribution APK, not a dev client) — it does NOT connect to Metro; it's a
  fully standalone app, which is exactly what's needed to test "does it work
  with no PC around."

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
  list — tilt-gravity, a drag-to-reorder physics system, spines at a fixed
  size (never shrink/scroll to cram more in); once more books are favorited
  than fit one shelf, the rest spill onto additional numbered shelves
  switched via a selector below (1, 2, 3…). Lifting a book off the shelf
  (drag it up) can visibly clip against the shelf's own scrollable-list
  boundary near the top of its range — known, accepted tradeoff (a tried fix
  that reserved growing/shrinking space above the shelf looked worse than the
  clipping itself, so it was reverted). The manual approval workflow
  (unreviewed/in_progress/approved, swipe-right-to-approve) was removed — the
  readiness gate already signals whether a book plays back well, so approval
  was a redundant second step. The `review_status` column/type are still in
  the schema (no migration) but nothing reads or writes them anymore.
- **Book detail** — per-page inspector, tap the title to rename, drag-reorder
  pages (long-press: neighbors visibly slide apart to preview the gap, a
  gentle no-bounce settle on drop), **swipe a page left → delete bin** (same
  confirm-delete pattern as the library, replacing the old drag-onto-a-
  fixed-bin gesture), add pages, and a pinned **readiness gate + ▶ Read** bar
  (green "Ready" or amber "N things to check" with an expandable checklist).
  Tapping "Ready" now opens a popup summarizing what was checked (story pages,
  matched sounds, ambient pages) instead of doing nothing.
  `DraggablePageCard`/`SwipeableRow` nesting is order-sensitive — see the
  gotcha below if touching either.
- **Page editor** — tap a word to attach/remove a sound; correct OCR text
  (keyboard no longer covers the input); "Re-scan area" (crop → re-OCR just
  that region); record/trim/fade custom sounds per word; **ambient
  play/stop toggle** (used to loop forever with no way to stop it — fixed);
  ambient now **loops its trim range** instead of playing once (both in the
  Reader and this editor's preview); an **"Apply to all pages"** toggle sets
  the current ambient on the whole book in one tap; the recording-preview
  button is now a real play/stop toggle; recordings are **named and saved to
  a reusable "My recordings" library**, not just the one cue they were made for.
- **Sound picker** — a collapsible **"My recordings" section** at the top
  (your own named recordings, preview + reuse), search bar (by id or trigger
  word), a "Suggested" section ranked by relevance to the tapped word, the
  114 effects grouped into a collapsible category tree, and a **play/stop
  preview button on every row** so you can hear a sound before assigning it.
- **My Recordings (Library screen's second header tab)** — a full browsing/
  management surface for every saved recording, separate from the picker's
  reuse-only section above: search by name, filter by All/Ambient/Sounds,
  swipe-to-delete, tap to rename, and **Record an Ambient**/**Record a
  Sound** buttons to pre-make a clip with no page attached yet (full
  waveform trim+fade editor). Tapping a recording's 🎚️ icon reopens that
  same editor later to re-trim/re-fade it, or re-record it entirely.
- **Reader (`/read/[id]`)** — the payoff screen, and where milestone 7
  (speech recognition) actually landed: on-device Vosk **listens as you
  read aloud**, aligning recognized words against the page's known OCR text
  and firing cues itself (partials AND finals both drive alignment, for
  latency); saying "next page"/"следующая страница" turns the page
  hands-free; the recognizer is grammar-constrained to the book's own
  vocabulary for accuracy. A word can still be tapped directly to fire it
  manually — mic and tap fire the same cue. **Tap any word to jump the read
  position there** (fix a bad auto-alignment jump, or reread a passage) —
  same effect as a small **draggable bouncing ball** that hops to sit above
  the most-recently-read word, with dynamic per-line spacing (only the
  ball's own line expands to fit it). Ambient bed fades in and loops per
  page; Next/Back page turns; end screen offers Read again or Done.
- **Sound library** — 115 effects + 18 ambient, all real CC0 audio from
  Freesound, **loudness-normalized** (effects −16 LUFS, ambient −23 LUFS so
  beds sit under effects) and **all playing with a short fade in/out**
  instead of an abrupt click. Voices (8) are still synth placeholders.

**Gemini is fully removed** — vision is on-device only, and every leftover
env var/reference is gone too. If the Tesseract native module isn't present
(e.g. Expo Go), `createVisionProvider` throws a clear error instead of
falling back.

---

## Latest dev-client build — ✅ FINISHED, already installed on the dev phone

- **Why this build exists:** `expo-sensors` (Accelerometer) was added for the
  Bookshelf's tilt-gravity + shake-to-mix features (`da8b222`). That's a new
  native module, so the previously-installed dev-client APK didn't have it —
  the app would crash with `Cannot find native module 'ExponentPedometer'` on
  those features without this build. (The code already guards this with a
  `require()`/try-catch so the *rest* of the app doesn't crash even on an old
  APK — only the tilt/shake bookshelf bits needed the new build.)
- **Build:** https://expo.dev/accounts/alexstorybloom/projects/Storybloom/builds/affd14bc-ea5f-40b0-8f4c-6f671b525ace
  (commit `6606763`, SDK 57, finished 2026-07-14).
- **Direct APK download** (valid ~2 weeks from build date, then expires —
  rebuild if it 404s):
  https://expo.dev/artifacts/eas/xIoxT7uo2SGgnKH4bOjpShNtXp3CQfd744zEU5GocU4.apk
- **To install on a phone that doesn't have it yet**, either:
  - **On-phone:** open the build page URL above (or scan its QR) directly on
    the Android phone → tap the download → tap the downloaded APK → allow
    "install from this source" if prompted → Install.
  - **From a PC via adb** (phone already shows up in `adb devices`):
    ```bash
    curl -L -o storybloom-dev.apk "https://expo.dev/artifacts/eas/xIoxT7uo2SGgnKH4bOjpShNtXp3CQfd744zEU5GocU4.apk"
    adb install -r storybloom-dev.apk
    ```
    `-r` reinstalls over an existing dev-client app without wiping its data.
    (This is exactly how it was installed on the current dev phone.)
- **After installing**, run `npx expo start --dev-client` and open the app —
  connects to Metro the same way as before (USB: `adb reverse tcp:8081
  tcp:8081` then use `localhost:8081` in the dev-client's connect screen;
  Wi-Fi: scan the Metro QR). All JS-only work merged after this build (speech
  recognition wiring, Reader button layout) hot-reloads automatically once
  connected — no second install needed for those.
- **Rebuild the dev client only after native changes** (Kotlin, gradle,
  `app.json` plugins/permissions, new native npm deps). Everything else ships
  as JS + bundled assets and just needs a Metro reload.
- **Tilt-gravity and shake-to-mix — verified on real hardware, both were
  broken and are now fixed:**
  - Tilt did nothing: the home-slot spring (`STIFFNESS=90`) was ~30x
    stronger than `GRAVITY_STRENGTH=260`, capping displacement at an
    invisible ~3px even at a full 90° tilt. Fixed by switching the spring
    off while gravity is active — gravity now actually wins, and the
    wall/neighbor collisions do the stopping, like a real tilted shelf.
  - Shake never fired: `SHAKE_DELTA=1.8` was tuned above what a real
    hand-shake produces (observed peaks ~1.0–1.5g on-device). Lowered to
    `1.0`.
  - Diagnosed live via temporary `console.log`s tailed over `adb logcat`
    while the user physically tilted/shook the connected phone — useful
    pattern if similar sensor-tuning issues come up again.

---

## Next steps (suggested order)

1. **Real-book testing pass** — run the readiness gate + Reader on several
   full books (not just single pages) to shake out edge cases: multi-page
   ambient transitions, ordering of many cues on a dense page, the "what's
   missing" chip's accuracy.
2. **Character voices (milestone 8-10)** — still deliberately deferred. Known
   gap: even the manual "Change from library" picker offers sound *effects*
   for a dialogue cue, never the 8 *voices* — intentionally left broken until
   this milestone is actually built (see CLAUDE.md).
3. **Speech recognition (milestone 7) — DONE**, live and grammar-constrained
   (see the 2026-07-17 session log above for the latest accuracy work).
   Still open: a real read-aloud live-test pass of the debounced reader
   changes, and continued OCR/voice-recognition accuracy work for both
   EN and RU as concrete misreads/mishears turn up.
4. **More trigger-vocab coverage** — the offline matcher still has ~60
   effect ids with no trigger words at all (manual-assign only). Expand
   `TRIGGER_VOCAB` in `src/lib/ai/soundLibrary.ts` as real books surface gaps.
5. **App size** — currently ~170MB of bundled assets, ~90% of which is the
   two Vosk speech models (156MB). Discussed but not decided: defer Vosk
   models to a first-use download (like Tesseract's traineddata already
   works) instead of bundling, if install size becomes a concern.
6. **Polish sounds** — replace the 8 placeholder voices with real recordings;
   re-fetch any other dud CC0 clips as they're noticed
   (`node scripts/fetch-freesound.mjs --only=<id>`).

---

## Handy commands

```bash
npx expo start --dev-client          # run (JS hot-reloads)
npx tsc --noEmit                     # typecheck (currently 0 errors) — use
                                      # `node node_modules/typescript/bin/tsc`
                                      # if `npx tsc` tries to fetch a wrong package
node scripts/fetch-freesound.mjs                    # (re)build the sound library from Freesound (needs token)
node scripts/fetch-freesound.mjs --only=fx_some_id  # re-fetch just ONE sound (safe, doesn't touch the rest)
node scripts/gen-placeholder-sounds.mjs             # synth placeholders for any id without audio
node scripts/normalize-sounds.mjs                   # loudness-normalize all bundled sounds (needs ffmpeg-static, temp-install it)
npx eas-cli build --platform android --profile development   # new dev-client build
```

## Recording trim model (by design, not a bug)

Trimming a recording (word cue, page ambient, or a standalone "My
Recordings" clip) is **non-destructive** everywhere in the app:
`startMs`/`endMs`/`fadeInMs`/`fadeOutMs` are stored as a playback envelope
next to a reference to the **full original file** — nothing ever physically
cuts/re-encodes audio (see `playRange` in `src/lib/audio/playRange.ts`).
Reopening an editor always shows the full clip with saved markers restored
— that's expected, confirmed with the user as the preferred behavior over
adding a native audio-encoding dependency (e.g. `ffmpeg-kit-react-native`)
just to make it destructive.

## Gotchas learned this project
- **Commit before an EAS build** — EAS doesn't upload untracked files, so new
  modules/assets silently miss the build if uncommitted.
- **Not in git (recreate per machine):** `.env`, `node_modules/`, the Vosk
  models, generated `android/`.
- **Windows file locks:** if renaming/deleting model folders hits "Access
  denied", stop Metro/`node` (the file watcher) and retry.
- **Installing/uninstalling a dev-only npm package (e.g. `ffmpeg-static` for
  audio trimming/normalization) while Metro is running can crash it** — Metro's
  file watcher throws an uncaught `ENOENT` on the vanished temp directory and
  the whole process dies (app shows a white screen, nothing in the log
  explains why until you check for the crash). **Always stop Metro first**,
  do the npm install/uninstall, then restart Metro (`--clear` if the cache
  looks stale).
- **adb USB connection drops silently mid-session** — if the app shows a
  white screen or stops hot-reloading, check `adb devices` before assuming
  it's a code bug; replug + re-run `adb reverse tcp:8081 tcp:8081`.
- **`npx tsc` can resolve to the wrong package** if TypeScript isn't a
  top-level enough dependency in npx's resolution — use
  `node node_modules/typescript/bin/tsc --noEmit` if you see a "This is not
  the tsc command you are looking for" message.
- **`DraggablePageCard` must be the OUTER wrapper, `SwipeableRow` nested
  INSIDE it** (`<DraggablePageCard><SwipeableRow>{content}</SwipeableRow>
  </DraggablePageCard>`) — never the other way. `SwipeableRow`'s own
  `overflow: 'hidden'` clips anything that moves beyond its own row's
  bounds; if it's the outer element, a dragged page (which needs to visually
  translate OVER neighboring rows) and the neighbors it displaces (which
  shift by roughly one row's height to "make room") both get clipped the
  instant they move past their own row, and the dragged card's `zIndex`
  stops actually elevating it above other rows (it only elevates it among
  its own children once nested one level too deep). This exact regression
  happened once already — see git history around commit `f02060a` if it
  resurfaces.
- **Two independent Reanimated transforms animating the SAME visual motion
  at once either compound into a bounce OR cause a visible snap, depending
  on how you reconcile them.** Hit this in `DraggablePageCard` on drop:
  `translateY` (the raw drag offset) and `layout={LinearTransition}`
  (bridging the card's old-slot-to-new-slot layout position) are two
  entirely separate transform sources that both act on the same card at the
  same moment. Animating BOTH independently (mismatched durations/easings)
  compounded into a hard, high-amplitude "bounce". Zeroing `translateY`
  INSTANTLY instead (so only LinearTransition animates) fixed the bounce but
  traded it for a different glitch: the card visually SNAPPED BACK to its
  old natural slot for an instant (since translateY generally isn't 0 at
  release — the finger rarely lets go exactly at a slot boundary) before
  LinearTransition even started. The actual fix: keep BOTH animated, but
  give them the EXACT SAME duration + easing (`SETTLE_DURATION`/
  `SETTLE_EASING` constants, shared between the `.onEnd()` `withTiming` call
  and `LinearTransition.duration().easing()`) — two transforms summed
  together, easing out at an identical rate, interpolate as ONE continuous
  motion starting exactly at the release point and ending at the new slot,
  with neither a bounce nor a snap. (For NEIGHBOR cards being shifted to
  preview a gap, instant-zero on drop IS correct and needs no such
  synchronization — their preview offset is engineered to already equal
  their final resting spot, so it cancels LinearTransition's own delta
  identically at every point in the curve, not just at the end.) Also worth
  knowing: bare `layout={LinearTransition}` defaults to a bouncy spring —
  `.duration(ms)` switches it to a plain eased timing with no overshoot.
- **White screen on the dev-client** almost always means it lost its
  network path to Metro (JS is fetched over the LAN) — toggle WiFi first,
  don't assume it's a code bug. A genuine JS crash instead shows a red
  LogBox toast/overlay with an actual error message. Also double-check
  before panicking: the dev-menu's own "Tools" bubble overlay can make an
  otherwise fully-rendering app LOOK broken in a screenshot if the overlay
  itself is what's on top — its own preview thumbnail shows what's actually
  underneath.
- **`ExponentImagePicker` "Attempting to launch an unregistered
  ActivityResultLauncher"** — happens after heavy JS-only reload cycling
  without the native Activity itself restarting (common during a long dev
  session with lots of Fast Refresh). Fix: fully force-stop + relaunch the
  app, not just a dev-menu Reload.
- **PowerShell `npx` fails with "running scripts is disabled on this
  system"** — Windows execution policy blocking `npx.ps1`. Use
  `npx.cmd <pkg>` instead, or `Set-ExecutionPolicy -Scope Process
  -ExecutionPolicy Bypass` for that one terminal session (not persistent,
  safe).
- **EAS Robot User tokens need the robot added as an actual account
  member, not just a token generated** — creating an access token alone
  doesn't grant that Robot User access to a project/account; it also needs
  to be a genuine member of the relevant Expo account/organization (a
  distinct actor type created directly on the Access Tokens page, NOT via
  the human Members-invite-by-email flow). If in doubt, skip robot users
  entirely and just `npx eas-cli login` with a normal account.
- **The EAS `preview` build profile has no OTA update mechanism** — no
  `expo-updates`/`"updates"` config, no channel, in this project. It's a
  fully frozen JS+asset snapshot from build time; every future code change
  needs a brand-new preview build to test in that "truly offline, no PC"
  configuration. Don't assume an existing preview APK reflects current
  code — check its build date/commit against `git log` first.
- **adb screenshot coordinates need scaling** — the screenshot tool's own
  image preview is scaled down from the device's real resolution (e.g.
  "displayed at 898x2000" for a 1008x2244 device); eyeballed tap coordinates
  need multiplying by the stated scale factor before `adb shell input tap`.
  `uiautomator dump` + grepping `bounds="[...]"` gives exact device-pixel
  coordinates directly instead — far more reliable than eyeballing,
  especially for small targets.
