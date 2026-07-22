module.exports = {
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.json",
      },
    ],
    "^.+\\.jsx?$": "babel-jest",
  },
  moduleFileExtensions: ["js", "jsx", "ts", "tsx", "json", "node"],
  // All tests live under tests/ (unit/, regression/, integration/) — src/ stays test-free.
  testMatch: [
    "<rootDir>/tests/**/?(*.)+(spec|test).[jt]s?(x)",
  ],
  collectCoverageFrom: [
    "src/**/*.{js,ts}",
    "!src/index.{js,ts}",
    "!src/**/*.test.{js,ts}",
    "!src/**/*.d.ts",
  ],
  coverageReporters: ["text", "lcov", "html"],
  coverageDirectory: "coverage",
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  verbose: true,
  collectCoverage: false,
  // Ratchet: ~5 points below actual coverage (2026-07: statements 68%,
  // branches 59%, functions 71%, lines 69%). Raise as coverage grows.
  coverageThreshold: {
    global: {
      branches: 54,
      functions: 66,
      lines: 64,
      statements: 63,
    },
  },
};
