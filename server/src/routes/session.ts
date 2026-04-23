import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../supabase/client.js';

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

  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from('users')
    .select('id, display_name')
    .eq('display_name_normalized', normalized)
    .maybeSingle();
  if (existingError) {
    return res.status(500).json({ error: existingError.message });
  }

  let userId = existing?.id;
  let userName = existing?.display_name || displayName;

  if (!existing) {
    userId = uuidv4();
    const { error: insertError } = await supabase.from('users').insert({
      id: userId,
      display_name: displayName,
      display_name_normalized: normalized,
      created_at: now,
      last_seen_at: now
    });
    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }
  } else {
    const { error: updateError } = await supabase.from('users').update({ last_seen_at: now }).eq('id', userId);
    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }
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
