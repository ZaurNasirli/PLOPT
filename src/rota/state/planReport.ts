/**
 * Report of the current plan against the file plan (analytics, report tab, Excel export):
 * the same measures and explanations as after an optimizer run, for any plan, manual edits included.
 */
import type { RotaWorkspace } from '../store/workspace';
import type { RuleSet } from '../rules/types';
import { compileModel, daysToMask, EngineModel } from '../engine/model';
import { baseWeights } from '../engine/pipeline';
import { buildReport, RunReport } from '../engine/report';
import { DAY_DIGIT } from '../types';
import { nameKey } from '../core/names';
import { engineSplit } from './split';

export interface PlanReport {
  model: EngineModel;
  report: RunReport;
}

export function computePlanReport(ws: RotaWorkspace, rules: RuleSet | null, rulesComplete: boolean): PlanReport | null {
  if (!ws.dataset || !rules || !rulesComplete) return null;
  const stores = ws.dataset.stores;
  const model = compileModel({ stores, original: ws.original, current: ws.current, rules, split: engineSplit(ws) });
  const index = new Map(model.parties.map((p, i) => [nameKey(p), i]));
  const mask = Uint8Array.from(stores.map(s => daysToMask(ws.current.days[s.storeCode] ?? s.originalDays, 127)));
  const party = Int32Array.from(stores.map(s => index.get(nameKey(ws.current.party[s.storeCode] ?? s.party)) ?? 0));
  const base = baseWeights(rules, { mode: 'exact', chgFactor: 1, grpFactor: 1, seed: 0 });
  const last = [...rules.phases].reverse().find(p => p.type === 'anneal');
  const origDays = stores.map(s => (ws.original.days[s.storeCode] ?? s.originalDays).map(d => DAY_DIGIT[d] - 1));
  const report = buildReport(model, base, { chg: last?.chgMul ?? 1, grp: last?.grpMul ?? 1 }, { mask, party }, origDays);
  return { model, report };
}
