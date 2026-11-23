import { Order } from '../../types';
import { WAREHOUSE_LOCATION } from '../../mockData';
import { calculateDistance } from '../geo';
import { distanceMatrixManager } from '../distanceMatrixManager';

export interface PointCoord {
  lat: number;
  lng: number;
}

import { RoadMatrixLookup } from './RoadMatrix';
export { RoadMatrixLookup };

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
