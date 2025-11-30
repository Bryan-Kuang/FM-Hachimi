/**
 * Test queue behavior and default loop mode
 */

const AudioPlayer = require("../../src/audio/player");
const AudioManager = require("../../src/audio/manager");
const logger = require("../../src/services/logger_service");

async function testQueueBehavior() {
  console.log("🧪 Testing Queue Behavior and Default Loop Mode...\n");

  const manager = AudioManager;
  const player = manager.getPlayer("test-guild");

  // Test 1: Check default loop mode
  console.log("1️⃣ Testing Default Loop Mode...");
  console.log(`  Default loop mode: ${player.loopMode} (should be 'track')`);
  console.log(
    `  ✅ Default is single loop: ${player.loopMode === "track" ? "YES" : "NO"}`
  );

  // Test 2: Test queue completion and new track addition
  console.log("\n2️⃣ Testing Queue Completion Behavior...");

  // Setup queue with 3 tracks
  player.queue = [
    { title: "Track 1", duration: 60, requestedBy: "User1" },
    { title: "Track 2", duration: 90, requestedBy: "User2" },
    { title: "Track 3", duration: 120, requestedBy: "User3" },
  ];

  console.log(
    `  Initial queue: ${player.queue.map((t) => t.title).join(", ")}`
  );

  // Simulate playing last track
  player.currentIndex = 2;
  player.currentTrack = player.queue[2];
  player.isPlaying = true;

  console.log(
    `  Current track: ${player.currentTrack.title} (index: ${player.currentIndex})`
  );

  // Temporarily disable single loop for this test
  const originalLoopMode = player.loopMode;
  player.loopMode = "none";

  // Try to skip (should reach end)
  const skipResult = await player.skip();
  console.log(
    `  Skip from last track: ${
      skipResult ? "Continued" : "Stopped"
    } (should stop)`
  );
  console.log(
    `  After skip - currentIndex: ${player.currentIndex}, currentTrack: ${
      player.currentTrack ? player.currentTrack.title : "null"
    }`
  );
  console.log(`  Playing status: ${player.isPlaying}`);

  // Now add a new track
  const newTrack = player.addToQueue(
    {
      title: "New Track",
      duration: 150,
      uploader: "NewUser",
    },
    "User4"
  );

  console.log(`  Added new track: ${newTrack.title}`);
  console.log(
    `  Queue after addition: ${player.queue.map((t) => t.title).join(", ")}`
  );
  console.log(`  Current index before playNext: ${player.currentIndex}`);

  // Try to play next
  const playResult = await player.playNext();
  console.log(`  playNext result: ${playResult ? "Success" : "Failed"}`);
  console.log(
    `  Should start from: ${
      player.currentTrack ? player.currentTrack.title : "null"
    } (should be New Track)`
  );
  console.log(
    `  New currentIndex: ${player.currentIndex} (should be 3 for new track)`
  );

  // Restore original loop mode
  player.loopMode = originalLoopMode;

  // Test 3: Test canSkip and canGoBack with single loop
  console.log("\n3️⃣ Testing Single Loop Behavior...");

  // Reset to single track with single loop
  player.queue = [
    { title: "Single Track", duration: 60, requestedBy: "User1" },
  ];
  player.currentIndex = 0;
  player.currentTrack = player.queue[0];
  player.loopMode = "track";

  console.log(`  Track: ${player.currentTrack.title}`);
  console.log(`  Loop mode: ${player.loopMode}`);
  console.log(
    `  Can skip: ${player.canSkip()} (should be true for single loop)`
  );
  console.log(
    `  Can go back: ${player.canGoBack()} (should be true for single loop)`
  );

  // Test skip in single loop mode
  const loopSkipResult = await player.skip();
  console.log(
    `  Skip in single loop: ${
      loopSkipResult ? "Success" : "Failed"
    } (should succeed)`
  );
  console.log(
    `  Still same track: ${
      player.currentTrack ? player.currentTrack.title : "null"
    } (should be same)`
  );

  console.log("\n✅ Queue behavior test completed!");
}

// Run test
testQueueBehavior().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
