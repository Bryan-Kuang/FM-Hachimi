describe("search config", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.resetModules();
  });

  describe("search", () => {
    test("defaults to 10 results per platform", () => {
      delete process.env.SEARCH_LIMIT_PER_PLATFORM;

      const config = require("../../src/config/config");

      expect(config.search.limitPerPlatform).toBe(10);
    });

    test("SEARCH_LIMIT_PER_PLATFORM overrides the default", () => {
      process.env.SEARCH_LIMIT_PER_PLATFORM = "5";

      const config = require("../../src/config/config");

      expect(config.search.limitPerPlatform).toBe(5);
    });
  });

});
