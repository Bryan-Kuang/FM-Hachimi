const { Registry, counter, histogram, snapshot, reset } = require("../metrics");

describe("metrics Counter", () => {
  test("inc increments by 1 by default", () => {
    const reg = new Registry();
    const c = reg.counter("test");
    c.inc();
    c.inc();
    expect(c.get()).toBe(2);
  });

  test("inc with delta adds delta", () => {
    const reg = new Registry();
    const c = reg.counter("test");
    c.inc(null, 5);
    c.inc(null, 3);
    expect(c.get()).toBe(8);
  });

  test("labels create separate series", () => {
    const reg = new Registry();
    const c = reg.counter("plays");
    c.inc({ guild: "a" });
    c.inc({ guild: "a" });
    c.inc({ guild: "b" });
    expect(c.get({ guild: "a" })).toBe(2);
    expect(c.get({ guild: "b" })).toBe(1);
  });

  test("label order does not matter for key", () => {
    const reg = new Registry();
    const c = reg.counter("plays");
    c.inc({ guild: "g1", user: "u1" });
    c.inc({ user: "u1", guild: "g1" });
    expect(c.get({ guild: "g1", user: "u1" })).toBe(2);
  });
});

describe("metrics Histogram", () => {
  test("observe accumulates count and sum", () => {
    const reg = new Registry();
    const h = reg.histogram("dur_ms");
    h.observe(100);
    h.observe(200);
    h.observe(300);
    const snap = h.snapshot();
    expect(snap._.count).toBe(3);
    expect(snap._.sum).toBe(600);
    expect(snap._.avg).toBe(200);
    expect(snap._.min).toBe(100);
    expect(snap._.max).toBe(300);
  });

  test("buckets count values le threshold", () => {
    const reg = new Registry();
    const h = reg.histogram("dur_ms", "", [100, 500, 1000]);
    h.observe(50);
    h.observe(250);
    h.observe(750);
    h.observe(1500);
    const snap = h.snapshot()._;
    expect(snap.buckets[0]).toEqual({ le: 100, count: 1 });
    expect(snap.buckets[1]).toEqual({ le: 500, count: 2 });
    expect(snap.buckets[2]).toEqual({ le: 1000, count: 3 });
  });

  test("snapshot of empty histogram returns zeros", () => {
    const reg = new Registry();
    const h = reg.histogram("empty");
    expect(h.snapshot()).toEqual({});
  });
});

describe("Registry singleton API", () => {
  beforeEach(() => reset());

  test("counter/histogram return same instance per name", () => {
    const a = counter("same");
    const b = counter("same");
    expect(a).toBe(b);

    const h1 = histogram("dur");
    const h2 = histogram("dur");
    expect(h1).toBe(h2);
  });

  test("snapshot returns full registry state", () => {
    counter("c1").inc({ g: "x" });
    histogram("h1").observe(50);
    const snap = snapshot();
    expect(snap.counters.c1).toBeDefined();
    expect(snap.histograms.h1).toBeDefined();
  });

  test("reset clears all series", () => {
    counter("c").inc();
    histogram("h").observe(10);
    reset();
    const snap = snapshot();
    expect(snap.counters.c.values).toEqual({});
    expect(snap.histograms.h.values).toEqual({});
  });
});
