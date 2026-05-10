# F.M. Hachimi

Discord music bot for Bilibili and YouTube audio playback.

Docker is the recommended setup path because the image includes Node.js 22, FFmpeg, Python, and yt-dlp.
It is also the preferred YouTube playback path because the image installs current `yt-dlp[default]` with its JavaScript solver support.

## Run With Docker

```bash
git clone <repo-url>
cd FM-Hachimi
cp .env.example .env
```

Fill in these required values in `.env`:

```bash
DISCORD_TOKEN=
CLIENT_ID=
```

Then run:

```bash
npm run setup:check
npm run docker:up
npm run docker:logs
```

Useful commands:

```bash
npm run docker:down
npm run docker:up
```

## Register Discord Commands

```bash
npm run deploy:commands
```

Set `GUILD_ID` in `.env` for fast guild command registration while developing. Leave `GUILD_ID` empty for global commands.

## Refresh Cookies

YouTube playback often needs browser cookies on cloud servers. Export cookies locally:

```bash
yt-dlp --cookies-from-browser chrome \
  --cookies youtube_cookies.txt \
  --skip-download \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

Put `youtube_cookies.txt` in the project root. `cookies.txt` is optional for Bilibili cloud IP issues.

Never commit cookie files.

## Development Checks

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run bench:extractors
docker build .
```

For local non-Docker run:

```bash
npm run build
npm start
```

More deployment and cookie details live in `docs/ops.md`.
