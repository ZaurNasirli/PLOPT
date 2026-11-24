/**
 * Rota workspace: imported stores, the plan, rule sets and scenarios.
 * Lives outside React so it survives leaving the Rota page; saved to IndexedDB in this browser
 * and synced to the cloud by App (key "rota") like the rest of the user's data.
 * Undo/redo history is kept in memory only.
 */
import { useSyncExternalStore } from 'react';
import type { PlanSnapshot, RotaDataset } from '../types';
import type { RuleSet } from '../rules/types';
import type { RhythmData, SplitMode } from '../core/rhythm';

export type ScenarioKind = 'original' | 'auto' | 'manual';

export interface RotaScenario {
  id: string;
  name: string;
  kind: ScenarioKind;
  createdAt: string;
  plan: PlanSnapshot;
  /** rule set it was computed with, and a copy of its values at that moment */
  ruleSetId: string | null;
  ruleSetName: string | null;
  ruleSetSnapshot: RuleSet | null;
  note?: string;
  /** seed and mode of an automatic run, for reproducing it */
  runInfo?: { seed: number; mode: 'fast' | 'exact' } | null;
}

/** Weekly volumes replaced by a Proqnoz forecast; `previous` keeps the store file values */
export interface VolumeSource {
  kind: 'forecast';
  /** Monday of the forecast week */
  week: string;
  file: string;
  at: string;
  /** store code -> [m³, kg, pcs] of the store file, for the stores the forecast changed */
  previous: Record<string, [number, number, number]>;
}

export interface RotaWorkspace {
  version: 1;
  dataset: RotaDataset | null;
  original: PlanSnapshot;
  current: PlanSnapshot;
  ruleSets: RuleSet[];
  activeRuleSetId: string | null;
  scenarios: RotaScenario[];
  /** real rhythm learned by Proqnoz (null = not learned yet) */
  rhythm: RhythmData | null;
  /** how a store's weekly volume is split over its shipment days */
  splitMode: SplitMode;
  volumeSource: VolumeSource | null;
  updatedAt: string;
}

const HISTORY_LIMIT = 50;
const SAVE_DELAY_MS = 600;
const DB_NAME = 'plopt-rota';
const DB_STORE = 'kv';
const DB_KEY = 'workspace';

export const emptyPlan = (): PlanSnapshot => ({ days: {}, party: {} });

export function emptyWorkspace(): RotaWorkspace {
  return {
    version: 1, dataset: null, original: emptyPlan(), current: emptyPlan(),
    ruleSets: [], activeRuleSetId: null, scenarios: [], rhythm: null, splitMode: 'uniform', volumeSource: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export function planFromDataset(dataset: RotaDataset): PlanSnapshot {
  const plan = emptyPlan();
  for (const s of dataset.stores) {
    plan.days[s.storeCode] = [...s.originalDays];
    plan.party[s.storeCode] = s.party;
  }
  return plan;
}

function validRhythm(x: unknown): x is RhythmData {
  const r = x as Partial<RhythmData> | null;
  return !!r && typeof r === 'object' && Array.isArray(r.chain) && r.chain.length === 7
    && (r.direction === 'forward' || r.direction === 'backward') && !!r.stores && typeof r.stores === 'object';
}

/** Accepts anything (cloud / JSON file / older versions) and returns a valid workspace */
export function normalizeWorkspace(raw: unknown): RotaWorkspace {
  const ws = emptyWorkspace();
  if (!raw || typeof raw !== 'object') return ws;
  const r = raw as Partial<RotaWorkspace>;
  const dataset = r.dataset && Array.isArray(r.dataset.stores) ? r.dataset : null;
  const plan = (p: unknown): PlanSnapshot => {
    const x = p as Partial<PlanSnapshot> | undefined;
    return { days: x && typeof x.days === 'object' && x.days ? { ...x.days } : {}, party: x && typeof x.party === 'object' && x.party ? { ...x.party } : {} };
  };
  ws.dataset = dataset;
  ws.original = plan(r.original);
  ws.current = plan(r.current);
  if (dataset) {
    // stores added after the plan was saved get their file values
    const base = planFromDataset(dataset);
    for (const code of Object.keys(base.days)) {
      if (!ws.original.days[code]) ws.original.days[code] = base.days[code];
      if (!ws.original.party[code]) ws.original.party[code] = base.party[code];
      if (!ws.current.days[code]) ws.current.days[code] = ws.original.days[code];
      if (!ws.current.party[code]) ws.current.party[code] = ws.original.party[code];
    }
  }
  ws.ruleSets = Array.isArray(r.ruleSets) ? r.ruleSets : [];
  ws.activeRuleSetId = typeof r.activeRuleSetId === 'string' && ws.ruleSets.some(x => x.id === r.activeRuleSetId) ? r.activeRuleSetId : ws.ruleSets[0]?.id ?? null;
  ws.scenarios = Array.isArray(r.scenarios) ? r.scenarios : [];
  ws.rhythm = validRhythm(r.rhythm) ? r.rhythm : null;
  ws.splitMode = r.splitMode === 'rhythm' && ws.rhythm ? 'rhythm' : 'uniform';
  ws.volumeSource = r.volumeSource && typeof r.volumeSource === 'object' && r.volumeSource.previous && typeof r.volumeSource.previous === 'object' ? r.volumeSource : null;
  ws.updatedAt = typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString();
  return ws;
}

// ---------------------------------------------------------------------------------------------
// Persistence (IndexedDB, localStorage as fallback)

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<unknown> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(DB_KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, DB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const LS_KEY = 'rota_workspace_v1';
/** written synchronously when the tab closes with a save still pending */
const LS_PENDING_KEY = 'rota_workspace_pending';

function readLs(key: string): { updatedAt?: string } | null {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

async function loadPersisted(): Promise<unknown> {
  let fromDb: { updatedAt?: string } | null = null;
  try {
    fromDb = (await idbGet()) as { updatedAt?: string } | null;
  } catch {
    // no IndexedDB: localStorage only
  }
  const candidates = [fromDb, readLs(LS_KEY), readLs(LS_PENDING_KEY)].filter((x): x is { updatedAt?: string } => Boolean(x));
  candidates.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  return candidates[0] ?? null;
}

async function savePersisted(ws: RotaWorkspace): Promise<void> {
  try {
    await idbPut(ws);
    try { localStorage.removeItem(LS_PENDING_KEY); } catch { /* ignore */ }
    return;
  } catch {
    // fall through
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ws));
  } catch {
    // storage full or blocked: the cloud copy (if signed in) still has it
  }
}

// ---------------------------------------------------------------------------------------------
// Store

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface RotaState {
  ws: RotaWorkspace;
  past: PlanSnapshot[];
  future: PlanSnapshot[];
  loaded: boolean;
  saveState: SaveState;
}

let state: RotaState = { ws: emptyWorkspace(), past: [], future: [], loaded: false, saveState: 'idle' };
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** set once something newer than the browser copy arrived (cloud), so the late browser copy is ignored */
let replacedBeforeLoad = false;

function emit() {
  for (const l of listeners) l();
}

/** version of the workspace that is not yet confirmed written to IndexedDB (0 = nothing pending) */
let pendingVersion = 0;
let versionCounter = 0;

function set(next: Partial<RotaState>, persist: boolean) {
  state = { ...state, ...next };
  if (persist) {
    state = { ...state, saveState: 'saving' };
    const version = ++versionCounter;
    pendingVersion = version;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      savePersisted(state.ws)
        .then(() => {
          if (pendingVersion === version) pendingVersion = 0;
          state = { ...state, saveState: pendingVersion ? 'saving' : 'saved' };
          emit();
        })
        .catch(() => { state = { ...state, saveState: 'error' }; emit(); });
    }, SAVE_DELAY_MS);
  }
  emit();
}

/** The tab is closing or reloading with changes not yet in IndexedDB: keep a synchronous copy */
function savePendingNow() {
  if (!pendingVersion) return;
  try {
    localStorage.setItem(LS_PENDING_KEY, JSON.stringify(state.ws));
  } catch {
    // too big or blocked
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', savePendingNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePendingNow(); });
}

function touch(ws: RotaWorkspace): RotaWorkspace {
  return { ...ws, updatedAt: new Date().toISOString() };
}

let loadStarted = false;
export function ensureRotaLoaded() {
  if (loadStarted || typeof window === 'undefined') return;
  loadStarted = true;
  loadPersisted().then(raw => {
    if (!replacedBeforeLoad && raw) set({ ws: normalizeWorkspace(raw), loaded: true }, false);
    else set({ loaded: true }, false);
  });
}

/** Resolves once the saved workspace is loaded (other modules write into it, e.g. Proqnoz) */
export function whenRotaLoaded(): Promise<void> {
  ensureRotaLoaded();
  if (state.loaded) return Promise.resolve();
  return new Promise(resolve => {
    const l = () => { if (state.loaded) { listeners.delete(l); resolve(); } };
    listeners.add(l);
  });
}

export const rotaStore = {
  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  setDataset(dataset: RotaDataset) {
    const plan = planFromDataset(dataset);
    set({ ws: touch({ ...state.ws, dataset, original: plan, current: plan, scenarios: [], volumeSource: null }), past: [], future: [] }, true);
  },

  clearDataset() {
    set({ ws: touch({ ...state.ws, dataset: null, original: emptyPlan(), current: emptyPlan(), scenarios: [], volumeSource: null }), past: [], future: [] }, true);
  },

  setSplitMode(mode: SplitMode) {
    if (mode === 'rhythm' && !state.ws.rhythm) return;
    set({ ws: touch({ ...state.ws, splitMode: mode }) }, true);
  },

  /** Rhythm from Proqnoz; `splitMode` switches to it when asked */
  setRhythm(rhythm: RhythmData | null, useIt = false) {
    const splitMode = rhythm ? (useIt ? 'rhythm' : state.ws.splitMode) : 'uniform';
    set({ ws: touch({ ...state.ws, rhythm, splitMode }) }, true);
  },

  /** Weekly volumes from a forecast (store code -> [m³, kg, pcs]); the store file values are kept to go back */
  applyForecastVolumes(volumes: Map<string, [number, number, number]>, info: { week: string; file: string }): number {
    const ds = state.ws.dataset;
    if (!ds) return 0;
    const previous = { ...(state.ws.volumeSource?.previous ?? {}) };
    let changed = 0;
    const stores = ds.stores.map(s => {
      const v = volumes.get(s.storeCode);
      if (!v) return s;
      if (!previous[s.storeCode]) previous[s.storeCode] = [s.weeklyVolume, s.weeklyWeight, s.weeklyQty];
      changed++;
      return { ...s, weeklyVolume: v[0], weeklyWeight: v[1], weeklyQty: v[2] };
    });
    if (!changed) return 0;
    set({ ws: touch({ ...state.ws, dataset: { ...ds, stores }, volumeSource: { kind: 'forecast', week: info.week, file: info.file, at: new Date().toISOString(), previous } }) }, true);
    return changed;
  },

  /** Back to the volumes of the store file */
  restoreFileVolumes() {
    const ds = state.ws.dataset, src = state.ws.volumeSource;
    if (!ds || !src) return;
    const stores = ds.stores.map(s => {
      const p = src.previous[s.storeCode];
      return p ? { ...s, weeklyVolume: p[0], weeklyWeight: p[1], weeklyQty: p[2] } : s;
    });
    set({ ws: touch({ ...state.ws, dataset: { ...ds, stores }, volumeSource: null }) }, true);
  },

  /** Any change of days / parties: one undo step */
  updatePlan(updater: (plan: PlanSnapshot) => PlanSnapshot) {
    const next = updater(state.ws.current);
    if (next === state.ws.current) return;
    set({
      ws: touch({ ...state.ws, current: next }),
      past: [...state.past.slice(-(HISTORY_LIMIT - 1)), state.ws.current],
      future: [],
    }, true);
  },

  undo() {
    const prev = state.past[state.past.length - 1];
    if (!prev) return;
    set({ ws: touch({ ...state.ws, current: prev }), past: state.past.slice(0, -1), future: [state.ws.current, ...state.future] }, true);
  },

  redo() {
    const next = state.future[0];
    if (!next) return;
    set({ ws: touch({ ...state.ws, current: next }), past: [...state.past, state.ws.current], future: state.future.slice(1) }, true);
  },

  updateRuleSets(updater: (sets: RuleSet[]) => RuleSet[], activeId?: string | null) {
    const ruleSets = updater(state.ws.ruleSets);
    let active = activeId !== undefined ? activeId : state.ws.activeRuleSetId;
    if (!ruleSets.some(r => r.id === active)) active = ruleSets[0]?.id ?? null;
    set({ ws: touch({ ...state.ws, ruleSets, activeRuleSetId: active }) }, true);
  },

  setActiveRuleSet(id: string) {
    set({ ws: touch({ ...state.ws, activeRuleSetId: id }) }, true);
  },

  updateScenarios(updater: (list: RotaScenario[]) => RotaScenario[]) {
    set({ ws: touch({ ...state.ws, scenarios: updater(state.ws.scenarios) }) }, true);
  },

  /** Cloud copy or an imported JSON file replaces everything (history is cleared) */
  replaceWorkspace(raw: unknown) {
    if (!state.loaded) replacedBeforeLoad = true;
    set({ ws: normalizeWorkspace(raw), past: [], future: [] }, true);
  },
};

export function useRotaState<T>(selector: (s: RotaState) => T): T {
  return useSyncExternalStore(rotaStore.subscribe, () => selector(state), () => selector(state));
}

/** The persisted workspace (what goes to the cloud) */
export function useRotaWorkspace(): RotaWorkspace {
  return useRotaState(s => s.ws);
}
