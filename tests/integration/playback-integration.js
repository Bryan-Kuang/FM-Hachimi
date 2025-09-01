#!/usr/bin/env node

/**
 * 🎵 播放集成测试 - 深度诊断音频播放问题
 * 系统性地测试从URL到音频播放的完整流程
 */

const {
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const { spawn } = require("child_process");
const BilibiliExtractor = require("../../src/audio/extractor");

class PlaybackIntegrationTest {
  constructor() {
    this.testUrl = "https://www.bilibili.com/video/BV1uv4y1q7Mv";
    this.results = {
      extraction: { success: false, error: null },
      ffmpeg: { success: false, error: null },
      discord: { success: false, error: null },
      integration: { success: false, error: null },
    };
  }

  async runAll() {
    console.log("🎵 开始播放集成测试...\n");

    try {
      // 1. 测试B站音频提取
      await this.testBilibiliExtraction();

      // 2. 测试FFmpeg音频处理
      await this.testFFmpegProcessing();

      // 3. 测试Discord音频播放器
      await this.testDiscordPlayer();

      // 4. 测试完整集成
      await this.testFullIntegration();

      this.printResults();
      return this.results;
    } catch (error) {
      console.error("❌ 集成测试失败:", error.message);
      return this.results;
    }
  }

  async testBilibiliExtraction() {
    console.log("1. 🌐 测试B站音频提取...");

    try {
      const extractor = new BilibiliExtractor();
      const videoData = await extractor.extractAudio(this.testUrl);

      if (videoData && videoData.audioUrl) {
        console.log("   ✅ 音频URL提取成功");
        console.log(`   📊 标题: ${videoData.title}`);
        console.log(`   ⏱️  时长: ${videoData.duration}秒`);
        console.log(`   🔗 URL长度: ${videoData.audioUrl.length}字符`);

        this.results.extraction = {
          success: true,
          data: videoData,
          error: null,
        };
      } else {
        throw new Error("音频URL为空或无效");
      }
    } catch (error) {
      console.log(`   ❌ 提取失败: ${error.message}`);
      this.results.extraction = {
        success: false,
        error: error.message,
      };
    }
  }

  async testFFmpegProcessing() {
    console.log("\n2. 🛠️ 测试FFmpeg音频处理...");

    if (!this.results.extraction.success) {
      console.log("   ⏭️  跳过FFmpeg测试（依赖音频URL）");
      return;
    }

    try {
      const audioUrl = this.results.extraction.data.audioUrl;

      const result = await new Promise((resolve, reject) => {
        const ffmpegProcess = spawn("ffmpeg", [
          "-user_agent",
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "-referer",
          "https://www.bilibili.com/",
          "-i",
          audioUrl,
          "-f",
          "opus",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-b:a",
          "128k",
          "-vn",
          "-t",
          "3", // 只处理3秒
          "-loglevel",
          "warning",
          "pipe:1",
        ]);

        let outputSize = 0;
        let errorOutput = "";

        ffmpegProcess.stdout.on("data", (chunk) => {
          outputSize += chunk.length;
        });

        ffmpegProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        ffmpegProcess.on("error", (error) => {
          reject(new Error(`FFmpeg进程错误: ${error.message}`));
        });

        ffmpegProcess.on("close", (code) => {
          if (code === 0 && outputSize > 0) {
            resolve({ outputSize, errorOutput });
          } else {
            reject(
              new Error(
                `FFmpeg失败 - 退出码: ${code}, 输出大小: ${outputSize}, 错误: ${errorOutput.substring(
                  0,
                  200
                )}`
              )
            );
          }
        });
      });

      console.log(`   ✅ FFmpeg处理成功`);
      console.log(`   📊 输出数据: ${result.outputSize} 字节`);
      if (result.errorOutput) {
        console.log(
          `   ⚠️  警告信息: ${result.errorOutput.substring(0, 100)}...`
        );
      }

      this.results.ffmpeg = {
        success: true,
        outputSize: result.outputSize,
        error: null,
      };
    } catch (error) {
      console.log(`   ❌ FFmpeg处理失败: ${error.message}`);
      this.results.ffmpeg = {
        success: false,
        error: error.message,
      };
    }
  }

  async testDiscordPlayer() {
    console.log("\n3. 🎮 测试Discord音频播放器...");

    if (!this.results.ffmpeg.success) {
      console.log("   ⏭️  跳过Discord播放器测试（依赖FFmpeg）");
      return;
    }

    try {
      const player = createAudioPlayer();
      console.log(`   📊 初始状态: ${player.state.status}`);

      // 监听状态变化
      const statusTest = await new Promise((resolve) => {
        const statusChanges = [];
        let timeoutId;

        const cleanup = () => {
          if (timeoutId) clearTimeout(timeoutId);
          player.removeAllListeners();
        };

        player.on(AudioPlayerStatus.Playing, () => {
          statusChanges.push("Playing");
          console.log("   🎵 状态: Playing");
        });

        player.on(AudioPlayerStatus.Idle, () => {
          statusChanges.push("Idle");
          console.log("   ⏸️ 状态: Idle");
        });

        player.on("error", (error) => {
          statusChanges.push(`Error: ${error.message}`);
          console.log(`   ❌ 播放器错误: ${error.message}`);
        });

        // 创建测试音频流
        const audioUrl = this.results.extraction.data.audioUrl;
        const testStream = spawn("ffmpeg", [
          "-user_agent",
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "-referer",
          "https://www.bilibili.com/",
          "-i",
          audioUrl,
          "-f",
          "opus",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-b:a",
          "128k",
          "-vn",
          "-t",
          "3",
          "-loglevel",
          "error",
          "pipe:1",
        ]);

        const audioResource = createAudioResource(testStream.stdout, {
          inputType: StreamType.Opus,
        });

        console.log("   🎧 开始播放测试...");
        player.play(audioResource);

        // 4秒后检查结果
        timeoutId = setTimeout(() => {
          cleanup();
          resolve({
            statusChanges,
            finalStatus: player.state.status,
            success: statusChanges.includes("Playing"),
          });
        }, 4000);
      });

      if (statusTest.success) {
        console.log(`   ✅ 播放器测试成功`);
        console.log(`   📈 状态历史: ${statusTest.statusChanges.join(" -> ")}`);
        this.results.discord = {
          success: true,
          statusChanges: statusTest.statusChanges,
          error: null,
        };
      } else {
        throw new Error(
          `播放器未进入Playing状态。状态历史: ${statusTest.statusChanges.join(
            " -> "
          )}`
        );
      }
    } catch (error) {
      console.log(`   ❌ Discord播放器测试失败: ${error.message}`);
      this.results.discord = {
        success: false,
        error: error.message,
      };
    }
  }

  async testFullIntegration() {
    console.log("\n4. 🔄 测试完整集成流程...");

    const allSuccess =
      this.results.extraction.success &&
      this.results.ffmpeg.success &&
      this.results.discord.success;

    if (allSuccess) {
      console.log("   ✅ 所有组件单独测试通过");

      // 这里可以添加更复杂的集成测试
      // 比如测试实际的Discord语音连接
      console.log(
        "   ⚠️  注意：实际Discord语音连接需要bot在语音频道中才能测试"
      );

      this.results.integration = {
        success: true,
        note: "组件级测试通过，需要实际Discord环境验证",
        error: null,
      };
    } else {
      const failedComponents = [];
      if (!this.results.extraction.success) failedComponents.push("音频提取");
      if (!this.results.ffmpeg.success) failedComponents.push("FFmpeg处理");
      if (!this.results.discord.success) failedComponents.push("Discord播放器");

      console.log(`   ❌ 集成失败，问题组件: ${failedComponents.join(", ")}`);
      this.results.integration = {
        success: false,
        error: `依赖组件失败: ${failedComponents.join(", ")}`,
        failedComponents,
      };
    }
  }

  printResults() {
    console.log("\n📊 播放集成测试结果汇总:");
    console.log("===============================");

    Object.entries(this.results).forEach(([component, result]) => {
      const icon = result.success ? "✅" : "❌";
      const name = {
        extraction: "B站音频提取",
        ffmpeg: "FFmpeg处理",
        discord: "Discord播放器",
        integration: "完整集成",
      }[component];

      console.log(`${icon} ${name}: ${result.success ? "通过" : "失败"}`);
      if (!result.success && result.error) {
        console.log(`   错误: ${result.error}`);
      }
    });

    // 提供修复建议
    console.log("\n💡 修复建议:");
    if (!this.results.extraction.success) {
      console.log("• 检查网络连接和B站URL访问");
      console.log("• 验证yt-dlp安装和版本");
    }
    if (!this.results.ffmpeg.success) {
      console.log("• 检查FFmpeg安装");
      console.log("• 验证防盗链header设置");
    }
    if (!this.results.discord.success) {
      console.log("• 检查Discord.js版本兼容性");
      console.log("• 验证音频资源格式");
    }
    if (!this.results.integration.success && this.results.discord.success) {
      console.log("• 检查语音连接订阅逻辑");
      console.log("• 验证bot权限设置");
    }
  }
}

// 如果直接运行
if (require.main === module) {
  const test = new PlaybackIntegrationTest();
  test
    .runAll()
    .then(() => {
      console.log("\n🎯 集成测试完成");
      // 强制退出，确保所有异步操作结束
      process.exit(0);
    })
    .catch((error) => {
      console.error("测试执行失败:", error);
      process.exit(1);
    });
}

module.exports = PlaybackIntegrationTest;
