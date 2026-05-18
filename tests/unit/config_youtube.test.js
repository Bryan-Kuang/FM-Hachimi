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

  test("defaults the extraction interval to disabled", () => {
    process.env.YOUTUBE_MIN_EXTRACTION_INTERVAL_MS = "";

    const config = require("../../src/config/config");

    expect(config.youtube.minExtractionIntervalMs).toBe(0);
  });

  test("honors an explicit zero extraction interval", () => {
    process.env.YOUTUBE_MIN_EXTRACTION_INTERVAL_MS = "0";

    const config = require("../../src/config/config");

    expect(config.youtube.minExtractionIntervalMs).toBe(0);
  });
});
