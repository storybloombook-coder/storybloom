# Storybloom — Handover

_Snapshot for picking up on another machine / another day. **Update this file
every time you commit + push meaningful work** — it's the first thing a fresh
session (or a fresh PC) should read._

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
- **Library** — rich cards (cover, counts, status, badges), **favorites ⭐**,
  a **▶ Play button** (bottom-right, soft-tint) that jumps straight into the
  Reader, an inline **"⚠️ N" readiness chip** that opens a "what's missing"
  sheet deep-linking to the page that needs fixing, **swipe left → delete
  bin** / **swipe right → mark approved** (both with a haptic tick at the
  open threshold), pull-to-refresh.
- **Book detail** — per-page inspector, tap the title to rename, drag-reorder
  / delete pages, add pages, and a pinned **readiness gate + ▶ Read** bar
  (green "Ready" or amber "N things to check" with an expandable checklist).
- **Page editor** — tap a word to attach/remove a sound; correct OCR text
  (keyboard no longer covers the input); "Re-scan area" (crop → re-OCR just
  that region); record/trim/fade custom sounds per word; **ambient
  play/stop toggle** (used to loop forever with no way to stop it — fixed).
- **Sound picker** — search bar (by id or trigger word), a "Suggested"
  section ranked by relevance to the tapped word, the 114 effects grouped
  into a collapsible category tree, and a **play/stop preview button on
  every row** so you can hear a sound before assigning it.
- **Reader (`/read/[id]`)** — the payoff screen. Ambient bed **fades in and
  loops automatically** per page; **tap a highlighted word to fire its
  sound**; Next/Back page turns; end screen offers Looks good (→
  `reviewStatus = 'approved'`), Read again, or Done. This is the exact seam
  Vosk speech alignment will hook into later (fire the same cue from speech
  instead of a tap — no reader UI change needed).
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
- **Still needs real-device verification:** the gyroscope tilt-gravity axis
  mapping and shake-detection thresholds in `Bookshelf.tsx` were written on
  best-guess reasoning, not yet confirmed on hardware. Try tilting the phone
  left/right on the Library screen with a few favorited books — if books
  slide the wrong direction, the fix is flipping the sign on the
  accelerometer `x` reading in `Bookshelf.tsx`.

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
3. **Speech recognition (milestone 7)** — Vosk is wired (`src/lib/speech/`);
   the next step is aligning spoken words to `ocr_text` and calling the
   Reader's `fireCue()` from that alignment instead of a tap, plus a "next
   page" voice command.
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
