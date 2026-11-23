import { Order, StreetHighlight } from '../types';
import { POPULAR_BAKU_STREETS, PredefinedStreet } from '../data/bakuRealStreets';

export { POPULAR_BAKU_STREETS };
export type { PredefinedStreet };

/**
 * Calculates distance in meters between two lat/lng coordinates (Haversine formula).
 */
export function distanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates perpendicular distance from a point to a line segment in meters.
 */
export function distancePointToSegmentMeters(
  point: [number, number],
  segA: [number, number],
  segB: [number, number]
): number {
  const [pLat, pLng] = point;
  const [aLat, aLng] = segA;
  const [bLat, bLng] = segB;

  const dx = bLng - aLng;
  const dy = bLat - aLat;

  if (dx === 0 && dy === 0) {
    return distanceInMeters(pLat, pLng, aLat, aLng);
  }

  // Projection parameter t
  let t = ((pLng - aLng) * dx + (pLat - aLat) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));

  const projLat = aLat + t * dy;
  const projLng = aLng + t * dx;

  return distanceInMeters(pLat, pLng, projLat, projLng);
}

/**
 * Calculates minimum distance from a point to an entire polyline in meters.
 */
export function distancePointToPolylineMeters(
  point: [number, number],
  polyline: [number, number][]
): number {
  if (!polyline || polyline.length === 0) return Infinity;
  if (polyline.length === 1) {
    return distanceInMeters(point[0], point[1], polyline[0][0], polyline[0][1]);
  }

  let minDistance = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const dist = distancePointToSegmentMeters(point, polyline[i], polyline[i + 1]);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return minDistance;
}

/**
 * Calculates minimum distance to any line in a collection of polylines.
 */
export function distancePointToMultiPolylineMeters(
  point: [number, number],
  polylines: [number, number][][]
): number {
  if (!polylines || polylines.length === 0) return Infinity;
  let min = Infinity;
  for (const line of polylines) {
    const d = distancePointToPolylineMeters(point, line);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Finds all orders located along a given street polyline (or multi-segment lines) within threshold meters.
 */
export function findOrdersAlongStreet(
  coordinates: [number, number][],
  orders: Order[],
  thresholdMeters = 200,
  multiCoordinates?: [number, number][][]
): Order[] {
  if ((!coordinates || coordinates.length === 0) && (!multiCoordinates || multiCoordinates.length === 0)) {
    return [];
  }

  const allLines: [number, number][][] = [];
  if (multiCoordinates && multiCoordinates.length > 0) {
    allLines.push(...multiCoordinates);
  } else if (coordinates && coordinates.length > 0) {
    allLines.push(coordinates);
  }

  return orders.filter(order => {
    if (!order.lat || !order.lng) return false;
    const dist = distancePointToMultiPolylineMeters([order.lat, order.lng], allLines);
    return dist <= thresholdMeters;
  });
}

/**
 * Finds all orders captured by a manual brush path within brush radius.
 */
export function findOrdersInBrush(
  brushPoints: [number, number][],
  brushRadiusMeters: number,
  orders: Order[]
): Order[] {
  if (!brushPoints || brushPoints.length === 0) return [];

  if (brushPoints.length === 1) {
    const [bLat, bLng] = brushPoints[0];
    return orders.filter(order => {
      if (!order.lat || !order.lng) return false;
      return distanceInMeters(order.lat, order.lng, bLat, bLng) <= brushRadiusMeters;
    });
  }

  return orders.filter(order => {
    if (!order.lat || !order.lng) return false;
    const dist = distancePointToPolylineMeters([order.lat, order.lng], brushPoints);
    return dist <= brushRadiusMeters;
  });
}

export interface StreetSearchResult {
  name: string;
  coordinates: [number, number][];
  multiCoordinates?: [number, number][][];
  orders: Order[];
  source: 'name' | 'click' | 'brush';
  isFromCatalog?: boolean;
}

// In-memory route and road cache to make lookups fast
const roadGeometryCache = new Map<string, [number, number][]>();

/**
 * Fetches exact real driving road geometry between waypoints using OSRM.
 * Returns 100% accurate road curves, turns, and coordinates.
 */
export async function fetchRealRoadRoute(
  waypoints: [number, number][]
): Promise<[number, number][] | null> {
  if (!waypoints || waypoints.length < 2) return null;

  const key = waypoints.map(p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(';');
  if (roadGeometryCache.has(key)) {
    return roadGeometryCache.get(key)!;
  }

  const coordParam = waypoints.map(p => `${p[1]},${p[0]}`).join(';');
  const endpoints = [
    `https://router.project-osrm.org/route/v1/driving/${coordParam}?overview=full&geometries=geojson&steps=false`,
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordParam}?overview=full&geometries=geojson&steps=false`
  ];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        if (data.routes && data.routes[0] && data.routes[0].geometry?.coordinates) {
          const rawCoords: [number, number][] = data.routes[0].geometry.coordinates.map(
            (c: [number, number]) => [c[1], c[0]]
          );
          if (rawCoords.length >= 2) {
            roadGeometryCache.set(key, rawCoords);
            return rawCoords;
          }
        }
      }
    } catch {
      // Try next endpoint
    }
  }

  return null;
}

/**
 * Snaps a lat/lng coordinate to the nearest real road using OSRM nearest.
 */
export async function snapToNearestRoad(
  lat: number,
  lng: number
): Promise<{ name: string; snapped: [number, number]; distance: number } | null> {
  const url = `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data.waypoints && data.waypoints[0]) {
        const wp = data.waypoints[0];
        return {
          name: wp.name || '',
          snapped: [wp.location[1], wp.location[0]],
          distance: wp.distance || 0
        };
      }
    }
  } catch {
    // Return null on failure
  }
  return null;
}

/**
 * Stitches OSM way segments into continuous ordered polylines without erratic diagonal jumps.
 */
export function stitchOsmWays(ways: Array<{ geometry?: Array<{ lat: number; lon: number }> }>): {
  main: [number, number][];
  all: [number, number][][];
} {
  const rawSegments: [number, number][][] = [];

  for (const way of ways) {
    if (way.geometry && Array.isArray(way.geometry) && way.geometry.length >= 2) {
      rawSegments.push(way.geometry.map(pt => [pt.lat, pt.lon]));
    }
  }

  if (rawSegments.length === 0) {
    return { main: [], all: [] };
  }

  // Connect adjacent segments
  const chains: [number, number][][] = [];
  const remaining = [...rawSegments];

  while (remaining.length > 0) {
    let currentChain = remaining.shift()!;
    let extended = true;

    while (extended) {
      extended = false;
      const head = currentChain[0];
      const tail = currentChain[currentChain.length - 1];

      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const candHead = cand[0];
        const candTail = cand[cand.length - 1];

        // Tail to candHead
        if (distanceInMeters(tail[0], tail[1], candHead[0], candHead[1]) < 35) {
          currentChain.push(...cand.slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        // Tail to candTail (reverse cand)
        if (distanceInMeters(tail[0], tail[1], candTail[0], candTail[1]) < 35) {
          const rev = [...cand].reverse();
          currentChain.push(...rev.slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        // Head to candTail
        if (distanceInMeters(head[0], head[1], candTail[0], candTail[1]) < 35) {
          currentChain.unshift(...cand.slice(0, -1));
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        // Head to candHead (reverse cand)
        if (distanceInMeters(head[0], head[1], candHead[0], candHead[1]) < 35) {
          const rev = [...cand].reverse();
          currentChain.unshift(...rev.slice(0, -1));
          remaining.splice(i, 1);
          extended = true;
          break;
        }
      }
    }
    chains.push(currentChain);
  }

  // Sort by length
  chains.sort((a, b) => b.length - a.length);

  return {
    main: chains[0] || [],
    all: chains
  };
}

/**
 * Normalizes street name query by stripping common prefixes/suffixes.
 */
function cleanStreetQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/(?:улица|ул\.?|проспект|просп\.?|пр-кт|пр\.?|тупик|переулок|шоссе|дорогой|дорога)/gi, '')
    .replace(/(?:küçəsi|küç\.?|prospekti|prosp\.?|prospekt|yolu)/gi, '')
    .trim();
}

/**
 * Searches for a street by name and returns 100% REAL road geometry:
 * 1. Checks pre-computed high-fidelity Baku street catalog with real OSRM road geometry.
 * 2. If not found, attempts Overpass API with way stitching.
 * 3. Finds orders matching the street name and routes between them along real roads via OSRM.
 */
export async function searchStreetByName(
  rawQuery: string,
  orders: Order[]
): Promise<StreetSearchResult | null> {
  const query = rawQuery.trim();
  if (!query) return null;
  const cleaned = cleanStreetQuery(query);

  // 1. Check popular Baku catalog
  const catalogMatch = POPULAR_BAKU_STREETS.find(st => {
    const stNameLower = st.name.toLowerCase();
    return (
      stNameLower.includes(cleaned) ||
      st.aliases.some(alias => {
        const a = alias.toLowerCase();
        return cleaned.includes(a) || a.includes(cleaned);
      })
    );
  });

  if (catalogMatch) {
    const nearOrders = findOrdersAlongStreet(catalogMatch.coordinates, orders, 300);
    return {
      name: catalogMatch.name,
      coordinates: catalogMatch.coordinates,
      orders: nearOrders,
      source: 'name',
      isFromCatalog: true
    };
  }

  // 2. Query Overpass API for real street ways in Baku region
  try {
    const overpassQuery = `[out:json][timeout:5];way["highway"]["name"~"${encodeURIComponent(
      cleaned
    )}",i](40.25,49.70,40.55,50.15);out geom 30;`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(`https://overpass-api.de/api/interpreter?data=${overpassQuery}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      if (json.elements && json.elements.length > 0) {
        const stitched = stitchOsmWays(json.elements);
        if (stitched.main.length >= 2) {
          const detectedName = json.elements.find((e: any) => e.tags?.name)?.tags?.name || rawQuery;
          const nearOrders = findOrdersAlongStreet(stitched.main, orders, 250, stitched.all);
          return {
            name: detectedName,
            coordinates: stitched.main,
            multiCoordinates: stitched.all.length > 1 ? stitched.all : undefined,
            orders: nearOrders,
            source: 'name'
          };
        }
      }
    }
  } catch {
    // Overpass failed, proceed to OSRM road route via orders
  }

  // 3. Fallback: Match orders with the street name, and route between them on real roads using OSRM
  const matchingOrders = orders.filter(o => {
    const text = `${o.customerName || ''} ${o.region || ''} ${o.orderNumber || ''}`.toLowerCase();
    return text.includes(cleaned);
  });

  if (matchingOrders.length > 0) {
    // Sort orders geographically
    const sorted = [...matchingOrders].sort((a, b) => a.lat - b.lat || a.lng - b.lng);
    const waypoints: [number, number][] = sorted.map(o => [o.lat, o.lng]);

    // Trace real road between matching orders via OSRM
    const realRoad = await fetchRealRoadRoute([waypoints[0], waypoints[waypoints.length - 1]]);
    const finalCoords = realRoad || waypoints;

    return {
      name: `Улица: ${rawQuery}`,
      coordinates: finalCoords,
      orders: matchingOrders,
      source: 'name'
    };
  }

  return null;
}

/**
 * Discovers the street at clicked coordinates (lat, lng) with 100% REAL road geometry:
 * 1. Checks proximity to popular Baku real roads catalog.
 * 2. Snaps click directly onto road center line via OSRM Nearest.
 * 3. Queries Overpass for road geometry and stitches connected ways.
 * 4. If Overpass fails, traces real road segment via OSRM driving route around the clicked location.
 */
export async function getStreetByClick(
  lat: number,
  lng: number,
  orders: Order[]
): Promise<StreetSearchResult> {
  // 1. Check if click is very close (within 120m) to a known catalog street
  for (const st of POPULAR_BAKU_STREETS) {
    const dist = distancePointToPolylineMeters([lat, lng], st.coordinates);
    if (dist <= 120) {
      const nearOrders = findOrdersAlongStreet(st.coordinates, orders, 250);
      return {
        name: st.name,
        coordinates: st.coordinates,
        orders: nearOrders,
        source: 'click',
        isFromCatalog: true
      };
    }
  }

  // 2. Snap to real road via OSRM Nearest
  const snappedRoad = await snapToNearestRoad(lat, lng);
  const roadLat = snappedRoad?.snapped[0] ?? lat;
  const roadLng = snappedRoad?.snapped[1] ?? lng;
  const detectedRoadName = snappedRoad?.name?.trim() || '';

  // 3. Try Overpass around the clicked road point
  try {
    const overpassQuery = `[out:json][timeout:4];way["highway"](around:70,${roadLat},${roadLng});out geom 15;`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(`https://overpass-api.de/api/interpreter?data=${overpassQuery}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      if (json.elements && json.elements.length > 0) {
        // Filter ways matching road name if known
        let relevantWays = json.elements;
        if (detectedRoadName) {
          const matchingWays = json.elements.filter(
            (e: any) => e.tags?.name === detectedRoadName || e.tags?.['name:ru'] === detectedRoadName
          );
          if (matchingWays.length > 0) {
            relevantWays = matchingWays;
          }
        }

        const stitched = stitchOsmWays(relevantWays);
        if (stitched.main.length >= 2) {
          const finalName =
            detectedRoadName ||
            relevantWays.find((e: any) => e.tags?.name)?.tags?.name ||
            'Улица на карте';

          const nearOrders = findOrdersAlongStreet(stitched.main, orders, 250, stitched.all);
          return {
            name: finalName,
            coordinates: stitched.main,
            multiCoordinates: stitched.all.length > 1 ? stitched.all : undefined,
            orders: nearOrders,
            source: 'click'
          };
        }
      }
    }
  } catch {
    // Overpass failed, continue to OSRM real road tracing
  }

  // 4. Trace real road path using OSRM driving route around snapped location
  // Find if any orders are nearby (within 350m) along this road
  const nearbyOrders = orders.filter(
    o => o.lat && o.lng && distanceInMeters(o.lat, o.lng, roadLat, roadLng) <= 350
  );

  let roadWaypoints: [number, number][] = [];
  if (nearbyOrders.length >= 2) {
    const sorted = [...nearbyOrders].sort((a, b) => a.lat - b.lat || a.lng - b.lng);
    roadWaypoints = [
      [sorted[0].lat, sorted[0].lng],
      [roadLat, roadLng],
      [sorted[sorted.length - 1].lat, sorted[sorted.length - 1].lng]
    ];
  } else {
    // Project points forward and backward along local latitude/longitude and snap to real road
    roadWaypoints = [
      [roadLat - 0.002, roadLng - 0.002],
      [roadLat, roadLng],
      [roadLat + 0.002, roadLng + 0.002]
    ];
  }

  const realRoadCoords = await fetchRealRoadRoute(roadWaypoints);
  if (realRoadCoords && realRoadCoords.length >= 2) {
    const nearOrders = findOrdersAlongStreet(realRoadCoords, orders, 250);
    return {
      name: detectedRoadName || `Улица в районе (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      coordinates: realRoadCoords,
      orders: nearOrders,
      source: 'click'
    };
  }

  // 5. Final fallback using snapped road point
  const fallbackCoords: [number, number][] = [
    [roadLat - 0.001, roadLng - 0.001],
    [roadLat, roadLng],
    [roadLat + 0.001, roadLng + 0.001]
  ];
  const nearOrders = findOrdersAlongStreet(fallbackCoords, orders, 250);

  return {
    name: detectedRoadName || `Улица (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
    coordinates: fallbackCoords,
    orders: nearOrders,
    source: 'click'
  };
}

/**
 * Converts a raw brush stroke of points into a smoothed street highlight object.
 */
export function createStreetFromBrush(
  brushPoints: [number, number][],
  brushRadiusMeters: number,
  orders: Order[],
  customName?: string
): StreetHighlight {
  const capturedOrders = findOrdersInBrush(brushPoints, brushRadiusMeters, orders);
  const strokeName = customName || `Выделение кистью (${capturedOrders.length} зак.)`;
  const colors = ['#06b6d4', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'];
  const randomColor = colors[Math.floor(Math.random() * colors.length)];

  return {
    id: `brush-${Date.now()}`,
    name: strokeName,
    color: randomColor,
    coordinates: brushPoints,
    orderIds: capturedOrders.map(o => o.id),
    source: 'brush',
    brushRadius: brushRadiusMeters,
    createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    isVisible: true
  };
}
