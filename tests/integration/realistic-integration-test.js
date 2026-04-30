#!/usr/bin/env node

/**
 * 🎯 真实集成测试 - Bilibili Discord Bot
 * 测试实际使用场景中的问题
 */

const { Client, GatewayIntentBits } = require("discord.js");
const BilibiliExtractor = require("../../src/bilibili/extractor");
const AudioManager = require("../../src/session/audio_manager");
const logger = require("../../src/services/logger_service");
require("dotenv").config();

class RealisticIntegrationTest {
  constructor() {
    this.testUrl = "https://www.bilibili.com/video/BV1uv4y1q7Mv";
    this.results = {
      discord_connect: { success: false, error: null },
      voice_connection: { success: false, error: null, duration: 0 },
      audio_extraction: { success: false, error: null, duration: 0 },
      end_to_end: { success: false, error: null, duration: 0 },
    };
    this.client = null;
  }

  async runAll() {
    console.log("🎯 开始真实集成测试...\n");

    try {
      // 1. 测试Discord连接
      await this.testDiscordConnection();

      // 2. 测试音频提取（时间测试）
      await this.testTimedAudioExtraction();

      // 3. 测试语音连接超时
      await this.testVoiceConnectionTimeout();

      // 4. 测试端到端流程时间
      await this.testEndToEndTiming();

      this.printResults();
      return this.results;
    } catch (error) {
      console.error("❌ 真实集成测试失败:", error.message);
      return this.results;
    } finally {
      if (this.client) {
        this.client.destroy();
      }
    }
  }

  async testDiscordConnection() {
    console.log("1. 🤖 测试Discord连接...");

    try {
      if (!process.env.DISCORD_TOKEN) {
        throw new Error("DISCORD_TOKEN not found in environment");
      }

      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
      });

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Discord connection timeout (10s)"));
        }, 10000);

        this.client.once("ready", () => {
          clearTimeout(timeout);
          console.log("   ✅ Discord连接成功");
          console.log(`   📊 Bot: ${this.client.user.username}`);
          console.log(`   🏰 Guilds: ${this.client.guilds.cache.size}`);
          resolve();
        });

        this.client.login(process.env.DISCORD_TOKEN).catch(reject);
      });

      this.results.discord_connect = { success: true, error: null };
    } catch (error) {
      console.log(`   ❌ Discord连接失败: ${error.message}`);
      this.results.discord_connect = { success: false, error: error.message };
    }
  }

  async testTimedAudioExtraction() {
    console.log("\n2. ⏱️ 测试音频提取时间...");

    try {
      const extractor = new BilibiliExtractor();
      const startTime = Date.now();

      const result = await extractor.extractAudio(this.testUrl);
      const duration = Date.now() - startTime;

      console.log("   ✅ 音频提取成功");
      console.log(`   ⏱️  耗时: ${duration}ms`);
      console.log(`   📊 标题: ${result.title}`);

      // 检查是否会导致Discord超时（3秒）
      if (duration > 3000) {
        console.log(`   ⚠️  警告: 耗时超过3秒，可能导致Discord超时！`);
      }

      this.results.audio_extraction = {
        success: true,
        error: null,
        duration: duration,
        tooSlow: duration > 3000,
      };
    } catch (error) {
      console.log(`   ❌ 音频提取失败: ${error.message}`);
      this.results.audio_extraction = {
        success: false,
        error: error.message,
        duration: 0,
      };
    }
  }

  async testVoiceConnectionTimeout() {
    console.log("\n3. 🔊 测试语音连接行为...");

    try {
      if (!this.results.discord_connect.success) {
        console.log("   ⏭️  跳过语音连接测试（Discord未连接）");
        return;
      }

      // 模拟语音连接过程
      const {
        joinVoiceChannel,
        VoiceConnectionStatus,
      } = require("@discordjs/voice");

      console.log("   📝 模拟语音连接创建过程...");

      // 这里我们不能真正创建语音连接（没有真实的语音频道）
      // 但我们可以测试连接创建的时间和逻辑

      const AudioPlayer = require("../../src/audio/audio_player");
      const player = new AudioPlayer();

      // 测试waitForVoiceConnection的超时逻辑
      const startTime = Date.now();
      try {
        await player.waitForVoiceConnection();
      } catch (error) {
        const duration = Date.now() - startTime;
        console.log(`   ✅ 超时机制正常工作`);
        console.log(`   ⏱️  超时时间: ${duration}ms`);

        if (error.message === "No voice connection") {
          this.results.voice_connection = {
            success: true,
            error: null,
            duration: duration,
            note: "Timeout mechanism working correctly",
          };
        }
      }
    } catch (error) {
      console.log(`   ❌ 语音连接测试失败: ${error.message}`);
      this.results.voice_connection = {
        success: false,
        error: error.message,
        duration: 0,
      };
    }
  }

  async testEndToEndTiming() {
    console.log("\n4. 🎯 测试端到端响应时间...");

    try {
      // AudioManager是单例，不需要new
      const audioManager = AudioManager;
      const extractor = new BilibiliExtractor();
      audioManager.setExtractor(extractor);

      // 模拟完整的播放流程（除了真实的语音连接）
      const startTime = Date.now();

      // 1. 音频提取
      console.log("   📥 提取音频...");
      const audioResult = await extractor.extractAudio(this.testUrl);
      const extractTime = Date.now() - startTime;

      // 2. 音频资源创建测试
      console.log("   🎵 测试音频资源创建...");
      const player = audioManager.getPlayer("test-guild");

      try {
        // 只测试资源创建，不实际播放
        const resource = await player.createAudioResource(audioResult.audioUrl);
        const totalTime = Date.now() - startTime;

        console.log("   ✅ 端到端流程测试完成");
        console.log(`   📊 音频提取: ${extractTime}ms`);
        console.log(`   📊 总计时间: ${totalTime}ms`);

        // 检查是否会超过Discord的3秒限制
        const wouldTimeout = totalTime > 3000;
        if (wouldTimeout) {
          console.log(`   ⚠️  警告: 总时间超过3秒，会导致Discord超时！`);
        }

        this.results.end_to_end = {
          success: true,
          error: null,
          duration: totalTime,
          extractTime: extractTime,
          wouldTimeout: wouldTimeout,
        };
      } catch (resourceError) {
        console.log(`   ❌ 音频资源创建失败: ${resourceError.message}`);
        this.results.end_to_end = {
          success: false,
          error: resourceError.message,
          duration: Date.now() - startTime,
        };
      }
    } catch (error) {
      console.log(`   ❌ 端到端测试失败: ${error.message}`);
      this.results.end_to_end = {
        success: false,
        error: error.message,
        duration: 0,
      };
    }
  }

  printResults() {
    console.log("\n📊 真实集成测试结果汇总:");
    console.log("===============================");

    Object.entries(this.results).forEach(([test, result]) => {
      const icon = result.success ? "✅" : "❌";
      const name = {
        discord_connect: "Discord连接",
        voice_connection: "语音连接机制",
        audio_extraction: "音频提取时间",
        end_to_end: "端到端时间",
      }[test];

      console.log(`${icon} ${name}: ${result.success ? "通过" : "失败"}`);
      if (result.duration) {
        console.log(`   ⏱️  时间: ${result.duration}ms`);
      }
      if (!result.success && result.error) {
        console.log(`   错误: ${result.error}`);
      }
      if (result.wouldTimeout) {
        console.log(`   ⚠️  会导致Discord超时`);
      }
      if (result.tooSlow) {
        console.log(`   ⚠️  响应过慢`);
      }
    });

    console.log("\n💡 关键发现:");

    // 分析Discord超时问题
    const audioTime = this.results.audio_extraction.duration || 0;
    const totalTime = this.results.end_to_end.duration || 0;

    if (audioTime > 3000) {
      console.log("🚨 音频提取时间超过3秒，必须使用deferReply()");
    }
    if (totalTime > 3000) {
      console.log("🚨 总处理时间超过3秒，必须异步处理");
    }

    // 语音连接问题分析
    if (!this.results.voice_connection.success) {
      console.log("🚨 语音连接超时机制需要优化");
    }

    console.log("\n🔧 修复建议:");
    if (audioTime > 3000 || totalTime > 3000) {
      console.log("• 在play命令中使用interaction.deferReply()");
      console.log("• 使用interaction.editReply()更新结果");
    }
    if (!this.results.voice_connection.success) {
      console.log("• 减少语音连接超时时间");
      console.log("• 改进语音连接错误处理");
    }
  }
}

// 如果直接运行
if (require.main === module) {
  const test = new RealisticIntegrationTest();
  test
    .runAll()
    .then((results) => {
      console.log("\n🎯 真实集成测试完成");

      // 根据结果决定退出码
      const hasTimeoutIssues =
        results.audio_extraction.tooSlow || results.end_to_end.wouldTimeout;
      const hasConnectionIssues = !results.voice_connection.success;

      if (hasTimeoutIssues || hasConnectionIssues) {
        console.log("⚠️  发现需要修复的问题");
        process.exit(1);
      } else {
        console.log("✅ 所有关键问题已解决");
        process.exit(0);
      }
    })
    .catch((error) => {
      console.error("真实集成测试执行失败:", error);
      process.exit(1);
    });
}

module.exports = RealisticIntegrationTest;
