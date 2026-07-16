/**
 * Playlist resolvers (Task 2.6) — YouTube playlist mapping, Bilibili fav/
 * collection pagination + progress, multipart mapping, Spotify → ytsearch1:
 * lazy URLs.
 */

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { resolveYouTubePlaylist } = require("../../src/playlists/youtube_playlist_resolver");
const {
  resolveBilibiliFav,
  resolveBilibiliCollection,
  resolveBilibiliMultipart,
} = require("../../src/playlists/bilibili_playlist_resolver");
const { resolveSpotifyCollection } = require("../../src/playlists/spotify_playlist_resolver");

describe("resolveYouTubePlaylist", () => {
  test("maps entries into PlaylistItems", async () => {
    const youtubeExtractor = {
      listPlaylistItems: jest.fn().mockResolvedValue({
        success: true,
        playlistTitle: "My Mix",
        entries: [
          { id: "v1", title: "Song A", duration: 180, uploader: "Ch A", url: "https://www.youtube.com/watch?v=v1" },
          { id: "v2", title: "Song B", duration: 200, uploader: "Ch B", url: "https://www.youtube.com/watch?v=v2" },
        ],
      }),
    };

    const result = await resolveYouTubePlaylist({ listId: "PLxyz", youtubeExtractor, maxItems: 100 });

    expect(youtubeExtractor.listPlaylistItems).toHaveBeenCalledWith(
      "https://www.youtube.com/playlist?list=PLxyz",
      100,
    );
    expect(result.kind).toBe("youtube-playlist");
    expect(result.title).toBe("My Mix");
    expect(result.items).toEqual([
      { url: "https://www.youtube.com/watch?v=v1", title: "Song A", durationSec: 180, platform: "youtube", author: "Ch A" },
      { url: "https://www.youtube.com/watch?v=v2", title: "Song B", durationSec: 200, platform: "youtube", author: "Ch B" },
    ]);
    expect(result.truncated).toBe(false);
  });

  test("truncated is true when entries hit the maxItems cap", async () => {
    const youtubeExtractor = {
      listPlaylistItems: jest.fn().mockResolvedValue({
        success: true,
        playlistTitle: "Big List",
        entries: [
          { id: "v1", title: "A", duration: 1, uploader: "U", url: "https://www.youtube.com/watch?v=v1" },
        ],
      }),
    };

    const result = await resolveYouTubePlaylist({ listId: "PLxyz", youtubeExtractor, maxItems: 1 });

    expect(result.truncated).toBe(true);
    expect(result.totalCount).toBe(1);
  });

  test("throws when listPlaylistItems reports failure", async () => {
    const youtubeExtractor = {
      listPlaylistItems: jest.fn().mockResolvedValue({ success: false, error: "boom" }),
    };

    await expect(resolveYouTubePlaylist({ listId: "PLxyz", youtubeExtractor, maxItems: 100 }))
      .rejects.toThrow("boom");
  });
});

describe("resolveBilibiliFav", () => {
  test("loops across hasMore pages and reports progress", async () => {
    const api = {
      getFavFolderPage: jest.fn()
        .mockResolvedValueOnce({
          title: "My Favorites",
          mediaCount: 3,
          hasMore: true,
          items: [
            { bvid: "BV1", title: "A", durationSec: 100, author: "Au1", cover: "c1" },
            { bvid: "BV2", title: "B", durationSec: 100, author: "Au2", cover: "c2" },
          ],
        })
        .mockResolvedValueOnce({
          title: "My Favorites",
          mediaCount: 3,
          hasMore: false,
          items: [
            { bvid: "BV3", title: "C", durationSec: 100, author: "Au3", cover: "c3" },
          ],
        }),
    };
    const onProgress = jest.fn();

    const result = await resolveBilibiliFav({ mediaId: "123", api, maxItems: 100, onProgress });

    expect(api.getFavFolderPage).toHaveBeenNthCalledWith(1, "123", 1, 20);
    expect(api.getFavFolderPage).toHaveBeenNthCalledWith(2, "123", 2, 20);
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toEqual({
      url: "https://www.bilibili.com/video/BV1",
      title: "A",
      durationSec: 100,
      platform: "bilibili",
      author: "Au1",
      thumbnail: "c1",
    });
    expect(onProgress).toHaveBeenCalledWith(2, 3);
    expect(onProgress).toHaveBeenCalledWith(3, 3);
    expect(result.truncated).toBe(false);
    expect(result.totalCount).toBe(3);
  });

  test("stops mid-page once maxItems is reached even with hasMore still true", async () => {
    const api = {
      getFavFolderPage: jest.fn().mockResolvedValue({
        title: "Big Folder",
        mediaCount: 50,
        hasMore: true,
        items: [
          { bvid: "BV1", title: "A", durationSec: 1, author: "", cover: "" },
          { bvid: "BV2", title: "B", durationSec: 1, author: "", cover: "" },
          { bvid: "BV3", title: "C", durationSec: 1, author: "", cover: "" },
        ],
      }),
    };

    const result = await resolveBilibiliFav({ mediaId: "1", api, maxItems: 2, onProgress: jest.fn() });

    expect(result.items).toHaveLength(2);
    expect(api.getFavFolderPage).toHaveBeenCalledTimes(1);
    expect(result.truncated).toBe(true);
  });
});

describe("resolveBilibiliCollection", () => {
  test("season: paginates using the total from the first page", async () => {
    const api = {
      getCollectionPage: jest.fn()
        .mockResolvedValueOnce({
          title: "Collection Title",
          total: 3,
          items: [{ bvid: "BV1", title: "P1", durationSec: 50, cover: "c1" }],
        })
        .mockResolvedValueOnce({
          title: "Collection Title",
          total: 3,
          items: [
            { bvid: "BV2", title: "P2", durationSec: 50, cover: "c2" },
            { bvid: "BV3", title: "P3", durationSec: 50, cover: "c3" },
          ],
        }),
    };

    const result = await resolveBilibiliCollection({
      mid: "1", seasonId: "2", listType: "season", api, maxItems: 100, onProgress: jest.fn(),
    });

    expect(api.getCollectionPage).toHaveBeenNthCalledWith(1, "1", "2", 1, "season", 30);
    expect(api.getCollectionPage).toHaveBeenNthCalledWith(2, "1", "2", 2, "season", 30);
    expect(result.items).toHaveLength(3);
    expect(result.title).toBe("Collection Title");
    expect(result.truncated).toBe(false);
  });

  test("series: uses the series listType", async () => {
    const api = {
      getCollectionPage: jest.fn().mockResolvedValueOnce({
        title: "合集",
        total: 1,
        items: [{ bvid: "BV1", title: "Ep 1", durationSec: 30, cover: "c1" }],
      }),
    };

    const result = await resolveBilibiliCollection({
      mid: "1", seasonId: "9", listType: "series", api, maxItems: 100,
    });

    expect(api.getCollectionPage).toHaveBeenCalledWith("1", "9", 1, "series", 30);
    expect(result.items).toHaveLength(1);
  });
});

describe("resolveBilibiliMultipart", () => {
  test("maps pages into per-part URLs and titles", async () => {
    const api = {
      getVideoPages: jest.fn().mockResolvedValue({
        title: "My Video",
        pages: [
          { page: 1, part: "Intro", durationSec: 60, cid: 1 },
          { page: 2, part: "Main", durationSec: 300, cid: 2 },
        ],
      }),
    };

    const result = await resolveBilibiliMultipart({ bvid: "BV1multi", api, maxItems: 100 });

    expect(result.kind).toBe("bilibili-multipart");
    expect(result.items).toEqual([
      { url: "https://www.bilibili.com/video/BV1multi?p=1", title: "My Video P1 Intro", durationSec: 60, platform: "bilibili" },
      { url: "https://www.bilibili.com/video/BV1multi?p=2", title: "My Video P2 Main", durationSec: 300, platform: "bilibili" },
    ]);
    expect(result.truncated).toBe(false);
  });

  test("caps at maxItems and marks truncated", async () => {
    const api = {
      getVideoPages: jest.fn().mockResolvedValue({
        title: "Long Video",
        pages: [
          { page: 1, part: "A", durationSec: 1, cid: 1 },
          { page: 2, part: "B", durationSec: 1, cid: 2 },
          { page: 3, part: "C", durationSec: 1, cid: 3 },
        ],
      }),
    };

    const result = await resolveBilibiliMultipart({ bvid: "BV1", api, maxItems: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});

describe("resolveSpotifyCollection", () => {
  test("album: maps tracks into lazy ytsearch1: URLs", async () => {
    const client = {
      getAlbum: jest.fn().mockResolvedValue({
        name: "My Album",
        total: 2,
        tracks: [
          { title: "Track A", artists: ["Artist A"], durationSec: 200, thumbnail: "thumb-a" },
          { title: "Track B", artists: ["Artist B"], durationSec: 210, thumbnail: "thumb-b" },
        ],
      }),
      getPlaylist: jest.fn(),
    };

    const result = await resolveSpotifyCollection({ type: "album", id: "abc", client, maxItems: 100 });

    expect(client.getAlbum).toHaveBeenCalledWith("abc", 100);
    expect(client.getPlaylist).not.toHaveBeenCalled();
    expect(result.kind).toBe("spotify-album");
    expect(result.title).toBe("My Album");
    expect(result.items[0]).toEqual({
      url: "ytsearch1:Artist A Track A",
      title: "Track A",
      durationSec: 200,
      platform: "youtube",
      author: "Artist A",
      thumbnail: "thumb-a",
    });
    expect(result.truncated).toBe(false);
  });

  test("playlist: calls getPlaylist and marks kind spotify-playlist", async () => {
    const client = {
      getAlbum: jest.fn(),
      getPlaylist: jest.fn().mockResolvedValue({
        name: "My Playlist",
        total: 5,
        tracks: [{ title: "Only Track", artists: ["Solo Artist"], durationSec: 100 }],
      }),
    };

    const result = await resolveSpotifyCollection({ type: "playlist", id: "xyz", client, maxItems: 1 });

    expect(client.getPlaylist).toHaveBeenCalledWith("xyz", 1);
    expect(result.kind).toBe("spotify-playlist");
    expect(result.truncated).toBe(true); // 1 item returned vs. total: 5
  });
});
