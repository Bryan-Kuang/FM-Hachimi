#!/usr/bin/env node

/**
 * Playback Debug Script
 * 专门用于调试音频播放问题
 */

const AudioManager = require("./src/audio/manager");
const BilibiliExtractor = require("./src/audio/extractor");

async function debugPlayback() {
  console.log("🔍 开始播放调试...\n");

  try {
    // 1. 测试音频提取
    console.log("📥 1. 测试Bilibili音频提取...");
    const extractor = new BilibiliExtractor();
    const testUrl = "https://www.bilibili.com/video/BV1uv4y1q7Mv";

    const videoData = await extractor.extractAudio(testUrl);
    console.log("✅ 音频提取成功:");
    console.log(`   标题: ${videoData.title}`);
    console.log(`   时长: ${videoData.duration}秒`);
    console.log(`   音频URL: ${videoData.audioUrl ? "✅ 可用" : "❌ 缺失"}\n`);

    // 2. 测试FFmpeg
    console.log("🛠️ 2. 测试FFmpeg可用性...");
    const { spawn } = require("child_process");

    const ffmpegTest = new Promise((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", ["-version"]);

      ffmpeg.on("error", (error) => {
        reject(new Error(`FFmpeg不可用: ${error.message}`));
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve("FFmpeg可用");
        } else {
          reject(new Error(`FFmpeg退出码: ${code}`));
        }
      });
    });

    try {
      const ffmpegResult = await ffmpegTest;
      console.log(`✅ ${ffmpegResult}\n`);
    } catch (error) {
      console.log(`❌ ${error.message}\n`);
      return;
    }

    // 3. 测试音频资源创建
    console.log("🎵 3. 测试音频资源创建...");

    const audioTest = new Promise((resolve, reject) => {
      const ffmpegProcess = spawn("ffmpeg", [
        "-user_agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "-referer",
        "https://www.bilibili.com/",
        "-i",
        videoData.audioUrl,
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
        "2", // 只测试2秒
        "-loglevel",
        "error",
        "pipe:1",
      ]);

      let hasOutput = false;

      ffmpegProcess.stdout.on("data", (chunk) => {
        hasOutput = true;
        console.log(`   收到音频数据: ${chunk.length} 字节`);
      });

      ffmpegProcess.stderr.on("data", (data) => {
        console.log(`   FFmpeg stderr: ${data.toString()}`);
      });

      ffmpegProcess.on("error", (error) => {
        reject(new Error(`音频处理失败: ${error.message}`));
      });

      ffmpegProcess.on("close", (code) => {
        if (code === 0 && hasOutput) {
          resolve("音频资源创建成功");
        } else {
          reject(
            new Error(`音频处理失败，退出码: ${code}, 是否有输出: ${hasOutput}`)
          );
        }
      });
    });

    try {
      const audioResult = await audioTest;
      console.log(`✅ ${audioResult}\n`);
    } catch (error) {
      console.log(`❌ ${error.message}\n`);
      return;
    }

    // 4. 检查Discord.js音频组件
    console.log("🎮 4. 测试Discord.js音频组件...");
    try {
      const {
        createAudioPlayer,
        createAudioResource,
        StreamType,
      } = require("@discordjs/voice");

      const player = createAudioPlayer();
      console.log("✅ 音频播放器创建成功");
      console.log(`   播放器状态: ${player.state.status}`);

      // 测试空的音频资源创建
      const testStream = require("stream").Readable.from(["test"]);
      const resource = createAudioResource(testStream, {
        inputType: StreamType.Arbitrary,
      });
      console.log("✅ 音频资源接口正常\n");
    } catch (error) {
      console.log(`❌ Discord.js音频组件错误: ${error.message}\n`);
      return;
    }

    console.log("🎉 所有测试通过！音频播放基础功能正常。\n");

    console.log("🔍 可能的问题：");
    console.log("1. 音频播放器状态同步问题");
    console.log("2. 进度更新机制缺失");
    console.log("3. 按钮交互处理问题");
    console.log("4. 语音连接订阅问题");
  } catch (error) {
    console.error("❌ 调试过程中出现错误:", error.message);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  debugPlayback();
}

module.exports = debugPlayback;
