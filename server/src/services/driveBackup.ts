import fs from 'node:fs';
import path from 'node:path';
import { google, type drive_v3 } from 'googleapis';
import type { Database } from 'sqlite';
import { getDataDir } from '../config/paths.js';
import type { PreviewRecord } from '../types.js';

type BackupResult = {
  pngFileId: string;
  snapshotFileId: string;
};

let driveClient: drive_v3.Drive | null = null;
const DATA_DIR = getDataDir();

function getDriveConfig(): { folderId: string; email: string; privateKey: string } {
  return {
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '13qJOcCUDQZnzO9wP8mOyUwVYa4Cwnz72',
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  };
}

function hasDriveConfig(): boolean {
  const cfg = getDriveConfig();
  return Boolean(cfg.folderId && cfg.email && cfg.privateKey);
}

export function getDriveBackupStatus(): { configured: boolean; folderId: string; serviceAccountEmailSet: boolean; privateKeySet: boolean } {
  const cfg = getDriveConfig();
  return {
    configured: hasDriveConfig(),
    folderId: cfg.folderId,
    serviceAccountEmailSet: Boolean(cfg.email),
    privateKeySet: Boolean(cfg.privateKey)
  };
}

function getDriveClient(): drive_v3.Drive | null {
  if (!hasDriveConfig()) return null;
  const cfg = getDriveConfig();
  if (driveClient) return driveClient;
  const auth = new google.auth.JWT({
    email: cfg.email,
    key: cfg.privateKey,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

async function findOrCreateFolder(drive: drive_v3.Drive, parentId: string, folderName: string): Promise<string> {
  const escaped = folderName.replace(/'/g, "\\'");
  const list = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false and name = '${escaped}'`,
    fields: 'files(id,name)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  const existingId = list.data.files?.[0]?.id;
  if (existingId) return existingId;

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    },
    fields: 'id',
    supportsAllDrives: true
  });
  if (!created.data.id) throw new Error('Failed to create drive folder');
  return created.data.id;
}

async function uploadFile(drive: drive_v3.Drive, folderId: string, fileName: string, filePath: string, mimeType: string): Promise<string> {
  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId]
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath)
    },
    fields: 'id',
    supportsAllDrives: true
  });
  if (!created.data.id) throw new Error(`Failed to upload file ${fileName}`);
  return created.data.id;
}

async function backupPreview(preview: PreviewRecord, userDisplayName: string): Promise<BackupResult> {
  const drive = getDriveClient();
  if (!drive) throw new Error('Google Drive not configured');
  const cfg = getDriveConfig();

  const userFolder = await findOrCreateFolder(drive, cfg.folderId, userDisplayName);
  const previewFolder = await findOrCreateFolder(drive, userFolder, preview.id);

  const pngPath = path.join(DATA_DIR, preview.preview_png_path);
  const snapshotPath = path.join(DATA_DIR, `previews/${preview.id}.json`);

  const pngFileId = await uploadFile(drive, previewFolder, 'preview.png', pngPath, 'image/png');
  const snapshotFileId = await uploadFile(drive, previewFolder, 'snapshot.json', snapshotPath, 'application/json');

  return { pngFileId, snapshotFileId };
}

export async function processDriveBackupQueue(db: Database): Promise<void> {
  if (!hasDriveConfig()) return;
  const rows = await db.all<PreviewRecord[]>(
    "SELECT * FROM previews WHERE drive_backup_status IN ('pending', 'failed') ORDER BY created_at ASC LIMIT 10"
  );
  for (const row of rows) {
    const user = await db.get<{ display_name: string }>('SELECT display_name FROM users WHERE id = ?', row.user_id);
    if (!user?.display_name) continue;
    try {
      const ids = await backupPreview(row, user.display_name);
      await db.run(
        'UPDATE previews SET drive_backup_status = ?, drive_file_ids = ?, updated_at = ? WHERE id = ?',
        'done',
        JSON.stringify(ids),
        new Date().toISOString(),
        row.id
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.run(
        'UPDATE previews SET drive_backup_status = ?, drive_file_ids = ?, updated_at = ? WHERE id = ?',
        'failed',
        JSON.stringify({ error: message }),
        new Date().toISOString(),
        row.id
      );
      console.error('Drive backup failed for preview', row.id, message);
    }
  }
}
