/**
 * Full System Integration Test
 * Tests the complete Bilibili Discord Bot system
 */

const { runExtractorTests } = require("./extractor-test");
const { runDiscordTests } = require("./discord-test");
const { runAudioPlayerTests } = require("./audio-player-test");
const logger = require("../../src/utils/logger");

/**
 * Test system integration
 */
async function testSystemIntegration() {
  console.log("\n🔗 Testing System Integration...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Test component integration
  totalTests++;
  try {
    const BilibiliExtractor = require("../../src/audio/extractor");
    const AudioManager = require("../../src/audio/manager");
    const BotClient = require("../../src/bot/client");

    // Test integration flow
    const extractor = new BilibiliExtractor();
    AudioManager.setExtractor(extractor);

    const botClient = new BotClient();
    botClient.setExtractor(extractor);

    if (
      AudioManager.extractor === extractor &&
      botClient.client.extractor === extractor
    ) {
      passedTests++;
      console.log("✅ Component integration successful");
      console.log(
        "   Extractor properly shared between AudioManager and BotClient"
      );
    } else {
      console.log("❌ Component integration failed");
    }
  } catch (error) {
    console.log(`❌ Component integration error: ${error.message}`);
  }

  // Test configuration loading
  totalTests++;
  try {
    const config = require("../../src/config/config");

    if (config.discord && config.bilibili && config.audio) {
      passedTests++;
      console.log("✅ Configuration loading successful");
      console.log(`   Loaded ${Object.keys(config).length} config sections`);
    } else {
      console.log("❌ Configuration loading failed");
    }
  } catch (error) {
    console.log(`❌ Configuration loading error: ${error.message}`);
  }

  // Test utilities integration
  totalTests++;
  try {
    const UrlValidator = require("../../src/utils/validator");
    const Formatters = require("../../src/utils/formatters");

    const testUrl = "https://www.bilibili.com/video/BV1uv4y1q7Mv";
    const isValid = UrlValidator.isValidBilibiliUrl(testUrl);
    const formattedTime = Formatters.formatTime(3661);

    if (isValid && formattedTime === "1:01:01") {
      passedTests++;
      console.log("✅ Utilities integration successful");
      console.log(
        `   URL validation: ${isValid}, Time format: ${formattedTime}`
      );
    } else {
      console.log("❌ Utilities integration failed");
    }
  } catch (error) {
    console.log(`❌ Utilities integration error: ${error.message}`);
  }

  // Test command loading integration
  totalTests++;
  try {
    const commandFiles = [
      "../../src/bot/commands/play",
      "../../src/bot/commands/pause",
      "../../src/bot/commands/resume",
      "../../src/bot/commands/queue",
    ];

    let loadedCommands = 0;
    for (const commandFile of commandFiles) {
      const command = require(commandFile);
      if (command.data && command.execute) {
        loadedCommands++;
      }
    }

    if (loadedCommands === commandFiles.length) {
      passedTests++;
      console.log("✅ Command loading integration successful");
      console.log(
        `   Loaded ${loadedCommands}/${commandFiles.length} commands`
      );
    } else {
      console.log("❌ Command loading integration failed");
    }
  } catch (error) {
    console.log(`❌ Command loading integration error: ${error.message}`);
  }

  console.log(
    `\n📊 System Integration Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test dependency availability
 */
async function testDependencies() {
  console.log("\n📦 Testing Dependencies...\n");

  let passedTests = 0;
  let totalTests = 0;

  const dependencies = [
    { name: "discord.js", module: "discord.js" },
    { name: "@discordjs/voice", module: "@discordjs/voice" },
    { name: "axios", module: "axios" },
    { name: "winston", module: "winston" },
    { name: "dotenv", module: "dotenv" },
    { name: "moment", module: "moment" },
  ];

  for (const dep of dependencies) {
    totalTests++;
    try {
      require(dep.module);
      passedTests++;
      console.log(`✅ ${dep.name} available`);
    } catch (error) {
      console.log(`❌ ${dep.name} not available: ${error.message}`);
    }
  }

  // Test external tools
  const tools = [
    { name: "yt-dlp", command: "yt-dlp" },
    { name: "ffmpeg", command: "ffmpeg" },
  ];

  for (const tool of tools) {
    totalTests++;
    await new Promise((resolve) => {
      const { spawn } = require("child_process");
      const process = spawn(tool.command, ["--version"]);

      process.on("close", (code) => {
        if (code === 0) {
          passedTests++;
          console.log(`✅ ${tool.name} available`);
        } else {
          console.log(`❌ ${tool.name} not available`);
        }
        resolve();
      });

      process.on("error", () => {
        console.log(`❌ ${tool.name} not available`);
        resolve();
      });

      setTimeout(() => {
        process.kill();
        console.log(`❌ ${tool.name} check timeout`);
        resolve();
      }, 3000);
    });
  }

  console.log(
    `\n📊 Dependencies Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Generate system report
 */
function generateSystemReport(results) {
  const {
    extractorResults,
    discordResults,
    audioPlayerResults,
    integrationResults,
    dependencyResults,
  } = results;

  const totalPassed =
    extractorResults.passed +
    discordResults.passed +
    audioPlayerResults.passed +
    integrationResults.passed +
    dependencyResults.passed;

  const totalTests =
    extractorResults.total +
    discordResults.total +
    audioPlayerResults.total +
    integrationResults.total +
    dependencyResults.total;

  const successRate = Math.round((totalPassed / totalTests) * 100);

  console.log("\n" + "=".repeat(80));
  console.log("🎯 BILIBILI DISCORD BOT - SYSTEM READINESS REPORT");
  console.log("=".repeat(80));

  console.log("\n📋 Test Results Summary:");
  console.log(
    `🎵 Audio Extractor: ${extractorResults.passed}/${
      extractorResults.total
    } (${Math.round(
      (extractorResults.passed / extractorResults.total) * 100
    )}%)`
  );
  console.log(
    `🤖 Discord Integration: ${discordResults.passed}/${
      discordResults.total
    } (${Math.round((discordResults.passed / discordResults.total) * 100)}%)`
  );
  console.log(
    `🎛️ Audio Player: ${audioPlayerResults.passed}/${
      audioPlayerResults.total
    } (${Math.round(
      (audioPlayerResults.passed / audioPlayerResults.total) * 100
    )}%)`
  );
  console.log(
    `🔗 System Integration: ${integrationResults.passed}/${
      integrationResults.total
    } (${Math.round(
      (integrationResults.passed / integrationResults.total) * 100
    )}%)`
  );
  console.log(
    `📦 Dependencies: ${dependencyResults.passed}/${
      dependencyResults.total
    } (${Math.round(
      (dependencyResults.passed / dependencyResults.total) * 100
    )}%)`
  );

  console.log(`\n📈 Overall System Health: ${successRate}%`);
  console.log(
    `📊 Total Tests: ${totalTests} | Passed: ${totalPassed} | Failed: ${
      totalTests - totalPassed
    }`
  );

  console.log("\n🎯 System Status:");
  if (successRate >= 95) {
    console.log("🟢 EXCELLENT - System is production ready!");
  } else if (successRate >= 85) {
    console.log("🟡 GOOD - System is mostly ready, minor issues to address");
  } else if (successRate >= 70) {
    console.log("🟠 FAIR - System has basic functionality but needs attention");
  } else {
    console.log("🔴 POOR - System requires significant work before deployment");
  }

  console.log("\n📋 Recommendations:");

  if (dependencyResults.passed < dependencyResults.total) {
    console.log(
      "• Install missing dependencies (especially yt-dlp and ffmpeg)"
    );
  }

  if (extractorResults.passed < extractorResults.total) {
    console.log("• Fix audio extraction issues");
  }

  if (audioPlayerResults.passed < audioPlayerResults.total) {
    console.log("• Address audio player functionality");
  }

  console.log("• Configure Discord bot token in .env file");
  console.log("• Deploy commands with: npm run deploy:commands");
  console.log("• Test in a Discord server");

  return {
    successRate,
    totalTests,
    totalPassed,
    ready: successRate >= 70,
  };
}

/**
 * Main system test runner
 */
async function runFullSystemTest() {
  console.log("🎵 Bilibili Discord Bot - Full System Test Suite");
  console.log("=".repeat(80));
  console.log("Testing all components for production readiness...\n");

  const startTime = Date.now();

  try {
    // Run all test suites
    console.log("Running comprehensive system tests...\n");

    const extractorResults = await runExtractorTests();
    const discordResults = await runDiscordTests();
    const audioPlayerResults = await runAudioPlayerTests();
    const integrationResults = await testSystemIntegration();
    const dependencyResults = await testDependencies();

    const results = {
      extractorResults: extractorResults.results,
      discordResults: discordResults.results,
      audioPlayerResults: audioPlayerResults.results,
      integrationResults,
      dependencyResults,
    };

    // Generate comprehensive report
    const systemReport = generateSystemReport(results);

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`\n⏱️ Total test duration: ${duration}ms`);

    // Log results
    logger.info("Full system test completed", {
      ...systemReport,
      duration,
      timestamp: new Date().toISOString(),
    });

    return {
      success: systemReport.ready,
      report: systemReport,
      results,
    };
  } catch (error) {
    console.log(`\n❌ System test failed: ${error.message}`);
    logger.error("Full system test failed", {
      error: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      error: error.message,
    };
  }
}

// Run full system test if called directly
if (require.main === module) {
  runFullSystemTest()
    .then((result) => {
      if (result.success) {
        console.log("\n🎉 System test completed successfully!");
        process.exit(0);
      } else {
        console.log("\n❌ System test failed!");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("System test error:", error);
      process.exit(1);
    });
}

module.exports = {
  runFullSystemTest,
  testSystemIntegration,
  testDependencies,
  generateSystemReport,
};
