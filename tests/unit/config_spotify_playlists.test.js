const { validateEnv } = require("../../src/config/env_validator");

describe("Spotify + playlist config", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.resetModules();
  });

  describe("spotify", () => {
    test("disabled and undefined by default", () => {
      delete process.env.SPOTIFY_CLIENT_ID;
      delete process.env.SPOTIFY_CLIENT_SECRET;

      const config = require("../../src/config/config");

      expect(config.spotify.enabled).toBe(false);
      expect(config.spotify.clientId).toBeUndefined();
      expect(config.spotify.clientSecret).toBeUndefined();
      expect(config.spotify.market).toBe("US");
    });

    test("enabled when both client id and secret are set", () => {
      process.env.SPOTIFY_CLIENT_ID = "abc";
      process.env.SPOTIFY_CLIENT_SECRET = "def";

      const config = require("../../src/config/config");

      expect(config.spotify.enabled).toBe(true);
      expect(config.spotify.clientId).toBe("abc");
      expect(config.spotify.clientSecret).toBe("def");
    });

    test("disabled when only one of id/secret is set", () => {
      process.env.SPOTIFY_CLIENT_ID = "abc";
      delete process.env.SPOTIFY_CLIENT_SECRET;

      const config = require("../../src/config/config");

      expect(config.spotify.enabled).toBe(false);
    });

    test("disabled when id/secret are whitespace-only", () => {
      process.env.SPOTIFY_CLIENT_ID = "   ";
      process.env.SPOTIFY_CLIENT_SECRET = "   ";

      const config = require("../../src/config/config");

      expect(config.spotify.enabled).toBe(false);
    });

    test("SPOTIFY_MARKET overrides the default", () => {
      process.env.SPOTIFY_MARKET = "CA";

      const config = require("../../src/config/config");

      expect(config.spotify.market).toBe("CA");
    });
  });

  describe("playlists", () => {
    test("defaults", () => {
      delete process.env.PLAYLIST_MAX_ITEMS;
      delete process.env.PLAYLIST_PROGRESS_INTERVAL_MS;
      delete process.env.PLAYLIST_RESOLVE_TIMEOUT_MS;
      delete process.env.PLAYLIST_MULTIPART_DETECT_TIMEOUT_MS;

      const config = require("../../src/config/config");

      expect(config.playlists).toMatchObject({
        maxItems: 100,
        progressIntervalMs: 1500,
        resolveTimeoutMs: 60000,
        multipartDetectTimeoutMs: 3000,
      });
    });

    test("env overrides", () => {
      process.env.PLAYLIST_MAX_ITEMS = "25";
      process.env.PLAYLIST_PROGRESS_INTERVAL_MS = "500";
      process.env.PLAYLIST_RESOLVE_TIMEOUT_MS = "10000";
      process.env.PLAYLIST_MULTIPART_DETECT_TIMEOUT_MS = "1000";

      const config = require("../../src/config/config");

      expect(config.playlists).toMatchObject({
        maxItems: 25,
        progressIntervalMs: 500,
        resolveTimeoutMs: 10000,
        multipartDetectTimeoutMs: 1000,
      });
    });
  });

  describe("attachments", () => {
    test("defaults to 50MB", () => {
      delete process.env.ATTACHMENT_MAX_BYTES;

      const config = require("../../src/config/config");

      expect(config.attachments.maxBytes).toBe(50 * 1024 * 1024);
    });

    test("env override", () => {
      process.env.ATTACHMENT_MAX_BYTES = "1024";

      const config = require("../../src/config/config");

      expect(config.attachments.maxBytes).toBe(1024);
    });
  });

  describe("env validator — Spotify warning", () => {
    function baseEnv(overrides = {}) {
      return { DISCORD_TOKEN: "token", CLIENT_ID: "client", ...overrides };
    }

    test("no warning when neither Spotify var is set", () => {
      const result = validateEnv(baseEnv());
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.includes("SPOTIFY"))).toBe(false);
    });

    test("no warning when both Spotify vars are set", () => {
      const result = validateEnv(baseEnv({ SPOTIFY_CLIENT_ID: "abc", SPOTIFY_CLIENT_SECRET: "def" }));
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.includes("SPOTIFY"))).toBe(false);
    });

    test("warns when only SPOTIFY_CLIENT_ID is set", () => {
      const result = validateEnv(baseEnv({ SPOTIFY_CLIENT_ID: "abc" }));
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.includes("SPOTIFY"))).toBe(true);
    });

    test("warns when only SPOTIFY_CLIENT_SECRET is set", () => {
      const result = validateEnv(baseEnv({ SPOTIFY_CLIENT_SECRET: "def" }));
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.includes("SPOTIFY"))).toBe(true);
    });
  });
});
