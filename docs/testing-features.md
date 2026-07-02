# Testing Feature Gate

Use the testing feature gate for anything that should be tried only in the
private test server before it reaches public servers.

The test server is configured via the `TEST_GUILD_ID` environment variable
(repository secret in CI). There is no built-in default: when unset, testing
features are disabled in every guild and test-scope deploys fail fast.

Testing access is fail-closed. DMs, missing guild IDs, and any guild other than
the configured test server are denied with an ephemeral response.

## Adding A Testing Slash Command

Set command metadata in the command object:

```js
{
  data,
  execute,
  stage: "testing",
  featureName: "New playback flow",
}
```

The command name stays the same, but the deployed command description is
prefixed with `[Testing]`. Default command deployment excludes this command
from global registration. Deploy testing commands with:

```bash
npm run deploy:commands:test
```

Default public command deployment remains stable-only:

```bash
npm run deploy:commands
```

If a guild ends up with duplicate commands (global + guild-scoped), clear the
guild-scoped set:

```bash
CLEAR_GUILD_COMMANDS=true GUILD_ID=<guild-id> npm run deploy:commands
```

## Adding Testing Buttons Or Select Menus

Use a custom ID that starts with `testing:`:

```txt
testing:new-playback:confirm
```

The interaction router blocks that component outside the test server before it
reaches the button or select-menu handler. Handlers receive the full custom ID;
the guard does not rewrite it.

Stable custom IDs such as `daily_play_*`, `play_search_*`, `search_select_*`,
and playback controls do not need changes.

## Guarding Internal Code Paths

If a testing path is inside an otherwise stable command, call:

```ts
const allowed = await TestingAccess.assertTestingGuild(interaction, "New playback flow");
if (!allowed) return;
```

This keeps mixed stable/testing flows fail-closed when a command option or old
message leaks outside the test server.

## Graduating A Feature

When the feature is safe for public use:

1. Change command metadata from `stage: "testing"` to `stage: "stable"`, or
   remove the `stage` field.
2. Remove the `testing:` custom ID prefix from components.
3. Deploy stable commands globally with `npm run deploy:commands`.
4. If the feature had a test-only command, clear the test guild command copy:

```bash
CLEAR_GUILD_COMMANDS=true npm run deploy:commands:test
```
