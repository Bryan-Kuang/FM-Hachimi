# Operations Notes

This file holds the details that are useful after first setup. The README stays short so new contributors can get the bot running without reading VPS history.

## Local Build

```bash
npm install
npm run build
npm start
```

Local playback requires FFmpeg, Python 3, and `yt-dlp[default]`. Docker is easier because the image installs those for you.

## Slash Commands

For quick development, set `GUILD_ID` in `.env` and run:

```bash
npm run deploy:commands
```

For production/global command registration, leave `GUILD_ID` empty. Global Discord command updates can take up to an hour.

## Cookies

YouTube usually needs cookies on cloud servers. Export cookies from a browser session on your own machine:

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
