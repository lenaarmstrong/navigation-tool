import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import { getDb } from './db/index.js';
import sessionRoutes from './routes/session.js';
import previewRoutes from './routes/previews.js';
import { getDataDir } from './config/paths.js';
import { getDriveBackupStatus, processDriveBackupQueue } from './services/driveBackup.js';
import './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = Number(process.env.PORT || 8787);
const isProduction = process.env.NODE_ENV === 'production';
const configuredOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const allowedOrigins = configuredOrigins.length
  ? configuredOrigins
  : ['https://lenaarmstrong.github.io', 'http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:8787'];
const cookieSecure =
  process.env.SESSION_COOKIE_SECURE === 'true' ||
  (isProduction && process.env.SESSION_COOKIE_SECURE !== 'false');
const cookieSameSite: 'lax' | 'none' = cookieSecure ? 'none' : 'lax';

if (isProduction) {
  app.set('trust proxy', 1);
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests from server-side tools and explicitly allowed browser origins.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: 'co_design_sid',
    secret: process.env.SESSION_SECRET || 'change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      maxAge: 1000 * 60 * 60 * 24 * 30
    }
  })
);

app.get('/', (_req, res) => {
  res.type('html').send(
    [
      '<!doctype html>',
      '<html><head><meta charset="utf-8"><title>Co-Design Tool API</title></head><body>',
      '<h1>Co-Design Tool Backend</h1>',
      '<p>API is running.</p>',
      '<ul>',
      '<li><a href="/health">GET /health</a></li>',
      '<li>Session API: <code>/api/session/*</code></li>',
      '<li>Previews API: <code>/api/previews/*</code></li>',
      '</ul>',
      '<p>Open <code>creator.html</code> or <code>viewer.html</code> from the project root for the app UI.</p>',
      '</body></html>'
    ].join('')
  );
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/backup-status', (_req, res) => {
  res.json(getDriveBackupStatus());
});

app.use('/api/session', sessionRoutes);
app.use('/api/previews', previewRoutes);

const uploadsRoot = getDataDir();
app.use('/uploads', express.static(uploadsRoot));

async function start(): Promise<void> {
  const db = await getDb();
  const backupStatus = getDriveBackupStatus();
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
    console.log(`Using data directory: ${uploadsRoot}`);
    if (!backupStatus.configured) {
      console.warn(
        'Google Drive backup is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in server/.env'
      );
    }
  });
  setInterval(() => {
    processDriveBackupQueue(db).catch((error) => {
      console.error('Drive backup queue failed', error);
    });
  }, 60_000);
  processDriveBackupQueue(db).catch((error) => {
    console.error('Initial Drive backup queue failed', error);
  });
}

start().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
