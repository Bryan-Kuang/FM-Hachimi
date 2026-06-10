const SearchSessionStore = require("../../src/search/search_session_store");

function makeSession(keyword = "hachimi") {
  return {
    keyword,
    mode: "bilibili",
    entries: [
      {
        platform: "bilibili",
        title: "Video",
        uploader: "Uploader",
        url: null,
        selectionValue: "bili:BV1abc",
      },
    ],
  };
}

describe("search session store", () => {
  let nowSpy;

  beforeEach(() => {
    SearchSessionStore.clear();
    nowSpy = jest.spyOn(Date, "now");
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  test("create returns a token that round-trips through get", () => {
    const token = SearchSessionStore.create(makeSession());

    expect(token).toMatch(/^[0-9a-f]{10}$/);

    const session = SearchSessionStore.get(token);
    expect(session).toEqual(
      expect.objectContaining({ keyword: "hachimi", mode: "bilibili", currentPage: 1 }),
    );
  });

  test("get returns null for unknown tokens", () => {
    expect(SearchSessionStore.get("0000000000")).toBeNull();
  });

  test("sessions expire after the TTL", () => {
    nowSpy.mockReturnValue(1_000_000);
    const token = SearchSessionStore.create(makeSession());

    nowSpy.mockReturnValue(1_000_000 + SearchSessionStore.SESSION_TTL_MS + 1);
    expect(SearchSessionStore.get(token)).toBeNull();
  });

  test("oldest sessions are evicted beyond the size cap", () => {
    nowSpy.mockReturnValue(1_000_000);
    const firstToken = SearchSessionStore.create(makeSession("first"));
    const tokens = Array.from(
      { length: SearchSessionStore.MAX_SESSIONS },
      (_, index) => SearchSessionStore.create(makeSession(`later ${index}`)),
    );

    expect(SearchSessionStore.get(firstToken)).toBeNull();
    expect(SearchSessionStore.get(tokens[tokens.length - 1])).not.toBeNull();
  });
});
