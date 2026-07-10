// db.ts — data-access layer over schema.ts (expo-sqlite).
// Maps between the camelCase types in types.ts and the snake_case columns
// in schema.ts. Local-only storage (v1 has no backend).

import * as SQLite from 'expo-sqlite';
import { initDatabase, serializeStringArray, parseStringArray } from './schema';
import type {
  Book,
  Page,
  Cue,
  BookSource,
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

export async function createBook(params: { title: string; source: BookSource }): Promise<Book> {
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
  };
  await db.runAsync(
    `INSERT INTO books (id, title, isbn, cover_image_path, created_at, prep_status, has_dialogue, review_status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ]
  );
  return book;
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
  };
  await db.runAsync(
    `INSERT INTO cues (id, page_id, type, trigger_text, context_phrase, char_start, char_end, sound_id, candidate_sound_ids, character_name, intensity, emotion, review_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  };
}

export async function listBooks(): Promise<Book[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<BookRow>('SELECT * FROM books ORDER BY created_at DESC');
  return rows.map(rowToBook);
}
