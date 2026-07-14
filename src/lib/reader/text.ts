// reader/text.ts — shared text tokenizing + cue lookup, used by both the page
// editor (assigning sounds to words) and the reader (tapping words to fire
// them). Keeping this in one place means a word highlighted in the editor maps
// to exactly the same cue when tapped in the reader.

import type { Cue } from '../types';

/** A word/space token carrying its char offsets, so each word maps back to a
 *  cue's [charStart, charEnd). */
export interface Token {
  text: string;
  start: number;
  end: number;
  isSpace: boolean;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let idx = 0;
  for (const part of text.split(/(\s+)/)) {
    if (part.length === 0) continue;
    const start = idx;
    idx += part.length;
    tokens.push({ text: part, start, end: idx, isSpace: /^\s+$/.test(part) });
  }
  return tokens;
}

/** The cue (if any) whose char range overlaps [start, end). */
export function cueAtRange(cues: Cue[], start: number, end: number): Cue | undefined {
  return cues.find(
    (c) => c.charStart != null && c.charEnd != null && start < c.charEnd && end > c.charStart
  );
}
