#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME=${IMAGE_NAME:-bilibili-bot}
TAG=${IMAGE_TAG:-latest}
CONTAINER_NAME=${CONTAINER_NAME:-bilibili-bot}

echo "Releasing ${IMAGE_NAME}:${TAG} as container ${CONTAINER_NAME}"

if docker ps -a --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}$"; then
  echo "Stopping existing container..."
  docker stop "${CONTAINER_NAME}" || true
  echo "Removing existing container..."
  docker rm "${CONTAINER_NAME}" || true
fi

echo "Starting new container..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -e NODE_ENV=production \
  -e LOG_LEVEL=${LOG_LEVEL:-info} \
  "${IMAGE_NAME}:${TAG}"

echo "Release completed"

