/**
 * How a store's weekly volume splits over its shipment days: evenly (weekly / number of days) or
 * by the real rhythm learned in Proqnoz. Returns null for the even split so callers keep the
 * exact "weekly / n" arithmetic of the reference.
 */
import { DAY_DIGIT, Weekday } from '../types';
import { profileOf, scheduleShares } from '../core/rhythm';
import type { RotaWorkspace } from '../store/workspace';
import type { EngineSplit } from '../engine/model';

export type Splitter = (code: string, days: Weekday[]) => number[];

export function makeSplitter(ws: Pick<RotaWorkspace, 'splitMode' | 'rhythm'>): Splitter | null {
  const r = ws.rhythm;
  if (ws.splitMode !== 'rhythm' || !r) return null;
  return (code, days) => scheduleShares(profileOf(r, code), days.map(d => DAY_DIGIT[d] - 1), r.direction);
}

/** What the optimizer needs for the rhythm split (null = even split) */
export function engineSplit(ws: Pick<RotaWorkspace, 'splitMode' | 'rhythm'>): EngineSplit | null {
  const r = ws.rhythm;
  return ws.splitMode === 'rhythm' && r ? { direction: r.direction, chain: r.chain, stores: r.stores } : null;
}
