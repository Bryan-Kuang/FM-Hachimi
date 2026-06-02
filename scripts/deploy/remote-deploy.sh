#!/bin/bash

set -euo pipefail

echo "[deploy] preparing bind mounts..."
mkdir -p data logs secrets

migrate_cookie_file() {
  local source_file="$1"
  local target_file="$2"

  touch -a "$target_file"
  chmod 600 "$target_file"

  if [ -f "$source_file" ]; then
    if [ ! -s "$target_file" ]; then
      echo "[deploy] migrating $source_file -> $target_file"
      cat "$source_file" > "$target_file"
      chmod 600 "$target_file"
    fi
    rm -f "$source_file"
  fi
}

migrate_cookie_file cookies.txt secrets/bilibili_cookies.txt
migrate_cookie_file youtube_cookies.txt secrets/youtube_cookies.txt
rm -f cookies.txt
rm -f youtube_cookies.txt
rm -f bilibili_cookies.txt

echo "[deploy] rebuilding containers..."
if ! timeout 600 docker compose up -d --build 2>&1; then
  echo "[deploy] recreate conflict or build failure; cleaning up and retrying..."
  timeout 60 docker compose down --remove-orphans 2>/dev/null || true
  timeout 600 docker compose up -d --build
fi

echo "[deploy] pruning unused images..."
timeout 60 docker image prune -f

echo "[deploy] waiting for container to be healthy..."
CONTAINER=$(docker compose ps -q bilibili-bot 2>/dev/null || docker compose ps -q 2>/dev/null | head -1)
if [ -z "$CONTAINER" ]; then
  echo "[deploy] no container found after compose up."
  docker compose ps
  exit 1
fi

for i in $(seq 1 18); do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo unknown)
  HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo unknown)

  if [ "$STATUS" = "exited" ] || [ "$STATUS" = "dead" ]; then
    echo "[deploy] container exited unexpectedly (status=$STATUS)."
    docker compose logs --tail=80
    exit 1
  fi

  if [ "$STATUS" = "running" ] && { [ "$HEALTH" = "healthy" ] || [ "$HEALTH" = "none" ]; }; then
    echo "[deploy] container is running and $HEALTH."
    exit 0
  fi

  echo "[deploy] status=$STATUS health=$HEALTH, waiting... ($i/18)"
  sleep 5
done

HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo unknown)
if [ "$HEALTH" = "unhealthy" ]; then
  echo "[deploy] container is unhealthy after timeout."
  docker compose logs --tail=80
  exit 1
fi

echo "[deploy] container did not become healthy before timeout."
docker compose logs --tail=80
exit 1
