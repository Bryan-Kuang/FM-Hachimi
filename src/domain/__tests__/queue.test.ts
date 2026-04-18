import { Queue } from "../queue";
import { Track, type TrackData } from "../track";

function t(nativeId: string, extra: Partial<TrackData> = {}): Track {
  return new Track({
    platform: "bilibili",
    nativeId,
    title: nativeId,
    duration: 60,
    audioUrl: `https://cdn/${nativeId}`,
    ...extra,
  });
}

describe("Queue invariants", () => {
  test("empty queue has currentIndex = -1", () => {
    const q = Queue.empty();
    expect(q.isEmpty).toBe(true);
    expect(q.currentIndex).toBe(-1);
    expect(q.currentTrack).toBeNull();
  });

  test("adding to an empty queue starts at index 0", () => {
    const q = Queue.empty().add(t("a"));
    expect(q.currentIndex).toBe(0);
    expect(q.currentTrack?.nativeId).toBe("a");
  });

  test("out-of-range currentIndex normalized to 0 on construction", () => {
    const q = new Queue({ tracks: [t("a"), t("b")], currentIndex: 99, loopMode: "queue" });
    expect(q.currentIndex).toBe(0);
  });

  test("preserves -1 on non-empty queue (exhausted state under loop=off)", () => {
    const q = new Queue({ tracks: [t("a")], currentIndex: -1, loopMode: "off" });
    expect(q.currentIndex).toBe(-1);
    expect(q.currentTrack).toBeNull();
  });

  test("clamps < -1 to 0 on non-empty", () => {
    const q = new Queue({ tracks: [t("a")], currentIndex: -5, loopMode: "queue" });
    expect(q.currentIndex).toBe(0);
  });
});

describe("Queue add / remove", () => {
  test("add preserves currentIndex after first", () => {
    const q = Queue.empty().add(t("a")).add(t("b")).add(t("c"));
    expect(q.currentIndex).toBe(0);
    expect(q.size).toBe(3);
  });

  test("removeAt before current decrements currentIndex", () => {
    const q = Queue.empty().add(t("a")).add(t("b")).add(t("c")).jumpTo(2);
    const q2 = q.removeAt(0);
    expect(q2.currentIndex).toBe(1);
    expect(q2.currentTrack?.nativeId).toBe("c");
  });

  test("removeAt current keeps position (next track slides in)", () => {
    const q = Queue.empty().add(t("a")).add(t("b")).add(t("c")).jumpTo(1);
    const q2 = q.removeAt(1);
    expect(q2.currentIndex).toBe(1);
    expect(q2.currentTrack?.nativeId).toBe("c");
  });

  test("removeAt last element leaves currentIndex at new last when current was last", () => {
    const q = Queue.empty().add(t("a")).add(t("b")).jumpTo(1);
    const q2 = q.removeAt(1);
    expect(q2.currentIndex).toBe(0);
    expect(q2.currentTrack?.nativeId).toBe("a");
  });

  test("removeAt out-of-range is a no-op", () => {
    const q = Queue.empty().add(t("a"));
    expect(q.removeAt(5)).toBe(q);
  });

  test("clear returns empty queue preserving loop mode", () => {
    const q = Queue.empty().setLoopMode("track").add(t("a"));
    const q2 = q.clear();
    expect(q2.isEmpty).toBe(true);
    expect(q2.loopMode).toBe("track");
  });
});

describe("Queue.moveNext under loop modes", () => {
  const three = Queue.empty().add(t("a")).add(t("b")).add(t("c"));

  test("off — advances and ends with currentIndex = -1 past the tail", () => {
    const off = three.setLoopMode("off");
    const q1 = off.moveNext();
    expect(q1.currentIndex).toBe(1);
    const q2 = q1.moveNext();
    expect(q2.currentIndex).toBe(2);
    const q3 = q2.moveNext();
    expect(q3.currentIndex).toBe(-1);
  });

  test("queue — wraps around to 0 past the tail", () => {
    const q = three.jumpTo(2).moveNext();
    expect(q.currentIndex).toBe(0);
  });

  test("track — stays on the same index", () => {
    const track = three.jumpTo(1).setLoopMode("track");
    expect(track.moveNext().currentIndex).toBe(1);
  });

  test("moveNext on empty queue is a no-op", () => {
    const q = Queue.empty();
    expect(q.moveNext()).toBe(q);
  });
});

describe("Queue.movePrev", () => {
  const three = Queue.empty().add(t("a")).add(t("b")).add(t("c"));

  test("off — steps back, stays at 0 at head", () => {
    const q = three.setLoopMode("off").jumpTo(1).movePrev();
    expect(q.currentIndex).toBe(0);
    expect(q.movePrev().currentIndex).toBe(0);
  });

  test("queue — wraps from 0 to last", () => {
    const q = three.jumpTo(0).movePrev();
    expect(q.currentIndex).toBe(2);
  });

  test("track — stays in place", () => {
    const q = three.setLoopMode("track").jumpTo(1);
    expect(q.movePrev().currentIndex).toBe(1);
  });
});

describe("Queue.shuffle", () => {
  test("preserves currentTrack at index 0", () => {
    const q = Queue.empty().add(t("a")).add(t("b")).add(t("c")).add(t("d")).jumpTo(2);
    const shuffled = q.shuffle(() => 0);
    expect(shuffled.currentIndex).toBe(0);
    expect(shuffled.currentTrack?.nativeId).toBe("c");
    expect(shuffled.tracks).toHaveLength(4);
  });

  test("no-op on empty or single-item queue", () => {
    const empty = Queue.empty();
    expect(empty.shuffle()).toBe(empty);
    const one = empty.add(t("a"));
    expect(one.shuffle()).toBe(one);
  });
});

describe("Queue.setLoopMode / jumpTo / replaceAt", () => {
  test("setLoopMode to the same mode returns self", () => {
    const q = Queue.empty();
    expect(q.setLoopMode("queue")).toBe(q);
  });

  test("jumpTo out-of-range is a no-op", () => {
    const q = Queue.empty().add(t("a"));
    expect(q.jumpTo(5)).toBe(q);
    expect(q.jumpTo(-1)).toBe(q);
  });

  test("replaceAt swaps a track in place", () => {
    const q = Queue.empty().add(t("a")).add(t("b"));
    const t2 = t("b2");
    const q2 = q.replaceAt(1, t2);
    expect(q2.tracks[1]).toBe(t2);
    expect(q2.currentIndex).toBe(q.currentIndex);
  });

  test("replaceAt with the same instance returns self", () => {
    const q = Queue.empty().add(t("a"));
    expect(q.replaceAt(0, q.tracks[0])).toBe(q);
  });
});
