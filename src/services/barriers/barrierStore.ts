import { RoadBarrier } from '../../types';
import {
  LatLng, haversineMeters, pointToPolylineMeters, samplePolyline, thin, circleRingLonLat, ringPerimeterMeters
} from './geometry';

/**
 * Module-level registry of the barriers the routing layer must respect.
 * App keeps the barrier list in React state and pushes it here; routing services read it.
 */
let activeBarriers: RoadBarrier[] = [];
let barrierHash = '';

export function setRoadBarriers(barriers: RoadBarrier[]): void {
  activeBarriers = (barriers || []).filter(b => b && b.isActive);
  barrierHash = activeBarriers
    .map(b => `${b.id}:${b.kind}:${b.lat.toFixed(6)},${b.lng.toFixed(6)}:${b.radiusMeters ?? ''}:${b.path?.length ?? 0}`)
    .sort()
    .join('|');
}

export const getActiveBarriers = (): RoadBarrier[] => activeBarriers;
export const getBarrierHash = (): string => barrierHash;

// --- Tunables -------------------------------------------------------------
/** Spacing of excluded points along a closed street (short blocks between intersections must not be skipped). */
const STREET_EXCLUDE_SPACING_M = 35;
/** Spacing of probe points used to detect which trips can pass through a closed street. */
const STREET_PROBE_SPACING_M = 120;
/** A road line closer than this to a point barrier is considered to pass through it. */
const POINT_TOUCH_M = 20;
/**
 * A point barrier also closes a small circle around the snapped point. `exclude_locations` alone closes
 * only the nearest carriageway, and on divided avenues the opposite carriageway is a separate road.
 */
export const POINT_BARRIER_RADIUS_M = 20;
const STREET_TOUCH_M = 15;
/** Exclusions closer than this to a trip's own stop are dropped (otherwise the stop itself is unreachable). */
const ENDPOINT_GUARD_M = 30;
/** Public Valhalla server limits. */
export const VALHALLA_MAX_EXCLUDE_LOCATIONS = 50;
const VALHALLA_MAX_POLYGON_PERIMETER_M = 9500;

function streetLines(b: RoadBarrier): [number, number][][] {
  return (b.path || []).filter(l => Array.isArray(l) && l.length >= 2);
}

/** Points handed to Valhalla `exclude_locations` (each closes the nearest road segment). */
export function barrierExcludePoints(b: RoadBarrier): LatLng[] {
  if (b.kind === 'point') return [{ lat: b.lat, lng: b.lng }];
  if (b.kind === 'street') {
    return streetLines(b).flatMap(l => samplePolyline(l, STREET_EXCLUDE_SPACING_M));
  }
  return [];
}

/**
 * Probe points used with the road network to test whether the fastest trip i→j goes through the barrier:
 * it does when t(i→probe) + t(probe→j) ≈ t(i→j).
 */
export function barrierProbePoints(b: RoadBarrier): { point: LatLng; extraSeconds: number }[] {
  if (b.kind === 'point') {
    // centre + 4 points around it, so both carriageways of a divided road get probed
    const around = circleRingLonLat({ lat: b.lat, lng: b.lng }, POINT_BARRIER_RADIUS_M, 4)
      .slice(0, 4)
      .map(([lng, lat]) => ({ point: { lat, lng }, extraSeconds: 5 }));
    return [{ point: { lat: b.lat, lng: b.lng }, extraSeconds: 0 }, ...around];
  }
  if (b.kind === 'street') {
    const pts = streetLines(b).flatMap(l => samplePolyline(l, STREET_PROBE_SPACING_M));
    return thin(pts, 12).map(point => ({ point, extraSeconds: 20 }));
  }
  // zone: centre + ring; a trip may clip the circle anywhere, so allow crossing time as tolerance
  const r = b.radiusMeters || 200;
  const extra = (2 * r) / 8.3; // ~30 km/h across the zone
  const centre = { lat: b.lat, lng: b.lng };
  const ring = circleRingLonLat(centre, r * 0.7, 6).slice(0, 6).map(([lng, lat]) => ({ point: { lat, lng }, extraSeconds: extra }));
  return [{ point: centre, extraSeconds: extra }, ...ring];
}

/** Does a drawn road line pass through the barrier? */
export function barrierTouchesPath(b: RoadBarrier, path: [number, number][]): boolean {
  if (!path || path.length < 2) return false;
  if (b.kind === 'point') return pointToPolylineMeters({ lat: b.lat, lng: b.lng }, path) <= POINT_TOUCH_M;
  if (b.kind === 'zone') return pointToPolylineMeters({ lat: b.lat, lng: b.lng }, path) <= (b.radiusMeters || 200);
  const samples = streetLines(b).flatMap(l => samplePolyline(l, STREET_EXCLUDE_SPACING_M));
  return samples.some(s => pointToPolylineMeters(s, path) <= STREET_TOUCH_M);
}

export function anyBarrierTouchesPath(barriers: RoadBarrier[], path: [number, number][]): boolean {
  return barriers.some(b => barrierTouchesPath(b, path));
}

export interface ValhallaExclusions {
  exclude_locations?: { lat: number; lon: number }[];
  exclude_polygons?: [number, number][][];
  /** barriers that had to be ignored for this request (they cover one of its stops, or limits were hit) */
  skipped: number;
}

/**
 * Builds Valhalla exclusions for a request visiting `locations`.
 * Exclusions sitting on one of the request's own stops are dropped (a stop inside a closed road is still
 * delivered to), and the public server limits are respected by keeping the barriers closest to the trip.
 */
export function buildExclusions(barriers: RoadBarrier[], locations: LatLng[]): ValhallaExclusions | null {
  if (barriers.length === 0) return null;
  const nearStop = (p: LatLng, guard: number) => locations.some(l => haversineMeters(l, p) <= guard);
  const locCentre = {
    lat: locations.reduce((s, l) => s + l.lat, 0) / Math.max(1, locations.length),
    lng: locations.reduce((s, l) => s + l.lng, 0) / Math.max(1, locations.length)
  };

  let skipped = 0;
  let points: LatLng[] = [];
  const polygons: { ring: [number, number][]; perimeter: number; dist: number }[] = [];

  for (const b of barriers) {
    if (b.kind === 'point') {
      const centre = { lat: b.lat, lng: b.lng };
      if (nearStop(centre, POINT_BARRIER_RADIUS_M + ENDPOINT_GUARD_M)) { skipped++; continue; }
      points.push(centre);
      const ring = circleRingLonLat(centre, POINT_BARRIER_RADIUS_M, 8);
      polygons.push({ ring, perimeter: ringPerimeterMeters(ring), dist: haversineMeters(locCentre, centre) });
    } else if (b.kind === 'zone') {
      const r = b.radiusMeters || 200;
      if (nearStop({ lat: b.lat, lng: b.lng }, r + ENDPOINT_GUARD_M)) { skipped++; continue; }
      const ring = circleRingLonLat({ lat: b.lat, lng: b.lng }, r, 12);
      polygons.push({ ring, perimeter: ringPerimeterMeters(ring), dist: haversineMeters(locCentre, { lat: b.lat, lng: b.lng }) });
    } else {
      // street: points every 35 m along it, each closes the road segment it sits on
      const pts = barrierExcludePoints(b).filter(p => !nearStop(p, ENDPOINT_GUARD_M));
      if (pts.length === 0) { skipped++; continue; }
      points.push(...pts);
    }
  }

  if (points.length > VALHALLA_MAX_EXCLUDE_LOCATIONS) {
    points = points
      .map(p => ({ p, d: haversineMeters(locCentre, p) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, VALHALLA_MAX_EXCLUDE_LOCATIONS)
      .map(x => x.p);
    skipped++;
  }

  polygons.sort((a, b) => a.dist - b.dist);
  const keptPolygons: [number, number][][] = [];
  let perimeter = 0;
  for (const p of polygons) {
    if (perimeter + p.perimeter > VALHALLA_MAX_POLYGON_PERIMETER_M) { skipped++; continue; }
    perimeter += p.perimeter;
    keptPolygons.push(p.ring);
  }

  const result: ValhallaExclusions = { skipped };
  if (points.length > 0) result.exclude_locations = points.map(p => ({ lat: +p.lat.toFixed(6), lon: +p.lng.toFixed(6) }));
  if (keptPolygons.length > 0) result.exclude_polygons = keptPolygons;
  return result;
}
