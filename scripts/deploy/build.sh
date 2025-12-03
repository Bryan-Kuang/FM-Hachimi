#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../" && pwd)"
cd "$ROOT_DIR"

TAG=${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}
IMAGE_NAME=${IMAGE_NAME:-bilibili-bot}
DOCKERFILE=${DOCKERFILE:-config/docker/Dockerfile}

echo "Building Docker image: ${IMAGE_NAME}:${TAG}"
docker build -f "$DOCKERFILE" -t "${IMAGE_NAME}:${TAG}" .
echo "Image built: ${IMAGE_NAME}:${TAG}"

