# Vision providers — on-device OCR base + optional cloud (the "Belarus" change)

> Companion to CHANGES-TODO.md. Captures WHY the vision layer was split and HOW
> it is wired, so the next session can proceed without re-deriving it.

## The problem
The kit did OCR **+** scene **+** cues in ONE Gemini call. Gemini's free tier is
region-restricted and account-gated — **in Belarus it may be unavailable**, and
it needs network + a Google account. A CORE feature can't rest on that.

## The recommendation (adopted)
Make **on-device OCR the DEFAULT vision path**, with **Tesseract** for Russian
(not ML Kit — ML Kit's default Latin OCR doesn't cover Cyrillic; Tesseract's
`rus` pack does). On-device OCR is simultaneously free, private, and immune to
the region/account problem, and it fits the kit's "all heavy work in Prep, keep
it cheap, no billing" ethos. A cloud VLM (Gemini now; Qwen via OpenRouter, or a
self-hosted VLM, later) is reserved as an **optional enhancement** for richer
scene/mood analysis, only where the network + account situation allows.

### Decision recorded (this session)
- **Provider selection:** on-device OCR is ALWAYS the base where available;
  cloud is only an enhancement. (Not locale-auto, not a user default toggle.)
- **Scope built now:** the full interface + refactor + offline matcher, in pure
  Expo-Go-safe TypeScript. Native Tesseract is deferred to the dev-build
  milestone (see "What's left").

## How it maps onto the kit's existing seams
1. **Provider already swappable.** AI was isolated behind `/lib/ai/`. The vision
   layer now mirrors that (and the `/lib/speech/` `SpeechRecognizer`): multiple
   implementations of one interface, chosen per environment.
2. **OCR split from cue-analysis.** Gemini did both in one call. Now:
   `OcrProvider` (image→text) feeds a `CueAnalyzer` (text→scene+cues). With NO
   cloud at all, the analyzer still runs the manifest's trigger-word matching
   over the OCR text locally — so a Belarus user with zero cloud access gets a
   working app (ambient + keyword effects).
3. **Russian already on the radar.** The v0.2.0 change added Cyrillic handling
   and RU trigger vocab. This extends it: the OCR ENGINE itself must be the
   Cyrillic-capable one (Tesseract `rus`), and the offline matcher consumes that
   RU vocab (now encoded as data in `ai/soundLibrary.ts`).

## Architecture (`src/lib/vision/`)
| file | role |
|------|------|
| `types.ts` | `OcrProvider`, `CueAnalyzer`, `VisionProvider` interfaces + `detectLang` |
| `localCues.ts` | **offline** analyzer: bilingual trigger matching over OCR text (no network) |
| `tesseractOcr.ts` | on-device OCR — **STUB** (`isAvailable()===false`) until the dev build |
| `geminiVision.ts` | cloud one-shot provider + cloud analyzer (analysis over on-device text) |
| `index.ts` | `createVisionProvider()` factory + graceful fallback |

Trigger vocabulary lives in `ai/soundLibrary.ts` (`TRIGGER_VOCAB`, `SCENE_VOCAB`),
kept in sync with `sound-library-manifest.md` (the source of truth).

### Selection logic (`createVisionProvider`)
```
on-device OCR available?
  yes + cloud enabled  -> 'hybrid'   Tesseract OCR + Gemini analysis (richer scene/mood)
  yes + cloud disabled -> 'ondevice' Tesseract OCR + local matcher      [fully offline]
  no  + cloud enabled  -> 'cloud'    Gemini one-shot                     [today, Expo Go]
  no  + cloud disabled -> throw a clear, actionable error
```
`preparePage()` returns the SAME `PreparePageResult` as before, so callers
(`add-book.tsx`) are unchanged. Cloud is "enabled" iff `EXPO_PUBLIC_GEMINI_API_KEY`
is set (override with `createVisionProvider({ enableCloud })`).

The hybrid path feeds on-device OCR text into Gemini as the prompt's
`embeddedText` hint (already treated as authoritative for `ocr_text`) and sends
the image for scene/mood — so **OCR stays on-device; only analysis is cloud**.

## Offline matcher: precision over recall
Playing the WRONG sound is worse than skipping (CLAUDE.md). So:
- matching is **whole-word, Unicode-aware** (JS `\b` is ASCII-only and breaks on
  Cyrillic) — e.g. `гром` (thunder) does NOT fire inside `громкий` (loud), and
  `ran` does NOT fire inside `orange`. Verified in a standalone EN+RU run.
- one cue per effect id per page (first occurrence); repeated phrase = one cue.
- `low_confidence` is always set — a heuristic match is weaker than a VLM's.
- ambient is inferred from scene WORDS (coarser than seeing the art).
- `page_type` defaults to `story` (text can't classify it; the review step lets
  the parent skip non-story pages).
- quoted lines are extracted as character cues with a **null voice** (dialogue is
  off by default — extract now, voice later).

## On-device OCR is now wired (Android) — needs the dev build
No maintained Tesseract binding exists for Expo SDK 57, and Android ML Kit
**cannot read Cyrillic** — so on-device Russian OCR is a **custom local Expo
module** wrapping Tesseract4Android: `modules/expo-tesseract-ocr/` +
`src/lib/vision/tesseractOcr.ts`. It loads the combined `eng+rus` model and
downloads traineddata on first run. `isAvailable()` is driven by the native
module's presence, so it is false in Expo Go and true in a dev build — the
factory switches automatically, no upstream change.

**Build + test it on a device** per [tesseract-dev-build.md](./tesseract-dev-build.md).
It was scaffolded but not compiled in the authoring session (no Android toolchain
/ device there), so treat it as unverified until you run it.

### Why Gemini is still here (for now)
The Gemini cloud path is intentionally KEPT as the Expo-Go fallback until the
Tesseract dev build is verified on a real device — so there is never a window
with zero working prep flow. Once on-device OCR is confirmed working, delete
`ai/gemini.ts`, `ai/geminiClient.ts`, `vision/geminiVision.ts`, and the cloud
branch in the factory. That is the final "cut Gemini" step.

### Open question to validate on a real device
Is Tesseract `rus` OCR accurate enough on phone-camera photos of a children's
book (quiet room, parent reading)? If not, the cloud analyzer is still available
as the `hybrid` enhancement behind the same interface — that's why the seam
exists. Test with one real Russian book.
