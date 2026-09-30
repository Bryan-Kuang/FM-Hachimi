# F.M. Hachimi

Discord music bot for Bilibili and YouTube audio playback.

Docker is the recommended setup path because the image includes Node.js 22, FFmpeg, Python, and yt-dlp.
It is also the preferred YouTube playback path because the image installs current `yt-dlp[default]` with its JavaScript solver support.

## Run With Docker

The setup and command-registration scripts need Node.js 22+ on the host.
Docker Compose runs the bot and its YouTube PO-token sidecar. Before starting,
set `HOST_UID` / `HOST_GID` to the owner of the mounted directories and adjust
`YOUTUBE_COOKIE_PROFILE_HOST` to the dedicated browser profile on your host.
See [cookie setup and recovery](OPERATIONS.md#youtube-cookies--decision-tree).

```bash
git clone https://github.com/Bryan-Kuang/FM-Hachimi.git
cd FM-Hachimi
npm ci
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

All supported commands are deployed globally:

```bash
npm run deploy:commands
```

If a guild ever ends up with duplicate commands (global + guild-scoped), clear
the guild-scoped set:

```bash
CLEAR_GUILD_COMMANDS=true GUILD_ID=<guild-id> npm run deploy:commands
```

Before upgrading from a version with testing commands, clear this application's
old guild-scoped commands in each former test server using the command above.
Then register the global commands. The old `TEST_GUILD_ID` configuration is no
longer used; keep its value only long enough to identify the guild to clear.

## Supported Features

- `/play query:<video URL or keywords>`: one playback/search entry point.
  Keyword searches always include both Bilibili and YouTube; URLs use their own
  platform. Bilibili `?p=2` links play the selected part.
- `/radio`: continuous Hachimi rotation, next-track prefetch and periodic mandatory
  breaks. Ordinary requests interject and then return to the rotation; requests
  and skipping remain blocked during the break.
- `/annoying`: persistent anti-disconnect mode. When an exempt user is configured,
  only that user may stop playback or disarm the mode while it is armed.
- `/daily-hachimi setup|disable|status`: scheduled recommendations and click-to-play.
  Setup and disable require Manage Server permission; times use `America/Toronto`
  (default 12:00, one recommendation; configurable from one to ten).
- `/pause`, `/resume`, `/skip`, `/prev`, `/stop`, `/queue`, `/nowplaying`, `/help`
  and `/status` provide playback controls and diagnostics.

Playlist/favorites/collection imports, automatic whole-video multipart imports,
file attachments and the separate `/search` and `/hachimi` commands are removed.
Use a single-video link or search with `/play`. Old search menus ask you to search
again; current paginated menus retain direct video identities.

Automated tests, runtime recovery and health checks are retained. Runtime error
alerts are available when `ERROR_WEBHOOK_URL` is configured.
A future cloud repair tool is a separate project, not part of the music bot.

## YouTube Cookies

YouTube playback often needs browser cookies on cloud servers. In Docker, the bot refreshes its own YouTube cookie file from the dedicated VPS Chrome profile and keeps it in `secrets/youtube_cookies.txt`.

The Docker compose file mounts `secrets/` as a directory, not `youtube_cookies.txt` as a single file, so refreshed cookie contents are visible to the running container without a restart.

If the automatic refresh fails, recovery happens on the VPS — see the
[cookie decision tree](OPERATIONS.md#youtube-cookies--decision-tree).

Never commit cookie files or the dedicated browser profile.

## Development Checks

```bash
npm ci
npm run ci  # lint, typecheck, unit/integration/regression tests, build
```

CI also validates Docker Compose and builds the container image. For local
container validation after configuring `.env`:

```bash
docker compose config --quiet
docker build .
```

`npm run bench:extractors` is an optional live extractor check; it accesses
external services and is separate from the automated test suite.

For a non-Docker run, install FFmpeg and yt-dlp, adjust `/app/...` cookie, cache
and data paths in your environment to writable local paths, then:

```bash
npm run build
npm start
```

## Documentation

| Document | Purpose |
|---|---|
| [Operations](OPERATIONS.md) | Deployment, command migration, cookies, monitoring and recovery |
| [Architecture](docs/architecture.md) | Current modules, playback flow and deployment topology |
| [Environment template](.env.example) | Common settings; advanced defaults live in [config.ts](src/config/config.ts) |
| [Voice incident record](docs/incidents/2026-09-16-voice-presence-desync.md) | Historical evidence and recovery verification, not current deployment status |
| [Simplification record](docs/superpowers/plans/2026-09-30-simplify-bot.md) | Scope and validation of the September simplification |
