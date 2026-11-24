import { Order, TruckType } from '../../types';
import type { RoutingLimits } from '../routingService';
import { RoadMatrixLookup } from './RoadMatrix';

export interface TimeWindowInterval {
  startMinutes: number; // minutes from 00:00 (e.g. 08:00 = 480)
  endMinutes: number;   // minutes from 00:00 (e.g. 12:00 = 720)
}

/**
 * Standard tolerance of 3% for load limits.
 */
export const LOAD_TOLERANCE_RATIO = 1.03;
export const LOAD_TOLERANCE = LOAD_TOLERANCE_RATIO;

export interface EffectiveCapacityLimits {
  baseMaxWeight: number;
  baseMaxVolume: number;
  effectiveMaxWeight: number;
  effectiveMaxVolume: number;
  truck?: TruckType;
  truckId?: string;
  truckName?: string;
}

/**
 * Unified capacity resolver:
 * 1. If truckTypes exist: find minimum suitable truck type (or assigned truck)
 * 2. If truckTypes absent: fallback to global maxWeight / maxVolume
 * 3. Applies consistent 3% tolerance across optimizer, validator, KPI, details, benchmark.
 */
export function getEffectiveCapacityLimit(
  routeOrders: Order[],
  limits: RoutingLimits,
  assignedTruckId?: string,
  applyTolerance: boolean = true
): EffectiveCapacityLimits {
  let baseMaxW = limits.maxWeight > 0 ? limits.maxWeight : 1500;
  let baseMaxV = limits.maxVolume > 0 ? limits.maxVolume : 12;
  let truck: TruckType | undefined;

  if (limits.truckTypes && limits.truckTypes.length > 0) {
    if (assignedTruckId) {
      truck = limits.truckTypes.find(t => t.id === assignedTruckId || t.name === assignedTruckId);
    }
    if (!truck) {
      const bestId = findBestTruck(routeOrders, limits);
      truck = limits.truckTypes.find(t => t.id === bestId);
    }
    if (truck) {
      baseMaxW = truck.maxWeight;
      baseMaxV = truck.maxVolume;
    } else {
      // If none can fit within limits, use the largest configured truck type
      const sorted = [...limits.truckTypes].sort((a, b) => b.maxVolume - a.maxVolume || b.maxWeight - a.maxWeight);
      truck = sorted[0];
      baseMaxW = truck?.maxWeight || limits.maxWeight || 1500;
      baseMaxV = truck?.maxVolume || limits.maxVolume || 12;
    }
    // Respect explicit global ceiling if user configured one in general limits
    if (limits.maxWeight > 0 && limits.maxWeight < baseMaxW) {
      baseMaxW = limits.maxWeight;
    }
    if (limits.maxVolume > 0 && limits.maxVolume < baseMaxV) {
      baseMaxV = limits.maxVolume;
    }
  }

  const mult = applyTolerance ? LOAD_TOLERANCE_RATIO : 1.0;
  return {
    baseMaxWeight: baseMaxW,
    baseMaxVolume: baseMaxV,
    effectiveMaxWeight: baseMaxW * mult,
    effectiveMaxVolume: baseMaxV * mult,
    truck,
    truckId: truck?.id,
    truckName: truck?.name
  };
}

const timeSlotCache = new Map<string, TimeWindowInterval>();

/**
 * Parses a textual or interval time slot into minutes from midnight (memoized: called in the optimizer hot path).
 */
export function parseTimeSlot(slotStr?: string): TimeWindowInterval {
  if (!slotStr || typeof slotStr !== 'string') return parseTimeSlotUncached(slotStr);
  let cached = timeSlotCache.get(slotStr);
  if (!cached) {
    cached = parseTimeSlotUncached(slotStr);
    if (timeSlotCache.size > 5000) timeSlotCache.clear();
    timeSlotCache.set(slotStr, cached);
  }
  return cached;
}

function parseTimeSlotUncached(slotStr?: string): TimeWindowInterval {
  if (!slotStr || typeof slotStr !== 'string') {
    return { startMinutes: 480, endMinutes: 1260 }; // Default 08:00 - 21:00 (full working day)
  }

  const s = slotStr.trim().toLowerCase();

  // Keyword slots
  if (s.includes('утро') || s.includes('morn') || s.includes('səhər')) {
    return { startMinutes: 480, endMinutes: 750 }; // 08:00 - 12:30
  }
  if (s.includes('день') || s.includes('day') || s.includes('günorta') || s.includes('öğle')) {
    return { startMinutes: 720, endMinutes: 1050 }; // 12:00 - 17:30
  }
  if (s.includes('вечер') || s.includes('even') || s.includes('axşam') || s.includes('akşam')) {
    return { startMinutes: 1020, endMinutes: 1290 }; // 17:00 - 21:30
  }

  // Regex format: "HH:MM-HH:MM" or "HH:MM - HH:MM" or "H:MM-H:MM"
  const match = s.match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  if (match) {
    const startH = parseInt(match[1], 10);
    const startM = parseInt(match[2], 10);
    const endH = parseInt(match[3], 10);
    const endM = parseInt(match[4], 10);
    return {
      startMinutes: startH * 60 + startM,
      endMinutes: endH * 60 + endM
    };
  }

  return { startMinutes: 480, endMinutes: 1260 };
}

/**
 * Helper to match an order's allowedTruckType by either ID or name.
 */
function findAllowedTruck(allowedTruckType: string | undefined, truckTypes: TruckType[]): TruckType | undefined {
  if (!allowedTruckType) return undefined;
  const norm = allowedTruckType.trim().toLowerCase();
  return truckTypes.find(t => t.id.toLowerCase() === norm || t.name.trim().toLowerCase() === norm);
}

/**
 * Validates hard capacity constraints for a route of orders.
 * Note: A single-order route (routeOrders.length <= 1) is always permitted so an individual
 * oversized order gets its own dedicated vehicle instead of failing the entire routing run.
 */
export function checkHardLimits(routeOrders: Order[], limits: RoutingLimits): boolean {
  if (routeOrders.length <= 1) return true;

  const weight = routeOrders.reduce((sum, o) => sum + (o.weight || 0), 0);
  const volume = routeOrders.reduce((sum, o) => sum + (o.volume || 0), 0);
  const satir = routeOrders.reduce((sum, o) => sum + (o.satir || 0), 0);
  const customers = new Set(routeOrders.map(o => o.customerName)).size;
  const regions = new Set(routeOrders.map(o => o.region)).size;

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

  // Must NOT stay together constraint check
  if (limits.mustNotStayTogether && limits.mustNotStayTogether.length > 0) {
    const orderIdSet = new Set(routeOrders.map(o => o.id));
    for (const [idA, idB] of limits.mustNotStayTogether) {
      if (orderIdSet.has(idA) && orderIdSet.has(idB)) {
        return false;
      }
    }
  }

  // Basic limits: weight, volume, satir, customers, regions
  if (limits.maxWeight > 0 && weight > limits.maxWeight * LOAD_TOLERANCE_RATIO) return false;
  if (limits.maxVolume > 0 && volume > limits.maxVolume * LOAD_TOLERANCE_RATIO) return false;
  if (limits.maxSatir > 0 && satir > limits.maxSatir * LOAD_TOLERANCE_RATIO) return false;
  if (limits.maxCustomers > 0 && customers > limits.maxCustomers * LOAD_TOLERANCE_RATIO) return false;
  if (limits.maxRegions > 0 && regions > limits.maxRegions) return false;

  // Truck type limits
  if (limits.truckTypes && limits.truckTypes.length > 0) {
    const possibleTrucks = limits.truckTypes.filter(truck => {
      if (weight > truck.maxWeight * LOAD_TOLERANCE_RATIO) return false;
      if (volume > truck.maxVolume * LOAD_TOLERANCE_RATIO) return false;
      return routeOrders.every(order => {
        if (!order.allowedTruckType) return true;
        const allowedTruck = findAllowedTruck(order.allowedTruckType, limits.truckTypes!);
        if (!allowedTruck) return true;
        return truck.rank <= allowedTruck.rank;
      });
    });

    if (possibleTrucks.length === 0) return false;
  }

  return true;
}

/**
 * Finds the most efficient truck assignment (smallest rank capable).
 * Falls back to the largest capacity truck if a single oversized order exceeds standard limits.
 */
export function findBestTruck(routeOrders: Order[], limits: RoutingLimits): string | undefined {
  if (!limits.truckTypes || limits.truckTypes.length === 0) return undefined;

  const weight = routeOrders.reduce((sum, o) => sum + (o.weight || 0), 0);
  const volume = routeOrders.reduce((sum, o) => sum + (o.volume || 0), 0);

  const possibleTrucks = limits.truckTypes.filter(truck => {
    if (weight > truck.maxWeight * LOAD_TOLERANCE_RATIO) return false;
    if (volume > truck.maxVolume * LOAD_TOLERANCE_RATIO) return false;
    return routeOrders.every(order => {
      if (!order.allowedTruckType) return true;
      const allowedTruck = findAllowedTruck(order.allowedTruckType, limits.truckTypes!);
      if (!allowedTruck) return true;
      return truck.rank <= allowedTruck.rank;
    });
  });

  if (possibleTrucks.length === 0) {
    return [...limits.truckTypes].sort((a, b) => b.maxVolume - a.maxVolume || b.maxWeight - a.maxWeight)[0]?.id;
  }
  return possibleTrucks.sort((a, b) => a.rank - b.rank)[0].id;
}

/**
 * Effective vehicle capacity for the route.
 */
export function getRouteCapacities(
  routeOrders: Order[],
  limits: RoutingLimits,
  assignedTruckId?: string
): { maxW: number; maxV: number; truckName?: string; effectiveMaxW: number; effectiveMaxV: number } {
  const cap = getEffectiveCapacityLimit(routeOrders, limits, assignedTruckId, true);
  return {
    maxW: cap.baseMaxWeight,
    maxV: cap.baseMaxVolume,
    truckName: cap.truckName,
    effectiveMaxW: cap.effectiveMaxWeight,
    effectiveMaxV: cap.effectiveMaxVolume
  };
}

export interface RouteScheduleResult {
  totalDrivingMinutes: number;
  totalWaitingMinutes: number;
  totalServiceMinutes: number;
  totalDurationMinutes: number;
  totalLatenessMinutes: number;
  violationsCount: number;
}

/**
 * Evaluates route duration across all stops: driving time + service time.
 * Delivery time slots are symbolic labels and are NOT simulated, so waiting, lateness and
 * violations are always 0 (the fields are kept so older code and saved routes keep working).
 */
export function evaluateRouteSchedule(
  orderIndices: number[],
  matrix: RoadMatrixLookup,
  ordersMap: Order[],
  serviceTimeMinutes: number = 10,
  depotStartMinutes: number = 480 // 08:00
): RouteScheduleResult {
  if (orderIndices.length === 0) {
    return {
      totalDrivingMinutes: 0,
      totalWaitingMinutes: 0,
      totalServiceMinutes: 0,
      totalDurationMinutes: 0,
      totalLatenessMinutes: 0,
      violationsCount: 0
    };
  }

  let currentTime = Number.isFinite(depotStartMinutes) ? depotStartMinutes : 480;
  const effServiceMin = Number.isFinite(serviceTimeMinutes) ? serviceTimeMinutes : 10;
  let totalDriving = 0;
  let totalWaiting = 0;
  let totalService = 0;
  let totalLateness = 0;
  let violations = 0;

  let prevNode = 0; // Depot
  let prevCustomerName: string | null = null;

  for (let i = 0; i < orderIndices.length; i++) {
    const node = orderIndices[i];
    const order = ordersMap[node - 1]; // ordersMap is 0-indexed, node 1..N
    const isSameStoreAsPrev = Boolean(
      prevNode > 0 &&
      order &&
      prevCustomerName &&
      order.customerName === prevCustomerName
    );

    const travelTime = isSameStoreAsPrev ? 0 : matrix.getDuration(prevNode, node);
    currentTime += travelTime;
    totalDriving += travelTime;

    // Time slots ("Утро" / "День" / "Вечер") are only labels: no waiting, no lateness, no violations.

    // Add service time once per unique physical store stop
    if (!isSameStoreAsPrev) {
      currentTime += effServiceMin;
      totalService += effServiceMin;
    }

    prevNode = node;
    prevCustomerName = order?.customerName || null;
  }

  // Return to depot
  const returnTravel = matrix.getDuration(prevNode, 0);
  currentTime += returnTravel;
  totalDriving += returnTravel;

  // Driving time + Waiting time + Service time = Total route duration
  const totalDuration = totalDriving + totalWaiting + totalService;

  return {
    totalDrivingMinutes: Math.round(totalDriving * 10) / 10,
    totalWaitingMinutes: Math.round(totalWaiting * 10) / 10,
    totalServiceMinutes: Math.round(totalService * 10) / 10,
    totalDurationMinutes: Math.round(totalDuration * 10) / 10,
    totalLatenessMinutes: Math.round(totalLateness * 10) / 10,
    violationsCount: violations
  };
}
