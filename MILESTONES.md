# GlassQuiz — Project Milestones

Tracks progress from initial prototype through production-testing hardening and future expansion.

---

## Milestone 1: Foundation & Shared Docker Database — **Completed**
- [x] Define relational schema in `backend/prisma/schema.prisma` (`User`, `Quiz`, `Question`, `Option`, `Room`, `Participant`, `ParticipantAnswer`).
- [x] Provision dedicated `quiz_db` database inside the existing `local-postgres` Docker container (no conflicting Postgres container).
- [x] Generate and apply initial Prisma migration (`20261118030329_init`).
- [x] Add idempotent starter quiz seed (`backend/prisma/seed.ts` + startup auto-seed when empty).
- [x] Remove duplicate `mockQuizzes` + DB quiz merging bug and add deterministic `orderIndex` sorting on options.

## Milestone 2: Core Live Quiz Engine & Resiliency — **Completed**
- [x] Enforce strict game state machine transitions (`LOBBY` -> `QUESTION_ACTIVE` -> `QUESTION_RESULT` -> `FINISHED`).
- [x] Move question countdown timer authority to the server (`endsAt` sync + server timeout).
- [x] Reject late submissions beyond question deadline and guard against `timeLimitSeconds <= 0` (`NaN` protection).
- [x] Hide `isCorrect` during active rounds; reveal private score/streak/rank on `answer_result` and final rank on `player_game_over`.
- [x] Add host & player reconnect tokens (`rejoin_room`), host disconnect grace window, and automatic finished/idle room TTL cleanup.
- [x] Persist live `Room`, `Participant`, and `ParticipantAnswer` records to PostgreSQL.

## Milestone 3: Host Authentication & Quiz CRUD — **Completed**
- [x] Build `AuthModule` (`POST /auth/register`, `POST /auth/login`, `GET /auth/me`) with `scrypt` + HS256 JWT.
- [x] Protect quiz creation, editing, deletion, and owner answer retrieval (`/quizzes/:id/manage`) via `JwtAuthGuard`.
- [x] Strip `isCorrect` flags from public `GET /quizzes` and `GET /quizzes/:id`.
- [x] Add server-side input validation (`validateQuizInput`) and URL scheme sanitization.
- [x] Upgrade `QuizEditor.vue` with Host Sign-In/Register modal, Edit/Delete buttons, question types (`MULTIPLE_CHOICE`, `TRUE_FALSE`), configurable timers/points, optional media URLs, and clean form reset.

## Milestone 4: Frontend Polish & Environment Portability — **Completed**
- [x] Replace hardcoded `http://localhost:3000` calls with `VITE_API_URL` / `VITE_WS_URL` + same-origin `/api` and `/socket.io` proxy support.
- [x] Add URL history syncing (`/play?pin=...`, `/host`, `/library`) and Host Lobby "Copy Invite Link" button.
- [x] Add missing Tailwind keyframes (`fadeIn`, `bounce-short`), dynamic option labels beyond 4 choices, "End Question Early", "Show Final Podium", and "Time's Up!" player state.

## Milestone 5: Production Testing & Deployment Readiness — **Completed**
- [x] Enable `strict`, `strictNullChecks`, and `noImplicitAny` in `backend/tsconfig.json`.
- [x] Add `/health` endpoint verifying PostgreSQL connectivity (`SELECT 1`).
- [x] Configure env-driven CORS allowlist, security headers, and WebSocket per-socket rate limiting.
- [x] Add `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, and `docker-compose.yml` wired to external `postgresql_default` (`local-postgres`).
- [x] Add production `deploy/` stack (`gateway`, `web`, `api`, `redis`, Nginx rate limits & Docker DNS resolver, `setup-database.sh`, `backup-database.sh`, `rebuild.sh`, `DEPLOYMENT.md`).
- [x] Add GitHub Actions CI & CD workflows (`.github/workflows/ci.yml` and `.github/workflows/deploy.yml` with GHCR + optional SSH deploy).
- [x] Add backend automated unit test suite (`npm test` using `node:test`).

## Milestone 6: Post-Testing Scaling & Enhancements — **Planned / Future**
- [ ] Integrate Redis (`@socket.io/redis-adapter` + Sorted Sets) for horizontal multi-container backend scaling.
- [ ] Add Self-Paced (Moodle-style) asynchronous exam mode with shareable assignment links.
- [ ] Add sound effects (countdown ticks, answer feedback, podium fanfare) and image upload storage.
- [ ] Add full-stack Playwright E2E browser tests in CI.
