const { interleaveRoundRobin } = require("../../src/search/interleave");

describe("interleaveRoundRobin", () => {
  test("interleaves three uneven lists in round-robin order, list-array order as tie-break", () => {
    const bili = ["b1", "b2"];
    const yt = ["y1"];
    const spotify = ["s1", "s2", "s3"];

    expect(interleaveRoundRobin([bili, yt, spotify])).toEqual([
      "b1", "y1", "s1",
      "b2", "s2",
      "s3",
    ]);
  });

  test("interleaves two equal-length lists", () => {
    expect(interleaveRoundRobin([["a1", "a2"], ["b1", "b2"]])).toEqual(["a1", "b1", "a2", "b2"]);
  });

  test("skips exhausted lists without inserting gaps", () => {
    expect(interleaveRoundRobin([["a1"], [], ["c1", "c2"]])).toEqual(["a1", "c1", "c2"]);
  });

  test("empty lists produce an empty result", () => {
    expect(interleaveRoundRobin([[], [], []])).toEqual([]);
    expect(interleaveRoundRobin([])).toEqual([]);
  });

  test("a single list is returned unchanged", () => {
    expect(interleaveRoundRobin([["only1", "only2"]])).toEqual(["only1", "only2"]);
  });

  test("preserves object identity of interleaved elements", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    expect(interleaveRoundRobin([[a], [b]])).toEqual([a, b]);
  });
});
