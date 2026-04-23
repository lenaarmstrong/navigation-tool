import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_DATA_DIR = path.join(SERVER_ROOT, 'data');

export function getDataDir(): string {
  const configured = String(process.env.DATA_DIR || '').trim();
  if (!configured) return DEFAULT_DATA_DIR;
  if (path.isAbsolute(configured)) return configured;
  return path.resolve(SERVER_ROOT, configured);
}

