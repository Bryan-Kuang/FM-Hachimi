/**
 * In-memory metrics registry (counters, gauges, histograms).
 * Lightweight — no prom-client dependency. Accessible via /metrics endpoint.
 *
 * Usage:
 *   metrics.counter('play_requested_total').inc({ guildId: 'g1' });
 *   metrics.histogram('playback_duration_ms').observe(12345, { guildId: 'g1' });
 *   metrics.snapshot(); // { play_requested_total: { '{guildId=g1}': 3 }, ... }
 */

class Counter {
  constructor(name, help) {
    this.name = name;
    this.help = help || "";
    this.values = new Map();
  }

  _key(labels) {
    if (!labels) return "";
    const keys = Object.keys(labels).sort();
    return keys.map((k) => `${k}=${labels[k]}`).join(",");
  }

  inc(labels, delta) {
    const key = this._key(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + (delta == null ? 1 : delta));
  }

  get(labels) {
    return this.values.get(this._key(labels)) || 0;
  }

  snapshot() {
    const out = {};
    for (const [k, v] of this.values) {
      out[k || "_"] = v;
    }
    return out;
  }

  reset() {
    this.values.clear();
  }
}

class Histogram {
  constructor(name, help, buckets) {
    this.name = name;
    this.help = help || "";
    this.buckets = buckets || [50, 100, 250, 500, 1000, 2500, 5000, 10000];
    this.series = new Map();
  }

  _key(labels) {
    if (!labels) return "";
    const keys = Object.keys(labels).sort();
    return keys.map((k) => `${k}=${labels[k]}`).join(",");
  }

  _emptySeries() {
    return {
      count: 0,
      sum: 0,
      buckets: this.buckets.map((b) => ({ le: b, count: 0 })),
      min: Infinity,
      max: -Infinity,
    };
  }

  observe(value, labels) {
    const key = this._key(labels);
    let s = this.series.get(key);
    if (!s) {
      s = this._emptySeries();
      this.series.set(key, s);
    }
    s.count++;
    s.sum += value;
    if (value < s.min) s.min = value;
    if (value > s.max) s.max = value;
    for (const b of s.buckets) {
      if (value <= b.le) b.count++;
    }
  }

  snapshot() {
    const out = {};
    for (const [k, s] of this.series) {
      out[k || "_"] = {
        count: s.count,
        sum: s.sum,
        avg: s.count > 0 ? s.sum / s.count : 0,
        min: s.count > 0 ? s.min : 0,
        max: s.count > 0 ? s.max : 0,
        buckets: s.buckets,
      };
    }
    return out;
  }

  reset() {
    this.series.clear();
  }
}

class Registry {
  constructor() {
    this.counters = new Map();
    this.histograms = new Map();
  }

  counter(name, help) {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter(name, help);
      this.counters.set(name, c);
    }
    return c;
  }

  histogram(name, help, buckets) {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(name, help, buckets);
      this.histograms.set(name, h);
    }
    return h;
  }

  snapshot() {
    const out = { counters: {}, histograms: {} };
    for (const [name, c] of this.counters) {
      out.counters[name] = { help: c.help, values: c.snapshot() };
    }
    for (const [name, h] of this.histograms) {
      out.histograms[name] = { help: h.help, values: h.snapshot() };
    }
    return out;
  }

  reset() {
    for (const c of this.counters.values()) c.reset();
    for (const h of this.histograms.values()) h.reset();
  }
}

const registry = new Registry();

module.exports = {
  Counter,
  Histogram,
  Registry,
  registry,
  counter: (name, help) => registry.counter(name, help),
  histogram: (name, help, buckets) => registry.histogram(name, help, buckets),
  snapshot: () => registry.snapshot(),
  reset: () => registry.reset(),
};
