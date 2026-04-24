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
}));

const cron = require("node-cron");
const fs = require("fs");
const DailyHachimiService = require("../../src/services/daily_hachimi_service");

const mockConfig = {
  dailyHachimi: {
    dataFile: "/tmp/test_daily_hachimi.json",
    defaultTimezone: "America/Toronto",
    defaultCount: 1,
  },
};

function makeService() {
  return new DailyHachimiService(mockConfig);
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no data file exists
  fs.existsSync.mockReturnValue(false);
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
