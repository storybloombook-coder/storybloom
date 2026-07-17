> ⚠️ **SUPERSEDED — this screen was never built this way, and won't be.** The
> manual per-cue Confirm/Remove/Swap review flow described below was replaced
> by a lighter "readiness gate" (a Ready/N-things-to-check popup — see
> `book/[id].tsx` + `lib/reader/readiness.ts`) before this screen was ever
> implemented. Kept for ONE reason: **"Try another"** (auto-cycle to the next-
> best candidate sound, distinct from the "Swap" manual-pick action that DOES
> exist today in the sound picker) was never built anywhere, and this doc is
> the only place its intended design is written down. If "Try another" is
> ever built, take the concept from here; ignore everything else about the
> screen layout/counter/approval flow — none of that reflects the real app.

# Review Flow — approving a book's sounds

After a book is processed, the parent reviews the AI's proposed sounds page by
page and confirms/adjusts them. This makes wrong AI guesses harmless and gives
the parent creative control. (A functional mockup of this screen was built during
planning — this describes what it does.)

## Screen layout (per page)
- Header: "Review sounds", the page number + scene label, and an "Approve all"
  button (top-right) that accepts everything and jumps to reading.
- The page's story text in a card (so the parent sees the context).
- One card per cue. Each cue card shows:
  - What triggers it: a scene ("Scene: a garden, birds"), a word ("Word: giggled"),
    or a phrase ("Phrase: cried and cried and cried").
  - A state badge: proposed / confirmed / removed.
  - A PLAY button (hear the sound) + the sound's friendly name + its id.
  - Four actions: Confirm · Remove · Try another · Swap.
- Footer: Prev / Next (or Done on the last page) + a "reviewed x/y" counter.

## The four actions
- Confirm  -> keep this sound (review_state = 'confirmed').
- Remove   -> this trigger plays nothing (review_state = 'removed').
- Try another -> swap to the NEXT candidate in the cue's candidate list.
  v1: next-best LIBRARY match. v2: real AI regeneration behind the same button.
- Swap     -> open a picker of library sounds; choosing one sets it + confirms.

## Rules
- Review is OPTIONAL. "Approve all" accepts every proposal as-is.
- Choices are saved with the book, so reopening from the library restores exactly
  what the parent approved (nothing to redo).
- Only cues with review_state != 'removed' play during reading.
- Prep must produce an ORDERED candidate list per cue (best first) so "Try
  another" has alternatives to offer.

## Data touched (see CLAUDE.md data model)
- Book.review_status: 'unreviewed' | 'in_progress' | 'approved'
- Page.ambient_sound_id (+ ambient_candidates)
- Cue.sound_id (+ candidate_sound_ids), Cue.review_state

## Possible simplification (decide during testing)
Per-cue review on a ~24-page book is ~50 confirmations. "Approve all" covers the
impatient case. If per-cue feels heavy in real use, add an "approve this page"
(one tap accepts a page's cues). Left per-cue for now per product decision.

## Why this matters long-term (see VISION.md)
An approved build is a self-contained, portable object. Today it lives on the
device; later it's the unit parents SHARE and RATE in a community library. Keeping
each build cleanly serializable in v1 is what makes that future cheap.
