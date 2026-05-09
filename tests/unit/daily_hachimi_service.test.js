/**
 * DailyHachimiService Unit Tests
 */

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock node-cron
jest.mock("node-cron", () => ({
  schedule: jest.fn().mockReturnValue({
    stop: jest.fn(),
  }),
}));

// Mock fs
jest.mock("fs", () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  accessSync: jest.fn(),
  constants: { W_OK: 2 },
}));

const cron = require("node-cron");
const fs = require("fs");
const logger = require("../../src/services/logger_service");
const DailyHachimiService = require("../../src/services/daily_hachimi_service");

const mockConfig = {
  dailyHachimi: {
    dataFile: "/tmp/test_daily_hachimi.json",
    historyFile: "/tmp/test_daily_hachimi_history.json",
    defaultTimezone: "America/Toronto",
    defaultCount: 1,
  },
};

function makeService() {
  return new DailyHachimiService(mockConfig);
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no data file exists, dir writable, write succeeds
  fs.existsSync.mockReturnValue(false);
  fs.accessSync.mockImplementation(() => undefined);
  fs.writeFileSync.mockImplementation(() => undefined);
});

// ─── initialize ─────────────────────────────────────────────

describe("initialize", () => {
  test("loads empty schedules when data file does not exist", () => {
    const service = makeService();
    const mockClient = {};
    const mockApi = {};

    service.initialize(mockClient, mockApi);

    expect(service.schedules).toEqual({});
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  test("schedules guilds loaded from persisted file", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        guild1: { channelId: "ch1", hour: 12, minute: 0, count: 1, timezone: "America/Toronto" },
        guild2: { channelId: "ch2", hour: 9, minute: 30, count: 3, timezone: "America/Toronto" },
      })
    );

    const service = makeService();
    service.initialize({}, {});

    expect(cron.schedule).toHaveBeenCalledTimes(2);
    // Verify cron expressions
    expect(cron.schedule).toHaveBeenCalledWith("0 12 * * *", expect.any(Function), {
      timezone: "America/Toronto",
    });
    expect(cron.schedule).toHaveBeenCalledWith("30 9 * * *", expect.any(Function), {
      timezone: "America/Toronto",
    });
  });
});

// ─── setSchedule ────────────────────────────────────────────

describe("setSchedule", () => {
  test("creates a cron job and saves to file", () => {
    const service = makeService();
    service.initialize({}, {});

    service.setSchedule("guildA", {
      channelId: "channelX",
      hour: 8,
      minute: 0,
      count: 2,
      timezone: "America/Toronto",
    });

    expect(cron.schedule).toHaveBeenCalledWith(
      "0 8 * * *",
      expect.any(Function),
      { timezone: "America/Toronto" }
    );
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(service.schedules["guildA"]).toMatchObject({ channelId: "channelX", count: 2 });
  });

  test("stops old cron before creating new one", () => {
    const stopMock = jest.fn();
    cron.schedule.mockReturnValue({ stop: stopMock });

    const service = makeService();
    service.initialize({}, {});

    service.setSchedule("guildA", {
      channelId: "ch1", hour: 10, minute: 0, count: 1, timezone: "America/Toronto",
    });

    // Update the same guild
    service.setSchedule("guildA", {
      channelId: "ch2", hour: 11, minute: 0, count: 1, timezone: "America/Toronto",
    });

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(cron.schedule).toHaveBeenCalledTimes(2);
  });
});

// ─── setSchedule persistence failure ────────────────────────

describe("setSchedule persistence failure", () => {
  test("re-throws when fs.writeFileSync fails with EACCES", () => {
    const eacces = Object.assign(
      new Error("EACCES: permission denied, open '/data/daily_hachimi.json'"),
      { code: "EACCES" }
    );
    fs.writeFileSync.mockImplementation(() => { throw eacces; });

    const service = makeService();
    service.initialize({}, {});

    expect(() => service.setSchedule("guildA", {
      channelId: "ch1", hour: 12, minute: 0, count: 1, timezone: "America/Toronto",
    })).toThrow("EACCES: permission denied");
  });

  test("does not start a cron job when persistence fails", () => {
    fs.writeFileSync.mockImplementation(() => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    });

    const service = makeService();
    service.initialize({}, {});
    cron.schedule.mockClear();

    expect(() => service.setSchedule("guildA", {
      channelId: "ch1", hour: 12, minute: 0, count: 1, timezone: "America/Toronto",
    })).toThrow();

    expect(cron.schedule).not.toHaveBeenCalled();
  });
});

// ─── initialize - data dir health check ─────────────────────

describe("initialize data dir health check", () => {
  test("logs error when data dir is not writable", () => {
    fs.accessSync.mockImplementation(() => {
      throw Object.assign(
        new Error("EACCES: permission denied, access '/data'"),
        { code: "EACCES" }
      );
    });

    const service = makeService();
    service.initialize({}, {});

    const errorCalls = logger.error.mock.calls.filter(
      ([msg]) => /data dir not writable/.test(msg)
    );
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][1]).toMatchObject({ dir: expect.any(String) });
  });

  test("does not log error when data dir is writable", () => {
    fs.accessSync.mockImplementation(() => undefined);

    const service = makeService();
    service.initialize({}, {});

    const errorCalls = logger.error.mock.calls.filter(
      ([msg]) => /data dir not writable/.test(msg)
    );
    expect(errorCalls).toHaveLength(0);
  });
});

// ─── removeSchedule ─────────────────────────────────────────

describe("removeSchedule", () => {
  test("stops cron and removes from schedules", () => {
    const stopMock = jest.fn();
    cron.schedule.mockReturnValue({ stop: stopMock });

    const service = makeService();
    service.initialize({}, {});

    service.setSchedule("guildA", {
      channelId: "ch1", hour: 10, minute: 0, count: 1, timezone: "America/Toronto",
    });

    service.removeSchedule("guildA");

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(service.schedules["guildA"]).toBeUndefined();
    expect(service.cronJobs.has("guildA")).toBe(false);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(2); // setSchedule + removeSchedule
  });

  test("does not throw when removing a non-existent guild", () => {
    const service = makeService();
    service.initialize({}, {});
    expect(() => service.removeSchedule("nonExistentGuild")).not.toThrow();
  });
});

// ─── getStatus ──────────────────────────────────────────────

describe("getStatus", () => {
  test("returns null for unconfigured guild", () => {
    const service = makeService();
    expect(service.getStatus("unknown")).toBeNull();
  });

  test("returns config for configured guild", () => {
    const service = makeService();
    service.initialize({}, {});

    const cfg = { channelId: "ch1", hour: 12, minute: 0, count: 1, timezone: "America/Toronto" };
    service.setSchedule("guildA", cfg);

    expect(service.getStatus("guildA")).toMatchObject(cfg);
  });
});

// ─── _buildVideoEmbed ────────────────────────────────────────

describe("_buildVideoEmbed", () => {
  // The global setup.js mock tracks EmbedBuilder instances via mock.results.
  // jest.clearAllMocks() in beforeEach resets the call list, so results[0]
  // is always the embed created by the current test.
  const { EmbedBuilder } = require("discord.js");

  test("normalizes protocol-relative pic URL to https://", () => {
    const service = makeService();
    service._buildVideoEmbed({
      bvid: "BV1abc",
      title: "Test",
      duration: 90,
      pic: "//i0.hdslb.com/bfs/archive/test.jpg",
      url: "https://www.bilibili.com/video/BV1abc",
    });

    const embed = EmbedBuilder.mock.results[0].value;
    expect(embed.setImage).toHaveBeenCalledWith(
      "https://i0.hdslb.com/bfs/archive/test.jpg"
    );
  });

  test("keeps a full https:// pic URL unchanged", () => {
    const service = makeService();
    service._buildVideoEmbed({
      bvid: "BV1abc",
      title: "Test",
      duration: 90,
      pic: "https://i0.hdslb.com/bfs/archive/test.jpg",
      url: "https://www.bilibili.com/video/BV1abc",
    });

    const embed = EmbedBuilder.mock.results[0].value;
    expect(embed.setImage).toHaveBeenCalledWith(
      "https://i0.hdslb.com/bfs/archive/test.jpg"
    );
  });

  test("does not call setImage when pic is empty", () => {
    const service = makeService();
    service._buildVideoEmbed({
      bvid: "BV1abc",
      title: "Test",
      duration: 90,
      pic: "",
      url: "https://www.bilibili.com/video/BV1abc",
    });

    const embed = EmbedBuilder.mock.results[0].value;
    expect(embed.setImage).not.toHaveBeenCalled();
  });

  test("does not call setImage when pic is missing", () => {
    const service = makeService();
    service._buildVideoEmbed({
      bvid: "BV1abc",
      title: "Test",
      duration: 90,
      url: "https://www.bilibili.com/video/BV1abc",
    });

    const embed = EmbedBuilder.mock.results[0].value;
    expect(embed.setImage).not.toHaveBeenCalled();
  });

  test("shows duration as inline hh:mm:ss without clock icon", () => {
    const service = makeService();
    service._buildVideoEmbed({
      bvid: "BV1abc",
      title: "Test",
      duration: 90,
      pic: "",
      url: "https://www.bilibili.com/video/BV1abc",
    });

    const embed = EmbedBuilder.mock.results[0].value;
    expect(embed.setDescription).toHaveBeenCalledWith("`00:01:30`");
  });
});

// ─── _fire ──────────────────────────────────────────────────

describe("_fire", () => {
  function makeMockChannel() {
    return {
      isTextBased: () => true,
      send: jest.fn().mockResolvedValue({}),
    };
  }

  function makeMockClient(channel) {
    return {
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
    };
  }

  test("sends header + one card per video", async () => {
    const channel = makeMockChannel();
    const client = makeMockClient(channel);

    const mockApi = {
      searchHachimiVideos: jest.fn().mockResolvedValue({
        results: [
          {
            bvid: "BV1abc",
            title: "哈基米神曲1",
            duration: 90,
            pic: "https://example.com/pic1.jpg",
            url: "https://www.bilibili.com/video/BV1abc",
          },
          {
            bvid: "BV2def",
            title: "哈基米神曲2",
            duration: 120,
            pic: "https://example.com/pic2.jpg",
            url: "https://www.bilibili.com/video/BV2def",
          },
        ],
      }),
    };

    const service = makeService();
    service.initialize(client, mockApi);

    service.schedules["guild1"] = {
      channelId: "ch1",
      hour: 12,
      minute: 0,
      count: 2,
      timezone: "America/Toronto",
    };

    await service._fire("guild1");

    // 1 header + 2 video cards = 3 sends
    expect(channel.send).toHaveBeenCalledTimes(3);

    // Header is plain text
    expect(channel.send.mock.calls[0][0]).toMatch(/今日哈基米音乐推荐/);

    // Video cards have embeds + components
    const card1 = channel.send.mock.calls[1][0];
    expect(card1.embeds).toHaveLength(1);
    expect(card1.components).toHaveLength(1);

    // Button customId contains the bvid
    const actionRow = card1.components[0];
    const listenBtn = actionRow.components[0];
    expect(listenBtn.data.custom_id).toBe("daily_play_BV1abc");
  });

  test("passes monthly exclusions and records successfully posted videos", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-15T12:00:00Z"));
    fs.existsSync.mockImplementation((file) => file === mockConfig.dailyHachimi.historyFile);
    fs.readFileSync.mockImplementation((file) => {
      if (file === mockConfig.dailyHachimi.historyFile) {
        return JSON.stringify({ guild1: { "2026-05": ["BVold"] } });
      }
      return "{}";
    });

    const channel = makeMockChannel();
    const client = makeMockClient(channel);
    const mockApi = {
      searchHachimiVideos: jest.fn().mockResolvedValue({
        results: [
          {
            bvid: "BVnew",
            title: "哈基米新推荐",
            duration: 90,
            pic: "",
            url: "https://www.bilibili.com/video/BVnew",
          },
        ],
      }),
    };

    const service = makeService();
    service.initialize(client, mockApi);
    service.schedules["guild1"] = {
      channelId: "ch1",
      hour: 12,
      minute: 0,
      count: 1,
      timezone: "America/Toronto",
    };

    await service._fire("guild1");

    expect(mockApi.searchHachimiVideos).toHaveBeenCalledWith(1, "guild1", {
      excludeBvids: ["BVold"],
      fillFromExcluded: true,
    });

    const historyWrite = fs.writeFileSync.mock.calls.find(
      ([file]) => file === mockConfig.dailyHachimi.historyFile
    );
    expect(historyWrite).toBeTruthy();
    const saved = JSON.parse(historyWrite[1]);
    expect(saved.guild1["2026-05"]).toEqual(["BVold", "BVnew"]);
    jest.useRealTimers();
  });

  test("does not mark daily videos when their card fails to send", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-15T12:00:00Z"));
    fs.existsSync.mockReturnValue(false);
    const channel = {
      isTextBased: () => true,
      send: jest
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("send failed"))
        .mockResolvedValueOnce({}),
    };
    const client = makeMockClient(channel);
    const mockApi = {
      searchHachimiVideos: jest.fn().mockResolvedValue({
        results: [
          { bvid: "BVfailed", title: "Video 1", duration: 60, pic: "", url: "https://bilibili.com/video/BVfailed" },
          { bvid: "BVsaved", title: "Video 2", duration: 60, pic: "", url: "https://bilibili.com/video/BVsaved" },
        ],
      }),
    };

    const service = makeService();
    service.initialize(client, mockApi);
    service.schedules["guild1"] = {
      channelId: "ch1", hour: 12, minute: 0, count: 2, timezone: "America/Toronto",
    };

    await service._fire("guild1");

    const historyWrite = fs.writeFileSync.mock.calls.find(
      ([file]) => file === mockConfig.dailyHachimi.historyFile
    );
    expect(historyWrite).toBeTruthy();
    const saved = JSON.parse(historyWrite[1]);
    expect(saved.guild1["2026-05"]).toEqual(["BVsaved"]);
    jest.useRealTimers();
  });

  test("prunes older daily history months for the guild being fired", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-15T12:00:00Z"));
    fs.existsSync.mockImplementation((file) => file === mockConfig.dailyHachimi.historyFile);
    fs.readFileSync.mockImplementation((file) => {
      if (file === mockConfig.dailyHachimi.historyFile) {
        return JSON.stringify({
          guild1: {
            "2026-04": ["BVoldMonth"],
            "2026-05": ["BVcurrentMonth"],
          },
        });
      }
      return "{}";
    });

    const channel = makeMockChannel();
    const client = makeMockClient(channel);
    const mockApi = {
      searchHachimiVideos: jest.fn().mockResolvedValue({
        results: [
          { bvid: "BVnewMonth", title: "Video", duration: 60, pic: "", url: "https://bilibili.com/video/BVnewMonth" },
        ],
      }),
    };

    const service = makeService();
    service.initialize(client, mockApi);
    service.schedules["guild1"] = {
      channelId: "ch1", hour: 12, minute: 0, count: 1, timezone: "America/Toronto",
    };

    await service._fire("guild1");

    const historyWrites = fs.writeFileSync.mock.calls.filter(
      ([file]) => file === mockConfig.dailyHachimi.historyFile
    );
    const saved = JSON.parse(historyWrites[historyWrites.length - 1][1]);
    expect(saved.guild1["2026-04"]).toBeUndefined();
    expect(saved.guild1["2026-05"]).toEqual(["BVcurrentMonth", "BVnewMonth"]);
    jest.useRealTimers();
  });

  test("skips sending when API returns empty results", async () => {
    const channel = makeMockChannel();
    const client = makeMockClient(channel);

    const mockApi = {
      searchHachimiVideos: jest.fn().mockResolvedValue({ results: [] }),
    };

    const service = makeService();
    service.initialize(client, mockApi);

    service.schedules["guild1"] = {
      channelId: "ch1", hour: 12, minute: 0, count: 1, timezone: "America/Toronto",
    };

    await service._fire("guild1");

    expect(channel.send).not.toHaveBeenCalled();
  });

  test("does not crash when channel fetch fails", async () => {
    const client = {
      channels: { fetch: jest.fn().mockRejectedValue(new Error("Unknown Channel")) },
    };

    const mockApi = { searchHachimiVideos: jest.fn() };

    const service = makeService();
    service.initialize(client, mockApi);

    service.schedules["guild1"] = {
      channelId: "deleted_channel", hour: 12, minute: 0, count: 1, timezone: "America/Toronto",
    };

    await expect(service._fire("guild1")).resolves.not.toThrow();
    expect(mockApi.searchHachimiVideos).not.toHaveBeenCalled();
  });

  test("continues sending remaining cards when one card send fails", async () => {
    const channel = {
      isTextBased: () => true,
      send: jest
        .fn()
        .mockResolvedValueOnce({}) // header
        .mockRejectedValueOnce(new Error("Rate limited")) // first card fails
        .mockResolvedValueOnce({}), // second card succeeds
    };

    const client = makeMockClient(channel);

    const mockApi = {
      searchHachimiVideos: jest.fn().mockResolvedValue({
        results: [
          { bvid: "BV1", title: "Video 1", duration: 60, pic: "", url: "https://bilibili.com/video/BV1" },
          { bvid: "BV2", title: "Video 2", duration: 60, pic: "", url: "https://bilibili.com/video/BV2" },
        ],
      }),
    };

    const service = makeService();
    service.initialize(client, mockApi);
    service.schedules["guild1"] = {
      channelId: "ch1", hour: 12, minute: 0, count: 2, timezone: "America/Toronto",
    };

    await expect(service._fire("guild1")).resolves.not.toThrow();
    // Header + first attempt (fails) + second card = 3 total calls
    expect(channel.send).toHaveBeenCalledTimes(3);
  });
});
