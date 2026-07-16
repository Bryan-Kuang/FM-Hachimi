# Operations

Runbook for deploying and operating F.M. Hachimi on the VPS.

## Topology

- **Host:** Oracle Cloud Ubuntu VPS, repo at `/home/ubuntu/bilibili-bot`, tracks `main`.
- **Runtime:** single Docker container (`docker compose`), healthchecked, metrics on `127.0.0.1:9090` (loopback only).
- **State lives on the host (bind mounts), never in the image:**
  - `secrets/` — `youtube_cookies.txt`, `bilibili_cookies.txt` (mode 600)
  - `data/` — `daily_hachimi.json` (must survive rebuilds); `resume_state.json`
    (playback snapshot written on shutdown so active sessions resume after a deploy —
    consumed on startup, discarded if older than `RESUME_MAX_AGE_MS`, default 15 min)
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
| `clear_guild` | clear a guild's scoped cmds | remove duplicate commands from a guild |

**Duplicates** = a command registered both globally and guild-scoped. `global` + `test` are
non-overlapping, so they never duplicate. The legacy `guild` all-commands deploy mode was
removed 2026-07 (it was the only way duplicates got created); `clear_guild` stays as the
remediation tool. Note: `stage:'testing'` is currently unused — tag a command with it to
route it through the `test` flow. Authoring and graduation rules for testing features live
in [`docs/testing-features.md`](docs/testing-features.md).

## YouTube cookies — decision tree

When cookies go stale, work down this list; each step is the fallback for the one above:

1. **In-app auto-refresh** (automatic, tier 1 below) — normally nothing to do.
2. **Automated login repair**: `bash scripts/ops/youtube-cookie-login-repair.sh` on the VPS
   (uses stored credentials; fails closed on CAPTCHA/2FA).
3. **Manual VNC login** (tier 2 below) — the last resort when the automated repair hits
   a CAPTCHA.

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

Since cold extraction is slow (YouTube ~16s; Bilibili re-extracts + streams from its
CDN each play) and can't be made fast on this IP, the bot caches the **downloaded
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

## Spotify direct playback

Spotify never exposes public CDN URLs the way Bilibili/YouTube do — the only
way to play *real* Spotify audio (rather than a YouTube re-recording) is a
client that speaks Spotify's own protocol, authenticated as a real account.
`src/spotify/direct_extractor.ts` drives **zotify**
(`github.com/Googolplexed0/zotify`, pinned `v0.17.0` — a maintained
community fork; the original zotify-dev project has been stale since Sept
2024) as a per-track sidecar: given a track id and a cached login, it logs in
and writes the decoded audio to a local file, then exits. `zotify` was chosen
over the official `librespot-org/librespot` binary because that binary is a
Spotify Connect **receiver** — it needs another Spotify client (phone/
desktop) to remote-control it and pick what plays, so it can't be driven as a
plain "fetch this track id and exit" subprocess. **Password login is dead**
(deprecated since librespot v0.5, unsupported since); OAuth is the only login
path, for zotify and for librespot generally.

This is **off by default** (`SPOTIFY_DIRECT_ENABLED=false`). Every consumer
(`resolveSpotifyPlayback` in `src/spotify/playback_resolver.ts`) already
falls back to the existing YouTube-match behavior (PR #142) on any failure —
sidecar not installed, not logged in, timeout, region lock, network error —
so leaving this disabled, or a login going stale, degrades silently to
"Spotify picks play via their closest YouTube match" rather than breaking
playback.

### Account guidance

Use a **dedicated** Spotify account for the bot — never the operator's main
account. Running an unofficial client against Spotify's protocol is against
their ToS and carries a ban risk; a dedicated account contains the blast
radius. **Premium** is strongly preferred: zotify auto-selects the highest
quality available (`-q auto`), which is 320kbps on Premium vs. ~160kbps on
Free, and Free accounts have ads/shuffle restrictions that don't apply to
API-driven single-track fetches but are a general reason to avoid Free for
any bot account.

### One-time login bootstrap

zotify's login is interactive OAuth (a URL to open in a browser, redirected
to a local HTTP callback that captures the token) — there's no way to fully
automate it, and it only needs to run once (or again after `credentials.json`
is deleted/expires). Do it **locally, on a machine with a browser** — not by
port-forwarding into the VPS — then ship the resulting file to the VPS:

```bash
# 1. On your laptop (or any machine with Python 3.10+ and a browser):
python3 -m venv /tmp/zotify-login && /tmp/zotify-login/bin/pip install \
  "git+https://github.com/Googolplexed0/zotify.git@v0.17.0"

# 2. Run it against a throwaway track — it prints an
#    "https://accounts.spotify.com/authorize?..." URL and waits (up to a
#    couple minutes) for the browser callback on 127.0.0.1:4381. Log into
#    the DEDICATED bot account in that browser tab, not your own.
mkdir -p /tmp/zotify-creds
/tmp/zotify-login/bin/zotify --no-splash --creds /tmp/zotify-creds \
  --root-path /tmp/zotify-out --output-single "{id}" \
  https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
#   → click the printed link, approve access as the bot account.
#   Success leaves /tmp/zotify-creds/credentials.json and downloads the
#   throwaway track to /tmp/zotify-out/ (safe to delete both test outputs
#   after copying credentials.json out).

# 3. Ship the credentials file to the VPS (mode 600, matches secrets/ convention):
scp /tmp/zotify-creds/credentials.json ubuntu@<vps>:~/bilibili-bot/secrets/spotify/credentials.json
ssh ubuntu@<vps> 'chmod 600 ~/bilibili-bot/secrets/spotify/credentials.json'

# 4. Enable and redeploy:
#    set SPOTIFY_DIRECT_ENABLED=true in .env on the VPS, then redeploy
#    (docker compose up -d picks up the mounted ./secrets/spotify/ dir —
#    no compose changes needed, secrets/ is already bind-mounted).
```

`credentials.json` is a long-lived OAuth refresh token (zotify refreshes the
access token itself on each run) — it does **not** need to be regenerated on
a schedule. Regenerate it (repeat the steps above) only if Spotify revokes it
(account password change, suspicious-activity flag, or the token simply
stops working — the bot's fallback to YouTube-match means this fails safe,
not loudly).

### Env vars

| Var | Default | Meaning |
|---|---|---|
| `SPOTIFY_DIRECT_ENABLED` | `false` | Master switch — off skips constructing the extractor entirely. |
| `SPOTIFY_CREDENTIALS_DIR` | `/app/secrets/spotify` | Where `credentials.json` lives (under the existing `./secrets` mount). |
| `SPOTIFY_DIRECT_CACHE_DIR` | `/app/cache/spotify` | Downloaded track files, keyed by track id (under the existing `./cache` mount) — a hit skips re-invoking the sidecar entirely. |
| `SPOTIFY_DIRECT_TIMEOUT_MS` | `30000` | Kill timer for the sidecar subprocess. |
| `SPOTIFY_SIDECAR_CMD` | `zotify` | Executable name/path (resolved on `PATH`; the Docker image installs it there). |

(Also requires the existing `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` —
those drive catalog *metadata* lookups (title/artist/duration for search
results and matching), which are separate from this account-authenticated
*audio* path and stay required either way.)

### Fallback behavior

- `SPOTIFY_DIRECT_ENABLED=false`, or the extractor is enabled but not yet
  logged in (`credentials.json` missing) → every Spotify pick resolves via
  the YouTube-match path exactly as PR #142 did before this feature existed.
- Direct extraction throws for any reason (sidecar crash, region lock, login
  expired, timeout) → same fallback, logged as `Spotify direct extraction
  failed — falling back to YouTube match` with the error.
- **Radio mode**: while radio is enabled for a guild, direct extraction is
  skipped entirely (never even attempted) — radio's `playNow()` can only
  (re-)extract from a URL, not accept an already-downloaded local file.
  Radio picks always resolve to a YouTube URL.
- Spotify **playlist/album** bulk-enqueue (`/play` on an album or playlist
  link) deliberately stays on the lazy `ytsearch1:` path, not direct
  extraction — fetching every item in a 50-track playlist through the
  account sidecar would hammer it; only single-track picks (search results,
  pasted track links) go through direct extraction. Revisit if this becomes
  a common request.

### Verify

```bash
# confirms the extractor was constructed and whether it's already logged in
docker compose logs | grep "Spotify direct extraction enabled"
#   {"configured":true,...}  → credentials.json found, direct extraction will be attempted
#   {"configured":false,...} → enabled but not logged in yet; every pick still falls back to YouTube

# a successful direct play logs one of:
docker compose logs | grep -E "Spotify direct extraction (completed|cache hit)"
# a fallback logs:
docker compose logs | grep "falling back to YouTube match"
```

### Disable

Set `SPOTIFY_DIRECT_ENABLED=false` and redeploy — every Spotify pick reverts
to YouTube-match immediately, no other changes needed. `credentials.json`
stays on disk untouched for next time.

## World Cup (temporal feature)

A time-boxed feature that pushes **live World Cup updates** (kickoff / goal /
full-time) to a subscribed channel and answers on-demand `/worldcup` queries. It
is **inert outside the tournament window** and needs no teardown — it simply stops
responding after `WORLD_CUP_END`.

- **Data source:** ESPN's public scoreboard JSON (`fifa.world`) — no login, no key,
  the same data backing a public site. Wrapped behind `src/world_cup/source.ts` so
  the crawl target is swappable. `src/world_cup/world_cup_service.ts` polls it
  (adaptive cadence: ~`livePollMs` while a match is live or a kickoff is due; when
  idle it wakes for the next scheduled kickoff, else `idlePollMs`), diffs successive
  polls, and posts only the changes.
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
- **Links:** message titles and a `📺 Watch live on 88看球` line point to the free
  stream (`WORLD_CUP_STREAM_URL`, default `https://www.88kanqiu.tw/match/3/live` — 88看球
  streams the World Cup free without a VPN; `/match/3/live` is its World Cup hub). The
  link label is `WORLD_CUP_STREAM_LABEL` (default `88看球`). The ESPN match page stays as
  the `📊 Match stats` link. Set `WORLD_CUP_STREAM_URL=` (empty) to drop the stream link.
  Note: 88看球 has no public API and blocks bots, so links target the World Cup hub page
  rather than individual-match pages (those aren't reliably mappable from our match data).
- **Env:** `WORLD_CUP_ENABLED` (default true), `WORLD_CUP_START` (`2026-06-11`),
  `WORLD_CUP_END` (`2026-07-21`, exclusive — margin past the Jul 19 final),
  `WORLD_CUP_SOURCE_URL`, `WORLD_CUP_STREAM_URL`, `WORLD_CUP_STREAM_LABEL`,
  `WORLD_CUP_LIVE_POLL_MS` (15000, min 15000), `WORLD_CUP_IDLE_POLL_MS` (600000),
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
