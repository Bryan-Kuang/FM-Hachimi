#!/bin/bash
# Compatibility wrapper for the old bot/admin guidance.
# Prefer calling scripts/refresh-youtube-cookies.sh directly.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/refresh-youtube-cookies.sh" "$@"
