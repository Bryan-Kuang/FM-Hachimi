const fs = require("fs");
const os = require("os");
const path = require("path");
const { createMockProcess } = require("../utils/mock_spawn");

jest.mock("child_process", () => ({
  spawn: jest.fn(),
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { spawn } = require("child_process");
const logger = require("../../src/services/logger_service");
const YouTubeCookieRefreshService = require("../../src/youtube/cookie_refresh_service");

describe("YouTubeCookieRefreshService", () => {
  let root;
  let tmpRoot;
  let cookieFile;
  let profileDir;

  beforeEach(() => {
    jest.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "yt-cookie-refresh-test-"));
    tmpRoot = path.join(root, "tmp");
    cookieFile = path.join(root, "youtube_cookies.txt");
    profileDir = path.join(root, "profile");
    fs.mkdirSync(tmpRoot);
    fs.mkdirSync(profileDir);
    fs.writeFileSync(cookieFile, "old-cookie-content\n", { mode: 0o600 });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function service() {
    return new YouTubeCookieRefreshService({
      enabled: true,
      cookiesFile: cookieFile,
      browserSpec: `chrome+basictext:${profileDir}`,
      validateUrls: [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=AUfXW1EdLew",
      ],
      refreshIntervalMs: 0,
      cooldownMs: 0,
      tmpDir: tmpRoot,
    });
  }

  test("validates candidate cookies before overwriting the live file in place", async () => {
    const beforeInode = fs.statSync(cookieFile).ino;
    const liveContentsSeenDuringValidation = [];

    spawn.mockImplementation((command, args) => {
      const cookieArgIndex = args.indexOf("--cookies");
      const candidate = args[cookieArgIndex + 1];

      if (args.includes("--cookies-from-browser")) {
        fs.appendFileSync(candidate, ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\tnew-secret-cookie\n");
        return createMockProcess({ exitCode: 0 });
      }

      liveContentsSeenDuringValidation.push(fs.readFileSync(cookieFile, "utf8"));
      return createMockProcess({ stdout: "dQw4w9WgXcQ\n", exitCode: 0 });
    });

    const result = await service().refreshNow({ reason: "test" });

    expect(result).toMatchObject({ success: true, refreshed: true });
    expect(fs.statSync(cookieFile).ino).toBe(beforeInode);
    expect(fs.readFileSync(cookieFile, "utf8")).toContain("new-secret-cookie");
    expect(fs.readFileSync(cookieFile, "utf8")).not.toContain("old-cookie-content");
    expect(liveContentsSeenDuringValidation).toEqual([
      "old-cookie-content\n",
      "old-cookie-content\n",
    ]);
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });

  test("keeps the previous live cookie when validation fails and deletes temp files", async () => {
    spawn.mockImplementation((command, args) => {
      const cookieArgIndex = args.indexOf("--cookies");
      const candidate = args[cookieArgIndex + 1];

      if (args.includes("--cookies-from-browser")) {
        fs.appendFileSync(candidate, ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\tnew-secret-cookie\n");
        return createMockProcess({ exitCode: 0 });
      }

      return createMockProcess({
        stderr: "Sign in to confirm you're not a bot https://rr1---sn.example/googlevideo",
        exitCode: 1,
      });
    });

    const result = await service().refreshNow({ reason: "test" });

    expect(result).toMatchObject({ success: false, refreshed: false });
    expect(fs.readFileSync(cookieFile, "utf8")).toBe("old-cookie-content\n");
    expect(fs.readdirSync(tmpRoot)).toEqual([]);

    const logged = JSON.stringify(logger.warn.mock.calls.concat(logger.error.mock.calls));
    expect(logged).not.toContain("new-secret-cookie");
    expect(logged).not.toContain("googlevideo");
  });

  test("accepts Netscape HttpOnly cookie lines as usable cookie payload", async () => {
    spawn.mockImplementation((command, args) => {
      const cookieArgIndex = args.indexOf("--cookies");
      const candidate = args[cookieArgIndex + 1];

      if (args.includes("--cookies-from-browser")) {
        fs.appendFileSync(candidate, "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\thttp-only-cookie\n");
        return createMockProcess({ exitCode: 0 });
      }

      return createMockProcess({ stdout: "dQw4w9WgXcQ\n", exitCode: 0 });
    });

    const result = await service().refreshNow({ reason: "test" });

    expect(result).toMatchObject({ success: true, refreshed: true });
    expect(fs.readFileSync(cookieFile, "utf8")).toContain("http-only-cookie");
  });
});
