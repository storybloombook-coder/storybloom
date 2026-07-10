// vision/localCues.ts — OFFLINE cue analyzer (no network, no account)
//
// The Belarus-proof path: given only the page TEXT (from on-device Tesseract
// OCR), match the bundled sound library by trigger WORDS instead of asking a
// cloud VLM to reason over the image. Bilingual EN + RU via TRIGGER_VOCAB /
// SCENE_VOCAB in ai/soundLibrary.ts (kept in sync with sound-library-manifest.md).
//
// This is deliberately coarser than the cloud analyzer:
//  - ambient is inferred from scene WORDS in the text, not from seeing the art;
//  - page_type can't be classified from text alone, so it defaults to "story"
//    (the review step lets the parent skip non-story pages anyway);
//  - character voices aren't attributed (dialogue is a later, off-by-default
//    feature) — quoted lines are extracted with a null voice so has_dialogue
//    still works, matching "extract now, play later".
// Where the network/account situation allows, the cloud analyzer replaces THIS
// behind the same CueAnalyzer interface for richer results.

import type {
  PreparePageResult,
  RawKeywordCue,
  RawCharacterCue,
  SoundAllowlists,
} from '../ai/gemini';
import { SCENE_VOCAB, TRIGGER_VOCAB, type TriggerEntry } from '../ai/soundLibrary';
import type { AnalyzeInput, CueAnalyzer } from './types';

/** Longest-trigger-first so multi-word triggers ("jumped in") win over their
 *  parts, and so a match consumes the fuller phrase. */
function sortedByLength(entries: TriggerEntry[]): Array<{ soundId: string; trigger: string }> {
  const flat = entries.flatMap((e) =>
    e.triggers.map((trigger) => ({ soundId: e.soundId, trigger: trigger.toLowerCase() }))
  );
  return flat.sort((a, b) => b.trigger.length - a.trigger.length);
}

/** True if the char at index i is a Unicode letter (JS \b is ASCII-only and
 *  mis-handles Cyrillic, so we check boundaries by hand). */
function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /\p{L}/u.test(ch);
}

/** Index of the first WHOLE-WORD occurrence of `needle` in `hay`, or -1.
 *  Word-bounded so "гром" (thunder) does NOT match inside "громкий" (loud) and
 *  "ran" does NOT match inside "orange". Precision over recall: for the offline
 *  matcher, skipping a cue beats firing the wrong sound (see CLAUDE.md). */
function wordIndex(hay: string, needle: string): number {
  if (!needle) return -1;
  let from = 0;
  for (;;) {
    const pos = hay.indexOf(needle, from);
    if (pos < 0) return -1;
    const before = hay[pos - 1];
    const after = hay[pos + needle.length];
    if (!isLetter(before) && !isLetter(after)) return pos;
    from = pos + 1;
  }
}

/** Pick the ambient bed whose scene words appear most in the text. */
function inferAmbient(lowerText: string, allow: string[]): string | null {
  let bestId: string | null = null;
  let bestScore = 0;
  for (const entry of SCENE_VOCAB) {
    if (!allow.includes(entry.soundId)) continue;
    let score = 0;
    for (const word of entry.triggers) {
      if (wordIndex(lowerText, word.toLowerCase()) >= 0) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = entry.soundId;
    }
  }
  return bestId;
}

/** Cap keyword cues per page. The cloud prompt asks for "2-5 most vivid"
 *  moments and CLAUDE.md says "don't tag every sentence" — without a cap the
 *  matcher could fire one effect per matching id (up to ~19) and make the read
 *  noisy. We keep the earliest few in reading order. */
const MAX_KEYWORD_CUES = 5;

/** Find keyword effect cues by scanning the text for trigger words. One cue per
 *  effect id per page (fired at its first occurrence) — mirrors the prompt rule
 *  "don't tag every sentence; a repeated phrase is ONE cue". */
function matchKeywords(text: string, lowerText: string, allow: string[]): RawKeywordCue[] {
  const usedIds = new Set<string>();
  const cues: Array<RawKeywordCue & { pos: number }> = [];

  for (const { soundId, trigger } of sortedByLength(TRIGGER_VOCAB)) {
    if (!allow.includes(soundId) || usedIds.has(soundId)) continue;
    const pos = wordIndex(lowerText, trigger);
    if (pos < 0) continue;
    usedIds.add(soundId);
    const from = Math.max(0, pos - 20);
    const to = Math.min(text.length, pos + trigger.length + 20);
    cues.push({
      pos,
      trigger_text: trigger,
      context_phrase: text.slice(from, to).trim(),
      sound_id: soundId,
      confidence: 0.5, // heuristic match — lower than a VLM's judgment
    });
  }

  // Fire in reading order, then keep only the earliest few so a dense page
  // doesn't spam effects.
  return cues
    .sort((a, b) => a.pos - b.pos)
    .slice(0, MAX_KEYWORD_CUES)
    .map(({ pos, ...cue }) => cue);
}

/** Extract quoted lines as character cues (voice unattributed). Handles ASCII
 *  and typographic/guillemet quotes used in RU/EN children's books. */
function matchQuotes(text: string): RawCharacterCue[] {
  const cues: RawCharacterCue[] = [];
  const patterns = [/"([^"]{2,})"/g, /“([^”]{2,})”/g, /«([^»]{2,})»/g];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const line = m[1].trim();
      if (!line) continue;
      cues.push({
        character_name: null,
        line_text: line,
        trigger_text: line.toLowerCase(),
        voice_id: null, // dialogue is off by default; extract now, voice later
        intensity: line === line.toUpperCase() && /\p{L}/u.test(line) ? 'loud' : 'normal',
        emotion: null,
        confidence: 0.4,
      });
    }
  }
  return cues;
}

export function analyzeLocally(input: AnalyzeInput): PreparePageResult {
  const text = input.ocrText ?? '';
  const lowerText = text.toLowerCase();
  const { ambientIds, effectIds } = input.allowlists;

  const keyword_cues = text.trim() ? matchKeywords(text, lowerText, effectIds) : [];
  const character_cues = text.trim() ? matchQuotes(text) : [];
  const ambient_sound_id = text.trim() ? inferAmbient(lowerText, ambientIds) : null;

  return {
    page_type: input.pageType ?? 'story', // text alone can't classify; review handles it
    ocr_text: text,
    background_scene: ambient_sound_id ? ambient_sound_id.replace(/^amb_/, '') : null,
    ambient_sound_id,
    keyword_cues,
    character_cues,
    low_confidence: true, // always flag: a heuristic match is weaker than a VLM's
  };
}

/** The offline CueAnalyzer. No network, no key — works anywhere Tesseract runs. */
export const localCueAnalyzer: CueAnalyzer = {
  id: 'local-triggers',
  onDevice: true,
  async analyze(input: AnalyzeInput): Promise<PreparePageResult> {
    return analyzeLocally(input);
  },
};

// Re-export the allow-list type for callers that only import from vision/.
export type { SoundAllowlists };
