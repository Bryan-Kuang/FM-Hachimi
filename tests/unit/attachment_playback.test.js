/**
 * Uploaded-file / pasted-Discord-CDN-link playback (Task 3.1):
 * - validateAttachment / buildAttachmentTrackData (src/playback/attachment_track.ts)
 * - playAttachment coordinator (src/playback/playlist_coordinator.ts)
 */

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const {
  validateAttachment,
  buildAttachmentTrackData,
  ALLOWED_EXTENSIONS,
  ALLOWED_CONTENT_TYPES,
} = require("../../src/playback/attachment_track");
const { playAttachment } = require("../../src/playback/playlist_coordinator");

const MAX_BYTES = 50 * 1024 * 1024;

describe("ALLOWED_EXTENSIONS / ALLOWED_CONTENT_TYPES", () => {
  test("cover the documented formats", () => {
    expect(ALLOWED_EXTENSIONS).toEqual(["mp3", "m4a", "ogg", "oga", "wav", "flac", "webm"]);
    expect(ALLOWED_CONTENT_TYPES).toContain("audio/mpeg");
    expect(ALLOWED_CONTENT_TYPES).toContain("audio/webm");
  });
});

describe("validateAttachment", () => {
  test("accepts a content-type with a codecs suffix (e.g. 'audio/webm; codecs=opus')", () => {
    const result = validateAttachment(
      { url: "https://cdn.discordapp.com/attachments/1/2/clip.bin", contentType: "audio/webm; codecs=opus", size: 1024 },
      MAX_BYTES,
    );
    expect(result).toEqual({ ok: true });
  });

  test("falls back to the file extension when content-type is absent, ignoring query params", () => {
    const result = validateAttachment(
      { url: "https://cdn.discordapp.com/attachments/1/2/song.mp3?ex=abc&is=def&hm=ghi", contentType: null, size: 1024 },
      MAX_BYTES,
    );
    expect(result).toEqual({ ok: true });
  });

  test("rejects an unsupported extension with reason 'type'", () => {
    const result = validateAttachment(
      { url: "https://cdn.discordapp.com/attachments/1/2/notes.txt", contentType: "text/plain", size: 100 },
      MAX_BYTES,
    );
    expect(result).toEqual({ ok: false, reason: "type" });
  });

  test("rejects a file over the size cap with reason 'size'", () => {
    const result = validateAttachment(
      { url: "https://cdn.discordapp.com/attachments/1/2/song.mp3", contentType: "audio/mpeg", size: MAX_BYTES + 1 },
      MAX_BYTES,
    );
    expect(result).toEqual({ ok: false, reason: "size" });
  });

  test("allows an unknown size (pasted CDN link, no size metadata)", () => {
    const result = validateAttachment(
      { url: "https://cdn.discordapp.com/attachments/1/2/song.flac" },
      MAX_BYTES,
    );
    expect(result).toEqual({ ok: true });
  });

  test("size exactly at the cap is allowed", () => {
    const result = validateAttachment(
      { url: "https://cdn.discordapp.com/attachments/1/2/song.wav", size: MAX_BYTES },
      MAX_BYTES,
    );
    expect(result).toEqual({ ok: true });
  });
});

describe("buildAttachmentTrackData", () => {
  test("uses the attachment's own name, extension stripped", () => {
    const data = buildAttachmentTrackData({
      url: "https://cdn.discordapp.com/attachments/1/2/raw-file-id.bin?ex=abc",
      name: "My Cool Song.mp3",
    });
    expect(data.title).toBe("My Cool Song");
  });

  test("falls back to a decoded, extension-stripped basename when name is absent", () => {
    const data = buildAttachmentTrackData({
      url: "https://cdn.discordapp.com/attachments/1/2/My%20Track.flac?ex=abc&is=def&hm=ghi",
    });
    expect(data.title).toBe("My Track");
  });

  test("exact track shape: cached true, duration 0, audioUrl == input url, no platform/normalizedUrl/bvid", () => {
    const data = buildAttachmentTrackData({
      url: "https://cdn.discordapp.com/attachments/1/2/song.mp3",
      name: "song.mp3",
    });

    expect(data.audioUrl).toBe("https://cdn.discordapp.com/attachments/1/2/song.mp3");
    expect(data.duration).toBe(0);
    expect(data.cached).toBe(true);
    expect(data.platform).toBeUndefined();
    expect(data.normalizedUrl).toBeUndefined();
    expect(data.bvid).toBeUndefined();
    expect(data.streamHeaders).toEqual({
      referer: "https://discord.com/",
      userAgent: expect.stringContaining("Chrome"),
    });
    expect(typeof data.extractedAt).toBe("string");
    expect(Number.isNaN(new Date(data.extractedAt).getTime())).toBe(false);
  });
});

describe("playAttachment", () => {
  function makeInteraction(voiceChannel = { id: "vc-1" }) {
    return {
      guild: { id: "guild-1" },
      channelId: "channel-1",
      user: { id: "user-1" },
      member: { voice: { channel: voiceChannel } },
    };
  }

  function makePlayer(overrides = {}) {
    return {
      isPlaying: false,
      isPaused: false,
      voiceConnection: null,
      joinVoiceChannel: jest.fn().mockResolvedValue(true),
      ...overrides,
    };
  }

  function makePlayerService({ player, radioEnabled = false, addTrackImpl, playImpl } = {}) {
    const resolvedPlayer = player || makePlayer();
    return {
      setUIContext: jest.fn(),
      notifyState: jest.fn(),
      getRadioService: jest.fn().mockReturnValue({ isEnabled: jest.fn().mockReturnValue(radioEnabled) }),
      getPlayer: jest.fn().mockReturnValue(resolvedPlayer),
      addTrack: addTrackImpl || jest.fn().mockResolvedValue({ title: "Queued Track" }),
      play: playImpl || jest.fn().mockResolvedValue(true),
      playTrackAt: jest.fn().mockResolvedValue(true),
      _player: resolvedPlayer,
    };
  }

  const sampleData = {
    title: "Song A",
    audioUrl: "https://cdn.discordapp.com/attachments/1/2/song.mp3",
    duration: 0,
    cached: true,
    extractedAt: new Date().toISOString(),
  };

  test("refuses when radio is active — never joins voice or adds a track", async () => {
    const playerService = makePlayerService({ radioEnabled: true });

    const result = await playAttachment({
      interaction: makeInteraction(),
      playerService,
      data: sampleData,
    });

    expect(result).toEqual({ success: false, error: "RADIO_ACTIVE" });
    expect(playerService.addTrack).not.toHaveBeenCalled();
    expect(playerService._player.joinVoiceChannel).not.toHaveBeenCalled();
  });

  test("returns an error when the user is not in a voice channel", async () => {
    const playerService = makePlayerService();

    const result = await playAttachment({
      interaction: makeInteraction(null),
      playerService,
      data: sampleData,
    });

    expect(result).toEqual({ success: false, error: "Voice channel required" });
  });

  test("happy path (idle player): enqueues the exact track data and starts playback", async () => {
    const playerService = makePlayerService();

    const result = await playAttachment({
      interaction: makeInteraction(),
      playerService,
      data: sampleData,
    });

    expect(playerService._player.joinVoiceChannel).toHaveBeenCalledWith({ id: "vc-1" });
    expect(playerService.addTrack).toHaveBeenCalledWith("guild-1", sampleData, "<@user-1>");
    expect(playerService.play).toHaveBeenCalledWith("guild-1");
    expect(playerService.notifyState).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, track: { title: "Queued Track" }, videoData: sampleData });
  });

  test("active player: calls notifyState instead of starting playback", async () => {
    const player = makePlayer({ isPlaying: true });
    const playerService = makePlayerService({ player });

    await playAttachment({ interaction: makeInteraction(), playerService, data: sampleData });

    expect(playerService.play).not.toHaveBeenCalled();
    expect(playerService.notifyState).toHaveBeenCalledWith("guild-1");
  });

  test("does not rejoin when already connected to the requested channel", async () => {
    const player = makePlayer({ voiceConnection: { joinConfig: { channelId: "vc-1" } } });
    const playerService = makePlayerService({ player });

    await playAttachment({ interaction: makeInteraction(), playerService, data: sampleData });

    expect(player.joinVoiceChannel).not.toHaveBeenCalled();
  });

  test("voice-join failure surfaces as an error", async () => {
    const player = makePlayer({ joinVoiceChannel: jest.fn().mockResolvedValue(false) });
    const playerService = makePlayerService({ player });

    const result = await playAttachment({ interaction: makeInteraction(), playerService, data: sampleData });

    expect(result).toEqual({ success: false, error: "Failed to join voice channel" });
    expect(playerService.addTrack).not.toHaveBeenCalled();
  });

  test("null addTrack result surfaces as a queue-add failure", async () => {
    const playerService = makePlayerService({ addTrackImpl: jest.fn().mockResolvedValue(null) });

    const result = await playAttachment({ interaction: makeInteraction(), playerService, data: sampleData });

    expect(result).toEqual({ success: false, error: "Failed to add track to queue" });
  });
});
