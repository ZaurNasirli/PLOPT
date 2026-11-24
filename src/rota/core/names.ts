import { ALL_WEEKDAYS, DAY_DIGIT, DIGIT_DAY, Weekday } from '../types';

/** Comparison key for party / segment / format / region names: trim, single spaces, case-insensitive */
export function nameKey(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function cleanName(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Picks one spelling for names that differ only in case ("16--00 Part 2" / "16--00 PART 2",
 * "ARAZ" / "Araz"): the most frequent one, ties broken by first appearance.
 * Returns key -> spelling and the list of merged variants for the import report.
 */
export function canonicalSpellings(values: string[]): { spelling: Map<string, string>; merged: Array<{ canonical: string; variants: string[] }> } {
  const counts = new Map<string, Map<string, number>>();
  for (const raw of values) {
    const v = cleanName(raw);
    if (!v) continue;
    const k = v.toLowerCase();
    let m = counts.get(k);
    if (!m) counts.set(k, (m = new Map()));
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  const spelling = new Map<string, string>();
  const merged: Array<{ canonical: string; variants: string[] }> = [];
  for (const [k, m] of counts) {
    let best = '';
    let bestN = -1;
    for (const [v, n] of m) if (n > bestN) { best = v; bestN = n; }
    spelling.set(k, best);
    if (m.size > 1) merged.push({ canonical: best, variants: [...m.keys()].filter(v => v !== best) });
  }
  return { spelling, merged };
}

/** "135" / 135 / "1,3,5" -> days; digits outside 1-7 are reported */
export function parseDayDigits(raw: unknown): { days: Weekday[]; bad: string[] } {
  const text = String(raw ?? '').trim();
  const set = new Set<Weekday>();
  const bad: string[] = [];
  for (const ch of text.replace(/[\s,;/.-]+/g, '')) {
    const d = DIGIT_DAY[+ch];
    if (/\d/.test(ch) && d) set.add(d);
    else bad.push(ch);
  }
  return { days: ALL_WEEKDAYS.filter(d => set.has(d)), bad };
}

export function daysToDigits(days: Weekday[]): string {
  return ALL_WEEKDAYS.filter(d => days.includes(d)).map(d => DAY_DIGIT[d]).join('');
}

export function sortDays(days: Weekday[]): Weekday[] {
  return ALL_WEEKDAYS.filter(d => days.includes(d));
}

export function sameDays(a: Weekday[], b: Weekday[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(d => s.has(d));
}

/** Days written as 1..7 digits, e.g. "123456" -> [Пн..Сб] */
export function digitsToDays(digits: string): Weekday[] {
  return parseDayDigits(digits).days;
}
