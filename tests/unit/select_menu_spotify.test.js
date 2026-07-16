jest.mock("discord.js", () => ({
  MessageFlags: { Ephemeral: 64 },
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/ui/embeds", () => ({
  createErrorEmbed: jest.fn((title, description) => ({ title, description })),
  createSuccessEmbed: jest.fn((title, description) => ({ title, description })),
  createQueueEmbed: jest.fn(),
}));

jest.mock("../../src/ui/buttons", () => ({
  createQueueControls: jest.fn().mockReturnValue([]),
}));

jest.mock("../../src/utils/lock", () => ({
  shouldDebounce: jest.fn().mockReturnValue(false),
  acquire: jest.fn().mockReturnValue(true),
  release: jest.fn(),
}));

jest.mock("../../src/search/search_session_store", () => ({
  get: jest.fn(),
}));

jest.mock("../../src/spotify/playback_resolver", () => ({
  resolveSpotifyPlayback: jest.fn(),
}));

const SearchSessionStore = require("../../src/search/search_session_store");
const { resolveSpotifyPlayback } = require("../../src/spotify/playback_resolver");
const createSelectMenuHandler = require("../../src/bot/events/handlers/select_menu_handler");

function makeInteraction({ customId, value }) {
  return {
    customId,
    values: [value],
    user: { id: "user-1", username: "TestUser" },
    guild: { id: "guild-1", name: "Test Guild" },
    channelId: "channel-1",
    member: { voice: { channel: { id: "voice-1" } } },
    message: { embeds: [{ description: "search results" }], edit: jest.fn() },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  };
}

function makePlayerService({ radioEnabled = false, directExtractor = undefined, voiceChannelId = "voice-1" } = {}) {
  const player = {
    isPlaying: false,
    isPaused: false,
    voiceConnection: null,
    joinVoiceChannel: jest.fn().mockResolvedValue(true),
  };
  const ytExtractor = {
    searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }),
    extractAudio: jest.fn().mockResolvedValue({ title: "Extracted YouTube", audioUrl: "audio", duration: 10 }),
  };
  void voiceChannelId;

  return {
    getYouTubeExtractor: jest.fn().mockReturnValue(ytExtractor),
    getSpotifyDirectExtractor: jest.fn().mockReturnValue(directExtractor),
    getRadioService: jest.fn().mockReturnValue({ isEnabled: jest.fn().mockReturnValue(radioEnabled) }),
    getPlayer: jest.fn().mockReturnValue(player),
    addTrack: jest.fn().mockResolvedValue({ title: "Queued YouTube" }),
    setUIContext: jest.fn(),
    play: jest.fn().mockResolvedValue(true),
    playTrackAt: jest.fn().mockResolvedValue(true),
    notifyState: jest.fn(),
    _ytExtractor: ytExtractor,
    _player: player,
  };
}

const spotifyEntry = {
  platform: "spotify",
  title: "Spot Track",
  uploader: "Artist A, Artist B",
  duration: 180,
  url: null,
  spotifyId: "3n3Ppam7vgaVa1iaRUc9Lp",
  selectionValue: "spot:3n3Ppam7vgaVa1iaRUc9Lp",
};

describe("search_select_v2_ Spotify selection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("a direct spot: value resolves via resolveSpotifyPlayback and plays the YouTube match", async () => {
    SearchSessionStore.get.mockReturnValue({ entries: [spotifyEntry] });
    resolveSpotifyPlayback.mockResolvedValue({
      kind: "youtube-url",
      url: "https://www.youtube.com/watch?v=matched",
      title: "Matched Video",
    });

    const playerService = makePlayerService();
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({
      customId: "search_select_v2_aabbcc",
      value: "spot:3n3Ppam7vgaVa1iaRUc9Lp",
    });

    await handler(interaction);

    expect(resolveSpotifyPlayback).toHaveBeenCalledWith(
      { id: "3n3Ppam7vgaVa1iaRUc9Lp", title: "Spot Track", artists: ["Artist A", "Artist B"], durationSec: 180 },
      { youtubeExtractor: playerService._ytExtractor, directExtractor: undefined, radioActive: false },
    );
    expect(playerService._ytExtractor.extractAudio).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=matched",
      expect.objectContaining({ priority: "foreground", source: "playback" }),
    );
    expect(playerService.addTrack).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [expect.objectContaining({ title: "Added to Queue" })] }),
    );
  });

  test("an idx_ fallback pointing at a Spotify entry also resolves via resolveSpotifyPlayback", async () => {
    SearchSessionStore.get.mockReturnValue({ entries: [spotifyEntry] });
    resolveSpotifyPlayback.mockResolvedValue({
      kind: "youtube-url",
      url: "https://www.youtube.com/watch?v=matched2",
      title: "Matched Video 2",
    });

    const playerService = makePlayerService();
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({ customId: "search_select_v2_aabbcc", value: "idx_0" });

    await handler(interaction);

    expect(resolveSpotifyPlayback).toHaveBeenCalled();
    expect(playerService._ytExtractor.extractAudio).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=matched2",
      expect.objectContaining({ priority: "foreground", source: "playback" }),
    );
  });

  test("no YouTube match: shows a 'not found' error and does not attempt playback", async () => {
    SearchSessionStore.get.mockReturnValue({ entries: [spotifyEntry] });
    resolveSpotifyPlayback.mockResolvedValue(null);

    const playerService = makePlayerService();
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({
      customId: "search_select_v2_aabbcc",
      value: "spot:3n3Ppam7vgaVa1iaRUc9Lp",
    });

    await handler(interaction);

    expect(playerService._ytExtractor.extractAudio).not.toHaveBeenCalled();
    expect(playerService.addTrack).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [expect.objectContaining({ title: "Video Not Found" })],
    });
  });

  test("a 'direct' target plays via playAttachment (pre-built track, no YouTube extraction)", async () => {
    SearchSessionStore.get.mockReturnValue({ entries: [spotifyEntry] });
    const directData = {
      title: "Spot Track",
      audioUrl: "/app/cache/spotify/3n3Ppam7vgaVa1iaRUc9Lp.ogg",
      duration: 180,
      cached: true,
      extractedAt: new Date().toISOString(),
    };
    resolveSpotifyPlayback.mockResolvedValue({ kind: "direct", data: directData });

    const directExtractor = { isConfigured: jest.fn().mockReturnValue(true) };
    const playerService = makePlayerService({ directExtractor });
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({
      customId: "search_select_v2_aabbcc",
      value: "spot:3n3Ppam7vgaVa1iaRUc9Lp",
    });

    await handler(interaction);

    expect(playerService._ytExtractor.extractAudio).not.toHaveBeenCalled();
    expect(playerService._player.joinVoiceChannel).toHaveBeenCalledWith({ id: "voice-1" });
    expect(playerService.addTrack).toHaveBeenCalledWith("guild-1", directData, "<@user-1>");
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [expect.objectContaining({ title: "Added to Queue" })] }),
    );
  });

  test("a 'direct' target that hits RADIO_ACTIVE (radio toggled mid-resolve) shows an error", async () => {
    SearchSessionStore.get.mockReturnValue({ entries: [spotifyEntry] });
    resolveSpotifyPlayback.mockResolvedValue({
      kind: "direct",
      data: { title: "Spot Track", audioUrl: "/tmp/x.ogg", duration: 180, cached: true, extractedAt: new Date().toISOString() },
    });

    const directExtractor = { isConfigured: jest.fn().mockReturnValue(true) };
    const playerService = makePlayerService({ directExtractor, radioEnabled: true });
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({
      customId: "search_select_v2_aabbcc",
      value: "spot:3n3Ppam7vgaVa1iaRUc9Lp",
    });

    await handler(interaction);

    expect(playerService.addTrack).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [expect.objectContaining({ title: "Failed to Add Track" })] }),
    );
  });

  test("passes directExtractor and radioActive through to resolveSpotifyPlayback", async () => {
    SearchSessionStore.get.mockReturnValue({ entries: [spotifyEntry] });
    resolveSpotifyPlayback.mockResolvedValue({
      kind: "youtube-url",
      url: "https://www.youtube.com/watch?v=matched",
      title: "Matched Video",
    });

    const directExtractor = { isConfigured: jest.fn().mockReturnValue(true) };
    const playerService = makePlayerService({ directExtractor, radioEnabled: true });
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({
      customId: "search_select_v2_aabbcc",
      value: "spot:3n3Ppam7vgaVa1iaRUc9Lp",
    });

    await handler(interaction);

    expect(resolveSpotifyPlayback).toHaveBeenCalledWith(
      expect.anything(),
      { youtubeExtractor: playerService._ytExtractor, directExtractor, radioActive: true },
    );
  });

  test("expired/unknown session shows a 'search expired' error", async () => {
    SearchSessionStore.get.mockReturnValue(null);

    const playerService = makePlayerService();
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({
      customId: "search_select_v2_aabbcc",
      value: "spot:missing-track",
    });

    await handler(interaction);

    expect(resolveSpotifyPlayback).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [expect.objectContaining({ title: "Search Expired" })],
    });
  });
});
