# GlassQuiz ✨

A real-time interactive quiz application inspired by **Kahoot** and **Slido**, styled with a **Glassmorphic (Glassy)** UI using **Vue 3**, **NestJS**, **Socket.IO**, and **PostgreSQL**.

---

## Tech Stack
- **Frontend**: Vue 3 (`<script setup lang="ts">`), Pinia, Tailwind CSS, Canvas-Confetti, Socket.IO Client
- **Backend**: NestJS, WebSockets (`@nestjs/websockets` + Socket.IO), Prisma ORM, HS256 JWT + `scrypt` Auth
- **Database**: PostgreSQL (shared `local-postgres` Docker container, database `quiz_db`) + Redis container ready for multi-node scaling
- **Production Proxy**: Nginx serving SPA static files and proxying `/api/` + `/socket.io/`

---

## Project Documentation
- [PROPOSAL.md](./PROPOSAL.md) — Architecture, production-testing scope, and future phases
- [MILESTONES.md](./MILESTONES.md) — Feature & hardening checklist
- [DECISIONS.md](./DECISIONS.md) — Architecture Decision Records (ADRs)
- [AI_LOG.md](./AI_LOG.md) — Audit & implementation log
- [deploy/DEPLOYMENT.md](./deploy/DEPLOYMENT.md) — Ubuntu + GitHub CI/CD & GHCR production deployment guide

---

## Quick Start (Sharing Your Existing `local-postgres` Docker DB)

Your existing Docker container `local-postgres` (`postgres:18-alpine` on port `5432`, network `postgresql_default`) hosts the dedicated `quiz_db` database.

### Option A: Local Development (`npm`)

1. **Ensure `local-postgres` is running** (and `quiz_db` exists):
   ```powershell
   docker ps --filter "name=local-postgres"
   ```
2. **Backend setup & run** (in `backend/`):
   ```powershell
   cd backend
   npm install
   npx prisma migrate deploy
   npm run prisma:seed
   npm run start:dev
   ```
   Backend listens on **http://localhost:3000** (health check: **http://localhost:3000/health**).

3. **Frontend setup & run** (in `frontend/`):
   ```powershell
   cd frontend
   npm install
   npm run dev
   ```
   Frontend opens on **http://localhost:5173** and proxies `/api` + `/socket.io` automatically (also works from phones on the same Wi-Fi using your machine's LAN IP).

---

### Option B: Local Docker Testing (`docker compose` at root)

Runs the compiled NestJS backend, Nginx-served Vue frontend, and Redis while connecting directly to your existing `local-postgres` container over the external `postgresql_default` network:

1. Verify root `.env` is configured (see `.env.example` — replace `JWT_SECRET` with a strong 32+ character secret before exposing publicly).
2. Build and start the stack:
   ```powershell
   docker compose up -d --build
   ```
3. Open **http://localhost:8080** in your browser.
4. Check backend health:
   ```powershell
   curl http://localhost:3000/health
   ```

### Option C: Production Deployment (`deploy/` + GitHub Actions)

For production Ubuntu deployment sharing a server PostgreSQL instance alongside other apps (Nginx gateway on `:4950`, rate limiting, automated backups, and GitHub Container Registry CI/CD), see [deploy/DEPLOYMENT.md](./deploy/DEPLOYMENT.md).

---

## Testing & Verification

- **Backend unit tests & strict TypeScript build**:
  ```powershell
  cd backend
  npm test
  ```
- **Frontend typecheck & production bundle**:
  ```powershell
  cd frontend
  npm run build
  ```

---

## How to Play a Live Quiz

1. Open **http://localhost:5173** (dev) or **http://localhost:8080** (Docker production testing).
2. Go to **📚 Quiz Library** and click **Host Live Game 🚀** on any public quiz (or click **🔑 Host Sign In** to register an account and create/edit/delete custom quizzes).
3. On **📺 Host Screen**, share the 6-digit PIN or click **🔗 Copy Invite Link** (`/play?pin=XXXXXX`).
4. Open the invite link in another tab or on a mobile phone, enter a nickname, and join the lobby.
5. Click **Start Game** on the Host screen!
