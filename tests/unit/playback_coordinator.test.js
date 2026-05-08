const PlaybackCoordinator = () => require("../../src/playback/playback_coordinator");

function makeInteraction() {
  return {
    guild: { id: "guild-1" },
    channelId: "channel-1",
    user: { id: "user-1" },
    member: { voice: { channel: { id: "voice-1" } } },
  };
}

function makePlayerService() {
  const player = {
    isPlaying: false,
    isPaused: false,
    joinVoiceChannel: jest.fn().mockResolvedValue(true),
  };
  const youtubeExtractor = {
    extractAudio: jest.fn().mockResolvedValue({ title: "YT", audioUrl: "audio", duration: 10 }),
  };

  return {
    setUIContext: jest.fn(),
    notifyState: jest.fn(),
    playBilibiliVideo: jest.fn().mockResolvedValue({ success: true, track: { title: "Bili" } }),
    getYouTubeExtractor: jest.fn().mockReturnValue(youtubeExtractor),
    getPlayer: jest.fn().mockReturnValue(player),
    addTrack: jest.fn().mockResolvedValue({ title: "YT" }),
    play: jest.fn().mockResolvedValue(true),
    _player: player,
    _youtubeExtractor: youtubeExtractor,
  };
}

describe("PlaybackCoordinator", () => {
  test("Bilibili playback sets UI context before play and notifies after success", async () => {
    const coordinator = PlaybackCoordinator();
    const playerService = makePlayerService();
    const interaction = makeInteraction();

    const result = await coordinator.playBilibiliUrl({ interaction, playerService, url: "https://bili/video" });

    expect(result.success).toBe(true);
    expect(playerService.setUIContext).toHaveBeenCalledWith("guild-1", "channel-1");
    expect(playerService.playBilibiliVideo).toHaveBeenCalledWith(interaction, "https://bili/video");
    expect(playerService.setUIContext.mock.invocationCallOrder[0])
      .toBeLessThan(playerService.playBilibiliVideo.mock.invocationCallOrder[0]);
    expect(playerService.notifyState).toHaveBeenCalledWith("guild-1");
  });

  test("Bilibili playback failure does not notify state", async () => {
    const coordinator = PlaybackCoordinator();
    const playerService = makePlayerService();
    playerService.playBilibiliVideo.mockResolvedValue({ success: false, error: "failed" });

    const result = await coordinator.playBilibiliUrl({
      interaction: makeInteraction(),
      playerService,
      url: "https://bili/video",
    });

    expect(result.success).toBe(false);
    expect(playerService.notifyState).not.toHaveBeenCalled();
  });

  test("YouTube playback extracts, joins, queues, sets UI context, and starts idle player", async () => {
    const coordinator = PlaybackCoordinator();
    const playerService = makePlayerService();
    const interaction = makeInteraction();

    const result = await coordinator.playYouTubeUrl({
      interaction,
      playerService,
      url: "https://youtube.com/watch?v=abc",
    });

    expect(result.success).toBe(true);
    expect(playerService._youtubeExtractor.extractAudio).toHaveBeenCalledWith("https://youtube.com/watch?v=abc");
    expect(playerService._player.joinVoiceChannel).toHaveBeenCalledWith({ id: "voice-1" });
    expect(playerService.addTrack).toHaveBeenCalledWith(
      "guild-1",
      { title: "YT", audioUrl: "audio", duration: 10 },
      "<@user-1>",
    );
    expect(playerService.setUIContext).toHaveBeenCalledWith("guild-1", "channel-1");
    expect(playerService.play).toHaveBeenCalledWith("guild-1");
  });

  test("YouTube playback notifies instead of restarting when player is already active", async () => {
    const coordinator = PlaybackCoordinator();
    const playerService = makePlayerService();
    playerService._player.isPlaying = true;

    const result = await coordinator.playYouTubeUrl({
      interaction: makeInteraction(),
      playerService,
      url: "https://youtube.com/watch?v=abc",
    });

    expect(result.success).toBe(true);
    expect(playerService.play).not.toHaveBeenCalled();
    expect(playerService.notifyState).toHaveBeenCalledWith("guild-1");
  });
});
