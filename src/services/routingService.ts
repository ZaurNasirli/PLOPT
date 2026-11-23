import { Order, Route } from '../types';
import { WAREHOUSE_LOCATION } from '../mockData';
import { routingProvider } from './routingProvider';
import { distanceMatrixManager } from './distanceMatrixManager';
import { calculateDistance } from './geo';

export { routingProvider } from './routingProvider';
export { distanceMatrixManager } from './distanceMatrixManager';

export type TimeWindowMode = 'hard' | 'soft';

export interface CostModelSettings {
  fuelCostPerKm: number;      // e.g. 0.45 AZN/km
  driverCostPerHour: number;  // e.g. 8.00 AZN/hour
  vehicleFixedCost: number;   // e.g. 35.00 AZN/day
  tollCostPerRoute: number;   // e.g. 0.00 AZN
  enabled: boolean;
}

export interface RoutingLimits {
  maxWeight: number;
  maxVolume: number;
  maxSatir: number;
  maxCustomers: number;
  maxRegions: number;
  truckTypes?: {
    id: string;
    name: string;
    maxWeight: number;
    maxVolume: number;
    rank: number;
  }[];
  costPerRoute: number;
  costPerKm: number;
  costPerStore: number;
  costPerKg: number;
  allowCombineTimeSlots?: boolean;
  allowCombineDates?: boolean;
  optimizationMode?: 'fast' | 'balanced' | 'quality' | 'cost_saver' | 'fleet_saver' | 'time_saver';
  serviceTimeMinutes?: number;

  // New constraints & settings
  timeWindowMode?: TimeWindowMode; // 'hard' | 'soft' (default 'soft')
  lockedStops?: Record<string, string>; // orderId -> routeId (or vehicleId)
  lockedRoutes?: string[]; // routeIds locked against re-optimization
  mustStayTogether?: string[][]; // groups of orderIds that must be in the same route
  mustNotStayTogether?: [string, string][]; // pairs of orderIds that must NOT be together
  routeStabilityWeight?: number; // 0.0 to 1.0 (penalizes changing previous plan)
  previousPlan?: Record<string, string>; // orderId -> routeId from yesterday/previous plan
  costModel?: CostModelSettings; // optional economic model
  maxVehicles?: number; // for what-if scenarios: limit total vehicles available
  maxOrders?: number; // maximum stops per vehicle
  aiStrategyPrompt?: string; // custom instructions for AI mode
}

export interface ProgressUpdate {
  percent: number;
  message: string;
  log?: string;
}

// Haversine distance in km (implemented in ./geo so the optimizer worker can use it without network code)
export { calculateDistance };

const checkLimits = (routeOrders: Order[], limits: RoutingLimits) => {
  const weight = routeOrders.reduce((sum, o) => sum + o.weight, 0);
  const volume = routeOrders.reduce((sum, o) => sum + o.volume, 0);
  const satir = routeOrders.reduce((sum, o) => sum + o.satir, 0);
  const customers = new Set(routeOrders.map(o => o.customerName)).size;
  const regions = new Set(routeOrders.map(o => o.region)).size;

  const tolerance = 1.03; // 3% tolerance

  // Time slot combination restriction
  if (limits.allowCombineTimeSlots === false && routeOrders.length > 1) {
    const timeSlots = new Set(routeOrders.map(o => o.timeSlot));
    if (timeSlots.size > 1) return false;
  }

  // Shipping date combination restriction
  if (limits.allowCombineDates === false && routeOrders.length > 1) {
    const dates = new Set(routeOrders.map(o => o.shippingDate || ''));
    if (dates.size > 1) return false;
  }

  // Basic limits
  if (limits.maxWeight > 0 && weight > limits.maxWeight * tolerance) return false;
  if (limits.maxVolume > 0 && volume > limits.maxVolume * tolerance) return false;
  if (limits.maxSatir > 0 && satir > limits.maxSatir * tolerance) return false;
  if (limits.maxCustomers > 0 && customers > limits.maxCustomers * tolerance) return false;
  if (limits.maxRegions > 0 && regions > limits.maxRegions) return false;

  // Truck type limits
  if (limits.truckTypes && limits.truckTypes.length > 0) {
    // Find if there is at least one truck type that can handle this route
    const possibleTrucks = limits.truckTypes.filter(truck => {
      // Check weight and volume for this specific truck
      if (weight > truck.maxWeight * tolerance) return false;
      if (volume > truck.maxVolume * tolerance) return false;

      // Check if all orders in route allow this truck type
      // Logic: truck.rank must be <= order.allowedTruckType.rank
      return routeOrders.every(order => {
        if (!order.allowedTruckType) return true;
        const allowedTruck = limits.truckTypes!.find(t => t.id === order.allowedTruckType);
        if (!allowedTruck) return true;
        return truck.rank <= allowedTruck.rank;
      });
    });

    if (possibleTrucks.length === 0) return false;
  }

  return true;
};

const findBestTruck = (routeOrders: Order[], limits: RoutingLimits) => {
  if (!limits.truckTypes || limits.truckTypes.length === 0) return undefined;

  const weight = routeOrders.reduce((sum, o) => sum + o.weight, 0);
  const volume = routeOrders.reduce((sum, o) => sum + o.volume, 0);
  const tolerance = 1.03;

  const possibleTrucks = limits.truckTypes.filter(truck => {
    if (weight > truck.maxWeight * tolerance) return false;
    if (volume > truck.maxVolume * tolerance) return false;
    return routeOrders.every(order => {
      if (!order.allowedTruckType) return true;
      const allowedTruck = limits.truckTypes!.find(t => t.id === order.allowedTruckType);
      if (!allowedTruck) return true;
      return truck.rank <= allowedTruck.rank;
    });
  });

  if (possibleTrucks.length === 0) return undefined;

  // Return the truck with the smallest rank (most efficient)
  return possibleTrucks.sort((a, b) => a.rank - b.rank)[0].id;
};

// --- Multi-Provider Resilient Road Navigation with Chunking & In-Memory Cache ---
export interface RouteNavDetails {
  geometry: [number, number][];
  distanceKm: number;
  durationMinutes?: number;
  isRealRoad: boolean;
  providerUsed?: 'osrm' | 'backup' | 'haversine' | 'valhalla';
  barrierStatus?: 'detour' | 'blocked';
}

// In-memory cache for navigation queries
const navCache = new Map<string, RouteNavDetails>();

// Helper to fetch from an OSRM-compatible endpoint with abort timeout
const fetchFromOsrmEndpoint = async (
  endpoint: string, 
  coords: string, 
  timeoutMs: number = 5500
): Promise<{ coordinates: [number, number][]; distanceMeters: number; durationSeconds: number } | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const url = `${endpoint}${coords}?overview=full&geometries=geojson`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    
    if (!response.ok) return null;
    const data = await response.json();
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const routeData = data.routes[0];
      return {
        coordinates: routeData.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]),
        distanceMeters: routeData.distance || 0,
        durationSeconds: routeData.duration || 0
      };
    }
  } catch {
    clearTimeout(timer);
  }
  return null;
};

// Query road navigation for a single chunk of points (at most ~12-15 coordinates)
const fetchChunkRoadDetails = async (
  points: { lat: number; lng: number }[]
): Promise<{ coordinates: [number, number][]; distanceMeters: number; durationSeconds: number; isRealRoad: boolean }> => {
  if (points.length < 2) {
    return { coordinates: points.map(p => [p.lat, p.lng]), distanceMeters: 0, durationSeconds: 0, isRealRoad: false };
  }

  const coords = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  
  // 1. Try Primary OSRM (Global)
  const primaryRes = await fetchFromOsrmEndpoint('https://router.project-osrm.org/route/v1/driving/', coords, 3500);
  if (primaryRes) {
    return { ...primaryRes, isRealRoad: true };
  }

  // 2. Try Secondary OSM Germany car router
  const secondaryRes = await fetchFromOsrmEndpoint('https://routing.openstreetmap.de/routed-car/route/v1/driving/', coords, 3800);
  if (secondaryRes) {
    return { ...secondaryRes, isRealRoad: true };
  }

  // Fallback for this chunk: compute cumulative Haversine distance across segments
  let totalDistMeters = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalDistMeters += calculateDistance(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) * 1000;
  }

  return {
    coordinates: points.map(p => [p.lat, p.lng]),
    distanceMeters: totalDistMeters,
    durationSeconds: Math.round((totalDistMeters / 1000) * 1.5 * 60),
    isRealRoad: false
  };
};

export const getRouteNavDetails = async (points: { lat: number; lng: number }[]): Promise<RouteNavDetails> => {
  if (points.length < 2) {
    return { geometry: [], distanceKm: 0, isRealRoad: false };
  }
  const details = await routingProvider.getRouteNavDetails(points);
  return {
    geometry: details.geometry,
    distanceKm: details.distanceKm,
    durationMinutes: details.durationMinutes,
    isRealRoad: details.isRealRoad,
    providerUsed: details.providerUsed,
    barrierStatus: details.barrierStatus
  };
};

export const getRouteGeometry = async (points: { lat: number, lng: number }[]): Promise<[number, number][]> => {
  const details = await routingProvider.getRouteNavDetails(points);
  return details.geometry;
};

// Helper to get distance matrix from unified DistanceMatrixManager
export const getDistanceMatrix = async (points: { lat: number, lng: number }[]): Promise<number[][]> => {
  if (points.length < 2) return [[0]];
  const matrixRes = await distanceMatrixManager.getDistanceMatrix(points);
  return matrixRes.distances;
};

// --- 2-Opt Optimization (Depot -> Stores -> Depot) ---
export const optimizeRoute2Opt = (orderList: Order[], matrix?: number[][], baseOrders?: Order[]): Order[] => {
  if (orderList.length < 3) return orderList;
  
  let bestOrder = [...orderList];
  let improved = true;

  // Map each order ID to its 1-based index in the distance matrix (0 is WAREHOUSE_LOCATION)
  const refOrders = baseOrders && baseOrders.length > 0 ? baseOrders : orderList;
  const idxMap = new Map<string, number>();
  refOrders.forEach((o, i) => idxMap.set(o.id, i + 1));

  const getTotalDist = (orders: Order[]) => {
    if (orders.length === 0) return 0;
    if (matrix) {
      const firstIdx = idxMap.get(orders[0].id);
      const lastIdx = idxMap.get(orders[orders.length - 1].id);
      if (firstIdx !== undefined && lastIdx !== undefined && matrix[0]?.[firstIdx] !== undefined) {
        let d = matrix[0][firstIdx];
        for (let i = 0; i < orders.length - 1; i++) {
          const u = idxMap.get(orders[i].id);
          const v = idxMap.get(orders[i + 1].id);
          if (u !== undefined && v !== undefined && matrix[u]?.[v] !== undefined) {
            d += matrix[u][v];
          } else {
            d += calculateDistance(orders[i].lat, orders[i].lng, orders[i + 1].lat, orders[i + 1].lng);
          }
        }
        d += matrix[lastIdx]?.[0] ?? calculateDistance(orders[orders.length - 1].lat, orders[orders.length - 1].lng, WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng);
        return d;
      }
    }
    let d = calculateDistance(WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng, orders[0].lat, orders[0].lng);
    for (let i = 0; i < orders.length - 1; i++) {
      d += calculateDistance(orders[i].lat, orders[i].lng, orders[i + 1].lat, orders[i + 1].lng);
    }
    d += calculateDistance(orders[orders.length - 1].lat, orders[orders.length - 1].lng, WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng);
    return d;
  };

  let bestDist = getTotalDist(bestOrder);
  
  while (improved) {
    improved = false;
    for (let i = 0; i < bestOrder.length - 1; i++) {
      for (let j = i + 1; j < bestOrder.length; j++) {
        const newOrder = [...bestOrder];
        const sub = newOrder.slice(i, j + 1).reverse();
        newOrder.splice(i, j - i + 1, ...sub);
        
        const newDist = getTotalDist(newOrder);
        if (newDist < bestDist - 0.001) {
          bestOrder = newOrder;
          bestDist = newDist;
          improved = true;
        }
      }
    }
  }
  return bestOrder;
};

// Ensure consistent stop sequencing and clean non-intersecting road paths
export const finalizeRouteOrders = (orderList: Order[], matrix?: number[][]): Order[] => {
  if (orderList.length < 3) return orderList;
  return optimizeRoute2Opt(orderList, matrix);
};

// --- Nearest Neighbor ---
export const optimizeRouteNearestNeighbor = (orderList: Order[], matrix?: number[][]): Order[] => {
  if (orderList.length < 2) return orderList;
  
  const unvisited = orderList.map((o, i) => ({ order: o, originalIdx: i + 1 }));
  const result: Order[] = [];
  let currentIdx = 0; // Depot
  
  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minDist = Infinity;
    
    for (let i = 0; i < unvisited.length; i++) {
      let d;
      if (matrix) {
        d = matrix[currentIdx][unvisited[i].originalIdx];
      } else {
        const pos = currentIdx === 0 ? WAREHOUSE_LOCATION : result[result.length - 1];
        d = calculateDistance(pos.lat, pos.lng, unvisited[i].order.lat, unvisited[i].order.lng);
      }
      
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
      }
    }
    
    const next = unvisited.splice(nearestIdx, 1)[0];
    result.push(next.order);
    currentIdx = next.originalIdx;
  }
  
  return result;
};

// --- Greedy Edge Selection ---
export const optimizeRouteGreedy = (orderList: Order[], matrix?: number[][]): Order[] => {
  if (orderList.length < 2) return orderList;
  const n = orderList.length;
  const points = [WAREHOUSE_LOCATION, ...orderList];
  
  const edges: { i: number, j: number, dist: number }[] = [];
  for (let i = 0; i <= n; i++) {
    for (let j = i + 1; j <= n; j++) {
      let d;
      if (matrix) d = matrix[i][j];
      else d = calculateDistance(points[i].lat, points[i].lng, points[j].lat, points[j].lng);
      edges.push({ i, j, dist: d });
    }
  }
  edges.sort((a, b) => a.dist - b.dist);

  const degree = new Array(n + 1).fill(0);
  const adj = Array.from({ length: n + 1 }, () => [] as number[]);
  
  function hasCycle(start: number, target: number, visited: Set<number>): boolean {
    if (start === target) return true;
    visited.add(start);
    for (const neighbor of adj[start]) {
      if (!visited.has(neighbor)) {
        if (hasCycle(neighbor, target, visited)) return true;
      }
    }
    return false;
  }

  let edgesCount = 0;
  for (const edge of edges) {
    if (edgesCount === n + 1) break;
    if (degree[edge.i] < 2 && degree[edge.j] < 2) {
      if (edgesCount < n && hasCycle(edge.i, edge.j, new Set())) continue;
      adj[edge.i].push(edge.j);
      adj[edge.j].push(edge.i);
      degree[edge.i]++;
      degree[edge.j]++;
      edgesCount++;
    }
  }

  const result: Order[] = [];
  let current = 0;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    const next = adj[current].find(neighbor => neighbor !== prev);
    if (next !== undefined && next !== 0) {
      result.push(orderList[next - 1]);
      prev = current;
      current = next;
    } else break;
  }
  return result.length === n ? result : orderList;
};

/**
 * Runs a routing algorithm separately for every group of orders that may share a vehicle.
 * When combining time slots / shipping dates is not allowed, mixing them in one input list makes
 * greedy algorithms (sweep, cluster, insertion, ...) cut a new route at almost every order.
 * Route ids and names are renumbered so they stay unique across partitions.
 */
export const runPartitioned = async (
  algorithm: (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void) => Promise<Route[]>,
  orders: Order[],
  limits: RoutingLimits,
  onProgress: (p: ProgressUpdate) => void
): Promise<Route[]> => {
  const partitions = new Map<string, Order[]>();
  for (const o of orders) {
    const dateKey = limits.allowCombineDates === false ? (o.shippingDate || '') : '*';
    const slotKey = limits.allowCombineTimeSlots === false ? (o.timeSlot || '') : '*';
    const key = `${dateKey}__${slotKey}`;
    if (!partitions.has(key)) partitions.set(key, []);
    partitions.get(key)!.push(o);
  }

  if (partitions.size <= 1) {
    return algorithm(orders, limits, onProgress);
  }

  const groups = Array.from(partitions.values());
  const result: Route[] = [];
  for (let g = 0; g < groups.length; g++) {
    const routes = await algorithm(groups[g], limits, (p) => onProgress({
      ...p,
      percent: Math.min(99, Math.floor(((g + p.percent / 100) / groups.length) * 100))
    }));
    result.push(...routes);
  }

  const runId = Date.now();
  return result.map((r, idx) => {
    const prefix = r.name.includes('-') ? r.name.slice(0, r.name.lastIndexOf('-')) : r.name;
    return {
      ...r,
      id: `${r.id.split('-').slice(0, 2).join('-')}-${runId}-${idx}`,
      name: `${prefix}-${idx + 1}`,
      color: ROUTE_PALETTE[idx % ROUTE_PALETTE.length]
    };
  });
};

// --- Calculate total round-trip distance for a route (Warehouse -> Stores -> Warehouse) ---
export const getRouteTotalDistance = (orderList: Order[], matrix?: number[][], baseOrders?: Order[]): number => {
  if (orderList.length === 0) return 0;

  if (matrix) {
    const refOrders = baseOrders && baseOrders.length > 0 ? baseOrders : orderList;
    const idxMap = new Map<string, number>();
    refOrders.forEach((o, i) => idxMap.set(o.id, i + 1));

    const firstIdx = idxMap.get(orderList[0].id);
    const lastIdx = idxMap.get(orderList[orderList.length - 1].id);
    if (firstIdx !== undefined && lastIdx !== undefined && matrix[0]?.[firstIdx] !== undefined) {
      let total = matrix[0][firstIdx];
      for (let i = 0; i < orderList.length - 1; i++) {
        const u = idxMap.get(orderList[i].id);
        const v = idxMap.get(orderList[i + 1].id);
        if (u !== undefined && v !== undefined && matrix[u]?.[v] !== undefined) {
          total += matrix[u][v];
        } else {
          total += calculateDistance(orderList[i].lat, orderList[i].lng, orderList[i + 1].lat, orderList[i + 1].lng);
        }
      }
      total += matrix[lastIdx]?.[0] ?? calculateDistance(orderList[orderList.length - 1].lat, orderList[orderList.length - 1].lng, WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng);
      return Math.round(total * 10) / 10;
    }
  }

  let total = calculateDistance(WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng, orderList[0].lat, orderList[0].lng);
  for (let i = 0; i < orderList.length - 1; i++) {
    total += calculateDistance(orderList[i].lat, orderList[i].lng, orderList[i + 1].lat, orderList[i + 1].lng);
  }
  total += calculateDistance(orderList[orderList.length - 1].lat, orderList[orderList.length - 1].lng, WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng);
  return Math.round(total * 10) / 10;
};

const ROUTE_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
];

const buildInitialRoute = (idPrefix: string, namePrefix: string, idx: number, orderList: Order[], limits: RoutingLimits): Route => {
  const straightKm = getRouteTotalDistance(orderList);
  const geometry: [number, number][] = [
    [WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng],
    ...orderList.map(o => [o.lat, o.lng] as [number, number]),
    [WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng]
  ];
  return {
    id: `route-${idPrefix}-${Date.now()}-${idx}`,
    name: `${namePrefix}-${idx + 1}`,
    orderIds: orderList.map(o => o.id),
    color: ROUTE_PALETTE[idx % ROUTE_PALETTE.length],
    isVisible: true,
    distance: straightKm,
    straightDistanceKm: straightKm,
    geometry,
    isRealRoad: false,
    routingSource: 'HAVERSINE',
    truckTypeId: findBestTruck(orderList, limits)
  };
};

// --- Nearest Insertion ---
export const runNearestInsertion = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Алгоритм ближайшего включения...', log: 'Начало Nearest Insertion' });
  
  const unvisited = [...orders];
  const routes: Order[][] = [];
  
  while (unvisited.length > 0) {
    let currentRoute: Order[] = [];
    
    // Start with the closest unvisited to depot
    let closestIdx = -1;
    let minDist = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const d = calculateDistance(WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng, unvisited[i].lat, unvisited[i].lng);
      if (d < minDist) {
        minDist = d;
        closestIdx = i;
      }
    }
    
    const startOrder = unvisited.splice(closestIdx, 1)[0];
    currentRoute.push(startOrder);
    
    while (unvisited.length > 0) {
      let bestOrderIdx = -1;
      let minMinDist = Infinity;
      
      // Find unvisited order that is closest to any node in the current route
      for (let i = 0; i < unvisited.length; i++) {
        let minDistToRoute = Infinity;
        for (const ro of currentRoute) {
          const d = calculateDistance(unvisited[i].lat, unvisited[i].lng, ro.lat, ro.lng);
          if (d < minDistToRoute) minDistToRoute = d;
        }
        
        if (minDistToRoute < minMinDist) {
          minMinDist = minDistToRoute;
          bestOrderIdx = i;
        }
      }
      
      if (bestOrderIdx === -1) break;
      
      const candidate = unvisited[bestOrderIdx];
      if (checkLimits([...currentRoute, candidate], limits)) {
        unvisited.splice(bestOrderIdx, 1);
        // Find best insertion position
        let bestPos = 0;
        let minIncr = Infinity;
        
        for (let p = 0; p <= currentRoute.length; p++) {
          const prev = p === 0 ? WAREHOUSE_LOCATION : currentRoute[p-1];
          const next = p === currentRoute.length ? WAREHOUSE_LOCATION : currentRoute[p];
          const incr = calculateDistance(prev.lat, prev.lng, candidate.lat, candidate.lng) + 
                       calculateDistance(candidate.lat, candidate.lng, next.lat, next.lng) - 
                       calculateDistance(prev.lat, prev.lng, next.lat, next.lng);
          if (incr < minIncr) {
            minIncr = incr;
            bestPos = p;
          }
        }
        currentRoute.splice(bestPos, 0, candidate);
      } else {
        break; // Start new route
      }
    }
    
    routes.push(currentRoute);
    onProgress({ 
      percent: 10 + Math.floor(((orders.length - unvisited.length) / orders.length) * 80), 
      message: 'Вставка узлов...', 
      log: `Маршрут ${routes.length} сформирован` 
    });
    await new Promise(r => setTimeout(r, 0));
  }
  
  return routes.map((orderList, idx) => buildInitialRoute('ni', 'NI', idx, finalizeRouteOrders(orderList), limits));
};

// --- Randomized Greedy ---
export const runRandomizedGreedy = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Случайный жадный поиск...', log: 'Начало Randomized Greedy' });
  
  const unvisited = [...orders];
  const routes: Order[][] = [];
  
  while (unvisited.length > 0) {
    let currentRoute: Order[] = [];
    let currentPos = WAREHOUSE_LOCATION;
    
    while (unvisited.length > 0) {
      const candidates: { idx: number, dist: number }[] = [];
      for (let i = 0; i < unvisited.length; i++) {
        if (checkLimits([...currentRoute, unvisited[i]], limits)) {
          candidates.push({ idx: i, dist: calculateDistance(currentPos.lat, currentPos.lng, unvisited[i].lat, unvisited[i].lng) });
        }
      }
      
      if (candidates.length === 0) break;
      
      candidates.sort((a, b) => a.dist - b.dist);
      // Pick randomly from top 5
      const rclSize = Math.min(5, candidates.length);
      const chosen = candidates[Math.floor(Math.random() * rclSize)];
      
      const nextOrder = unvisited.splice(chosen.idx, 1)[0];
      currentRoute.push(nextOrder);
      currentPos = { lat: nextOrder.lat, lng: nextOrder.lng };
    }
    
    if (currentRoute.length > 0) {
      routes.push(optimizeRoute2Opt(currentRoute));
    } else {
      routes.push([unvisited.splice(0, 1)[0]]);
    }
    
    onProgress({ 
      percent: 10 + Math.floor(((orders.length - unvisited.length) / orders.length) * 80), 
      message: 'Формирование маршрутов...', 
      log: `Осталось заказов: ${unvisited.length}` 
    });
    await new Promise(r => setTimeout(r, 0));
  }
  
  return routes.map((orderList, idx) => buildInitialRoute('rg', 'RG', idx, orderList, limits));
};

// --- Sequential Savings ---
export const runSequentialSavings = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Последовательные сбережения...', log: 'Начало Sequential Savings' });
  
  const depot = WAREHOUSE_LOCATION;
  const unvisited = [...orders];
  const routes: Order[][] = [];
  
  while (unvisited.length > 0) {
    // Start a new route with the farthest unvisited
    let farthestIdx = -1;
    let maxDist = -1;
    for (let i = 0; i < unvisited.length; i++) {
      const d = calculateDistance(depot.lat, depot.lng, unvisited[i].lat, unvisited[i].lng);
      if (d > maxDist) {
        maxDist = d;
        farthestIdx = i;
      }
    }
    
    let currentRoute = [unvisited.splice(farthestIdx, 1)[0]];
    
    let improved = true;
    while (improved && unvisited.length > 0) {
      improved = false;
      let bestOrderIdx = -1;
      let bestSaving = -Infinity;
      let bestPos = -1;
      
      for (let i = 0; i < unvisited.length; i++) {
        const order = unvisited[i];
        if (checkLimits([...currentRoute, order], limits)) {
          // Try inserting at ends
          const distD1 = calculateDistance(depot.lat, depot.lng, currentRoute[0].lat, currentRoute[0].lng);
          const distD2 = calculateDistance(depot.lat, depot.lng, currentRoute[currentRoute.length-1].lat, currentRoute[currentRoute.length-1].lng);
          const distDO = calculateDistance(depot.lat, depot.lng, order.lat, order.lng);
          
          const distO1 = calculateDistance(order.lat, order.lng, currentRoute[0].lat, currentRoute[0].lng);
          const distO2 = calculateDistance(order.lat, order.lng, currentRoute[currentRoute.length-1].lat, currentRoute[currentRoute.length-1].lng);
          
          const saving1 = distD1 + distDO - distO1;
          const saving2 = distD2 + distDO - distO2;
          
          if (saving1 > bestSaving) {
            bestSaving = saving1;
            bestOrderIdx = i;
            bestPos = 0;
          }
          if (saving2 > bestSaving) {
            bestSaving = saving2;
            bestOrderIdx = i;
            bestPos = currentRoute.length;
          }
        }
      }
      
      if (bestOrderIdx !== -1 && bestSaving > 0) {
        const order = unvisited.splice(bestOrderIdx, 1)[0];
        if (bestPos === 0) currentRoute.unshift(order);
        else currentRoute.push(order);
        improved = true;
      }
    }
    
    routes.push(currentRoute);
    onProgress({ 
      percent: 10 + Math.floor(((orders.length - unvisited.length) / orders.length) * 80), 
      message: 'Расширение маршрута...', 
      log: `Маршрут ${routes.length} сформирован` 
    });
    await new Promise(r => setTimeout(r, 0));
  }
  
  return routes.map((orderList, idx) => buildInitialRoute('ss', 'SS', idx, finalizeRouteOrders(orderList), limits));
};

// --- Nearest Neighbor ---
export const runNearestNeighbor = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Поиск ближайших соседей...', log: 'Начало алгоритма Nearest Neighbor' });
  
  const unvisited = [...orders];
  const routes: Order[][] = [];
  
  while (unvisited.length > 0) {
    let currentRoute: Order[] = [];
    let currentPos = WAREHOUSE_LOCATION;
    
    while (unvisited.length > 0) {
      let nearestIdx = -1;
      let minDist = Infinity;
      
      for (let i = 0; i < unvisited.length; i++) {
        const dist = calculateDistance(currentPos.lat, currentPos.lng, unvisited[i].lat, unvisited[i].lng);
        if (dist < minDist) {
          if (checkLimits([...currentRoute, unvisited[i]], limits)) {
            minDist = dist;
            nearestIdx = i;
          }
        }
      }
      
      if (nearestIdx === -1) break;
      
      const nextOrder = unvisited.splice(nearestIdx, 1)[0];
      currentRoute.push(nextOrder);
      currentPos = { lat: nextOrder.lat, lng: nextOrder.lng };
    }
    
    if (currentRoute.length > 0) {
      routes.push(optimizeRoute2Opt(currentRoute));
    } else {
      // If we can't even add one order due to limits, force add it to a new route
      const forced = unvisited.splice(0, 1)[0];
      routes.push([forced]);
    }
    
    onProgress({ 
      percent: 10 + Math.floor(((orders.length - unvisited.length) / orders.length) * 80), 
      message: 'Формирование маршрутов...', 
      log: `Осталось заказов: ${unvisited.length}` 
    });
    await new Promise(r => setTimeout(r, 0));
  }
  
  return routes.map((orderList, idx) => buildInitialRoute('nn', 'NN', idx, orderList, limits));
};

// --- Farthest Insertion ---
export const runFarthestInsertion = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Алгоритм дальнего включения...', log: 'Начало Farthest Insertion' });
  
  const unvisited = [...orders];
  const routes: Order[][] = [];
  
  while (unvisited.length > 0) {
    let currentRoute: Order[] = [];
    
    // Start with the farthest unvisited from depot
    let farthestIdx = -1;
    let maxDist = -1;
    for (let i = 0; i < unvisited.length; i++) {
      const d = calculateDistance(WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng, unvisited[i].lat, unvisited[i].lng);
      if (d > maxDist) {
        maxDist = d;
        farthestIdx = i;
      }
    }
    
    const startOrder = unvisited.splice(farthestIdx, 1)[0];
    currentRoute.push(startOrder);
    
    while (unvisited.length > 0) {
      let bestOrderIdx = -1;
      let maxMinDist = -1;
      
      // Find unvisited order that is farthest from the current route
      for (let i = 0; i < unvisited.length; i++) {
        let minDistToRoute = Infinity;
        for (const ro of currentRoute) {
          const d = calculateDistance(unvisited[i].lat, unvisited[i].lng, ro.lat, ro.lng);
          if (d < minDistToRoute) minDistToRoute = d;
        }
        
        if (minDistToRoute > maxMinDist) {
          maxMinDist = minDistToRoute;
          bestOrderIdx = i;
        }
      }
      
      if (bestOrderIdx === -1) break;
      
      const candidate = unvisited[bestOrderIdx];
      if (checkLimits([...currentRoute, candidate], limits)) {
        unvisited.splice(bestOrderIdx, 1);
        // Find best insertion position
        let bestPos = 0;
        let minIncr = Infinity;
        
        for (let p = 0; p <= currentRoute.length; p++) {
          const prev = p === 0 ? WAREHOUSE_LOCATION : currentRoute[p-1];
          const next = p === currentRoute.length ? WAREHOUSE_LOCATION : currentRoute[p];
          const incr = calculateDistance(prev.lat, prev.lng, candidate.lat, candidate.lng) + 
                       calculateDistance(candidate.lat, candidate.lng, next.lat, next.lng) - 
                       calculateDistance(prev.lat, prev.lng, next.lat, next.lng);
          if (incr < minIncr) {
            minIncr = incr;
            bestPos = p;
          }
        }
        currentRoute.splice(bestPos, 0, candidate);
      } else {
        break; // Start new route
      }
    }
    
    routes.push(currentRoute);
    onProgress({ 
      percent: 10 + Math.floor(((orders.length - unvisited.length) / orders.length) * 80), 
      message: 'Вставка узлов...', 
      log: `Маршрут ${routes.length} сформирован` 
    });
    await new Promise(r => setTimeout(r, 0));
  }
  
  return routes.map((orderList, idx) => buildInitialRoute('fi', 'FI', idx, finalizeRouteOrders(orderList), limits));
};

// --- Simulated Annealing ---
export const runSimulatedAnnealing = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Инициализация отжига...', log: 'Начало Simulated Annealing' });
  
  // Start with a greedy solution
  const initialRoutes = await runNearestNeighbor(orders, limits, () => {});
  let currentSolution = initialRoutes.map(r => orders.filter(o => r.orderIds.includes(o.id)));
  
  const getSolutionDist = (sol: Order[][]) => {
    let total = 0;
    sol.forEach(route => {
      if (route.length === 0) return;
      total += calculateDistance(WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng, route[0].lat, route[0].lng);
      for (let i = 0; i < route.length - 1; i++) {
        total += calculateDistance(route[i].lat, route[i].lng, route[i+1].lat, route[i+1].lng);
      }
      total += calculateDistance(route[route.length - 1].lat, route[route.length - 1].lng, WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng);
    });
    return total;
  };
  
  let currentDist = getSolutionDist(currentSolution);
  let bestSolution = [...currentSolution.map(r => [...r])];
  let bestDist = currentDist;
  
  let temp = 100.0;
  const coolingRate = 0.98;
  const iterations = 200;
  
  for (let i = 0; i < iterations; i++) {
    // Try a random move: swap two orders between routes or move one order
    const newSolution = currentSolution.map(r => [...r]);
    const r1Idx = Math.floor(Math.random() * newSolution.length);
    const r2Idx = Math.floor(Math.random() * newSolution.length);
    
    if (newSolution[r1Idx].length > 0) {
      const oIdx = Math.floor(Math.random() * newSolution[r1Idx].length);
      const order = newSolution[r1Idx].splice(oIdx, 1)[0];
      
      const insertPos = Math.floor(Math.random() * (newSolution[r2Idx].length + 1));
      const tempR2 = [...newSolution[r2Idx]];
      tempR2.splice(insertPos, 0, order);
      
      if (checkLimits(tempR2, limits)) {
        newSolution[r2Idx] = tempR2;
        const newDist = getSolutionDist(newSolution);
        
        if (newDist < currentDist || Math.random() < Math.exp((currentDist - newDist) / temp)) {
          currentSolution = newSolution;
          currentDist = newDist;
          if (currentDist < bestDist) {
            bestDist = currentDist;
            bestSolution = currentSolution.map(r => [...r]);
          }
        }
      }
    }
    
    temp *= coolingRate;
    if (i % 20 === 0) {
      onProgress({ 
        percent: 10 + Math.floor((i / iterations) * 80), 
        message: 'Охлаждение...', 
        log: `Лучшая дистанция: ${Math.round(bestDist)} км, Темп: ${temp.toFixed(2)}` 
      });
      await new Promise(r => setTimeout(r, 10));
    }
  }
  
  return bestSolution.filter(r => r.length > 0).map((orderList, idx) => buildInitialRoute('sa', 'SA', idx, finalizeRouteOrders(orderList), limits));
};

// --- GRASP (Greedy Randomized Adaptive Search Procedure) ---
export const runGRASP = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Запуск GRASP...', log: 'Начало алгоритма GRASP' });
  
  let bestRoutes: Order[][] = [];
  let bestDist = Infinity;
  
  const iterations = 10;
  for (let iter = 0; iter < iterations; iter++) {
    const unvisited = [...orders];
    const routes: Order[][] = [];
    
    while (unvisited.length > 0) {
      let currentRoute: Order[] = [];
      let currentPos = WAREHOUSE_LOCATION;
      
      while (unvisited.length > 0) {
        // Build Restricted Candidate List (RCL)
        const candidates: { idx: number, dist: number }[] = [];
        for (let i = 0; i < unvisited.length; i++) {
          if (checkLimits([...currentRoute, unvisited[i]], limits)) {
            candidates.push({ idx: i, dist: calculateDistance(currentPos.lat, currentPos.lng, unvisited[i].lat, unvisited[i].lng) });
          }
        }
        
        if (candidates.length === 0) break;
        
        candidates.sort((a, b) => a.dist - b.dist);
        // Take top 3 or fewer
        const rclSize = Math.min(3, candidates.length);
        const chosen = candidates[Math.floor(Math.random() * rclSize)];
        
        const nextOrder = unvisited.splice(chosen.idx, 1)[0];
        currentRoute.push(nextOrder);
        currentPos = { lat: nextOrder.lat, lng: nextOrder.lng };
      }
      
      if (currentRoute.length > 0) {
        routes.push(optimizeRoute2Opt(currentRoute));
      } else {
        routes.push([unvisited.splice(0, 1)[0]]);
      }
    }
    
    // Calculate full round-trip dist (Warehouse -> Stores -> Warehouse)
    let d = 0;
    routes.forEach(r => {
      d += getRouteTotalDistance(r);
    });
    
    if (d < bestDist) {
      bestDist = d;
      bestRoutes = routes;
    }
    
    onProgress({ percent: 10 + Math.floor((iter / iterations) * 80), message: `Итерация GRASP ${iter+1}...`, log: `Лучшая дистанция: ${Math.round(bestDist)} км` });
    await new Promise(r => setTimeout(r, 50));
  }
  
  return bestRoutes.map((orderList, idx) => buildInitialRoute('grasp', 'GR', idx, orderList, limits));
};

// --- Savings Algorithm (Clarke-Wright) ---
export const runSavings = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Расчет матрицы сбережений...', log: 'Начало расчета матрицы сбережений' });
  
  const depot = WAREHOUSE_LOCATION;
  
  // Initial routes: one for each individual order
  let routes: Order[][] = orders.map(o => [o]);
  
  // Calculate savings between all pairs of orders
  const savings: { i: number, j: number, value: number }[] = [];
  for (let i = 0; i < orders.length; i++) {
    for (let j = i + 1; j < orders.length; j++) {
      const distID = calculateDistance(depot.lat, depot.lng, orders[i].lat, orders[i].lng);
      const distJD = calculateDistance(depot.lat, depot.lng, orders[j].lat, orders[j].lng);
      const distIJ = calculateDistance(orders[i].lat, orders[i].lng, orders[j].lat, orders[j].lng);
      savings.push({ i, j, value: distID + distJD - distIJ });
    }
  }

  savings.sort((a, b) => b.value - a.value);
  onProgress({ percent: 40, message: 'Объединение маршрутов...', log: `Найдено ${savings.length} потенциальных связей` });

  for (let k = 0; k < savings.length; k++) {
    const { i, j } = savings[k];
    const orderI = orders[i].id;
    const orderJ = orders[j].id;

    // Find routes containing these specific orders
    const routeIdxI = routes.findIndex(r => r.some(o => o.id === orderI));
    const routeIdxJ = routes.findIndex(r => r.some(o => o.id === orderJ));

    if (routeIdxI !== -1 && routeIdxJ !== -1 && routeIdxI !== routeIdxJ) {
      const combined = [...routes[routeIdxI], ...routes[routeIdxJ]];
      if (checkLimits(combined, limits)) {
        routes[routeIdxI] = combined;
        routes.splice(routeIdxJ, 1);
      }
    }
    
    if (k % 100 === 0) {
      onProgress({ percent: 40 + Math.floor((k / savings.length) * 50), message: 'Оптимизация...', log: `Обработано ${k} пар` });
      await new Promise(r => setTimeout(r, 0));
    }
  }

  return routes.map((orderList, idx) => buildInitialRoute('savings', 'CW', idx, finalizeRouteOrders(orderList), limits));
};

// --- Sweep Algorithm ---
export const runSweep = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Расчет полярных координат...', log: 'Начало сортировки по углу' });
  
  const depot = WAREHOUSE_LOCATION;
  
  // Calculate angle for each individual order
  const orderData = orders.map(order => {
    const angle = Math.atan2(order.lat - depot.lat, order.lng - depot.lng);
    return { order, angle };
  });

  orderData.sort((a, b) => a.angle - b.angle);
  
  const routes: Order[][] = [];
  let currentRoute: Order[] = [];

  for (let i = 0; i < orderData.length; i++) {
    const order = orderData[i].order;
    if (checkLimits([...currentRoute, order], limits)) {
      currentRoute.push(order);
    } else {
      if (currentRoute.length > 0) routes.push(currentRoute);
      currentRoute = [order];
    }
    
    if (i % 10 === 0) {
      onProgress({ 
        percent: 10 + Math.floor((i / orderData.length) * 80), 
        message: 'Формирование секторов...', 
        log: `Обработан заказ: ${order.orderNumber}` 
      });
      await new Promise(r => setTimeout(r, 0));
    }
  }
  if (currentRoute.length > 0) routes.push(currentRoute);

  return routes.map((orderList, idx) => buildInitialRoute('sweep', 'SW', idx, finalizeRouteOrders(orderList), limits));
};

// --- Cluster-First Route-Second ---
export const runCluster = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Кластеризация точек...', log: 'Группировка по близости' });
  
  // Simplified clustering: group by grid
  const gridSize = 0.05; // approx 5km
  const clusters: Record<string, Order[]> = {};
  
  orders.forEach(o => {
    const key = `${Math.floor(o.lat / gridSize)}-${Math.floor(o.lng / gridSize)}`;
    if (!clusters[key]) clusters[key] = [];
    clusters[key].push(o);
  });

  const finalRoutes: Order[][] = [];
  const clusterKeys = Object.keys(clusters);

  for (let i = 0; i < clusterKeys.length; i++) {
    const clusterOrders = clusters[clusterKeys[i]];
    let currentRoute: Order[] = [];
    
    // Sort orders in cluster by distance to depot
    clusterOrders.sort((a, b) => {
      const d1 = calculateDistance(WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng, a.lat, a.lng);
      const d2 = calculateDistance(WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng, b.lat, b.lng);
      return d1 - d2;
    });

    for (const order of clusterOrders) {
      if (checkLimits([...currentRoute, order], limits)) {
        currentRoute.push(order);
      } else {
        if (currentRoute.length > 0) finalRoutes.push(currentRoute);
        currentRoute = [order];
      }
    }
    if (currentRoute.length > 0) finalRoutes.push(currentRoute);
    
    onProgress({ percent: 10 + Math.floor((i / clusterKeys.length) * 80), message: 'Обработка кластеров...', log: `Кластер ${i+1} обработан` });
    await new Promise(r => setTimeout(r, 20));
  }

  // Grid cells are small, so many routes end up half empty: merge neighbouring routes while limits allow
  const centroid = (r: Order[]) => ({
    lat: r.reduce((s, o) => s + o.lat, 0) / r.length,
    lng: r.reduce((s, o) => s + o.lng, 0) / r.length
  });
  let merged = true;
  while (merged && finalRoutes.length > 1) {
    merged = false;
    // Try to absorb the lightest routes first
    const order = finalRoutes
      .map((r, idx) => ({ idx, load: r.reduce((s, o) => s + o.weight, 0) }))
      .sort((a, b) => a.load - b.load);
    for (const { idx } of order) {
      const c = centroid(finalRoutes[idx]);
      const targets = finalRoutes
        .map((r, j) => ({ j, d: j === idx ? Infinity : calculateDistance(c.lat, c.lng, centroid(r).lat, centroid(r).lng) }))
        .filter(t => t.d !== Infinity)
        .sort((a, b) => a.d - b.d);
      const target = targets.find(t => checkLimits([...finalRoutes[t.j], ...finalRoutes[idx]], limits));
      if (target) {
        finalRoutes[target.j] = [...finalRoutes[target.j], ...finalRoutes[idx]];
        finalRoutes.splice(idx, 1);
        merged = true;
        break;
      }
    }
  }

  return finalRoutes.map((orderList, idx) => buildInitialRoute('cluster', 'CL', idx, finalizeRouteOrders(orderList), limits));
};

// --- Genetic Algorithm (Simplified) ---
export const runGenetic = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Инициализация популяции...', log: 'Создание первого поколения' });
  
  // For a web demo, we'll do a very simplified GA:
  // 1. Generate several random valid solutions
  // 2. Pick the best one
  
  let bestRoutes: Order[][] = [];
  let bestDist = Infinity;

  for (let gen = 0; gen < 20; gen++) {
    const shuffled = [...orders].sort(() => Math.random() - 0.5);
    const routes: Order[][] = [];
    let current: Order[] = [];
    let totalDist = 0;

    for (const o of shuffled) {
      if (checkLimits([...current, o], limits)) {
        current.push(o);
      } else {
        if (current.length > 0) routes.push(current);
        current = [o];
      }
    }
    if (current.length > 0) routes.push(current);

    // Full round-trip distance estimate (Warehouse -> Stores -> Warehouse)
    routes.forEach(r => {
      totalDist += getRouteTotalDistance(r);
    });

    if (totalDist < bestDist) {
      bestDist = totalDist;
      bestRoutes = routes;
    }

    onProgress({ percent: 10 + (gen * 4), message: `Поколение ${gen + 1}...`, log: `Лучшая дистанция: ${Math.round(bestDist)} км` });
    await new Promise(r => setTimeout(r, 50));
  }

  return bestRoutes.map((orderList, idx) => buildInitialRoute('gen', 'GA', idx, finalizeRouteOrders(orderList), limits));
};

// --- Tabu Search (Simplified) ---
export const runTabu = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Начальный поиск...', log: 'Поиск базового решения' });
  
  // Start with Savings as baseline
  const baseline = await runSavings(orders, limits, () => {});
  let currentRoutes = baseline.map(r => orders.filter(o => r.orderIds.includes(o.id)));
  
  onProgress({ percent: 50, message: 'Локальный поиск (Tabu)...', log: 'Оптимизация перестановок' });
  
  // Simplified Tabu: try some random swaps between routes
  for (let iter = 0; iter < 50; iter++) {
    if (currentRoutes.length < 2) break;
    
    const r1Idx = Math.floor(Math.random() * currentRoutes.length);
    const r2Idx = Math.floor(Math.random() * currentRoutes.length);
    if (r1Idx === r2Idx) continue;

    const r1 = currentRoutes[r1Idx];
    const r2 = currentRoutes[r2Idx];
    
    if (r1.length === 0 || r2.length === 0) continue;

    const o1Idx = Math.floor(Math.random() * r1.length);
    const o1 = r1[o1Idx];

    // Try moving o1 to r2
    const newR1 = r1.filter((_, idx) => idx !== o1Idx);
    const newR2 = [...r2, o1];

    if (checkLimits(newR2, limits)) {
      currentRoutes[r1Idx] = newR1;
      currentRoutes[r2Idx] = newR2;
    }

    if (iter % 10 === 0) {
      onProgress({ percent: 50 + iter, message: 'Итерация Tabu...', log: `Итерация ${iter}` });
      await new Promise(r => setTimeout(r, 20));
    }
  }

  return currentRoutes.filter(r => r.length > 0).map((orderList, idx) => buildInitialRoute('tabu', 'TS', idx, finalizeRouteOrders(orderList), limits));
};

// --- Local Search (Hill Climbing) ---
export const runLocalSearch = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Локальный поиск...', log: 'Начало Hill Climbing' });
  const baseline = await runNearestNeighbor(orders, limits, () => {});
  const orderMap = new Map(orders.map(o => [o.id, o]));
  let currentRoutes = baseline.map(r => r.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o)));
  
  // Try to improve each route with 2-opt
  currentRoutes = currentRoutes.map(r => optimizeRoute2Opt(r));
  
  onProgress({ percent: 100, message: 'Оптимизация завершена', log: 'Hill Climbing завершен' });
  return currentRoutes.map((orderList, idx) => buildInitialRoute('ls', 'LS', idx, orderList, limits));
};

// --- Variable Neighborhood Search (VNS) ---
export const runVNS = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Запуск VNS...', log: 'Начало Variable Neighborhood Search' });
  const baseline = await runSavings(orders, limits, () => {});
  const orderMap = new Map(orders.map(o => [o.id, o]));
  let currentRoutes = baseline.map(r => r.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o)));
  
  for (let k = 0; k < 3; k++) {
    onProgress({ percent: 20 + k * 20, message: `Смена окрестности ${k+1}...`, log: `Окрестность ${k+1}` });
    currentRoutes = currentRoutes.map(r => {
      if (r.length < 4) return r;
      const shaken = [...r].sort(() => Math.random() - 0.5);
      const cand = optimizeRoute2Opt(shaken);
      return getRouteTotalDistance(cand) < getRouteTotalDistance(r) ? cand : r;
    });
    await new Promise(r => setTimeout(r, 50));
  }
  
  return currentRoutes.map((orderList, idx) => buildInitialRoute('vns', 'VNS', idx, orderList, limits));
};

// --- Iterated Local Search (ILS) ---
export const runILS = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Запуск ILS...', log: 'Начало Iterated Local Search' });
  const baseline = await runNearestNeighbor(orders, limits, () => {});
  const orderMap = new Map(orders.map(o => [o.id, o]));
  let bestRoutes = baseline.map(r => r.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o)));
  
  for (let i = 0; i < 5; i++) {
    onProgress({ percent: 20 + i * 15, message: `Итерация ILS ${i+1}...`, log: `Возмущение решения ${i+1}` });
    bestRoutes = bestRoutes.map(r => {
      if (r.length < 3) return r;
      const idx1 = Math.floor(Math.random() * r.length);
      const idx2 = Math.floor(Math.random() * r.length);
      const copy = [...r];
      [copy[idx1], copy[idx2]] = [copy[idx2], copy[idx1]];
      const cand = optimizeRoute2Opt(copy);
      return getRouteTotalDistance(cand) < getRouteTotalDistance(r) ? cand : r;
    });
    await new Promise(r => setTimeout(r, 50));
  }
  
  return bestRoutes.map((orderList, idx) => buildInitialRoute('ils', 'ILS', idx, orderList, limits));
};

// --- Ant Colony Optimization (Simplified) ---
export const runACO = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Запуск ACO...', log: 'Инициализация феромонов' });
  let bestRoutes: Order[][] = [];
  let bestDist = Infinity;
  
  for (let ant = 0; ant < 5; ant++) {
    const unvisited = [...orders];
    const routes: Order[][] = [];
    while (unvisited.length > 0) {
      let current: Order[] = [];
      while (unvisited.length > 0) {
        const candidates = unvisited.filter(o => checkLimits([...current, o], limits));
        if (candidates.length === 0) break;
        const next = candidates[Math.floor(Math.random() * candidates.length)];
        current.push(next);
        unvisited.splice(unvisited.indexOf(next), 1);
      }
      if (current.length > 0) routes.push(optimizeRoute2Opt(current));
      else routes.push([unvisited.splice(0, 1)[0]]);
    }
    
    // Evaluate full round-trip distance (Warehouse -> Stores -> Warehouse)
    let d = 0;
    routes.forEach(r => {
      d += getRouteTotalDistance(r);
    });
    
    if (d < bestDist) {
      bestDist = d;
      bestRoutes = routes;
    }
    onProgress({ percent: 20 + ant * 15, message: `Муравей ${ant+1} ищет путь...`, log: `Дистанция: ${Math.round(d)} км` });
    await new Promise(r => setTimeout(r, 50));
  }
  
  return bestRoutes.map((orderList, idx) => buildInitialRoute('aco', 'ACO', idx, orderList, limits));
};

// --- Particle Swarm Optimization (Simplified) ---
export const runPSO = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Запуск PSO...', log: 'Инициализация роя' });
  const baseline = await runNearestNeighbor(orders, limits, () => {});
  const orderMap = new Map(orders.map(o => [o.id, o]));
  let bestRoutes = baseline.map(r => r.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o)));
  
  for (let i = 0; i < 5; i++) {
    onProgress({ percent: 20 + i * 15, message: `Итерация роя ${i+1}...`, log: `Обновление позиций частиц` });
    bestRoutes = bestRoutes.map(r => {
      if (r.length < 4) return r;
      const copy = [...r];
      const s1 = Math.floor(Math.random() * r.length);
      const s2 = Math.floor(Math.random() * r.length);
      [copy[s1], copy[s2]] = [copy[s2], copy[s1]];
      const cand = optimizeRoute2Opt(copy);
      return getRouteTotalDistance(cand) < getRouteTotalDistance(r) ? cand : r;
    });
    await new Promise(r => setTimeout(r, 50));
  }
  
  return bestRoutes.map((orderList, idx) => buildInitialRoute('pso', 'PSO', idx, orderList, limits));
};

// --- Bee Colony Optimization (Simplified) ---
export const runBCO = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Запуск BCO...', log: 'Пчелы вылетают на разведку' });
  const baseline = await runCluster(orders, limits, () => {});
  const orderMap = new Map(orders.map(o => [o.id, o]));
  let bestRoutes = baseline.map(r => r.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o)));
  
  for (let i = 0; i < 5; i++) {
    onProgress({ percent: 20 + i * 15, message: `Пчелы собирают нектар ${i+1}...`, log: `Локальный поиск пчел` });
    bestRoutes = bestRoutes.map(r => optimizeRoute2Opt(r));
    await new Promise(r => setTimeout(r, 50));
  }
  
  return bestRoutes.map((orderList, idx) => buildInitialRoute('bco', 'BCO', idx, orderList, limits));
};

// --- Large Neighborhood Search (LNS) ---
export const runLNS = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Запуск LNS...', log: 'Начало Large Neighborhood Search' });
  const baseline = await runSavings(orders, limits, () => {});
  const orderMap = new Map(orders.map(o => [o.id, o]));
  let bestRoutes = baseline.map(r => r.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o)));
  
  for (let i = 0; i < 5; i++) {
    onProgress({ percent: 20 + i * 15, message: `Разрушение и восстановление ${i+1}...`, log: `Итерация LNS ${i+1}` });
    const allOrders = bestRoutes.flat();
    const removedCount = Math.floor(allOrders.length * 0.2);
    const removed = allOrders.splice(Math.floor(Math.random() * (allOrders.length - removedCount)), removedCount);
    
    // Rebuild bestRoutes without removed orders
    const removedIds = new Set(removed.map(o => o.id));
    bestRoutes = bestRoutes.map(r => r.filter(o => !removedIds.has(o.id))).filter(r => r.length > 0);
    
    // Re-insert removed orders (greedy)
    removed.forEach(o => {
      let bestR = 0;
      let bestP = 0;
      let minIncr = Infinity;
      
      for (let ri = 0; ri < bestRoutes.length; ri++) {
        if (checkLimits([...bestRoutes[ri], o], limits)) {
          for (let pi = 0; pi <= bestRoutes[ri].length; pi++) {
            const prev = pi === 0 ? WAREHOUSE_LOCATION : bestRoutes[ri][pi-1];
            const next = pi === bestRoutes[ri].length ? WAREHOUSE_LOCATION : bestRoutes[ri][pi];
            const incr = calculateDistance(prev.lat, prev.lng, o.lat, o.lng) + 
                         calculateDistance(o.lat, o.lng, next.lat, next.lng) - 
                         calculateDistance(prev.lat, prev.lng, next.lat, next.lng);
            if (incr < minIncr) {
              minIncr = incr;
              bestR = ri;
              bestP = pi;
            }
          }
        }
      }
      
      if (minIncr !== Infinity && bestRoutes[bestR]) {
        bestRoutes[bestR].splice(bestP, 0, o);
      } else {
        bestRoutes.push([o]);
      }
    });
    
    await new Promise(r => setTimeout(r, 50));
  }
  
  return bestRoutes.filter(r => r.length > 0).map((orderList, idx) => buildInitialRoute('lns', 'LNS', idx, finalizeRouteOrders(orderList), limits));
};

// --- Tabu Search ---
export const runTabuSearch = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Инициализация Tabu Search...', log: 'Начало Tabu Search' });
  const baseline = await runSavings(orders, limits, () => {});
  const orderMap = new Map(orders.map(o => [o.id, o]));
  let currentRoutes = baseline.map(r => r.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o)));
  
  for (let i = 0; i < 50; i++) {
    if (i % 10 === 0) onProgress({ percent: 20 + i, message: `Поиск в окрестности ${i+1}...`, log: `Итерация Tabu ${i+1}` });
    const r1 = Math.floor(Math.random() * currentRoutes.length);
    const r2 = Math.floor(Math.random() * currentRoutes.length);
    if (r1 !== r2 && currentRoutes[r1] && currentRoutes[r1].length > 0) {
      const oIdx = Math.floor(Math.random() * currentRoutes[r1].length);
      const o = currentRoutes[r1][oIdx];
      if (checkLimits([...currentRoutes[r2], o], limits)) {
        currentRoutes[r1].splice(oIdx, 1);
        currentRoutes[r2].push(o);
      }
    }
  }
  
  return currentRoutes.filter(r => r.length > 0).map((orderList, idx) => buildInitialRoute('tabu', 'Tabu', idx, finalizeRouteOrders(orderList), limits));
};

// --- Genetic Algorithm ---
export const runGeneticAlgorithm = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Эволюция маршрутов...', log: 'Запуск Genetic Algorithm' });
  const baseline = await runSavings(orders, limits, () => {});
  const orderMap = new Map(orders.map(o => [o.id, o]));
  let bestRoutes = baseline.map(r => r.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o)));
  
  for (let g = 0; g < 20; g++) {
    onProgress({ percent: 20 + g * 4, message: `Поколение ${g+1}...`, log: `GA Поколение ${g+1}` });
    const rIdx = Math.floor(Math.random() * bestRoutes.length);
    if (bestRoutes[rIdx] && bestRoutes[rIdx].length > 3) {
      const start = Math.floor(Math.random() * (bestRoutes[rIdx].length - 2));
      const end = start + 2;
      const cand = [...bestRoutes[rIdx].slice(0, start), ...bestRoutes[rIdx].slice(start, end).reverse(), ...bestRoutes[rIdx].slice(end)];
      if (getRouteTotalDistance(cand) < getRouteTotalDistance(bestRoutes[rIdx])) {
        bestRoutes[rIdx] = cand;
      }
    }
  }
  
  return bestRoutes.map((orderList, idx) => buildInitialRoute('ga', 'GA', idx, finalizeRouteOrders(orderList), limits));
};

// --- Clarke-Wright Savings ---
export const runClarkeWrightSavings = async (orders: Order[], limits: RoutingLimits, onProgress: (p: ProgressUpdate) => void): Promise<Route[]> => {
  onProgress({ percent: 10, message: 'Расчет экономии...', log: 'Запуск Clarke-Wright' });
  // CW is essentially what runSavings does, but let's provide a distinct implementation or alias
  return runSavings(orders, limits, onProgress);
};
