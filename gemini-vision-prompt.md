# Gemini Vision Prompt Contract — Storybloom

This defines what the app sends Gemini for each page photo, and the EXACT
structured JSON it must get back. This is the contract milestone 3 builds
against. Keep the actual prompt string in /lib/ai/ so it is easy to tune.

## Goal
For one photo of a children's book page, Gemini must:
1. OCR the page text (verbatim, in reading order).
2. Identify the background SCENE (for the ambient sound).
3. Find KEYWORD cues — words/short phrases that should trigger a sound effect.
4. Attribute CHARACTER lines — dialogue and which character speaks it.

All sound choices are MATCHED to a fixed bundled library (see
sound-library-manifest.md). Gemini picks the best-fitting library id from a
provided allow-list. It must NOT invent sound names.

## Input to Gemini (per page)
- The page image (base64) — ALWAYS sent, whether from a photo or a rendered PDF page.
- The allow-lists of available library sound ids (ambient ids, effect ids,
  character-voice ids) injected into the prompt so Gemini can only choose from
  what actually exists in the app.
- OPTIONAL embedded_text hint: if the page came from a PDF with clean embedded
  text, pass it too. Instruction: "Here is the exact wording of this page's story
  text: <embedded_text>. Use it for ocr_text (it's more reliable than reading the
  image), but STILL analyze the IMAGE for scene, keyword cues, and character
  cues." If no hint is provided, read ocr_text from the image as normal.

## Required output: STRICT JSON only (no prose, no markdown fences)
```json
{
  "page_type": "story",
  "ocr_text": "The full STORY text, verbatim, in reading order.",
  "background_scene": "forest",
  "ambient_sound_id": "amb_forest",
  "keyword_cues": [
    {
      "trigger_text": "roared",
      "context_phrase": "the engine roared",
      "sound_id": "fx_engine",
      "confidence": 0.9
    }
  ],
  "character_cues": [
    {
      "character_name": "Posy",
      "line_text": "Hello, Pip!",
      "trigger_text": "hello pip",
      "voice_id": "voice_child",
      "intensity": "normal",
      "emotion": "happy",
      "confidence": 0.8
    }
  ]
}
```

## page_type — classify EVERY page first
One of: "cover" | "title" | "story" | "illustration_only" | "back_cover".
- cover/title/back_cover: put any visible text in ocr_text but the reading flow
  will skip these; return empty cue arrays.
- illustration_only: a story page with art but NO narrated text — ocr_text is
  "" (empty), still pick an ambient_sound_id, empty cue arrays.
- story: the normal case below.

## Field rules
- ocr_text: verbatim STORY text only, in reading order. READ ONLY the narrative
  typeset text. IGNORE words that are part of the illustration (signs, posters,
  shop names, toy labels, drawings on walls). If unreadable/blurry, best effort
  and set "low_confidence": true.
- background_scene: a short human label ("forest", "ocean", "bedroom", "city").
- ambient_sound_id: MUST be one of the provided ambient ids, or null if none fit.
- keyword_cues[].trigger_text: the exact word/phrase as it appears in ocr_text,
  lowercased, so the app can locate it during speech alignment.
- context_phrase: the surrounding phrase (helps disambiguate repeated words). If
  a word repeats ("cried and cried and cried"), make ONE cue for the phrase.
- character_cues: create these ONLY from text inside quotation marks (actual
  spoken dialogue). Narrator text like `said Pip` is NOT a character cue — it is
  read by the parent. If a page has several quotes, return them IN ORDER.
- character_name: the speaker if identifiable from the text ("said Pip" -> Pip).
- intensity: "loud" if the line is ALL CAPS or clearly shouted, else "normal".
- emotion: short free-text hint if obvious ("sad", "excited"), else null.
- sound_id / voice_id: MUST be from the provided allow-lists, or drop the cue.
  Never invent ids. If nothing fits, return null / omit — never force a wrong one.
- confidence: 0..1. The app can ignore cues below a threshold (e.g. < 0.5).
- If nothing fits for a category, return an empty array (not null) for that list.

## Prompt guidance (paraphrase into the real prompt)
- "You are labeling a single children's book page to drive sound effects."
- "Return ONLY valid JSON matching this schema. No explanations."
- "Choose sound ids ONLY from these allow-lists: [inject ids]."
- SCENE REASONING (for ambient): look at the WHOLE picture as a scene and pick
  the ambient that fits the setting — e.g. a park -> birds; a fountain -> water;
  a road -> passing cars; a bedroom at night -> quiet night. Reason about the
  place, not individual objects.
- DO NOT PIXEL-HUNT: never transcribe or react to words painted into the
  illustration (shop signs, posters, adverts like "Hoppy Holidays!", toy labels,
  kids' drawings on the wall). Only the narrative story text goes in ocr_text.
- "Prefer 2-5 keyword cues per page — the most vivid, sound-evocative moments
  (actions, noises, exclamations). Do not tag every sentence."
- "Extract character_cues ONLY from quoted dialogue, in order. Narrator text is
  not a cue. Still extract them even though playback may be toggled off later."

## App-side handling
- Parse defensively: strip stray markdown fences if present, then JSON.parse.
- On parse failure, retry once with a stricter 'JSON only' instruction.
- On 429 (rate limit), back off and retry (free-tier limits).
- Store ocr_text + cues in SQLite exactly as in the data model (see CLAUDE.md).
- The trigger_text + context_phrase are what milestone 7 (speech recognition) aligns spoken words to.

## v2 notes (do NOT build now)
- AI-generated sounds instead of library matching.
- Auto page-turn detection from speech position.
- Proxying the Gemini call so the key is not shipped in the app bundle.
