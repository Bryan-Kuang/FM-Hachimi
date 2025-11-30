/**
 * Test realistic queue behavior using AudioManager.playBilibiliVideo
 */

const AudioManager = require("../../src/audio/manager");
const logger = require("../../src/services/logger_service");

async function testRealisticQueue() {
  console.log("🧪 Testing Realistic Queue Behavior...\n");

  const manager = AudioManager;
  const player = manager.getPlayer("test-guild");

  // Mock interaction object
  const createMockInteraction = (url) => ({
    guild: { id: "test-guild" },
    user: { username: "TestUser", displayName: "Test User" },
    deferReply: async () => {},
    editReply: async () => {},
  });

  console.log("1️⃣ Testing Default Loop Mode...");
  console.log(`  Default loop mode: ${player.loopMode} (should be 'track')`);

  console.log("\n2️⃣ Simulating Queue End and New Track Addition...");

  // Add 3 tracks to queue
  const track1 = player.addToQueue(
    {
      title: "Track 1",
      duration: 60,
      uploader: "User1",
      webpage_url: "https://test1.com",
    },
    "User1"
  );

  const track2 = player.addToQueue(
    {
      title: "Track 2",
      duration: 90,
      uploader: "User2",
      webpage_url: "https://test2.com",
    },
    "User2"
  );

  const track3 = player.addToQueue(
    {
      title: "Track 3",
      duration: 120,
      uploader: "User3",
      webpage_url: "https://test3.com",
    },
    "User3"
  );

  console.log(`  Queue: ${player.queue.map((t) => t.title).join(", ")}`);

  // Start playing from track 3 (last track)
  player.currentIndex = 2;
  player.currentTrack = player.queue[2];
  player.isPlaying = true;

  console.log(
    `  Currently playing: ${player.currentTrack.title} (index: ${player.currentIndex})`
  );

  // Temporarily disable single loop to test queue end
  const originalLoopMode = player.loopMode;
  player.loopMode = "none";

  // Simulate track ending (skip to next, which should fail and reset state)
  const skipResult = await player.skip();
  console.log(`  Skip from last track result: ${skipResult}`);
  console.log(
    `  After queue end - currentIndex: ${player.currentIndex}, currentTrack: ${
      player.currentTrack?.title || "null"
    }`
  );
  console.log(`  isPlaying: ${player.isPlaying}, isPaused: ${player.isPaused}`);

  // Now simulate adding a new track via AudioManager.playBilibiliVideo
  console.log(`\n  📱 Adding new track after queue ended...`);

  // Mock extractor for testing
  if (!manager.extractor) {
    manager.extractor = {
      getVideoInfo: async () => ({
        title: "New Track After End",
        duration: 150,
        uploader: "NewUser",
        description: "Test track",
        viewCount: 100,
        uploadDate: "20241201",
        thumbnail: "https://test.jpg",
        webpage_url: "https://test-new.com",
      }),
      getAudioStreamUrl: async () => "https://test-audio.com",
    };
  }

  // Test the actual playBilibiliVideo method
  const mockInteraction = createMockInteraction("https://test-new.com");

  try {
    console.log(
      `  Before adding: queue length = ${player.queue.length}, currentIndex = ${player.currentIndex}`
    );

    const result = await manager.playBilibiliVideo(
      mockInteraction,
      "https://test-new.com"
    );

    console.log(
      `  playBilibiliVideo result: ${result.success ? "Success" : "Failed"}`
    );
    console.log(`  After adding: queue length = ${player.queue.length}`);
    console.log(
      `  Current track: ${player.currentTrack?.title || "null"} (index: ${
        player.currentIndex
      })`
    );
    console.log(`  Expected: New Track After End (index: 3)`);
    console.log(
      `  ✅ Correct behavior: ${
        player.currentTrack?.title === "New Track After End" &&
        player.currentIndex === 3
          ? "YES"
          : "NO"
      }`
    );
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
  }

  // Restore original loop mode
  player.loopMode = originalLoopMode;

  console.log("\n3️⃣ Testing Single Loop Default...");
  console.log(`  Current loop mode: ${player.loopMode} (should be 'track')`);
  console.log(
    `  Can skip: ${player.canSkip()} (should be true for single loop)`
  );
  console.log(
    `  Can go back: ${player.canGoBack()} (should be true for single loop)`
  );

  console.log("\n✅ Realistic queue test completed!");
}

// Run test
testRealisticQueue().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
