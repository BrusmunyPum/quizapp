# GlassQuiz — AI Engineering & Audit Log

## 2026-11-18 — Pre-Production Audit & Hardening Pass

### 1. Audit Summary (Findings Prior to Fixes)
- **Deployment / Config Blockers:**
  - Frontend hardcoded `http://localhost:3000` in `gameStore.ts` and `QuizEditor.vue`.
  - No Prisma migration folder (`backend/prisma/migrations/`) existed, and `backend/.env` (`app_db`) did not align with `docker-compose.yml` (`quiz_db`), which also clashed with existing `local-postgres` on port `5432`.
  - Backend did not load `.env` in production `node dist/main.js` startup, used `origin: '*'` with `credentials: true` in CORS, and lacked Dockerfiles, Nginx proxy, and `/health`.
- **Correctness & Security Bugs:**
  - `GET /quizzes` and `GET /quizzes/:id` leaked `isCorrect` answer flags.
  - `QuizzesService.create()` pushed to `mockQuizzes` AND inserted into PostgreSQL, producing duplicate quiz entries on `findAll()`.
  - Prisma queries did not sort `options` by `orderIndex`.
  - `GameService` / `GameGateway` lacked state-transition guards, time-limit expiration enforcement, blank nickname checks, >4 option UI support, and host/player disconnect/reconnect recovery.
  - `backend/tsconfig.json` disabled `strictNullChecks` and `noImplicitAny`.

### 2. Changes Implemented
- **Database & Docker Integration:**
  - Created `quiz_db` database inside existing `local-postgres` Docker container (`postgres:18-alpine`).
  - Updated `backend/prisma/schema.prisma` (non-unique indexed `Room.pinCode` to avoid historical PIN collisions, `@@unique([participantId, questionId])` on `ParticipantAnswer`, ordering indexes, `updatedAt` on `Quiz`).
  - Applied Prisma migration `20261118030329_init` and created `backend/prisma/seed.ts` + startup auto-seeding.
  - Added `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, and updated `docker-compose.yml` to share `local-postgres` on `postgresql_default`.
- **Backend Hardening (`backend/src/`):**
  - Enabled `strict: true`, `strictNullChecks: true`, `noImplicitAny: true` in `backend/tsconfig.json`.
  - Added `config/env.ts` (`loadEnvFileOnce`, strict prod `JWT_SECRET` check, CORS allowlist), `health/health.controller.ts` (`GET /health`), and `auth/` (`scrypt` + HS256 JWT).
  - Refactored `quizzes/` (`starter-quizzes.ts`, `quizzes.validation.ts`, `quizzes.service.ts`, `quizzes.controller.ts`) to strip `isCorrect` publicly, remove duplicate mock merging, sort options by `orderIndex`, and add `PUT`/`DELETE`/`manage` endpoints.
  - Refactored `game/` (`game.service.ts`, `game.gateway.ts`) with server-side question timers, late-submission rejection, reconnect tokens (`rejoin_room`), host/player disconnect handling, rate limiting, room TTL cleanup, and PostgreSQL archival.
- **Frontend Upgrades (`frontend/src/`):**
  - Added `config/env.ts` and `vite.config.ts` proxy (`/api` and `/socket.io`).
  - Added `stores/authStore.ts` and upgraded `QuizEditor.vue`, `gameStore.ts`, `HostView.vue`, `PlayerView.vue`, `App.vue`, and `tailwind.config.js`.
- **Tests & Documentation:**
  - Added `backend/test/quiz-platform.test.ts` (7 unit tests across Auth, Quiz Validation/Sanitization, and Game Engine).
  - Created `PROPOSAL.md`, `MILESTONES.md`, `DECISIONS.md`, `AI_LOG.md`, and updated `README.md`.
- **Production `deploy/` Stack & GitHub CI/CD:**
  - Added `deploy/` directory (`docker-compose.yml`, `.env.example`, `nginx/nginx.conf`, `nginx/conf.d/default.conf`, `setup-database.sh`, `backup-database.sh`, `rebuild.sh`, `DEPLOYMENT.md`) isolating GlassQuiz on port `4950` while sharing host PostgreSQL (`quiz_db`).
  - Updated `backend/src/main.ts` (`trust proxy`), `backend/src/config/env.ts` (`change-me*` guard), and `frontend/nginx.conf` (dynamic resolver + `/api` rewrite).
  - Added `.github/workflows/ci.yml` (backend tests, frontend build, Docker build & compose validation) and `.github/workflows/deploy.yml` (GHCR image publishing + optional SSH deploy).
  - Added `.gitattributes` enforcing LF endings on `.sh` and `nginx` files.
