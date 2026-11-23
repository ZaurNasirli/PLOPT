import { Order } from '../../types';
import { WAREHOUSE_LOCATION } from '../../mockData';
import { calculateDistance } from '../routingService';
import { distanceMatrixManager } from '../distanceMatrixManager';
import type { BarrierMatrixInfo } from '../barriers/barrierMatrix';

export interface PointCoord {
  lat: number;
  lng: number;
}

/**
 * High-performance synchronous in-memory road matrix lookup.
 * Index 0 is always the DEPOT (WAREHOUSE_LOCATION).
 * Indices 1..N correspond to the orders.
 */
export class RoadMatrixLookup {
  public readonly n: number; // total points including depot
  private readonly distances: Float64Array; // flattened n x n matrix in km
  private readonly durations: Float64Array; // flattened n x n matrix in minutes
  public readonly isRealRoad: boolean;
  public readonly hasFallback: boolean;
  public readonly totalPairs: number;
  public readonly roadPairs: number;
  public readonly fallbackPairs: number;
  public readonly coveragePercent: number;
  public readonly cachedPairsCount: number;
  public readonly fetchedPairsCount: number;
  private readonly nearestNeighbors: Int32Array[]; // candidate list for each node
  /** Set when road barriers were applied to this matrix */
  public barrierInfo?: BarrierMatrixInfo;

  constructor(
    n: number,
    distances2D: number[][],
    durations2D: number[][],
    isRealRoad: boolean,
    hasFallback: boolean,
    stats?: {
      totalPairs?: number;
      roadPairs?: number;
      fallbackPairs?: number;
      coveragePercent?: number;
      cachedPairsCount?: number;
      fetchedPairsCount?: number;
    }
  ) {
    this.n = n;
    this.isRealRoad = isRealRoad;
    this.hasFallback = hasFallback;
    this.totalPairs = stats?.totalPairs ?? (n * (n - 1));
    this.roadPairs = stats?.roadPairs ?? (isRealRoad ? this.totalPairs : 0);
    this.fallbackPairs = stats?.fallbackPairs ?? (this.totalPairs - this.roadPairs);
    this.coveragePercent = stats?.coveragePercent ?? (this.totalPairs > 0 ? Math.round((this.roadPairs / this.totalPairs) * 1000) / 10 : 100);
    this.cachedPairsCount = stats?.cachedPairsCount ?? 0;
    this.fetchedPairsCount = stats?.fetchedPairsCount ?? 0;

    // Use typed arrays for maximal cache locality and speed
    this.distances = new Float64Array(n * n);
    this.durations = new Float64Array(n * n);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const idx = i * n + j;
        this.distances[idx] = distances2D[i]?.[j] ?? 0;
        this.durations[idx] = durations2D[i]?.[j] ?? 0;
      }
    }

    // Precompute candidate list of nearest neighbors (top 20 closest) for each node
    this.nearestNeighbors = new Array(n);
    const candidatePoolSize = Math.min(24, Math.max(8, Math.floor(n * 0.3)));

    for (let i = 0; i < n; i++) {
      const candidates: { j: number; dist: number }[] = [];
      for (let j = 1; j < n; j++) {
        if (i === j) continue;
        candidates.push({ j, dist: this.getDistance(i, j) });
      }
      candidates.sort((a, b) => a.dist - b.dist);
      const topIndices = new Int32Array(Math.min(candidatePoolSize, candidates.length));
      for (let k = 0; k < topIndices.length; k++) {
        topIndices[k] = candidates[k].j;
      }
      this.nearestNeighbors[i] = topIndices;
    }
  }

  /**
   * Distance between node i and node j in km.
   * Node 0 is DEPOT.
   */
  public getDistance(i: number, j: number): number {
    if (i === j) return 0;
    return this.distances[i * this.n + j];
  }

  /**
   * Travel duration between node i and node j in minutes.
   * Node 0 is DEPOT.
   */
  public getDuration(i: number, j: number): number {
    if (i === j) return 0;
    return this.durations[i * this.n + j];
  }

  /**
   * Candidate nearest order indices for node i.
   */
  public getNeighbors(i: number): Int32Array {
    return this.nearestNeighbors[i] || new Int32Array(0);
  }

  /**
   * Calculates total round-trip road distance for a sequence of order indices (starting and ending at depot).
   */
  public calculateRoundTripDistance(orderIndices: number[]): number {
    if (orderIndices.length === 0) return 0;
    let dist = this.getDistance(0, orderIndices[0]);
    for (let i = 0; i < orderIndices.length - 1; i++) {
      dist += this.getDistance(orderIndices[i], orderIndices[i + 1]);
    }
    dist += this.getDistance(orderIndices[orderIndices.length - 1], 0);
    return Math.round(dist * 100) / 100;
  }

  /**
   * Calculates total round-trip road duration for a sequence of order indices (in minutes).
   */
  public calculateRoundTripDuration(orderIndices: number[]): number {
    if (orderIndices.length === 0) return 0;
    let dur = this.getDuration(0, orderIndices[0]);
    for (let i = 0; i < orderIndices.length - 1; i++) {
      dur += this.getDuration(orderIndices[i], orderIndices[i + 1]);
    }
    dur += this.getDuration(orderIndices[orderIndices.length - 1], 0);
    return Math.round(dur * 10) / 10;
  }
}

/**
 * Builds and returns a RoadMatrixLookup for a given set of orders and depot.
 * Checks distanceMatrixManager cache first, fetches missing elements from OSRM,
 * and falls back safely to Haversine if network/OSRM is unreachable.
 */
export async function buildRoadMatrixLookup(
  orders: Order[],
  depot: PointCoord = WAREHOUSE_LOCATION
): Promise<RoadMatrixLookup> {
  const points: PointCoord[] = [
    { lat: depot.lat, lng: depot.lng },
    ...orders.map(o => ({ lat: o.lat, lng: o.lng }))
  ];

  const n = points.length;

  try {
    // Attempt real road matrix via OSRM Matrix Manager
    const matrixResult = await distanceMatrixManager.getDistanceMatrix(points);

    if (matrixResult && matrixResult.distances && matrixResult.distances.length === n) {
      const lookup = new RoadMatrixLookup(
        n,
        matrixResult.distances,
        matrixResult.durations,
        matrixResult.isRealRoad,
        matrixResult.hasAnyFallback,
        {
          totalPairs: matrixResult.totalPairs,
          roadPairs: matrixResult.roadPairs,
          fallbackPairs: matrixResult.fallbackPairs,
          coveragePercent: matrixResult.coveragePercent,
          cachedPairsCount: matrixResult.cachedCellsCount,
          fetchedPairsCount: matrixResult.fetchedCellsCount
        }
      );
      lookup.barrierInfo = matrixResult.barrierInfo;
      return lookup;
    }
  } catch (err) {
    console.warn('[VRP Optimizer] Real road matrix fetch encountered warning, applying resilient fallback:', err);
  }

  // Graceful fallback to Haversine distance matrix with realistic driving speed approximation (40 km/h)
  const fallbackDistances: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const fallbackDurations: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const straightKm = Math.round(calculateDistance(points[i].lat, points[i].lng, points[j].lat, points[j].lng) * 10) / 10;
      // Urban winding factor for Haversine ~ 1.35x
      const estimatedRoadKm = Math.round(straightKm * 1.35 * 10) / 10;
      const estimatedDurationMin = Math.round((estimatedRoadKm / 38) * 60);

      fallbackDistances[i][j] = estimatedRoadKm;
      fallbackDurations[i][j] = estimatedDurationMin;
    }
  }

  return new RoadMatrixLookup(n, fallbackDistances, fallbackDurations, false, true);
}
