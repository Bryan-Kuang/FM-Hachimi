# Architecture

Visual map of F.M. Hachimi. For operations (deploying, cookies, incidents) see
[`OPERATIONS.md`](../OPERATIONS.md); for the testing-command system see
[`testing-features.md`](testing-features.md).

## Module map

One node per `src/` directory. Arrows point in the direction of calls.

```mermaid
graph TD
    subgraph Discord glue
        commands["bot/commands<br/>(17 slash commands)"]
        events["bot/events<br/>(buttons, select menus)"]
        client["bot/client"]
    end

    subgraph Features
        services["services<br/>(player, radio, daily hachimi, annoying)"]
        search["search<br/>(keyword search + interleave)"]
        playlists["playlists<br/>(bulk enqueue resolvers)"]
    end

    subgraph Playback engine
        session["session<br/>(guild sessions, resume)"]
        playback["playback<br/>(coordinators, pre-extraction)"]
        audio["audio<br/>(player, media cache, queue)"]
    end

    subgraph Extraction
        bilibili["bilibili<br/>(extractor + API)"]
        youtube["youtube<br/>(extractor + cookie refresh)"]
    end

    ui["ui<br/>(embeds, buttons, progress)"]

    pkg1(["@bryan-kuang/bilibili-audio-extractor"])
    pkg2(["ytdlp-cookie-keeper"])
    pkg3(["discord-voice-resume"])

    client --> commands
    client --> events
    commands --> playback
    commands --> search
    commands --> playlists
    commands --> ui
    events --> ui
    events --> playback

    services -->|radio interludes| playback
    session -->|guild state, resume| playback
    ui -->|now-playing updates| session

    playback --> playlists
    playback --> audio
    playback -->|pre-extraction| bilibili
    playback -->|pre-extraction| youtube

    bilibili -->|media cache| audio
    youtube -->|media cache| audio

    bilibili --> pkg1
    youtube --> pkg2
    session --> pkg3
```

Cross-cutting (used everywhere, omitted from the graph): `config/` (env-validated
settings), `utils/` (formatters, locks, URL routing), `observability/` (metrics +
`/healthz` server on `127.0.0.1:9090`), `models/` + `types.ts` (shared types),
`services/logger_service` (winston).

## Playback data flow

```mermaid
sequenceDiagram
    actor U as User
    participant C as /play command
    participant P as Playback coordinator
    participant X as Extractor (bilibili/ or youtube/)
    participant M as Media cache
    participant A as Audio player
    participant D as Discord voice

    U->>C: /play <url or keywords>
    C->>P: route URL (utils/url_router) + enqueue
    P->>X: resolve audio for URL
    X->>M: cached?
    alt cache hit
        M-->>A: local file path
    else cache miss
        X-->>A: CDN stream URL
        X->>M: background download for next time
    end
    A->>D: opus stream (ffmpeg)
    A-->>U: now-playing card (ui/)
```

The cache is two independent LRU stores (`cache/bilibili/`, `cache/youtube/`),
each capped by entry count and total bytes with its own `index.json`
(`src/audio/media_cache.ts`; caps in `src/config/config.ts`).

## Deploy pipeline

```mermaid
flowchart LR
    push["push to main"] --> check["check<br/>lint · typecheck · test · build"]
    check --> image["image<br/>build + push GHCR<br/>latest + commit SHA"]
    image --> deploy["deploy<br/>SSH to VPS<br/>remote-deploy.sh:<br/>pull · up -d · health poll"]
    deploy --> cmds["deploy-commands<br/>register global slash commands"]

    cron["Mon 20:00 UTC cron"] -->|--no-cache rebuild<br/>fresh yt-dlp| image
    cookie["cookie-health.yml<br/>every 6h"] -->|stale > 13h| hook
    deploy -->|failure| hook["Discord webhook alert"]

    style hook stroke-dasharray: 5 5
```

- PRs run `check` + `image` (build only, no push/deploy).
- The VPS pulls the **exact SHA-tagged image CI tested** — it never rebuilds.
- Full runbook: [`OPERATIONS.md`](../OPERATIONS.md).

## Directory guide

| Directory | Responsibility |
|---|---|
| `src/bot/commands/` | Slash command definitions (one file per command; registry in `index.ts`) |
| `src/bot/events/` | Interaction routing: buttons, select menus |
| `src/bot/client.ts` | Discord client wiring |
| `src/services/` | Feature services: player facade, radio rotation, daily hachimi cron, annoying mode, logger |
| `src/session/` | Per-guild voice session state, audio manager, resume-after-deploy |
| `src/playback/` | Coordinators between session and audio: playlist flow, pre-extraction |
| `src/audio/` | Playback engine: ffmpeg/opus player, media cache (LRU), queue, CDN retry |
| `src/bilibili/` | Bilibili metadata + audio extraction (adapter over `@bryan-kuang/bilibili-audio-extractor`) |
| `src/youtube/` | YouTube extraction via yt-dlp + cookie refresh (adapter over `ytdlp-cookie-keeper`) |
| `src/search/` | Keyword search across platforms, result interleaving, session store |
| `src/playlists/` | Playlist URL resolvers for bulk enqueue |
| `src/ui/` | Embeds, button rows, progress bars, search result views |
| `src/config/` | Env parsing + validation, all tunables |
| `src/observability/` | Metrics registry + loopback HTTP server (`/healthz`, `/metrics`) |
| `src/utils/` | Small shared helpers (formatting, locks, URL routing, history) |
| `src/models/`, `src/types.ts` | Shared domain types |

**Test convention:** all tests live under `tests/` (`unit/`, `regression/`,
`integration/`). `regression/` captures incident-driven cases — add one whenever a
production bug is fixed. Write new tests in TypeScript; existing `.js` tests are
converted only when touched.
