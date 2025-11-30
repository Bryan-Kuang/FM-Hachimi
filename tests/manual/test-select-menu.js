/**
 * Manual test for select menu interaction handling
 */

const { Client, GatewayIntentBits } = require("discord.js");
const AudioManager = require("../../src/audio/manager");
const logger = require("../../src/services/logger_service");

async function testSelectMenuInteraction() {
  console.log("🧪 Testing Select Menu Interaction...\n");

  try {
    // Test 1: AudioManager setLoopMode
    console.log("1️⃣ Testing AudioManager.setLoopMode...");

    const testCases = [
      { mode: "none", expected: true },
      { mode: "queue", expected: true },
      { mode: "track", expected: true },
      { mode: "invalid", expected: true }, // Should still work but not change mode
    ];

    for (const { mode, expected } of testCases) {
      try {
        const result = AudioManager.setLoopMode("test-guild", mode);
        const actual = result.success;

        console.log(
          `  Mode "${mode}": ${
            actual === expected ? "✅" : "❌"
          } (expected: ${expected}, got: ${actual})`
        );
        console.log(`    Result:`, result);
      } catch (error) {
        console.log(`  Mode "${mode}": ❌ Error: ${error.message}`);
      }
    }

    // Test 2: Check if select menu interaction structure is correct
    console.log("\n2️⃣ Testing Mock Select Menu Interaction...");

    const mockInteraction = {
      customId: "loop_select",
      values: ["track"],
      guild: { id: "test-guild", name: "Test Guild" },
      user: { username: "TestUser" },
      deferReply: async (options) => {
        console.log(`  deferReply called with:`, options);
        return Promise.resolve();
      },
      editReply: async (options) => {
        console.log(
          `  editReply called with:`,
          JSON.stringify(options, null, 2)
        );
        return Promise.resolve();
      },
      deferred: true,
      replied: false,
    };

    // Simulate the select menu handler logic
    try {
      const selectedMode = mockInteraction.values[0];
      console.log(`  Selected mode: ${selectedMode}`);

      await mockInteraction.deferReply({ ephemeral: true });

      const result = AudioManager.setLoopMode(
        mockInteraction.guild.id,
        selectedMode
      );
      console.log(`  setLoopMode result:`, result);

      if (result.success) {
        const loopEmoji =
          selectedMode === "none"
            ? "➡️"
            : selectedMode === "queue"
            ? "🔁"
            : "🔂";
        const loopText =
          selectedMode === "none"
            ? "disabled"
            : selectedMode === "queue"
            ? "enabled (queue)"
            : "enabled (track)";

        const successEmbed = {
          title: "Loop Mode Changed",
          description: `${loopEmoji} Loop mode ${loopText}`,
        };

        await mockInteraction.editReply({
          embeds: [successEmbed],
        });

        console.log(`  ✅ Mock interaction completed successfully`);
      } else {
        console.log(`  ❌ setLoopMode failed: ${result.error}`);
      }
    } catch (error) {
      console.log(`  ❌ Mock interaction failed: ${error.message}`);
    }

    // Test 3: Check player state after mode change
    console.log("\n3️⃣ Testing Player State After Mode Change...");

    const player = AudioManager.getPlayer("test-guild");
    const state = player.getState();

    console.log(`  Current loop mode: ${state.loopMode}`);
    console.log(`  Player state:`, {
      isPlaying: state.isPlaying,
      hasQueue: state.queueLength > 0,
      loopMode: state.loopMode,
    });

    console.log("\n✅ Select menu test completed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

// Run test
testSelectMenuInteraction().catch((error) => {
  console.error("❌ Test execution failed:", error);
  process.exit(1);
});
