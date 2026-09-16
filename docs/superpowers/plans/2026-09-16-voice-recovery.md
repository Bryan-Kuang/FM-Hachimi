# Voice recovery implementation plan

Goal: detect authoritative voice membership loss and restore playback without
resurrecting a stopped session or duplicating recovery.

Spec: `docs/incidents/2026-09-16-voice-presence-desync.md`.

Architecture: a per-guild recovery coordinator owns snapshots, verification and
backoff. AudioPlayer owns explicit voice intent and a revision invalidated by
user actions. AnnoyingService applies moderation exemptions before requesting
recovery; gateway events and periodic checks use the same coordinator.

- [x] Add failing tests for silent membership loss, uncertainty, retries,
  concurrent checks and cancellation.
- [x] Add player intent/revision, forced recovery teardown, owned listener
  cleanup, and guarded async restore operations.
- [x] Implement coordinator with REST verification, debouncing, bounded backoff,
  permanent-error handling, and per-guild health.
- [x] Wire anti-disconnect, gateway/guild recovery, shutdown and readiness.
- [x] Cover the audit-lock and cache-independent event handling regressions.
- [x] Run targeted tests, full lint/typecheck/tests/build, inspect diff and record
  remaining limits. Publish the fixes in a pull request as subsequently requested; deployment remains pending.

Constraints: no new dependencies; preserve CommonJS conventions and explicit
stop/exempt-user behavior. REST transport errors are unknown, never proof of
absence. Recreate a confirmed stale connection even when locally Ready. Keep
pending snapshots available to the existing restart snapshot machinery.

Validation: lint, typecheck, build, 90 Jest suites / 936 tests / 4 snapshots,
and git diff --check passed. Production deployment remains pending.
