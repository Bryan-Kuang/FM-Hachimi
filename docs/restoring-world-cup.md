# Restoring the World Cup feature

The live-score feature ran through the 2026 World Cup (2026-06-11 → 2026-07-21) and was removed afterwards. Its engine now lives in [`live-score-watcher`](https://github.com/Bryan-Kuang/live-score-watcher) on npm, so bringing the feature back is a rewire, not a rewrite.

This document exists so that's a mechanical job.

## Where the old code is

The last commit where the feature existed is **`792bded`**. Nothing was rewritten in history, so every file is recoverable:

```bash
git show 792bded --stat -- src/world_cup src/bot/commands/world_cup.ts
git checkout 792bded -- src/world_cup src/bot/commands/world_cup.ts
```

To find the removal commit itself, whatever its hash ends up being after any rebase:

```bash
git log --oneline --diff-filter=D -- src/world_cup
```

## What to take back, and what not to

| Piece | Where it lives now |
| --- | --- |
| ESPN fetching + parsing | **package** — `EspnScoreboardSource`, the default source |
| Poll loop, adaptive cadence | **package** — `MatchWatcher` |
| Score diffing, VAR debounce, status guard | **package** — the reason it was extracted |
| State persistence, restart safety | **package** — `statePath` option |
| Timezone day boundaries | **package** — `timezone` option |
| Embeds (`src/world_cup/embeds.ts`) | **git history** — restore from `792bded` |
| `/worldcup` command (`src/bot/commands/world_cup.ts`) | **git history** — restore from `792bded` |
| Per-guild subscriptions (`subscriptions.json`) | **git history** — was part of `world_cup_service.ts` |
| Stream link (`88看球`) | **git history** — bot-side presentation, never in the package |

Do **not** restore `src/world_cup/source.ts`, `world_cup_service.ts`, or `types.ts`. Those are what the package replaces.

## Steps

1. **Install the package.**

   ```bash
   npm install live-score-watcher
   ```

2. **Restore the Discord layer only.**

   ```bash
   git checkout 792bded -- src/world_cup/embeds.ts src/bot/commands/world_cup.ts
   git checkout 792bded -- tests/unit/world_cup_embeds.test.js tests/unit/world_cup_command.test.js
   ```

3. **Write a thin service** in place of the old `world_cup_service.ts`. It owns only what the package doesn't: the per-guild subscription map (copy it out of the old file at `792bded`, "Subscriptions" section) and posting embeds to channels. Everything else is the watcher:

   ```ts
   import { watchMatches } from 'live-score-watcher';

   const watcher = watchMatches({
     league: 'fifa.world',           // fifa.wwc for the Women's World Cup
     start: '2030-06-01',
     end: '2030-07-30',
     timezone: 'America/Toronto',
     statePath: path.join(process.cwd(), 'data', 'world_cup'),
     logger,
   });

   watcher.on('matchStarted',  (e) => broadcast(WcEmbeds.buildEventEmbed(e.match, 'kickoff', streamUrl, streamLabel)));
   watcher.on('scoreChanged',  (e) => broadcast(WcEmbeds.buildEventEmbed(e.match, 'goal', streamUrl, streamLabel)));
   watcher.on('scoreReverted', (e) => broadcast(WcEmbeds.buildEventEmbed(e.match, 'goal_disallowed', streamUrl, streamLabel)));
   watcher.on('matchEnded',    (e) => broadcast(WcEmbeds.buildEventEmbed(e.match, 'fulltime', streamUrl, streamLabel)));
   ```

   The restored `embeds.ts` still speaks the old event vocabulary, which is why the handlers translate. Renaming the embed builder's `EventKind` is optional.

4. **Rewire the command.** The old `/worldcup` command calls `service.isActive()`, `getWindow()`, `getHealth()`, `getToday()`, and `getMatchesForDate()` — all of which exist on the watcher with the same names and shapes. Point the command at the watcher (or at a wrapper exposing subscriptions plus the watcher's methods) and it works unchanged.

5. **Re-register the command** in `src/bot/commands/index.ts` (import, add to `commandFactories`, thread the service parameter back through `createCommands` / `getGlobalCommands` / `BotClient`), add the `/worldcup` line back to `src/bot/commands/help.ts`, and add `"worldcup"` back to the three expected-name lists in `tests/unit/command_registry.test.js`.

6. **Deploy the command schema**: `npm run deploy:commands`.

## Behaviour differences to expect

Three things changed in extraction. None is a bug, but each will surprise you if you assume parity:

- **Event names are sport-neutral.** `kickoff → matchStarted`, `goal → scoreChanged`, `goal_disallowed → scoreReverted`, `fulltime → matchEnded`.
- **`scoreChanged` fires once per scoring side.** If both teams score between polls you get two events, matching the old behaviour, but the payload now names the side (`e.side`).
- **A goal in the same frame as full time is reported before `matchEnded`.** The old service pushed full time first.

Also: the watcher has no `enabled` flag. Don't construct it if you don't want it running.

## Environment variables

All the old `WORLD_CUP_*` vars are gone from `src/config/config.ts`. If you re-add a config block, this is the mapping:

| Old env var | New home |
| --- | --- |
| `WORLD_CUP_ENABLED` | none — just don't construct the watcher |
| `WORLD_CUP_START` / `WORLD_CUP_END` | `start` / `end` options |
| `WORLD_CUP_SOURCE_URL` | `baseUrl`, or the `sport` + `league` pair |
| `WORLD_CUP_LIVE_POLL_MS` | `livePollMs` |
| `WORLD_CUP_IDLE_POLL_MS` | `idlePollMs` |
| `WORLD_CUP_REQUEST_TIMEOUT_MS` | `requestTimeoutMs` |
| `WORLD_CUP_TIMEZONE` | `timezone` |
| `WORLD_CUP_DATA_DIR` | `statePath` |
| `WORLD_CUP_STREAM_URL` / `_LABEL` | bot-side embed config; never was in the package |

None of these are set on the VPS today, so nothing needs removing there.

## Leftover state on the VPS

`~/bilibili-bot/data/world_cup/` still holds `state.json` and `subscriptions.json` from 2026. Harmless — nothing reads them now. Delete them whenever, or leave them: if the feature returns for a different tournament, clear the directory first so old match IDs don't seed the diff.

```bash
ssh fm-hachimi-vps 'rm -rf ~/bilibili-bot/data/world_cup'
```

## Picking a competition

The package is not World Cup specific. `league` is a slug in ESPN's scoreboard URL — `fifa.world`, `fifa.wwc`, `uefa.euro`, `eng.1`, and others are listed in the package README, and any ESPN slug works. Same code, different tournament.
