# GlassQuiz — Production Deployment Guide (Ubuntu + GitHub)

This stack runs cleanly alongside existing services on your Ubuntu server (e.g., BMS on `4600`, PDF Converter on `4900`). It shares your existing PostgreSQL **server** using its own database (`quiz_db`) and user (`glassquiz`). Its Nginx gateway listens on port **4950**, so nothing collides.

---

## 1. Architecture

```text
Internet ──HTTPS──► Cloudflare Tunnel (or host nginx + Certbot)
                         │  http://127.0.0.1:4950
                         ▼
   glassquiz-gateway   nginx :4950 → :80   (/healthz, rate limits, real visitor IP)
        ├── /socket.io/  ─► glassquiz-api        NestJS + Socket.IO :3000
        ├── /api/*       ─► glassquiz-api        NestJS REST :3000 (rewrites /api/* → /*)
        │                      ├─► glassquiz-redis             internal Redis :6379
        │                      └─► host.docker.internal:5432   shared PostgreSQL (quiz_db)
        └── /*           ─► glassquiz-web        Vue 3 SPA :80
```

| | BMS | PDF Converter | GlassQuiz |
|---|---|---|---|
| Compose project | `digitechkh-bms` | `digitechkh-pdf` | `glassquiz` |
| Gateway port | `4600` | `4900` | **`4950`** |
| Database / user | `bms_db_v2` | `pdf_convertor_db` / `pdf_convertor` | **`quiz_db` / `glassquiz`** |
| Containers | `digitechkh-bms-*` | `digitechkh-pdf-*` | **`glassquiz-*`** |
| CI/CD | — | — | **GitHub Actions + GHCR** |

Only port `4950` (bound to `127.0.0.1` by default) is published. `api`, `web`, and `redis` are reachable only inside the `glassquiz` Docker network.

---

## 2. Prerequisites on the Server

Verify Docker Engine and the Compose plugin:

```bash
docker --version && docker compose version
```

Verify containers can reach the shared PostgreSQL server (adjust `-p 5432` or `5434` to match your PostgreSQL port):

```bash
docker run --rm --add-host host.docker.internal:host-gateway postgres:18-alpine \
  pg_isready -h host.docker.internal -p 5432
# expected: host.docker.internal:5432 - accepting connections
```

---

## 3. Clone from GitHub

```bash
sudo mkdir -p /opt/digitechkh && sudo chown "$USER" /opt/digitechkh
git clone https://github.com/<your-username>/<your-repo>.git /opt/digitechkh/glassquiz
cd /opt/digitechkh/glassquiz/deploy
chmod +x *.sh
```

---

## 4. Configure `deploy/.env`

```bash
cd /opt/digitechkh/glassquiz/deploy
cp .env.example .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
nano .env
chmod 600 .env
```

Key settings in `deploy/.env`:

| Key | Value |
|---|---|
| `PORT_HTTP` | `4950` |
| `BIND_ADDRESS` | `127.0.0.1` behind Cloudflare Tunnel / host nginx (`0.0.0.0` only for direct IP testing) |
| `PUBLIC_URL` / `CORS_ORIGIN` | e.g. `https://quiz.digitechkh.site` |
| `GITHUB_REPOSITORY_OWNER` | lowercase GitHub username or org (for `ghcr.io` image pulls) |
| `POSTGRES_HOST` / `POSTGRES_PORT` | `host.docker.internal` / `5432` (or `5434`) |
| `POSTGRES_DB` / `POSTGRES_USER` | `quiz_db` / `glassquiz` |
| `POSTGRES_PASSWORD` / `JWT_SECRET` | generated random values |

---

## 5. Create the Database (Once)

```bash
./setup-database.sh
```

This prompts for your PostgreSQL admin account, creates `glassquiz` + `quiz_db`, revokes `PUBLIC` access, and tests sign-in. Prisma migrations and starter quiz seeding run automatically when `glassquiz-api` boots.

---

## 6. Build and Start

Option A — **Build directly from source on the server** (same flow as `PDF-CONVERTOR`):

```bash
./rebuild.sh
```

Option B — **Pull prebuilt images from GitHub Container Registry (`ghcr.io`)**:

```bash
./rebuild.sh pull
```

Verify health:

```bash
curl http://127.0.0.1:4950/healthz
curl http://127.0.0.1:4950/api/health
docker compose ps
```

---

## 7. GitHub Actions CI/CD Setup

Two workflows are included in `.github/workflows/`:

1. **`ci.yml`** (on PRs and pushes to `main` / `master`):
   - Runs backend strict `tsc` + unit tests (`npm test`).
   - Runs frontend `vue-tsc && vite build` (`npm run build`).
   - Verifies both Dockerfiles build cleanly.
2. **`deploy.yml`** (on push to `main` / `master`, or manual run):
   - Builds and pushes `ghcr.io/<owner>/glassquiz-api` and `ghcr.io/<owner>/glassquiz-web` to GitHub Container Registry using `GITHUB_TOKEN`.
   - Optionally deploys over SSH to your Ubuntu server if you add these **GitHub Repository Secrets** (**Settings → Secrets and variables → Actions**):

| Secret | Example | Required? |
|---|---|---|
| `DEPLOY_HOST` | `your.server.ip` | Optional (skips SSH deploy if unset) |
| `DEPLOY_USER` | `ubuntu` | Required if `DEPLOY_HOST` is set |
| `DEPLOY_SSH_KEY` | Private Ed25519 SSH key | Required if `DEPLOY_HOST` is set |
| `DEPLOY_PORT` | `22` | Optional (defaults to `22`) |
| `DEPLOY_PATH` | `/opt/digitechkh/glassquiz` | Optional (defaults to `/opt/digitechkh/glassquiz`) |

---

## 8. Domain + HTTPS (Cloudflare Tunnel or Host Nginx)

### Option A — Cloudflare Tunnel
In **Cloudflare Zero Trust → Networks → Tunnels → Public Hostnames**, add:
- Subdomain: `quiz`, Domain: `digitechkh.site`
- Service: `HTTP` → `localhost:4950`

Cloudflare Tunnel supports WebSockets (`/socket.io/`) automatically over HTTPS (`wss://`).

### Option B — Host Nginx + Certbot
```nginx
server {
    server_name quiz.digitechkh.site;

    location / {
        proxy_pass http://127.0.0.1:4950;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
}
```

---

## 9. Daily Operations & Backups

| Task | Command (inside `deploy/`) |
|---|---|
| Manual update from GitHub | `git pull && ./rebuild.sh` (or `./rebuild.sh pull`) |
| Rebuild single service | `./rebuild.sh api` or `./rebuild.sh web` |
| Reload gateway nginx config | `./rebuild.sh gateway` |
| View status / logs | `docker compose ps` / `docker compose logs -f --tail=100 api` |
| Backup PostgreSQL | `./backup-database.sh` (stores in `deploy/backups/`, keeps 14) |
| Stop stack | `docker compose down` |

Cron example for daily 02:30 backups:
```cron
30 2 * * * /opt/digitechkh/glassquiz/deploy/backup-database.sh >> /var/log/glassquiz-backup.log 2>&1
```
