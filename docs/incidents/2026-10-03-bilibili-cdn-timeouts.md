# Bilibili CDN timeout and fallback alerts — 2026-10-03

Initial investigation followed by a code repair prepared for PR review.
No production bot restart or deployment performed.

## Evidence

User supplied 37 Discord alerts: 23 extraction failures (HTTP 412), 13
FFmpeg failures (exit 146, TCP connection timeout), one Unknown Message.

Read production container logs covering 2026-10-02 04:18 to
2026-10-03 16:18 UTC. Production image GIT_SHA is
`97bfa4ce80a5cf553be41ee34809dbd869932b2c`; the local checkout is `220d54a`.
Do not assume local HEAD is deployed.

In that 36-hour window:

- 909 native extraction successes; 203 local media-cache hits.
- 36 extraction failures, all yt-dlp webpage HTTP 412. Of the preceding
  native failures, 35 were stream probes timing out at 2000 ms; one was a
  view API response saying the video was unavailable.
- All 36 failures occurred during radio replenishment. The next native
  extraction succeeded 1–8 seconds later. No radio-level fatal error appeared.
- 15 FFmpeg failures, all exit 146, all TCP connection timeouts to
  `upos-sz-mirrorcosov.bilivideo.com`. The affected streams waited about
  30 seconds before failing. Each triggered the short-playback retry path,
  refreshed its URL, restarted 4–6 seconds after the failure, and subsequently
  reached a normal track end.
- One Unknown Message when editing progress. Tracking stopped/restarted
  immediately and edits succeeded again five seconds later. The log does
  not establish who deleted/replaced the message.
- Readiness, gateway and independently verified voice membership were healthy
  when inspected; the bot container had been up for about two days.

## Failure chain

Native extraction obtains metadata and a stream URL successfully, but the
stream's 2-second reachability probe sometimes times out. The bot then switches
to yt-dlp, which receives HTTP 412 fetching the watch page. This is consistent
with Bilibili web risk control; the precise rejection reason is unverified.
Native API extraction continues to succeed for other requests.

The installed native extractor selects `baseUrl`/`base_url`; backup URLs are
used only when no primary URL exists. It does not try a backup when the primary
fails. The bot wrapper exposes only one audio URL.

A read-only fresh extraction of two affected videos inside the production
container returned both the cosov CDN and `upos-hz-mirrorakam.akamaized.net`
as primary/backup candidates. Both answered HTTP 206 within a second during
the probe. This confirms usable alternatives existed at inspection time, and
that the observed timeout is intermittent; it does not identify the responsible
network hop or prove backups were reachable during the historical failures.

## Code gaps and repair priorities

1. Preserve and probe API-provided backup URLs before abandoning native
   extraction for yt-dlp. Keep signed paths/query parameters intact.
2. `src/audio/cdn_retry.ts` only accepts exit codes 255, 8 and 251, and its
   timeout pattern is `Connection timed out`. The observed code 146 and
   `Operation timed out` miss this classifier. Existing short-playback retry
   rescued these 15 failures, but the dedicated CDN path should cover them.
3. FFmpeg's custom `Connection: keep-alive` header lacks trailing CRLF. FFmpeg
   explicitly adds it; this warning is not the observed TCP failure's cause.
4. All extraction attempts are logged at error before caller recovery is
   known; every error sends an alert. Distinguish recovered replenishment
   failures from exhausted recovery, preserving alerts for actual failures.
   Unknown Message is likewise expected to be recoverable when the card is
   replaced; avoid alerting on successfully handled cleanup.

Do not simply disable the stream probe or increase all timeouts: the probe
currently prevents some unreachable streams from reaching playback.

## Local repair and verification

- Native adapter now retains distinct HTTP(S) backup URLs for the selected
  format through the package's public `fetchJson` hook. Request-local async
  context isolates concurrent video manifests and keeps upstream caches.
- Initial extraction and stream refresh probe primary/backup candidates in
  order; cache/download uses the successful candidate. Failed alternatives
  still fall back to yt-dlp. Signed URLs are preserved verbatim.
- CDN classifier now recognizes exit 146 / `Operation timed out`, and FFmpeg
  custom headers end in CRLF. Existing retry limits/backoff remain unchanged.
- Regression tests failed before the fixes and pass afterward. Independent
  review found a backup-only format with no ID that needed a lookup correction;
  a separate failing test reproduced it before correction.
- Final `npm run ci`: lint, typecheck, build, 850 tests across 81 suites and
  four snapshots passed. The initial sandboxed run could not bind localhost
  for metrics tests; complete CI was rerun outside that sandbox successfully.
- In a separate diagnostic Node process inside the production container,
  loaded the locally built repaired modules in memory and fetched a real
  Bilibili manifest. Replaced the primary address in that process's response
  with an unreachable localhost address; retained the original signed CDN
  address as a backup. The repaired refresh method rejected the injected
  primary and selected a backup returning HTTP 206 (334 ms). The running bot,
  its files, playback and deployment were not changed.

This repair reduces unnecessary yt-dlp fallback and handles the observed
timeout class. It does not remove Bilibili's webpage HTTP 412 restriction,
guarantee CDN availability or redesign global alert severity.
