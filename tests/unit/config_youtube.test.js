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
});
