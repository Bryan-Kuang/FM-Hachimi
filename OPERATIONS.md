# Operations

Runbook for deploying and operating F.M. Hachimi on the VPS.

## Topology

- **Host:** Oracle Cloud Ubuntu VPS, repo at `/home/ubuntu/bilibili-bot`, tracks `main`.
- **Runtime:** single Docker container (`docker compose`), healthchecked, metrics on `127.0.0.1:9090` (loopback only).
- **State lives on the host (bind mounts), never in the image:**
  - `secrets/` — `youtube_cookies.txt`, `bilibili_cookies.txt` (mode 600)
  - `data/` — `daily_hachimi.json` (must survive rebuilds)
  - `logs/`
  - `~/.fm-hachimi-youtube/profile` → mounted read-only at `/app/youtube-browser-profile`

> `data/`/`logs/` must be writable by the container's `HOST_UID:HOST_GID` (set in `.env`).
> On Oracle's image `ubuntu` is uid **1001** (not 1000) — mismatch causes silent EACCES
> on `daily_hachimi.json` (the 2026-04-28 incident).

## Deploy flow

`push → main` → **CI** `check` (lint, typecheck, test, build) → **CI `image`** builds and
pushes the Docker image to **GHCR** (`ghcr.io/bryan-kuang/fm-hachimi`, tagged `latest` +
commit SHA) → on success **Deploy** SSHes to the VPS → `git pull --ff-only` →
`scripts/deploy/remote-deploy.sh` → `docker login ghcr.io` + `docker compose pull` +
`up -d` (pulls the **exact image CI tested** via `IMAGE_TAG`=commit SHA) → healthcheck poll.
Failures ping Discord. (PRs build the image for validation but do not push.)

**Registry deploy prerequisites** (one-time): either make the `fm-hachimi` GHCR package
**public** (then no auth needed to pull), or add a repo secret **`GHCR_TOKEN`** = a classic
PAT with `read:packages` so the VPS can pull a private image. CI pushes using the built-in
`GITHUB_TOKEN` (no PAT needed for push). Local dev still builds: `docker compose up --build`.

### Slash commands & the testing system

**Stable (global) commands auto-deploy** when command files change on `main` (the
`Deploy Discord Commands` workflow has a `push` trigger paths-filtered to
`src/bot/commands/**`). **Testing / guild scopes are still manual** via that
workflow's `workflow_dispatch` — e.g. run it with `test` after adding a
`stage:'testing'` command. A command's `stage` field decides where it can live:

- `stage: 'stable'` (or unset) → **global** (every server, ~1h propagation).
- `stage: 'testing'` → **test guild only**, plus a runtime guard (`assertTestingGuild`)
  that rejects it elsewhere — so testing features are gated even if registration leaks.
  Testing buttons use a `testing:` customId prefix.

Workflow options:

| Option | Scope | Use |
|---|---|---|
| `global` | stable cmds, everywhere | **production default** |
| `test` | `stage:'testing'` cmds → `TEST_GUILD_ID` | try a feature in the test server (no dups) |
| `guild` | **all** cmds → one guild (legacy) | instant testing; **duplicates global — avoid in prod** |
| `clear_guild` | clear a guild's scoped cmds | remove duplicates left by `guild` |

**Duplicates** = a command registered both globally and guild-scoped. Use `global` + `test`
(non-overlapping → never duplicates); reserve `guild` for deliberate cases and clean up with
`clear_guild`. Note: `stage:'testing'` is currently unused — tag a command with it to route it
through the `test` flow.

## YouTube cookies — two tiers

**Tier 1 — in-app auto-refresh (automatic).** `src/youtube/cookie_refresh_service.ts` runs at
startup, every 6h, and on auth-failure. It exports cookies from the mounted Chrome profile
(`yt-dlp --cookies-from-browser chrome+basictext:/app/youtube-browser-profile`), validates
against `validateUrls`, then atomically writes `secrets/youtube_cookies.txt` (mode 600) **only
on success**. So the file's mtime = time of last *successful* refresh.

- Metrics on `/metrics`: `youtube_cookie_last_refresh_success_timestamp_seconds` (gauge),
  `youtube_cookie_refresh_total{result=success|failure}` (counter).
- Alert: the **Cookie Health** workflow checks the file's age every 6h and pings Discord if it
  exceeds ~13h (two missed cycles).

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

`scripts/ops/youtube-cookie-login-repair.sh` attempts an automated login using
`~/.fm-hachimi-youtube/credentials.env` (mode 600, **VPS-only, never in git**) but fails closed
on CAPTCHA/2FA. `scripts/refresh-youtube-cookies.sh` is the export-from-local-Chrome fallback.

Bilibili cookies (`bilibili_cookies.txt`) are static — refresh manually when they expire.

## Media cache (YouTube)

Since cold YouTube extraction is ~16s and can't be made fast on this IP, the bot
caches the **downloaded audio file** for replayed videos. After the first play of a
video, `YouTubeExtractor` downloads the audio (HTTP GET of the signed URL) into the
`cache/` host bind-mount; later plays — even after the signed URL expires — read the
local file instantly (no yt-dlp, no network). `src/audio/media_cache.ts`, keyed by
video, LRU-evicted by entry count **and** total size.

- Lives at `cache/` (mounted `/app/cache`), with a small `cache/index.json`.
- Env: `YOUTUBE_MEDIA_CACHE_ENABLED` (default true), `YOUTUBE_MEDIA_CACHE_DIR`,
  `YOUTUBE_MEDIA_CACHE_MAX_ENTRIES` (200), `YOUTUBE_MEDIA_CACHE_MAX_MB` (1024).
- Cached tracks set `cached: true` so the player skips stale-URL refresh + CDN-retry.
- Clear it any time: `rm -rf ~/bilibili-bot/cache/*` (re-downloads on next play).
- A cache hit logs `YouTube media cache hit — playing local file`.

## Quick checks

```bash
# container health + recent cookie refreshes
cd ~/bilibili-bot && docker compose ps && docker compose logs --tail=200 | grep -i cookie

# cookie freshness (age in seconds)
echo $(( $(date +%s) - $(stat -c %Y ~/bilibili-bot/secrets/youtube_cookies.txt) ))

# metrics over the loopback binding
curl -s 127.0.0.1:9090/metrics | jq '.gauges, .counters.youtube_cookie_refresh_total'
```
