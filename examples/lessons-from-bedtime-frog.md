# What the Bedtime Frog example taught us — plan updates

Working a REAL book through our plan surfaced 9 gaps. Each has a concrete change.
These are folded into CLAUDE.md; kept here as the rationale.

## 1. Pages aren't all "story text" pages
Page 6 = illustration only. Pages 1/2 = cover/title. Page 27 = back cover.
CHANGE: add page_type to the data model:
  page_type = 'cover' | 'title' | 'story' | 'illustration_only' | 'back_cover'
Reading flow skips non-story pages. Illustration_only pages may still get an
ambient bed but have no text to read / align.

## 2. Sentences span page boundaries
p25 "...she found her frog . . ." -> p26 ". . . exactly where she had left him!"
CHANGE: the reader must tolerate a page turn mid-sentence. Don't assume each
page's text is a closed unit for alignment. Low effort, just don't break on it.

## 3. Narration vs dialogue (IMPORTANT)
Nearly every page mixes narrator text with quoted speech. ONLY quoted speech is
a character voice cue; narration is read by the parent, un-voiced.
CHANGE: the Gemini prompt must extract character_cues ONLY from text inside
quotation marks, and tag everything else as narration. voice cues fire on the
quoted span only.

## 4. Multiple, alternating dialogue turns per page
p17 has Pip, Posy, Posy in order; p18/p19 similar.
CHANGE: character_cues is an ORDERED list with text positions (char_start/end).
Milestone 6/7 must fire voices in sequence at the right positions, not "page has
speaker X". This raises the difficulty of the voice milestone — plan for iteration.

## 5. Emphasis / emotion matters
"I CAN'T SLEEP WITHOUT MY FROGGY!!" (caps, loud, upset) vs calm lines.
CHANGE: add optional fields to a cue: intensity ('normal'|'loud') and
emotion (free text e.g. 'sad','excited'). v1 can ignore them; capturing them now
is nearly free and enables better delivery later.

## 6. Overlapping cues at one moment
p8 "giggled Posy" = laugh effect AND Posy voice line at the same word.
CHANGE: define a rule for coincident cues. v1 rule: if a keyword effect and a
character voice land within N words, play the effect first (short) then the
voice, or duck one under the other. Keep it simple; just don't let them collide.

## 7. Repeated trigger words
p20 "cried and cried and cried".
CHANGE: treat a repeated phrase as ONE trigger (fire once), and match the whole
phrase, not each word. Store the full context_phrase to disambiguate.

## 8. Incidental text in the illustration (IMPORTANT for OCR quality)
Bus advert "Hoppy Holidays!", pictures on walls, toy labels, etc.
CHANGE: the Gemini prompt must read STORY TEXT ONLY (the narrative typeset text),
and explicitly ignore words that are part of the illustration/scenery. Otherwise
ocr_text fills with junk that breaks speech alignment.

## 9. Per-book sounds beyond the starter library
This book wants: light-switch click, crying, cheer/"hooray", soft snore, generic
farm animals, and (fun) a dinosaur roar — none in the starter set.
CHANGE (confirms earlier decision): the AI matches to whatever library exists and
returns null when nothing fits (reader skips that cue). Optionally, gather a few
book-specific clips during prep. The "no good match -> skip" fallback is
mandatory, not optional.

---

## Net data-model changes (now reflected in CLAUDE.md)
- Page: + page_type
- Cue:  + intensity (nullable), + emotion (nullable)
- Cue:  is_narration handled by ONLY creating character cues from quoted text
- Keep char_start/char_end so cues fire at the right position, in order

## Net build-order note
Milestone 7 (character voices) is harder than first assumed because of ordered,
alternating, multi-turn dialogue. Consider a milestone 6.5: "fire the RIGHT
character voice at the RIGHT position for multi-turn pages" as its own step.

## Things this book did NOT need (scope stays tight)
- No web-searching for sounds. Library + skip covered everything acceptably.
- No auto page-turn. Manual tap / "next page" is fine for a 27-page bedtime book.
- No accounts/backend. One device, one book, works perfectly.
