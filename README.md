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

Stable public commands are deployed globally:

```bash
npm run deploy:commands
```

Testing commands are deployed only to the configured test server, which defaults
to `1376318047794761838`:

```bash
npm run deploy:commands:test
```

Commands or components marked as testing are also runtime-blocked outside the
test server. See `docs/testing-features.md` before adding experimental features.

Legacy all-commands guild deploy is still available for local/dev recovery, but
it must be explicit:

```bash
DEPLOY_LEGACY_GUILD_COMMANDS=true npm run deploy:commands
```

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
