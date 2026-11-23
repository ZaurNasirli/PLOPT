// Small geodesic helpers for barrier handling (metres, [lat, lng] tuples).

export type LatLng = { lat: number; lng: number };

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Distance in metres from point p to segment a-b (local equirectangular projection, fine below ~50 km). */
export function pointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = R * Math.cos(toRad(p.lat)) * (Math.PI / 180);
  const ky = R * (Math.PI / 180);
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx, y = ay + t * dy;
  return Math.sqrt(x * x + y * y);
}

/** Minimal distance in metres from a point to a polyline of [lat, lng] tuples. */
export function pointToPolylineMeters(p: LatLng, line: [number, number][]): number {
  if (!line || line.length === 0) return Infinity;
  if (line.length === 1) return haversineMeters(p, { lat: line[0][0], lng: line[0][1] });
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const d = pointToSegmentMeters(p, { lat: line[i][0], lng: line[i][1] }, { lat: line[i + 1][0], lng: line[i + 1][1] });
    if (d < min) min = d;
  }
  return min;
}

/** Points along a polyline every `spacing` metres (always includes both ends). */
export function samplePolyline(line: [number, number][], spacing: number): LatLng[] {
  if (!line || line.length === 0) return [];
  const out: LatLng[] = [{ lat: line[0][0], lng: line[0][1] }];
  let carry = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = { lat: line[i][0], lng: line[i][1] };
    const b = { lat: line[i + 1][0], lng: line[i + 1][1] };
    const segLen = haversineMeters(a, b);
    let pos = spacing - carry;
    while (pos < segLen) {
      const t = pos / segLen;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      pos += spacing;
    }
    carry = segLen - (pos - spacing);
  }
  const last = line[line.length - 1];
  const lastPt = { lat: last[0], lng: last[1] };
  if (haversineMeters(out[out.length - 1], lastPt) > spacing * 0.3) out.push(lastPt);
  return out;
}

/** Evenly thins a list down to at most `max` items (keeps first and last). */
export function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  if (max <= 1) return items.slice(0, max);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  return out;
}

/** Closed polygon ring approximating a circle, as [lon, lat] pairs (Valhalla format). */
export function circleRingLonLat(center: LatLng, radiusMeters: number, sides = 12): [number, number][] {
  const ring: [number, number][] = [];
  const dLat = radiusMeters / 111320;
  const dLng = radiusMeters / (111320 * Math.cos(toRad(center.lat)));
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides;
    ring.push([center.lng + dLng * Math.cos(a), center.lat + dLat * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return ring;
}

export function ringPerimeterMeters(ring: [number, number][]): number {
  let p = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    p += haversineMeters({ lat: ring[i][1], lng: ring[i][0] }, { lat: ring[i + 1][1], lng: ring[i + 1][0] });
  }
  return p;
}

/** Decodes a Valhalla/Google encoded polyline (precision 6 by default) into [lat, lng] tuples. */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  const coords: [number, number][] = [];
  const factor = Math.pow(10, precision);
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    for (let which = 0; which < 2; which++) {
      let shift = 0, result = 0, byte: number;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lng += delta;
    }
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}
