import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';

const router = Router();

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

router.post('/login', async (req, res) => {
  const rawName = typeof req.body?.name === 'string' ? req.body.name : '';
  const displayName = rawName.trim().slice(0, 80);
  const normalized = normalizeName(displayName);
  if (!displayName || normalized.length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters.' });
  }

  const db = await getDb();
  const now = new Date().toISOString();
  const existing = await db.get<{ id: string; display_name: string }>(
    'SELECT id, display_name FROM users WHERE display_name_normalized = ?',
    normalized
  );

  let userId = existing?.id;
  let userName = existing?.display_name || displayName;

  if (!existing) {
    userId = uuidv4();
    await db.run(
      'INSERT INTO users (id, display_name, display_name_normalized, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
      userId,
      displayName,
      normalized,
      now,
      now
    );
  } else {
    await db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', now, userId);
  }

  req.session.userId = userId;
  req.session.userName = userName;
  return res.json({ userId, userName });
});

router.get('/me', (req, res) => {
  if (!req.session.userId || !req.session.userName) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    userId: req.session.userId,
    userName: req.session.userName
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('co_design_sid');
    res.json({ ok: true });
  });
});

export default router;
