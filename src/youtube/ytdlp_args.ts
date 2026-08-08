/**
 * Shared yt-dlp invocation args for YouTube.
 *
 * Both the extractor (playback) and the cookie-refresh validator must talk to
 * YouTube the *same* way — otherwise validation certifies a configuration the
 * bot never actually runs with. That gap caused the 2026-08-07 incident: the
 * validator spawned bare `yt-dlp`, so it kept failing on YouTube's SABR/GVS
 * PO-token experiment while the extractor (which passes these args) was fine,
 * and cookie rotation stayed frozen for 27h.
 */

import config = require('../config/config');

/**
 * bgutil PO-token provider selector. When YTDLP_POT_PROVIDER_URL points at
 * a bgutil-ytdlp-pot-provider sidecar, yt-dlp (with the matching plugin
 * installed in the image) fetches GVS PO tokens on demand — required by a
 * growing set of YouTube clients for stream URLs to not 403.
 */
function potProviderArgs(): string[] {
  const base = config.youtube.potProviderUrl;
  if (!base) return [];
  return ['--extractor-args', `youtubepot-bgutilhttp:base_url=${base}`];
}

/**
 * Player-client selector. Empty spec lets yt-dlp pick its own clients and
 * solve the nsig player JS via node — yt-dlp's maintainers track YouTube's
 * per-client PO-token enforcement, so that stays working across rollouts. A
 * hard pin (e.g. 'tv,ios') returns pre-signed stream URLs and skips the JS
 * solve (faster), but breaks when YouTube tightens that client: pinned 'tv'
 * began returning 403 stream URLs on 2026-07-01.
 *
 * Prefer an *additive* spec like 'default,mweb' over a pin — it keeps yt-dlp's
 * own selection and merely adds a fallback source of formats. That is the
 * 2026-08-07 remediation, when YouTube's "bind GVS PO token to video ID"
 * experiment forced SABR streaming on web_safari and every https format got
 * skipped ("The page needs to be reloaded").
 */
function playerClientArgs(): string[] {
  const spec = config.youtube.playerClient;
  if (!spec) return ['--js-runtimes', 'node'];
  return ['--extractor-args', `youtube:player_client=${spec}`];
}

export = { potProviderArgs, playerClientArgs };
