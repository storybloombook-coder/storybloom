// db.ts — data-access layer over schema.ts (expo-sqlite).
// Maps between the camelCase types in types.ts and the snake_case columns
// in schema.ts. Local-only storage (v1 has no backend).

import * as SQLite from 'expo-sqlite';
import { initDatabase, serializeStringArray, parseStringArray } from './schema';
import type {
  Book,
  Page,
  Cue,
  Recording,
  BookSource,
  BookLanguage,
  PrepStatus,
  ReviewStatus,
  PageType,
  CueType,
  CueIntensity,
  CueReviewState,
} from './types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('storybloom.db').then(async (db) => {
      await initDatabase(db);
      return db;
    });
  }
  return dbPromise;
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function createBook(params: {
  title: string;
  source: BookSource;
  language: BookLanguage;
}): Promise<Book> {
  const db = await getDatabase();
  const book: Book = {
    id: generateId(),
    title: params.title,
    isbn: null,
    coverImagePath: null,
    createdAt: Date.now(),
    prepStatus: 'processing',
    hasDialogue: false,
    reviewStatus: 'unreviewed',
    source: params.source,
    language: params.language,
    isFavorite: false,
    shelfPosition: null,
  };
  await db.runAsync(
    `INSERT INTO books (id, title, isbn, cover_image_path, created_at, prep_status, has_dialogue, review_status, source, language, is_favorite)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      book.id,
      book.title,
      book.isbn,
      book.coverImagePath,
      book.createdAt,
      book.prepStatus,
      book.hasDialogue ? 1 : 0,
      book.reviewStatus,
      book.source,
      book.language,
      book.isFavorite ? 1 : 0,
    ]
  );
  return book;
}

/** Star / unstar a book (library Favorites filter + bookshelf). Starring for
 *  the first time appends it to the right end of the shelf; unstarring clears
 *  its shelf position so a later re-favorite appends fresh rather than
 *  reclaiming a stale slot. */
export async function setBookFavorite(bookId: string, isFavorite: boolean): Promise<void> {
  const db = await getDatabase();
  const flag = isFavorite ? 1 : 0;
  await db.runAsync(
    `UPDATE books SET is_favorite = ?, shelf_position = CASE
       WHEN ? = 1 AND shelf_position IS NULL
         THEN (SELECT COALESCE(MAX(shelf_position), -1) + 1 FROM books WHERE is_favorite = 1)
       WHEN ? = 0 THEN NULL
       ELSE shelf_position
     END
     WHERE id = ?`,
    [flag, flag, flag, bookId]
  );
}

/** Persist a new left-to-right shelf order after a drag (bookIds already in
 *  the desired order). Writes every position in one transaction. */
export async function updateShelfOrder(bookIds: string[]): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < bookIds.length; i++) {
      await db.runAsync('UPDATE books SET shelf_position = ? WHERE id = ?', [i, bookIds[i]]);
    }
  });
}

/** Rename a book. */
export async function updateBookTitle(bookId: string, title: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE books SET title = ? WHERE id = ?', [title, bookId]);
}

export async function setBookPrepStatus(
  bookId: string,
  prepStatus: PrepStatus,
  hasDialogue: boolean
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE books SET prep_status = ?, has_dialogue = ? WHERE id = ?', [
    prepStatus,
    hasDialogue ? 1 : 0,
    bookId,
  ]);
}

export async function createPage(params: {
  bookId: string;
  pageNumber: number;
  imagePath: string;
}): Promise<Page> {
  const db = await getDatabase();
  const page: Page = {
    id: generateId(),
    bookId: params.bookId,
    pageNumber: params.pageNumber,
    imagePath: params.imagePath,
    pageType: 'story',
    embeddedText: null,
    ocrText: '',
    backgroundScene: null,
    ambientSoundId: null,
    ambientCandidates: [],
    ambientStartMs: null,
    ambientEndMs: null,
    ambientFadeInMs: null,
    ambientFadeOutMs: null,
  };
  await db.runAsync(
    `INSERT INTO pages (id, book_id, page_number, image_path, page_type, embedded_text, ocr_text, background_scene, ambient_sound_id, ambient_candidates)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      page.id,
      page.bookId,
      page.pageNumber,
      page.imagePath,
      page.pageType,
      page.embeddedText,
      page.ocrText,
      page.backgroundScene,
      page.ambientSoundId,
      serializeStringArray(page.ambientCandidates),
    ]
  );
  return page;
}

export async function updatePagePrepResult(
  pageId: string,
  result: {
    pageType: PageType;
    ocrText: string;
    backgroundScene: string | null;
    ambientSoundId: string | null;
  }
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE pages SET page_type = ?, ocr_text = ?, background_scene = ?, ambient_sound_id = ?, ambient_candidates = ?
     WHERE id = ?`,
    [
      result.pageType,
      result.ocrText,
      result.backgroundScene,
      result.ambientSoundId,
      serializeStringArray(result.ambientSoundId ? [result.ambientSoundId] : []),
      pageId,
    ]
  );
}

export async function createCue(params: {
  pageId: string;
  type: CueType;
  triggerText: string;
  contextPhrase: string | null;
  charStart: number | null;
  charEnd: number | null;
  soundId: string | null;
  characterName: string | null;
  intensity: CueIntensity | null;
  emotion: string | null;
  soundStartMs?: number | null;
  soundEndMs?: number | null;
  fadeInMs?: number | null;
  fadeOutMs?: number | null;
}): Promise<Cue> {
  const db = await getDatabase();
  const cue: Cue = {
    id: generateId(),
    pageId: params.pageId,
    type: params.type,
    triggerText: params.triggerText,
    contextPhrase: params.contextPhrase,
    charStart: params.charStart,
    charEnd: params.charEnd,
    soundId: params.soundId,
    candidateSoundIds: params.soundId ? [params.soundId] : [],
    characterName: params.characterName,
    intensity: params.intensity,
    emotion: params.emotion,
    reviewState: 'proposed',
    soundStartMs: params.soundStartMs ?? null,
    soundEndMs: params.soundEndMs ?? null,
    fadeInMs: params.fadeInMs ?? null,
    fadeOutMs: params.fadeOutMs ?? null,
  };
  await db.runAsync(
    `INSERT INTO cues (id, page_id, type, trigger_text, context_phrase, char_start, char_end, sound_id, candidate_sound_ids, character_name, intensity, emotion, review_state, sound_start_ms, sound_end_ms, fade_in_ms, fade_out_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cue.id,
      cue.pageId,
      cue.type,
      cue.triggerText,
      cue.contextPhrase,
      cue.charStart,
      cue.charEnd,
      cue.soundId,
      serializeStringArray(cue.candidateSoundIds),
      cue.characterName,
      cue.intensity,
      cue.emotion,
      cue.reviewState,
      cue.soundStartMs,
      cue.soundEndMs,
      cue.fadeInMs,
      cue.fadeOutMs,
    ]
  );
  return cue;
}

type BookRow = {
  id: string;
  title: string;
  isbn: string | null;
  cover_image_path: string | null;
  created_at: number;
  prep_status: PrepStatus;
  has_dialogue: number;
  review_status: ReviewStatus;
  source: BookSource;
  language: BookLanguage;
  is_favorite: number;
  shelf_position: number | null;
};

function rowToBook(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    isbn: row.isbn,
    coverImagePath: row.cover_image_path,
    createdAt: row.created_at,
    prepStatus: row.prep_status,
    hasDialogue: row.has_dialogue === 1,
    reviewStatus: row.review_status,
    source: row.source,
    language: row.language,
    isFavorite: row.is_favorite === 1,
    shelfPosition: row.shelf_position,
  };
}

export async function listBooks(): Promise<Book[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<BookRow>('SELECT * FROM books ORDER BY created_at DESC');
  return rows.map(rowToBook);
}

// ---- Page / Cue row mappers ---------------------------------------------

type PageRow = {
  id: string;
  book_id: string;
  page_number: number;
  image_path: string;
  page_type: PageType;
  embedded_text: string | null;
  ocr_text: string;
  background_scene: string | null;
  ambient_sound_id: string | null;
  ambient_candidates: string;
  ambient_start_ms: number | null;
  ambient_end_ms: number | null;
  ambient_fade_in_ms: number | null;
  ambient_fade_out_ms: number | null;
};

function rowToPage(r: PageRow): Page {
  return {
    id: r.id,
    bookId: r.book_id,
    pageNumber: r.page_number,
    imagePath: r.image_path,
    pageType: r.page_type,
    embeddedText: r.embedded_text,
    ocrText: r.ocr_text,
    backgroundScene: r.background_scene,
    ambientSoundId: r.ambient_sound_id,
    ambientCandidates: parseStringArray(r.ambient_candidates),
    ambientStartMs: r.ambient_start_ms,
    ambientEndMs: r.ambient_end_ms,
    ambientFadeInMs: r.ambient_fade_in_ms,
    ambientFadeOutMs: r.ambient_fade_out_ms,
  };
}

type CueRow = {
  id: string;
  page_id: string;
  type: CueType;
  trigger_text: string;
  context_phrase: string | null;
  char_start: number | null;
  char_end: number | null;
  sound_id: string | null;
  candidate_sound_ids: string;
  character_name: string | null;
  intensity: CueIntensity | null;
  emotion: string | null;
  review_state: CueReviewState;
  sound_start_ms: number | null;
  sound_end_ms: number | null;
  fade_in_ms: number | null;
  fade_out_ms: number | null;
};

function rowToCue(r: CueRow): Cue {
  return {
    id: r.id,
    pageId: r.page_id,
    type: r.type,
    triggerText: r.trigger_text,
    contextPhrase: r.context_phrase,
    charStart: r.char_start,
    charEnd: r.char_end,
    soundId: r.sound_id,
    candidateSoundIds: parseStringArray(r.candidate_sound_ids),
    characterName: r.character_name,
    intensity: r.intensity,
    emotion: r.emotion,
    reviewState: r.review_state,
    soundStartMs: r.sound_start_ms,
    soundEndMs: r.sound_end_ms,
    fadeInMs: r.fade_in_ms,
    fadeOutMs: r.fade_out_ms,
  };
}

// ---- Library-facing reads -----------------------------------------------

/** A book plus the aggregate counts + cover the library card shows, computed
 *  in one query so the list doesn't fan out N queries per book. */
export interface BookSummary extends Book {
  pageCount: number;
  cueCount: number;
}

export async function listBookSummaries(): Promise<BookSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<
    BookRow & { page_count: number; cue_count: number; cover_path: string | null }
  >(
    `SELECT b.*,
       (SELECT COUNT(*) FROM pages p WHERE p.book_id = b.id) AS page_count,
       (SELECT COUNT(*) FROM cues c
          JOIN pages p2 ON c.page_id = p2.id
          WHERE p2.book_id = b.id) AS cue_count,
       (SELECT p3.image_path FROM pages p3
          WHERE p3.book_id = b.id
          ORDER BY p3.page_number LIMIT 1) AS cover_path
     FROM books b
     ORDER BY b.created_at DESC`
  );
  return rows.map((r) => ({
    ...rowToBook(r),
    // Fall back to page 1's image when no explicit cover was stored.
    coverImagePath: r.cover_image_path ?? r.cover_path,
    pageCount: r.page_count,
    cueCount: r.cue_count,
  }));
}

export async function getBook(id: string): Promise<Book | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<BookRow>('SELECT * FROM books WHERE id = ?', [id]);
  return row ? rowToBook(row) : null;
}

export async function getPagesForBook(bookId: string): Promise<Page[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PageRow>(
    'SELECT * FROM pages WHERE book_id = ? ORDER BY page_number',
    [bookId]
  );
  return rows.map(rowToPage);
}

export async function getCuesForBook(bookId: string): Promise<Cue[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CueRow>(
    `SELECT c.* FROM cues c
       JOIN pages p ON c.page_id = p.id
       WHERE p.book_id = ?
       ORDER BY p.page_number, c.char_start`,
    [bookId]
  );
  return rows.map(rowToCue);
}

/** All pages across every book — for the library's per-book readiness check,
 *  so it doesn't fan out one query per book. Ordered so a book's pages stay in
 *  page order after grouping by bookId. */
export async function getAllPages(): Promise<Page[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PageRow>('SELECT * FROM pages ORDER BY book_id, page_number');
  return rows.map(rowToPage);
}

/** All cues across every book — pairs with getAllPages() for the library
 *  readiness check (group by pageId; page ids are globally unique). */
export async function getAllCues(): Promise<Cue[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CueRow>('SELECT * FROM cues');
  return rows.map(rowToCue);
}

/** Delete a book and (via ON DELETE CASCADE) its pages + cues. Image files on
 *  disk are removed by the caller (the data layer stays filesystem-free). */
export async function deleteBook(id: string): Promise<void> {
  const db = await getDatabase();
  // Foreign keys must be ON for the cascade; assert it on this connection.
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.runAsync('DELETE FROM books WHERE id = ?', [id]);
}

/** Delete a single page (and, via ON DELETE CASCADE, its cues). The page's
 *  image file on disk is removed by the caller, same convention as deleteBook. */
export async function deletePage(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.runAsync('DELETE FROM pages WHERE id = ?', [id]);
}

/** Renumbers a book's pages to match a new order (1-based), e.g. after a
 *  drag-to-reorder. `orderedPageIds` must contain every page id for the book. */
export async function reorderPages(orderedPageIds: string[]): Promise<void> {
  const db = await getDatabase();
  for (let i = 0; i < orderedPageIds.length; i++) {
    await db.runAsync('UPDATE pages SET page_number = ? WHERE id = ?', [i + 1, orderedPageIds[i]]);
  }
}

// ---- Single-page reads + edits (post-OCR text/cue editor) ----------------

export async function getPage(pageId: string): Promise<Page | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<PageRow>('SELECT * FROM pages WHERE id = ?', [pageId]);
  return row ? rowToPage(row) : null;
}

export async function getCuesForPage(pageId: string): Promise<Cue[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CueRow>(
    'SELECT * FROM cues WHERE page_id = ? ORDER BY char_start IS NULL, char_start',
    [pageId]
  );
  return rows.map(rowToCue);
}

/** Save a corrected OCR transcript for a page. Cue char positions may now be
 *  stale — the caller re-locates them (updateCueCharRange) against the new text. */
export async function updatePageOcrText(pageId: string, ocrText: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE pages SET ocr_text = ? WHERE id = ?', [ocrText, pageId]);
}

/** Sets (or clears, passing null) a page's ambient sound together with its
 *  trim/fade envelope — mirrors updateCueSoundTrim for cues. */
export async function updatePageAmbient(
  pageId: string,
  ambient: { soundId: string; startMs: number | null; endMs: number | null; fadeInMs: number | null; fadeOutMs: number | null } | null
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE pages SET ambient_sound_id = ?, ambient_start_ms = ?, ambient_end_ms = ?, ambient_fade_in_ms = ?, ambient_fade_out_ms = ? WHERE id = ?',
    [
      ambient?.soundId ?? null,
      ambient?.startMs ?? null,
      ambient?.endMs ?? null,
      ambient?.fadeInMs ?? null,
      ambient?.fadeOutMs ?? null,
      pageId,
    ]
  );
}

/** Apply one ambient (same sound + trim/fade envelope) to EVERY page of a book
 *  — the "add ambient to all pages" action. Non-story pages never play back, so
 *  setting it on them is harmless; targeting all pages keeps it predictable. */
export async function applyAmbientToAllPages(
  bookId: string,
  ambient: { soundId: string; startMs: number | null; endMs: number | null; fadeInMs: number | null; fadeOutMs: number | null }
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE pages SET ambient_sound_id = ?, ambient_start_ms = ?, ambient_end_ms = ?, ambient_fade_in_ms = ?, ambient_fade_out_ms = ?
     WHERE book_id = ?`,
    [ambient.soundId, ambient.startMs, ambient.endMs, ambient.fadeInMs, ambient.fadeOutMs, bookId]
  );
}

// ---- Named recording library --------------------------------------------

type RecordingRow = {
  id: string;
  name: string;
  file_uri: string;
  duration_ms: number | null;
  start_ms: number | null;
  end_ms: number | null;
  fade_in_ms: number | null;
  fade_out_ms: number | null;
  created_at: number;
  origin_book_id: string | null;
  origin_book_title: string | null;
  origin_page_number: number | null;
  origin_label: string | null;
};

function rowToRecording(r: RecordingRow): Recording {
  return {
    id: r.id,
    name: r.name,
    fileUri: r.file_uri,
    durationMs: r.duration_ms,
    startMs: r.start_ms,
    endMs: r.end_ms,
    fadeInMs: r.fade_in_ms,
    fadeOutMs: r.fade_out_ms,
    createdAt: r.created_at,
    originBookId: r.origin_book_id,
    originBookTitle: r.origin_book_title,
    originPageNumber: r.origin_page_number,
    originLabel: r.origin_label,
  };
}

export async function createRecording(params: {
  name: string;
  fileUri: string;
  durationMs: number | null;
  startMs: number | null;
  endMs: number | null;
  fadeInMs: number | null;
  fadeOutMs: number | null;
  originBookId?: string | null;
  originBookTitle?: string | null;
  originPageNumber?: number | null;
  originLabel?: string | null;
}): Promise<Recording> {
  const db = await getDatabase();
  const rec: Recording = {
    id: generateId(),
    createdAt: Date.now(),
    originBookId: params.originBookId ?? null,
    originBookTitle: params.originBookTitle ?? null,
    originPageNumber: params.originPageNumber ?? null,
    originLabel: params.originLabel ?? null,
    ...params,
  };
  await db.runAsync(
    `INSERT INTO recordings
       (id, name, file_uri, duration_ms, start_ms, end_ms, fade_in_ms, fade_out_ms, created_at,
        origin_book_id, origin_book_title, origin_page_number, origin_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rec.id,
      rec.name,
      rec.fileUri,
      rec.durationMs,
      rec.startMs,
      rec.endMs,
      rec.fadeInMs,
      rec.fadeOutMs,
      rec.createdAt,
      rec.originBookId,
      rec.originBookTitle,
      rec.originPageNumber,
      rec.originLabel,
    ]
  );
  return rec;
}

export async function listRecordings(): Promise<Recording[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<RecordingRow>('SELECT * FROM recordings ORDER BY created_at DESC');
  return rows.map(rowToRecording);
}

export async function renameRecording(id: string, name: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE recordings SET name = ? WHERE id = ?', [name, id]);
}

/** Re-trims/re-fades an already-saved recording in place — the same envelope
 *  editor used at record time, reopened later from My Recordings. A cue or
 *  ambient that already picked this recording copied its envelope at that
 *  moment (see chooseRecording in page/[id].tsx), so this only affects the
 *  Recording row itself: previewing it here, and any NEW place it gets
 *  assigned to from now on — same "already-placed uses keep their old
 *  values" rule as deleting a recording. */
export async function updateRecordingTrim(
  id: string,
  params: { startMs: number | null; endMs: number | null; fadeInMs: number | null; fadeOutMs: number | null }
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE recordings SET start_ms = ?, end_ms = ?, fade_in_ms = ?, fade_out_ms = ? WHERE id = ?', [
    params.startMs,
    params.endMs,
    params.fadeInMs,
    params.fadeOutMs,
    id,
  ]);
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM recordings WHERE id = ?', [id]);
}

export async function updateCueSoundId(cueId: string, soundId: string | null): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE cues SET sound_id = ? WHERE id = ?', [soundId, cueId]);
}

/** Sets a cue's sound together with its trim/fade envelope — used when saving
 *  a parent's recording (library sounds just pass null for all four). */
export async function updateCueSoundTrim(
  cueId: string,
  params: { soundId: string; startMs: number | null; endMs: number | null; fadeInMs: number | null; fadeOutMs: number | null }
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE cues SET sound_id = ?, sound_start_ms = ?, sound_end_ms = ?, fade_in_ms = ?, fade_out_ms = ? WHERE id = ?',
    [params.soundId, params.startMs, params.endMs, params.fadeInMs, params.fadeOutMs, cueId]
  );
}

export async function setCueReviewState(cueId: string, state: CueReviewState): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE cues SET review_state = ? WHERE id = ?', [state, cueId]);
}

export async function updateCueCharRange(
  cueId: string,
  charStart: number | null,
  charEnd: number | null
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE cues SET char_start = ?, char_end = ? WHERE id = ?', [
    charStart,
    charEnd,
    cueId,
  ]);
}
