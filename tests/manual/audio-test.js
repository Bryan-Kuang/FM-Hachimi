/**
 * Manual Audio Testing Script
 * Tests audio extraction without Discord integration
 */

const path = require("path");
const UrlValidator = require("../../src/utils/validator");
const Formatters = require("../../src/utils/formatters");
const logger = require("../../src/services/logger_service");

// Test data sets
const testUrls = {
  valid: [
    "https://www.bilibili.com/video/BV1uv4y1q7Mv",
    "https://www.bilibili.com/video/av12345678",
    "https://b23.tv/BV1uv4y1q7Mv",
    "https://m.bilibili.com/video/BV1uv4y1q7Mv",
  ],
  invalid: [
    "https://youtube.com/watch?v=invalid",
    "https://bilibili.com/invalid-format",
    "not-a-url",
    "",
    null,
    undefined,
  ],
  edge_cases: [
    "https://www.bilibili.com/video/BV1uv4y1q7Mv?p=2",
    "https://www.bilibili.com/video/BV1uv4y1q7Mv?t=120",
    "https://www.bilibili.com/video/BV1uv4y1q7Mv?from=search",
    "  https://www.bilibili.com/video/BV1uv4y1q7Mv  ", // With whitespace
  ],
};

/**
 * Test URL validation functionality
 */
function testUrlValidation() {
  console.log("\n🔍 Testing URL Validation...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Test valid URLs
  console.log("Valid URLs:");
  testUrls.valid.forEach((url) => {
    totalTests++;
    const isValid = UrlValidator.isValidBilibiliUrl(url);
    const videoInfo = UrlValidator.extractVideoId(url);
    const normalized = UrlValidator.normalizeUrl(url);

    if (isValid && videoInfo) {
      passedTests++;
      console.log(`✅ ${url}`);
      console.log(`   → Type: ${videoInfo.type}, ID: ${videoInfo.id}`);
      console.log(`   → Normalized: ${normalized}`);
    } else {
      console.log(`❌ ${url} - Failed validation`);
    }
  });

  // Test invalid URLs
  console.log("\nInvalid URLs:");
  testUrls.invalid.forEach((url) => {
    totalTests++;
    const isValid = UrlValidator.isValidBilibiliUrl(url);

    if (!isValid) {
      passedTests++;
      console.log(`✅ ${url || "null/undefined"} - Correctly rejected`);
    } else {
      console.log(`❌ ${url || "null/undefined"} - Should have been rejected`);
    }
  });

  // Test edge cases
  console.log("\nEdge Cases:");
  testUrls.edge_cases.forEach((url) => {
    totalTests++;
    const isValid = UrlValidator.isValidBilibiliUrl(url);
    const videoInfo = UrlValidator.extractVideoId(url);

    if (isValid && videoInfo) {
      passedTests++;
      console.log(`✅ ${url}`);
      console.log(`   → Type: ${videoInfo.type}, ID: ${videoInfo.id}`);
    } else {
      console.log(`❌ ${url} - Failed validation`);
    }
  });

  console.log(
    `\n📊 URL Validation Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test formatting utilities
 */
function testFormatters() {
  console.log("\n🎨 Testing Formatters...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Test time formatting
  const timeTests = [
    { seconds: 65, expected: "1:05" },
    { seconds: 3665, expected: "1:01:05" },
    { seconds: 30, expected: "0:30" },
    { seconds: 0, expected: "0:00" },
    { seconds: null, expected: "0:00" },
  ];

  console.log("Time Formatting:");
  timeTests.forEach((test) => {
    totalTests++;
    const result = Formatters.formatTime(test.seconds);
    if (result === test.expected) {
      passedTests++;
      console.log(`✅ ${test.seconds}s → ${result}`);
    } else {
      console.log(
        `❌ ${test.seconds}s → ${result} (expected: ${test.expected})`
      );
    }
  });

  // Test progress bar generation
  const progressTests = [
    { current: 30, total: 100, expectedStart: "██████░░░░░░░░░░░░░░ 30%" },
    { current: 50, total: 100, expectedStart: "██████████░░░░░░░░░░ 50%" },
    { current: 0, total: 100, expectedStart: "░░░░░░░░░░░░░░░░░░░░ 0%" },
  ];

  console.log("\nProgress Bar Generation:");
  progressTests.forEach((test) => {
    totalTests++;
    const result = Formatters.generateProgressBar(test.current, test.total);
    if (result.startsWith(test.expectedStart)) {
      passedTests++;
      console.log(`✅ ${test.current}/${test.total} → ${result}`);
    } else {
      console.log(`❌ ${test.current}/${test.total} → ${result}`);
      console.log(`   Expected to start with: ${test.expectedStart}`);
    }
  });

  // Test text truncation
  const truncateTests = [
    { text: "Short text", maxLength: 20, expected: "Short text" },
    {
      text: "This is a very long text that should be truncated",
      maxLength: 20,
      expected: "This is a very lo...",
    },
    { text: "", maxLength: 10, expected: "" },
    { text: null, maxLength: 10, expected: "" },
  ];

  console.log("\nText Truncation:");
  truncateTests.forEach((test) => {
    totalTests++;
    const result = Formatters.truncateText(test.text, test.maxLength);
    if (result === test.expected) {
      passedTests++;
      console.log(`✅ "${test.text}" → "${result}"`);
    } else {
      console.log(
        `❌ "${test.text}" → "${result}" (expected: "${test.expected}")`
      );
    }
  });

  console.log(
    `\n📊 Formatter Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test error handling scenarios
 */
function testErrorHandling() {
  console.log("\n🚨 Testing Error Handling...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Test validator with invalid inputs
  const invalidInputs = [null, undefined, "", 123, {}, []];

  console.log("Invalid Input Handling:");
  invalidInputs.forEach((input) => {
    totalTests++;
    try {
      const result = UrlValidator.isValidBilibiliUrl(input);
      if (result === false) {
        passedTests++;
        console.log(
          `✅ ${typeof input === "string" ? `"${input}"` : input} → ${result}`
        );
      } else {
        console.log(
          `❌ ${
            typeof input === "string" ? `"${input}"` : input
          } → ${result} (should be false)`
        );
      }
    } catch (error) {
      console.log(
        `❌ ${
          typeof input === "string" ? `"${input}"` : input
        } → Threw error: ${error.message}`
      );
    }
  });

  // Test formatter with invalid inputs
  console.log("\nFormatter Error Handling:");
  invalidInputs.forEach((input) => {
    totalTests++;
    try {
      const result = Formatters.formatTime(input);
      if (result === "0:00") {
        passedTests++;
        console.log(
          `✅ formatTime(${
            typeof input === "string" ? `"${input}"` : input
          }) → ${result}`
        );
      } else {
        console.log(
          `❌ formatTime(${
            typeof input === "string" ? `"${input}"` : input
          }) → ${result} (should be 0:00)`
        );
      }
    } catch (error) {
      console.log(
        `❌ formatTime(${
          typeof input === "string" ? `"${input}"` : input
        }) → Threw error: ${error.message}`
      );
    }
  });

  console.log(
    `\n📊 Error Handling Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Main test runner
 */
async function runAudioTests() {
  console.log("🎵 Bilibili Discord Bot - Audio Testing Suite");
  console.log("=".repeat(50));

  const startTime = Date.now();

  // Run all test suites
  const validationResults = testUrlValidation();
  const formatterResults = testFormatters();
  const errorResults = testErrorHandling();

  // Calculate overall results
  const totalPassed =
    validationResults.passed + formatterResults.passed + errorResults.passed;
  const totalTests =
    validationResults.total + formatterResults.total + errorResults.total;
  const successRate = Math.round((totalPassed / totalTests) * 100);

  const endTime = Date.now();
  const duration = endTime - startTime;

  console.log("\n" + "=".repeat(50));
  console.log("📈 OVERALL TEST RESULTS");
  console.log("=".repeat(50));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalTests - totalPassed}`);
  console.log(`Success Rate: ${successRate}%`);
  console.log(`Duration: ${duration}ms`);

  if (successRate >= 95) {
    console.log("🎉 Excellent! All core functionality is working.");
  } else if (successRate >= 80) {
    console.log("⚠️  Good, but some issues need attention.");
  } else {
    console.log("❌ Poor results. Major issues need to be fixed.");
  }

  // Log results to file
  logger.info("Audio test completed", {
    totalTests,
    totalPassed,
    successRate,
    duration,
  });

  return {
    success: successRate >= 80,
    results: {
      total: totalTests,
      passed: totalPassed,
      successRate,
      duration,
    },
  };
}

// Run tests if called directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Test specific URL
    const url = args[0];
    console.log(`🧪 Testing specific URL: ${url}\n`);

    const isValid = UrlValidator.isValidBilibiliUrl(url);
    const videoInfo = UrlValidator.extractVideoId(url);
    const normalized = UrlValidator.normalizeUrl(url);

    console.log(`Valid: ${isValid}`);
    console.log(`Video Info:`, videoInfo);
    console.log(`Normalized: ${normalized}`);
  } else {
    // Run full test suite
    runAudioTests().catch(console.error);
  }
}

module.exports = {
  runAudioTests,
  testUrlValidation,
  testFormatters,
  testErrorHandling,
};
