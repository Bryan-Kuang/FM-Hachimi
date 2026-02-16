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
scp -i "$SSH_KEY" "$COOKIES_FILE" "$SERVER:$REMOTE_DIR/cookies.txt"

echo "Setting permissions..."
ssh -i "$SSH_KEY" "$SERVER" "chmod 666 $REMOTE_DIR/cookies.txt"

echo "Restarting bot..."
ssh -i "$SSH_KEY" "$SERVER" "cd $REMOTE_DIR && docker-compose restart bilibili-bot"

echo "Done! Cookies updated and bot restarted."
