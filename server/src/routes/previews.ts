import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import { processDriveBackupQueue } from '../services/driveBackup.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const PREVIEWS_DIR = path.join(DATA_DIR, 'previews');

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

async function ensureUserByName(rawName: string): Promise<{ userId: string; userName: string }> {
  const db = await getDb();
  const userName = rawName.trim().slice(0, 80);
  const normalized = normalizeName(userName);
  if (!userName || normalized.length < 2) {
    throw new Error('Name must be at least 2 characters.');
  }
  const now = new Date().toISOString();
  const existing = await db.get<{ id: string; display_name: string }>(
    'SELECT id, display_name FROM users WHERE display_name_normalized = ?',
    normalized
  );
  if (existing) {
    await db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', now, existing.id);
    return { userId: existing.id, userName: existing.display_name };
  }
  const userId = uuidv4();
  await db.run(
    'INSERT INTO users (id, display_name, display_name_normalized, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    userId,
    userName,
    normalized,
    now,
    now
  );
  return { userId, userName };
}

router.get('/', async (req, res) => {
  const db = await getDb();
  const userName = typeof req.query.userName === 'string' ? req.query.userName.trim() : '';
  const normalized = normalizeName(userName);
  let rows: any[] = [];
  if (normalized) {
    rows = await db.all<any[]>(
      `SELECT p.id, p.title, p.annotations_json, p.preview_png_path, p.thumbnail_png_path, p.drive_backup_status, p.created_at, p.updated_at,
              u.id as user_id, u.display_name as user_name
       FROM previews p
       JOIN users u ON u.id = p.user_id
       WHERE u.display_name_normalized = ?
       ORDER BY p.created_at DESC`,
      normalized
    );
  } else {
    rows = await db.all<any[]>(
      `SELECT p.id, p.title, p.annotations_json, p.preview_png_path, p.thumbnail_png_path, p.drive_backup_status, p.created_at, p.updated_at,
              u.id as user_id, u.display_name as user_name
       FROM previews p
       JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC`
    );
  }

  const previews = rows.map((row) => ({
    id: row.id,
    title: row.title,
    dataUrl: row.thumbnail_png_path ? `/uploads/${row.thumbnail_png_path}` : `/uploads/${row.preview_png_path}`,
    previewPngUrl: `/uploads/${row.preview_png_path}`,
    annotations: parseJson(row.annotations_json),
    userId: row.user_id,
    userDisplayName: row.user_name,
    driveBackupStatus: row.drive_backup_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  res.json({ previews });
});

router.get('/:id', async (req, res) => {
  const db = await getDb();
  const row = await db.get<any>(
    `SELECT p.id, p.title, p.annotations_json, p.preview_png_path, p.thumbnail_png_path, p.drive_backup_status, p.drive_file_ids, p.created_at, p.updated_at,
            u.id as user_id, u.display_name as user_name
     FROM previews p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = ?`,
    req.params.id
  );
  if (!row) {
    return res.status(404).json({ error: 'Preview not found' });
  }
  res.json({
    id: row.id,
    title: row.title,
    dataUrl: row.thumbnail_png_path ? `/uploads/${row.thumbnail_png_path}` : `/uploads/${row.preview_png_path}`,
    previewPngUrl: `/uploads/${row.preview_png_path}`,
    annotations: parseJson(row.annotations_json),
    userId: row.user_id,
    userDisplayName: row.user_name,
    driveBackupStatus: row.drive_backup_status,
    driveFileIds: parseJson(row.drive_file_ids || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
});

router.post('/', upload.fields([{ name: 'previewPng', maxCount: 1 }, { name: 'thumbnailPng', maxCount: 1 }]), async (req, res) => {
  const title = (typeof req.body?.title === 'string' ? req.body.title : 'Map Preview').trim().slice(0, 120) || 'Map Preview';
  const userNameInput = typeof req.body?.userName === 'string' ? req.body.userName : '';
  const annotationsJsonRaw = typeof req.body?.annotationsJson === 'string' ? req.body.annotationsJson : '';
  const annotations = parseJson<any>(annotationsJsonRaw);
  if (!annotations) {
    return res.status(400).json({ error: 'Invalid annotations JSON' });
  }
  let userId = '';
  let userName = '';
  try {
    const user = await ensureUserByName(userNameInput);
    userId = user.userId;
    userName = user.userName;
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Invalid user name' });
  }

  const files = req.files as Record<string, Express.Multer.File[]>;
  const previewPngFile = files?.previewPng?.[0];
  if (!previewPngFile) {
    return res.status(400).json({ error: 'Missing preview PNG file.' });
  }
  const thumbnailFile = files?.thumbnailPng?.[0] || null;

  const previewId = uuidv4();
  await fs.mkdir(PREVIEWS_DIR, { recursive: true });

  const previewPngName = `${previewId}.png`;
  const previewPngPath = path.join(PREVIEWS_DIR, previewPngName);
  await fs.writeFile(previewPngPath, previewPngFile.buffer);

  let thumbnailName: string | null = null;
  if (thumbnailFile) {
    thumbnailName = `${previewId}-thumb.jpg`;
    await fs.writeFile(path.join(PREVIEWS_DIR, thumbnailName), thumbnailFile.buffer);
  }

  const payload = {
    ...annotations,
    userId,
    userDisplayName: userName
  };
  await fs.writeFile(path.join(PREVIEWS_DIR, `${previewId}.json`), JSON.stringify(payload), 'utf-8');

  const now = new Date().toISOString();
  const db = await getDb();
  await db.run(
    `INSERT INTO previews (id, user_id, title, annotations_json, preview_png_path, thumbnail_png_path, drive_backup_status, drive_file_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    previewId,
    userId,
    title,
    JSON.stringify(payload),
    `previews/${previewPngName}`,
    thumbnailName ? `previews/${thumbnailName}` : null,
    'pending',
    null,
    now,
    now
  );

  // Try to back up immediately so users don't have to wait for the interval worker.
  processDriveBackupQueue(db).catch((error) => {
    console.error('Immediate Drive backup failed', error);
  });

  res.status(201).json({
    id: previewId,
    title,
    dataUrl: thumbnailName ? `/uploads/previews/${thumbnailName}` : `/uploads/previews/${previewPngName}`,
    previewPngUrl: `/uploads/previews/${previewPngName}`,
    annotations: payload,
    userId,
    userDisplayName: userName,
    driveBackupStatus: 'pending',
    createdAt: now,
    updatedAt: now
  });
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const row = await db.get<any>(
    'SELECT id, preview_png_path, thumbnail_png_path FROM previews WHERE id = ?',
    req.params.id
  );
  if (!row) {
    return res.status(404).json({ error: 'Preview not found' });
  }

  await db.run('DELETE FROM previews WHERE id = ?', req.params.id);

  const files = [
    row.preview_png_path,
    row.thumbnail_png_path,
    `previews/${row.id}.json`
  ].filter(Boolean) as string[];
  await Promise.all(
    files.map(async (relativePath) => {
      try {
        await fs.unlink(path.join(DATA_DIR, relativePath));
      } catch {
        // best effort cleanup
      }
    })
  );

  res.json({ ok: true });
});

export default router;
