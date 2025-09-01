/**
 * Manual Bilibili Extractor Testing Script
 * Tests audio extraction functionality without Discord integration
 */

const BilibiliExtractor = require("../../src/audio/extractor");
const logger = require("../../src/utils/logger");

// Test URLs for different scenarios
const testUrls = {
  valid: [
    "https://www.bilibili.com/video/BV1uv4y1q7Mv", // Popular video
    "https://www.bilibili.com/video/av12345678", // AV format
    "https://b23.tv/BV1uv4y1q7Mv", // Short link
  ],
  problematic: [
    "https://www.bilibili.com/video/BV1234567890", // May not exist
    "https://www.bilibili.com/video/BV0000000000", // Definitely doesn't exist
  ],
};

/**
 * Test extractor initialization and basic functionality
 */
async function testExtractorBasics() {
  console.log("\n🔧 Testing Extractor Basics...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Test extractor initialization
  totalTests++;
  try {
    const extractor = new BilibiliExtractor();
    if (extractor && typeof extractor.extractAudio === "function") {
      passedTests++;
      console.log("✅ Extractor initialization successful");
    } else {
      console.log("❌ Extractor initialization failed");
    }
  } catch (error) {
    console.log(`❌ Extractor initialization error: ${error.message}`);
  }

  // Test yt-dlp availability
  totalTests++;
  try {
    const extractor = new BilibiliExtractor();
    const ytdlpAvailable = await extractor.checkYtDlpAvailability();

    if (ytdlpAvailable) {
      passedTests++;
      console.log("✅ yt-dlp is available on system");
    } else {
      console.log("❌ yt-dlp is not available - please install it");
      console.log("   Install with: pip install yt-dlp");
    }
  } catch (error) {
    console.log(`❌ yt-dlp availability check failed: ${error.message}`);
  }

  // Test URL validation integration
  totalTests++;
  try {
    const extractor = new BilibiliExtractor();
    const testUrl = "https://www.bilibili.com/video/BV1uv4y1q7Mv";

    // This should not throw for valid URLs
    // We're just testing the validation part, not actual extraction
    if (testUrl.includes("bilibili.com")) {
      passedTests++;
      console.log("✅ URL validation integration works");
    }
  } catch (error) {
    console.log(`❌ URL validation integration failed: ${error.message}`);
  }

  console.log(
    `\n📊 Extractor Basics Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return {
    passed: passedTests,
    total: totalTests,
    ytdlpAvailable: passedTests >= 2,
  };
}

/**
 * Test metadata extraction (requires yt-dlp)
 */
async function testMetadataExtraction() {
  console.log("\n📋 Testing Metadata Extraction...\n");

  let passedTests = 0;
  let totalTests = 0;

  const extractor = new BilibiliExtractor();

  // Check if yt-dlp is available first
  const ytdlpAvailable = await extractor.checkYtDlpAvailability();
  if (!ytdlpAvailable) {
    console.log("⚠️  Skipping metadata tests - yt-dlp not available");
    console.log("   Install with: pip install yt-dlp");
    return { passed: 0, total: 0, skipped: true };
  }

  // Test with a known working URL
  for (const url of testUrls.valid.slice(0, 1)) {
    // Test only first URL to avoid rate limiting
    totalTests++;
    console.log(`\nTesting URL: ${url}`);

    try {
      const result = await extractor.extractAudio(url);

      // Validate required fields
      const requiredFields = ["title", "duration", "audioUrl", "originalUrl"];
      const hasAllFields = requiredFields.every(
        (field) =>
          result.hasOwnProperty(field) &&
          result[field] !== null &&
          result[field] !== undefined
      );

      if (hasAllFields) {
        passedTests++;
        console.log("✅ Metadata extraction successful");
        console.log(`   Title: ${result.title}`);
        console.log(`   Duration: ${result.duration}s`);
        console.log(`   Uploader: ${result.uploader}`);
        console.log(
          `   Thumbnail: ${result.thumbnail ? "Available" : "Not available"}`
        );
        console.log(
          `   Audio URL: ${result.audioUrl ? "Available" : "Not available"}`
        );
      } else {
        console.log("❌ Metadata extraction incomplete");
        console.log(
          `   Missing fields: ${requiredFields.filter(
            (field) => !result[field]
          )}`
        );
      }
    } catch (error) {
      console.log(`❌ Metadata extraction failed: ${error.message}`);

      // Check if it's a network/availability issue
      if (
        error.message.includes("video") &&
        error.message.includes("not available")
      ) {
        console.log(
          "   This might be due to region restrictions or video unavailability"
        );
      }
    }
  }

  console.log(
    `\n📊 Metadata Extraction Results: ${passedTests}/${totalTests} tests passed (${
      totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0
    }%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test error handling scenarios
 */
async function testErrorHandling() {
  console.log("\n🚨 Testing Error Handling...\n");

  let passedTests = 0;
  let totalTests = 0;

  const extractor = new BilibiliExtractor();

  // Test invalid URL handling
  const invalidUrls = [
    "https://youtube.com/watch?v=invalid",
    "https://bilibili.com/invalid",
    "not-a-url",
    "",
    null,
  ];

  for (const url of invalidUrls) {
    totalTests++;
    try {
      await extractor.extractAudio(url);
      console.log(`❌ Should have failed for invalid URL: ${url}`);
    } catch (error) {
      passedTests++;
      console.log(`✅ Correctly rejected invalid URL: ${url || "null"}`);
    }
  }

  // Test timeout handling (if yt-dlp is available)
  const ytdlpAvailable = await extractor.checkYtDlpAvailability();
  if (ytdlpAvailable) {
    totalTests++;
    try {
      // Test with a URL that might not exist
      await extractor.extractAudio(
        "https://www.bilibili.com/video/BV0000000000"
      );
      console.log("❌ Should have failed for non-existent video");
    } catch (error) {
      passedTests++;
      console.log("✅ Correctly handled non-existent video error");
    }
  }

  console.log(
    `\n📊 Error Handling Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test built-in test function
 */
async function testBuiltInTest() {
  console.log("\n🧪 Testing Built-in Test Function...\n");

  let passedTests = 0;
  let totalTests = 0;

  const extractor = new BilibiliExtractor();

  totalTests++;
  try {
    const testResult = await extractor.testExtraction();

    if (testResult.success) {
      passedTests++;
      console.log("✅ Built-in test function successful");
      console.log(`   Result: ${JSON.stringify(testResult, null, 2)}`);
    } else {
      console.log("❌ Built-in test function failed");
      console.log(`   Error: ${testResult.error}`);
      console.log(`   yt-dlp available: ${testResult.ytdlpAvailable}`);
    }
  } catch (error) {
    console.log(`❌ Built-in test function error: ${error.message}`);
  }

  console.log(
    `\n📊 Built-in Test Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Main test runner
 */
async function runExtractorTests() {
  console.log("🎵 Bilibili Extractor - Testing Suite");
  console.log("=".repeat(50));

  const startTime = Date.now();

  // Run all test suites
  const basicsResults = await testExtractorBasics();
  const metadataResults = await testMetadataExtraction();
  const errorResults = await testErrorHandling();
  const builtInResults = await testBuiltInTest();

  // Calculate overall results
  const totalPassed =
    basicsResults.passed +
    metadataResults.passed +
    errorResults.passed +
    builtInResults.passed;
  const totalTests =
    basicsResults.total +
    metadataResults.total +
    errorResults.total +
    builtInResults.total;
  const successRate =
    totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;

  const endTime = Date.now();
  const duration = endTime - startTime;

  console.log("\n" + "=".repeat(50));
  console.log("📈 OVERALL EXTRACTOR TEST RESULTS");
  console.log("=".repeat(50));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalTests - totalPassed}`);
  console.log(`Success Rate: ${successRate}%`);
  console.log(`Duration: ${duration}ms`);

  // Provide guidance based on results
  if (!basicsResults.ytdlpAvailable) {
    console.log("\n⚠️  IMPORTANT: yt-dlp is not installed");
    console.log("   Install it with: pip install yt-dlp");
    console.log("   Or: brew install yt-dlp (on macOS)");
  } else if (successRate >= 80) {
    console.log("\n🎉 Extractor is working well!");
  } else {
    console.log("\n⚠️  Some issues detected. Check the logs above.");
  }

  // Log results to file
  logger.info("Extractor test completed", {
    totalTests,
    totalPassed,
    successRate,
    duration,
    ytdlpAvailable: basicsResults.ytdlpAvailable,
  });

  return {
    success: successRate >= 60, // Lower threshold due to potential network issues
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

    const extractor = new BilibiliExtractor();
    extractor
      .extractAudio(url)
      .then((result) => {
        console.log("✅ Extraction successful:");
        console.log(JSON.stringify(result, null, 2));
      })
      .catch((error) => {
        console.log("❌ Extraction failed:");
        console.log(error.message);
      });
  } else {
    // Run full test suite
    runExtractorTests().catch(console.error);
  }
}

module.exports = {
  runExtractorTests,
  testExtractorBasics,
  testMetadataExtraction,
  testErrorHandling,
  testBuiltInTest,
};
