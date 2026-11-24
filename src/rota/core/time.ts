/**
 * Time windows ("08:00 - 16:00", "16:00 - 02:00", "7/24", empty).
 * Same rules as the reference (opt2.py): an end at or before the start runs past midnight,
 * and overlap is checked with the second window shifted by -1 / 0 / +1 day, so windows
 * crossing midnight are handled on both sides.
 */

export type TimeWindow =
  | { kind: 'always' }
  | { kind: 'window'; start: number; end: number }
  /** empty (or "7/24") while the rules do not count it as round-the-clock: unknown */
  | { kind: 'unknown' }
  | { kind: 'invalid'; text: string };

export interface WindowOptions {
  /** empty receiving time = 24/7 */
  emptyIs247: boolean;
  /** "7/24" = round-the-clock */
  s724Is247: boolean;
}

/** Used where no rules exist yet (manual editing without rules) */
export const LENIENT_WINDOW_OPTIONS: WindowOptions = { emptyIs247: true, s724Is247: true };

const RANGE_RE = /^(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})$/;
const ROUND_CLOCK_RE = /^(7\s*\/\s*24|24\s*\/\s*7)$/;

export function isRoundTheClockText(raw: unknown): boolean {
  return ROUND_CLOCK_RE.test(String(raw ?? '').trim());
}

export function parseWindow(raw: unknown, opts: WindowOptions): TimeWindow {
  const text = String(raw ?? '').trim();
  if (!text) return opts.emptyIs247 ? { kind: 'always' } : { kind: 'unknown' };
  if (ROUND_CLOCK_RE.test(text)) return opts.s724Is247 ? { kind: 'always' } : { kind: 'unknown' };
  const m = RANGE_RE.exec(text);
  if (!m) return { kind: 'invalid', text };
  const h1 = +m[1], m1 = +m[2], h2 = +m[3], m2 = +m[4];
  if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59 || (h1 === 24 && m1 > 0) || (h2 === 24 && m2 > 0)) return { kind: 'invalid', text };
  const start = (h1 % 24) * 60 + m1;
  let end = h2 * 60 + m2;
  if (end <= start) end += 1440;
  return { kind: 'window', start, end };
}

/** Strict "HH:MM - HH:MM" (what the rules sheet expects) */
export function isStrictWindowText(raw: unknown): boolean {
  const text = String(raw ?? '').trim();
  const m = /^(\d{2}):(\d{2}) - (\d{2}):(\d{2})$/.exec(text);
  if (!m) return false;
  return +m[1] <= 24 && +m[3] <= 24 && +m[2] <= 59 && +m[4] <= 59;
}

/**
 * Do two windows overlap? `touchCounts`: windows that only touch (08:00 and 08:00) count as overlapping.
 * Unknown or invalid windows never overlap (the party cannot be checked, so it is not allowed).
 */
export function windowsOverlap(a: TimeWindow, b: TimeWindow, touchCounts: boolean): boolean {
  if (a.kind === 'always' && b.kind !== 'unknown' && b.kind !== 'invalid') return true;
  if (b.kind === 'always' && a.kind !== 'unknown' && a.kind !== 'invalid') return true;
  if (a.kind !== 'window' || b.kind !== 'window') return false;
  for (const sh of [-1440, 0, 1440]) {
    const s = a.start + sh, e = a.end + sh;
    if (touchCounts ? s <= b.end && b.start <= e : s < b.end && b.start < e) return true;
  }
  return false;
}

export function formatWindow(w: TimeWindow): string {
  if (w.kind === 'always') return '24/7';
  if (w.kind !== 'window') return w.kind === 'invalid' ? w.text : '';
  const f = (x: number) => `${String(Math.floor((x % 1440) / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  return `${f(w.start)} - ${f(w.end)}`;
}
