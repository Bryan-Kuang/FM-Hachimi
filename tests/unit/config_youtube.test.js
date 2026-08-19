describe("YouTube config", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    jest.dontMock("dotenv/config");
    process.env = OLD_ENV;
    jest.resetModules();
  });

  test("does not expose a YouTube extraction interval config", () => {
    process.env.YOUTUBE_MIN_EXTRACTION_INTERVAL_MS = "9000";

    const config = require("../../src/config/config");

    expect(config.youtube).not.toHaveProperty("minExtractionIntervalMs");
  });

  test("exposes automatic YouTube cookie refresh defaults", () => {
    // config.ts runs `import "dotenv/config"` at require time, and CI does
    // `cp .env.example .env` before the suite — so the file's values land in
    // process.env and stand in for the code defaults this test exists to pin.
    // Deleting the keys first does not help: dotenv simply re-reads them on
    // require. Stub the side-effecting module instead.
    jest.doMock("dotenv/config", () => ({}));
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("YOUTUBE_COOKIE")) delete process.env[key];
    }

    const config = require("../../src/config/config");

    expect(config.youtube.cookieRefresh).toMatchObject({
      enabled: true,
      cookiesFile: "/app/secrets/youtube_cookies.txt",
      browserSpec: "chrome+basictext:/app/youtube-browser-profile",
      refreshIntervalMs: 21600000,
      cooldownMs: 300000,
      // Deliberately one canary: validation requires every URL to extract, so
      // each extra entry multiplies both cost and the chance one flaky video
      // blocks rotation.
      validateUrls: ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
      validateTimeoutMs: 180000,
    });
  });

  test("explicit false disables automatic YouTube cookie refresh", () => {
    process.env.YOUTUBE_COOKIE_AUTO_REFRESH_ENABLED = "false";

    const config = require("../../src/config/config");

    expect(config.youtube.cookieRefresh.enabled).toBe(false);
  });
});
