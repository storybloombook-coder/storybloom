package com.storybloom.app.data

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.File

class StorybloomDatabase private constructor(context: Context) :
    SQLiteOpenHelper(context, DATABASE_NAME, null, SCHEMA_VERSION) {

    init {
        setWriteAheadLoggingEnabled(true)
    }

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.setForeignKeyConstraintsEnabled(true)
        db.rawQuery("PRAGMA busy_timeout = 4000", null).use { it.moveToFirst() }
    }

    override fun onCreate(db: SQLiteDatabase) {
        CREATE_STATEMENTS.forEach(db::execSQL)
        migrateColumns(db)
        writeSchemaVersion(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        CREATE_STATEMENTS.forEach(db::execSQL)
        migrateColumns(db)
        writeSchemaVersion(db)
    }

    override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // The v8 schema is additive and the native app intentionally remains
        // readable by the preceding Expo build. Never destructively recreate.
        migrateColumns(db)
        writeSchemaVersion(db)
    }

    override fun onOpen(db: SQLiteDatabase) {
        super.onOpen(db)
        // Expo stored its schema number in meta rather than PRAGMA user_version.
        // Running the idempotent checks here also repairs databases whose
        // user_version already happened to equal the native version.
        CREATE_STATEMENTS.forEach(db::execSQL)
        migrateColumns(db)
        writeSchemaVersion(db)
    }

    private fun migrateColumns(db: SQLiteDatabase) {
        ensureColumn(db, "books", "language", "TEXT NOT NULL DEFAULT 'en'")
        ensureColumn(db, "books", "is_favorite", "INTEGER NOT NULL DEFAULT 0")
        ensureColumn(db, "books", "shelf_position", "INTEGER")

        ensureColumn(db, "cues", "sound_start_ms", "INTEGER")
        ensureColumn(db, "cues", "sound_end_ms", "INTEGER")
        ensureColumn(db, "cues", "fade_in_ms", "INTEGER")
        ensureColumn(db, "cues", "fade_out_ms", "INTEGER")

        ensureColumn(db, "pages", "ambient_start_ms", "INTEGER")
        ensureColumn(db, "pages", "ambient_end_ms", "INTEGER")
        ensureColumn(db, "pages", "ambient_fade_in_ms", "INTEGER")
        ensureColumn(db, "pages", "ambient_fade_out_ms", "INTEGER")

        ensureColumn(db, "recordings", "origin_book_id", "TEXT")
        ensureColumn(db, "recordings", "origin_book_title", "TEXT")
        ensureColumn(db, "recordings", "origin_page_number", "INTEGER")
        ensureColumn(db, "recordings", "origin_label", "TEXT")
    }

    private fun ensureColumn(
        db: SQLiteDatabase,
        table: String,
        column: String,
        definition: String,
    ) {
        val exists = db.rawQuery("PRAGMA table_info($table)", null).use { cursor ->
            val nameIndex = cursor.getColumnIndex("name")
            var found = false
            while (cursor.moveToNext()) {
                if (cursor.getString(nameIndex) == column) {
                    found = true
                    break
                }
            }
            found
        }
        if (!exists) db.execSQL("ALTER TABLE $table ADD COLUMN $column $definition")
    }

    private fun writeSchemaVersion(db: SQLiteDatabase) {
        db.execSQL(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
            arrayOf(SCHEMA_VERSION.toString()),
        )
    }

    companion object {
        const val DATABASE_NAME = "storybloom.db"
        const val SCHEMA_VERSION = 8

        fun open(context: Context): StorybloomDatabase {
            migrateLegacyExpoDatabase(context.applicationContext)
            return StorybloomDatabase(context.applicationContext)
        }

        /**
         * expo-sqlite stores databases below files/SQLite while
         * SQLiteOpenHelper uses databases/. On an in-place update, copy the
         * complete SQLite set before opening so books survive the native
         * migration. The source is left intact as a recovery copy.
         */
        private fun migrateLegacyExpoDatabase(context: Context) {
            val destination = context.getDatabasePath(DATABASE_NAME)
            if (destination.exists()) return

            val candidates = listOf(
                File(context.filesDir, "SQLite/$DATABASE_NAME"),
                File(context.filesDir, DATABASE_NAME),
            )
            val source = candidates.firstOrNull(File::exists) ?: return
            destination.parentFile?.mkdirs()
            source.copyTo(destination, overwrite = false)

            listOf("-wal", "-shm", "-journal").forEach { suffix ->
                val companion = File(source.path + suffix)
                if (companion.exists()) {
                    companion.copyTo(File(destination.path + suffix), overwrite = false)
                }
            }
        }

        private val CREATE_STATEMENTS = listOf(
            """
            CREATE TABLE IF NOT EXISTS books (
              id TEXT PRIMARY KEY NOT NULL,
              title TEXT NOT NULL,
              isbn TEXT,
              cover_image_path TEXT,
              created_at INTEGER NOT NULL,
              prep_status TEXT NOT NULL DEFAULT 'pending',
              has_dialogue INTEGER NOT NULL DEFAULT 0,
              review_status TEXT NOT NULL DEFAULT 'unreviewed',
              source TEXT NOT NULL DEFAULT 'photos',
              language TEXT NOT NULL DEFAULT 'en',
              is_favorite INTEGER NOT NULL DEFAULT 0,
              shelf_position INTEGER
            )
            """.trimIndent(),
            """
            CREATE TABLE IF NOT EXISTS pages (
              id TEXT PRIMARY KEY NOT NULL,
              book_id TEXT NOT NULL,
              page_number INTEGER NOT NULL,
              image_path TEXT NOT NULL,
              page_type TEXT NOT NULL DEFAULT 'story',
              embedded_text TEXT,
              ocr_text TEXT NOT NULL DEFAULT '',
              background_scene TEXT,
              ambient_sound_id TEXT,
              ambient_candidates TEXT NOT NULL DEFAULT '[]',
              ambient_start_ms INTEGER,
              ambient_end_ms INTEGER,
              ambient_fade_in_ms INTEGER,
              ambient_fade_out_ms INTEGER,
              FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
            )
            """.trimIndent(),
            """
            CREATE TABLE IF NOT EXISTS cues (
              id TEXT PRIMARY KEY NOT NULL,
              page_id TEXT NOT NULL,
              type TEXT NOT NULL,
              trigger_text TEXT NOT NULL,
              context_phrase TEXT,
              char_start INTEGER,
              char_end INTEGER,
              sound_id TEXT,
              candidate_sound_ids TEXT NOT NULL DEFAULT '[]',
              character_name TEXT,
              intensity TEXT,
              emotion TEXT,
              review_state TEXT NOT NULL DEFAULT 'proposed',
              sound_start_ms INTEGER,
              sound_end_ms INTEGER,
              fade_in_ms INTEGER,
              fade_out_ms INTEGER,
              FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
            )
            """.trimIndent(),
            "CREATE INDEX IF NOT EXISTS idx_pages_book ON pages (book_id, page_number)",
            "CREATE INDEX IF NOT EXISTS idx_cues_page ON cues (page_id)",
            """
            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY NOT NULL,
              value TEXT NOT NULL
            )
            """.trimIndent(),
            """
            CREATE TABLE IF NOT EXISTS recordings (
              id TEXT PRIMARY KEY NOT NULL,
              name TEXT NOT NULL,
              file_uri TEXT NOT NULL,
              duration_ms INTEGER,
              start_ms INTEGER,
              end_ms INTEGER,
              fade_in_ms INTEGER,
              fade_out_ms INTEGER,
              created_at INTEGER NOT NULL,
              origin_book_id TEXT,
              origin_book_title TEXT,
              origin_page_number INTEGER,
              origin_label TEXT
            )
            """.trimIndent(),
        )
    }
}

internal fun Cursor.stringOrNull(column: String): String? {
    val index = getColumnIndexOrThrow(column)
    return if (isNull(index)) null else getString(index)
}

internal fun Cursor.longOrNull(column: String): Long? {
    val index = getColumnIndexOrThrow(column)
    return if (isNull(index)) null else getLong(index)
}

internal fun Cursor.intOrNull(column: String): Int? {
    val index = getColumnIndexOrThrow(column)
    return if (isNull(index)) null else getInt(index)
}
