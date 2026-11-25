// Persistent cache of real road distances/durations between points (stores, depot).
//
// Every time the app learns a real road distance (OSRM table or route legs) it is kept here,
// so later routings of the same stores do not ask external servers again.
//
// Layout: one ROW per origin point -> { destination: [km, minutes, dayFetched] }.
//   * local:  IndexedDB (database "plopt-road-cache", store "rows"), always
//   * cloud:  Firestore users/{uid}/roads/{origin} when signed in (shared between devices)
// One document per origin (not per pair) keeps the free Firestore quota tiny:
// a routing of 60 stores reads/writes ~61 documents, not 3600.
//
// Only barrier-free road values are stored; barriers are applied on top of the matrix.

import { CLOUD_ROOT, isFirebaseConfigured, loadFirebase } from './firebaseClient';

export interface RoadCell {
  km: number;
  min: number;
  /** day number (days since 1970-01-01) when the value was fetched */
  day: number;
}

type Row = Map<string, RoadCell>;

/** Values older than this are refreshed from the road network. */
const MAX_AGE_DAYS = 120;
/** Hard cap per row (Firestore document <= 1 MiB; ~45 bytes per cell). */
const MAX_CELLS_PER_ROW = 15000;
const DB_NAME = 'plopt-road-cache';
const STORE = 'rows';
const CLOUD_COLLECTION = 'roads';

export const coordKey = (p: { lat: number; lng: number }) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
const today = () => Math.floor(Date.now() / 86400000);

function encodeRow(row: Row): string {
  const obj: Record<string, [number, number, number]> = {};
  row.forEach((c, k) => { obj[k] = [c.km, c.min, c.day]; });
  return JSON.stringify(obj);
}

function decodeRow(json: string | undefined | null): Row {
  const row: Row = new Map();
  if (!json) return row;
  try {
    const obj = JSON.parse(json) as Record<string, [number, number, number]>;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1])) row.set(k, { km: v[0], min: v[1], day: v[2] || 0 });
    }
  } catch {
    // corrupted row: ignore
  }
  return row;
}

/** Merge b into a, keeping the newest value per destination. */
function mergeRows(a: Row, b: Row): Row {
  b.forEach((cell, k) => {
    const cur = a.get(k);
    if (!cur || cell.day > cur.day) a.set(k, cell);
  });
  return a;
}

// ---------------- IndexedDB (minimal promise wrapper) ----------------
let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbGetMany(keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const db = await openDb();
  if (!db || keys.length === 0) return out;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      for (const k of keys) {
        const r = store.get(k);
        r.onsuccess = () => { if (typeof r.result === 'string') out.set(k, r.result); };
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => resolve(out);
      tx.onabort = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}

async function idbPutMany(entries: [string, string][]): Promise<void> {
  const db = await openDb();
  if (!db || entries.length === 0) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const [k, v] of entries) store.put(v, k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbCount(): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  return new Promise(resolve => {
    try {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).count();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

// ---------------- Cache ----------------
export interface RoadCacheStats {
  rowsInMemory: number;
  cellsInMemory: number;
  /** distances saved in this browser (all sessions) */
  cellsSaved: number;
  /** cells answered from the cache during the last matrix build */
  lastHits: number;
  /** cells fetched from the road network during the last matrix build */
  lastFetched: number;
  cloudEnabled: boolean;
}

const META_KEY = 'road_cache_meta_v1';
function readMeta(): Record<string, number> {
  try { return JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem(META_KEY)) || '{}') || {}; } catch { return {}; }
}

class RoadCache {
  private rows = new Map<string, Row>();
  /** row -> number of saved cells, to show the cache size without reading every row */
  private meta: Record<string, number> = readMeta();
  private loaded = new Set<string>();      // rows already looked up locally (and in the cloud when signed in)
  private loadedCloud = new Set<string>();
  private dirty = new Set<string>();
  private uid: string | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  lastHits = 0;
  lastFetched = 0;

  setUser(uid: string | null) {
    if (uid === this.uid) return;
    this.uid = uid;
    this.loadedCloud.clear();
    // rows learned before sign-in should reach the cloud too
    if (uid) this.rows.forEach((_, k) => this.dirty.add(k));
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify() { this.listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } }); }

  /** Loads the rows of the given origins from IndexedDB and (when signed in) Firestore. */
  async ensureRows(keys: string[]): Promise<void> {
    const unique = Array.from(new Set(keys));
    const needLocal = unique.filter(k => !this.loaded.has(k));
    if (needLocal.length > 0) {
      const local = await idbGetMany(needLocal);
      for (const k of needLocal) {
        this.loaded.add(k);
        const row = decodeRow(local.get(k));
        if (row.size > 0) this.rows.set(k, mergeRows(this.rows.get(k) || new Map(), row));
      }
      this.notify();
    }

    if (this.uid && isFirebaseConfigured) {
      const needCloud = unique.filter(k => !this.loadedCloud.has(k));
      if (needCloud.length > 0) {
        try {
          const { db, fsMod } = await loadFirebase();
          const { collection, query, where, getDocs, documentId } = fsMod;
          const col = collection(db, CLOUD_ROOT, this.uid, CLOUD_COLLECTION);
          for (let i = 0; i < needCloud.length; i += 30) {
            const chunk = needCloud.slice(i, i + 30);
            const snap = await getDocs(query(col, where(documentId(), 'in', chunk)));
            const localCopies: [string, string][] = [];
            snap.forEach(d => {
              const row = decodeRow((d.data() as { data?: string }).data);
              if (row.size > 0) {
                const merged = mergeRows(this.rows.get(d.id) || new Map(), row);
                this.rows.set(d.id, merged);
                localCopies.push([d.id, encodeRow(merged)]);
                this.meta[d.id] = merged.size;
              }
            });
            chunk.forEach(k => this.loadedCloud.add(k));
            // keep a local copy so the cache also works offline on this device
            await idbPutMany(localCopies);
          }
          try { localStorage.setItem(META_KEY, JSON.stringify(this.meta)); } catch { /* ignore */ }
          this.notify();
        } catch (err) {
          console.warn('[RoadCache] cloud read failed', err);
        }
      }
    }
  }

  get(from: string, to: string): RoadCell | undefined {
    const cell = this.rows.get(from)?.get(to);
    if (!cell) return undefined;
    if (today() - cell.day > MAX_AGE_DAYS || cell.day < this.validFromDay) return undefined;
    return cell;
  }

  /** Values fetched before this day are ignored (set by "clear cache"; also hides older cloud copies). */
  private validFromDay = (() => {
    try { return Number((typeof localStorage !== 'undefined' && localStorage.getItem('road_cache_valid_from_day')) || 0); } catch { return 0; }
  })();

  /** "Clear cache": forget everything learned before today (memory + this browser + ignore older cloud values). */
  async clearLocal(): Promise<void> {
    this.rows.clear();
    this.loaded.clear();
    this.loadedCloud.clear();
    this.dirty.clear();
    this.validFromDay = today();
    this.meta = {};
    try {
      localStorage.setItem('road_cache_valid_from_day', String(this.validFromDay));
      localStorage.removeItem(META_KEY);
    } catch { /* ignore */ }
    const db = await openDb();
    if (db) {
      await new Promise<void>(resolve => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
    this.notify();
  }

  put(from: string, to: string, km: number, min: number) {
    if (from === to || !Number.isFinite(km) || !Number.isFinite(min)) return;
    let row = this.rows.get(from);
    if (!row) { row = new Map(); this.rows.set(from, row); }
    row.set(to, { km, min, day: today() });
    if (row.size > MAX_CELLS_PER_ROW) {
      // drop the oldest values
      const sorted = Array.from(row.entries()).sort((a, b) => a[1].day - b[1].day);
      for (let i = 0; i < row.size - MAX_CELLS_PER_ROW; i++) row.delete(sorted[i][0]);
    }
    this.dirty.add(from);
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => { void this.flush(); }, 2500);
  }

  /** Writes changed rows to IndexedDB and Firestore. */
  async flush(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    const keys = Array.from(this.dirty);
    if (keys.length === 0) return;
    this.dirty.clear();
    const entries: [string, string][] = keys.map(k => [k, encodeRow(this.rows.get(k) || new Map())]);
    await idbPutMany(entries);
    keys.forEach(k => { this.meta[k] = this.rows.get(k)?.size || 0; });
    try { localStorage.setItem(META_KEY, JSON.stringify(this.meta)); } catch { /* ignore */ }

    if (this.uid && isFirebaseConfigured) {
      try {
        const { db, fsMod } = await loadFirebase();
        const { collection, doc, writeBatch, serverTimestamp } = fsMod;
        const col = collection(db, CLOUD_ROOT, this.uid, CLOUD_COLLECTION);
        // keep each batch well under Firestore's 10 MiB request limit
        let batch = writeBatch(db);
        let size = 0;
        let ops = 0;
        for (const [k, json] of entries) {
          if (ops >= 400 || size + json.length > 6_000_000) {
            await batch.commit();
            batch = writeBatch(db);
            size = 0;
            ops = 0;
          }
          batch.set(doc(col, k), { from: k, data: json, cells: this.rows.get(k)?.size || 0, updatedAt: serverTimestamp() });
          size += json.length;
          ops++;
        }
        if (ops > 0) await batch.commit();
      } catch (err) {
        console.warn('[RoadCache] cloud write failed, will retry with the next change', err);
        keys.forEach(k => this.dirty.add(k));
      }
    }
    this.notify();
  }

  stats(): RoadCacheStats {
    let cells = 0;
    this.rows.forEach(r => { cells += r.size; });
    return {
      rowsInMemory: this.rows.size,
      cellsInMemory: cells,
      cellsSaved: Math.max(cells, Object.values(this.meta).reduce((a, b) => a + b, 0)),
      lastHits: this.lastHits,
      lastFetched: this.lastFetched,
      cloudEnabled: Boolean(this.uid && isFirebaseConfigured)
    };
  }

  async localRowCount(): Promise<number> {
    return idbCount();
  }
}

export const roadCache = new RoadCache();
