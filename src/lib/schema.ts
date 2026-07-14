// schema.ts — Storybloom local SQLite schema (expo-sqlite)
//
// Standalone: pure SQL + a tiny init helper. No device features used beyond
// opening the DB. Matches types.ts. Local-only storage (v1 has no backend).
//
// Usage (in the app, once expo-sqlite is installed):
//   import * as SQLite from "expo-sqlite";
//   import { initDatabase } from "./schema";
//   const db = await SQLite.openDatabaseAsync("storybloom.db");
//   await initDatabase(db);

export const SCHEMA_VERSION = 6;

// Notes on design:
// - Arrays (ambientCandidates, candidateSoundIds) are stored as JSON strings.
//   SQLite has no array type; JSON is simplest and these lists are short.
// - Booleans stored as INTEGER 0/1 (SQLite convention).
// - camelCase in TS <-> snake_case columns; map at the data-access layer.
// - ON DELETE CASCADE so deleting a book removes its pages and cues cleanly.

export const CREATE_TABLES_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS books (
  id             TEXT PRIMARY KEY NOT NULL,
  title          TEXT NOT NULL,
  isbn           TEXT,
  cover_image_path TEXT,
  created_at     INTEGER NOT NULL,
  prep_status    TEXT NOT NULL DEFAULT 'pending',
  has_dialogue   INTEGER NOT NULL DEFAULT 0,
  review_status  TEXT NOT NULL DEFAULT 'unreviewed',
  source         TEXT NOT NULL DEFAULT 'photos',
  language       TEXT NOT NULL DEFAULT 'en',
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  -- Left-to-right position on the favorites bookshelf. Null until a book is
  -- first favorited; NULLs sort after any set position (see listBookSummaries)
  -- so a newly-favorited book joins at the shelf's right end.
  shelf_position INTEGER
);

CREATE TABLE IF NOT EXISTS pages (
  id                 TEXT PRIMARY KEY NOT NULL,
  book_id            TEXT NOT NULL,
  page_number        INTEGER NOT NULL,
  image_path         TEXT NOT NULL,
  page_type          TEXT NOT NULL DEFAULT 'story',
  embedded_text      TEXT,
  ocr_text           TEXT NOT NULL DEFAULT '',
  background_scene   TEXT,
  ambient_sound_id   TEXT,
  ambient_candidates TEXT NOT NULL DEFAULT '[]',
  -- Trim/fade envelope, only meaningful for a "custom:<uri>" recorded
  -- ambient_sound_id. Null for library sounds (played in full, no fade).
  ambient_start_ms    INTEGER,
  ambient_end_ms      INTEGER,
  ambient_fade_in_ms  INTEGER,
  ambient_fade_out_ms INTEGER,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cues (
  id                  TEXT PRIMARY KEY NOT NULL,
  page_id             TEXT NOT NULL,
  type                TEXT NOT NULL,
  trigger_text        TEXT NOT NULL,
  context_phrase      TEXT,
  char_start          INTEGER,
  char_end            INTEGER,
  sound_id            TEXT,
  candidate_sound_ids TEXT NOT NULL DEFAULT '[]',
  character_name      TEXT,
  intensity           TEXT,
  emotion             TEXT,
  review_state        TEXT NOT NULL DEFAULT 'proposed',
  -- Trim/fade envelope, only meaningful for a "custom:<uri>" recorded sound_id.
  -- Null for library sounds (played in full, no fade).
  sound_start_ms      INTEGER,
  sound_end_ms        INTEGER,
  fade_in_ms          INTEGER,
  fade_out_ms         INTEGER,
  FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pages_book   ON pages (book_id, page_number);
CREATE INDEX IF NOT EXISTS idx_cues_page    ON cues  (page_id);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

/**
 * Initialize the database: create tables and record the schema version.
 * `db` is an expo-sqlite SQLiteDatabase (async API). Typed as any here so this
 * file has no dependency to install — the app supplies the real db handle.
 */
export async function initDatabase(db: any): Promise<void> {
  await db.execAsync(CREATE_TABLES_SQL);
  await migrateSchema(db);
  await db.runAsync(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
    [String(SCHEMA_VERSION)]
  );
}

/** `CREATE TABLE IF NOT EXISTS` only helps fresh installs — a table that
 *  already existed before a column was added needs an explicit ALTER TABLE.
 *  No formal migration framework yet, so just check PRAGMA table_info and
 *  patch anything missing. Safe to run on every startup. */
async function migrateSchema(db: any): Promise<void> {
  const bookCols: Array<{ name: string }> = await db.getAllAsync('PRAGMA table_info(books)');
  if (!bookCols.some((c) => c.name === 'language')) {
    await db.execAsync("ALTER TABLE books ADD COLUMN language TEXT NOT NULL DEFAULT 'en'");
  }
  if (!bookCols.some((c) => c.name === 'is_favorite')) {
    await db.execAsync('ALTER TABLE books ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0');
  }
  if (!bookCols.some((c) => c.name === 'shelf_position')) {
    await db.execAsync('ALTER TABLE books ADD COLUMN shelf_position INTEGER');
    // Backfill: books already favorited before this column existed get a
    // stable position now (oldest-favorited first) instead of sitting at
    // NULL indefinitely.
    const alreadyFavorited: Array<{ id: string }> = await db.getAllAsync(
      'SELECT id FROM books WHERE is_favorite = 1 ORDER BY created_at ASC'
    );
    for (let i = 0; i < alreadyFavorited.length; i++) {
      await db.runAsync('UPDATE books SET shelf_position = ? WHERE id = ?', [i, alreadyFavorited[i].id]);
    }
  }

  const cueCols: Array<{ name: string }> = await db.getAllAsync('PRAGMA table_info(cues)');
  const cueColNames = new Set(cueCols.map((c) => c.name));
  for (const col of ['sound_start_ms', 'sound_end_ms', 'fade_in_ms', 'fade_out_ms']) {
    if (!cueColNames.has(col)) {
      await db.execAsync(`ALTER TABLE cues ADD COLUMN ${col} INTEGER`);
    }
  }

  const pageCols: Array<{ name: string }> = await db.getAllAsync('PRAGMA table_info(pages)');
  const pageColNames = new Set(pageCols.map((c) => c.name));
  for (const col of ['ambient_start_ms', 'ambient_end_ms', 'ambient_fade_in_ms', 'ambient_fade_out_ms']) {
    if (!pageColNames.has(col)) {
      await db.execAsync(`ALTER TABLE pages ADD COLUMN ${col} INTEGER`);
    }
  }
}

// Helpers to (de)serialize the JSON-array columns. Use these at the
// data-access layer so the rest of the app works with real arrays.
export function serializeStringArray(arr: string[] | null | undefined): string {
  return JSON.stringify(arr ?? []);
}

export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Convenience column lists (handy when writing row<->object mappers).
export const BOOK_COLUMNS = [
  "id", "title", "isbn", "cover_image_path", "created_at",
  "prep_status", "has_dialogue", "review_status", "source", "language", "is_favorite",
  "shelf_position",
] as const;

export const PAGE_COLUMNS = [
  "id", "book_id", "page_number", "image_path", "page_type",
  "embedded_text", "ocr_text", "background_scene",
  "ambient_sound_id", "ambient_candidates",
  "ambient_start_ms", "ambient_end_ms", "ambient_fade_in_ms", "ambient_fade_out_ms",
] as const;

export const CUE_COLUMNS = [
  "id", "page_id", "type", "trigger_text", "context_phrase",
  "char_start", "char_end", "sound_id", "candidate_sound_ids",
  "character_name", "intensity", "emotion", "review_state",
  "sound_start_ms", "sound_end_ms", "fade_in_ms", "fade_out_ms",
] as const;
