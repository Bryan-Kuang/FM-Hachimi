const {
  isOrphanedGatewayHandshakeError,
} = require("../../src/bot/gateway_handshake_error");

// The real thing, captured from production on 2026-09-01 04:27:19.
const productionError = () => {
  const error = new Error("Unexpected server response: 522");
  error.stack = [
    "Error: Unexpected server response: 522",
    "    at ClientRequest.<anonymous> (/app/node_modules/ws/lib/websocket.js:913:7)",
    "    at ClientRequest.emit (node:events:519:28)",
    "    at HTTPParser.parserOnIncomingClient (node:_http_client:780:27)",
    "    at HTTPParser.parserOnHeadersComplete (node:_http_common:125:17)",
    "    at TLSSocket.socketOnData (node:_http_client:615:22)",
  ].join("\n");
  return error;
};

describe("isOrphanedGatewayHandshakeError", () => {
  it("recognises the production 522 crash", () => {
    expect(isOrphanedGatewayHandshakeError(productionError())).toBe(true);
  });

  it("recognises the other Cloudflare statuses in the same family", () => {
    for (const status of [502, 503, 520, 521, 522, 524]) {
      const error = productionError();
      error.message = `Unexpected server response: ${status}`;
      error.stack = error.stack.replace("522", String(status));
      expect(isOrphanedGatewayHandshakeError(error)).toBe(true);
    }
  });

  it("rejects a same-message error that did not come from ws", () => {
    // Our own code could plausibly throw this string; only ws's handshake
    // abort is safe to survive.
    const error = new Error("Unexpected server response: 522");
    error.stack = [
      "Error: Unexpected server response: 522",
      "    at BilibiliExtractor.probe (/app/dist/bilibili/extractor.js:120:9)",
    ].join("\n");
    expect(isOrphanedGatewayHandshakeError(error)).toBe(false);
  });

  it("rejects an unrelated error from inside ws", () => {
    const error = new Error("Cannot read properties of undefined");
    error.stack = [
      "TypeError: Cannot read properties of undefined",
      "    at /app/node_modules/ws/lib/websocket.js:913:7",
    ].join("\n");
    expect(isOrphanedGatewayHandshakeError(error)).toBe(false);
  });

  it("rejects ordinary programming errors", () => {
    expect(isOrphanedGatewayHandshakeError(new TypeError("x is not a function"))).toBe(false);
    expect(isOrphanedGatewayHandshakeError(new Error("boom"))).toBe(false);
  });

  it("survives junk input", () => {
    expect(isOrphanedGatewayHandshakeError(null)).toBe(false);
    expect(isOrphanedGatewayHandshakeError(undefined)).toBe(false);
    expect(isOrphanedGatewayHandshakeError("Unexpected server response: 522")).toBe(false);
    expect(isOrphanedGatewayHandshakeError({ message: "Unexpected server response: 522" })).toBe(false);
  });

  it("requires a status code, not just the prefix", () => {
    const error = productionError();
    error.message = "Unexpected server response: gateway is sad";
    expect(isOrphanedGatewayHandshakeError(error)).toBe(false);
  });

  it("matches regardless of where node_modules lives", () => {
    const error = productionError();
    error.stack = error.stack.replace(
      "/app/node_modules/ws/lib/websocket.js",
      "/Users/dev/project/node_modules/ws/lib/websocket.js"
    );
    expect(isOrphanedGatewayHandshakeError(error)).toBe(true);
  });
});
