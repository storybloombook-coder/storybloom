#!/usr/bin/env node
/**
 * check-prep-output.mjs
 * Scores the app's real Gemini prep output against bedtime-frog-expected.json.
 *
 * USAGE (during the session, after prep runs on the Bedtime Frog):
 *   1. Have the app dump its per-page prep result as a JSON array to a file,
 *      e.g. actual.json. Each element should look roughly like:
 *      {
 *        "page": 8,
 *        "page_type": "story",
 *        "ocr_text": "\"Hello, Pip!\" giggled Posy.",
 *        "ambient_sound_id": "amb_meadow",
 *        "keyword_cues": [{ "trigger_text": "giggled", "sound_id": "fx_laugh" }],
 *        "character_cues": [{ "character_name": "Posy", "line_text": "Hello, Pip!",
 *                             "voice_id": "voice_child", "intensity": "normal",
 *                             "char_start": 0 }]
 *      }
 *   2. Run:  node check-prep-output.mjs bedtime-frog-expected.json actual.json
 *
 * Matching is deliberately FUZZY (case-insensitive, substring, punctuation-loose)
 * because Gemini output varies run to run. The goal is "is it right enough",
 * not an exact-string diff.
 *
 * No dependencies. Node 18+.
 */

import { readFileSync } from "node:fs";

const [, , expectedPath, actualPath] = process.argv;
if (!expectedPath || !actualPath) {
  console.error("Usage: node check-prep-output.mjs <expected.json> <actual.json>");
  process.exit(2);
}

const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
const actualArr = JSON.parse(readFileSync(actualPath, "utf8"));
const actualByPage = new Map(actualArr.map((p) => [Number(p.page), p]));

const norm = (s) =>
  (s ?? "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const contains = (hay, needle) => norm(hay).includes(norm(needle));
const anyId = (val, list) => list.map(norm).includes(norm(val));

let pass = 0;
let fail = 0;
const fails = [];

function check(cond, page, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    fails.push(`  [p${page}] ${msg}`);
  }
}

for (const exp of expected.pages) {
  const page = exp.page;
  const act = actualByPage.get(page);

  if (!act) {
    check(false, page, `no actual output found for this page`);
    continue;
  }

  // page_type
  if (exp.page_type) {
    check(
      norm(act.page_type) === norm(exp.page_type),
      page,
      `page_type expected "${exp.page_type}", got "${act.page_type}"`
    );
  }

  // non-story pages: just ensure no cues leaked
  if (exp.expect_story === false) {
    const kc = act.keyword_cues?.length ?? 0;
    const cc = act.character_cues?.length ?? 0;
    check(kc === 0 && cc === 0, page, `non-story page should have no cues (got ${kc} kw, ${cc} char)`);
    continue;
  }

  // ocr empty check (illustration_only)
  if (exp.ocr_is_empty) {
    check(norm(act.ocr_text) === "", page, `ocr_text should be empty, got "${act.ocr_text?.slice(0, 40)}..."`);
  }

  // ocr must contain
  for (const frag of exp.ocr_contains ?? []) {
    check(contains(act.ocr_text, frag), page, `ocr_text should contain "${frag}"`);
  }

  // ocr must NOT contain (incidental text)
  for (const frag of exp.ocr_must_not_contain ?? []) {
    check(!contains(act.ocr_text, frag), page, `ocr_text should NOT contain incidental text "${frag}"`);
  }
  for (const frag of expected.scoring?.no_incidental_text_in_ocr ?? []) {
    if ((exp.ocr_contains ?? []).some((f) => contains(f, frag))) continue; // skip if legitimately part of story
    check(!contains(act.ocr_text, frag), page, `ocr_text should NOT contain global incidental text "${frag}"`);
  }

  // ambient
  if (exp.ambient_expected_any) {
    check(
      anyId(act.ambient_sound_id, exp.ambient_expected_any),
      page,
      `ambient_sound_id expected one of [${exp.ambient_expected_any}], got "${act.ambient_sound_id}"`
    );
  }

  // required keyword cues
  for (const req of exp.required_keyword_cues ?? []) {
    const match = (act.keyword_cues ?? []).find(
      (c) => contains(c.trigger_text, req.trigger) && anyId(c.sound_id, req.sound_any)
    );
    check(!!match, page, `missing keyword cue: "${req.trigger}" -> one of [${req.sound_any}]`);
    if (match && req.fire_once) {
      const count = (act.keyword_cues ?? []).filter((c) => contains(c.trigger_text, req.trigger)).length;
      check(count === 1, page, `keyword "${req.trigger}" should fire once, found ${count}`);
    }
  }

  // must have no character cues (dialogue-off default sanity / narration pages)
  if (exp.must_have_no_character_cues) {
    const cc = act.character_cues?.length ?? 0;
    check(cc === 0, page, `expected no character cues (narration page), got ${cc}`);
  }

  // required character cues (only meaningful when dialogue extraction is on)
  for (const req of exp.required_character_cues ?? []) {
    const match = (act.character_cues ?? []).find(
      (c) =>
        contains(c.line_text, req.quote_contains) &&
        (!req.speaker_any || req.speaker_any.some((s) => contains(c.character_name, s)) || anyId(c.character_name, req.speaker_any)) &&
        (!req.voice_any || anyId(c.voice_id, req.voice_any))
    );
    check(!!match, page, `missing character cue: ${req.speaker_any?.[0] ?? "?"} "${req.quote_contains}"`);
    if (match && req.intensity_any) {
      check(anyId(match.intensity ?? "normal", req.intensity_any), page,
        `character cue "${req.quote_contains}" intensity expected [${req.intensity_any}], got "${match.intensity}"`);
    }
  }

  // ordered dialogue check
  if (exp.character_cues_must_be_ordered && (exp.required_character_cues?.length ?? 0) > 1) {
    const positions = exp.required_character_cues.map((req) => {
      const m = (act.character_cues ?? []).find((c) => contains(c.line_text, req.quote_contains));
      return m ? (m.char_start ?? act.character_cues.indexOf(m)) : -1;
    });
    const ordered = positions.every((p, i) => i === 0 || (p >= 0 && p >= positions[i - 1]));
    check(ordered, page, `character cues out of order: positions ${JSON.stringify(positions)}`);
  }
}

console.log(`\nStorybloom prep check — ${expected.book}`);
console.log(`PASS ${pass}   FAIL ${fail}\n`);
if (fails.length) {
  console.log("Failures:");
  console.log(fails.join("\n"));
  console.log("");
  process.exit(1);
} else {
  console.log("All assertions passed. 🎉\n");
}
