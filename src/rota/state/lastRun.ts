/** The latest optimizer run of this session (for the report and the scenarios) */
import { useSyncExternalStore } from 'react';
import type { RunOutcome } from '../engine/client';
import type { RuleSet } from '../rules/types';
import type { RunMode } from '../engine/pipeline';

export interface LastRun {
  outcome: RunOutcome;
  ruleSetId: string;
  ruleSetName: string;
  ruleSet: RuleSet;
  mode: RunMode;
  appliedAt: string | null;
}

let lastRun: LastRun | null = null;
const listeners = new Set<() => void>();

export function setLastRun(v: LastRun | null | ((prev: LastRun | null) => LastRun | null)) {
  lastRun = typeof v === 'function' ? v(lastRun) : v;
  for (const l of listeners) l();
}

export function useLastRun(): LastRun | null {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l); },
    () => lastRun,
    () => lastRun
  );
}
