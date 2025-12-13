# Pasus Backend (MySQL)

Node/Express backend for Pasus with MySQL (mysql2).

## Env vars
Create `.env`:
```
PORT=4000
DATABASE_URL=mysql://u453050691_pasus:Pasusdatabase2@auth-db1698.hstgr.io:3306/u453050691_pasus_db
ADMIN_MASTER=PASUS_MASTER_KEY_845421FAD54AFAWF
SKIP_MEMBERSHIP_CHECK=true   # optional: allow posting even if membership not recorded (dev)
```

## Install & run
```
npm install
npm run build
npm start
```

## API
- `POST /api/auth/register` { email, password, username }
- `POST /api/auth/login` { email, password }
- `POST /api/auth/ping` { userId }
- `POST /api/auth/admin/generate` { master } (master=ADMIN_MASTER) → one-time admin code
- `POST /api/auth/admin/status` { adminCode, userId, status: good|warned|banned }
- `POST /api/chat` { messages, model?, userId? } → proxies to Ollama, stores ai_sessions
- `GET /api/servers` lists servers/channels
- `POST /api/servers` { name, icon?, ownerId }
- Forum: `GET /api/forum/posts`, `POST /api/forum/posts`, `POST /api/forum/posts/:id/vote`, `POST /api/forum/posts/:id/comments`
- Wrapped: `GET /api/wrapped/:year` returns yearly totals + top contacts/servers (built from analytics tables).

## Notes
- Uses `mysql2` pool in `src/db.ts`.
- Frontend must set `VITE_API_URL` to this backend.
- Admin code: generate once per session via `/api/auth/admin/generate`, then use it in `/adminpanel` frontend.
- SPA rewrite needed on frontend host to serve `index.html` for all routes.

## Analytics jobs
See `docs/analytics-wrapped.md` for schema, jobs, and manual run commands (`npm run analytics:*`). Set `ANALYTICS_JOBS_ENABLED=true` to enable scheduled aggregation on startup.
- Backfill historical channel messages into `message_events`: `npm run backfill:messages`.
