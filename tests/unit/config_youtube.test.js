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
    const config = require("../../src/config/config");

    expect(config.youtube.cookieRefresh).toMatchObject({
      enabled: true,
      cookiesFile: "/app/secrets/youtube_cookies.txt",
      browserSpec: "chrome+basictext:/app/youtube-browser-profile",
      refreshIntervalMs: 21600000,
      cooldownMs: 300000,
      validateUrls: [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=AUfXW1EdLew",
      ],
    });
  });

  test("explicit false disables automatic YouTube cookie refresh", () => {
    process.env.YOUTUBE_COOKIE_AUTO_REFRESH_ENABLED = "false";

    const config = require("../../src/config/config");

    expect(config.youtube.cookieRefresh.enabled).toBe(false);
  });
});
