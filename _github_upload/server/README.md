# Streamer Manager — server

Real backend: verifies the Admin login server-side (the password is never in shipped code)
and proxies the Google Sheet server-side (the sheet ID and gids are never in shipped code
either). Serves the existing static client from `../streamer-manager` unchanged.

## Run locally

```bash
cd server
npm install
cp .env.example .env
# fill in .env: JWT_SECRET, ADMIN_USERS, GOOGLE_SHEET_ID (see comments in .env.example)
npm start
```

Open http://localhost:3000 — Dashboard/Live/Setup Queue work immediately; Admin/Summary need
a login from `ADMIN_USERS`.

Generate a password hash for `ADMIN_USERS` (never put a plain password in the env var):

```bash
node hash-password.js "the password"
```

## Deploy on Railway

1. In the Railway service settings, set **Root Directory** to `server`.
2. Set the same three variables from `.env.example` under **Variables** (`JWT_SECRET`,
   `ADMIN_USERS`, `GOOGLE_SHEET_ID`) — Railway sets `PORT` itself, leave that one out.
3. Push to the repo Railway watches; it builds with Nixpacks and runs `npm start`
   (see `railway.json`).

## What changed vs. the old static-only deployment

- `js/auth.js` now calls `/api/login` · `/api/logout` · `/api/session` on this server instead
  of checking a hardcoded ID/password in the browser.
- `js/db.js`'s schedule/setup sync now calls `/api/sheet/schedule` and `/api/sheet/setup` on
  this server instead of fetching the Google Sheet CSV export directly — the sheet ID and every
  tab's gid moved from `js/db.js` into this server (`index.js`), so they no longer ship to the
  browser at all.
- `build_standalone.ps1`'s single-file bundling is no longer needed for this deployment — the
  server serves the individual files in `streamer-manager/` directly. It's still useful if
  GitHub Pages stays up as a public-only mirror (see the project's Security Information section
  for that decision) — GitHub Pages can't run this server, so Admin/Summary simply won't work
  there once this ships, which is the intended, safe fallback rather than a bug.

## Notes

- `/api/sheet/*` is intentionally not behind login — Dashboard/Live/Setup Queue are public
  pages and need this data without a login. The security win isn't hiding the schedule; it's
  that the actual spreadsheet (ID, other tabs, edit history, extra columns) is no longer
  directly reachable via the old public export link.
- Firebase Realtime Database (streamer records, tournament flags) still has open read/write
  rules — out of scope for this pass, tracked as a follow-up.
