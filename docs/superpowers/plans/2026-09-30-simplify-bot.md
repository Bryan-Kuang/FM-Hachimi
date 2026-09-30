# Bot simplification implementation plan

**Goal:** Keep single-video/search playback, radio including mandatory breaks, annoying mode and daily recommendations; remove peripheral features.
**Architecture:** Reuse existing playback, search-session, recovery and alerting services. No repair agent or new monitoring subsystem in this change.
**Scope:** The goal and constraints below are the final scope; cloud repair tooling is deferred to a separate project.
**Execution:** The user subsequently requested a PR. Submit the verified changes on `codex/simplify-bot` against `main`; command registration and production deployment remain outside this task.

## Constraints
- Preserve both platforms, explicit Bilibili parts, radio break protection and existing controls.
- Preserve automated tests and infrastructure; remove only feature-specific tests with their features.
- Keep existing error reporting unchanged; cloud repair and alert redesign are deferred.
- Use existing checkout, which started clean on codex/voice-membership-recovery.

## Review focus
- Keywords always search both platforms; /play exposes only the required query.
- Unsupported collection/attachment URLs must not become searches or accidentally play a whole playlist.
- Explicit part URLs and watch URLs with a list parameter still play one video.
- Old menus must fail clearly without searching for a different video.
- Guild command cleanup remains available after removing testing deployment.

## Task 1: Unify play and remove peripheral playback
- [x] Add tests to tests/unit/play_dual_search_limits.test.js for dual-platform results, empty results, and URL routing.
- [x] Add tests/unit/play_simplified.test.js using real Discord builders for required query, query-only schema and unsupported input.
- [x] Run focused tests and observe failures before code edits.
- [x] Simplify src/bot/commands/play.ts; searchDualPlatforms receives both platform providers, preserving shared ranking and pagination.
- [x] Remove src/playlists/, playlist_coordinator.ts, attachment_track.ts, search.ts, hachimi.ts and exclusive APIs/config/control state.
- [x] Retain URL rejection and explicit part routing; update feature tests and rerun focused tests.

## Task 2: Single registry and global deployment
- [x] Replace registry tests with the retained command contract; deployment tests cover global payload and explicit guild cleanup.
- [x] Run these tests before updating registry/deployment behavior.
- [x] Remove testing_access and testing gates; preserve general cooldown/interaction handling.
- [x] Simplify scripts/deploy-commands.js and workflow to global/clear_guild; remove test config/npm script.
- [x] Run command, deployment, radio and annoying regression tests.

## Task 3: Remove obsolete UI compatibility and update docs
- [x] Test old menu IDs return an expired-message response without playback; preserve v2 selection ownership/expiry coverage.
- [x] Remove legacy handlers and unused button builders after checking call sites.
- [x] Update help, README, operations, environment template and architecture to the final supported commands.
- [x] Document explicit guild cleanup before deployment; remove obsolete testing and World Cup restoration docs.
- [x] Record the confirmed scope in local context without altering historical entries.

## Task 4: Verification and independent review
- [x] Run lint, typecheck, full Jest suite, build and Docker Compose configuration validation if Docker is available.
- [x] Review the complete diff and dependency references; independent reviewer checks the five review-focus scenarios.
- [x] Fix material findings and rerun affected checks; report actual results and deployment status.

## Verification

Implementation and independent review are complete locally. The reviewer found
no actionable regression; its two coverage suggestions were implemented:
mocked REST route/payload checks and schemeless attachment rejection.

After the final query-only `/play` correction, `npm run ci` passed: 840 tests
in 81 suites, four snapshots, lint, typecheck and build. Focused command checks
also passed (19 tests in three suites).

Compose and workflow YAML parse successfully. Docker CLI is unavailable, so
Compose semantics and container construction were not verified locally.
Verification did not register commands or deploy production. The final full CI
run before PR submission also passed: 840 tests, 81 suites and four snapshots,
plus lint, typecheck and build.

## Documentation cleanup

- Keep README for setup/features, OPERATIONS for maintenance and architecture
  for current component/data flows; link them from README.
- Remove testing-features and World Cup restoration guides with their features.
- Remove the completed voice-recovery checklist; retain its incident record,
  which already contains the fixes, acceptance scenarios and verification.
- Label historical incident findings explicitly; avoid treating old observations
  as current production status.
- Align environment examples with code defaults and retain command-migration steps.

Documentation validation: all 14 local Markdown links/anchors resolve, referenced
npm scripts exist, environment keys are unique, and 11 setup/config/registry
tests across three suites pass. Source edits in this documentation follow-up
only update comments.
