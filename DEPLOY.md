# Deployment Guide

## Overview

- Frontend (`creator.html`, `viewer.html`) is static and can be hosted on GitHub Pages.
- Backend (`server/`) must run on a separate host (Render/Railway/Fly/VPS) because it needs secrets and server-side APIs.

## 1) Deploy Frontend to GitHub Pages

1. Push this repository to GitHub.
2. In GitHub: `Settings -> Pages`.
3. Set:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
4. Save and wait for GitHub Pages to publish.

## 2) Deploy Backend

Deploy the `server/` app and set these env vars:

- `PORT=8787` (or host-provided port)
- `NODE_ENV=production`
- `SESSION_SECRET=<secure-random-string>`
- `CORS_ORIGINS=https://lenaarmstrong.github.io,http://localhost:5500,http://127.0.0.1:5500`
- `SESSION_COOKIE_SECURE=true` (recommended for HTTPS production)
- `GOOGLE_DRIVE_FOLDER_ID=<your-folder-id>`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<private-key-with-\n-escapes>`

## 3) Set Production Backend URL

`creator.html` and `viewer.html` now auto-select API base:

- Local (`localhost`): `http://localhost:8787`
- Non-local host: `https://YOUR_BACKEND_DOMAIN`

Before production, replace `https://YOUR_BACKEND_DOMAIN` in both files with your real backend URL.

## 4) Optional Runtime Override

Use `config.js` in repo root to set runtime API base for both `creator.html` and `viewer.html`:

```html
window.__API_BASE__ = 'https://your-backend-domain.com';
```

Both pages load `config.js` automatically, so you only set it once.

## 5) Verify

1. Open GitHub Pages URL.
2. Enter name/login on Creator.
3. Save preview.
4. Open Viewer and confirm previews load.
5. Confirm backend logs and (if enabled) Drive backup status.
