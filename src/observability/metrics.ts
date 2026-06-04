/**
 * In-memory metrics registry (counters, gauges, histograms).
 * Lightweight — no prom-client dependency. Accessible via /metrics endpoint.
 *
 * Usage:
 *   metrics.counter('play_requested_total').inc({ guildId: 'g1' });
 *   metrics.histogram('playback_duration_ms').observe(12345, { guildId: 'g1' });
 *   metrics.snapshot(); // { play_requested_total: { '{guildId=g1}': 3 }, ... }
 */

type Labels = Record<string, string | number>;

interface BucketEntry { le: number; count: number }

interface Series {
  count: number;
  sum: number;
  buckets: BucketEntry[];
  min: number;
  max: number;
}

interface SeriesSnapshot {
  count: number; sum: number; avg: number;
  min: number; max: number; buckets: BucketEntry[];
}

class Counter {
  name: string;
  help: string;
  values: Map<string, number>;

  constructor(name: string, help?: string) {
    this.name = name;
    this.help = help || '';
    this.values = new Map();
  }

  private _key(labels?: Labels): string {
    if (!labels) return '';
    const keys = Object.keys(labels).sort();
    return keys.map((k) => `${k}=${labels[k]}`).join(',');
  }

  inc(labels?: Labels, delta?: number): void {
    const key = this._key(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + (delta == null ? 1 : delta));
  }

  get(labels?: Labels): number {
    return this.values.get(this._key(labels)) || 0;
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.values) {
      out[k || '_'] = v;
    }
    return out;
  }

  reset(): void {
    this.values.clear();
  }
}

class Gauge {
  name: string;
  help: string;
  values: Map<string, number>;

  constructor(name: string, help?: string) {
    this.name = name;
    this.help = help || '';
    this.values = new Map();
  }

  private _key(labels?: Labels): string {
    if (!labels) return '';
    const keys = Object.keys(labels).sort();
    return keys.map((k) => `${k}=${labels[k]}`).join(',');
  }

  set(value: number, labels?: Labels): void {
    this.values.set(this._key(labels), value);
  }

  get(labels?: Labels): number {
    return this.values.get(this._key(labels)) || 0;
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.values) {
      out[k || '_'] = v;
    }
    return out;
  }

  reset(): void {
    this.values.clear();
  }
}

class Histogram {
  name: string;
  help: string;
  private buckets: number[];
  private series: Map<string, Series>;

  constructor(name: string, help?: string, buckets?: number[]) {
    this.name = name;
    this.help = help || '';
    this.buckets = buckets || [50, 100, 250, 500, 1000, 2500, 5000, 10000];
    this.series = new Map();
  }

  private _key(labels?: Labels): string {
    if (!labels) return '';
    const keys = Object.keys(labels).sort();
    return keys.map((k) => `${k}=${labels[k]}`).join(',');
  }

  private _emptySeries(): Series {
    return {
      count: 0,
      sum: 0,
      buckets: this.buckets.map((b) => ({ le: b, count: 0 })),
      min: Infinity,
      max: -Infinity,
    };
  }

  observe(value: number, labels?: Labels): void {
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

  snapshot(): Record<string, SeriesSnapshot> {
    const out: Record<string, SeriesSnapshot> = {};
    for (const [k, s] of this.series) {
      out[k || '_'] = {
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

  reset(): void {
    this.series.clear();
  }
}

class Registry {
  private counters: Map<string, Counter>;
  private gauges: Map<string, Gauge>;
  private histograms: Map<string, Histogram>;

  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
  }

  counter(name: string, help?: string): Counter {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter(name, help);
      this.counters.set(name, c);
    }
    return c;
  }

  gauge(name: string, help?: string): Gauge {
    let g = this.gauges.get(name);
    if (!g) {
      g = new Gauge(name, help);
      this.gauges.set(name, g);
    }
    return g;
  }

  histogram(name: string, help?: string, buckets?: number[]): Histogram {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(name, help, buckets);
      this.histograms.set(name, h);
    }
    return h;
  }

  snapshot(): {
    counters: Record<string, { help: string; values: Record<string, number> }>;
    gauges: Record<string, { help: string; values: Record<string, number> }>;
    histograms: Record<string, { help: string; values: Record<string, SeriesSnapshot> }>;
  } {
    const out = {
      counters: {} as Record<string, { help: string; values: Record<string, number> }>,
      gauges: {} as Record<string, { help: string; values: Record<string, number> }>,
      histograms: {} as Record<string, { help: string; values: Record<string, SeriesSnapshot> }>,
    };
    for (const [name, c] of this.counters) {
      out.counters[name] = { help: c.help, values: c.snapshot() };
    }
    for (const [name, g] of this.gauges) {
      out.gauges[name] = { help: g.help, values: g.snapshot() };
    }
    for (const [name, h] of this.histograms) {
      out.histograms[name] = { help: h.help, values: h.snapshot() };
    }
    return out;
  }

  reset(): void {
    for (const c of this.counters.values()) c.reset();
    for (const g of this.gauges.values()) g.reset();
    for (const h of this.histograms.values()) h.reset();
  }
}

export const registry = new Registry();
export function counter(name: string, help?: string): Counter { return registry.counter(name, help); }
export function gauge(name: string, help?: string): Gauge { return registry.gauge(name, help); }
export function histogram(name: string, help?: string, buckets?: number[]): Histogram { return registry.histogram(name, help, buckets); }
export function snapshot(): ReturnType<Registry['snapshot']> { return registry.snapshot(); }
export function reset(): void { registry.reset(); }
export { Counter, Gauge, Histogram, Registry };
