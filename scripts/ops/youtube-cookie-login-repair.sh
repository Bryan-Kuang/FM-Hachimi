#!/usr/bin/env bash
# Best-effort repair for the dedicated VPS YouTube browser profile.
#
# Credentials are intentionally not stored in git. Put them on the VPS at:
#   /home/ubuntu/.fm-hachimi-youtube/credentials.env
#
# Required keys:
#   YOUTUBE_BOT_EMAIL=...
#   YOUTUBE_BOT_PASSWORD=...
#
# Google may still require CAPTCHA, 2FA, or a security challenge. This helper
# fails closed in those cases; it cannot bypass Google account protections.

set -euo pipefail

BASE="${YOUTUBE_COOKIE_BASE:-$HOME/.fm-hachimi-youtube}"
RUNTIME="$BASE/runtime"
CREDENTIALS_FILE="${YOUTUBE_COOKIE_CREDENTIALS_FILE:-$BASE/credentials.env}"
DISPLAY_NUM="${YOUTUBE_COOKIE_DISPLAY:-94}"
DISPLAY=":$DISPLAY_NUM"
START_HELPER="$BASE/bin/start-youtube-browser.sh"
EXPORT_HELPER="$BASE/bin/export-youtube-cookies.sh"

if [ ! -f "$CREDENTIALS_FILE" ]; then
  echo "Missing credentials file: $CREDENTIALS_FILE" >&2
  echo "Create it with mode 600 and YOUTUBE_BOT_EMAIL/YOUTUBE_BOT_PASSWORD." >&2
  exit 1
fi

mode="$(stat -c '%a' "$CREDENTIALS_FILE" 2>/dev/null || stat -f '%Lp' "$CREDENTIALS_FILE")"
if [ "$mode" != "600" ]; then
  echo "Refusing to read $CREDENTIALS_FILE because mode is $mode, expected 600." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$CREDENTIALS_FILE"

if [ -z "${YOUTUBE_BOT_EMAIL:-}" ] || [ -z "${YOUTUBE_BOT_PASSWORD:-}" ]; then
  echo "YOUTUBE_BOT_EMAIL and YOUTUBE_BOT_PASSWORD are required in $CREDENTIALS_FILE." >&2
  exit 1
fi

if [ ! -x "$START_HELPER" ]; then
  echo "Missing browser start helper: $START_HELPER" >&2
  exit 1
fi

if ! command -v xdotool >/dev/null 2>&1; then
  echo "xdotool is required for best-effort typed login automation." >&2
  echo "Install it on the VPS, or use the VNC login flow manually." >&2
  exit 1
fi

if ! command -v xclip >/dev/null 2>&1; then
  echo "xclip is required so credentials are not passed as process arguments." >&2
  echo "Install it on the VPS, or use the VNC login flow manually." >&2
  exit 1
fi

paste_value() {
  local value="$1"
  local tmp_file

  mkdir -p "$RUNTIME"
  tmp_file="$(mktemp "$RUNTIME/paste.XXXXXX")"
  chmod 600 "$tmp_file"
  printf "%s" "$value" > "$tmp_file"
  DISPLAY="$DISPLAY" xclip -selection clipboard < "$tmp_file"
  rm -f "$tmp_file"
  DISPLAY="$DISPLAY" xdotool key --clearmodifiers Ctrl+v
}

"$START_HELPER"
sleep 5

DISPLAY="$DISPLAY" xdotool search --sync --onlyvisible --class "google-chrome" windowactivate
DISPLAY="$DISPLAY" xdotool key --clearmodifiers Ctrl+l
DISPLAY="$DISPLAY" xdotool type --delay 20 "https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/"
DISPLAY="$DISPLAY" xdotool key Return
sleep 5

paste_value "$YOUTUBE_BOT_EMAIL"
DISPLAY="$DISPLAY" xdotool key Return
sleep 6
paste_value "$YOUTUBE_BOT_PASSWORD"
DISPLAY="$DISPLAY" xdotool key Return
sleep 12

if [ -x "$EXPORT_HELPER" ]; then
  "$EXPORT_HELPER"
else
  echo "Login attempt finished. Missing export helper: $EXPORT_HELPER" >&2
fi
