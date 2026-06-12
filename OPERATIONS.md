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

One **`Pipeline`** workflow, a single `needs:` graph: **`check → image → deploy → deploy-commands`**.
`push → main` runs `check` (lint, typecheck, test, build, compose) → `image` builds and
pushes to **GHCR** (`ghcr.io/bryan-kuang/fm-hachimi`, tagged `latest` + commit SHA) →
`deploy` SSHes to the VPS → `git pull --ff-only` → `scripts/deploy/remote-deploy.sh` →
`docker login ghcr.io` + `docker compose pull` + `up -d` (pulls the **exact image CI tested**
via `IMAGE_TAG`=commit SHA) → healthcheck poll → `deploy-commands` registers global commands.
Failures ping Discord. PRs run `check` + `image` (build-only, no push/deploy). The scheduled
`Cookie Health` monitor is a separate workflow.

**Registry deploy prerequisites** (one-time): either make the `fm-hachimi` GHCR package
**public** (then no auth needed to pull), or add a repo secret **`GHCR_TOKEN`** = a classic
PAT with `read:packages` so the VPS can pull a private image. CI pushes using the built-in
`GITHUB_TOKEN` (no PAT needed for push). Local dev still builds: `docker compose up --build`.

### Slash commands & the testing system

**Stable (global) commands auto-deploy** at the end of the `Pipeline` (the
`deploy-commands` job, after a successful deploy on `main`). **Testing / guild scopes
are manual** via the `Pipeline` workflow's `workflow_dispatch` — e.g. run it with `test`
after adding a
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
through the `test` flow. Authoring and graduation rules for testing features live in
[`docs/testing-features.md`](docs/testing-features.md).

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
on CAPTCHA/2FA. It needs `xdotool` and `xclip` on the VPS so credentials are pasted without
appearing as process arguments. `scripts/refresh-youtube-cookies.sh` is the
export-from-local-Chrome fallback.

Bilibili cookies (`bilibili_cookies.txt`) are static — refresh manually when they expire:

```bash
yt-dlp --cookies-from-browser chrome \
  --cookies secrets/bilibili_cookies.txt \
  --skip-download \
  "https://www.bilibili.com/video/BV1GJ411x7h7"
```

Never commit `secrets/`, cookie files, browser profiles, or bot-account credentials.

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

## World Cup (temporal feature)

A time-boxed feature that pushes **live World Cup updates** (kickoff / goal /
full-time) to a subscribed channel and answers on-demand `/worldcup` queries. It
is **inert outside the tournament window** and needs no teardown — it simply stops
responding after `WORLD_CUP_END`.

- **Data source:** ESPN's public scoreboard JSON (`fifa.world`) — no login, no key,
  the same data backing a public site. Wrapped behind `src/world_cup/source.ts` so
  the crawl target is swappable. `src/world_cup/world_cup_service.ts` polls it
  (adaptive cadence: ~`livePollMs` while a match is live, else `idlePollMs`), diffs
  successive polls, and posts only the changes.
- **Commands** (`/worldcup`): `subscribe #channel` / `unsubscribe` (Manage Server),
  `today`, `schedule date:YYYY-MM-DD`, `status`. The `today`/`schedule` commands
  fetch **independently of the poller** — they are the reliable manual fallback when
  live updates are degraded. `status` shows updater health.
- **Day boundaries:** "today" and `schedule` dates are calendar days in
  `WORLD_CUP_TIMEZONE` (default `America/Toronto` — matches venue-evening dates in
  official listings). ESPN groups its scoreboard by US-Eastern day, so the service
  fetches adjacent boards and filters by each match's own kickoff time; late
  kickoffs near midnight UTC are not dropped (e.g. a 22:00 ET match is 02:00 UTC
  the next day).
- **State** lives under the persisted `data/` mount (no new mount): `data/world_cup/`
  with `subscriptions.json` (per-guild channel) and `state.json` (last match scores
  for diffing — reloaded on boot so a restart never re-posts past events).
- **Env:** `WORLD_CUP_ENABLED` (default true), `WORLD_CUP_START` (`2026-06-11`),
  `WORLD_CUP_END` (`2026-07-21`, exclusive — margin past the Jul 19 final),
  `WORLD_CUP_SOURCE_URL`,
  `WORLD_CUP_LIVE_POLL_MS` (60000), `WORLD_CUP_IDLE_POLL_MS` (600000),
  `WORLD_CUP_REQUEST_TIMEOUT_MS` (10000), `WORLD_CUP_TIMEZONE`, `WORLD_CUP_DATA_DIR`.
- **Reset:** `rm -rf ~/bilibili-bot/data/world_cup/*` (re-seeds on next poll;
  subscriptions are lost). To disable mid-tournament: set `WORLD_CUP_ENABLED=false`
  and redeploy.
- A degraded source logs `WorldCup poll failed; commands remain available as fallback`
  and `/worldcup status` reports `⚠️ Auto-updates degraded`.

## Quick checks

```bash
# container health + recent cookie refreshes
cd ~/bilibili-bot && docker compose ps && docker compose logs --tail=200 | grep -i cookie

# cookie freshness (age in seconds)
echo $(( $(date +%s) - $(stat -c %Y ~/bilibili-bot/secrets/youtube_cookies.txt) ))

# metrics over the loopback binding
curl -s 127.0.0.1:9090/metrics | jq '.gauges, .counters.youtube_cookie_refresh_total'

# validate the live YouTube cookie file end-to-end (prints the video id on success)
docker exec bilibili-discord-bot yt-dlp \
  --js-runtimes node \
  --cookies /app/secrets/youtube_cookies.txt \
  --skip-download --no-playlist --no-warnings \
  --format 'bestaudio[vcodec=none][acodec!=none]/best[height<=360][acodec!=none]/worst[acodec!=none]' \
  --print id \
  'https://www.youtube.com/watch?v=AUfXW1EdLew'
```
