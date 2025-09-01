/**
 * Comprehensive Integration Test
 * Tests all features to ensure they work correctly
 */

const { Client, GatewayIntentBits, ButtonStyle } = require("discord.js");
const BilibiliExtractor = require("../../src/audio/extractor");
const AudioManager = require("../../src/audio/manager");
const ButtonBuilders = require("../../src/ui/buttons");
const EmbedBuilders = require("../../src/ui/embeds");
const ProgressTracker = require("../../src/audio/progress-tracker");
const logger = require("../../src/utils/logger");
require("dotenv").config();

class ComprehensiveTest {
  constructor() {
    this.testResults = {
      buttonControls: { passed: 0, failed: 0, tests: [] },
      loopMode: { passed: 0, failed: 0, tests: [] },
      progressTracking: { passed: 0, failed: 0, tests: [] },
      errorHandling: { passed: 0, failed: 0, tests: [] },
      voiceConnection: { passed: 0, failed: 0, tests: [] },
    };
  }

  async runAllTests() {
    console.log("🧪 Starting Comprehensive Integration Tests...\n");

    try {
      // Test 1: Button Controls
      await this.testButtonControls();

      // Test 2: Loop Mode
      await this.testLoopMode();

      // Test 3: Progress Tracking
      await this.testProgressTracking();

      // Test 4: Error Handling
      await this.testErrorHandling();

      // Test 5: Voice Connection
      await this.testVoiceConnection();

      this.printResults();
    } catch (error) {
      console.error("❌ Test suite failed:", error.message);
    }
  }

  async testButtonControls() {
    console.log("1️⃣ Testing Button Controls...");

    try {
      // Test that buttons are created correctly
      const buttonStates = [
        {
          name: "Initial state",
          state: {
            isPlaying: false,
            hasQueue: true,
            canGoBack: false,
            canSkip: true,
            loopMode: "none",
          },
        },
        {
          name: "Playing state",
          state: {
            isPlaying: true,
            hasQueue: true,
            canGoBack: true,
            canSkip: true,
            loopMode: "queue",
          },
        },
        {
          name: "Last track",
          state: {
            isPlaying: true,
            hasQueue: true,
            canGoBack: true,
            canSkip: false,
            loopMode: "none",
          },
        },
      ];

      for (const { name, state } of buttonStates) {
        try {
          const buttons = ButtonBuilders.createPlaybackControls(state);

          // Check that it returns an array of two rows
          if (!Array.isArray(buttons) || buttons.length !== 2) {
            throw new Error(
              "createPlaybackControls should return array of 2 rows"
            );
          }

          // Check first row has 4 buttons
          if (buttons[0].components.length !== 4) {
            throw new Error("First row should have 4 buttons");
          }

          // Check second row has 1 button
          if (buttons[1].components.length !== 1) {
            throw new Error("Second row should have 1 button");
          }

          // Check button IDs
          const expectedIds = ["prev", "pause_resume", "skip", "stop"];
          const actualIds = buttons[0].components.map((b) => b.data.custom_id);

          for (const id of expectedIds) {
            if (!actualIds.includes(id)) {
              throw new Error(`Missing button: ${id}`);
            }
          }

          // Check loop button
          const loopButton = buttons[1].components[0];
          if (loopButton.data.custom_id !== "loop") {
            throw new Error("Loop button missing or incorrect");
          }

          // Check loop emoji
          const expectedEmoji =
            state.loopMode === "none"
              ? "➡️"
              : state.loopMode === "queue"
              ? "🔁"
              : "🔂";
          if (!loopButton.data.label.includes(expectedEmoji)) {
            throw new Error(
              `Loop button has wrong emoji. Expected ${expectedEmoji}`
            );
          }

          this.recordTest("buttonControls", name, true);
          console.log(`   ✅ ${name}`);
        } catch (error) {
          this.recordTest("buttonControls", name, false, error.message);
          console.log(`   ❌ ${name}: ${error.message}`);
        }
      }

      // Test button interaction handling
      const audioManager = AudioManager;
      const player = audioManager.getPlayer("test-guild");

      // Add test tracks
      player.queue = [
        { title: "Track 1", duration: 60, requestedBy: "Test" },
        { title: "Track 2", duration: 90, requestedBy: "Test" },
        { title: "Track 3", duration: 120, requestedBy: "Test" },
      ];
      player.currentIndex = 1;
      player.currentTrack = player.queue[1];
      player.currentGuild = "test-guild"; // 🔧 添加：设置guild ID

      // Test skip button
      try {
        const result = await audioManager.handleButtonInteraction({
          customId: "skip",
          guild: { id: "test-guild" },
        });

        if (!result.success) {
          throw new Error("Skip should succeed with tracks in queue");
        }

        this.recordTest("buttonControls", "Skip button", true);
        console.log("   ✅ Skip button");
      } catch (error) {
        this.recordTest("buttonControls", "Skip button", false, error.message);
        console.log(`   ❌ Skip button: ${error.message}`);
      }

      // Test prev button
      try {
        const result = await audioManager.handleButtonInteraction({
          customId: "prev",
          guild: { id: "test-guild" },
        });

        if (!result.success) {
          throw new Error("Prev should succeed when not at first track");
        }

        this.recordTest("buttonControls", "Prev button", true);
        console.log("   ✅ Prev button");
      } catch (error) {
        this.recordTest("buttonControls", "Prev button", false, error.message);
        console.log(`   ❌ Prev button: ${error.message}`);
      }
    } catch (error) {
      console.log(`   ❌ Button controls test failed: ${error.message}`);
    }
  }

  async testLoopMode() {
    console.log("\n2️⃣ Testing Loop Mode...");

    try {
      const audioManager = AudioManager;
      const guildId = "test-guild-loop";
      const player = audioManager.getPlayer(guildId);

      // Test loop mode transitions
      const transitions = [
        { from: "none", to: "queue" },
        { from: "queue", to: "track" },
        { from: "track", to: "none" },
      ];

      for (const { from, to } of transitions) {
        try {
          player.loopMode = from;
          const result = audioManager.setLoopMode(guildId, to);

          if (!result.success) {
            throw new Error(`Failed to set loop mode from ${from} to ${to}`);
          }

          if (player.loopMode !== to) {
            throw new Error(
              `Loop mode not updated. Expected ${to}, got ${player.loopMode}`
            );
          }

          this.recordTest("loopMode", `${from} → ${to}`, true);
          console.log(`   ✅ Loop mode ${from} → ${to}`);
        } catch (error) {
          this.recordTest("loopMode", `${from} → ${to}`, false, error.message);
          console.log(`   ❌ Loop mode ${from} → ${to}: ${error.message}`);
        }
      }

      // Test loop button interaction
      try {
        const result = await audioManager.handleButtonInteraction({
          customId: "loop",
          guild: { id: guildId },
        });

        if (!result.success || !result.showMenu) {
          throw new Error("Loop button should show menu");
        }

        this.recordTest("loopMode", "Loop button shows menu", true);
        console.log("   ✅ Loop button shows menu");
      } catch (error) {
        this.recordTest(
          "loopMode",
          "Loop button shows menu",
          false,
          error.message
        );
        console.log(`   ❌ Loop button shows menu: ${error.message}`);
      }
    } catch (error) {
      console.log(`   ❌ Loop mode test failed: ${error.message}`);
    }
  }

  async testProgressTracking() {
    console.log("\n3️⃣ Testing Progress Tracking...");

    try {
      const player = AudioManager.getPlayer("test-guild-progress");

      // Setup test track
      player.currentTrack = {
        title: "Test Track",
        duration: 180, // 3 minutes
        requestedBy: "Test User",
      };
      player.isPlaying = true;
      player.startTime = Date.now() - 30000; // 30 seconds ago

      // Test getCurrentTime
      try {
        const currentTime = player.getCurrentTime();

        if (typeof currentTime !== "number") {
          throw new Error("getCurrentTime should return a number");
        }

        if (currentTime < 29 || currentTime > 31) {
          throw new Error(
            `getCurrentTime returned unexpected value: ${currentTime}`
          );
        }

        this.recordTest("progressTracking", "getCurrentTime", true);
        console.log("   ✅ getCurrentTime works correctly");
      } catch (error) {
        this.recordTest(
          "progressTracking",
          "getCurrentTime",
          false,
          error.message
        );
        console.log(`   ❌ getCurrentTime: ${error.message}`);
      }

      // Test progress bar generation
      try {
        const Formatters = require("../../src/utils/formatters");
        const progressBar = Formatters.generateProgressBar(30, 180);

        if (!progressBar || typeof progressBar !== "string") {
          throw new Error("generateProgressBar should return a string");
        }

        this.recordTest("progressTracking", "Progress bar generation", true);
        console.log("   ✅ Progress bar generation");
      } catch (error) {
        this.recordTest(
          "progressTracking",
          "Progress bar generation",
          false,
          error.message
        );
        console.log(`   ❌ Progress bar generation: ${error.message}`);
      }

      // Test progress tracker doesn't crash
      try {
        // Mock message
        const mockMessage = {
          edit: async () => ({ id: "test" }),
        };

        ProgressTracker.startTracking("test-guild-progress", mockMessage);

        // Wait a bit
        await new Promise((resolve) => setTimeout(resolve, 100));

        ProgressTracker.stopTracking("test-guild-progress");

        this.recordTest("progressTracking", "Progress tracker lifecycle", true);
        console.log("   ✅ Progress tracker lifecycle");
      } catch (error) {
        this.recordTest(
          "progressTracking",
          "Progress tracker lifecycle",
          false,
          error.message
        );
        console.log(`   ❌ Progress tracker lifecycle: ${error.message}`);
      }
    } catch (error) {
      console.log(`   ❌ Progress tracking test failed: ${error.message}`);
    }
  }

  async testErrorHandling() {
    console.log("\n4️⃣ Testing Error Handling...");

    try {
      const audioManager = AudioManager;

      // Test skip with no current track
      try {
        const player = audioManager.getPlayer("test-error-1");
        player.currentTrack = null;
        player.queue = [];

        const result = await audioManager.skipTrack("test-error-1");

        if (result.success) {
          throw new Error("Skip should fail with no current track");
        }

        if (!result.error || !result.suggestion) {
          throw new Error("Error result should include error and suggestion");
        }

        this.recordTest("errorHandling", "Skip with no track", true);
        console.log("   ✅ Skip with no track handled correctly");
      } catch (error) {
        this.recordTest(
          "errorHandling",
          "Skip with no track",
          false,
          error.message
        );
        console.log(`   ❌ Skip with no track: ${error.message}`);
      }

      // Test prev at first track
      try {
        const player = audioManager.getPlayer("test-error-2");
        player.currentTrack = { title: "First Track" };
        player.currentIndex = 0;
        player.queue = [player.currentTrack];
        player.loopMode = "none";

        const result = await audioManager.previousTrack("test-error-2");

        if (result.success) {
          throw new Error("Prev should fail at first track with no loop");
        }

        this.recordTest("errorHandling", "Prev at first track", true);
        console.log("   ✅ Prev at first track handled correctly");
      } catch (error) {
        this.recordTest(
          "errorHandling",
          "Prev at first track",
          false,
          error.message
        );
        console.log(`   ❌ Prev at first track: ${error.message}`);
      }
    } catch (error) {
      console.log(`   ❌ Error handling test failed: ${error.message}`);
    }
  }

  async testVoiceConnection() {
    console.log("\n5️⃣ Testing Voice Connection...");

    try {
      const player = AudioManager.getPlayer("test-voice");

      // Test voice connection state tracking
      try {
        const state = player.getState();

        if (!state.hasOwnProperty("connected")) {
          throw new Error("Player state should include connected property");
        }

        this.recordTest("voiceConnection", "Connection state tracking", true);
        console.log("   ✅ Connection state tracking");
      } catch (error) {
        this.recordTest(
          "voiceConnection",
          "Connection state tracking",
          false,
          error.message
        );
        console.log(`   ❌ Connection state tracking: ${error.message}`);
      }

      // Test stop method
      try {
        player.queue = [{ title: "Test Track" }];
        player.currentTrack = player.queue[0];
        player.isPlaying = true;

        const stopped = await player.stop();

        if (!stopped) {
          throw new Error("Stop should return true");
        }

        if (
          player.queue.length !== 0 ||
          player.currentTrack !== null ||
          player.isPlaying
        ) {
          throw new Error("Stop should clear queue and reset state");
        }

        this.recordTest("voiceConnection", "Stop functionality", true);
        console.log("   ✅ Stop functionality");
      } catch (error) {
        this.recordTest(
          "voiceConnection",
          "Stop functionality",
          false,
          error.message
        );
        console.log(`   ❌ Stop functionality: ${error.message}`);
      }
    } catch (error) {
      console.log(`   ❌ Voice connection test failed: ${error.message}`);
    }
  }

  recordTest(category, testName, passed, error = null) {
    this.testResults[category].tests.push({ testName, passed, error });
    if (passed) {
      this.testResults[category].passed++;
    } else {
      this.testResults[category].failed++;
    }
  }

  printResults() {
    console.log("\n📊 Test Results Summary");
    console.log("======================");

    let totalPassed = 0;
    let totalFailed = 0;

    for (const [category, results] of Object.entries(this.testResults)) {
      const categoryName = {
        buttonControls: "Button Controls",
        loopMode: "Loop Mode",
        progressTracking: "Progress Tracking",
        errorHandling: "Error Handling",
        voiceConnection: "Voice Connection",
      }[category];

      console.log(`\n${categoryName}:`);
      console.log(`  ✅ Passed: ${results.passed}`);
      console.log(`  ❌ Failed: ${results.failed}`);

      if (results.failed > 0) {
        console.log("  Failed tests:");
        results.tests
          .filter((t) => !t.passed)
          .forEach((t) => {
            console.log(`    - ${t.testName}: ${t.error}`);
          });
      }

      totalPassed += results.passed;
      totalFailed += results.failed;
    }

    console.log("\n📈 Overall Results:");
    console.log(`  Total Tests: ${totalPassed + totalFailed}`);
    console.log(`  ✅ Passed: ${totalPassed}`);
    console.log(`  ❌ Failed: ${totalFailed}`);
    console.log(
      `  Success Rate: ${(
        (totalPassed / (totalPassed + totalFailed)) *
        100
      ).toFixed(1)}%`
    );

    if (totalFailed === 0) {
      console.log("\n🎉 All tests passed! The bot is working correctly.");
    } else {
      console.log("\n⚠️ Some tests failed. Please fix the issues above.");
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const test = new ComprehensiveTest();
  test
    .runAllTests()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Test execution failed:", error);
      process.exit(1);
    });
}

module.exports = ComprehensiveTest;

