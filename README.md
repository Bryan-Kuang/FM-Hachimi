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

## Cookies (required for YouTube, optional for Bilibili)

YouTube blocks requests from server IPs unless you provide cookies from a logged-in browser session. Without cookies, YouTube playback will fail with "Sign in to confirm you're not a bot."

**How to export cookies:**

1. Log into YouTube (or Bilibili) in Chrome on your local machine
2. Run this on your local machine (not the server):
   ```bash
   # YouTube cookies
   yt-dlp --cookies-from-browser chrome --cookies youtube_cookies.txt --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

   # Bilibili cookies (if needed)
   yt-dlp --cookies-from-browser chrome --cookies cookies.txt --skip-download "https://www.bilibili.com/video/BV1GJ411x7h7"
   ```
3. Copy the cookie files to the project root (same folder as `docker-compose.yml`):
   ```bash
   scp youtube_cookies.txt user@your-server:~/bilibili-bot/
   scp cookies.txt user@your-server:~/bilibili-bot/
   ```

Docker mounts both files automatically. The bot picks them up on startup — no restart needed for new cookie files, but a restart applies them.

**Cookies expire** after a few weeks to months. When YouTube starts failing again, re-export fresh cookies with the same steps above.

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
