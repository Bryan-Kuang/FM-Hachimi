/**
 * YouTubeExtractor.listPlaylistItems (Task 2.5) — flat-playlist listing used
 * by the bulk-enqueue playlist path.
 */

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
const YouTubeExtractor = require("../../src/youtube/extractor");

function entryJson(id, title, extra = {}) {
  return JSON.stringify({
    id,
    title,
    duration: 200,
    uploader: "Some Channel",
    playlist_title: "My Playlist",
    playlist_count: 3,
    ...extra,
  });
}

describe("YouTubeExtractor.listPlaylistItems", () => {
  let extractor;

  beforeEach(() => {
    jest.clearAllMocks();
    extractor = new YouTubeExtractor();
  });

  afterEach(() => {
    extractor.destroy();
  });

  test("parses multi-line stdout, skips deleted entries, extracts playlist_title", async () => {
    const stdout = [
      entryJson("vid1", "Track One"),
      entryJson("vid2", "[Deleted video]"),
      entryJson("vid3", "Track Three"),
    ].join("\n");
    spawn.mockImplementation(() => createMockProcess({ stdout, exitCode: 0 }));

    const result = await extractor.listPlaylistItems("https://www.youtube.com/playlist?list=PLxyz", 100);

    expect(result.success).toBe(true);
    expect(result.playlistTitle).toBe("My Playlist");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({
      id: "vid1",
      title: "Track One",
      duration: 200,
      uploader: "Some Channel",
      url: "https://www.youtube.com/watch?v=vid1",
    });
    expect(result.entries[1].id).toBe("vid3");
  });

  test("skips [Private video] entries", async () => {
    const stdout = [
      entryJson("vid1", "[Private video]"),
      entryJson("vid2", "Visible Track"),
    ].join("\n");
    spawn.mockImplementation(() => createMockProcess({ stdout, exitCode: 0 }));

    const result = await extractor.listPlaylistItems("https://www.youtube.com/playlist?list=PLxyz", 100);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe("vid2");
  });

  test("never trusts entry.url — always builds the canonical watch URL from id", async () => {
    const stdout = JSON.stringify({
      id: "vid9",
      title: "Weird URL Entry",
      url: "https://youtube.com/some/other/shape",
      duration: 10,
    });
    spawn.mockImplementation(() => createMockProcess({ stdout, exitCode: 0 }));

    const result = await extractor.listPlaylistItems("https://www.youtube.com/playlist?list=PLxyz", 100);

    expect(result.entries[0].url).toBe("https://www.youtube.com/watch?v=vid9");
  });

  test("argv includes --flat-playlist --dump-json --playlist-end <limit>", async () => {
    spawn.mockImplementation(() => createMockProcess({ stdout: "", exitCode: 0 }));

    await extractor.listPlaylistItems("https://www.youtube.com/playlist?list=PLxyz", 100);

    const args = spawn.mock.calls[0][1];
    expect(args).toContain("--flat-playlist");
    expect(args).toContain("--dump-json");
    expect(args[args.indexOf("--playlist-end") + 1]).toBe("100");
    expect(args[0]).toBe("https://www.youtube.com/playlist?list=PLxyz");
  });

  test("nonzero exit code resolves success: false", async () => {
    spawn.mockImplementation(() => createMockProcess({ stderr: "ERROR: playlist unavailable", exitCode: 1 }));

    const result = await extractor.listPlaylistItems("https://www.youtube.com/playlist?list=PLxyz", 100);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Playlist listing failed/);
  });

  test("empty stdout resolves success:true with an empty entries array", async () => {
    spawn.mockImplementation(() => createMockProcess({ stdout: "", exitCode: 0 }));

    const result = await extractor.listPlaylistItems("https://www.youtube.com/playlist?list=PLxyz", 100);

    expect(result.success).toBe(true);
    expect(result.entries).toEqual([]);
  });
});
