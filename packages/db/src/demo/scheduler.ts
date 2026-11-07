import { realNow, setClock, withClock } from './clock';

// A small discrete event simulation. Each store has its own queue, worked through in time
// order with its own clock; company wide events (finance, the evening cash count, SLA
// checks) are barriers: every store first catches up to the event's time, then the event
// runs alone. Stores can therefore be simulated side by side over a slow network.

export type Task = () => Promise<void>;
interface Item {
  at: number;
  seq: number;
  run: Task;
}

/** The latest moment an event may run: a little before the real current time. */
export const cutoff = () => realNow() - 30_000;

class Queue {
  private items: Item[] = [];
  private seq = 0;

  push(at: number, run: Task) {
    const item = { at, seq: this.seq++, run };
    // Binary insert keeps the queue sorted by time, then by insertion.
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = this.items[mid]!;
      if (m.at < at || (m.at === at && m.seq < item.seq)) lo = mid + 1;
      else hi = mid;
    }
    this.items.splice(lo, 0, item);
  }

  peek() {
    return this.items[0];
  }

  shift() {
    return this.items.shift();
  }

  get size() {
    return this.items.length;
  }
}

export class Simulation {
  private stores = new Map<string, Queue>();
  private globals = new Queue();
  skipped = 0;

  constructor(private readonly parallel: boolean) {}

  /** Schedules work in one store's timeline. */
  atStore(storeId: string, at: number, run: Task) {
    let q = this.stores.get(storeId);
    if (!q) {
      q = new Queue();
      this.stores.set(storeId, q);
    }
    q.push(at, run);
  }

  /** Schedules company wide work; every store catches up to `at` first. */
  atGlobal(at: number, run: Task) {
    this.globals.push(at, run);
  }

  private async drainStore(q: Queue, until: number) {
    for (let item = q.peek(); item && item.at < until; item = q.peek()) {
      q.shift();
      if (item.at > cutoff()) {
        this.skipped++;
        continue;
      }
      await withClock(item.at, item.run);
    }
  }

  private async drainStores(until: number) {
    const queues = [...this.stores.values()];
    if (this.parallel) await Promise.all(queues.map((q) => this.drainStore(q, until)));
    else for (const q of queues) await this.drainStore(q, until);
  }

  /** Runs everything scheduled, in time order, up to the real current time. */
  async run() {
    for (let g = this.globals.shift(); g; g = this.globals.shift()) {
      await this.drainStores(g.at);
      if (g.at > cutoff()) {
        this.skipped++;
        continue;
      }
      setClock(g.at);
      await g.run();
    }
    await this.drainStores(cutoff());
    for (const q of this.stores.values()) this.skipped += q.size;
  }
}

/** A seeded random source (mulberry32), so a run is repeatable. */
export function randomSource(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** A float in [min, max) */
    between: (min: number, max: number) => min + next() * (max - min),
    /** An integer in [min, max] */
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
    weighted: <T>(list: readonly (readonly [T, number])[]): T => {
      const total = list.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [value, w] of list) {
        r -= w;
        if (r < 0) return value;
      }
      return list[list.length - 1]![0];
    },
  };
}
export type Random = ReturnType<typeof randomSource>;
