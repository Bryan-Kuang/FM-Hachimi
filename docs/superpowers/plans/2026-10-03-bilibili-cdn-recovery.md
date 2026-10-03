# Bilibili CDN recovery implementation plan

**Goal:** Recover from intermittent Bilibili CDN failures before falling back
to a webpage extractor that receives HTTP 412.

**Spec:** `docs/incidents/2026-10-03-bilibili-cdn-timeouts.md`.

**Architecture:** Capture the selected DASH format's API-provided backup URLs
through the native extractor's public HTTP injection hook. Keep WBI/anonymous
identity caching and isolate manifests per asynchronous extraction. Probe primary
and distinct HTTP(S) backups in order, both for extraction and URL refresh.
Keep signed URLs intact; cache/download only the successfully probed URL.

**Constraints:** CommonJS, no dependency upgrade, no new credentials/config,
preserve explicit-part yt-dlp handling and local media-cache playback.
Do not commit, push, restart or deploy as part of local implementation.

**Review focus:** concurrent extractions cannot mix manifests; backups belong
to the selected format; duplicate/invalid backups cannot be used; total CDN
failure must preserve yt-dlp fallback; timeout recovery must not retry deliberate
termination or invalid audio. Existing radio mandatory-break rules remain intact.

## Steps

- [x] Add failing native-extraction tests for primary timeout/backup success,
  signed URL preservation, caching, refresh recovery and exhausted backups.
  Add classifier and FFmpeg-close regression tests for exit 146 with the
  exact production stderr, and negative cases for invalid audio/termination.
- [x] Capture selected-format backup URLs using `fetchJson` and request-local
  async context in `src/bilibili/native_extractor.ts`; use a shared private
  native URL selector in `src/bilibili/extractor.ts` for extraction and refresh.
- [x] Recognize timeout exit 146 / `Operation timed out` in
  `src/audio/cdn_retry.ts`; terminate custom HTTP headers with CRLF in
  `src/audio/audio_player.ts`.
- [x] Run targeted tests, review concurrency/format/fallback cases, then run
  `npm run ci`. Record outcomes in the incident and project context.

No global alert redesign: recovered CDN errors use the existing warning/retry
path; terminal errors retain their reporting.

Validation: final CI passed 850 tests / 81 suites, four snapshots, lint,
typecheck and build. Independent review's backup-only/no-ID finding was
reproduced and fixed. Separate live-response fault injection verified backup
selection without altering the production bot. Changes are prepared for PR
review; production remains unchanged.
