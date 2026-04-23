import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, type Database } from 'sqlite';
import sqlite3 from 'sqlite3';

let dbInstance: Database | null = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const dataDir = path.resolve(__dirname, '../../data');
  await fs.mkdir(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'app.sqlite');
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schemaSql = await fs.readFile(schemaPath, 'utf-8');

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(schemaSql);
  dbInstance = db;
  return db;
}
