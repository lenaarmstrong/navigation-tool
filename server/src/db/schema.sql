PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    display_name_normalized TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS previews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    annotations_json TEXT NOT NULL,
    preview_png_path TEXT NOT NULL,
    thumbnail_png_path TEXT,
    drive_backup_status TEXT NOT NULL DEFAULT 'pending',
    drive_file_ids TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_previews_user_id ON previews(user_id);
CREATE INDEX IF NOT EXISTS idx_previews_created_at ON previews(created_at);
