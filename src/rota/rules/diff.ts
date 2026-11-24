/** What an imported rules file adds / changes / removes compared with the current set */
import type { RotaDict } from '../i18n/ru';
import { nameKey } from '../core/names';
import { SHEET_IDS, SheetId, GENERAL_KEYS, WEIGHT_ORDER } from './schema';
import type { RuleSet } from './types';

export interface SectionDiff {
  section: SheetId;
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
}

const strip = (x: unknown) => JSON.stringify(x, (k, v) => (k === 'id' ? undefined : v));

function keyed(rs: RuleSet | null, id: SheetId, t: RotaDict): Map<string, { label: string; value: string }> {
  const m = new Map<string, { label: string; value: string }>();
  if (!rs) return m;
  switch (id) {
    case 'parties':
      for (const p of rs.parties) m.set(nameKey(p.code || p.name), { label: p.code ? `${p.code} · ${p.name}` : p.name, value: strip(p) });
      break;
    case 'segments':
      for (const s of rs.segments) m.set(`${s.kind}:${nameKey(s.value)}`, { label: `${t.rules.enums.kind[s.kind]} ${s.value}`, value: strip(s) });
      break;
    case 'general':
      for (const k of GENERAL_KEYS) if (rs.general[k] !== null) m.set(k, { label: t.rules.general.labels[k], value: strip(rs.general[k]) });
      break;
    case 'weights':
      for (const c of WEIGHT_ORDER) if (rs.weights[c] !== null) m.set(c, { label: `${c} · ${t.rules.weights.labels[c]}`, value: strip(rs.weights[c]) });
      break;
    case 'algo':
      rs.phases.forEach((p, i) => m.set(String(i + 1), { label: `${t.rules.cols.algo.phase} ${i + 1}${p.type ? ` · ${t.rules.enums.phaseType[p.type]}` : ''}`, value: strip(p) }));
      break;
    case 'stores':
      for (const s of rs.stores) m.set(s.storeCode, { label: s.storeCode, value: strip(s) });
      break;
    case 'matrix':
      for (const r of rs.matrix) m.set(`${r.kind}:${nameKey(r.value)}`, { label: `${t.rules.enums.kind[r.kind]} ${r.value}`, value: strip(r) });
      break;
  }
  return m;
}

export function diffRuleSets(current: RuleSet | null, next: RuleSet, t: RotaDict): SectionDiff[] {
  return SHEET_IDS.map(section => {
    const a = keyed(current, section, t);
    const b = keyed(next, section, t);
    const d: SectionDiff = { section, added: [], changed: [], removed: [], unchanged: 0 };
    for (const [k, v] of b) {
      const old = a.get(k);
      if (!old) d.added.push(v.label);
      else if (old.value !== v.value) d.changed.push(v.label);
      else d.unchanged++;
    }
    for (const [k, v] of a) if (!b.has(k)) d.removed.push(v.label);
    return d;
  });
}
