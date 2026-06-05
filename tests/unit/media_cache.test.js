jest.mock("axios");
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const axios = require("axios");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const MediaCache = require("../../src/audio/media_cache");

function mockDownload(buf) {
  // Fresh Readable per call — a stream can only be consumed once (real axios
  // returns a new response stream each request).
  axios.get.mockImplementation(() => Promise.resolve({ data: Readable.from([buf]) }));
}

describe("MediaCache", () => {
  let dir;

  beforeEach(() => {
    jest.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mediacache-"));
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test("put downloads + indexes; get returns the local path; headers + meta preserved", async () => {
    mockDownload(Buffer.from("audio-bytes"));
    const cache = new MediaCache({ dir, maxEntries: 10, maxBytes: 1e6 });

    expect(cache.get("vid1")).toBeNull();
    cache.put("vid1", "https://cdn/a.m4a", { referer: "https://www.youtube.com", userAgent: "UA" }, { title: "Song" });
    await cache.drain();

    const p = cache.get("vid1");
    expect(p).not.toBeNull();
    expect(fs.readFileSync(p, "utf8")).toBe("audio-bytes");
    expect(cache.getEntry("vid1").meta).toEqual({ title: "Song" });
    expect(axios.get).toHaveBeenCalledWith("https://cdn/a.m4a", expect.objectContaining({
      responseType: "stream",
      headers: expect.objectContaining({ Referer: "https://www.youtube.com", "User-Agent": "UA" }),
    }));
  });

  test("skips HLS/DASH manifest URLs (not direct media)", async () => {
    const cache = new MediaCache({ dir, maxEntries: 10, maxBytes: 1e6 });
    cache.put("vid", "https://cdn/playlist.m3u8?x=1");
    await cache.drain();
    expect(axios.get).not.toHaveBeenCalled();
    expect(cache.get("vid")).toBeNull();
  });

  test("disabled cache is a no-op", async () => {
    mockDownload(Buffer.from("x"));
    const cache = new MediaCache({ dir, maxEntries: 10, maxBytes: 1e6, enabled: false });
    cache.put("vid", "https://cdn/a.m4a");
    await cache.drain();
    expect(axios.get).not.toHaveBeenCalled();
    expect(cache.get("vid")).toBeNull();
  });

  test("evicts least-recently-used over the entry-count cap", async () => {
    mockDownload(Buffer.from("aaa"));
    const cache = new MediaCache({ dir, maxEntries: 2, maxBytes: 1e9 });

    cache.put("a", "https://cdn/a.m4a"); await cache.drain();
    cache.put("b", "https://cdn/b.m4a"); await cache.drain();
    cache.get("a"); // bump a → b is now least-recently-used
    cache.put("c", "https://cdn/c.m4a"); await cache.drain();

    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")).not.toBeNull();
    expect(cache.get("c")).not.toBeNull();
  });

  test("evicts over the total-bytes cap", async () => {
    axios.get.mockImplementation(() => Promise.resolve({ data: Readable.from([Buffer.alloc(6, 1)]) }));
    const cache = new MediaCache({ dir, maxEntries: 100, maxBytes: 10 });

    cache.put("a", "https://cdn/a.m4a"); await cache.drain();
    cache.put("b", "https://cdn/b.m4a"); await cache.drain(); // 12 bytes > 10 → evict a

    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).not.toBeNull();
  });

  test("persists the index across instances", async () => {
    mockDownload(Buffer.from("data"));
    const first = new MediaCache({ dir, maxEntries: 10, maxBytes: 1e6 });
    first.put("vid", "https://cdn/a.m4a", undefined, { title: "T" });
    await first.drain();

    const second = new MediaCache({ dir, maxEntries: 10, maxBytes: 1e6 });
    expect(second.get("vid")).not.toBeNull();
    expect(second.getEntry("vid").meta).toEqual({ title: "T" });
  });

  test("boot reconcile drops missing-file entries and deletes orphan files", async () => {
    mockDownload(Buffer.from("data"));
    const first = new MediaCache({ dir, maxEntries: 10, maxBytes: 1e6 });
    first.put("vid", "https://cdn/a.m4a"); await first.drain();
    fs.unlinkSync(first.get("vid"));                 // cached file vanishes
    fs.writeFileSync(path.join(dir, "orphan.m4a"), "junk");

    const second = new MediaCache({ dir, maxEntries: 10, maxBytes: 1e6 });
    expect(second.get("vid")).toBeNull();            // stale entry dropped
    expect(fs.existsSync(path.join(dir, "orphan.m4a"))).toBe(false); // orphan cleaned
  });
});
