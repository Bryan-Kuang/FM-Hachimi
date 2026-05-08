#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")/../.."

echo "F.M. Hachimi local deploy"
echo "========================="

npm run setup:check

echo
echo "Starting Docker Compose stack..."
docker compose up -d --build

echo
docker compose ps

echo
echo "Deployment started. Follow logs with: npm run docker:logs"
