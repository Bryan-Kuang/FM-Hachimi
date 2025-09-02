module.exports = {
  testEnvironment: "node",
  collectCoverageFrom: ["src/**/*.js", "!src/index.js", "!src/**/*.test.js"],
  coverageReporters: ["text", "lcov", "html"],
  coverageDirectory: "coverage",
  testMatch: ["**/__tests__/**/*.js", "**/*.test.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  verbose: true,
  collectCoverage: false, // Enable manually with --coverage flag
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
