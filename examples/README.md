# How to use the Bedtime Frog test files (during the session)

These turn milestone 3 from "eyeball the AI output and hope" into a mechanical
pass/fail check.

## Files
- **bedtime-frog-breakdown.md** — human-readable expected result, all 27 pages.
- **bedtime-frog-expected.json** — the same, as machine-checkable assertions.
- **check-prep-output.mjs** — scores real prep output against the expected JSON.
- **bedtime-frog-sound-shopping-list.md** — the ~10 sounds this book needs.
- **lessons-from-bedtime-frog.md** — why the plan looks the way it does.

## Workflow during milestone 3
1. Build the prep pipeline so it can dump its per-page result as a JSON array
   (one object per page) to a file — call it `actual.json`. Each object needs at
   least: page, page_type, ocr_text, ambient_sound_id, keyword_cues[],
   character_cues[]. (Field names as in check-prep-output.mjs header.)
2. Run prep on the 27 Bedtime Frog page images.
3. Score it:
     node check-prep-output.mjs bedtime-frog-expected.json actual.json
4. Read the failures. Each line tells you exactly what's wrong on which page.
   Tune the Gemini prompt (in /lib/ai/) and re-run until PASS is high and the
   FAILs are only the "optional/fun" ones you don't care about.

## How strict is it?
- Matching is fuzzy (case-insensitive, substring, punctuation-loose) because
  Gemini output varies between runs. It checks "right enough", not exact strings.
- `required_*` cues must appear. `optional_*` cues never fail the test — they're
  nice-to-haves (e.g. fx_roar on "dinosaur", fx_snore on "asleep").
- Non-story pages must carry NO cues. Narration pages must carry NO character
  cues (this also guards the "dialogue only from quotes" rule).

## Interpreting results
- A high PASS with only optional failures = milestone 3 is done. Move on.
- Repeated FAILs on the same rule (e.g. incidental text in OCR, or narration
  tagged as dialogue) = tighten that instruction in the prompt. These are the
  two most common Gemini mistakes for this kind of task.

## Note on dialogue
Even though character voices are OFF by default in the app (a later toggle), prep
still EXTRACTS character_cues, so these tests check them. That's intentional: it
verifies the data is captured correctly now, so the toggle "just works" later.
If you build prep to NOT extract dialogue yet, expect the character-cue
assertions to fail — that's fine, treat them as pending.
