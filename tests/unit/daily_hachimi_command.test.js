/**
 * /daily-hachimi 命令单元测试
 * 覆盖 setup / disable / status 三个子命令的核心路径。
 */

// ─── discord.js mock (local, overrides global setup.js mock for this file) ───

jest.mock("discord.js", () => ({
  SlashCommandBuilder: function () {
    const self = {
      setName: () => self,
      setDescription: () => self,
      addSubcommand: () => self,
      toJSON: () => ({ name: "daily-hachimi", description: "test" }),
    };
    return self;
  },
  PermissionFlagsBits: { ManageGuild: 32 },
  ChannelType: { GuildText: 0 },
  MessageFlags: { Ephemeral: 64 },
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setColor: jest.fn().mockReturnThis(),
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
    setImage: jest.fn().mockReturnThis(),
    setURL: jest.fn().mockReturnThis(),
  })),
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const createDailyHachimiCommand = require("../../src/bot/commands/daily_hachimi");

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeService(overrides = {}) {
  return {
    setSchedule: jest.fn(),
    removeSchedule: jest.fn(),
    getStatus: jest.fn().mockReturnValue(null),
    ...overrides,
  };
}

/**
 * Build a minimal mock interaction for /daily-hachimi.
 * @param {Object} opts
 * @param {string}  opts.sub               - subcommand name (default: 'setup')
 * @param {string}  opts.time              - time option string (default: '12:00')
 * @param {number}  opts.count             - count option (default: 1)
 * @param {boolean} opts.channelPermitted  - whether bot has channel perms (default: true)
 * @param {boolean} opts.memberHasPermission - ManageGuild (default: true)
 */
function makeInteraction(opts = {}) {
  const {
    sub = "setup",
    time = "12:00",
    count = 1,
    channelPermitted = true,
    memberHasPermission = true,
  } = opts;

  const botMember = { id: "bot-member-id" };
  const mockChannel = {
    id: "ch1",
    toString: () => "<#ch1>",
    permissionsFor: jest.fn().mockReturnValue({
      has: jest.fn().mockReturnValue(channelPermitted),
    }),
  };

  return {
    options: {
      getSubcommand: jest.fn().mockReturnValue(sub),
      getChannel: jest.fn().mockReturnValue(mockChannel),
      getString: jest.fn().mockReturnValue(time),
      getInteger: jest.fn().mockReturnValue(count),
    },
    memberPermissions: {
      has: jest.fn().mockReturnValue(memberHasPermission),
    },
    guild: {
      id: "guild1",
      members: { me: botMember },
    },
    user: { username: "testuser" },
    deferReply: jest.fn().mockResolvedValue({}),
    editReply: jest.fn().mockResolvedValue({}),
    reply: jest.fn().mockResolvedValue({}),
    _mockChannel: mockChannel,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── factory ─────────────────────────────────────────────────────────────────

describe("createDailyHachimiCommand", () => {
  test("returns an object with data and execute", () => {
    const cmd = createDailyHachimiCommand(null, null, makeService());
    expect(cmd).toHaveProperty("data");
    expect(cmd).toHaveProperty("execute");
    expect(typeof cmd.execute).toBe("function");
  });
});

// ─── permission checks ───────────────────────────────────────────────────────

describe("execute – permission checks", () => {
  test("setup without ManageGuild replies with permission error and skips deferReply", async () => {
    const interaction = makeInteraction({ sub: "setup", memberHasPermission: false });
    const cmd = createDailyHachimiCommand(null, null, makeService());

    await cmd.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 })
    );
    expect(interaction.reply.mock.calls[0][0].content).toMatch(/管理服务器/);
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test("disable without ManageGuild replies with permission error and skips deferReply", async () => {
    const interaction = makeInteraction({ sub: "disable", memberHasPermission: false });
    const cmd = createDailyHachimiCommand(null, null, makeService());

    await cmd.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 })
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test("status does not require ManageGuild and always proceeds to deferReply", async () => {
    // Even without ManageGuild, status should work for everyone
    const interaction = makeInteraction({ sub: "status", memberHasPermission: false });
    const cmd = createDailyHachimiCommand(null, null, makeService());

    await cmd.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

// ─── setup subcommand ────────────────────────────────────────────────────────

describe("execute – setup subcommand", () => {
  test("rejects invalid time format (no colon)", async () => {
    const interaction = makeInteraction({ sub: "setup", time: "1200" });
    const cmd = createDailyHachimiCommand(null, null, makeService());

    await cmd.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/时间格式不正确/) })
    );
  });

  test("rejects invalid time format (letters)", async () => {
    const interaction = makeInteraction({ sub: "setup", time: "noon" });
    const cmd = createDailyHachimiCommand(null, null, makeService());

    await cmd.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/时间格式不正确/) })
    );
  });

  test("rejects out-of-range hour (25:00)", async () => {
    const interaction = makeInteraction({ sub: "setup", time: "25:00" });
    const cmd = createDailyHachimiCommand(null, null, makeService());

    await cmd.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/时间超出范围/) })
    );
  });

  test("rejects out-of-range minute (12:60)", async () => {
    const interaction = makeInteraction({ sub: "setup", time: "12:60" });
    const cmd = createDailyHachimiCommand(null, null, makeService());

    await cmd.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/时间超出范围/) })
    );
  });

  test("rejects when bot lacks channel permissions", async () => {
    const interaction = makeInteraction({
      sub: "setup",
      time: "12:00",
      channelPermitted: false,
    });
    const cmd = createDailyHachimiCommand(null, null, makeService());

    await cmd.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/没有.*权限/) })
    );
    expect(makeService().setSchedule).not.toHaveBeenCalled();
  });

  test("calls service.setSchedule with parsed hour/minute/count/timezone", async () => {
    const interaction = makeInteraction({ sub: "setup", time: "09:30", count: 3 });
    const service = makeService();
    const cmd = createDailyHachimiCommand(null, null, service);

    await cmd.execute(interaction);

    expect(service.setSchedule).toHaveBeenCalledWith("guild1", {
      channelId: "ch1",
      hour: 9,
      minute: 30,
      count: 3,
      timezone: "America/Toronto",
    });
  });

  test("accepts zero-padded time (08:05)", async () => {
    const interaction = makeInteraction({ sub: "setup", time: "08:05", count: 1 });
    const service = makeService();
    const cmd = createDailyHachimiCommand(null, null, service);

    await cmd.execute(interaction);

    expect(service.setSchedule).toHaveBeenCalledWith("guild1",
      expect.objectContaining({ hour: 8, minute: 5 })
    );
  });

  test("accepts midnight (00:00)", async () => {
    const interaction = makeInteraction({ sub: "setup", time: "00:00", count: 1 });
    const service = makeService();
    const cmd = createDailyHachimiCommand(null, null, service);

    await cmd.execute(interaction);

    expect(service.setSchedule).toHaveBeenCalledWith("guild1",
      expect.objectContaining({ hour: 0, minute: 0 })
    );
  });

  test("editReplies with an embed on successful setup", async () => {
    const interaction = makeInteraction({ sub: "setup", time: "12:00", count: 1 });
    const cmd = createDailyHachimiCommand(null, null, makeService());

    await cmd.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
    expect(interaction.editReply.mock.calls[0][0].embeds).toHaveLength(1);
  });
});

// ─── disable subcommand ──────────────────────────────────────────────────────

describe("execute – disable subcommand", () => {
  test("warns when guild has no existing schedule", async () => {
    const interaction = makeInteraction({ sub: "disable" });
    const service = makeService({ getStatus: jest.fn().mockReturnValue(null) });
    const cmd = createDailyHachimiCommand(null, null, service);

    await cmd.execute(interaction);

    expect(service.removeSchedule).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/尚未开启/) })
    );
  });

  test("calls removeSchedule and confirms success when schedule exists", async () => {
    const interaction = makeInteraction({ sub: "disable" });
    const existing = {
      channelId: "ch1",
      hour: 12,
      minute: 0,
      count: 1,
      timezone: "America/Toronto",
    };
    const service = makeService({ getStatus: jest.fn().mockReturnValue(existing) });
    const cmd = createDailyHachimiCommand(null, null, service);

    await cmd.execute(interaction);

    expect(service.removeSchedule).toHaveBeenCalledWith("guild1");
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/已关闭/) })
    );
  });
});

// ─── status subcommand ───────────────────────────────────────────────────────

describe("execute – status subcommand", () => {
  test("editReplies with info text when no schedule is configured", async () => {
    const interaction = makeInteraction({ sub: "status" });
    const service = makeService({ getStatus: jest.fn().mockReturnValue(null) });
    const cmd = createDailyHachimiCommand(null, null, service);

    await cmd.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/尚未开启/) })
    );
  });

  test("editReplies with status embed when schedule is configured", async () => {
    const interaction = makeInteraction({ sub: "status" });
    const existing = {
      channelId: "ch99",
      hour: 8,
      minute: 15,
      count: 2,
      timezone: "America/Toronto",
    };
    const service = makeService({ getStatus: jest.fn().mockReturnValue(existing) });
    const cmd = createDailyHachimiCommand(null, null, service);

    await cmd.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
    expect(interaction.editReply.mock.calls[0][0].embeds).toHaveLength(1);
  });
});
