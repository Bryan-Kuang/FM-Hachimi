module.exports = {
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/.claude/"],
  collectCoverageFrom: ["src/**/*.js", "!src/index.js", "!src/**/*.test.js"],
  coverageReporters: ["text", "lcov", "html"],
  coverageDirectory: "coverage",
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
