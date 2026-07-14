// reader/readiness.ts — the pre-flight "is this book ready to read?" check.
//
// Pure + UI-free so it's easy to reason about and test: given the pages and
// their cues, it returns the counts the book-detail gate shows plus a list of
// advisory warnings (each pointing at the page that needs a fix). Nothing here
// BLOCKS reading — a book with warnings is still readable, the gate just makes
// the rough spots visible and deep-linkable before the parent reads to a child.

import { isReadablePage, type Cue, type Page } from '../types';
import { isPlayable } from '../audio/soundResolver';

export type ReadinessWarningKind =
  | 'empty_text' // a story page with no recognized text at all
  | 'page_no_sounds' // a story page with neither ambient nor any playable cue
  | 'silent_cue' // a cue highlighted in the text but with no sound assigned
  | 'unplayable_cue'; // a cue whose chosen sound has no bundled audio

export interface ReadinessWarning {
  kind: ReadinessWarningKind;
  pageId: string;
  pageNumber: number;
  /** e.g. the cue's trigger word — for a human-readable warning line. */
  detail?: string;
}

export interface ReadinessReport {
  /** True when there are no warnings. Reading is allowed either way. */
  ready: boolean;
  storyPageCount: number;
  /** Total playable keyword/character cues across all story pages. */
  soundCount: number;
  /** Story pages that have an ambient bed. */
  ambientPageCount: number;
  warnings: ReadinessWarning[];
}

/** A cue counts as "active" (should play / should be highlighted) when it wasn't
 *  removed in review. */
function isActive(cue: Cue): boolean {
  return cue.reviewState !== 'removed';
}

export function checkReadiness(
  pages: Page[],
  cuesByPage: Map<string, Cue[]>
): ReadinessReport {
  const storyPages = pages.filter(isReadablePage);
  const warnings: ReadinessWarning[] = [];
  let soundCount = 0;
  let ambientPageCount = 0;

  for (const page of storyPages) {
    const cues = (cuesByPage.get(page.id) ?? []).filter(isActive);
    const hasAmbient = !!page.ambientSoundId && isPlayable(page.ambientSoundId);
    if (hasAmbient) ambientPageCount += 1;

    let playableOnPage = 0;
    for (const cue of cues) {
      // Highlighted (locatable in the text) but no sound chosen — the exact
      // "word looks tappable but nothing happens" case.
      if (cue.charStart != null && !cue.soundId) {
        warnings.push({
          kind: 'silent_cue',
          pageId: page.id,
          pageNumber: page.pageNumber,
          detail: cue.triggerText,
        });
        continue;
      }
      if (cue.soundId && !isPlayable(cue.soundId)) {
        warnings.push({
          kind: 'unplayable_cue',
          pageId: page.id,
          pageNumber: page.pageNumber,
          detail: cue.triggerText,
        });
        continue;
      }
      if (cue.soundId) playableOnPage += 1;
    }
    soundCount += playableOnPage;

    if (!page.ocrText.trim()) {
      warnings.push({ kind: 'empty_text', pageId: page.id, pageNumber: page.pageNumber });
    } else if (!hasAmbient && playableOnPage === 0) {
      warnings.push({ kind: 'page_no_sounds', pageId: page.id, pageNumber: page.pageNumber });
    }
  }

  return {
    ready: warnings.length === 0,
    storyPageCount: storyPages.length,
    soundCount,
    ambientPageCount,
    warnings,
  };
}

/** A short human-readable line for a warning, for the gate's checklist. */
export function warningLabel(w: ReadinessWarning): string {
  switch (w.kind) {
    case 'empty_text':
      return `Page ${w.pageNumber}: no text recognized`;
    case 'page_no_sounds':
      return `Page ${w.pageNumber}: no sounds yet`;
    case 'silent_cue':
      return `Page ${w.pageNumber}: “${w.detail}” is highlighted but has no sound`;
    case 'unplayable_cue':
      return `Page ${w.pageNumber}: “${w.detail}” points to a missing sound`;
  }
}
