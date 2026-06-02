#!/bin/bash
# Update Bilibili cookies on Oracle Cloud server
# Usage: ./scripts/update-cookies.sh

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

# Check cookies file exists
if [ ! -f "$COOKIES_FILE" ]; then
    echo "Error: cookies file not found at $COOKIES_FILE"
    echo "Please export cookies from bilibili.com first"
    exit 1
fi

echo "Uploading cookies to server..."
REMOTE_COOKIE_DIR="$REMOTE_DIR/secrets"
REMOTE_COOKIE_FILE="$REMOTE_COOKIE_DIR/bilibili_cookies.txt"
REMOTE_TMP_FILE="$REMOTE_COOKIE_DIR/bilibili_cookies.txt.upload"

ssh -i "$SSH_KEY" "$SERVER" "mkdir -p '$REMOTE_COOKIE_DIR' && touch '$REMOTE_COOKIE_FILE' && chmod 600 '$REMOTE_COOKIE_FILE'"
scp -i "$SSH_KEY" "$COOKIES_FILE" "$SERVER:$REMOTE_TMP_FILE"

echo "Installing cookie contents in place..."
ssh -i "$SSH_KEY" "$SERVER" "cat '$REMOTE_TMP_FILE' > '$REMOTE_COOKIE_FILE' && rm -f '$REMOTE_TMP_FILE' && chmod 600 '$REMOTE_COOKIE_FILE' && rm -f '$REMOTE_DIR/cookies.txt'"

echo "Done! Cookies updated. No restart needed."
