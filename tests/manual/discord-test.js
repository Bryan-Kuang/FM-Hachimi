/**
 * Manual Discord Integration Testing Script
 * Tests Discord bot functionality without full deployment
 */

const EmbedBuilders = require("../../src/ui/embeds");
const ButtonBuilders = require("../../src/ui/buttons");
const BotClient = require("../../src/bot/client");
const BilibiliExtractor = require("../../src/audio/extractor");
const logger = require("../../src/services/logger_service");

/**
 * Test embed generation
 */
function testEmbedGeneration() {
  console.log("\n🎨 Testing Discord Embed Generation...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Test now playing embed
  totalTests++;
  try {
    const videoData = {
      title: "Test Bilibili Video Title",
      duration: 300,
      uploader: "Test Uploader",
      thumbnail: "https://example.com/thumbnail.jpg",
      videoId: "BV1234567890",
      uploadDateFormatted: "2023-01-04",
    };

    const embed = EmbedBuilders.createNowPlayingEmbed(videoData, {
      currentTime: 150,
      requestedBy: "TestUser",
      queuePosition: 1,
      totalQueue: 3,
      loopMode: "queue", // Fix: Add missing loopMode parameter for testing
    });

    const embedData = embed.toJSON();

    if (embedData.title && embedData.description && embedData.fields) {
      passedTests++;
      console.log("✅ Now playing embed generated successfully");
      console.log(`   Title: ${embedData.title}`);
      console.log(`   Fields: ${embedData.fields.length}`);
    } else {
      console.log("❌ Now playing embed validation failed");
    }
  } catch (error) {
    console.log(`❌ Now playing embed generation failed: ${error.message}`);
  }

  // Test queue embed
  totalTests++;
  try {
    const mockQueue = [
      { title: "Song 1", duration: 240, requestedBy: "User1" },
      { title: "Song 2", duration: 180, requestedBy: "User2" },
    ];

    const embed = EmbedBuilders.createQueueEmbed(mockQueue, 0);
    const embedData = embed.toJSON();

    if (embedData.title && embedData.description) {
      passedTests++;
      console.log("✅ Queue embed generated successfully");
    } else {
      console.log("❌ Queue embed validation failed");
    }
  } catch (error) {
    console.log(`❌ Queue embed generation failed: ${error.message}`);
  }

  // Test error embed
  totalTests++;
  try {
    const embed = EmbedBuilders.createErrorEmbed(
      "Test Error",
      "This is a test error message",
      { suggestion: "Try again", errorCode: "TEST_ERROR" }
    );

    const embedData = embed.toJSON();

    if (
      embedData.title &&
      embedData.description &&
      embedData.color === 0xff0000
    ) {
      passedTests++;
      console.log("✅ Error embed generated successfully");
    } else {
      console.log("❌ Error embed validation failed");
    }
  } catch (error) {
    console.log(`❌ Error embed generation failed: ${error.message}`);
  }

  console.log(
    `\n📊 Embed Generation Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test button component generation
 */
function testButtonGeneration() {
  console.log("\n🔘 Testing Discord Button Generation...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Test playback control buttons
  totalTests++;
  try {
    const buttons = ButtonBuilders.createPlaybackControls({
      isPlaying: true,
      hasQueue: true,
      canGoBack: false,
      canSkip: true,
    });

    const buttonData = buttons.toJSON();

    if (buttonData.components && buttonData.components.length === 4) {
      passedTests++;
      console.log("✅ Playback control buttons generated successfully");
      console.log(
        `   Buttons: ${buttonData.components.map((c) => c.label).join(", ")}`
      );
    } else {
      console.log("❌ Playback control buttons validation failed");
    }
  } catch (error) {
    console.log(
      `❌ Playback control buttons generation failed: ${error.message}`
    );
  }

  // Test queue control buttons
  totalTests++;
  try {
    const buttons = ButtonBuilders.createQueueControls({
      hasQueue: true,
      queueLength: 3,
    });

    const buttonData = buttons.toJSON();

    if (buttonData.components && buttonData.components.length === 3) {
      passedTests++;
      console.log("✅ Queue control buttons generated successfully");
    } else {
      console.log("❌ Queue control buttons validation failed");
    }
  } catch (error) {
    console.log(`❌ Queue control buttons generation failed: ${error.message}`);
  }

  // Test confirmation buttons
  totalTests++;
  try {
    const buttons = ButtonBuilders.createConfirmationButtons();
    const buttonData = buttons.toJSON();

    if (buttonData.components && buttonData.components.length === 2) {
      passedTests++;
      console.log("✅ Confirmation buttons generated successfully");
    } else {
      console.log("❌ Confirmation buttons validation failed");
    }
  } catch (error) {
    console.log(`❌ Confirmation buttons generation failed: ${error.message}`);
  }

  console.log(
    `\n📊 Button Generation Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test command loading
 */
function testCommandLoading() {
  console.log("\n🤖 Testing Command Loading...\n");

  let passedTests = 0;
  let totalTests = 0;

  const expectedCommands = [
    "play",
    "pause",
    "resume",
    "skip",
    "prev",
    "queue",
    "nowplaying",
  ];

  expectedCommands.forEach((commandName) => {
    totalTests++;
    try {
      const command = require(`../../src/bot/commands/${commandName}`);

      if (
        command.data &&
        command.execute &&
        typeof command.execute === "function"
      ) {
        passedTests++;
        console.log(`✅ Command '${commandName}' loaded successfully`);
        console.log(`   Description: ${command.data.description}`);
        console.log(`   Cooldown: ${command.cooldown || 3}s`);
      } else {
        console.log(`❌ Command '${commandName}' missing required properties`);
      }
    } catch (error) {
      console.log(
        `❌ Failed to load command '${commandName}': ${error.message}`
      );
    }
  });

  console.log(
    `\n📊 Command Loading Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test bot client initialization (without Discord connection)
 */
async function testBotClient() {
  console.log("\n🤖 Testing Bot Client Initialization...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Test bot client creation
  totalTests++;
  try {
    const botClient = new BotClient();

    if (botClient.client && botClient.getStats) {
      passedTests++;
      console.log("✅ Bot client created successfully");
    } else {
      console.log("❌ Bot client creation failed");
    }
  } catch (error) {
    console.log(`❌ Bot client creation failed: ${error.message}`);
  }

  // Test extractor integration
  totalTests++;
  try {
    const botClient = new BotClient();
    const extractor = new BilibiliExtractor();

    botClient.setExtractor(extractor);

    if (botClient.client.extractor === extractor) {
      passedTests++;
      console.log("✅ Extractor integration successful");
    } else {
      console.log("❌ Extractor integration failed");
    }
  } catch (error) {
    console.log(`❌ Extractor integration failed: ${error.message}`);
  }

  // Test stats method
  totalTests++;
  try {
    const botClient = new BotClient();
    const stats = botClient.getStats();

    if (stats && typeof stats.ready === "boolean") {
      passedTests++;
      console.log("✅ Bot stats method working");
      console.log(`   Ready: ${stats.ready}`);
      console.log(`   Uptime: ${stats.uptime}s`);
    } else {
      console.log("❌ Bot stats method failed");
    }
  } catch (error) {
    console.log(`❌ Bot stats method failed: ${error.message}`);
  }

  console.log(
    `\n📊 Bot Client Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Main Discord test runner
 */
async function runDiscordTests() {
  console.log("🤖 Bilibili Discord Bot - Discord Integration Testing Suite");
  console.log("=".repeat(60));

  const startTime = Date.now();

  // Run all test suites
  const embedResults = testEmbedGeneration();
  const buttonResults = testButtonGeneration();
  const commandResults = testCommandLoading();
  const clientResults = await testBotClient();

  // Calculate overall results
  const totalPassed =
    embedResults.passed +
    buttonResults.passed +
    commandResults.passed +
    clientResults.passed;
  const totalTests =
    embedResults.total +
    buttonResults.total +
    commandResults.total +
    clientResults.total;
  const successRate = Math.round((totalPassed / totalTests) * 100);

  const endTime = Date.now();
  const duration = endTime - startTime;

  console.log("\n" + "=".repeat(60));
  console.log("📈 OVERALL DISCORD INTEGRATION TEST RESULTS");
  console.log("=".repeat(60));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalTests - totalPassed}`);
  console.log(`Success Rate: ${successRate}%`);
  console.log(`Duration: ${duration}ms`);

  if (successRate >= 95) {
    console.log("\n🎉 Excellent! Discord integration is working perfectly.");
  } else if (successRate >= 80) {
    console.log(
      "\n⚠️  Good, but some Discord integration issues need attention."
    );
  } else {
    console.log(
      "\n❌ Poor results. Major Discord integration issues need to be fixed."
    );
  }

  // Provide next steps
  console.log("\n📋 Next Steps:");
  console.log("1. Set up your Discord bot token in .env file");
  console.log("2. Run 'node scripts/deploy-commands.js' to register commands");
  console.log("3. Start the bot with 'npm start'");
  console.log("4. Test commands in your Discord server");

  // Log results to file
  logger.info("Discord integration test completed", {
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
  runDiscordTests().catch(console.error);
}

module.exports = {
  runDiscordTests,
  testEmbedGeneration,
  testButtonGeneration,
  testCommandLoading,
  testBotClient,
};
