/**
 * Manual test to check why loop button interaction fails
 */

const { Client, GatewayIntentBits } = require("discord.js");
const ButtonBuilders = require("../../src/ui/buttons");
const logger = require("../../src/services/logger_service");

async function testLoopButton() {
  console.log("🧪 Testing Loop Button Creation...\n");

  // Test 1: Check button creation
  console.log("1️⃣ Testing Button Creation...");

  const states = [
    {
      isPlaying: true,
      hasQueue: true,
      canGoBack: true,
      canSkip: true,
      loopMode: "none",
    },
    {
      isPlaying: true,
      hasQueue: true,
      canGoBack: false,
      canSkip: false,
      loopMode: "track",
    },
    {
      isPlaying: false,
      hasQueue: false,
      canGoBack: false,
      canSkip: false,
      loopMode: "queue",
    },
  ];

  for (const state of states) {
    try {
      const buttons = ButtonBuilders.createPlaybackControls(state);

      console.log(`\n  State: ${JSON.stringify(state)}`);
      console.log(
        `  Result type: ${Array.isArray(buttons) ? "Array" : typeof buttons}`
      );
      console.log(`  Array length: ${buttons.length}`);

      if (Array.isArray(buttons)) {
        buttons.forEach((row, i) => {
          console.log(`  Row ${i}: ${row.constructor.name}`);
          console.log(`    Components: ${row.components.length}`);
          console.log(
            `    Component types: ${row.components
              .map((c) => c.constructor.name)
              .join(", ")}`
          );
        });
      }
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
    }
  }

  // Test 2: Check component structure
  console.log("\n2️⃣ Testing Component Structure...");

  try {
    const buttons = ButtonBuilders.createPlaybackControls({
      isPlaying: true,
      hasQueue: true,
      canGoBack: true,
      canSkip: true,
      loopMode: "none",
    });

    // Check if it's the correct structure for Discord
    const isValidStructure =
      Array.isArray(buttons) &&
      buttons.every((row) => row.components && Array.isArray(row.components));

    console.log(
      `  Valid structure for Discord: ${isValidStructure ? "✅" : "❌"}`
    );

    // Test JSON serialization (Discord will do this)
    try {
      const serialized = JSON.stringify(buttons);
      console.log(`  Can serialize to JSON: ✅`);
      console.log(`  Serialized length: ${serialized.length} characters`);
    } catch (error) {
      console.log(`  Can serialize to JSON: ❌ ${error.message}`);
    }
  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
  }

  console.log("\n✅ Button test completed!");
}

// Run test
testLoopButton().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
