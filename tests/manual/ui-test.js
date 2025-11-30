/**
 * Manual UI Testing Script
 * Tests Discord UI components and embeds without full bot integration
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const Formatters = require("../../src/utils/formatters");
const logger = require("../../src/services/logger_service");

/**
 * Test embed generation
 */
function testEmbedGeneration() {
  console.log("\n🎨 Testing Embed Generation...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Test playback embed
  console.log("Playback Embed:");
  totalTests++;
  try {
    const mockVideoData = {
      title: "Test Bilibili Video Title",
      thumbnail: "https://example.com/thumbnail.jpg",
      duration: 300,
      currentTime: 150,
      requestedBy: "TestUser",
    };

    const playbackEmbed = new EmbedBuilder()
      .setTitle("🎵 Now Playing")
      .setDescription(`**${mockVideoData.title}**`)
      .setThumbnail(mockVideoData.thumbnail)
      .addFields(
        {
          name: "⏱️ Duration",
          value: Formatters.formatTime(mockVideoData.duration),
          inline: true,
        },
        {
          name: "👤 Requested by",
          value: mockVideoData.requestedBy,
          inline: true,
        },
        {
          name: "📊 Progress",
          value: Formatters.generateProgressBar(
            mockVideoData.currentTime,
            mockVideoData.duration
          ),
          inline: false,
        }
      )
      .setColor(0x00ae86)
      .setTimestamp();

    // Validate embed structure
    const embedData = playbackEmbed.toJSON();

    if (
      embedData.title &&
      embedData.description &&
      embedData.fields &&
      embedData.fields.length === 3
    ) {
      passedTests++;
      console.log("✅ Playback embed generated successfully");
      console.log(`   Title: ${embedData.title}`);
      console.log(
        `   Fields: ${embedData.fields.map((f) => f.name).join(", ")}`
      );
      console.log(
        `   Color: #${embedData.color?.toString(16).padStart(6, "0")}`
      );
    } else {
      console.log("❌ Playback embed validation failed");
      console.log("   Missing required fields or structure");
    }
  } catch (error) {
    console.log(`❌ Playback embed generation failed: ${error.message}`);
  }

  // Test queue embed
  console.log("\nQueue Embed:");
  totalTests++;
  try {
    const mockQueue = [
      { title: "Song 1", duration: 240, requestedBy: "User1" },
      { title: "Song 2", duration: 180, requestedBy: "User2" },
      { title: "Song 3", duration: 320, requestedBy: "User3" },
    ];

    const queueEmbed = new EmbedBuilder()
      .setTitle("📋 Queue")
      .setDescription(
        mockQueue.length > 0
          ? `${mockQueue.length} song(s) in queue`
          : "Queue is empty"
      )
      .setColor(0x0099ff);

    // Add queue items as fields
    mockQueue.slice(0, 10).forEach((item, index) => {
      queueEmbed.addFields({
        name: `${index + 1}. ${Formatters.truncateText(item.title, 40)}`,
        value: `Duration: ${Formatters.formatTime(
          item.duration
        )} | Requested by: ${item.requestedBy}`,
        inline: false,
      });
    });

    const embedData = queueEmbed.toJSON();

    if (
      embedData.title &&
      embedData.fields &&
      embedData.fields.length === mockQueue.length
    ) {
      passedTests++;
      console.log("✅ Queue embed generated successfully");
      console.log(`   Items: ${embedData.fields.length}`);
    } else {
      console.log("❌ Queue embed validation failed");
    }
  } catch (error) {
    console.log(`❌ Queue embed generation failed: ${error.message}`);
  }

  // Test error embed
  console.log("\nError Embed:");
  totalTests++;
  try {
    const errorEmbed = new EmbedBuilder()
      .setTitle("❌ Error")
      .setDescription("Failed to extract audio from the provided URL")
      .addFields(
        { name: "Error Code", value: "EXTRACTION_FAILED", inline: true },
        {
          name: "Suggestion",
          value: "Please check the URL and try again",
          inline: true,
        }
      )
      .setColor(0xff0000)
      .setTimestamp();

    const embedData = errorEmbed.toJSON();

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
function testButtonComponents() {
  console.log("\n🔘 Testing Button Components...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Test control buttons
  console.log("Control Buttons:");
  totalTests++;
  try {
    const isPlaying = true;
    const controlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("prev")
        .setLabel("⏮️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("pause_resume")
        .setLabel(isPlaying ? "⏸️" : "▶️")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("skip")
        .setLabel("⏭️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("queue")
        .setLabel("📋")
        .setStyle(ButtonStyle.Secondary)
    );

    const rowData = controlRow.toJSON();

    if (rowData.components && rowData.components.length === 4) {
      passedTests++;
      console.log("✅ Control buttons generated successfully");
      console.log(
        `   Buttons: ${rowData.components.map((c) => c.label).join(", ")}`
      );
    } else {
      console.log("❌ Control buttons validation failed");
    }
  } catch (error) {
    console.log(`❌ Control buttons generation failed: ${error.message}`);
  }

  // Test queue management buttons
  console.log("\nQueue Management Buttons:");
  totalTests++;
  try {
    const queueButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("queue_clear")
        .setLabel("🗑️ Clear")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("queue_shuffle")
        .setLabel("🔀 Shuffle")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("queue_loop")
        .setLabel("🔁 Loop")
        .setStyle(ButtonStyle.Secondary)
    );

    const rowData = queueButtons.toJSON();

    if (rowData.components && rowData.components.length === 3) {
      passedTests++;
      console.log("✅ Queue management buttons generated successfully");
      console.log(
        `   Buttons: ${rowData.components.map((c) => c.label).join(", ")}`
      );
    } else {
      console.log("❌ Queue management buttons validation failed");
    }
  } catch (error) {
    console.log(
      `❌ Queue management buttons generation failed: ${error.message}`
    );
  }

  // Test disabled state
  console.log("\nDisabled Buttons:");
  totalTests++;
  try {
    const disabledButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("disabled_test")
        .setLabel("Disabled")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    const rowData = disabledButtons.toJSON();

    if (rowData.components[0].disabled === true) {
      passedTests++;
      console.log("✅ Disabled button state set correctly");
    } else {
      console.log("❌ Disabled button state validation failed");
    }
  } catch (error) {
    console.log(`❌ Disabled button generation failed: ${error.message}`);
  }

  console.log(
    `\n📊 Button Component Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test progress bar visualization
 */
function testProgressVisualization() {
  console.log("\n📊 Testing Progress Visualization...\n");

  let passedTests = 0;
  let totalTests = 0;

  const testCases = [
    { current: 0, total: 100, name: "Start (0%)" },
    { current: 25, total: 100, name: "Quarter (25%)" },
    { current: 50, total: 100, name: "Half (50%)" },
    { current: 75, total: 100, name: "Three quarters (75%)" },
    { current: 100, total: 100, name: "Complete (100%)" },
    { current: 30, total: 180, name: "Real time example" },
    { current: 0, total: 0, name: "Edge case: zero duration" },
    { current: null, total: 100, name: "Edge case: null current" },
  ];

  testCases.forEach((testCase) => {
    totalTests++;
    try {
      const progressBar = Formatters.generateProgressBar(
        testCase.current,
        testCase.total
      );

      // Basic validation
      if (
        progressBar &&
        progressBar.includes("|") &&
        progressBar.includes("%")
      ) {
        passedTests++;
        console.log(`✅ ${testCase.name}: ${progressBar}`);
      } else {
        console.log(`❌ ${testCase.name}: Invalid progress bar format`);
      }
    } catch (error) {
      console.log(`❌ ${testCase.name}: Error - ${error.message}`);
    }
  });

  // Test different progress bar lengths
  console.log("\nDifferent Progress Bar Lengths:");
  const lengthTests = [10, 15, 20, 25, 30];

  lengthTests.forEach((length) => {
    totalTests++;
    try {
      const progressBar = Formatters.generateProgressBar(50, 100, length);
      const barPart = progressBar.split(" ")[0];

      if (barPart.length === length) {
        passedTests++;
        console.log(`✅ Length ${length}: ${progressBar}`);
      } else {
        console.log(
          `❌ Length ${length}: Expected ${length} chars, got ${barPart.length}`
        );
      }
    } catch (error) {
      console.log(`❌ Length ${length}: Error - ${error.message}`);
    }
  });

  console.log(
    `\n📊 Progress Visualization Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Test complete UI workflow
 */
function testUIWorkflow() {
  console.log("\n🔄 Testing Complete UI Workflow...\n");

  let passedTests = 0;
  let totalTests = 0;

  // Simulate a complete play command workflow
  console.log("Play Command Workflow:");
  totalTests++;
  try {
    // 1. Initial response
    const initialEmbed = new EmbedBuilder()
      .setTitle("⏳ Loading...")
      .setDescription("Extracting audio from Bilibili video...")
      .setColor(0xffff00);

    // 2. Success response with controls
    const successEmbed = new EmbedBuilder()
      .setTitle("🎵 Now Playing")
      .setDescription("**Test Video Title**")
      .addFields(
        { name: "⏱️ Duration", value: "5:00", inline: true },
        { name: "👤 Requested by", value: "TestUser", inline: true },
        {
          name: "📊 Progress",
          value: "░░░░░░░░░░░░░░░░░░░░ 0% | 0:00 / 5:00",
          inline: false,
        }
      )
      .setColor(0x00ae86);

    const controlButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("prev")
        .setLabel("⏮️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("pause")
        .setLabel("⏸️")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("skip")
        .setLabel("⏭️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("queue")
        .setLabel("📋")
        .setStyle(ButtonStyle.Secondary)
    );

    // 3. Progress update
    const updatedEmbed = new EmbedBuilder()
      .setTitle("🎵 Now Playing")
      .setDescription("**Test Video Title**")
      .addFields(
        { name: "⏱️ Duration", value: "5:00", inline: true },
        { name: "👤 Requested by", value: "TestUser", inline: true },
        {
          name: "📊 Progress",
          value: "██████░░░░░░░░░░░░░░ 30% | 1:30 / 5:00",
          inline: false,
        }
      )
      .setColor(0x00ae86);

    // Validate workflow
    const initialData = initialEmbed.toJSON();
    const successData = successEmbed.toJSON();
    const updatedData = updatedEmbed.toJSON();
    const buttonsData = controlButtons.toJSON();

    if (
      initialData.title &&
      successData.fields &&
      updatedData.fields &&
      buttonsData.components
    ) {
      passedTests++;
      console.log("✅ Play command workflow simulation successful");
      console.log("   ✓ Initial loading state");
      console.log("   ✓ Success state with controls");
      console.log("   ✓ Progress update");
    } else {
      console.log("❌ Play command workflow validation failed");
    }
  } catch (error) {
    console.log(`❌ Play command workflow failed: ${error.message}`);
  }

  // Test error workflow
  console.log("\nError Handling Workflow:");
  totalTests++;
  try {
    const errorEmbed = new EmbedBuilder()
      .setTitle("❌ Playback Error")
      .setDescription("Failed to extract audio from the provided URL")
      .addFields(
        {
          name: "Error",
          value: "Invalid or unsupported Bilibili URL",
          inline: false,
        },
        {
          name: "Suggestion",
          value: "Please check the URL format and try again",
          inline: false,
        }
      )
      .setColor(0xff0000);

    const retryButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("retry")
        .setLabel("🔄 Retry")
        .setStyle(ButtonStyle.Primary)
    );

    const errorData = errorEmbed.toJSON();
    const retryData = retryButton.toJSON();

    if (
      errorData.title &&
      errorData.color === 0xff0000 &&
      retryData.components
    ) {
      passedTests++;
      console.log("✅ Error handling workflow simulation successful");
    } else {
      console.log("❌ Error handling workflow validation failed");
    }
  } catch (error) {
    console.log(`❌ Error handling workflow failed: ${error.message}`);
  }

  console.log(
    `\n📊 UI Workflow Results: ${passedTests}/${totalTests} tests passed (${Math.round(
      (passedTests / totalTests) * 100
    )}%)`
  );
  return { passed: passedTests, total: totalTests };
}

/**
 * Main UI test runner
 */
async function runUITests() {
  console.log("🎨 Bilibili Discord Bot - UI Testing Suite");
  console.log("=".repeat(50));

  const startTime = Date.now();

  // Run all test suites
  const embedResults = testEmbedGeneration();
  const buttonResults = testButtonComponents();
  const progressResults = testProgressVisualization();
  const workflowResults = testUIWorkflow();

  // Calculate overall results
  const totalPassed =
    embedResults.passed +
    buttonResults.passed +
    progressResults.passed +
    workflowResults.passed;
  const totalTests =
    embedResults.total +
    buttonResults.total +
    progressResults.total +
    workflowResults.total;
  const successRate = Math.round((totalPassed / totalTests) * 100);

  const endTime = Date.now();
  const duration = endTime - startTime;

  console.log("\n" + "=".repeat(50));
  console.log("🎨 OVERALL UI TEST RESULTS");
  console.log("=".repeat(50));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalTests - totalPassed}`);
  console.log(`Success Rate: ${successRate}%`);
  console.log(`Duration: ${duration}ms`);

  if (successRate >= 95) {
    console.log("🎉 Excellent! UI components are working perfectly.");
  } else if (successRate >= 80) {
    console.log("⚠️  Good, but some UI issues need attention.");
  } else {
    console.log("❌ Poor results. Major UI issues need to be fixed.");
  }

  // Log results to file
  logger.info("UI test completed", {
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
  const args = process.argv.slice(2);

  if (args.length > 0) {
    const testType = args[0];
    console.log(`🧪 Running specific UI test: ${testType}\n`);

    switch (testType) {
      case "embeds":
        testEmbedGeneration();
        break;
      case "buttons":
        testButtonComponents();
        break;
      case "progress":
        testProgressVisualization();
        break;
      case "workflow":
        testUIWorkflow();
        break;
      default:
        console.log(
          "❌ Unknown test type. Available: embeds, buttons, progress, workflow"
        );
    }
  } else {
    // Run full test suite
    runUITests().catch(console.error);
  }
}

module.exports = {
  runUITests,
  testEmbedGeneration,
  testButtonComponents,
  testProgressVisualization,
  testUIWorkflow,
};
