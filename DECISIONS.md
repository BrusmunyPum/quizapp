# GlassQuiz — Architecture Decision Records (ADRs)

## ADR-001: Share Existing `local-postgres` Docker Container via `quiz_db`
- **Context:** The host machine already runs PostgreSQL (`local-postgres`, `postgres:18-alpine`) bound to port `5432` on Docker network `postgresql_default` with `app_db`. Running another Postgres container on `5432` causes a port collision.
- **Decision:** Create a dedicated `quiz_db` database inside `local-postgres` and remove the duplicate `postgres` service from `docker-compose.yml`. Connect `backend` to external network `postgresql_default` (`local-postgres:5432`) in Docker, and `localhost:5432` during local Node development.
- **Consequences:** Zero port conflicts, full schema isolation from `app_db`, and immediate visibility in existing `local-pgadmin`.

## ADR-002: Same-Origin `/api` & `/socket.io` Proxy With Optional `VITE_*` Overrides
- **Context:** Hardcoding `http://localhost:3000` breaks production domains and mobile phones testing over local Wi-Fi.
- **Decision:** Route frontend requests through `frontend/src/config/env.ts` defaulting to `/api` (REST) and same-origin `/socket.io` (WebSockets), backed by `vite.config.ts` proxy in development and `frontend/nginx.conf` in Docker production. If `VITE_API_URL` / `VITE_WS_URL` are explicitly defined, those override the defaults.
- **Consequences:** Works identically on `localhost:5173`, LAN IP mobile testing, Docker Nginx (`localhost:8080`), and split-origin cloud deployments.

## ADR-003: Server-Authoritative Timers & Reconnect Tokens
- **Context:** Client-only timers allowed questions to hang if the host disconnected and permitted late answers if the client delayed `show_results`. Keying players strictly by `socket.id` dropped users permanently on brief mobile network switches.
- **Decision:** `GameService` manages authoritative `setTimeout` timers, broadcasts `endsAt` timestamps, rejects submissions past `totalTimeMs + 500ms`, and issues `hostToken` / `playerToken` stored in browser `sessionStorage` for `rejoin_room` recovery.
- **Consequences:** Consistent round completion and resilient mobile UX without requiring user accounts for players.

## ADR-004: Strip `isCorrect` on Public Routes & Use Node-Native `scrypt` + HS256 JWT
- **Context:** `GET /quizzes` previously returned `isCorrect` flags to everyone, and quiz creation had no authentication. Adding native `bcrypt` C++ bindings often introduces Alpine/Windows build issues.
- **Decision:** Strip `isCorrect` in `QuizzesService.toPublicQuiz()` for all public endpoints; reveal `isCorrect` only via authenticated owner route `GET /quizzes/:id/manage` and server-side scoring. Implement `AuthService` with Node's built-in `crypto.scryptSync` (16-byte random salt) and HMAC-SHA256 JWT (`JWT_SECRET`).
- **Consequences:** Zero extra native dependencies, fast builds on Windows and Alpine Linux, and zero-login friction preserved for players and public quiz hosting.

## ADR-005: Fail Fast on Unreachable DB in Production (`REQUIRE_DB=true`)
- **Context:** Silently catching Postgres connection errors in `PrismaService` masked misconfigurations and caused quizzes to vanish on restart.
- **Decision:** `REQUIRE_DB` defaults to `true` when `NODE_ENV=production` (and is configurable via env). Startup aborts if Postgres cannot be reached when `REQUIRE_DB=true`; `/health` returns HTTP `503` when DB health check fails.
- **Consequences:** Production testing surfaces database connectivity or credential errors immediately.

## ADR-006: In-Memory Live Room Engine + Async PostgreSQL Archival (Redis Deferred)
- **Context:** A `redis` container is included in `docker-compose.yml`, while a single backend instance is sufficient for initial production testing.
- **Decision:** Keep active room state in `GameService` RAM with periodic TTL cleanup and non-blocking async writes to PostgreSQL (`Room`, `Participant`, `ParticipantAnswer`). Defer `@socket.io/redis-adapter` to Milestone 6.
- **Consequences:** Low operational complexity for single-node production testing while preserving the full PostgreSQL history trail and a clean path to multi-node Redis scaling.
