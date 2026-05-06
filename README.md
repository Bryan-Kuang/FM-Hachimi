# F.M. Hachimi

Discord music bot that plays audio from **Bilibili** and **YouTube** videos.

Built with Node.js, discord.js v14, yt-dlp, and FFmpeg.

## Commands

| Command | What it does |
|---------|-------------|
| `/play <url or keyword>` | Play a Bilibili or YouTube video |
| `/search <keyword>` | Search videos (option: bilibili or youtube) |
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/skip` | Next track |
| `/prev` | Previous track |
| `/stop` | Stop and clear queue |
| `/queue` | Show queue |
| `/nowplaying` | Show current track |
| `/hachimi` | Play random hachimi videos from Bilibili |
| `/help` | Show help |

## Setup

**Requirements:** Node.js 22+, Python 3, FFmpeg, yt-dlp

```bash
git clone <repo-url>
cd bilibili-discord-bot
npm install
cp .env.example .env   # fill in DISCORD_TOKEN and CLIENT_ID
npm run deploy:commands # register slash commands with Discord
npm start
```

## Docker (production)

```bash
cp .env.example .env   # fill in DISCORD_TOKEN and CLIENT_ID
docker compose up -d --build
```

Cookies files (optional, for bot-detection bypass):
- `cookies.txt` — Bilibili cookies (Netscape format)
- `youtube_cookies.txt` — YouTube cookies (export with `yt-dlp --cookies-from-browser chrome`)

## Environment Variables

Only `DISCORD_TOKEN` and `CLIENT_ID` are required. Everything else has sane defaults.

See `.env.example` for the full list.

## Tests

```bash
npm test              # unit + integration + regression
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
```

## License

MIT
