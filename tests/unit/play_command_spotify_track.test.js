/**
 * /play command — Spotify single-track link wiring (Project B): the branch
 * now routes through `resolveSpotifyPlayback` (direct extraction first, then
 * YouTube-match, same seam the tri-platform search select handler uses)
 * instead of calling `findYouTubeMatch` directly.
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
  playUrl: jest.fn(),
}));

jest.mock("../../src/bilibili/api", () => ({
  getVideoPages: jest.fn(),
}));

jest.mock("../../src/spotify/playback_resolver", () => ({
  resolveSpotifyPlayback: jest.fn(),
}));

const mockGetTrack = jest.fn();
jest.mock("../../src/spotify/client", () => jest.fn().mockImplementation(() => ({
  getTrack: mockGetTrack,
})));

const { playAttachment } = require("../../src/playback/playlist_coordinator");
const PlaybackCoordinator = require("../../src/playback/playback_coordinator");
const { resolveSpotifyPlayback } = require("../../src/spotify/playback_resolver");
const config = require("../../src/config/config");

const playCommand = require("../../src/bot/commands/play");

function buildInteraction(query) {
  const state = { deferred: false };
  const interaction = {
    options: { getString: jest.fn((name) => (name === "query" ? query : null)) },
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

function buildPlaybackService({ radioEnabled = false, directExtractor = undefined } = {}) {
  return {
    getYouTubeExtractor: jest.fn().mockReturnValue({}),
    getSpotifyDirectExtractor: jest.fn().mockReturnValue(directExtractor),
    getRadioService: jest.fn().mockReturnValue({ isEnabled: jest.fn().mockReturnValue(radioEnabled) }),
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

const SPOTIFY_TRACK_URL = "https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp";

describe("/play Spotify single-track link (Project B seam)", () => {
  let command;
  const originalSpotifyEnabled = config.spotify.enabled;

  beforeEach(() => {
    jest.clearAllMocks();
    config.spotify.enabled = true;
    mockGetTrack.mockResolvedValue({
      title: "Track Title",
      artists: ["Artist One"],
      durationSec: 200,
    });
    command = playCommand(buildPlaybackService(), {});
  });

  afterEach(() => {
    config.spotify.enabled = originalSpotifyEnabled;
  });

  test("Spotify support disabled: rejects before touching the resolver", async () => {
    config.spotify.enabled = false;
    const interaction = buildInteraction(SPOTIFY_TRACK_URL);

    await command.execute(interaction);

    expect(resolveSpotifyPlayback).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: "[!] Spotify 支持未配置（缺少 SPOTIFY_CLIENT_ID/SECRET）",
    });
  });

  test("resolver returns kind:'direct': plays via playAttachment, no YouTube extraction", async () => {
    const directData = {
      title: "Track Title",
      audioUrl: "/app/cache/spotify/3n3Ppam7vgaVa1iaRUc9Lp.ogg",
      duration: 200,
      cached: true,
      extractedAt: new Date().toISOString(),
    };
    resolveSpotifyPlayback.mockResolvedValue({ kind: "direct", data: directData });
    playAttachment.mockResolvedValue({ success: true, track: { title: "Track Title" } });

    const directExtractor = { isConfigured: jest.fn().mockReturnValue(true) };
    command = playCommand(buildPlaybackService({ directExtractor }), {});
    const interaction = buildInteraction(SPOTIFY_TRACK_URL);

    await command.execute(interaction);

    expect(resolveSpotifyPlayback).toHaveBeenCalledWith(
      { id: "3n3Ppam7vgaVa1iaRUc9Lp", title: "Track Title", artists: ["Artist One"], durationSec: 200 },
      expect.objectContaining({ directExtractor, radioActive: false }),
    );
    expect(playAttachment).toHaveBeenCalledWith(expect.objectContaining({ data: directData }));
    expect(PlaybackCoordinator.playUrl).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenLastCalledWith({ content: ">> 已添加: Track Title（Spotify 直连）" });
  });

  test("resolver returns kind:'direct' but playAttachment hits RADIO_ACTIVE", async () => {
    resolveSpotifyPlayback.mockResolvedValue({
      kind: "direct",
      data: { title: "Track Title", audioUrl: "/x.ogg", duration: 200, cached: true, extractedAt: new Date().toISOString() },
    });
    playAttachment.mockResolvedValue({ success: false, error: "RADIO_ACTIVE" });

    const interaction = buildInteraction(SPOTIFY_TRACK_URL);
    await command.execute(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: "[!] 电台模式运行中，无法直接播放该曲目。请先使用 /radio 关闭电台。",
    });
  });

  test("resolver returns kind:'youtube-url': unchanged YouTube playback flow", async () => {
    resolveSpotifyPlayback.mockResolvedValue({
      kind: "youtube-url",
      url: "https://www.youtube.com/watch?v=matched",
      title: "Matched Video",
    });
    PlaybackCoordinator.playUrl.mockResolvedValue({ success: true, track: { title: "Matched Video" } });

    const interaction = buildInteraction(SPOTIFY_TRACK_URL);
    await command.execute(interaction);

    expect(playAttachment).not.toHaveBeenCalled();
    expect(PlaybackCoordinator.playUrl).toHaveBeenCalledWith(
      "youtube",
      expect.objectContaining({ url: "https://www.youtube.com/watch?v=matched" }),
    );
    expect(interaction.editReply).toHaveBeenLastCalledWith({ content: ">> 已添加: Track Title（Spotify → YouTube）" });
  });

  test("resolver returns null: 'not found' error, no playback attempted", async () => {
    resolveSpotifyPlayback.mockResolvedValue(null);

    const interaction = buildInteraction(SPOTIFY_TRACK_URL);
    await command.execute(interaction);

    expect(playAttachment).not.toHaveBeenCalled();
    expect(PlaybackCoordinator.playUrl).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: "[!] 找不到对应的 YouTube 视频: Artist One - Track Title",
    });
  });

  test("radio active: radioActive:true is passed through to the resolver", async () => {
    resolveSpotifyPlayback.mockResolvedValue({
      kind: "youtube-url",
      url: "https://www.youtube.com/watch?v=matched",
      title: "Matched Video",
    });
    PlaybackCoordinator.playUrl.mockResolvedValue({ success: true, track: { title: "Matched Video" } });

    command = playCommand(buildPlaybackService({ radioEnabled: true }), {});
    const interaction = buildInteraction(SPOTIFY_TRACK_URL);
    await command.execute(interaction);

    expect(resolveSpotifyPlayback).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ radioActive: true }),
    );
  });
});
