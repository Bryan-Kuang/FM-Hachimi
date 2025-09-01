/**
 * Manual Audio Player Testing Script
 * Tests audio streaming functionality without Discord integration
 */

const AudioPlayer = require("../../src/audio/player");
const AudioManager = require("../../src/audio/manager");
const BilibiliExtractor = require("../../src/audio/extractor");
const logger = require("../../src/utils/logger");

/**
 * Test audio player initialization
 */
function testAudioPlayerInit() {
  console.log("\n🎛️ Testing Audio Player Initialization...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Test AudioPlayer creation
  totalTests++;
  try {
    const player = new AudioPlayer();

    if (player.audioPlayer && player.queue && Array.isArray(player.queue)) {
      passedTests++;
      console.log("✅ AudioPlayer initialized successfully");
      console.log(`   Queue length: ${player.queue.length}`);
      console.log(`   Playing: ${player.isPlaying}`);
      console.log(`   Paused: ${player.isPaused}`);
    } else {
      console.log("❌ AudioPlayer initialization failed");
    }
  } catch (error) {
    console.log(`❌ AudioPlayer initialization error: ${error.message}`);
  }

  // Test AudioManager creation
  totalTests++;
  try {
    const manager = AudioManager;

    if (
      manager.players &&
      manager.getPlayer &&
      typeof manager.getPlayer === "function"
    ) {
      passedTests++;
      console.log("✅ AudioManager initialized successfully");
      console.log(`   Players map size: ${manager.players.size}`);
    } else {
      console.log("❌ AudioManager initialization failed");
    }
  } catch (error) {
    console.log(`❌ AudioManager initialization error: ${error.message}`);
  }

  // Test extractor integration
  totalTests++;
  try {
    const manager = AudioManager;
    const extractor = new BilibiliExtractor();

    manager.setExtractor(extractor);

    if (manager.extractor === extractor) {
      passedTests++;
      console.log("✅ Extractor integration successful");
    } else {
      console.log("❌ Extractor integration failed");
    }
  } catch (error) {
    console.log(`❌ Extractor integration error: ${error.message}`);
  }

  console.log(
    `\n📊 Audio Player Init Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test queue management
 */
function testQueueManagement() {
  console.log("\n📋 Testing Queue Management...\n");

  let passedTests = 0;
  let totalTests = 0;

  const player = new AudioPlayer();

  // Test adding tracks to queue
  totalTests++;
  try {
    const mockTrack = {
      title: "Test Track 1",
      duration: 180,
      audioUrl: "https://example.com/audio1.mp3",
      uploader: "Test Uploader",
    };

    const addedTrack = player.addToQueue(mockTrack, "TestUser");

    if (player.queue.length === 1 && addedTrack.title === mockTrack.title) {
      passedTests++;
      console.log("✅ Track added to queue successfully");
      console.log(`   Queue length: ${player.queue.length}`);
      console.log(`   Track title: ${addedTrack.title}`);
    } else {
      console.log("❌ Failed to add track to queue");
    }
  } catch (error) {
    console.log(`❌ Add track error: ${error.message}`);
  }

  // Test multiple tracks
  totalTests++;
  try {
    const mockTrack2 = {
      title: "Test Track 2",
      duration: 240,
      audioUrl: "https://example.com/audio2.mp3",
      uploader: "Test Uploader 2",
    };

    player.addToQueue(mockTrack2, "TestUser2");

    if (player.queue.length === 2) {
      passedTests++;
      console.log("✅ Multiple tracks in queue");
      console.log(`   Queue length: ${player.queue.length}`);
    } else {
      console.log("❌ Multiple tracks test failed");
    }
  } catch (error) {
    console.log(`❌ Multiple tracks error: ${error.message}`);
  }

  // Test queue operations
  totalTests++;
  try {
    const stateBefore = player.getState();
    player.shuffleQueue();
    player.clearQueue();
    const stateAfter = player.getState();

    if (stateAfter.queueLength <= 1) {
      passedTests++;
      console.log("✅ Queue operations working");
      console.log(`   Queue length after clear: ${stateAfter.queueLength}`);
    } else {
      console.log("❌ Queue operations failed");
    }
  } catch (error) {
    console.log(`❌ Queue operations error: ${error.message}`);
  }

  // Test state management
  totalTests++;
  try {
    const state = player.getState();

    if (
      state &&
      typeof state.isPlaying === "boolean" &&
      Array.isArray(state.queue)
    ) {
      passedTests++;
      console.log("✅ State management working");
      console.log(`   State keys: ${Object.keys(state).join(", ")}`);
    } else {
      console.log("❌ State management failed");
    }
  } catch (error) {
    console.log(`❌ State management error: ${error.message}`);
  }

  console.log(
    `\n📊 Queue Management Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test audio manager functionality
 */
function testAudioManager() {
  console.log("\n🎵 Testing Audio Manager...\n");

  let passedTests = 0;
  let totalTests = 0;

  const manager = AudioManager;

  // Test player creation for guilds
  totalTests++;
  try {
    const testGuildId = "123456789012345678";
    const player1 = manager.getPlayer(testGuildId);
    const player2 = manager.getPlayer(testGuildId);

    if (player1 === player2 && manager.players.has(testGuildId)) {
      passedTests++;
      console.log("✅ Guild player management working");
      console.log(`   Players count: ${manager.players.size}`);
    } else {
      console.log("❌ Guild player management failed");
    }
  } catch (error) {
    console.log(`❌ Guild player error: ${error.message}`);
  }

  // Test multiple guilds
  totalTests++;
  try {
    const guild2 = "987654321098765432";
    const guild3 = "111222333444555666";

    manager.getPlayer(guild2);
    manager.getPlayer(guild3);

    if (manager.players.size >= 3) {
      passedTests++;
      console.log("✅ Multiple guild support working");
      console.log(`   Total guilds: ${manager.players.size}`);
    } else {
      console.log("❌ Multiple guild support failed");
    }
  } catch (error) {
    console.log(`❌ Multiple guild error: ${error.message}`);
  }

  // Test statistics
  totalTests++;
  try {
    const stats = manager.getStatistics();

    if (stats && typeof stats.totalGuilds === "number") {
      passedTests++;
      console.log("✅ Statistics generation working");
      console.log(`   Stats: ${JSON.stringify(stats)}`);
    } else {
      console.log("❌ Statistics generation failed");
    }
  } catch (error) {
    console.log(`❌ Statistics error: ${error.message}`);
  }

  // Test cleanup
  totalTests++;
  try {
    const initialSize = manager.players.size;
    // Don't actually cleanup as it would affect other tests
    // Just test that the method exists
    if (typeof manager.cleanup === "function") {
      passedTests++;
      console.log("✅ Cleanup method available");
    } else {
      console.log("❌ Cleanup method missing");
    }
  } catch (error) {
    console.log(`❌ Cleanup test error: ${error.message}`);
  }

  console.log(
    `\n📊 Audio Manager Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test button interaction handling
 */
async function testButtonInteractions() {
  console.log("\n🔘 Testing Button Interactions...\n");

  let passedTests = 0;
  let totalTests = 0;

  const manager = AudioManager;
  const testGuildId = "button_test_guild";

  // Mock interaction object
  const mockInteraction = {
    guild: { id: testGuildId },
    customId: "",
  };

  const buttonTests = [
    { id: "pause_resume", name: "Pause/Resume" },
    { id: "skip", name: "Skip" },
    { id: "prev", name: "Previous" },
    { id: "queue_clear", name: "Clear Queue" },
    { id: "queue_shuffle", name: "Shuffle" },
    { id: "queue_loop", name: "Loop Toggle" },
  ];

  for (const button of buttonTests) {
    totalTests++;
    try {
      mockInteraction.customId = button.id;

      // This will likely fail due to no active playback, but should not throw
      const result = await manager.handleButtonInteraction(mockInteraction);

      if (result && typeof result.success === "boolean") {
        passedTests++;
        console.log(`✅ ${button.name} button handler works`);
        console.log(`   Result: ${result.success ? "Success" : result.error}`);
      } else {
        console.log(`❌ ${button.name} button handler failed`);
      }
    } catch (error) {
      console.log(`❌ ${button.name} button error: ${error.message}`);
    }
  }

  console.log(
    `\n📊 Button Interactions Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test FFmpeg dependency
 */
function testFFmpegDependency() {
  console.log("\n🎬 Testing FFmpeg Dependency...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Test FFmpeg availability
  totalTests++;
  return new Promise((resolve) => {
    const { spawn } = require("child_process");

    const ffmpeg = spawn("ffmpeg", ["-version"]);

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        passedTests++;
        console.log("✅ FFmpeg is available on system");
      } else {
        console.log("❌ FFmpeg is not available");
        console.log(
          "   Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Ubuntu)"
        );
      }

      console.log(
        `\n📊 FFmpeg Dependency Results: ${passedTests}/${totalTests} tests passed (${Math.round(
          (passedTests / totalTests) * 100
        )}%)`
      );

      resolve({
        passed: passedTests,
        total: totalTests,
        ffmpegAvailable: passedTests > 0,
      });
    });

    ffmpeg.on("error", () => {
      console.log("❌ FFmpeg is not available");
      console.log(
        "   Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Ubuntu)"
      );

      console.log(
        `\n📊 FFmpeg Dependency Results: ${passedTests}/${totalTests} tests passed (${Math.round(
          (passedTests / totalTests) * 100
        )}%)`
      );

      resolve({
        passed: passedTests,
        total: totalTests,
        ffmpegAvailable: false,
      });
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      ffmpeg.kill();
      console.log("❌ FFmpeg check timeout");

      console.log(
        `\n📊 FFmpeg Dependency Results: ${passedTests}/${totalTests} tests passed (${Math.round(
          (passedTests / totalTests) * 100
        )}%)`
      );

      resolve({
        passed: passedTests,
        total: totalTests,
        ffmpegAvailable: false,
      });
    }, 5000);
  });
}

/**
 * Main audio player test runner
 */
async function runAudioPlayerTests() {
  console.log("🎛️ Bilibili Discord Bot - Audio Player Testing Suite");
  console.log("=".repeat(60));

  const startTime = Date.now();

  // Run all test suites
  const initResults = testAudioPlayerInit();
  const queueResults = testQueueManagement();
  const managerResults = testAudioManager();
  const buttonResults = await testButtonInteractions();
  const ffmpegResults = await testFFmpegDependency();

  // Calculate overall results
  const totalPassed =
    initResults.passed +
    queueResults.passed +
    managerResults.passed +
    buttonResults.passed +
    ffmpegResults.passed;
  const totalTests =
    initResults.total +
    queueResults.total +
    managerResults.total +
    buttonResults.total +
    ffmpegResults.total;
  const successRate = Math.round((totalPassed / totalTests) * 100);

  const endTime = Date.now();
  const duration = endTime - startTime;

  console.log("\n" + "=".repeat(60));
  console.log("📈 OVERALL AUDIO PLAYER TEST RESULTS");
  console.log("=".repeat(60));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalTests - totalPassed}`);
  console.log(`Success Rate: ${successRate}%`);
  console.log(`Duration: ${duration}ms`);

  // Provide guidance based on results
  if (!ffmpegResults.ffmpegAvailable) {
    console.log("\n⚠️  IMPORTANT: FFmpeg is not installed");
    console.log("   Install it with:");
    console.log("   - macOS: brew install ffmpeg");
    console.log("   - Ubuntu: sudo apt install ffmpeg");
    console.log("   - Windows: Download from https://ffmpeg.org/");
  } else if (successRate >= 90) {
    console.log("\n🎉 Excellent! Audio player is ready for use.");
  } else if (successRate >= 70) {
    console.log("\n⚠️  Good foundation, but some issues need attention.");
  } else {
    console.log("\n❌ Significant issues detected. Check the logs above.");
  }

  // Provide next steps
  console.log("\n📋 Next Steps:");
  console.log("1. Install FFmpeg if not available");
  console.log("2. Test with actual Discord bot integration");
  console.log("3. Try playing a real Bilibili video");

  // Log results to file
  logger.info("Audio player test completed", {
    totalTests,
    totalPassed,
    successRate,
    duration,
    ffmpegAvailable: ffmpegResults.ffmpegAvailable,
  });

  return {
    success: successRate >= 70,
    results: {
      total: totalTests,
      passed: totalPassed,
      successRate,
      duration,
      ffmpegAvailable: ffmpegResults.ffmpegAvailable,
    },
  };
}

// Run tests if called directly
if (require.main === module) {
  runAudioPlayerTests().catch(console.error);
}

module.exports = {
  runAudioPlayerTests,
  testAudioPlayerInit,
  testQueueManagement,
  testAudioManager,
  testButtonInteractions,
  testFFmpegDependency,
};
