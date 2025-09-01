#!/usr/bin/env node

/**
 * Real Playback Debug - 实际播放问题调试
 * 专门调试Discord音频播放器状态问题
 */

const {
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const { spawn } = require("child_process");

async function debugRealPlayback() {
  console.log("🎯 开始实际播放问题调试...\n");

  // 1. 测试音频资源创建（使用完整的B站流程）
  console.log("1. 🎵 测试完整的B站音频资源创建...");

  const BilibiliExtractor = require("./src/audio/extractor");
  const extractor = new BilibiliExtractor();

  try {
    // 获取音频数据
    const videoData = await extractor.extractAudio(
      "https://www.bilibili.com/video/BV1uv4y1q7Mv"
    );
    console.log(
      `   ✅ 音频URL获取成功: ${videoData.audioUrl ? "有效" : "无效"}`
    );

    // 2. 测试FFmpeg处理
    console.log("\n2. 🛠️ 测试FFmpeg音频处理...");

    const ffmpegPromise = new Promise((resolve, reject) => {
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
        "5", // 只处理5秒
        "-loglevel",
        "error",
        "pipe:1",
      ]);

      let outputReceived = false;
      let errorOutput = "";

      ffmpegProcess.stdout.on("data", (chunk) => {
        outputReceived = true;
        console.log(`   📡 FFmpeg输出: ${chunk.length} 字节`);
      });

      ffmpegProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      ffmpegProcess.on("error", (error) => {
        reject(new Error(`FFmpeg进程错误: ${error.message}`));
      });

      ffmpegProcess.on("close", (code) => {
        if (outputReceived && code === 0) {
          resolve("FFmpeg处理成功");
        } else {
          reject(
            new Error(
              `FFmpeg失败 - 代码: ${code}, 错误: ${errorOutput}, 有输出: ${outputReceived}`
            )
          );
        }
      });
    });

    const ffmpegResult = await ffmpegPromise;
    console.log(`   ✅ ${ffmpegResult}`);

    // 3. 测试Discord音频播放器
    console.log("\n3. 🎮 测试Discord音频播放器...");

    const player = createAudioPlayer();
    console.log(`   📊 初始播放器状态: ${player.state.status}`);

    // 监听播放器状态变化
    const statusPromise = new Promise((resolve) => {
      let statusChanges = [];

      player.on(AudioPlayerStatus.Playing, () => {
        statusChanges.push("Playing");
        console.log("   🎵 播放器状态: Playing");
      });

      player.on(AudioPlayerStatus.Idle, () => {
        statusChanges.push("Idle");
        console.log("   ⏸️ 播放器状态: Idle");
      });

      player.on("error", (error) => {
        statusChanges.push(`Error: ${error.message}`);
        console.log(`   ❌ 播放器错误: ${error.message}`);
      });

      // 5秒后检查状态
      setTimeout(() => {
        resolve(statusChanges);
      }, 6000);
    });

    // 创建音频资源并播放
    const testStream = spawn("ffmpeg", [
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
      "5",
      "-loglevel",
      "error",
      "pipe:1",
    ]);

    const audioResource = createAudioResource(testStream.stdout, {
      inputType: StreamType.Opus,
    });

    console.log("   🎧 开始播放测试...");
    player.play(audioResource);

    const statusChanges = await statusPromise;
    console.log(`   📈 状态变化历史: ${statusChanges.join(" -> ")}`);

    if (statusChanges.includes("Playing")) {
      console.log("\n🎉 播放器测试成功！音频播放正常。");
      console.log("\n🔍 问题可能在于：");
      console.log("1. 语音连接订阅问题");
      console.log("2. Discord网关连接问题");
      console.log("3. 音频播放器状态同步问题");
    } else {
      console.log("\n❌ 播放器测试失败！");
      console.log("🔍 问题可能在于：");
      console.log("1. 音频资源格式不兼容");
      console.log("2. FFmpeg输出格式问题");
      console.log("3. Discord.js版本兼容性问题");
    }
  } catch (error) {
    console.error(`\n❌ 调试失败: ${error.message}`);
  }
}

// 如果直接运行
if (require.main === module) {
  debugRealPlayback();
}

module.exports = debugRealPlayback;
