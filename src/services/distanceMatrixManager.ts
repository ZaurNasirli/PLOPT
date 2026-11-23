// Smart Distance Matrix Manager
//
// - Real road values come from the persistent road cache (IndexedDB + Firestore) first; only
//   missing pairs are requested from OSRM, and everything learned is stored back.
// - Exact values (metres / seconds precision) — no 0.1 km / whole-minute rounding, which made
//   stops 50–300 m apart indistinguishable in dense city areas.
// - Full real-road coverage up to FULL_COVERAGE_MAX_POINTS points using 50×50 OSRM table blocks;
//   bigger instances use the staged strategy (depot star, corridor clusters, nearest neighbours).
// - Straight-line estimates are used only when OSRM is unreachable, kept in memory with a TTL.

import { getActiveBarriers } from './barriers/barrierStore';
import { applyBarriersToMatrix, BarrierMatrixInfo } from './barriers/barrierMatrix';
import { roadCache, coordKey } from './cloud/roadCache';
import { calculateDistance } from './geo';

export interface MatrixCell {
  distanceKm: number;
  durationMinutes: number;
  isRealRoad: boolean;
  isFallback: boolean;
  isEstimate?: boolean;
  timestamp: number;
}

export interface DistanceMatrixResult {
  // 2D distance matrix in km (row i -> col j)
  distances: number[][];
  // 2D duration matrix in minutes (row i -> col j)
  durations: number[][];
  // True if all non-diagonal cells were computed using real road network
  isRealRoad: boolean;
  // True if any cell used straight-line / Haversine fallback
  hasAnyFallback: boolean;
  // Number of cells fulfilled from cache
  cachedCellsCount: number;
  // Number of cells fetched over network
  fetchedCellsCount: number;
  // Total cells (N * N)
  totalCellsCount: number;
  // Detailed diagnostic statistics
  totalPairs: number;
  roadPairs: number;
  fallbackPairs: number;
  coveragePercent: number;
  routingProvider: string;
  /** Present when road barriers were applied to this matrix */
  barrierInfo?: BarrierMatrixInfo;
}

export interface MatrixCacheStats {
  totalPairs: number;
  roadPairs: number;
  fallbackPairs: number;
  estimatedMemoryKb: number;
}

type Pt = { lat: number; lng: number };

const OSRM_MAX_COORDS = 100;
const BLOCK = 50;
/** Up to this many points the whole matrix is fetched from OSRM (block requests). */
const FULL_COVERAGE_MAX_POINTS = 300;
const MAX_PARALLEL_REQUESTS = 2;

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round2 = (v: number) => Math.round(v * 100) / 100;

class DistanceMatrixManager {
  private static instance: DistanceMatrixManager;

  // In-memory straight-line estimates (used only when OSRM fails), re-tried after the TTL
  private fallbackCache = new Map<string, MatrixCell>();
  private readonly FALLBACK_TTL_MS = 10 * 60 * 1000;
  private readonly LEGACY_STORAGE_KEY = 'smart_dist_matrix_cache_v3';

  private primaryTableUrl = 'https://router.project-osrm.org/table/v1/driving/';
  private backupTableUrl = 'https://routing.openstreetmap.de/routed-car/table/v1/driving/';

  private constructor() {
    this.migrateLegacyStorage();
  }

  public static getInstance(): DistanceMatrixManager {
    if (!DistanceMatrixManager.instance) {
      DistanceMatrixManager.instance = new DistanceMatrixManager();
    }
    return DistanceMatrixManager.instance;
  }

  /** Moves the old localStorage cache (800 pairs max) into the persistent road cache once. */
  private migrateLegacyStorage() {
    try {
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(this.LEGACY_STORAGE_KEY) : null;
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        for (const [key, cell] of parsed as [string, MatrixCell][]) {
          const [from, to] = String(key).split('->');
          if (from && to && cell?.isRealRoad) roadCache.put(from, to, cell.distanceKm, cell.durationMinutes);
        }
      }
      localStorage.removeItem(this.LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  public clearCache(): void {
    this.fallbackCache.clear();
    void roadCache.clearLocal();
  }

  public clearFallbackCache(): void {
    this.fallbackCache.clear();
  }

  public getCacheStats(): MatrixCacheStats {
    const now = Date.now();
    let fallbackPairs = 0;
    this.fallbackCache.forEach(c => { if (now - c.timestamp < this.FALLBACK_TTL_MS) fallbackPairs++; });
    const road = roadCache.stats();
    return {
      totalPairs: road.cellsInMemory + fallbackPairs,
      roadPairs: road.cellsInMemory,
      fallbackPairs,
      estimatedMemoryKb: Math.round(((road.cellsInMemory + fallbackPairs) * 90) / 1024)
    };
  }

  /**
   * OSRM /table query (coordinates <= 100) with the backup endpoint as fallback.
   * Returns metres / seconds.
   */
  private async fetchOsrmTable(
    points: Pt[],
    sources?: number[],
    destinations?: number[]
  ): Promise<{ distances: (number | null)[][]; durations: (number | null)[][] } | null> {
    if (points.length === 0) return null;
    const coordsStr = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const params = new URLSearchParams();
    params.set('annotations', 'distance,duration');
    if (sources && sources.length > 0) params.set('sources', sources.join(';'));
    if (destinations && destinations.length > 0) params.set('destinations', destinations.join(';'));

    for (const base of [this.primaryTableUrl, this.backupTableUrl]) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      try {
        const res = await fetch(`${base}${coordsStr}?${params.toString()}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          if (data.code === 'Ok' && Array.isArray(data.distances) && Array.isArray(data.durations)) {
            return { distances: data.distances, durations: data.durations };
          }
        }
      } catch {
        // try the next endpoint
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  }

  /** Runs async tasks with limited parallelism (be polite to the public OSRM server). */
  private async runLimited(tasks: (() => Promise<void>)[]): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        await task();
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_REQUESTS, tasks.length) }, worker));
  }

  /**
   * Primary Smart Matrix Calculator.
   * Fills from the road cache, fetches only missing pairs from OSRM, falls back cell by cell.
   */
  public async getDistanceMatrix(points: Pt[]): Promise<DistanceMatrixResult> {
    const n = points.length;
    if (n === 0) {
      return {
        distances: [], durations: [], isRealRoad: true, hasAnyFallback: false,
        cachedCellsCount: 0, fetchedCellsCount: 0, totalCellsCount: 0,
        totalPairs: 0, roadPairs: 0, fallbackPairs: 0, coveragePercent: 100,
        routingProvider: 'OSRM Table API'
      };
    }

    const keys = points.map(coordKey);
    await roadCache.ensureRows(keys);

    // NaN = unknown (0 is a valid distance: several orders of the same store share coordinates)
    const distances: number[][] = Array.from({ length: n }, () => new Array(n).fill(NaN));
    const durations: number[][] = Array.from({ length: n }, () => new Array(n).fill(NaN));
    const isReal: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));

    let cachedCellsCount = 0;
    let fetchedCellsCount = 0;
    const now = Date.now();

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j || keys[i] === keys[j]) {
          distances[i][j] = 0; durations[i][j] = 0; isReal[i][j] = true;
          continue;
        }
        const cell = roadCache.get(keys[i], keys[j]);
        if (cell) {
          distances[i][j] = cell.km; durations[i][j] = cell.min; isReal[i][j] = true;
          cachedCellsCount++;
          continue;
        }
        const fb = this.fallbackCache.get(`${keys[i]}->${keys[j]}`);
        if (fb && now - fb.timestamp < this.FALLBACK_TTL_MS) {
          distances[i][j] = fb.distanceKm; durations[i][j] = fb.durationMinutes;
          cachedCellsCount++;
        }
      }
    }

    const missing = (i: number, j: number) => i !== j && Number.isNaN(distances[i][j]);

    const storeRoad = (i: number, j: number, meters: number | null | undefined, seconds: number | null | undefined) => {
      if (typeof meters !== 'number' || typeof seconds !== 'number' || !missing(i, j)) return;
      const km = round3(meters / 1000);
      const min = round2(seconds / 60);
      distances[i][j] = km; durations[i][j] = min; isReal[i][j] = true;
      roadCache.put(keys[i], keys[j], km, min);
      fetchedCellsCount++;
    };

    const storeFallback = (i: number, j: number) => {
      const straightKm = calculateDistance(points[i].lat, points[i].lng, points[j].lat, points[j].lng);
      const km = round3(straightKm * 1.35);
      const min = round2(Math.max(0.5, (km / 38) * 60));
      distances[i][j] = km; durations[i][j] = min;
      this.fallbackCache.set(`${keys[i]}->${keys[j]}`, {
        distanceKm: km, durationMinutes: min, isRealRoad: false, isFallback: true, isEstimate: true, timestamp: Date.now()
      });
      fetchedCellsCount++;
    };

    /** Fetch sources × destinations (global indices) in one OSRM request (|S ∪ D| <= 100). */
    const fetchBlock = async (src: number[], dst: number[]): Promise<boolean> => {
      const union = Array.from(new Set([...src, ...dst]));
      const local = new Map(union.map((g, li) => [g, li]));
      const table = await this.fetchOsrmTable(
        union.map(g => points[g]),
        src.map(g => local.get(g)!),
        dst.map(g => local.get(g)!)
      );
      if (!table) return false;
      src.forEach((gi, si) => dst.forEach((gj, dj) => storeRoad(gi, gj, table.distances[si]?.[dj], table.durations[si]?.[dj])));
      return true;
    };

    const countMissing = () => {
      let c = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (missing(i, j)) c++;
      return c;
    };

    if (countMissing() > 0) {
      if (n <= OSRM_MAX_COORDS) {
        // One request for the whole matrix
        const all = points.map((_, i) => i);
        await fetchBlock(all, all);
      } else if (n <= FULL_COVERAGE_MAX_POINTS) {
        // 50 × 50 blocks: every pair gets a real road value
        const blocks: number[][] = [];
        for (let s = 0; s < n; s += BLOCK) blocks.push(points.map((_, i) => i).slice(s, s + BLOCK));
        let failures = 0;
        const tasks: (() => Promise<void>)[] = [];
        for (const a of blocks) {
          for (const b of blocks) {
            tasks.push(async () => {
              if (failures >= 3) return; // OSRM unreachable: stop hammering it
              const needed = a.some(i => b.some(j => missing(i, j)));
              if (!needed) return;
              const ok = await fetchBlock(a, b);
              if (!ok) failures++;
            });
          }
        }
        await this.runLimited(tasks);
      } else {
        await this.fetchLargeInstance(points, missing, fetchBlock);
      }
    }

    // Anything still unknown: calibrated straight-line estimate
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (missing(i, j)) storeFallback(i, j);

    // --- Coverage statistics ---
    const totalPairs = n * (n - 1);
    let roadPairs = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && isReal[i][j]) roadPairs++;
    const fallbackPairs = totalPairs - roadPairs;
    const coveragePercent = totalPairs > 0 ? Math.round((roadPairs / totalPairs) * 1000) / 10 : 100;
    const routingProviderName = fallbackPairs === 0
      ? 'OSRM Table API (100% Road Network)'
      : roadPairs > 0
        ? `OSRM Table API (${coveragePercent}% Road Coverage, ${fallbackPairs} Estimate Pairs)`
        : 'OSRM Offline (Haversine Calibrated)';

    roadCache.lastHits = cachedCellsCount;
    roadCache.lastFetched = fetchedCellsCount;
    void roadCache.flush();

    // Road barriers: correct the cells whose fastest route goes through a closed road.
    // The cached base cells stay barrier-free; corrected values live only in this result.
    let finalDistances = distances;
    let finalDurations = durations;
    let barrierInfo: BarrierMatrixInfo | undefined;
    const barriers = getActiveBarriers();
    if (barriers.length > 0 && n > 1) {
      try {
        const corrected = await applyBarriersToMatrix(points, distances, durations, barriers);
        finalDistances = corrected.distances;
        finalDurations = corrected.durations;
        barrierInfo = corrected.info;
      } catch (err) {
        console.warn('[Barriers] matrix correction failed, using base matrix', err);
      }
    }

    return {
      distances: finalDistances,
      durations: finalDurations,
      barrierInfo,
      isRealRoad: fallbackPairs === 0,
      hasAnyFallback: fallbackPairs > 0,
      cachedCellsCount,
      fetchedCellsCount,
      totalCellsCount: n * n,
      totalPairs,
      roadPairs,
      fallbackPairs,
      coveragePercent,
      routingProvider: routingProviderName
    };
  }

  /**
   * Very large instances (> FULL_COVERAGE_MAX_POINTS): real road values where they matter most —
   * depot ↔ every point, inside angular corridors, and each point's nearest neighbours.
   * Repeated routings of the same stores gradually fill the rest through the road cache.
   */
  private async fetchLargeInstance(
    points: Pt[],
    missing: (i: number, j: number) => boolean,
    fetchBlock: (src: number[], dst: number[]) => Promise<boolean>
  ): Promise<void> {
    const n = points.length;
    const nonDepot = Array.from({ length: n - 1 }, (_, i) => i + 1);
    let failures = 0;
    const tasks: (() => Promise<void>)[] = [];
    const add = (src: number[], dst: number[]) => tasks.push(async () => {
      if (failures >= 3) return;
      if (!src.some(i => dst.some(j => missing(i, j)))) return;
      if (!(await fetchBlock(src, dst))) failures++;
    });

    // Depot star (both directions), 99 points per request
    for (let s = 0; s < nonDepot.length; s += OSRM_MAX_COORDS - 1) {
      const batch = nonDepot.slice(s, s + OSRM_MAX_COORDS - 1);
      add([0], batch);
      add(batch, [0]);
    }

    // Angular corridors around the depot: full matrix inside each group of 50
    const sorted = [...nonDepot].sort((a, b) =>
      Math.atan2(points[a].lat - points[0].lat, points[a].lng - points[0].lng) -
      Math.atan2(points[b].lat - points[0].lat, points[b].lng - points[0].lng));
    const groups: number[][] = [];
    for (let i = 0; i < sorted.length; i += BLOCK) groups.push(sorted.slice(i, i + BLOCK));
    groups.forEach(g => add(g, g));
    // Bridges between neighbouring corridors
    for (let c = 0; c < groups.length; c++) {
      const next = groups[(c + 1) % groups.length];
      if (next === groups[c]) continue;
      add(groups[c].slice(-25), next.slice(0, 25));
      add(next.slice(0, 25), groups[c].slice(-25));
    }

    // 10 nearest neighbours of every point
    const knn = (i: number) => nonDepot
      .filter(j => j !== i)
      .map(j => ({ j, d: calculateDistance(points[i].lat, points[i].lng, points[j].lat, points[j].lng) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 10)
      .map(x => x.j);
    for (let s = 1; s < n; s += 9) {
      const src = Array.from({ length: Math.min(9, n - s) }, (_, k) => s + k);
      const dst = Array.from(new Set(src.flatMap(knn))).slice(0, OSRM_MAX_COORDS - src.length);
      add(src, dst);
    }

    await this.runLimited(tasks);
  }
}

export const distanceMatrixManager = DistanceMatrixManager.getInstance();
