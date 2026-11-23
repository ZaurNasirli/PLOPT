// Client for the free public Valhalla server (FOSSGIS / OpenStreetMap Germany).
// Unlike the public OSRM server, Valhalla can avoid closed roads (`exclude_locations`,
// `exclude_polygons`), so it is used for everything that has to respect road barriers.
//
// Public server limits (checked against valhalla1.openstreetmap.de):
//   route: max 10 locations, matrix: sources × targets <= 100,
//   exclude_locations <= 50, total exclude_polygons perimeter <= 10 km.

import { RoadBarrier } from '../../types';
import { buildExclusions } from './barrierStore';
import { LatLng, decodePolyline } from './geometry';

const ENDPOINT = 'https://valhalla1.openstreetmap.de';
const MAX_ROUTE_LOCATIONS = 10;
export const MAX_MATRIX_PAIRS = 100;
const TIMEOUT_MS = 15000;
const MAX_CONCURRENT = 2; // be polite to a free community server

let active = 0;
const queue: (() => void)[] = [];
async function acquire(): Promise<() => void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return release;
  }
  return new Promise(resolve => queue.push(() => { active++; resolve(release); }));
}
function release() {
  active--;
  const next = queue.shift();
  if (next) next();
}

export interface ValhallaError { error_code?: number; error?: string }

async function post<T>(path: string, body: unknown): Promise<T | null> {
  const done = await acquire();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      console.warn(`[Valhalla] ${path} failed: HTTP ${res.status} ${detail}`);
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    done();
  }
}

const toLoc = (p: LatLng) => ({ lat: +p.lat.toFixed(6), lon: +p.lng.toFixed(6) });

export interface ValhallaRouteResult {
  coordinates: [number, number][];
  distanceKm: number;
  durationMinutes: number;
}

/**
 * Road route through `points` in order, avoiding the given barriers.
 * Long routes are split into overlapping chunks of 10 locations (server limit).
 * Returns null if any chunk fails (e.g. a stop can only be reached through a barrier).
 */
export async function valhallaRoute(points: LatLng[], barriers: RoadBarrier[]): Promise<ValhallaRouteResult | null> {
  if (points.length < 2) return null;
  const coordinates: [number, number][] = [];
  let distanceKm = 0;
  let seconds = 0;

  for (let start = 0; start < points.length - 1; start += MAX_ROUTE_LOCATIONS - 1) {
    const chunk = points.slice(start, start + MAX_ROUTE_LOCATIONS);
    if (chunk.length < 2) break;
    const exclusions = buildExclusions(barriers, chunk);
    const body: Record<string, unknown> = {
      locations: chunk.map(toLoc),
      costing: 'auto',
      units: 'kilometers',
      directions_type: 'none'
    };
    if (exclusions?.exclude_locations) body.exclude_locations = exclusions.exclude_locations;
    if (exclusions?.exclude_polygons) body.exclude_polygons = exclusions.exclude_polygons;

    const data = await post<{ trip?: { legs: { shape: string }[]; summary: { length: number; time: number } } }>('route', body);
    if (!data?.trip) return null;

    for (const leg of data.trip.legs) {
      const shape = decodePolyline(leg.shape);
      coordinates.push(...(coordinates.length === 0 ? shape : shape.slice(1)));
    }
    distanceKm += data.trip.summary.length;
    seconds += data.trip.summary.time;
  }

  return {
    coordinates,
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMinutes: Math.round(seconds / 60)
  };
}

export interface ValhallaMatrixCell { distanceKm: number; seconds: number }

/**
 * sources × targets matrix (max 100 pairs). With `barriers` the closed roads are avoided.
 * Returns null on request failure; individual cells are null when no path exists.
 */
export async function valhallaMatrix(
  sources: LatLng[],
  targets: LatLng[],
  barriers: RoadBarrier[] | null
): Promise<(ValhallaMatrixCell | null)[][] | null> {
  if (sources.length === 0 || targets.length === 0) return [];
  if (sources.length * targets.length > MAX_MATRIX_PAIRS) throw new Error('valhallaMatrix: too many pairs');

  const body: Record<string, unknown> = {
    sources: sources.map(toLoc),
    targets: targets.map(toLoc),
    costing: 'auto',
    units: 'kilometers'
  };
  if (barriers && barriers.length > 0) {
    const exclusions = buildExclusions(barriers, [...sources, ...targets]);
    if (exclusions?.exclude_locations) body.exclude_locations = exclusions.exclude_locations;
    if (exclusions?.exclude_polygons) body.exclude_polygons = exclusions.exclude_polygons;
  }

  type Cell = { distance: number | null; time: number | null; from_index: number; to_index: number };
  const data = await post<{ sources_to_targets?: Cell[][] }>('sources_to_targets', body);
  if (!data?.sources_to_targets) return null;

  const out: (ValhallaMatrixCell | null)[][] = sources.map(() => targets.map(() => null));
  for (const row of data.sources_to_targets) {
    for (const cell of row) {
      if (cell && cell.distance !== null && cell.time !== null && out[cell.from_index]) {
        out[cell.from_index][cell.to_index] = { distanceKm: cell.distance, seconds: cell.time };
      }
    }
  }
  return out;
}

export interface SnappedRoad {
  lat: number;
  lng: number;
  name: string | null;
  /** geometry of the road segment the point snapped to */
  segment: [number, number][] | null;
}

/** Snaps a point to the nearest drivable road and returns its name and segment geometry. */
export async function valhallaLocate(point: LatLng): Promise<SnappedRoad | null> {
  type Edge = { correlated_lat: number; correlated_lon: number; distance: number; edge_info?: { names?: string[]; shape?: string } };
  const data = await post<{ edges?: Edge[] | null }[]>('locate', {
    locations: [toLoc(point)],
    costing: 'auto',
    verbose: true
  });
  const edges = data?.[0]?.edges;
  if (!edges || edges.length === 0) return null;
  const best = [...edges].sort((a, b) => a.distance - b.distance)[0];
  const names = best.edge_info?.names || [];
  // Prefer a real street name over a route number like "E 60"
  const name = names.find(n => !/^[A-Z]{1,3}\s?\d+$/.test(n)) || names[0] || null;
  return {
    lat: best.correlated_lat,
    lng: best.correlated_lon,
    name,
    segment: best.edge_info?.shape ? decodePolyline(best.edge_info.shape) : null
  };
}
