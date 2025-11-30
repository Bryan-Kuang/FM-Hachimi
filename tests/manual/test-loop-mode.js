/**
 * Manual test for loop mode functionality
 * Tests all loop modes to ensure they work correctly
 */

const AudioPlayer = require("../../src/audio/player");
const AudioManager = require("../../src/audio/manager");
const logger = require("../../src/services/logger_service");

async function testLoopModes() {
  console.log("🧪 Testing Loop Modes...\n");

  const manager = AudioManager;
  const player = manager.getPlayer("test-guild");

  // Setup test queue
  player.queue = [
    { title: "Track 1", duration: 10, requestedBy: "Test", retryCount: 0 },
    { title: "Track 2", duration: 10, requestedBy: "Test", retryCount: 0 },
    { title: "Track 3", duration: 10, requestedBy: "Test", retryCount: 0 },
  ];

  console.log("📋 Test Queue:", player.queue.map((t) => t.title).join(", "));

  // Test 1: No Loop Mode
  console.log("\n1️⃣ Testing NO LOOP mode...");
  player.loopMode = "none";
  player.currentIndex = 2; // Last track
  player.currentTrack = player.queue[2];

  const skipResult1 = await player.skip();
  console.log(
    `   Skip from last track: ${
      skipResult1 ? "❌ Should fail" : "✅ Correctly failed"
    }`
  );
  console.log(`   Current index: ${player.currentIndex}`);

  // Test 2: Queue Loop Mode
  console.log("\n2️⃣ Testing QUEUE LOOP mode...");
  player.loopMode = "queue";
  player.currentIndex = 2; // Last track
  player.currentTrack = player.queue[2];

  const skipResult2 = await player.skip();
  console.log(
    `   Skip from last track: ${
      skipResult2 ? "✅ Should loop to start" : "❌ Failed to loop"
    }`
  );
  console.log(`   Current index: ${player.currentIndex} (should be 0)`);
  console.log(
    `   Current track: ${player.currentTrack?.title} (should be Track 1)`
  );

  // Test 3: Track Loop Mode
  console.log("\n3️⃣ Testing TRACK LOOP mode...");
  player.loopMode = "track";
  player.currentIndex = 1;
  player.currentTrack = player.queue[1];
  player.currentTrack.retryCount = 2; // Simulate retries

  console.log(`   Before: retry count = ${player.currentTrack.retryCount}`);

  // Simulate track end
  await player.handleTrackEnd();

  console.log(
    `   After handleTrackEnd: retry count = ${player.currentTrack.retryCount} (should be 0)`
  );
  console.log(
    `   Current track: ${player.currentTrack?.title} (should still be Track 2)`
  );

  // Test 4: Check canSkip() and canGoBack()
  console.log("\n4️⃣ Testing canSkip() and canGoBack()...");

  const tests = [
    { mode: "none", index: 0, canGoBack: false, canSkip: true },
    { mode: "none", index: 2, canGoBack: true, canSkip: false },
    { mode: "queue", index: 0, canGoBack: true, canSkip: true },
    { mode: "queue", index: 2, canGoBack: true, canSkip: true },
    { mode: "track", index: 1, canGoBack: true, canSkip: true },
  ];

  for (const test of tests) {
    player.loopMode = test.mode;
    player.currentIndex = test.index;

    const actualCanGoBack = player.canGoBack();
    const actualCanSkip = player.canSkip();

    console.log(`   Mode: ${test.mode}, Index: ${test.index}`);
    console.log(
      `     canGoBack: ${actualCanGoBack} ${
        actualCanGoBack === test.canGoBack ? "✅" : "❌"
      }`
    );
    console.log(
      `     canSkip: ${actualCanSkip} ${
        actualCanSkip === test.canSkip ? "✅" : "❌"
      }`
    );
  }

  // Test 5: Test AudioManager setLoopMode
  console.log("\n5️⃣ Testing AudioManager.setLoopMode()...");

  const result1 = manager.setLoopMode("test-guild", "none");
  console.log(`   Set to none: ${result1.success ? "✅" : "❌"}`);
  console.log(`   Current mode: ${player.loopMode}`);

  const result2 = manager.setLoopMode("test-guild", "queue");
  console.log(`   Set to queue: ${result2.success ? "✅" : "❌"}`);
  console.log(`   Current mode: ${player.loopMode}`);

  const result3 = manager.setLoopMode("test-guild", "track");
  console.log(`   Set to track: ${result3.success ? "✅" : "❌"}`);
  console.log(`   Current mode: ${player.loopMode}`);

  console.log("\n✅ Loop mode tests completed!");
}

// Run tests
testLoopModes().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
