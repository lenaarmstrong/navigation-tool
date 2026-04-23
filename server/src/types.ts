import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    userName?: string;
  }
}

export type PreviewRecord = {
  id: string;
  user_id: string;
  title: string;
  annotations_json: string;
  preview_png_path: string;
  thumbnail_png_path: string | null;
  drive_backup_status: 'pending' | 'done' | 'failed';
  drive_file_ids: string | null;
  created_at: string;
  updated_at: string;
};
