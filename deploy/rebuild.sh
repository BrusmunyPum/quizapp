#!/usr/bin/env bash
# ==============================================================================
# GlassQuiz - build or pull and (re)start the production stack
# ==============================================================================
# Usage:
#   ./rebuild.sh             # build locally + start everything (also first install)
#   ./rebuild.sh pull        # pull prebuilt images from GitHub (ghcr.io) + restart
#   ./rebuild.sh api         # rebuild + restart only the NestJS API
#   ./rebuild.sh web         # rebuild + restart only the Vue frontend
#   ./rebuild.sh gateway     # reload the gateway after editing nginx/conf.d
# ==============================================================================

set -eo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "ERROR: deploy/.env not found. Run: cp .env.example .env  and fill it in."; exit 1; }
if grep -qE '^(POSTGRES_PASSWORD|JWT_SECRET)=change-me' .env; then
  echo "ERROR: .env still has change-me values (POSTGRES_PASSWORD, JWT_SECRET)."
  exit 1
fi

TARGET=${1:-all}
echo "--------------------------------------------------------"
echo " GlassQuiz deploy action: $TARGET"
echo "--------------------------------------------------------"

case $TARGET in
  api|web)
    docker compose build "$TARGET"
    docker compose up -d --no-deps "$TARGET"
    ;;
  gateway)
    docker compose up -d gateway
    docker exec glassquiz-gateway nginx -t
    docker exec glassquiz-gateway nginx -s reload
    ;;
  pull)
    docker compose pull api web
    docker compose up -d --remove-orphans
    ;;
  all)
    docker compose build
    docker compose up -d --remove-orphans
    ;;
  *)
    echo "ERROR: unknown target '$TARGET'. Use: ./rebuild.sh [all|pull|api|web|gateway]"
    exit 1
    ;;
esac

echo "==> Waiting for services to become healthy..."
for _ in $(seq 1 60); do
  if ! docker compose ps --format '{{.Health}}' | grep -qE 'starting|unhealthy'; then break; fi
  sleep 3
done

docker compose ps
PORT=$(grep -E '^PORT_HTTP=' .env | cut -d= -f2); PORT=${PORT:-4950}
if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "OK: http://127.0.0.1:$PORT is up"
else
  echo "WARNING: http://127.0.0.1:$PORT is not answering yet. Check: docker compose logs --tail=100 api"
  exit 1
fi
