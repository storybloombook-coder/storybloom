# Storybloom — Product Vision (north star)

This is where Storybloom is headed. NONE of this is v1. It's here so v1 decisions
don't accidentally close doors. v1 stays local-only and free; these are the
horizons that justify the shape of the data model.

## The core insight
There are only so many popular children's books. Once many parents have built and
approved sound sets for the same titles, those builds OVERLAP. That overlap is an
asset: a parent scanning a common book shouldn't have to review 50 cues from
scratch — they should be able to pull a great community-made set and go.

## North star: a community library of sound builds
Once a book is processed and its sounds approved, that build can be SHARED so
other parents can:
- Find builds for a book they own (matched by title / ISBN).
- Rate a build 1-5 stars.
- Use it as-is, OR fork it and adjust cues for themselves.
- Over time, the best community builds rise to the top ("top premade options").

End state: for popular books, a one-tap "use the community's favorite build"
instead of manual review. Review becomes contribution, not a chore.

## What this requires (why it's NOT v1)
- A backend + storage (v1 is deliberately local-only, no server).
- User accounts / identity (v1 has none).
- A shared, browsable, searchable library (v1 library is on-device only).
- Ratings + ranking + basic moderation (spam, bad/mismatched builds).
- Book identity matching: reliably deciding two scans are the "same book"
  (ISBN capture from the back cover barcode is the obvious key; title is fuzzy).
- Licensing care: shared builds reference bundled/again-royalty-free sounds, not
  redistributed copyrighted audio; and they describe cues, not the book's text.

## The ONE cheap thing v1 should do now (keep the door open)
Make each processed book a clean, SELF-CONTAINED, EXPORTABLE bundle locally:
- book (title, detected ISBN if any, page list)
- per-page: scene, ambient choice
- per-cue: trigger_text/context, type, chosen sound_id, review_state
- NOT the book's copyrighted text dump — store what's needed to drive sounds
A build should be serializable to a single JSON object. If that's true from day
one, "share this build" later = upload that object. If it's tangled into app
state, sharing later = a painful refactor. So: keep builds portable.

Also cheap and worth doing in v1: try to CAPTURE THE ISBN from the back-cover
barcode during capture (even if unused in v1). ISBN is the clean key that makes
book-matching work later. Storing it now costs nothing.

## Rough sequencing (illustrative, not committed)
- v1: local-only, free, capture -> prep -> review -> read. Portable build bundle.
- v2: AI-generated sounds (replaces "try another"); character voices polish.
- v3: accounts + backend; upload/download builds; ISBN book matching.
- v4: ratings, ranking, fork-and-adjust, "community favorite" one-tap.
- (Anytime) monetization thinking belongs with v3+ (shared infra has real cost).

## Guardrail
Do NOT let this vision leak into v1 scope. v1's job is to prove the magic on one
device for free. The only concessions v1 makes to this future are: portable
build bundles, and capturing ISBN if easy. Everything else waits.
