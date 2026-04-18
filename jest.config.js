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
  testMatch: [
    "**/__tests__/**/*.[jt]s?(x)",
    "**/?(*.)+(spec|test).[jt]s?(x)",
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
  coverageThreshold: {
    global: {
      branches: 15,
      functions: 15,
      lines: 15,
      statements: 15,
    },
  },
};
