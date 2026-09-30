# Operations

Runbook for deploying and operating F.M. Hachimi on the VPS.

## Common operations

The VPS address, user, and key are deliberately not written down here (public
repo — CI keeps them in the `DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_SSH_KEY`
secrets). Add a `Host fm-hachimi-vps` alias to your local `~/.ssh/config` once,
then:

```bash
# SSH to the VPS
ssh fm-hachimi-vps

# Tail the bot's logs (on the VPS)
docker logs -f bilibili-discord-bot --tail 100

# Health check (on the VPS): container status + app readiness.
# Use /readyz, not /healthz — /healthz is a static 200 that stays green while
# the gateway is wedged (see "Gateway outages and the watchdog").
docker ps --format '{{.Names}}: {{.Status}}' && curl -s 127.0.0.1:9090/readyz

# Refresh global commands through CI (does not build or deploy the bot)
gh workflow run pipeline.yml -f environment=global && gh run watch

# Register/refresh slash commands manually (local; normally automatic post-deploy)
npm run deploy:commands
```

Bot deployment is triggered by a push to `main` or the weekly scheduled rebuild.
Manual workflow dispatch only registers or clears slash commands. To retry a
failed bot deployment, rerun that push/scheduled workflow in GitHub Actions.
The current `npm run ops:deploy` helper also uses manual dispatch, so despite its
name it only refreshes commands.

## Which image is running

`docker-compose.yml` resolves `ghcr.io/bryan-kuang/fm-hachimi:${IMAGE_TAG:-latest}`, and
`remote-deploy.sh` writes the deployed commit SHA into `.env` as `IMAGE_TAG=`. **Leave that
line alone** — it is what makes a manual `docker compose up -d` restart the version that is
actually deployed.

Before that line existed, `IMAGE_TAG` was only exported inside the deploy script, so any
manual restart fell through to `latest` — and `latest` on the VPS means "whatever was last
pulled under that name", not "newest". Since the deploy only ever pulls by SHA, the local
`latest` went stale and manual restarts silently rolled production back. On 2026-08-08 that
reverted prod by five days, three times in one afternoon, with no error anywhere: the
container came up healthy, just running old code, and every fix under test looked broken.

```bash
# what is actually running (belt and braces — env, image ref, and resolved config)
docker exec bilibili-discord-bot printenv GIT_SHA
docker inspect bilibili-discord-bot --format '{{.Config.Image}}'
cd ~/bilibili-bot && docker compose config | grep -m1 'image: ghcr'
```

If `GIT_SHA` disagrees with the newest green pipeline run, prod is not on the code you think
it is — re-run the deploy rather than debugging the app.

## Topology

- **Host:** Oracle Cloud Ubuntu VPS, repo at `/home/ubuntu/bilibili-bot`, tracks `main`.
- **Runtime:** Docker Compose runs the bot (`bilibili-discord-bot`) and the
  YouTube PO-token provider (`pot-provider`) on the shared `botnet` network. The
  provider has no host port; bot health and metrics bind to `127.0.0.1:9090` on
  the host (loopback only).
- **State lives on the host (bind mounts), never in the image:**
  - `secrets/` — `youtube_cookies.txt`, `bilibili_cookies.txt` (mode 600)
  - `data/` — `daily_hachimi.json` (schedules), `daily_hachimi_history.json`
    (recommendation history), `annoying_state.json` (per-guild armed flags), and
    `resume_state.json` (queue, playback position and idle voice presence).
    Resume snapshots are written periodically and on shutdown, consumed on
    startup, and discarded if older than `RESUME_MAX_AGE_MS` (default 15 min).
  - `cache/` — downloaded audio in separate Bilibili and YouTube stores
  - `logs/` — unused in prod: `LOG_TO_FILE=false` since 2026-07 (the app's date-stamped
    files never rotated); read logs with `docker compose logs` (json-file driver, 10m/3 rotation)
  - `~/.fm-hachimi-youtube/profile` → mounted read-only at `/app/youtube-browser-profile`

> `data/`/`logs/` must be writable by the container's `HOST_UID:HOST_GID` (set in `.env`).
> On Oracle's image `ubuntu` is uid **1001** (not 1000) — mismatch causes silent EACCES
> on `daily_hachimi.json` (the 2026-04-28 incident).

## Deploy flow

One **`Pipeline`** workflow, a single `needs:` graph: **`check → image → deploy → deploy-commands`**.
`push → main` runs `check` (lint, typecheck, test, build, compose) → `image` builds and
pushes to **GHCR** (`ghcr.io/bryan-kuang/fm-hachimi`, tagged `latest` + commit SHA) →
`deploy` SSHes to the VPS → `git pull --ff-only` → `scripts/deploy/remote-deploy.sh` →
`docker login ghcr.io` + `docker compose pull` + `up -d` (pulls the **exact image CI tested**
via `IMAGE_TAG`=commit SHA) → healthcheck poll → `deploy-commands` registers global commands.
Weekly scheduled runs also check, rebuild without cache and deploy, but do not
re-register commands. Deploy-job failures ping Discord. PRs run `check` + `image`
(build-only, no push/deploy). The scheduled `Cookie Health` monitor is separate.

**Registry deploy prerequisites** (one-time): either make the `fm-hachimi` GHCR package
**public** (then no auth needed to pull), or add a repo secret **`GHCR_TOKEN`** = a classic
PAT with `read:packages` so the VPS can pull a private image. CI pushes using the built-in
`GITHUB_TOKEN` (no PAT needed for push). Local dev still builds: `docker compose up --build`.

### Slash commands

All supported commands register globally after a successful push-triggered production deploy.
Manual Pipeline dispatch offers `global` (register commands) and `clear_guild`
(remove this application's old guild-scoped commands in the specified guild).

When upgrading from the testing-command system, record the former test guild ID
before removing `TEST_GUILD_ID` from the deployment configuration. Clear that
guild's application commands before registering the global command set:

```bash
CLEAR_GUILD_COMMANDS=true GUILD_ID=<former-test-guild-id> npm run deploy:commands
npm run deploy:commands
```

The cleanup operation registers nothing. Repeat it for each guild with old
application commands. Other applications' commands are unaffected. The application
no longer reads `TEST_GUILD_ID`, `DEPLOY_TEST_COMMANDS` or command-stage flags.
Automated CI tests and health checks are retained.

## YouTube cookies — decision tree

When cookies go stale, work down this list; each step is the fallback for the one above:

0. **Triage first — do not skip.** A stale cookie file does *not* imply a dead Google
   session, and steps 1–3 are an hour of wasted VNC work if it isn't. Extract a canary with
   the live cookie file and read the error:

   ```bash
   docker exec bilibili-discord-bot yt-dlp \
     --cookies /app/secrets/youtube_cookies.txt \
     --skip-download --no-playlist --print id \
     https://www.youtube.com/watch?v=dQw4w9WgXcQ
   ```

   > **`--print id` succeeding does not mean YouTube works.** It proves yt-dlp found a
   > format, not that the stream URL serves bytes. On 2026-08-08 the `mweb` client printed
   > ids for every video while every URL answered 403, and that mistake shipped a "fixed"
   > YouTube that could not play a single track for a day. Whenever you are judging a
   > *player client*, use the end-to-end check in the next block instead.
   >
   > Note also that `yt-dlp --cookies <file>` **writes the refreshed jar back to that file**.
   > Point ad-hoc commands at a copy if you do not want to mutate the live one; the bot
   > already copies to a temp file for this reason (`src/youtube/extractor.ts`).

   | Error | Meaning | Go to |
   |---|---|---|
   | `Sign in to confirm you're not a bot` | Authentication or bot detection failed; try cookie refresh. | step 1 |
   | `The page needs to be reloaded` / `No video formats found` | Can indicate a client/PO-token issue; does not by itself establish cookie validity. | see below |

   For the second row, investigate the yt-dlp client and PO-token path first. Check the
   pot-provider sidecar (`docker exec bilibili-discord-bot wget -qO- http://pot-provider:4416/ping`),
   then find a client that works and set it in `~/bilibili-bot/.env`:

   **Judge each client by whether the stream URL answers 200**, not by whether extraction
   succeeds:

   ```bash
   docker exec bilibili-discord-bot sh -c '
   for c in web_embedded mweb default tv; do
     printf "%-14s " "$c"
     U=$(timeout 120 yt-dlp --no-warnings \
       --extractor-args youtubepot-bgutilhttp:base_url=http://pot-provider:4416 \
       --extractor-args "youtube:player_client=$c" \
       --cookies /app/secrets/youtube_cookies.txt -f bestaudio --get-url \
       "https://www.youtube.com/watch?v=jNQXAC9IVRw" 2>/dev/null | head -1)
     [ -z "$U" ] && { echo "extraction failed"; continue; }
     timeout 45 wget --spider -S "$U" 2>&1 | grep -o "HTTP/1.1 [0-9]*" | tail -1
   done'
   ```

   Set the winner as `YOUTUBE_PLAYER_CLIENT` in `~/bilibili-bot/.env`, then
   `docker compose up -d`. Prefer leaving it empty (yt-dlp's own selection) whenever that
   still produces 200s; pin only while a rollout is actively breaking the default.

   Worked examples: **2026-07-01** — pinned `tv` started returning 403 stream URLs when
   YouTube extended GVS PO-token enforcement to it. **2026-08-07/08** — the "bind GVS PO
   token to video ID" experiment forced SABR streaming on `web_safari`; yt-dlp's default set
   extracted nothing, `mweb` extracted fine but served 403s, and only `web_embedded` returned
   200 end-to-end. Fixed with `YOUTUBE_PLAYER_CLIENT=web_embedded`.
1. **In-app auto-refresh** (automatic, tier 1 below) — normally nothing to do.
2. **Automated login repair**: `bash scripts/ops/youtube-cookie-login-repair.sh` on the VPS
   (uses stored credentials; fails closed on CAPTCHA/2FA).
3. **Manual VNC login** (tier 2 below) — the last resort when the automated repair hits
   a CAPTCHA.

**Tier 1 — in-app auto-refresh (automatic).** `src/youtube/cookie_refresh_service.ts` runs at
startup, every 6h, and on auth-failure. It exports cookies from the mounted Chrome profile
(`yt-dlp --cookies-from-browser chrome+basictext:/app/youtube-browser-profile`), validates
against `validateUrls`, then atomically writes `secrets/youtube_cookies.txt` (mode 600) **only
on success**. So the file's mtime = time of last *successful* refresh. Validation runs yt-dlp
with the extractor's own args (`src/youtube/ytdlp_args.ts`, injected via the keeper's
`spawnFn`) so a pass means "the bot can extract this the way the bot extracts" — validating a
config the bot never runs is what froze rotation on 2026-08-07.

- Metrics on `/metrics`: `youtube_cookie_last_refresh_success_timestamp_seconds` (gauge),
  `youtube_cookie_refresh_total{result=success|failure}` (counter).
- Alert: the **Cookie Health** workflow checks the file's age every 6h and pings Discord if it
  exceeds ~13h (two missed cycles).

### Validation is slow, and its timeout is the thing that breaks first

During the August 2026 incident, `web_embedded` was the working client and its
nsig JS solve took **55–86s per extraction** on the 2-vCPU host. These are
historical observations; re-measure the configured client before changing it. Validation runs one such
extraction per canary URL, each capped by `YOUTUBE_COOKIE_VALIDATE_TIMEOUT_MS`
(default 180000; the upstream package's own default is 90s, which is *under* the
observed cost).

A `Timed out` in `YouTube cookie refresh failed` means validation exceeded its
budget; it does not establish whether the cookies are valid:

```
exported cookies failed validation: \nTimed out
```

Check host load and repeat validation before attempting re-login. The example
below reproduces the historical `web_embedded` check; substitute the configured
client when investigating a different setup:

```bash
docker exec bilibili-discord-bot sh -c 'cp /app/secrets/youtube_cookies.txt /tmp/v.txt
  time yt-dlp --cookies /tmp/v.txt --skip-download --no-playlist --no-warnings \
    --print id https://www.youtube.com/watch?v=dQw4w9WgXcQ \
    --extractor-args youtubepot-bgutilhttp:base_url=http://pot-provider:4416 \
    --extractor-args youtube:player_client=web_embedded; rm -f /tmp/v.txt'
```

Keep `YOUTUBE_COOKIE_VALIDATE_URLS` at **one** video. Validation requires every
URL to pass, so each extra canary adds a full extraction *and* another chance
for one flaky video to block rotation entirely — the 2026-08-07 freeze.

**Tier 2 — browser-profile re-login (manual).** The profile's Google session eventually dies
(bot-check / expiry); Tier 1 then fails and the file goes stale. Recovery is manual via VNC:

```bash
# on the VPS
~/.fm-hachimi-youtube/bin/start-youtube-browser.sh     # Xvfb + Chrome on VNC 127.0.0.1:5907
# from your laptop: tunnel and connect a VNC client
ssh -L 5907:127.0.0.1:5907 ubuntu@<vps>
#   open a VNC viewer to localhost:5907, log into Google/YouTube in the Chrome window
~/.fm-hachimi-youtube/bin/export-youtube-cookies.sh    # export + validate via the bot image
~/.fm-hachimi-youtube/bin/stop-youtube-browser.sh
```

`scripts/ops/youtube-cookie-login-repair.sh` (step 2 above) attempts an automated login using
`~/.fm-hachimi-youtube/credentials.env` (mode 600, **VPS-only, never in git**) but fails closed
on CAPTCHA/2FA. It needs `xdotool` and `xclip` on the VPS so credentials are pasted without
appearing as process arguments.

Bilibili cookies (`bilibili_cookies.txt`) are static — refresh manually when they expire:

```bash
yt-dlp --cookies-from-browser chrome \
  --cookies secrets/bilibili_cookies.txt \
  --skip-download \
  "https://www.bilibili.com/video/BV1GJ411x7h7"
```

Never commit `secrets/`, cookie files, browser profiles, or bot-account credentials.

## Media cache (YouTube + Bilibili)

To avoid repeated extraction and CDN downloads, the bot caches the **downloaded
audio file** for replayed videos. After the first play, the extractor downloads the
audio (HTTP GET of the signed URL) into the `cache/` host bind-mount; later plays —
even after the signed URL expires — read the local file instantly (no yt-dlp/native
extract, no network). `src/audio/media_cache.ts`, keyed by video, LRU-evicted by
entry count **and** total size.

Each platform gets its **own cache dir + budget** (separate subdirs under the same
`cache/` mount) so neither platform's churn can evict the other's files. Combined
budget ~1 GB, split evenly:

- Dirs: YouTube → `cache/youtube/`, Bilibili → `cache/bilibili/` (each with its own
  `index.json`). Both under the `./cache:/app/cache` mount — no compose change.
- YouTube env: `YOUTUBE_MEDIA_CACHE_ENABLED` (default true), `YOUTUBE_MEDIA_CACHE_DIR`
  (`/app/cache/youtube`), `YOUTUBE_MEDIA_CACHE_MAX_ENTRIES` (100), `..._MAX_MB` (512).
- Bilibili env: `BILIBILI_MEDIA_CACHE_ENABLED` (default true), `BILIBILI_MEDIA_CACHE_DIR`
  (`/app/cache/bilibili`), `BILIBILI_MEDIA_CACHE_MAX_ENTRIES` (100), `..._MAX_MB` (512).
- This is what keeps the fixed radio **break video** fast on repeat plays, and covers
  any replayed Bilibili track (e.g. the daily recommendation).
- Clear it any time: `rm -rf ~/bilibili-bot/cache/*` (re-downloads on next play).
- A cache hit logs `YouTube media cache hit — playing local file` /
  `Bilibili media cache hit — playing local file`.
- **One-time cleanup on upgrade:** YouTube's cache dir moved from `cache/` root to
  `cache/youtube/`. Old files at the `cache/` root (`cache/index.json`, loose
  `*.m4a`/`*.webm`) are now orphaned — delete the loose root files once:
  `find ~/bilibili-bot/cache -maxdepth 1 -type f -delete` (leaves the two subdirs).

## Detecting problems

Three layers, from most to least automated:

1. **`/status` slash command** — the fastest health check, no SSH. Shows uptime,
   deployed commit (`GIT_SHA`, baked into the image by CI), voice sessions,
   per-platform media-cache usage, and cookie-refresh ages. Run it in any server.
2. **Discord error alerts** — set `ERROR_WEBHOOK_URL` in `.env` and every
   error-level log posts to that webhook (deduped 1/message/10 min, capped 5/min;
   webhook failures are swallowed so alerting can't crash the bot). This is the
   only path that surfaces *runtime* errors — deploy failures and cookie staleness
   already alert via their own workflows. Leave unset in local dev.
3. **The `ops:*` scripts and quick checks below** — for when you need to be on the
   box. The `ops:*` scripts (`npm run ops:logs`, `ops:health`, `ops:deploy`,
   `ops:ssh`) assume a `Host fm-hachimi-vps` entry in your `~/.ssh/config`.

## Gateway outages and the watchdog

Added 2026-09-01 after the bot sat wedged for ~50 minutes while Docker reported
`healthy`.

**What happens.** `@discordjs/ws@1.2.3` classifies only ECONNRESET /
ECONNREFUSED / ETIMEDOUT / EAI_AGAIN as network errors. An HTTP-level handshake
failure (`Unexpected server response: 503`) carries no `.code`, so the shard is
destroyed with `recover: Resume`, which *keeps* the session — and with it the
stale `resume_gateway_url`. It then retries that same dead host every 500 ms,
forever, with no backoff and no attempt cap. Discord drains gateway hosts while
recovering from an incident, which is exactly when this bites: our outage began
14 seconds after Discord marked a major incident resolved.

**How to recognise it.** `docker logs` shows a steady ~2/s stream of shard
errors and nothing else moving — playback progress frozen at a fixed
`currentTime`, no `shardReconnecting` / `shardResume` / `ready` lines. The
give-away that it is *not* the network: a fresh WebSocket from inside the same
container connects fine.

```bash
# is the wedge local to the shard, or is Discord/the network actually down?
docker exec bilibili-discord-bot node -e '
const ws = new (require("ws"))("wss://gateway.discord.gg/?v=10&encoding=json");
ws.on("message", m => { console.log("OK", String(m).slice(0, 80)); process.exit(0); });
ws.on("error", e => { console.log("ERR", e.message); process.exit(1); });'
```

If that prints `OK` while the bot keeps logging 503s, the shard is wedged.

**What the bot does about it now.** `src/bot/gateway_watchdog.ts` tracks the
outage. Failures are logged once, then throttled to one line per 15 s. If the
gateway stays down past `GATEWAY_STUCK_TIMEOUT_MS` (default 120 s) the process
exits 1; `restart: unless-stopped` brings it back with a fresh IDENTIFY, and the
resume snapshot restores playback. A restart is the *only* in-process escape —
nothing short of dropping the session clears the poisoned resume URL.

**What you do about it.** Normally nothing: expect one restart, then recovery.
If you catch it before the watchdog does, `docker restart bilibili-discord-bot`
is the same fix. Knobs: `GATEWAY_STUCK_TIMEOUT_MS` (0 disables the watchdog),
`GATEWAY_CHECK_INTERVAL_MS`, `GATEWAY_LOG_INTERVAL_MS`.

**The other shape: a crash with no shard error before it.** Same family of
failure, different exit. If `ws` gets a non-101 handshake response *after*
discord.js has detached from that socket, nothing is listening, and Node turns
it into an uncaught exception. The tell is a `Uncaught exception` line with
`Unexpected server response: <5xx>` and a `ws/lib/websocket.js:913` frame, with
**no** gateway-failure line before it. Seen 2026-08-08 (521) and 2026-09-01
(522, ~11s outage plus an interrupted track). These are now logged and ignored
rather than fatal — the socket is abandoned and holds no state, and a gateway
that is genuinely unreachable still reaches the watchdog through the fresh
connection. If you see this line, no action is needed; if you see it *often*,
Discord's edge is flapping.

**Health endpoints.** `/healthz` is a static 200 — it proves the process is
alive and nothing more, which is why the container looked healthy throughout.
`/readyz` combines gateway readiness and voice-session health; confirmed voice
degradation also returns 503. Docker healthchecks and ops alerting should use it. An unhealthy
container is *not* restarted by the restart policy — that is the watchdog's job.

## Quick checks

### Voice membership recovery

The bot now checks intended voice sessions against Discord every 30 seconds,
and also checks after shard-ready/resume and guild-available events. Two
confirmed mismatches trigger per-guild reconstruction, even if the local voice
connection still says `ready`. Persistent non-ready local transport is checked
as well. REST timeouts, 429s and 5xx responses do not count as missing membership.

Recovery preserves the queue/seek/pause/radio snapshot before destroying the
stale connection. Transient failures retry after 5, 10, 20, 40, then 60 seconds
(60-second cap). Definitive channel deletion or access/permission failures stop
retries and remain visible as degraded. Stop, leave, a new join, and applicable
moderation exemptions cancel stale recovery work. Pending recovery snapshots
remain part of the existing restart snapshot file.

`/readyz` includes `botStats.voice` with expected/observed channels, last
verification time, local status and recovery attempts; confirmed degradation
returns 503 even when the gateway is healthy. `/status` includes a recovery
summary. `/metrics` exposes `voice_membership_mismatch`,
`voice_membership_last_verified_timestamp_seconds`, `voice_recovery_pending`,
`voice_recovery_attempts_total` and `voice_recovery_success_total`.

When diagnosing an empty channel, do not infer membership from FFmpeg progress
or gateway readiness. Confirm using the authenticated Discord voice-state API;
10065 (`Unknown Voice State`) is the explicit missing-state response. Never log
the bot token or raw voice-server token payloads. See
[`2026-09-16 incident`](docs/incidents/2026-09-16-voice-presence-desync.md).

```bash
# container health + recent cookie refreshes
cd ~/bilibili-bot && docker compose ps && docker compose logs --tail=200 | grep -i cookie

# cookie freshness (age in seconds)
echo $(( $(date +%s) - $(stat -c %Y ~/bilibili-bot/secrets/youtube_cookies.txt) ))

# metrics over the loopback binding
curl -s 127.0.0.1:9090/metrics | jq '.gauges, .counters.youtube_cookie_refresh_total'

# Check extraction metadata (prints the video id on success).
# NOTE: this only proves a format was found. For "can we actually play?", use the
# 200-check in the decision tree above — see the 2026-08-08 note on why.
docker exec bilibili-discord-bot yt-dlp \
  --js-runtimes node \
  --cookies /app/secrets/youtube_cookies.txt \
  --skip-download --no-playlist --no-warnings \
  --format 'bestaudio[vcodec=none][acodec!=none]/best[height<=360][acodec!=none]/worst[acodec!=none]' \
  --print id \
  'https://www.youtube.com/watch?v=AUfXW1EdLew'

# playback smoothness, grouped by platform (added 2026-08-08). Each stream logs
# one summary line; gapsOver* count sampled stalls in the FFmpeg output.
docker logs bilibili-discord-bot --since 24h 2>&1 | grep "Playback stream health"
```

## Playback tuning knobs

[`.env.example`](.env.example) lists common settings; advanced defaults are in
[`src/config/config.ts`](src/config/config.ts). These knobs help investigate
extraction failures and choppy playback.

| Env | Default | What it does |
|-----|---------|--------------|
| `YOUTUBE_PLAYER_CLIENT` | *(empty)* | Pin yt-dlp's player client. `web_embedded` was used in the August incident; verify the active setting before changing it. |
| `YOUTUBE_PLAYER_CLIENT_FALLBACKS` | `web_embedded,mweb,default` | Tried in order when the primary client's URL fails the stream probe. |
| `YOUTUBE_EXTRACTION_TIMEOUT_MS` | `30000` | yt-dlp kill timer per extraction. Raise if extraction is legitimately slow on a loaded host. |
| `STREAM_PROBE_ENABLED` | `true` | Byte-range check on extracted URLs before caching/playing. Turn off only to isolate a probe bug. |
| `STREAM_PROBE_TIMEOUT_MS` | `2000` | Probe timeout. Too low turns slow-but-fine CDNs into false failures. |
| `STREAM_HEALTH_SAMPLE_MS` | `500` | Stall sampling rate. The `ffmpegInactive*` warn/kill thresholds are separate and unchanged. |
