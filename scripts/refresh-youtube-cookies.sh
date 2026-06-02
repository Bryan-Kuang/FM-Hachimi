#!/bin/bash
# Refresh YouTube cookies: export from Chrome and upload to VPS
# Usage: bash scripts/refresh-youtube-cookies.sh
#
# Requires yt-dlp and Chrome with a logged-in YouTube session.
# The bot normally refreshes cookies automatically. This script is an
# emergency/manual fallback and writes into secrets/youtube_cookies.txt.
#
# Options:
#   UPLOAD_ONLY=true             Upload the existing youtube_cookies.txt without exporting.
#   YOUTUBE_COOKIE_BROWSER=...   Browser spec for yt-dlp, defaults to chrome.

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

COOKIE_FILE="$PROJECT_DIR/secrets/youtube_cookies.txt"
TMP_COOKIE_FILE="$COOKIE_FILE.tmp"

mkdir -p "$(dirname "$COOKIE_FILE")"

is_truthy() {
    case "${1:-}" in
        1|true|TRUE|yes|YES) return 0 ;;
        *) return 1 ;;
    esac
}

if ! is_truthy "${UPLOAD_ONLY:-false}"; then
    if ! command -v yt-dlp >/dev/null 2>&1; then
        echo "Error: yt-dlp is not installed or not on PATH"
        echo "Install or update it first, then retry."
        exit 1
    fi

    BROWSER_SPEC="${YOUTUBE_COOKIE_BROWSER:-chrome}"

    echo "Using yt-dlp $(yt-dlp --version)"
    echo "Exporting YouTube cookies from $BROWSER_SPEC..."
    rm -f "$TMP_COOKIE_FILE"

    # Use the YouTube home feed so cookie refresh does not depend on extracting
    # a playable video with the local yt-dlp build.
    if ! yt-dlp --cookies-from-browser "$BROWSER_SPEC" \
      --cookies "$TMP_COOKIE_FILE" \
      --skip-download \
      --flat-playlist \
      --playlist-items 0 \
      --extractor-args "youtubetab:skip=authcheck" \
      "https://www.youtube.com/"; then
        rm -f "$TMP_COOKIE_FILE"
        echo "Error: cookie export failed"
        echo "Tips:"
        echo "  - Make sure Chrome is logged into YouTube."
        echo "  - Close Chrome and retry if the browser cookie database is locked."
        echo "  - Update yt-dlp if this keeps failing."
        echo "  - If YouTube still reports rotated cookies, export from a private browser session and rerun with UPLOAD_ONLY=true."
        exit 1
    fi

    if [ ! -s "$TMP_COOKIE_FILE" ]; then
        rm -f "$TMP_COOKIE_FILE"
        echo "Error: cookie export failed — file not created"
        exit 1
    fi

    touch -a "$COOKIE_FILE"
    cat "$TMP_COOKIE_FILE" > "$COOKIE_FILE"
    rm -f "$TMP_COOKIE_FILE"
else
    echo "UPLOAD_ONLY=true: using existing $COOKIE_FILE"
fi

if [ ! -s "$COOKIE_FILE" ]; then
    echo "Error: $COOKIE_FILE is missing or empty"
    echo "Export YouTube cookies first, then retry."
    exit 1
fi

chmod 600 "$COOKIE_FILE"

echo "Uploading to server..."
REMOTE_COOKIE_DIR="$REMOTE_DIR/secrets"
REMOTE_COOKIE_FILE="$REMOTE_COOKIE_DIR/youtube_cookies.txt"
REMOTE_TMP_FILE="$REMOTE_COOKIE_DIR/youtube_cookies.txt.upload"

ssh -i "$SSH_KEY" "$SERVER" "mkdir -p '$REMOTE_COOKIE_DIR' && touch '$REMOTE_COOKIE_FILE' && chmod 600 '$REMOTE_COOKIE_FILE'"
scp -i "$SSH_KEY" "$COOKIE_FILE" "$SERVER:$REMOTE_TMP_FILE"

echo "Installing cookie contents in place..."
ssh -i "$SSH_KEY" "$SERVER" "cat '$REMOTE_TMP_FILE' > '$REMOTE_COOKIE_FILE' && rm -f '$REMOTE_TMP_FILE' && chmod 600 '$REMOTE_COOKIE_FILE' && rm -f '$REMOTE_DIR/youtube_cookies.txt'"

echo "Done! YouTube cookies updated. No restart needed."
