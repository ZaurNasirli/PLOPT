/**
 * Store directory shared by Yol, Ritm and Proqnoz: one card per store.
 * Lives outside React (so every module reads the same list), saved to localStorage and synced to
 * the cloud by App under the existing key "storeDirectory".
 */
import { useSyncExternalStore } from 'react';
import type { StoreRecord } from '../types';
import { storeKeyOf } from '../services/storeDirectory';

const LS_KEY = 'store_directory_v1';

function load(): StoreRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let list: StoreRecord[] = typeof window === 'undefined' ? [] : load();
const listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // storage full: the cloud copy still has it
  }
}

export const directoryStore = {
  get: () => list,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  set(next: StoreRecord[] | ((prev: StoreRecord[]) => StoreRecord[])) {
    list = typeof next === 'function' ? next(list) : next;
    save();
    for (const l of listeners) l();
  },
};

export function useDirectory(): StoreRecord[] {
  return useSyncExternalStore(directoryStore.subscribe, directoryStore.get, directoryStore.get);
}

// ------------------------------------------------------------------------------------------------
// Imports: what a file says about a store vs. the directory

/** Fields a file can bring; the same names as in StoreRecord */
export type DirField = 'name' | 'region' | 'format' | 'coords' | 'receivingWindow' | 'address' | 'contactPerson' | 'phone' | 'access' | 'vehicleLimits' | 'notes';
export const DIR_FIELDS: DirField[] = ['name', 'region', 'format', 'coords', 'receivingWindow', 'address', 'contactPerson', 'phone', 'access', 'vehicleLimits', 'notes'];

export interface IncomingStore {
  code: string;
  name?: string;
  region?: string;
  format?: string;
  lat?: number | null;
  lng?: number | null;
  receivingWindow?: string;
  address?: string;
  contactPerson?: string;
  phone?: string;
  access?: string;
  vehicleLimits?: string;
  notes?: string;
}

export interface DirConflict {
  id: string;
  key: string;
  code: string;
  name: string;
  field: DirField;
  dirValue: string;
  fileValue: string;
}

const norm = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const has = (s: unknown) => String(s ?? '').trim() !== '';
const coordText = (lat?: number | null, lng?: number | null) => (lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '');
const validCoord = (lat?: number | null, lng?: number | null) => lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

export function findRecord(dir: StoreRecord[], code: string, name?: string): StoreRecord | undefined {
  const key = storeKeyOf(code, name);
  return dir.find(r => r.key === key) ?? (code ? undefined : dir.find(r => norm(r.name) === norm(name)));
}

/** Differences between a file and the directory (only where both have a value) */
export function findConflicts(dir: StoreRecord[], incoming: IncomingStore[]): DirConflict[] {
  const out: DirConflict[] = [];
  for (const s of incoming) {
    const r = findRecord(dir, s.code, s.name);
    if (!r) continue;
    for (const field of DIR_FIELDS) {
      let dv: string, fv: string, differ: boolean;
      if (field === 'coords') {
        if (!validCoord(s.lat, s.lng) || !validCoord(r.lat, r.lng)) continue;
        dv = coordText(r.lat, r.lng);
        fv = coordText(s.lat, s.lng);
        // about 10 m
        differ = Math.abs(r.lat - (s.lat as number)) > 1e-4 || Math.abs(r.lng - (s.lng as number)) > 1e-4;
      } else {
        const fileVal = s[field];
        const dirVal = r[field];
        if (!has(fileVal) || !has(dirVal)) continue;
        dv = String(dirVal).trim();
        fv = String(fileVal).trim();
        differ = norm(dv) !== norm(fv);
      }
      if (differ) out.push({ id: `${r.key}|${field}`, key: r.key, code: r.code || s.code, name: r.name || s.name || '', field, dirValue: dv, fileValue: fv });
    }
  }
  return out;
}

/** 'file' = the file wins for this conflict; missing = the directory wins */
export type Resolution = Map<string, 'dir' | 'file'>;

/**
 * Applies a file to the directory: new stores are added, empty directory fields are filled,
 * conflicting fields follow the resolution. Returns the values to use for each incoming store.
 */
export function applyIncoming(incoming: IncomingStore[], resolution: Resolution): Map<string, StoreRecord> {
  const now = new Date().toISOString();
  const result = new Map<string, StoreRecord>();
  directoryStore.set(prev => {
    const next = [...prev];
    const index = new Map(next.map((r, i) => [r.key, i]));
    for (const s of incoming) {
      if (!has(s.code) && !has(s.name)) continue;
      const existing = findRecord(next, s.code, s.name);
      const key = existing?.key ?? storeKeyOf(s.code, s.name);
      const rec: StoreRecord = existing
        ? { ...existing, lastSeen: now, imports: existing.imports + 1 }
        : { key, code: s.code, name: s.name ?? s.code, lat: NaN, lng: NaN, firstSeen: now, lastSeen: now, imports: 1 };
      for (const field of DIR_FIELDS) {
        const choice = resolution.get(`${key}|${field}`);
        if (field === 'coords') {
          if (!validCoord(s.lat, s.lng)) continue;
          if (!validCoord(rec.lat, rec.lng) || choice === 'file') { rec.lat = s.lat as number; rec.lng = s.lng as number; }
          continue;
        }
        const v = s[field];
        if (!has(v)) continue;
        if (!has(rec[field]) || choice === 'file') (rec as unknown as Record<string, unknown>)[field] = String(v).trim();
      }
      rec.updatedAt = now;
      if (existing) next[index.get(existing.key)!] = rec;
      else { index.set(key, next.length); next.push(rec); }
      result.set(norm(s.code) || norm(s.name), rec);
    }
    return next;
  });
  return result;
}

export const resolvedKey = (code: string, name?: string) => norm(code) || norm(name);
