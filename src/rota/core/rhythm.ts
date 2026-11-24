/**
 * Real rhythm of a store: how a week's volume splits between its shipment days.
 *
 * Model: a store consumes goods every day with a weekly pattern (7 weights, sum 1). An order covers
 * a block of days — "forward": from its day until the day before the next order; "backward": the
 * days since the previous order up to its own day. Proqnoz learns the pattern from real orders
 * (and which direction fits the chain better); Ritm uses it to split a store's weekly volume for
 * any schedule. Days are 0 = Monday … 6 = Sunday.
 */

export type RhythmDirection = 'forward' | 'backward';
export type SplitMode = 'uniform' | 'rhythm';

/** Learned rhythm, stored in the Ritm workspace */
export interface RhythmData {
  /** orders file it was learned from */
  source: string;
  /** first and last order date of that file, YYYY-MM-DD */
  from: string;
  to: string;
  createdAt: string;
  direction: RhythmDirection;
  /** chain pattern, used for stores without their own */
  chain: number[];
  /** store code -> pattern (7 numbers, sum 1) */
  stores: Record<string, number[]>;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** Days covered by an order on day d for the given shipment days */
export function blockDays(d: number, days: number[], dir: RhythmDirection): number[] {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const n = sorted.length;
  const i = sorted.indexOf(d);
  let len = 7;
  if (n > 1 && i >= 0) {
    len = dir === 'forward'
      ? ((sorted[(i + 1) % n] - d + 7) % 7) || 7
      : ((d - sorted[(i - 1 + n) % n] + 7) % 7) || 7;
  }
  return Array.from({ length: len }, (_, k) => (dir === 'forward' ? (d + k) % 7 : (d - k + 7) % 7));
}

/** Share of the weekly volume on each weekday of a schedule (7 numbers, 0 on days without shipment) */
export function scheduleShares(profile: number[], days: number[], dir: RhythmDirection): number[] {
  const out = new Array(7).fill(0);
  const uniq = [...new Set(days)];
  if (!uniq.length) return out;
  for (const d of uniq) out[d] = sum(blockDays(d, uniq, dir).map(j => profile[j] ?? 0));
  const total = sum(out);
  if (total > 0) return out.map(x => x / total);
  for (const d of uniq) out[d] = 1 / uniq.length;
  return out;
}

/** Same for a day mask (bit d = weekday d) */
export function maskShares(profile: number[], mask: number, dir: RhythmDirection): number[] {
  const days: number[] = [];
  for (let d = 0; d < 7; d++) if ((mask >> d) & 1) days.push(d);
  return scheduleShares(profile, days, dir);
}

export const uniformShares = (days: number[]): number[] => {
  const out = new Array(7).fill(0);
  const uniq = [...new Set(days)];
  for (const d of uniq) out[d] = 1 / uniq.length;
  return out;
};

/** Pattern of a store: its own, else the chain's */
export function profileOf(rhythm: RhythmData, code: string): number[] {
  return rhythm.stores[code] ?? rhythm.chain;
}

/**
 * Chain pattern that best explains the stores' observed order-day shares (weighted least squares,
 * projected gradient). Returns the pattern and its weighted squared error.
 */
export function fitChainProfile(
  stores: Array<{ days: number[]; shares: number[]; weight: number }>,
  dir: RhythmDirection,
): { profile: number[]; sse: number } {
  let w = new Array(7).fill(1 / 7);
  const usable = stores.filter(s => s.days.length >= 2 && s.weight > 0);
  if (!usable.length) return { profile: w, sse: 0 };
  const totalW = sum(usable.map(s => s.weight));
  const blocks = usable.map(s => s.days.map(d => blockDays(d, s.days, dir)));
  const sseOf = (p: number[]) => {
    let e = 0;
    usable.forEach((s, k) => s.days.forEach((d, j) => { e += (s.weight / totalW) * (sum(blocks[k][j].map(x => p[x])) - s.shares[d]) ** 2; }));
    return e;
  };
  for (let it = 0; it < 600; it++) {
    const g = new Array(7).fill(0);
    usable.forEach((s, k) => s.days.forEach((d, j) => {
      const err = sum(blocks[k][j].map(x => w[x])) - s.shares[d];
      for (const x of blocks[k][j]) g[x] += (2 * err * s.weight) / totalW;
    }));
    w = w.map((x, j) => Math.max(1e-4, x - 0.1 * g[j]));
    const t = sum(w);
    w = w.map(x => x / t);
  }
  return { profile: w, sse: sseOf(w) };
}

/** Store pattern: the chain pattern rescaled inside each block so the store's own shares come back exactly */
export function storeProfile(chain: number[], days: number[], shares: number[], dir: RhythmDirection): number[] {
  if (days.length < 2) return [...chain];
  const p = new Array(7).fill(0);
  const total = sum(days.map(d => shares[d]));
  for (const d of days) {
    const block = blockDays(d, days, dir);
    const base = sum(block.map(j => chain[j]));
    const target = total > 0 ? shares[d] / total : 1 / days.length;
    for (const j of block) p[j] = base > 0 ? (chain[j] / base) * target : target / block.length;
  }
  const t = sum(p);
  return t > 0 ? p.map(x => x / t) : [...chain];
}
