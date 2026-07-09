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

export const SCHEMA_VERSION = 1;

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
  source         TEXT NOT NULL DEFAULT 'photos'
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
  await db.runAsync(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
    [String(SCHEMA_VERSION)]
  );
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
  "prep_status", "has_dialogue", "review_status", "source",
] as const;

export const PAGE_COLUMNS = [
  "id", "book_id", "page_number", "image_path", "page_type",
  "embedded_text", "ocr_text", "background_scene",
  "ambient_sound_id", "ambient_candidates",
] as const;

export const CUE_COLUMNS = [
  "id", "page_id", "type", "trigger_text", "context_phrase",
  "char_start", "char_end", "sound_id", "candidate_sound_ids",
  "character_name", "intensity", "emotion", "review_state",
] as const;
