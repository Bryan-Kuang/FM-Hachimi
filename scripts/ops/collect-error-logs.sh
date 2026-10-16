#!/bin/bash
# Collect the last N hours of problems from the VPS. Runs ON the VPS: the
# auto-fix workflow pipes it over ssh (`ssh vps 'bash -s -- 24' < this-file`).
#
# Output is sectioned plain text for scripts/ops/error-digest.js. It is never
# printed to the (public) Actions log — it carries Discord user/guild ids,
# song titles and other text users control.
#
# Sources:
#   - logs/app-*.log: every logger line (ERROR + WARN kept). Bind-mounted, so it
#     survives container recreation on deploy; `docker logs` does not.
#   - docker logs stderr-ish output that bypassed the logger (uncaught
#     exceptions, node crashes) — only from the current container.

set -uo pipefail

HOURS="${1:-24}"
CONTAINER=bilibili-discord-bot
cd ~/bilibili-bot || { echo "### FATAL cannot cd ~/bilibili-bot"; exit 1; }

# Logger timestamps are container-local, and the container runs in UTC.
SINCE="$(date -u -d "-${HOURS} hours" '+%Y-%m-%d %H:%M:%S')"
echo "### SINCE"
echo "$SINCE"

echo "### CONTAINER"
docker inspect -f 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} started={{.State.StartedAt}} restarts={{.RestartCount}} image={{.Config.Image}}' "$CONTAINER" 2>&1 || true

echo "### LOGGER"
find logs -maxdepth 1 -name 'app-*.log*' -mmin "-$((HOURS * 60 + 60))" -print0 2>/dev/null \
  | xargs -0 -r cat \
  | awk -v since="$SINCE" 'substr($0, 2, 19) >= since && /^\[[0-9-]+ [0-9:]+\]\[(ERROR|WARN)\]/' \
  | LC_ALL=C sort -s -k1,2 \
  | tail -n 20000

echo "### STDERR"
docker logs --since "${HOURS}h" "$CONTAINER" 2>&1 \
  | grep -v '^\[20[0-9][0-9]-' \
  | grep -iE -B2 -A12 'uncaught|unhandled|fatal|error' \
  | head -n 400 || true
