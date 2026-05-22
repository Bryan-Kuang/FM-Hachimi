#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const { spawnSync } = require("child_process");

const DEFAULT_BILIBILI_URL = "https://www.bilibili.com/video/BV1JuhNz6Eg6";
const DEFAULT_YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const YOUTUBE_AUDIO_FORMAT_SELECTOR =
  "bestaudio[vcodec=none][protocol^=http][acodec!=none]/bestaudio[vcodec=none][acodec!=none]/best[height<=360][protocol^=http][acodec!=none]/best[height<=360][protocol=m3u8_native][acodec!=none]/best[height<=360][acodec!=none]/worst[acodec!=none]";

function selectedFormat(videoData) {
  const selected = (videoData.requested_downloads && videoData.requested_downloads[0]) || videoData;
  return {
    formatId: selected.format_id || videoData.format_id || null,
    protocol: selected.protocol || videoData.protocol || null,
    audioCodec: selected.acodec || videoData.acodec || null,
    videoCodec: selected.vcodec || videoData.vcodec || null,
  };
}

function runYtDlp(args) {
  const startedAt = performance.now();
  const result = spawnSync("yt-dlp", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    result,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

function copyCookieFileIfPresent() {
  const source = path.join(process.cwd(), "youtube_cookies.txt");
  if (!fs.existsSync(source)) return null;
  const destination = path.join(
    os.tmpdir(),
    `yt-bench-cookies-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
  );
  fs.copyFileSync(source, destination);
  return destination;
}

function benchmark({ name, url, format, extraArgs = [] }) {
  const { result, elapsedMs } = runYtDlp([
    ...extraArgs,
    "--dump-json",
    "--format", format,
    "--no-download",
    "--no-check-certificate",
    "--no-warnings",
    url,
  ]);

  if (result.status !== 0) {
    return {
      name,
      success: false,
      elapsedMs,
      error: (result.stderr || result.stdout || `yt-dlp exited with ${result.status}`).trim().slice(0, 300),
    };
  }

  const jsonLine = result.stdout.split(/\r?\n/).find((line) => line.trim().startsWith("{"));
  if (!jsonLine) {
    return {
      name,
      success: false,
      elapsedMs,
      error: "yt-dlp did not emit JSON",
    };
  }

  const videoData = JSON.parse(jsonLine);
  return {
    name,
    success: true,
    elapsedMs,
    cacheHit: false,
    ...selectedFormat(videoData),
  };
}

function printResult(result) {
  console.log(`${result.name}:`);
  console.log(`  success: ${result.success}`);
  console.log(`  elapsedMs: ${result.elapsedMs}`);
  if (!result.success) {
    console.log(`  error: ${result.error}`);
    return;
  }
  console.log(`  cacheHit: ${result.cacheHit}`);
  console.log(`  formatId: ${result.formatId || "unknown"}`);
  console.log(`  protocol: ${result.protocol || "unknown"}`);
  console.log(`  audioCodec: ${result.audioCodec || "unknown"}`);
  console.log(`  videoCodec: ${result.videoCodec || "unknown"}`);
}

function main() {
  const bilibiliUrl = process.argv[2] || DEFAULT_BILIBILI_URL;
  const youtubeUrl = process.argv[3] || DEFAULT_YOUTUBE_URL;
  const cookieCopy = copyCookieFileIfPresent();

  try {
    const results = [
      benchmark({
        name: "bilibili",
        url: bilibiliUrl,
        format: "bestaudio/best",
      }),
      benchmark({
        name: "youtube",
        url: youtubeUrl,
        format: YOUTUBE_AUDIO_FORMAT_SELECTOR,
        extraArgs: cookieCopy ? ["--cookies", cookieCopy] : [],
      }),
    ];

    console.log("Extractor benchmark");
    console.log("===================");
    console.log("Signed media URLs and cookie contents are intentionally not printed.");
    for (const result of results) {
      printResult(result);
    }

    if (results.some((result) => !result.success)) {
      process.exitCode = 1;
    }
  } finally {
    if (cookieCopy) {
      try { fs.unlinkSync(cookieCopy); } catch { /* best effort */ }
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { YOUTUBE_AUDIO_FORMAT_SELECTOR, benchmark, selectedFormat };
