jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const SpotifyClient = require("../../src/spotify/client");

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function tokenResponse(accessToken = "test-token", expiresIn = 3600) {
  return jsonResponse({ access_token: accessToken, expires_in: expiresIn });
}

describe("SpotifyClient", () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SpotifyClient({ clientId: "id123", clientSecret: "secret456", market: "US" });
  });

  test("fetches and caches the access token across two calls", async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, opts) => {
      calls.push({ url, opts });
      if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
      return jsonResponse({ name: "Track A", duration_ms: 200000, artists: [{ name: "Artist" }] });
    });

    await client.getTrack("track1");
    await client.getTrack("track2");

    const tokenCalls = calls.filter((c) => c.url === "https://accounts.spotify.com/api/token");
    expect(tokenCalls).toHaveLength(1);

    const expectedBasic = Buffer.from("id123:secret456").toString("base64");
    expect(tokenCalls[0].opts.method).toBe("POST");
    expect(tokenCalls[0].opts.headers.Authorization).toBe(`Basic ${expectedBasic}`);
    expect(tokenCalls[0].opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(tokenCalls[0].opts.body).toBe("grant_type=client_credentials");
  });

  test("getTrack maps title/artists/duration/album/thumbnail", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
      expect(url).toBe("https://api.spotify.com/v1/tracks/abc123");
      return jsonResponse({
        name: "Song Title",
        duration_ms: 185000,
        artists: [{ name: "Main Artist" }, { name: "Feature" }],
        album: { name: "Album Name", images: [{ url: "https://img/1.jpg" }] },
      });
    });

    const track = await client.getTrack("abc123");
    expect(track).toEqual({
      title: "Song Title",
      artists: ["Main Artist", "Feature"],
      durationSec: 185,
      albumName: "Album Name",
      thumbnail: "https://img/1.jpg",
    });
  });

  test("401 triggers a token refresh and retries once", async () => {
    let tokenCallCount = 0;
    let apiCallCount = 0;
    global.fetch = jest.fn(async (url) => {
      if (url === "https://accounts.spotify.com/api/token") {
        tokenCallCount++;
        return tokenResponse(`token-${tokenCallCount}`);
      }
      apiCallCount++;
      if (apiCallCount === 1) {
        return jsonResponse({}, { status: 401 });
      }
      return jsonResponse({ name: "Recovered", duration_ms: 100000, artists: [] });
    });

    const track = await client.getTrack("t1");
    expect(track.title).toBe("Recovered");
    expect(tokenCallCount).toBe(2);
    expect(apiCallCount).toBe(2);
  });

  test("401 on both attempts throws SPOTIFY_AUTH_FAILED", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
      return jsonResponse({}, { status: 401 });
    });

    await expect(client.getTrack("t1")).rejects.toThrow("SPOTIFY_AUTH_FAILED");
  });

  test("404 throws SPOTIFY_NOT_FOUND", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
      return jsonResponse({}, { status: 404 });
    });

    await expect(client.getTrack("missing")).rejects.toThrow("SPOTIFY_NOT_FOUND");
  });

  test("429 with Retry-After waits and retries once", async () => {
    jest.useFakeTimers();
    let apiCallCount = 0;
    global.fetch = jest.fn(async (url) => {
      if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
      apiCallCount++;
      if (apiCallCount === 1) {
        return jsonResponse({}, { status: 429, headers: { "Retry-After": "1" } });
      }
      return jsonResponse({ name: "After Retry", duration_ms: 100000, artists: [] });
    });

    const promise = client.getTrack("t1");
    // Allow the token fetch + first (429) request microtasks to settle
    // before advancing the fake timer that gates the retry.
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1000);

    const track = await promise;
    expect(track.title).toBe("After Retry");
    expect(apiCallCount).toBe(2);
    jest.useRealTimers();
  });

  test("token endpoint 400 throws SPOTIFY_AUTH_FAILED", async () => {
    global.fetch = jest.fn(async () => jsonResponse({}, { status: 400 }));

    await expect(client.getTrack("t1")).rejects.toThrow("SPOTIFY_AUTH_FAILED");
  });

  test("getAlbum paginates across `next` pages and counts skipped entries", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
      if (url === "https://api.spotify.com/v1/albums/alb1") {
        return jsonResponse({
          name: "My Album",
          tracks: {
            total: 3,
            next: "https://api.spotify.com/v1/albums/alb1/tracks?limit=50&offset=2",
            items: [
              { name: "Track 1", duration_ms: 100000, artists: [{ name: "A" }] },
              { name: "Episode", duration_ms: 500000, artists: [{ name: "A" }], type: "episode" },
            ],
          },
        });
      }
      if (url === "https://api.spotify.com/v1/albums/alb1/tracks?limit=50&offset=2") {
        return jsonResponse({
          items: [{ name: "Track 3", duration_ms: 150000, artists: [{ name: "A" }] }],
          next: null,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await client.getAlbum("alb1", 100);
    expect(result.kind).toBe("album");
    expect(result.name).toBe("My Album");
    expect(result.total).toBe(3);
    expect(result.tracks.map((t) => t.title)).toEqual(["Track 1", "Track 3"]);
    expect(result.skipped).toBe(1);
  });

  test("getAlbum stops paginating once maxItems is reached", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
      if (url === "https://api.spotify.com/v1/albums/alb1") {
        return jsonResponse({
          name: "My Album",
          tracks: {
            total: 5,
            next: "https://api.spotify.com/v1/albums/alb1/tracks?limit=50&offset=1",
            items: [{ name: "Track 1", duration_ms: 100000, artists: [{ name: "A" }] }],
          },
        });
      }
      throw new Error(`Unexpected URL (pagination should have stopped): ${url}`);
    });

    const result = await client.getAlbum("alb1", 1);
    expect(result.tracks).toHaveLength(1);
  });

  test("getPlaylist paginates and skips null/local/episode entries", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
      if (url === "https://api.spotify.com/v1/playlists/pl1?fields=name,tracks.total") {
        return jsonResponse({ name: "My Playlist", tracks: { total: 4 } });
      }
      if (url.startsWith("https://api.spotify.com/v1/playlists/pl1/tracks?limit=100&offset=0")) {
        return jsonResponse({
          items: [
            { is_local: false, track: { name: "Song 1", duration_ms: 100000, artists: [{ name: "A" }], type: "track" } },
            { is_local: true, track: { name: "Local", duration_ms: 100000, artists: [{ name: "A" }], type: "track" } },
            { is_local: false, track: null },
          ],
          next: "https://api.spotify.com/v1/playlists/pl1/tracks?limit=100&offset=3",
        });
      }
      if (url.startsWith("https://api.spotify.com/v1/playlists/pl1/tracks?limit=100&offset=3")) {
        return jsonResponse({
          items: [
            { is_local: false, track: { name: "Podcast Ep", duration_ms: 100000, artists: [{ name: "A" }], type: "episode" } },
            { is_local: false, track: { name: "Song 2", duration_ms: 210000, artists: [{ name: "A" }], type: "track" } },
          ],
          next: null,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await client.getPlaylist("pl1", 100);
    expect(result.kind).toBe("playlist");
    expect(result.name).toBe("My Playlist");
    expect(result.total).toBe(4);
    expect(result.tracks.map((t) => t.title)).toEqual(["Song 1", "Song 2"]);
    expect(result.skipped).toBe(3);
  });

  describe("searchTracks", () => {
    test("builds the query URL with encoding, type=track, limit, and market", async () => {
      global.fetch = jest.fn(async (url) => {
        if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
        expect(url).toBe(
          "https://api.spotify.com/v1/search?q=hachimi%20%E7%94%B5%E5%8F%B0&type=track&limit=7&market=US",
        );
        return jsonResponse({ tracks: { items: [] } });
      });

      await client.searchTracks("hachimi 电台", 7);
      expect(global.fetch).toHaveBeenCalledTimes(2); // token + search
    });

    test("maps id/title/artists/duration/thumbnail, preserving API order", async () => {
      global.fetch = jest.fn(async (url) => {
        if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
        return jsonResponse({
          tracks: {
            items: [
              {
                id: "track1",
                name: "Song One",
                duration_ms: 185000,
                artists: [{ name: "Artist A" }, { name: "Artist B" }],
                album: { images: [{ url: "https://img/1.jpg" }] },
              },
              {
                id: "track2",
                name: "Song Two",
                duration_ms: 90000,
                artists: [{ name: "Artist C" }],
                album: { images: [] },
              },
            ],
          },
        });
      });

      const results = await client.searchTracks("song", 2);
      expect(results).toEqual([
        {
          id: "track1",
          title: "Song One",
          artists: ["Artist A", "Artist B"],
          durationSec: 185,
          thumbnail: "https://img/1.jpg",
        },
        {
          id: "track2",
          title: "Song Two",
          artists: ["Artist C"],
          durationSec: 90,
          thumbnail: undefined,
        },
      ]);
    });

    test("empty or missing items resolve to []", async () => {
      global.fetch = jest.fn(async (url) => {
        if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
        return jsonResponse({ tracks: { items: [] } });
      });
      await expect(client.searchTracks("nothing", 5)).resolves.toEqual([]);

      global.fetch = jest.fn(async (url) => {
        if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
        return jsonResponse({});
      });
      await expect(client.searchTracks("nothing", 5)).resolves.toEqual([]);
    });

    test("propagates API errors (caller is responsible for fallback)", async () => {
      global.fetch = jest.fn(async (url) => {
        if (url === "https://accounts.spotify.com/api/token") return tokenResponse();
        return jsonResponse({}, { status: 500 });
      });

      await expect(client.searchTracks("boom", 5)).rejects.toThrow();
    });
  });
});
