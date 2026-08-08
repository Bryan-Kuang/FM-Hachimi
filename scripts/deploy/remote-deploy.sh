#!/bin/bash

set -euo pipefail

echo "[deploy] preparing bind mounts..."
mkdir -p data logs secrets cache

# Self-heal bind-mount ownership. The container runs as HOST_UID:HOST_GID (.env)
# and must own data/ + logs/ + cache/, or writes fail with EACCES (the 2026-04-28
# incident: dirs left owned by a different uid after HOST_UID changed).
# Best-effort — never fail the deploy over this.
HUID="$(grep -E '^HOST_UID=' .env 2>/dev/null | head -1 | cut -d= -f2 | tr -d '"' || true)"
HGID="$(grep -E '^HOST_GID=' .env 2>/dev/null | head -1 | cut -d= -f2 | tr -d '"' || true)"
HUID="${HUID:-1000}"; HGID="${HGID:-1000}"
if [ -n "$(find data logs cache -maxdepth 0 -not -uid "$HUID" -print -quit 2>/dev/null)" ]; then
  echo "[deploy] fixing bind-mount ownership -> ${HUID}:${HGID}"
  chown -R "${HUID}:${HGID}" data logs cache 2>/dev/null \
    || sudo -n chown -R "${HUID}:${HGID}" data logs cache 2>/dev/null \
    || echo "[deploy] WARN: could not chown data/logs/cache — run: sudo chown -R ${HUID}:${HGID} data logs cache"
fi

# Cookie files are bind-mounted from secrets/ — they must exist with 600 perms
# or compose creates them as root-owned directories.
touch -a secrets/bilibili_cookies.txt secrets/youtube_cookies.txt
chmod 600 secrets/bilibili_cookies.txt secrets/youtube_cookies.txt

# Pull the prebuilt image from GHCR (built + pushed by CI) instead of rebuilding
# on the VPS. IMAGE_TAG is the commit SHA passed by the deploy workflow; falls
# back to latest for manual runs. GHCR_TOKEN is only needed for a private
# package — a public package pulls without auth.
export IMAGE_TAG="${IMAGE_TAG:-latest}"

# Persist the tag into .env, because compose reads `${IMAGE_TAG:-latest}` and an
# exported-only value dies with this script. Without this line, the ordinary
# "edit .env, then `docker compose up -d`" restart resolves to `latest` — and
# `latest` on the VPS is not "newest", it is "whatever was last pulled under
# that name". Since this script only ever pulls by SHA, the local `latest` goes
# stale and a manual restart silently rolls production back to it. That happened
# three times on 2026-08-08 (production quietly reverted five days, to an image
# without the fixes being debugged), and every symptom looked like a code bug.
# Writing it down also makes .env a readable record of what is running.
if grep -q '^IMAGE_TAG=' .env 2>/dev/null; then
  sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${IMAGE_TAG}|" .env
else
  # A hand-edited .env may not end in a newline; appending blind would splice
  # IMAGE_TAG onto the previous line and break both variables.
  if [ -s .env ] && [ -n "$(tail -c1 .env)" ]; then printf '\n' >> .env; fi
  printf 'IMAGE_TAG=%s\n' "${IMAGE_TAG}" >> .env
fi
echo "[deploy] pinned IMAGE_TAG=${IMAGE_TAG} in .env"

if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "[deploy] logging in to GHCR..."
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-x}" --password-stdin
fi

echo "[deploy] pulling image (tag: $IMAGE_TAG)..."
timeout 300 docker compose pull

# Log the resolved sidecar digest. Bot image and sidecar both track latest in
# lockstep (weekly --no-cache rebuild + this per-deploy pull); the digest here
# is what makes a PO-token version-drift incident diagnosable after the fact.
docker image inspect --format '[deploy] pot-provider digest: {{index .RepoDigests 0}}' \
  brainicism/bgutil-ytdlp-pot-provider:latest 2>/dev/null || true

echo "[deploy] starting containers..."
if ! timeout 120 docker compose up -d 2>&1; then
  echo "[deploy] recreate conflict; cleaning up and retrying..."
  timeout 60 docker compose down --remove-orphans 2>/dev/null || true
  timeout 120 docker compose up -d
fi

docker logout ghcr.io >/dev/null 2>&1 || true

# Age-filtered -a prune: old commit-SHA image tags accumulate otherwise (each
# deploy pulls a new tag). Keeps the active image plus <7-day rollback
# candidates; anything older stays pullable from GHCR.
echo "[deploy] pruning unused images..."
timeout 120 docker image prune -af --filter "until=168h"

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
