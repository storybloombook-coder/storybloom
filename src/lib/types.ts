// types.ts — Storybloom data model (single source of truth)
//
// These types match the data model in CLAUDE.md exactly. The schema
// (schema.ts) and the AI module (ai/gemini.ts) both build on these.
// Standalone: no device, no API key, pure types.

export type BookSource = "photos" | "pdf" | "dictation";
export type ReviewStatus = "unreviewed" | "in_progress" | "approved";
export type PrepStatus = "pending" | "processing" | "ready" | "failed";
/** Chosen by the parent at upload time. Drives which single-language Tesseract
 *  model loads for OCR — a combined eng+rus model confuses lookalike Cyrillic/
 *  Latin glyphs (а/a, е/e, о/o, р/p, с/c, у/y, х/x), so knowing the book's
 *  language up front avoids that ambiguity entirely. */
export type BookLanguage = "en" | "ru";

export type PageType =
  | "cover"
  | "title"
  | "story"
  | "illustration_only"
  | "back_cover";

export type CueType = "keyword" | "character";
export type CueReviewState = "proposed" | "confirmed" | "removed";
export type CueIntensity = "normal" | "loud";

export interface Book {
  id: string;
  title: string;
  /** From the back-cover barcode if detected. Unused in v1; the future
   *  book-matching key for the shared-library vision. Nullable. */
  isbn: string | null;
  coverImagePath: string | null;
  createdAt: number; // epoch ms
  prepStatus: PrepStatus;
  /** True if prep found any quoted dialogue — drives the optional voices toggle. */
  hasDialogue: boolean;
  reviewStatus: ReviewStatus;
  /** Where the pages came from. */
  source: BookSource;
  /** Language the parent selected at upload time. */
  language: BookLanguage;
  /** Parent starred this book — surfaced in the library's Favorites filter
   *  and the bookshelf. */
  isFavorite: boolean;
  /** Left-to-right position on the favorites bookshelf. Null until first
   *  favorited (sorts after any set position — joins at the shelf's right end). */
  shelfPosition: number | null;
}

/** A parent's named, reusable recorded sound — browsable in the sound picker
 *  and re-applicable to any word/page, independent of the cue it was first made
 *  for. `fileUri` is a permanent file under documents/recordings/.
 *
 *  The origin* fields are where it was FIRST recorded for — shown as context
 *  in the "My recordings" list so a name isn't the only thing to go on (e.g.
 *  "from 'Cat Book' · page 3 · 'meow'"). Snapshotted at record time (not a
 *  live foreign key) so the context still makes sense even if that book is
 *  later renamed or deleted; all null for recordings made before this
 *  existed. Purely informational — never used to resolve playback. */
export interface Recording {
  id: string;
  name: string;
  fileUri: string;
  durationMs: number | null;
  startMs: number | null;
  endMs: number | null;
  fadeInMs: number | null;
  fadeOutMs: number | null;
  createdAt: number;
  originBookId: string | null;
  originBookTitle: string | null;
  originPageNumber: number | null;
  /** The trigger word it was recorded for, or "Ambient" for a page ambient. */
  originLabel: string | null;
}

export interface Page {
  id: string;
  bookId: string;
  pageNumber: number;
  /** Empty string for a dictated (photo-less) page — there's no source image
   *  to show, re-scan, or zoom. */
  imagePath: string;
  pageType: PageType;
  /** Clean text pulled from a PDF page, passed to Gemini as a wording hint.
   *  Null for photos and image-only PDFs. */
  embeddedText: string | null;
  /** The story text for this page (from Gemini, or the embedded hint). */
  ocrText: string;
  backgroundScene: string | null;
  /** The current / confirmed ambient choice. */
  ambientSoundId: string | null;
  /** Ordered list of library ids, best-first, powering "Try another". */
  ambientCandidates: string[];
  /** Trim/fade envelope — only meaningful for a "custom:<uri>" recorded
   *  ambientSoundId. Null for library sounds (played in full, no fade). */
  ambientStartMs: number | null;
  ambientEndMs: number | null;
  ambientFadeInMs: number | null;
  ambientFadeOutMs: number | null;
}

export interface Cue {
  id: string;
  pageId: string;
  type: CueType;
  /** The exact word/phrase in the page that fires it (lowercased). */
  triggerText: string;
  /** Surrounding phrase — disambiguates repeated words. */
  contextPhrase: string | null;
  /** Position in ocrText so cues fire IN ORDER. Null if not locatable. */
  charStart: number | null;
  charEnd: number | null;
  /** Current / confirmed choice from the bundled library. Null = no sound. */
  soundId: string | null;
  /** Ordered list, best-first, powers "Try another". */
  candidateSoundIds: string[];
  /** Speaker for character cues, e.g. "Pip". Null for keyword cues. */
  characterName: string | null;
  /** "loud" for ALL CAPS / shouted lines. Nullable. */
  intensity: CueIntensity | null;
  /** Short free-text emotion hint ("sad", "excited"). Nullable. */
  emotion: string | null;
  reviewState: CueReviewState;
  /** Trim/fade envelope — only meaningful for a "custom:<uri>" recorded
   *  soundId. Null for library sounds (played in full, no fade). */
  soundStartMs: number | null;
  soundEndMs: number | null;
  fadeInMs: number | null;
  fadeOutMs: number | null;
}

/** A fully-loaded book with its pages and their cues — the unit the reader
 *  plays and (per VISION.md) the unit a build would later be shared as. */
export interface BookBundle {
  book: Book;
  pages: Array<Page & { cues: Cue[] }>;
}

/** Whether a page is actually read aloud (story pages only). */
export function isReadablePage(p: Pick<Page, "pageType">): boolean {
  return p.pageType === "story" || p.pageType === "illustration_only";
}

/** Cues that should actually play during reading (not removed in review). */
export function playableCues(cues: Cue[]): Cue[] {
  return cues
    .filter((c) => c.reviewState !== "removed" && c.soundId)
    .sort((a, b) => (a.charStart ?? 0) - (b.charStart ?? 0));
}
