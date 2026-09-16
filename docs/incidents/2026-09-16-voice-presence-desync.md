# Voice presence desynchronization — 2026-09-16 UTC

Status: service restored during investigation. Application fixes have since
been implemented in this change; production deployment is still pending.

Implementation adds a shared per-guild recovery coordinator, authoritative
membership polling and gateway-triggered checks, forced stale-connection
teardown, retained snapshots/backoff, cancellation guards, persistent voice
logging and degraded readiness/status/metrics. Regression coverage includes
the silent loss, stale async playback/radio work, uncertainty, authorization
during recovery, and listener cleanup scenarios described below.

## Findings and confidence

Confirmed: Discord had no voice state for the bot while the application continued
radio playback with `voiceConnectionStatus: ready`. `/readyz` reported healthy.
The affected guild's anti-disconnect flag was enabled. No corresponding bot
leave event or reconstruction attempt appears in retained application logs.

Leading hypothesis: the new gateway session observed at 01:41:21 UTC left an
existing voice connection detached from actual guild membership. The application
does not reconcile voice sessions after `shardReady`. This is consistent with
the failure, but the exact membership-loss time and initiating gateway close
reason were not recorded, so the hypothesis is not a proven upstream root cause.

## Evidence and timeline

All times below are UTC; Toronto was UTC-4.

| Time | Observation |
| --- | --- |
| Sep 14 22:54 | Deployed image started; startup restored playback/presence. |
| Sep 14 23:37:16–19 | Earlier, separate incident: both guild voice sessions left; the protected radio guild rejoined and resumed successfully. This is not proof of recovery from the Sep 16 incident. |
| Sep 15 through Sep 16 00:12:18 | Multiple `shardResume` events, with no logged gateway close reasons. |
| Sep 16 01:41:21 | A new `shardReady` occurred without a container restart; no subsequent radio rejoin appears before the manual recovery. |
| Sep 16 ~02:27 | Container up ~28 h, RestartCount 0, OOMKilled false, gateway ready. Host load ~0.09; available memory ~309 MiB; disk 27% used. These are inspection-time values, not proof of earlier resource conditions. |
| Sep 16 ~02:32–33 | Authenticated GET `/guilds/{guild}/voice-states/@me` returned HTTP 404, code 10065, `Unknown Voice State`; playback still claimed ready. User independently saw an empty channel. |
| Sep 16 02:33:25 | Graceful restart after saving a restricted-permission snapshot backup. |
| Sep 16 02:33:39 | Joined expected voice channel. |
| Sep 16 02:33:44–47 | Resumed saved track at 52 seconds; radio re-armed; audio player started. |
| After restart | Same Discord endpoint returned HTTP 200 with expected channel, mute=false, deaf=false. This verifies membership, not an independent listening test. |

Retained logs begin at Sep 14 22:54, covering this container's pre-incident
lifetime. Recent member-disconnect audit lookup succeeded and returned no entries
dated Sep 14 onward among the 50 requested; that is not proof that every possible
external removal was absent. No matching host OOM/link-down kernel messages were
returned for the searched Sep 15–16 interval.

Production image: `322905b18e1a41d9fedb1d2f4037ba3a2d0de381`.
Dependencies: discord.js 14.22.1, @discordjs/ws 1.2.3, @discordjs/voice 0.19.0.
The local files examined for Guild, ClientVoiceManager, WebSocketManager and the
voice library bundle have identical SHA-256 hashes to production. Application
recovery files match the deployed commit except explanatory comments in client.ts.

## Why recovery and detection failed

1. `src/bot/client.ts:249` triggers anti-disconnect recovery only from a bot
   `voiceStateUpdate` leave event. `shardReady`/`shardResume` at lines 399–406
   only mark gateway recovery; no voice-session reconciliation runs.
2. discord.js `Guild._patch()` replaces the voice-state cache from `voice_states`
   without synthesizing per-member leave events. WebSocketManager emits
   `shardDisconnect` for unrecoverable closes, while recoverable closes emit
   `shardReconnecting`. The application does not listen to the latter. This
   explains why absence of `shardDisconnect` is not evidence of no interruption.
3. `src/audio/audio_player.ts:423` listens to Disconnected/Destroyed only while
   waiting for the initial connection. Cleanup removes all listeners for these
   status events. There is no application-level persistent state/error monitor.
4. `src/observability/metrics_server.ts:38` checks process/gateway readiness only.
   Gateway health, successful message edits and advancing FFmpeg output do not
   establish voice membership or audible delivery.
5. `src/session/resume_service.ts:135` captures local connection/queue state.
   During this failure it kept saving advancing playback positions despite the
   missing membership. Manual recovery resumed the latest local position, not
   a known last-audible position; that position cannot now be reconstructed.

## Required fixes, in order

### P1: Independent voice reconciliation and reliable reconstruction

- Track intended voice presence separately from observed connection state.
- Reconcile after a fresh shard ready and guild availability; also run a bounded,
  low-frequency REST check for intended sessions to cover missing events.
- Distinguish explicit Unknown Voice State/wrong channel from network errors,
  429 and 5xx. Debounce failures, respect Retry-After, and avoid mass reconnects
  during a Discord/API outage.
- Use one per-guild recovery operation with cancellation/generation checks.
  Preserve playback state before teardown. Respect intentional stop/leave,
  authorized moves and exempt-user behavior rather than rejoining blindly.
- Force disposal/recreation of a confirmed stale connection. Simply calling
  `reconstructGuild()` is insufficient: `audio_player.ts:362–375` reuses an
  existing same-channel Ready/Signalling/Connecting connection and returns true.
- Freeze local playback on confirmed loss, restore queue/seek/pause/radio state,
  and verify actual membership before marking recovery successful.

### P1: Operational visibility

- Persistent voice stateChange/error logging, including old/new status and close
  reason/code; record shardReconnecting, shardReady vs shardResume and guild
  availability. Do not log voice tokens or raw sensitive gateway payloads.
- Report intended vs observed channel, last successful membership verification,
  mismatch age and recovery attempts in status/metrics. Surface degraded voice
  sessions even when the main gateway is healthy; deliberate idle must stay healthy.
- Prefer per-guild repair. Use process restart only as a bounded escalation if
  reconstruction cannot recover, with snapshots preserved.

### P2: Adjacent recovery defects discovered by review

- `annoying_service.ts:413–419` gives up when reconstruction returns false.
  Join has limited inner retries, but there is no later recovery cycle after
  exhaustion. Preserve the recovery intent/snapshot and retry transient failures
  with backoff; stop on definitive deletion/permission failure and report it.
- `annoying_service.ts:197–226` acquires its busy flag after awaiting the audit
  lookup, allowing concurrent disconnect handlers through. Acquire before async
  work and release in finally; share the guard with reconciliation.
- `client.ts:252–253` identifies the bot using cached member/channel objects.
  Prefer stable voice-state IDs and a stored intended channel, so missing cache
  objects do not silently bypass recovery. This was not proven to cause this incident.
- Replace removeAllListeners in waitForVoiceConnection with removal of only its
  own callbacks; clean up on timeout and bind cleanup to the captured connection.

## Fix strategy choices

Minimal containment: reconcile/rebuild intended sessions after new shard ready.
This targets the leading trigger but misses silent membership loss occurring at
other times. Recommended durable approach: event-triggered reconciliation plus
a periodic authoritative membership check, using the same per-guild recovery
coordinator. A REST check confirms membership, not audio delivery; retain voice
transport/heartbeat diagnostics as a separate signal.

## Acceptance scenarios

- No leave event, local Ready, REST Unknown Voice State: restore automatically.
- New shardReady replaces voice cache, no bot leave emitted: restore once.
- REST says expected channel: do not interrupt working playback.
- Stale same-channel Ready connection: actually recreate rather than resubscribe.
- Temporary REST timeout/429/5xx: do not classify as confirmed absence.
- Duplicate events, slow audit lookup and periodic check overlap: one recovery.
- Stop/authorized leave during recovery cancels pending joins.
- Preserve seek/pause/radio and idle-presence intent; retry transient join failures.
- Gateway healthy plus confirmed missing intended voice: status shows degradation.

Existing targeted tests cover explicit disconnect, gateway outage and readiness,
but do not model authoritative membership disagreeing with local Ready. They
even assert that failed reconstruction is abandoned. No production code changes
or deployment were made as part of this investigation.

Validation: the 30 annoying-service tests and 8 gateway-recovery tests passed.
The 4 readiness tests initially hit sandbox `listen EPERM`; rerunning those
outside the sandbox passed all 4. Thus all 42 targeted existing tests passed,
but they do not establish coverage of the incident. The first run also reported
a duplicate package name in a nested .claude worktree; the readiness rerun
excluded that directory. No full CI run was needed for this documentation-only review.

Documentation consulted via Context7:
- https://github.com/discord/discord-api-docs/blob/main/developers/topics/voice-connections.mdx
- https://discord.js.org/docs/packages/voice/0.19.0/VoiceConnection%3AClass

## Local implementation verification

After implementation: lint, typecheck and build passed. The full current-checkout
Jest suite passed: 90 suites, 936 tests, 4 snapshots. Tests ran serially outside
the sandbox for HTTP test-server binding and excluded nested .claude checkouts
from module discovery. `git diff --check` passed. Production was not redeployed;
manual recovery remains the only production mutation performed during this task.
