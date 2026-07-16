/**
 * /play command — uploaded-file / pasted-Discord-CDN-link wiring (Task 3.1):
 * the `file` attachment option (query becomes optional; attachment wins when
 * both are given), the route.kind === 'attachment' pasted-URL path, the
 * "neither given" guard, validation error messages, and the radio-conflict
 * message.
 */

jest.mock("discord.js", () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => {
    const builder = {};
    builder.setName = jest.fn().mockReturnThis();
    builder.setDescription = jest.fn().mockReturnThis();
    builder.addStringOption = jest.fn().mockImplementation((cb) => {
      if (cb) cb({ setName: jest.fn().mockReturnThis(), setDescription: jest.fn().mockReturnThis(), setRequired: jest.fn().mockReturnThis() });
      return builder;
    });
    builder.addAttachmentOption = jest.fn().mockImplementation((cb) => {
      if (cb) cb({ setName: jest.fn().mockReturnThis(), setDescription: jest.fn().mockReturnThis(), setRequired: jest.fn().mockReturnThis() });
      return builder;
    });
    return builder;
  }),
  MessageFlags: { Ephemeral: 64 },
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/playback/playlist_coordinator", () => ({
  playPlaylist: jest.fn(),
  playAttachment: jest.fn(),
  buildPendingTrackData: jest.requireActual("../../src/playback/playlist_coordinator").buildPendingTrackData,
}));

jest.mock("../../src/playback/playback_coordinator", () => ({
  playUrl: jest.fn().mockResolvedValue({ success: true, track: { title: "Single Video" } }),
}));

jest.mock("../../src/bilibili/api", () => ({
  searchVideos: jest.fn().mockResolvedValue([]),
  getVideoPages: jest.fn(),
}));

const { playAttachment } = require("../../src/playback/playlist_coordinator");
const config = require("../../src/config/config");

const playCommand = require("../../src/bot/commands/play");

function buildInteraction({ query = null, attachment = null } = {}) {
  const state = { deferred: false };
  const interaction = {
    options: {
      getString: jest.fn((name) => (name === "query" ? query : null)),
      getAttachment: jest.fn((name) => (name === "file" ? attachment : null)),
    },
    user: { id: "user-1", username: "TestUser" },
    member: { voice: { channel: { id: "vc-1" } } },
    guild: { id: "guild-1", members: { me: { voice: { channel: null } } } },
    channelId: "channel-1",
    reply: jest.fn().mockResolvedValue(),
    editReply: jest.fn().mockResolvedValue(),
    deferReply: jest.fn().mockImplementation(() => { state.deferred = true; return Promise.resolve(); }),
  };
  Object.defineProperty(interaction, "deferred", { get: () => state.deferred });
  Object.defineProperty(interaction, "replied", { get: () => false });
  return interaction;
}

function buildPlaybackService() {
  return {
    getYouTubeExtractor: jest.fn().mockReturnValue({}),
    getRadioService: jest.fn().mockReturnValue({ isEnabled: jest.fn().mockReturnValue(false) }),
    getExtractor: jest.fn(),
    getPlayer: jest.fn(),
    setUIContext: jest.fn(),
    notifyState: jest.fn(),
    addTrack: jest.fn(),
    playTrackAt: jest.fn(),
    play: jest.fn(),
    prewarmBilibiliUrls: jest.fn(),
    prewarmYouTubeUrls: jest.fn(),
  };
}

describe("/play attachment wiring (Task 3.1)", () => {
  let command;

  beforeEach(() => {
    jest.clearAllMocks();
    command = playCommand(buildPlaybackService(), {});
  });

  test("neither query nor file given: replies with the guidance message (no defer)", async () => {
    const interaction = buildInteraction();
    await command.execute(interaction);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "请提供链接/关键词，或附加一个音频文件",
      flags: 64,
    });
    expect(playAttachment).not.toHaveBeenCalled();
  });

  test("uploaded file option: validates, builds track data, and calls playAttachment", async () => {
    playAttachment.mockResolvedValue({ success: true, track: { title: "My Song" } });
    const attachment = {
      url: "https://cdn.discordapp.com/attachments/1/2/song.mp3",
      name: "song.mp3",
      contentType: "audio/mpeg",
      size: 1024,
    };
    const interaction = buildInteraction({ attachment });

    await command.execute(interaction);

    expect(playAttachment).toHaveBeenCalledWith(expect.objectContaining({
      interaction,
      data: expect.objectContaining({ audioUrl: attachment.url, cached: true, duration: 0 }),
    }));
    expect(interaction.editReply).toHaveBeenLastCalledWith({ content: ">> 已添加: My Song" });
  });

  test("attachment wins when both query and file are given", async () => {
    playAttachment.mockResolvedValue({ success: true, track: { title: "Winner" } });
    const attachment = {
      url: "https://cdn.discordapp.com/attachments/1/2/song.mp3",
      name: "song.mp3",
      contentType: "audio/mpeg",
      size: 1024,
    };
    const interaction = buildInteraction({ query: "https://www.youtube.com/watch?v=abc", attachment });

    await command.execute(interaction);

    expect(playAttachment).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenLastCalledWith({ content: ">> 已添加: Winner" });
  });

  test("unsupported file type: rejects before calling playAttachment", async () => {
    const attachment = {
      url: "https://cdn.discordapp.com/attachments/1/2/notes.txt",
      name: "notes.txt",
      contentType: "text/plain",
      size: 100,
    };
    const interaction = buildInteraction({ attachment });

    await command.execute(interaction);

    expect(playAttachment).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: "[!] 不支持的文件类型（支持 mp3/m4a/ogg/wav/flac/webm）",
    });
  });

  test("oversized file: rejects with the size-limit message", async () => {
    const attachment = {
      url: "https://cdn.discordapp.com/attachments/1/2/song.mp3",
      name: "song.mp3",
      contentType: "audio/mpeg",
      size: config.attachments.maxBytes + 1,
    };
    const interaction = buildInteraction({ attachment });

    await command.execute(interaction);

    expect(playAttachment).not.toHaveBeenCalled();
    const maxMb = Math.floor(config.attachments.maxBytes / 1024 / 1024);
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: `[!] 文件过大（上限 ${maxMb}MB）`,
    });
  });

  test("RADIO_ACTIVE from playAttachment shows the radio-conflict message", async () => {
    playAttachment.mockResolvedValue({ success: false, error: "RADIO_ACTIVE" });
    const attachment = {
      url: "https://cdn.discordapp.com/attachments/1/2/song.mp3",
      name: "song.mp3",
      contentType: "audio/mpeg",
      size: 1024,
    };
    const interaction = buildInteraction({ attachment });

    await command.execute(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: "[!] 电台模式运行中，无法添加上传的文件。请先使用 /radio 关闭电台。",
    });
  });

  test("pasted Discord CDN link (query, no file): routes through the attachment flow", async () => {
    playAttachment.mockResolvedValue({ success: true, track: { title: "Pasted Track" } });
    const interaction = buildInteraction({
      query: "https://cdn.discordapp.com/attachments/111/222/track.flac?ex=abc&is=def&hm=ghi",
    });

    await command.execute(interaction);

    expect(playAttachment).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ audioUrl: interaction.options.getString("query") }),
    }));
    expect(interaction.editReply).toHaveBeenLastCalledWith({ content: ">> 已添加: Pasted Track" });
  });

  test("plain keyword query (no attachment) is unaffected — falls through to normal routing", async () => {
    const interaction = buildInteraction({ query: "some keyword" });

    await command.execute(interaction);

    expect(playAttachment).not.toHaveBeenCalled();
  });
});
