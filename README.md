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

Testing commands are deployed only to the test server configured via the
`TEST_GUILD_ID` environment variable (required for this mode — there is no
built-in default):

```bash
TEST_GUILD_ID=<your-test-guild-id> npm run deploy:commands:test
```

Commands or components marked as testing are also runtime-blocked outside the
test server. See `docs/testing-features.md` before adding experimental features.

Legacy all-commands guild deploy is still available for local/dev recovery, but
it must be explicit:

```bash
DEPLOY_LEGACY_GUILD_COMMANDS=true npm run deploy:commands
```

## YouTube Cookies

YouTube playback often needs browser cookies on cloud servers. In Docker, the bot refreshes its own YouTube cookie file from the dedicated VPS Chrome profile and keeps it in `secrets/youtube_cookies.txt`.

The Docker compose file mounts `secrets/` as a directory, not `youtube_cookies.txt` as a single file, so refreshed cookie contents are visible to the running container without a restart.

For emergency/manual recovery only:

```bash
bash scripts/refresh-youtube-cookies.sh
```

Never commit cookie files or the dedicated browser profile.

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

The full deployment, cookie, and monitoring runbook lives in `OPERATIONS.md`.
