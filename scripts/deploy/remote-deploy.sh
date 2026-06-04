#!/bin/bash

set -euo pipefail

echo "[deploy] preparing bind mounts..."
mkdir -p data logs secrets

# Self-heal bind-mount ownership. The container runs as HOST_UID:HOST_GID (.env)
# and must own data/ + logs/, or daily-hachimi writes fail with EACCES (the
# 2026-04-28 incident: dirs left owned by a different uid after HOST_UID changed).
# Best-effort — never fail the deploy over this.
HUID="$(grep -E '^HOST_UID=' .env 2>/dev/null | head -1 | cut -d= -f2 | tr -d '"' || true)"
HGID="$(grep -E '^HOST_GID=' .env 2>/dev/null | head -1 | cut -d= -f2 | tr -d '"' || true)"
HUID="${HUID:-1000}"; HGID="${HGID:-1000}"
if [ -n "$(find data logs -maxdepth 0 -not -uid "$HUID" -print -quit 2>/dev/null)" ]; then
  echo "[deploy] fixing bind-mount ownership -> ${HUID}:${HGID}"
  chown -R "${HUID}:${HGID}" data logs 2>/dev/null \
    || sudo -n chown -R "${HUID}:${HGID}" data logs 2>/dev/null \
    || echo "[deploy] WARN: could not chown data/logs — run: sudo chown -R ${HUID}:${HGID} data logs"
fi

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

# Pull the prebuilt image from GHCR (built + pushed by CI) instead of rebuilding
# on the VPS. IMAGE_TAG is the commit SHA passed by the deploy workflow; falls
# back to latest for manual runs. GHCR_TOKEN is only needed for a private
# package — a public package pulls without auth.
export IMAGE_TAG="${IMAGE_TAG:-latest}"

if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "[deploy] logging in to GHCR..."
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-x}" --password-stdin
fi

echo "[deploy] pulling image (tag: $IMAGE_TAG)..."
timeout 300 docker compose pull

echo "[deploy] starting containers..."
if ! timeout 120 docker compose up -d 2>&1; then
  echo "[deploy] recreate conflict; cleaning up and retrying..."
  timeout 60 docker compose down --remove-orphans 2>/dev/null || true
  timeout 120 docker compose up -d
fi

docker logout ghcr.io >/dev/null 2>&1 || true

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
