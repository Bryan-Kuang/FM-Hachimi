# Operations Notes

This file holds the details that are useful after first setup. The README stays short so new contributors can get the bot running without reading VPS history.

Feature safety gates for test-only commands/components are documented in [`testing-features.md`](testing-features.md).

## Local Build

```bash
npm install
npm run build
npm start
```

Local playback requires FFmpeg, Python 3, and `yt-dlp[default]`. Docker is easier because the image installs those for you.

## Slash Commands

Default command deploy is production-safe: it registers only stable commands
globally. Testing commands are excluded from the global payload.

```bash
npm run deploy:commands
```

Deploy testing commands only to the test server:

```bash
npm run deploy:commands:test
```

The test server is configured via `TEST_GUILD_ID` (env var locally, repository
secret in CI). There is no built-in default — test-scope deploys fail fast with
a clear error when it is unset.

To clear test-server commands:

```bash
CLEAR_GUILD_COMMANDS=true npm run deploy:commands:test
```

Legacy all-commands guild registration is still available for manual local/dev
recovery. Set `GUILD_ID`, then run:

```bash
DEPLOY_LEGACY_GUILD_COMMANDS=true npm run deploy:commands
```

Global Discord command updates can take up to an hour.

## Testing Features

Use `stage: "testing"` for experimental slash commands and `testing:` custom ID
prefixes for experimental buttons/select menus. Runtime guards deny those
features outside the test server even if an old message leaks into another
guild.

Full authoring and graduation rules live in [`testing-features.md`](testing-features.md).

## Cookies

YouTube usually needs cookies on cloud servers. The normal Docker path is automatic:

- The dedicated VPS Chrome profile is mounted read-only at `/app/youtube-browser-profile`.
- The bot exports cookies through `yt-dlp --cookies-from-browser`.
- Candidate cookies are validated before replacing the live file.
- The live file is overwritten in place at `secrets/youtube_cookies.txt`.
- Temporary candidate files are deleted after success or failure.

If YouTube extraction hits an auth/bot-check failure, the bot tries one automatic refresh and retry before showing a user-facing failure.

Production validation on June 2, 2026 refreshed the VPS cookie from the dedicated Chrome profile, copied the refreshed bytes into the running container in place, and confirmed yt-dlp could resolve both:

- `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- `https://www.youtube.com/watch?v=AUfXW1EdLew`

To re-run a safe validation after deploy, print only the resolved video ID:

```bash
docker exec bilibili-discord-bot yt-dlp \
  --js-runtimes node \
  --cookies /app/secrets/youtube_cookies.txt \
  --skip-download \
  --no-playlist \
  --no-warnings \
  --format 'bestaudio[vcodec=none][acodec!=none]/best[height<=360][acodec!=none]/worst[acodec!=none]' \
  --print id \
  'https://www.youtube.com/watch?v=AUfXW1EdLew'
```

For emergency/manual recovery only:

```bash
bash scripts/refresh-youtube-cookies.sh
```

Bilibili cookies are optional, but may help cloud IPs:

```bash
yt-dlp --cookies-from-browser chrome \
  --cookies secrets/bilibili_cookies.txt \
  --skip-download \
  "https://www.bilibili.com/video/BV1GJ411x7h7"
```

Never commit `secrets/`, cookie files, browser profiles, or bot-account credentials. If Google invalidates the dedicated browser login session, the VPS can try best-effort repair with `scripts/ops/youtube-cookie-login-repair.sh` after you place `YOUTUBE_BOT_EMAIL` and `YOUTUBE_BOT_PASSWORD` in `/home/ubuntu/.fm-hachimi-youtube/credentials.env` with mode `600`. The helper expects `xdotool` and `xclip` on the VPS so credentials are pasted without appearing as process arguments. If Google presents CAPTCHA, 2FA, or a security challenge, refresh automation fails closed and the browser profile must be repaired manually.

## VPS Deploy

On a VPS, clone the repo, create `.env`, then run:

```bash
npm run setup:check
npm run docker:up
npm run docker:logs
```

The compose file mounts `./data`, `./logs`, `./secrets`, and the dedicated YouTube browser profile. `HOST_UID` and `HOST_GID` in `.env` must match the host user that owns those files.

## GitHub Deploy

The deploy workflow SSHes into the VPS, fast-forwards the repo, and runs `scripts/deploy/remote-deploy.sh`. Keeping the deployment shell in the repo makes the same steps reproducible from an SSH session.
