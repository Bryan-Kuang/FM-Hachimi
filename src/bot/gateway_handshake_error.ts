/**
 * Orphaned gateway handshake errors.
 *
 * `ws` aborts a handshake that comes back with anything other than 101 by
 * emitting 'error' on the socket (lib/websocket.js:913). Normally
 * @discordjs/ws is listening — that's the `shardError` path, and the watchdog
 * handles it. But `WebSocketShard#destroy()` sets `connection.onerror = null`
 * unconditionally, and only *closes* the socket when its readyState is OPEN. A
 * connection still in CONNECTING — a handshake in flight — is therefore
 * detached and abandoned with its HTTP request still running. When the response
 * finally arrives, `ws` emits 'error' on a socket nobody is listening to, and
 * Node turns an EventEmitter 'error' with no listener into a process-level
 * throw.
 *
 * That killed the bot on 2026-08-08 (Cloudflare 521) and again on 2026-09-01
 * (522), both times with no `shardError` logged first — the tell that the error
 * escaped below the shard layer, exactly as the note in client.ts predicted.
 *
 * Surviving one is safe: the socket belongs to a connection discord.js has
 * already given up on, it holds no application state, and discord.js has moved
 * on to a fresh connection whose failures do surface as `shardError`. So the
 * gateway watchdog still covers a genuinely unreachable gateway; this only
 * stops a late HTTP response from taking the process down with it.
 *
 * The match is deliberately narrow — this message from this file — because
 * everything else reaching `uncaughtException` still deserves a shutdown.
 */

/** `ws` builds this message; the status is whatever the proxy returned. */
const HANDSHAKE_MESSAGE = /^Unexpected server response: \d{3}$/;

/** Path separator kept loose so Windows checkouts match too. */
const WS_HANDSHAKE_FRAME = /node_modules[\\/]ws[\\/]lib[\\/]websocket\.js/;

export function isOrphanedGatewayHandshakeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (!HANDSHAKE_MESSAGE.test(error.message)) return false;
  return WS_HANDSHAKE_FRAME.test(error.stack ?? '');
}
