// Smart Distance Matrix Manager
// Features: Coordinate-keyed caching, Incremental calculations, Safe chunking,
// Resilient OSRM fallback, Explicit road vs straight-line separation, and Cache clearing.

import { routingProvider } from './routingProvider';

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

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
}

export interface MatrixCacheStats {
  totalPairs: number;
  roadPairs: number;
  fallbackPairs: number;
  estimatedMemoryKb: number;
}

class DistanceMatrixManager {
  private static instance: DistanceMatrixManager;

  // In-memory pairwise cache
  private pairCache = new Map<string, MatrixCell>();
  private readonly STORAGE_KEY = 'smart_dist_matrix_cache_v3';
  private readonly MAX_CACHE_ENTRIES = 25000;
  // Fallback cache TTL: 10 minutes so subsequent optimizations re-attempt OSRM queries
  private readonly FALLBACK_TTL_MS = 10 * 60 * 1000;

  private primaryTableUrl = 'https://router.project-osrm.org/table/v1/driving/';
  private backupTableUrl = 'https://routing.openstreetmap.de/routed-car/table/v1/driving/';

  private constructor() {
    this.loadFromStorage();
  }

  public static getInstance(): DistanceMatrixManager {
    if (!DistanceMatrixManager.instance) {
      DistanceMatrixManager.instance = new DistanceMatrixManager();
    }
    return DistanceMatrixManager.instance;
  }

  private coordKey(p: { lat: number; lng: number }): string {
    return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  }

  private pairKey(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): string {
    return `${this.coordKey(p1)}->${this.coordKey(p2)}`;
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          parsed.forEach(([k, v]: [string, MatrixCell]) => {
            // ONLY restore REAL ROAD pairs from permanent storage
            if (v && v.isRealRoad) {
              this.pairCache.set(k, v);
            }
          });
        }
      }
    } catch {
      // Storage unavailable or quota exceeded; fallback to in-memory only
    }
  }

  private persistDebounced = (() => {
    let timer: any = null;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          // Store only verified real road entries in localStorage
          const realEntries: [string, MatrixCell][] = [];
          this.pairCache.forEach((cell, key) => {
            if (cell.isRealRoad && realEntries.length < 800) {
              realEntries.push([key, cell]);
            }
          });
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(realEntries));
        } catch {
          // Quota exceeded - ignore or clear
        }
      }, 3000);
    };
  })();

  public clearCache(): void {
    this.pairCache.clear();
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  public clearFallbackCache(): void {
    const keysToDelete: string[] = [];
    this.pairCache.forEach((cell, key) => {
      if (cell.isFallback) keysToDelete.push(key);
    });
    keysToDelete.forEach(k => this.pairCache.delete(k));
  }

  public getCacheStats(): MatrixCacheStats {
    let roadPairs = 0;
    let fallbackPairs = 0;
    const now = Date.now();
    this.pairCache.forEach(cell => {
      if (cell.isRealRoad) {
        roadPairs++;
      } else if (now - cell.timestamp < this.FALLBACK_TTL_MS) {
        fallbackPairs++;
      }
    });

    const estimatedMemoryKb = Math.round((this.pairCache.size * 90) / 1024);

    return {
      totalPairs: roadPairs + fallbackPairs,
      roadPairs,
      fallbackPairs,
      estimatedMemoryKb
    };
  }

  /**
   * Helper to perform OSRM /table query with retries and fallback endpoints.
   */
  private async fetchOsrmTable(
    points: { lat: number; lng: number }[],
    sources?: number[],
    destinations?: number[],
    retries: number = 1
  ): Promise<{ distances: number[][]; durations: number[][] } | null> {
    if (points.length === 0) return null;
    const coordsStr = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const params = new URLSearchParams();
    params.set('annotations', 'distance,duration');
    if (sources && sources.length > 0) {
      params.set('sources', sources.join(';'));
    }
    if (destinations && destinations.length > 0) {
      params.set('destinations', destinations.join(';'));
    }

    const queryUrl = (base: string) => `${base}${coordsStr}?${params.toString()}`;
    const endpoints = [this.primaryTableUrl, this.backupTableUrl];

    for (let attempt = 0; attempt < retries; attempt++) {
      for (const base of endpoints) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3200);
          const res = await fetch(queryUrl(base), { signal: controller.signal });
          clearTimeout(timeout);

          if (res.ok) {
            const data = await res.json();
            if (data.code === 'Ok' && Array.isArray(data.distances)) {
              return {
                distances: data.distances,
                durations: data.durations || data.distances.map((row: number[]) => row.map(d => (d / 1000) * 1.5 * 60))
              };
            }
          }
        } catch {
          // Endpoint or timeout failed, proceed to next
        }
      }
    }

    return null;
  }

  /**
   * Primary Smart Matrix Calculator
   * Checks cache for all N*N pairs. If missing, chunk-fetches from OSRM with retries,
   * falls back only cell-by-cell, and computes exact coverage statistics.
   */
  public async getDistanceMatrix(points: { lat: number; lng: number }[]): Promise<DistanceMatrixResult> {
    const n = points.length;
    if (n === 0) {
      return {
        distances: [],
        durations: [],
        isRealRoad: true,
        hasAnyFallback: false,
        cachedCellsCount: 0,
        fetchedCellsCount: 0,
        totalCellsCount: 0,
        totalPairs: 0,
        roadPairs: 0,
        fallbackPairs: 0,
        coveragePercent: 100,
        routingProvider: 'OSRM Table API'
      };
    }

    // Initialize 2D matrices
    const distances: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const durations: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

    let cachedCellsCount = 0;
    let fetchedCellsCount = 0;
    const now = Date.now();

    // Check which (i, j) pairs are cached (real road or non-expired fallback)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          distances[i][j] = 0;
          durations[i][j] = 0;
          continue;
        }

        const key = this.pairKey(points[i], points[j]);
        const cached = this.pairCache.get(key);

        if (cached) {
          if (cached.isRealRoad) {
            distances[i][j] = cached.distanceKm;
            durations[i][j] = cached.durationMinutes;
            cachedCellsCount++;
          } else if (now - cached.timestamp < this.FALLBACK_TTL_MS) {
            // Still in fallback TTL window
            distances[i][j] = cached.distanceKm;
            durations[i][j] = cached.durationMinutes;
            cachedCellsCount++;
          }
        }
      }
    }

    // Helper to store real road cell
    const storeRoadCell = (i: number, j: number, km: number, mins: number) => {
      distances[i][j] = km;
      durations[i][j] = mins;
      this.pairCache.set(this.pairKey(points[i], points[j]), {
        distanceKm: km,
        durationMinutes: mins,
        isRealRoad: true,
        isFallback: false,
        isEstimate: false,
        timestamp: Date.now()
      });
      fetchedCellsCount++;
    };

    // Helper to store calibrated fallback cell
    const storeFallbackCell = (i: number, j: number) => {
      const straightKm = Math.round(calculateDistance(points[i].lat, points[i].lng, points[j].lat, points[j].lng) * 10) / 10;
      const roadEstKm = Math.round(straightKm * 1.35 * 10) / 10;
      const roadEstMins = Math.max(1, Math.round((roadEstKm / 38) * 60));

      distances[i][j] = roadEstKm;
      durations[i][j] = roadEstMins;

      // In-memory only with TTL so future calls re-attempt real OSRM
      this.pairCache.set(this.pairKey(points[i], points[j]), {
        distanceKm: roadEstKm,
        durationMinutes: roadEstMins,
        isRealRoad: false,
        isFallback: true,
        isEstimate: true,
        timestamp: Date.now()
      });
      fetchedCellsCount++;
    };

    // --- EXECUTE QUERIES ---
    const MAX_SMALL_INSTANCE = 65; // Complete N x N in a single URL (OSRM public table limit is 100)

    if (n <= MAX_SMALL_INSTANCE) {
      // Small/medium instance: fetch complete N x N matrix in one call
      const missingCount = distances.flat().filter((d, idx) => {
        const row = Math.floor(idx / n);
        const col = idx % n;
        return row !== col && d === 0;
      }).length;

      if (missingCount > 0) {
        const tableData = await this.fetchOsrmTable(points);
        if (tableData && tableData.distances) {
          for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
              if (i === j) continue;
              if (distances[i][j] > 0) continue;

              const distMeters = tableData.distances[i]?.[j];
              const durSec = tableData.durations?.[i]?.[j];

              if (typeof distMeters === 'number' && distMeters !== null) {
                const km = Math.round((distMeters / 1000) * 10) / 10;
                const mins = Math.max(1, Math.round((durSec || (km * 1.5 * 60)) / 60));
                storeRoadCell(i, j, km, mins);
              } else {
                storeFallbackCell(i, j);
              }
            }
          }
        } else {
          // OSRM failed, mark fallback
          for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
              if (i !== j && distances[i][j] === 0) {
                storeFallbackCell(i, j);
              }
            }
          }
        }
      }
    } else {
      // Large instance (66+ stores):
      // Circuit breaker if OSRM is unreachable or rate-limiting so we don't hang for minutes
      let osrmFailedCount = 0;
      const isOsrmCircuitOpen = () => osrmFailedCount >= 2;

      // Stage A: DEPOT STAR GRAPH (0 -> all points, and all points -> 0)
      const nonDepotIndices = Array.from({ length: n - 1 }, (_, idx) => idx + 1);
      const BATCH_DEST_SIZE = 50;

      for (let s = 0; s < nonDepotIndices.length; s += BATCH_DEST_SIZE) {
        if (isOsrmCircuitOpen()) break;
        const batch = nonDepotIndices.slice(s, s + BATCH_DEST_SIZE);
        const needsOutbound = batch.some(j => distances[0][j] === 0);
        const needsInbound = batch.some(i => distances[i][0] === 0);

        if (needsOutbound || needsInbound) {
          const subPts = [points[0], ...batch.map(idx => points[idx])];
          const subTable = await this.fetchOsrmTable(subPts);
          if (subTable && subTable.distances) {
            for (let bIdx = 0; bIdx < batch.length; bIdx++) {
              const globalIdx = batch[bIdx];
              const subIdx = bIdx + 1;

              // Depot -> Point
              if (distances[0][globalIdx] === 0) {
                const dM = subTable.distances[0]?.[subIdx];
                const dS = subTable.durations?.[0]?.[subIdx];
                if (typeof dM === 'number' && dM !== null) {
                  const km = Math.round((dM / 1000) * 10) / 10;
                  const mins = Math.max(1, Math.round((dS || (km * 1.5 * 60)) / 60));
                  storeRoadCell(0, globalIdx, km, mins);
                }
              }
              // Point -> Depot
              if (distances[globalIdx][0] === 0) {
                const dM = subTable.distances[subIdx]?.[0];
                const dS = subTable.durations?.[subIdx]?.[0];
                if (typeof dM === 'number' && dM !== null) {
                  const km = Math.round((dM / 1000) * 10) / 10;
                  const mins = Math.max(1, Math.round((dS || (km * 1.5 * 60)) / 60));
                  storeRoadCell(globalIdx, 0, km, mins);
                }
              }
            }
          } else {
            osrmFailedCount++;
          }
        }
      }

      // Stage B: SPATIAL CORRIDOR CLUSTERS (dense real road within each geographical cluster)
      const sortedByAngle = [...nonDepotIndices].sort((a, b) => {
        const angA = Math.atan2(points[a].lat - points[0].lat, points[a].lng - points[0].lng);
        const angB = Math.atan2(points[b].lat - points[0].lat, points[b].lng - points[0].lng);
        return angA - angB;
      });

      const CLUSTER_SIZE = 28;
      const clusters: number[][] = [];
      for (let i = 0; i < sortedByAngle.length; i += CLUSTER_SIZE) {
        clusters.push(sortedByAngle.slice(i, i + CLUSTER_SIZE));
      }

      for (const cluster of clusters) {
        if (isOsrmCircuitOpen()) break;
        let hasMissing = false;
        for (const i of cluster) {
          for (const j of cluster) {
            if (i !== j && distances[i][j] === 0) {
              hasMissing = true;
              break;
            }
          }
          if (hasMissing) break;
        }

        if (hasMissing) {
          const subPts = cluster.map(idx => points[idx]);
          const subTable = await this.fetchOsrmTable(subPts);
          if (subTable && subTable.distances) {
            for (let a = 0; a < cluster.length; a++) {
              for (let b = 0; b < cluster.length; b++) {
                if (a === b) continue;
                const realI = cluster[a];
                const realJ = cluster[b];
                if (distances[realI][realJ] > 0) continue;

                const distM = subTable.distances[a]?.[b];
                const durS = subTable.durations?.[a]?.[b];
                if (typeof distM === 'number' && distM !== null) {
                  const km = Math.round((distM / 1000) * 10) / 10;
                  const mins = Math.max(1, Math.round((durS || (km * 1.5 * 60)) / 60));
                  storeRoadCell(realI, realJ, km, mins);
                }
              }
            }
          } else {
            osrmFailedCount++;
          }
        }
      }

      // Stage C: ADJACENT CLUSTER BRIDGES
      for (let c = 0; c < clusters.length; c++) {
        if (isOsrmCircuitOpen()) break;
        const nextC = (c + 1) % clusters.length;
        const halfA = clusters[c].slice(-8);
        const halfB = clusters[nextC].slice(0, 8);
        const bridge = [...halfA, ...halfB];

        let hasMissingBridge = false;
        for (const i of halfA) {
          for (const j of halfB) {
            if (distances[i][j] === 0 || distances[j][i] === 0) {
              hasMissingBridge = true;
              break;
            }
          }
          if (hasMissingBridge) break;
        }

        if (hasMissingBridge) {
          const subPts = bridge.map(idx => points[idx]);
          const subTable = await this.fetchOsrmTable(subPts);
          if (subTable && subTable.distances) {
            for (let a = 0; a < bridge.length; a++) {
              for (let b = 0; b < bridge.length; b++) {
                if (a === b) continue;
                const realI = bridge[a];
                const realJ = bridge[b];
                if (distances[realI][realJ] > 0) continue;

                const distM = subTable.distances[a]?.[b];
                const durS = subTable.durations?.[a]?.[b];
                if (typeof distM === 'number' && distM !== null) {
                  const km = Math.round((distM / 1000) * 10) / 10;
                  const mins = Math.max(1, Math.round((durS || (km * 1.5 * 60)) / 60));
                  storeRoadCell(realI, realJ, km, mins);
                }
              }
            }
          } else {
            osrmFailedCount++;
          }
        }
      }

      // Stage D: K-NEAREST CANDIDATE GRAPH
      const missingNeighborQueries: { source: number; destinations: number[] }[] = [];
      if (!isOsrmCircuitOpen()) {
        for (let i = 1; i < n; i++) {
          const nearest = nonDepotIndices
            .filter(j => j !== i)
            .map(j => ({ j, dist: calculateDistance(points[i].lat, points[i].lng, points[j].lat, points[j].lng) }))
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 8)
            .map(item => item.j);

          const unqueriedDests = nearest.filter(j => distances[i][j] === 0);
          if (unqueriedDests.length > 0) {
            missingNeighborQueries.push({ source: i, destinations: unqueriedDests });
          }
        }
      }

      // Batch query nearest neighbors in blocks
      for (let q = 0; q < Math.min(25, missingNeighborQueries.length); q += 5) {
        const batch = missingNeighborQueries.slice(q, q + 5);
        const sourceNodes = Array.from(new Set(batch.map(b => b.source)));
        const destNodes = Array.from(new Set(batch.flatMap(b => b.destinations)));
        const combined = Array.from(new Set([...sourceNodes, ...destNodes]));

        if (combined.length <= 40) {
          const subPts = combined.map(idx => points[idx]);
          const subSources = sourceNodes.map(s => combined.indexOf(s));
          const subDests = destNodes.map(d => combined.indexOf(d));

          const subTable = await this.fetchOsrmTable(subPts, subSources, subDests);
          if (subTable && subTable.distances) {
            for (let sIdx = 0; sIdx < sourceNodes.length; sIdx++) {
              for (let dIdx = 0; dIdx < destNodes.length; dIdx++) {
                const realI = sourceNodes[sIdx];
                const realJ = destNodes[dIdx];
                if (realI === realJ || distances[realI][realJ] > 0) continue;

                const distM = subTable.distances[sIdx]?.[dIdx];
                const durS = subTable.durations?.[sIdx]?.[dIdx];
                if (typeof distM === 'number' && distM !== null) {
                  const km = Math.round((distM / 1000) * 10) / 10;
                  const mins = Math.max(1, Math.round((durS || (km * 1.5 * 60)) / 60));
                  storeRoadCell(realI, realJ, km, mins);
                }
              }
            }
          }
        }
      }

      // Stage E: Fill remaining distant unreached pairs with calibrated estimate
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i !== j && distances[i][j] === 0) {
            storeFallbackCell(i, j);
          }
        }
      }
    }

    // --- ACCURATE COVERAGE STATISTICS ---
    const totalPairs = n * (n - 1);
    let roadPairs = 0;
    let fallbackPairs = 0;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const key = this.pairKey(points[i], points[j]);
        const cell = this.pairCache.get(key);
        if (cell && cell.isRealRoad) {
          roadPairs++;
        } else {
          fallbackPairs++;
        }
      }
    }

    const coveragePercent = totalPairs > 0
      ? Math.round((roadPairs / totalPairs) * 1000) / 10
      : 100;

    const routingProviderName = fallbackPairs === 0
      ? 'OSRM Table API (100% Road Network)'
      : roadPairs > 0
        ? `OSRM Table API (${coveragePercent}% Road Coverage, ${fallbackPairs} Estimate Pairs)`
        : 'OSRM Offline (Haversine Calibrated)';

    if (this.pairCache.size > this.MAX_CACHE_ENTRIES) {
      // LRU prune: delete oldest fallback entries first
      const keys = Array.from(this.pairCache.keys());
      for (let k = 0; k < 2000 && k < keys.length; k++) {
        const cell = this.pairCache.get(keys[k]);
        if (cell && cell.isFallback) {
          this.pairCache.delete(keys[k]);
        }
      }
    }

    this.persistDebounced();

    return {
      distances,
      durations,
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
}

export const distanceMatrixManager = DistanceMatrixManager.getInstance();
