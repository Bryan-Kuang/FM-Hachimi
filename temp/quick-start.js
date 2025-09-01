#!/usr/bin/env node

/**
 * Quick Start Script - 快速启动版本
 * 移除了启动时的网络测试，显著提升启动速度
 */

async function quickStart() {
  console.log("🚀 Quick starting Bilibili Discord Bot...\n");

  const startTime = Date.now();

  try {
    // 只加载必要的核心模块
    const BilibiliDiscordBot = require("./src/index");

    console.log("⚡ Core modules loaded");

    // 创建实例并启动
    const bot = new BilibiliDiscordBot();
    await bot.start();

    const endTime = Date.now();
    const startupTime = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n🎉 Bot started in ${startupTime} seconds!`);
    console.log("🎵 Ready to play Bilibili audio!\n");

    // 性能对比信息
    console.log("📊 Performance Notes:");
    console.log("- Skipped startup network tests");
    console.log("- Lazy dependency checking");
    console.log("- Tests run on first command use");
    console.log("- Public bots stay running 24/7 (that's why they're fast!)");
  } catch (error) {
    console.error("❌ Quick start failed:", error.message);
    process.exit(1);
  }
}

// 只在直接运行时启动
if (require.main === module) {
  quickStart();
}

module.exports = quickStart;
