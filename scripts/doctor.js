#!/usr/bin/env node

const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const MIN_YTDLP_VERSION = "2026.01.01";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    values[key] = value;
  }
  return values;
}

function commandExists(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function commandOutput(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function compareYtDlpVersions(a, b) {
  const parse = (value) => String(value || "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function evaluateYtDlpEnvironment({ installed, version = "", helpText = "" }) {
  const warnings = [];
  const notes = [];

  if (!installed) {
    warnings.push("yt-dlp is not installed locally. Docker installs yt-dlp[default] and is the recommended YouTube playback path.");
    return { warnings, notes };
  }

  const trimmedVersion = String(version).trim();
  if (trimmedVersion) {
    notes.push(`yt-dlp version: ${trimmedVersion}`);
    if (compareYtDlpVersions(trimmedVersion, MIN_YTDLP_VERSION) < 0) {
      warnings.push(`yt-dlp is older than ${MIN_YTDLP_VERSION}. Rebuild Docker or upgrade yt-dlp for more reliable YouTube extraction.`);
    }
  } else {
    warnings.push("Could not read yt-dlp version.");
  }

  if (!helpText.includes("--js-runtimes")) {
    warnings.push("yt-dlp does not report --js-runtimes support. Docker installs yt-dlp[default] with the JS solver expected by YouTube extraction.");
  }

  return { warnings, notes };
}

function collectYtDlpEnvironment() {
  const version = commandOutput("yt-dlp", ["--version"]);
  if (!version.ok) {
    return { installed: false };
  }
  const help = commandOutput("yt-dlp", ["--help"]);
  return {
    installed: true,
    version: version.stdout.trim(),
    helpText: `${help.stdout}\n${help.stderr}`,
  };
}

function checkPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function main() {
  const errors = [];
  const warnings = [];
  const notes = [];

  const envPath = path.join(root, ".env");
  const envExamplePath = path.join(root, ".env.example");
  const env = readEnvFile(envPath);

  if (!fs.existsSync(envPath)) {
    errors.push(".env is missing. Run: cp .env.example .env");
  }

  if (!fs.existsSync(envExamplePath)) {
    errors.push(".env.example is missing.");
  }

  for (const key of ["DISCORD_TOKEN", "CLIENT_ID"]) {
    if (!env[key]) {
      errors.push(`${key} is missing in .env`);
    }
  }

  if (!commandExists("docker")) {
    errors.push("Docker is not installed or not on PATH.");
  }

  if (!commandExists("docker", ["compose", "version"])) {
    errors.push("Docker Compose plugin is not available. Expected: docker compose version");
  }

  for (const dir of ["data", "logs", "secrets"]) {
    const fullPath = path.join(root, dir);
    if (!fs.existsSync(fullPath)) {
      warnings.push(`${dir}/ does not exist yet. Docker will create it, or you can run: mkdir -p ${dir}`);
    }
  }

  if (!fs.existsSync(path.join(root, "secrets", "youtube_cookies.txt"))) {
    warnings.push("secrets/youtube_cookies.txt is missing. The bot will try automatic YouTube cookie export in Docker.");
  }

  if (!fs.existsSync(path.join(root, "secrets", "cookies.txt"))) {
    notes.push("secrets/cookies.txt is missing. Bilibili usually works without it, but cloud IPs may need cookies.");
  }

  const ytDlpEnvironment = evaluateYtDlpEnvironment(collectYtDlpEnvironment());
  notes.push(...ytDlpEnvironment.notes);
  warnings.push(...ytDlpEnvironment.warnings);

  const metricsPort = Number(env.METRICS_PORT || 9090);
  if (Number.isInteger(metricsPort) && metricsPort > 0) {
    const free = await checkPortFree(metricsPort);
    if (!free) {
      warnings.push(`Port ${metricsPort} is already in use on 127.0.0.1. Docker health/metrics may conflict.`);
    }
  }

  console.log("F.M. Hachimi setup check");
  console.log("=======================");
  for (const note of notes) console.log(`info: ${note}`);
  for (const warning of warnings) console.log(`warn: ${warning}`);
  for (const error of errors) console.log(`error: ${error}`);

  if (errors.length > 0) {
    console.log("\nFix the errors above, then run npm run setup:check again.");
    process.exit(1);
  }

  console.log("\nSetup checks passed. Next: npm run docker:up");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  readEnvFile,
  commandExists,
  commandOutput,
  compareYtDlpVersions,
  evaluateYtDlpEnvironment,
  checkPortFree,
};
