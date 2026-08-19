describe("YouTube config", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.resetModules();
  });

  test("does not expose a YouTube extraction interval config", () => {
    process.env.YOUTUBE_MIN_EXTRACTION_INTERVAL_MS = "9000";

    const config = require("../../src/config/config");

    expect(config.youtube).not.toHaveProperty("minExtractionIntervalMs");
  });

  test("exposes automatic YouTube cookie refresh defaults", () => {
    // config.ts does `import "dotenv/config"`, and CI runs `cp .env.example .env`
    // before the suite — so ambient values silently stand in for the code
    // defaults this test exists to pin. Clear them, or the test asserts
    // whatever .env.example happens to say (it shipped two validate URLs while
    // the code default was one: green locally, red only in CI).
    delete process.env.YOUTUBE_COOKIE_AUTO_REFRESH_ENABLED;
    delete process.env.YOUTUBE_COOKIES_FILE;
    delete process.env.YOUTUBE_COOKIE_BROWSER_SPEC;
    delete process.env.YOUTUBE_COOKIE_REFRESH_INTERVAL_MS;
    delete process.env.YOUTUBE_COOKIE_REFRESH_COOLDOWN_MS;
    delete process.env.YOUTUBE_COOKIE_VALIDATE_URLS;
    delete process.env.YOUTUBE_COOKIE_VALIDATE_TIMEOUT_MS;

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
