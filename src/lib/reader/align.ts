// align.ts — deciding WHICH occurrence of a word the reader just said.
//
// The reader's position is tracked by matching recognized words against the
// page text. That works until a word appears more than once nearby, which in
// this tale is constantly: "и от бабушки ушёл, и от дедушки ушёл, и от зайца
// ушёл". Hearing "ушёл" on its own tells you nothing about which one — so the
// old behaviour was to take the first occurrence past the cursor and then
// refuse to advance further, on the grounds that guessing wrong is worse than
// standing still. The marker consequently sat on the wrong line and had to be
// dragged forward by the next distinctive word.
//
// A single word is ambiguous. The words AROUND it usually aren't. Vosk hands
// over the whole utterance so far, so when it says "от зайца ушёл" the
// neighbours "от" and "зайца" identify which "ушёл" was meant, even though
// none of those three words would do it alone. That's what this scores.
//
// Deliberately pure and free of any speech/React dependency: everything here
// is arrays of strings and numbers, so the tricky part — which candidate wins
// — is testable without a microphone.

/** How many words either side of the target are considered. Three is about
 *  as far as a phrase stays reliable: past that, Vosk's own word order drifts
 *  and the reader's pauses stop lining up with the page's punctuation. */
export const CONTEXT_RADIUS = 3;

/** A neighbour has to beat this to count as a match at all. Same spirit as
 *  the caller's ALIGN_MIN_WORD_LENGTH: short function words ("и", "от", "a",
 *  "the") appear beside every candidate, so letting them score would mean
 *  every occurrence ties and the context tells you nothing. They still count
 *  when they line up — just for less (see NEIGHBOUR_WEIGHT). */
const SHORT_WORD_LENGTH = 3;

/** How much a matching neighbour is worth, by distance from the target.
 *  Nearer neighbours are worth more because they're less likely to line up by
 *  chance. Index 0 is unused (that's the target itself). */
const NEIGHBOUR_WEIGHT = [0, 6, 4, 2];
/** A short word that matches still counts, but for a third — enough to break
 *  a tie between otherwise equal candidates, not enough to create one. */
const SHORT_WORD_FACTOR = 1 / 3;

/** Levenshtein, capped: stops as soon as it's clear the distance exceeds
 *  `max`, since every caller only cares about "close enough or not". */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowBest = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowBest) rowBest = curr[j];
    }
    if (rowBest > max) return max + 1; // no later row can come back under
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

/** Do these two words count as the same one? Tolerant of a mis-heard ending
 *  (one edit on anything 6+ characters), because that's the common Vosk
 *  error on inflected Russian and it shouldn't cost a neighbour its vote. */
export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 6 || b.length < 6) return false;
  return editDistance(a, b, 1) <= 1;
}

/**
 * How strongly the words around `heardIndex` agree with the words around
 * `pageIndex`. Higher is a better fit; 0 means the neighbourhood says nothing
 * either way.
 */
export function contextScore(
  pageWords: string[],
  pageIndex: number,
  heard: string[],
  heardIndex: number,
): number {
  let score = 0;
  for (let d = 1; d <= CONTEXT_RADIUS; d++) {
    for (const dir of [-1, 1]) {
      const h = heard[heardIndex + d * dir];
      const p = pageWords[pageIndex + d * dir];
      if (h === undefined || p === undefined) continue;
      if (!wordsMatch(h, p)) continue;
      const weight = NEIGHBOUR_WEIGHT[d] ?? 1;
      score += h.length <= SHORT_WORD_LENGTH ? weight * SHORT_WORD_FACTOR : weight;
    }
  }
  return score;
}

export type OccurrenceChoice = {
  /** Index into `candidates` of the winner. */
  index: number;
  /** True when the context genuinely picked this one, rather than it just
   *  being the earliest of several equally-plausible occurrences. The caller
   *  uses this to decide whether it's safe to advance normally or should stay
   *  cautious — see the cue-firing rules at the call site. */
  confident: boolean;
};

/**
 * Choose which of several occurrences of the same word the reader just said.
 *
 * `candidates` are positions in `pageWords`, in reading order. Returns the
 * earliest candidate when the context can't tell them apart, which is exactly
 * what the code did before this existed — so with no usable context around,
 * behaviour is unchanged.
 */
export function chooseOccurrence(
  pageWords: string[],
  candidates: number[],
  heard: string[],
  heardIndex: number,
): OccurrenceChoice {
  if (candidates.length <= 1) return { index: 0, confident: true };

  let bestAt = 0;
  let best = -1;
  let runnerUp = -1;
  for (let i = 0; i < candidates.length; i++) {
    const s = contextScore(pageWords, candidates[i], heard, heardIndex);
    // Strictly greater, so an exact tie keeps the EARLIER candidate: moving
    // the reader backwards, or skipping them ahead, on a coin flip is worse
    // than leaving them where they are.
    if (s > best) {
      runnerUp = best;
      best = s;
      bestAt = i;
    } else if (s > runnerUp) {
      runnerUp = s;
    }
  }

  // Confident only when the winner actually stands out — a margin, not a
  // bare "is highest", because two occurrences of the same refrain score
  // nearly the same and a hair's difference there is noise.
  //
  // The margin is the weight of the FURTHEST neighbour considered, because
  // that's the smallest amount a single real word can shift the balance by.
  // Anything at or above it means at least one full-length neighbour matched
  // one candidate and not the other, which is evidence wherever it sat.
  // Setting it higher assumes the distinguishing word is adjacent to the
  // target, which is true of "от зайца ушёл" but not of "he ran from the
  // wolf" — there the noun that identifies the line is three words out.
  const CONFIDENCE_MARGIN = NEIGHBOUR_WEIGHT[CONTEXT_RADIUS];
  const confident = best > 0 && best - runnerUp >= CONFIDENCE_MARGIN;
  return { index: bestAt, confident };
}
