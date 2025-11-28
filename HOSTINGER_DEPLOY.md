Hostinger backend backup (Node.js + Prisma + Postgres/MySQL)
==========================================================

Included files
- package.json / package-lock.json
- tsconfig.json
- schema.prisma (Prisma schema; provider set to postgresql)
- schema.sql (DB schema for manual import)
- alter_users.sql (column align helper)
- src/ (Express routes, prisma client wrapper)
- .env.example (fill PORT, DATABASE_URL, ADMIN_MASTER, OLLAMA_* as needed)
- .gitignore

What this is for
Use this bundle to deploy the backend on Hostinger’s Node.js runner. It excludes node_modules and dist.

Quick deploy steps
1) Upload & unzip
   - Upload `backend-backup.zip` to your Hostinger Node app directory (e.g., `/backend`).
   - Unzip it there.

2) Env vars
   - Copy `.env.example` to `.env` and set values:
     PORT=4000
     DATABASE_URL=postgres://...  (or mysql://... if you switch provider back)
     ADMIN_MASTER=your_admin_master_code
     OLLAMA_HOST=http://localhost:11434  (optional)
     OLLAMA_MODEL=llama3              (optional)

3) Install & build
   - `npm install`
   - `npx prisma generate` (optional but recommended)
   - `npm run build`

4) Run
   - `npm start`
   Ensure the app binds to 0.0.0.0:PORT (server.ts already does).

5) Database
   - If using Postgres/Supabase: run `schema.prisma` via `prisma migrate` or use SQL to create tables (`schema.sql` is MySQL-like; adjust types for Postgres). Minimum tables needed for auth: users, ai_sessions; see prisma schema for full model.

Notes
- The current schema.prisma is set to `provider = "postgresql"`; change to mysql and rerun `prisma generate` if you want MySQL.
- Admin one-time code endpoints: POST /api/auth/admin/generate (master required), POST /api/auth/admin/status (single-use code). Set ADMIN_MASTER.
- API base for frontend: set VITE_API_URL to your backend URL and rebuild frontend separately.
