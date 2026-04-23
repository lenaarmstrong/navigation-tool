import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { supabase, SUPABASE_PREVIEWS_BUCKET } from '../supabase/client.js';
import { processDriveBackupQueue } from '../services/driveBackup.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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
  const userName = rawName.trim().slice(0, 80);
  const normalized = normalizeName(userName);
  if (!userName || normalized.length < 2) {
    throw new Error('Name must be at least 2 characters.');
  }
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from('users')
    .select('id, display_name')
    .eq('display_name_normalized', normalized)
    .maybeSingle();
  if (existingError) {
    throw new Error(existingError.message);
  }
  if (existing) {
    const { error: updateError } = await supabase.from('users').update({ last_seen_at: now }).eq('id', existing.id);
    if (updateError) {
      throw new Error(updateError.message);
    }
    return { userId: existing.id, userName: existing.display_name };
  }
  const userId = uuidv4();
  const { error: insertError } = await supabase.from('users').insert({
    id: userId,
    display_name: userName,
    display_name_normalized: normalized,
    created_at: now,
    last_seen_at: now
  });
  if (insertError) {
    throw new Error(insertError.message);
  }
  return { userId, userName };
}

function buildPublicUrl(storagePath: string | null): string | null {
  if (!storagePath) return null;
  const { data } = supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl || null;
}

router.get('/', async (req, res) => {
  const userName = typeof req.query.userName === 'string' ? req.query.userName.trim() : '';
  const normalized = normalizeName(userName);
  let query = supabase
    .from('previews')
    .select(
      'id, title, annotations_json, preview_png_path, thumbnail_png_path, drive_backup_status, created_at, updated_at, user_id, users!inner(display_name, display_name_normalized)'
    )
    .order('created_at', { ascending: false });
  if (normalized) {
    query = query.eq('users.display_name_normalized', normalized);
  }
  const { data: rows, error } = await query;
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const previews = (rows || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    dataUrl: buildPublicUrl(row.thumbnail_png_path) || buildPublicUrl(row.preview_png_path),
    previewPngUrl: buildPublicUrl(row.preview_png_path),
    annotations: parseJson(row.annotations_json),
    userId: row.user_id,
    userDisplayName: row.users?.display_name || '',
    driveBackupStatus: row.drive_backup_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  res.json({ previews });
});

router.get('/:id', async (req, res) => {
  const { data: row, error } = await supabase
    .from('previews')
    .select(
      'id, title, annotations_json, preview_png_path, thumbnail_png_path, drive_backup_status, drive_file_ids, created_at, updated_at, user_id, users!inner(display_name)'
    )
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  if (!row) {
    return res.status(404).json({ error: 'Preview not found' });
  }
  res.json({
    id: row.id,
    title: row.title,
    dataUrl: buildPublicUrl(row.thumbnail_png_path) || buildPublicUrl(row.preview_png_path),
    previewPngUrl: buildPublicUrl(row.preview_png_path),
    annotations: parseJson(row.annotations_json),
    userId: row.user_id,
    userDisplayName: (row as any).users?.display_name || '',
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
  const previewStoragePath = `${userId}/${previewId}.png`;
  const { error: previewUploadError } = await supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).upload(previewStoragePath, previewPngFile.buffer, {
    contentType: previewPngFile.mimetype || 'image/png',
    upsert: true
  });
  if (previewUploadError) {
    return res.status(500).json({ error: previewUploadError.message });
  }

  let thumbnailPath: string | null = null;
  if (thumbnailFile) {
    thumbnailPath = `${userId}/${previewId}-thumb.jpg`;
    const { error: thumbUploadError } = await supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).upload(thumbnailPath, thumbnailFile.buffer, {
      contentType: thumbnailFile.mimetype || 'image/jpeg',
      upsert: true
    });
    if (thumbUploadError) {
      await supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).remove([previewStoragePath]);
      return res.status(500).json({ error: thumbUploadError.message });
    }
  }

  const payload = {
    ...annotations,
    userId,
    userDisplayName: userName
  };
  const now = new Date().toISOString();
  const { error: insertError } = await supabase.from('previews').insert({
    id: previewId,
    user_id: userId,
    title,
    annotations_json: JSON.stringify(payload),
    preview_png_path: previewStoragePath,
    thumbnail_png_path: thumbnailPath,
    drive_backup_status: 'pending',
    drive_file_ids: null,
    created_at: now,
    updated_at: now
  });
  if (insertError) {
    await supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).remove([previewStoragePath, thumbnailPath || ''].filter(Boolean));
    return res.status(500).json({ error: insertError.message });
  }

  // Try to back up immediately so users don't have to wait for the interval worker.
  processDriveBackupQueue().catch((error) => {
    console.error('Immediate Drive backup failed', error);
  });

  const previewPngUrl = buildPublicUrl(previewStoragePath);
  const thumbnailUrl = buildPublicUrl(thumbnailPath);
  res.status(201).json({
    id: previewId,
    title,
    dataUrl: thumbnailUrl || previewPngUrl,
    previewPngUrl,
    annotations: payload,
    userId,
    userDisplayName: userName,
    driveBackupStatus: 'pending',
    createdAt: now,
    updatedAt: now
  });
});

router.delete('/:id', async (req, res) => {
  const { data: row, error: rowError } = await supabase
    .from('previews')
    .select('id, preview_png_path, thumbnail_png_path')
    .eq('id', req.params.id)
    .maybeSingle();
  if (rowError) {
    return res.status(500).json({ error: rowError.message });
  }
  if (!row) {
    return res.status(404).json({ error: 'Preview not found' });
  }

  const { error: deleteError } = await supabase.from('previews').delete().eq('id', req.params.id);
  if (deleteError) {
    return res.status(500).json({ error: deleteError.message });
  }
  const storageFiles = [
    row.preview_png_path,
    row.thumbnail_png_path
  ].filter(Boolean) as string[];
  if (storageFiles.length) {
    await supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).remove(storageFiles);
  }

  res.json({ ok: true });
});

export default router;
