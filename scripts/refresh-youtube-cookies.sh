#!/bin/bash
# Refresh YouTube cookies: export from Chrome and upload to VPS
# Usage: bash scripts/refresh-youtube-cookies.sh
#
# Requires yt-dlp and Chrome with a logged-in YouTube session.
# The bot picks up the new cookies on next play — no restart needed.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load server config
if [ ! -f "$PROJECT_DIR/.server.env" ]; then
    echo "Error: .server.env not found"
    echo "Create it from the template: cp .server.env.example .server.env"
    exit 1
fi
source "$PROJECT_DIR/.server.env"

COOKIE_FILE="$PROJECT_DIR/youtube_cookies.txt"

echo "Exporting YouTube cookies from Chrome..."
yt-dlp --cookies-from-browser chrome \
  --cookies "$COOKIE_FILE" \
  --skip-download \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

if [ ! -f "$COOKIE_FILE" ]; then
    echo "Error: cookie export failed — file not created"
    exit 1
fi

echo "Uploading to server..."
scp -i "$SSH_KEY" "$COOKIE_FILE" "$SERVER:$REMOTE_DIR/youtube_cookies.txt"

echo "Setting permissions..."
ssh -i "$SSH_KEY" "$SERVER" "chmod 666 $REMOTE_DIR/youtube_cookies.txt"

echo "Done! YouTube cookies updated. No restart needed."
