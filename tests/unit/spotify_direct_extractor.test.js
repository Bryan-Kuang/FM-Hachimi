/**
 * SpotifyDirectExtractor (Project B) — spawns the librespot-family sidecar
 * (zotify) per track. Uses a real temp directory for cacheDir/credentialsDir
 * (simpler and more faithful than mocking `fs` for a class whose whole job
 * is reading a real directory back) and mocks only `child_process.spawn`,
 * mirroring youtube_extractor_playlist.test.js's mock_spawn convention. The
 * mocked spawn implementation writes the "downloaded" file itself to
 * simulate the sidecar's real side effect.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createMockProcess } = require("../utils/mock_spawn");

jest.mock("child_process", () => ({
  spawn: jest.fn(),
  execFile: jest.fn(),
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { spawn } = require("child_process");
const SpotifyDirectExtractor = require("../../src/spotify/direct_extractor");

describe("SpotifyDirectExtractor", () => {
  let tmpDir;
  let credentialsDir;
  let cacheDir;
  let extractor;

  beforeEach(() => {
    jest.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spotify-direct-test-"));
    credentialsDir = path.join(tmpDir, "creds");
    cacheDir = path.join(tmpDir, "cache");
    fs.mkdirSync(credentialsDir, { recursive: true });
    extractor = new SpotifyDirectExtractor({
      credentialsDir,
      cacheDir,
      sidecarCommand: "zotify",
      timeoutMs: 5000,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("isConfigured", () => {
    test("false when credentials.json is absent", () => {
      expect(extractor.isConfigured()).toBe(false);
    });

    test("true once credentials.json exists", () => {
      fs.writeFileSync(path.join(credentialsDir, "credentials.json"), "{}");
      expect(extractor.isConfigured()).toBe(true);
    });
  });

  describe("extractAudio", () => {
    test("happy path: spawns the sidecar and returns cached:true with the produced local path", async () => {
      spawn.mockImplementation(() => {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, "track123.ogg"), "fake-audio-bytes");
        return createMockProcess({ exitCode: 0 });
      });

      const result = await extractor.extractAudio("track123", { title: "Some Song", durationSec: 200 });

      expect(spawn).toHaveBeenCalledWith(
        "zotify",
        expect.arrayContaining([
          "--creds", credentialsDir,
          "--root-path", cacheDir,
          "--output-single", "{id}",
          "https://open.spotify.com/track/track123",
        ]),
      );
      expect(result).toEqual({
        title: "Some Song",
        audioUrl: path.join(cacheDir, "track123.ogg"),
        duration: 200,
        cached: true,
        extractedAt: expect.any(String),
      });
    });

    test("cache hit: a pre-existing file skips spawning the sidecar entirely", async () => {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, "track999.m4a"), "already-here");

      const result = await extractor.extractAudio("track999", { title: "Cached Song" });

      expect(spawn).not.toHaveBeenCalled();
      expect(result.audioUrl).toBe(path.join(cacheDir, "track999.m4a"));
      expect(result.cached).toBe(true);
    });

    test("nonzero exit code rejects with the sidecar's stderr", async () => {
      spawn.mockImplementation(() => createMockProcess({
        exitCode: 1,
        stderr: "ERROR: track not available in this market",
      }));

      await expect(extractor.extractAudio("track404", { title: "Missing" }))
        .rejects.toThrow(/exited with code 1/);
    });

    test("exit code 0 but no output file rejects", async () => {
      spawn.mockImplementation(() => createMockProcess({ exitCode: 0 }));

      await expect(extractor.extractAudio("trackGhost", { title: "Ghost" }))
        .rejects.toThrow(/no output file/);
    });

    test("timeout kills the process and rejects", async () => {
      jest.useFakeTimers();
      const kill = jest.fn();
      spawn.mockImplementation(() => {
        const { EventEmitter } = require("events");
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.killed = false;
        proc.kill = kill;
        // Never emits 'close' — simulates a hung sidecar.
        return proc;
      });

      const shortExtractor = new SpotifyDirectExtractor({
        credentialsDir,
        cacheDir,
        sidecarCommand: "zotify",
        timeoutMs: 1000,
      });

      const promise = shortExtractor.extractAudio("trackHang", { title: "Hangs" });
      const assertion = expect(promise).rejects.toThrow(/timeout/i);
      jest.advanceTimersByTime(1000);
      await assertion;
      expect(kill).toHaveBeenCalledWith("SIGTERM");
      jest.useRealTimers();
    });

    test("rejects when no track id is given", async () => {
      await expect(extractor.extractAudio("", { title: "No id" }))
        .rejects.toThrow(/requires a track id/);
      expect(spawn).not.toHaveBeenCalled();
    });

    test("process spawn error rejects with a descriptive message", async () => {
      spawn.mockImplementation(() => createMockProcess({ error: new Error("ENOENT") }));

      await expect(extractor.extractAudio("trackErr", { title: "Errs" }))
        .rejects.toThrow(/Spotify sidecar process error/);
    });
  });
});
