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

The test server defaults to `1376318047794761838`. Override it with
`TEST_GUILD_ID` only when intentionally moving the test environment.

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

YouTube usually needs cookies on cloud servers. Refresh and upload the YouTube cookie file from a browser session on your own machine:

```bash
bash scripts/refresh-youtube-cookies.sh
```

The script exports cookies through `yt-dlp` and uploads `youtube_cookies.txt` to the VPS. It deliberately uses `https://www.youtube.com/robots.txt` during export, so the refresh flow is not blocked by local playback extraction failures.

If YouTube reports that the browser cookies were rotated or expired, use yt-dlp's recommended private-session flow: open a private/incognito browser window, sign in to YouTube, open `https://www.youtube.com/robots.txt`, export YouTube cookies in Netscape format to `youtube_cookies.txt`, close the private window, then upload the existing file:

```bash
UPLOAD_ONLY=true bash scripts/refresh-youtube-cookies.sh
```

If you only need a local export, run:

```bash
yt-dlp --cookies-from-browser chrome \
  --cookies youtube_cookies.txt \
  --skip-download \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

Bilibili cookies are optional, but may help cloud IPs:

```bash
yt-dlp --cookies-from-browser chrome \
  --cookies cookies.txt \
  --skip-download \
  "https://www.bilibili.com/video/BV1GJ411x7h7"
```

Never commit either cookie file.

## VPS Deploy

On a VPS, clone the repo, create `.env`, then run:

```bash
npm run setup:check
npm run docker:up
npm run docker:logs
```

The compose file mounts `./data`, `./logs`, `./cookies.txt`, and `./youtube_cookies.txt`. `HOST_UID` and `HOST_GID` in `.env` must match the host user that owns those files.

## GitHub Deploy

The deploy workflow SSHes into the VPS, fast-forwards the repo, and runs `scripts/deploy/remote-deploy.sh`. Keeping the deployment shell in the repo makes the same steps reproducible from an SSH session.
