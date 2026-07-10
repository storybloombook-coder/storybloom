# Storybloom — Sound Sourcing Guide

> How to fill the bundled sound library, and the AI-generation options for later.
> Written licensing-first, because VISION.md wants approved sound builds to become
> shareable/forkable between parents — so every sound must be safe not just to
> *use* but to *redistribute as part of a shared build*. That one requirement
> drives every choice below.

## TL;DR
- **v1 bundled library:** use **CC0 stock** (Freesound filtered to CC0 + Kenney /
  OpenGameArt CC0 packs) **and/or AI-generated clips from Meta AudioGen
  (Apache-2.0)**. Both are free AND redistribution-safe.
- **Avoid depending on** Pixabay/Mixkit for the *sharing* feature — free and
  no-attribution, but their licenses forbid redistributing the raw sound file as
  a standalone asset (fine to play inside the app, gray area once a build bundles
  the clip).
- **AI generation CAN be free now**, but the best tool (ElevenLabs) is NOT free
  for this use — its free tier requires attribution + is personal-use only. The
  free, redistributable path is **open-weight models (AudioGen / Stable Audio
  Open)**.
- **Smart move:** generate the v1 library at BUILD TIME from the manifest prompts
  with AudioGen — royalty-free, redistributable, style-consistent, and it stays
  inside the kit's "AI matches bundled sounds, doesn't generate at runtime" rule.

---

## The licensing tiers (only the top tier is safe for shared builds)
1. **CC0 / public domain** — do anything, including redistribute, no attribution.
   ✅ THIS IS WHAT WE WANT.
2. **No-attribution commercial** (Pixabay, Mixkit) — free commercially, but
   **prohibit redistributing the sound as a standalone file**. ⚠️ Play-in-app OK;
   bundling raw clips into a shared build is the edge case.
3. **Attribution / non-commercial** (CC-BY, CC-BY-NC) — must credit the author;
   NC forbids commercial use. ⚠️ Extra obligations to carry through every shared
   build. Avoid for the core library.

---

## Part 1 — Free stock libraries (the kit's v1 plan)

### Freesound — best variety + has an API (fits the automatable pipeline)
- Largest CC-licensed sound DB (700k+ sounds, 20+ yrs).
- **License varies PER CLIP** (CC0, CC-BY, or CC-BY-NC chosen by uploader).
- **ACTION: filter to CC0 only.** Search page has a license filter; CC0 gives
  unrestricted use + redistribution + no attribution — exactly what shared builds
  need. Ready-made CC0 game-SFX packs exist (e.g. OwlStorm 8-bit pack).
- Caveat: a few uploaders mark CC0 but *ask* for credit in the description —
  legally not required, but be aware.
- API docs: https://freesound.org/docs/api/  (good for scripted fetching)

### Kenney / OpenGameArt — clean CC0 packs
- Kenney: https://kenney.nl/assets  (most assets CC0, consistent style)
- OpenGameArt: filter to CC0. Game-focused UI/impacts/loops.
- ✅ Redistribution-safe. Great starter material.

### Pixabay — easiest, no-attribution, but redistribution-limited
- 200k+ SFX, single Pixabay Content License, no account needed.
- ⚠️ License **prohibits redistributing/selling sounds as standalone files** —
  must be part of a larger work. Fine for in-app playback; risky for the v2
  parent-to-parent build sharing.

### Mixkit — cleanest license, curated, smaller, no API
- Every SFX under Mixkit License: commercial use, no attribution, no sign-up.
- Curated quality but smaller library; hand-pick + download (no API).
- ⚠️ Same redistribution caveat as Pixabay.

### Also useful
- **BBC Sound Effects archive** — huge real-world recordings, but RemArc license
  leans non-commercial; check per use.
- **Sonniss GDC bundles** — annual, professional, broadly commercial-friendly.

### RECOMMENDATION (v1 library)
Standardize on **CC0**: Freesound-CC0 (via API) + Kenney/OpenGameArt CC0 packs,
topped up with Mixkit only for specific high-quality one-offs. CC0 is the only
tier that survives the shareable-builds transition, so committing to it now
avoids a licensing refactor later (same "keep the door open cheaply" logic the
kit already applies to portable bundles + ISBN capture).

---

## Part 2 — AI sound generation (can it be free now? yes, with caveats)

### ElevenLabs = best quality, but NOT free for this use
- Best AI SFX in 2026: 48kHz, up to 30s, **seamless looping** (ideal for ambient
  beds), full REST API for batch generation.
- **Free tier: ~10k credits/mo; SFX ~200 credits each — ~50 gens/mo, BUT output
  requires attribution to elevenlabs.io and is PERSONAL-USE ONLY.** Commercial
  rights need a paid plan (~$5–6/mo Starter+).
- ❌ Reach for this ONLY if/when Storybloom monetizes (roadmap v3+). Then it's
  excellent. Not suitable for a free, shareable v1.

### Meta AudioGen (AudioCraft) = the clean free option ✅
- Fully open-source; **Apache-2.0 — no restrictions on commercial use of
  outputs.** Outputs are yours, redistributable.
- Trade-offs: ~32kHz, weaker prompt adherence than ElevenLabs, needs GPU
  (8GB+ VRAM) or cloud.
- Repo: https://github.com/facebookresearch/audiocraft

### Stable Audio Open / Stable Audio 3 Small-SFX = promising, license asterisk
- Open weights; **Small-SFX runs OFFLINE on consumer/mobile hardware** (even
  CPU), 44.1kHz. Interesting for a future on-device generation feature.
- ⚠️ Community license reportedly needs a **separate commercial agreement for
  self-hosting at scale**; large model is API-only. Use small open weights for
  experimentation, but read the license before depending on it. AudioGen's
  Apache-2.0 is the safer free bet today.

### No local GPU? Free/cheap ways to run open models
- **Replicate**: ~$0.05/generation (~19 per $1) — good for scripted library gen.
- **Hugging Face Spaces**: free with queue delays.
- → Generating a whole starter library costs a couple dollars, or $0 if patient.

---

## The recommended approach: generate the library at BUILD TIME
Don't add runtime generation to v1. Instead, **pre-generate the bundled starter
library from the prompts already in `sound-library-manifest.md`** ("soft
rainfall", "gentle surf", "toy dinosaur roar") using AudioGen (or Stable Audio
Open). Benefits:
- Outputs are Apache-2.0-clean, royalty-free, redistributable.
- Style-consistent across the whole library.
- Ships bundled exactly like CC0 clips would.
- Stays 100% inside the kit's rule: "AI matches bundled sounds; it does NOT
  generate/fetch at runtime" (that's still v2).

Then the documented v2 ("try another" → real generation) is a natural extension:
same models, moved to runtime (cloud API when online; eventually on-device via
Stable Audio's mobile SFX model).

---

## Decision table
| Need | Best free option | Redistributable? | Notes |
|---|---|---|---|
| Stock: variety + API | **Freesound (CC0 filter)** | ✅ (CC0 only) | Has API for automation |
| Stock: easiest | Pixabay / Mixkit | ⚠️ in-app yes, standalone no | No attribution, no redistribution of raw files |
| Stock: game SFX packs | Kenney / OpenGameArt (CC0) | ✅ | Clean CC0 starter packs |
| AI gen: best quality | ElevenLabs SFX | ❌ free tier = attribution + personal only | Great IF paid (~$5/mo) |
| AI gen: free + redistributable | **Meta AudioGen (Apache-2.0)** | ✅ unrestricted | GPU/cloud; ~$0.05/gen Replicate or free HF Spaces |
| AI gen: on-device future | Stable Audio Open Small-SFX | ⚠️ check license at scale | Runs offline/mobile; commercial-scale asterisk |

---

## Concrete kit changes this implies (do alongside v0.2.0)
1. **`sound-library-manifest.md`:** add a **`license`** and **`source_url`** field
   to every `amb_*` / `fx_*` entry, so provenance travels with each build (cheap
   now, essential once builds are shared).
2. **`sound-library-manifest.md`:** add a short **"Sourcing"** note at top —
   library is CC0 stock and/or AudioGen-generated (Apache-2.0); NOT
   Pixabay/Mixkit raw redistribution.
3. **`sound-library-manifest.md`:** add a **"v2 generation options"** section
   pointing to AudioGen / Stable Audio Open / ElevenLabs (paid) with the
   licensing notes above.
4. Bilingual reminder (ties to CHANGES-TODO #3): sound FILES are
   language-neutral, so the SAME clips serve EN + RU — only the *trigger
   vocabulary* needs both languages. No extra sourcing needed for Russian.
