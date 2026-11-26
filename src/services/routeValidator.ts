import { Route, Order, TruckType, RoutingSource } from '../types';
import { RoutingLimits } from './routingService';
import { getRouteDistanceInfo } from './distanceHelper';
import { getEffectiveCapacityLimit, LOAD_TOLERANCE_RATIO } from './optimizer/ConstraintValidator';
import { peakLoad } from './loadProfile';

export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface RouteValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  detail?: string;
  orderId?: string;
}

export interface RouteValidationResult {
  routeId: string;
  routeName: string;
  status: 'VALID' | 'WARNING' | 'ERROR';
  issues: RouteValidationIssue[];
  errorCount: number;
  warningCount: number;
  checks: {
    weightOk: boolean;
    volumeOk: boolean;
    coordinatesOk: boolean;
    ordersUniqueOk: boolean;
    vehicleOk: boolean;
    roadDistanceOk: boolean;
    datesConsistent: boolean;
  };
  metrics: {
    totalWeight: number;
    maxWeight: number;
    weightPercent: number;
    totalVolume: number;
    maxVolume: number;
    volumePercent: number;
    orderCount: number;
    storeCount: number;
    straightDistanceKm: number;
    roadDistanceKm?: number;
    roadDurationMin?: number;
    routingSource: RoutingSource;
    truckTypeName?: string;
  };
}

export interface PlanValidationResult {
  status: 'VALID' | 'WARNING' | 'ERROR';
  totalRoutes: number;
  validRoutesCount: number;
  warningRoutesCount: number;
  errorRoutesCount: number;
  totalOrders: number;
  assignedOrdersCount: number;
  unassignedOrdersCount: number;
  duplicateOrdersCount: number;
  unknownOrdersCount: number;
  fallbackRoutesCount: number;
  routeResults: RouteValidationResult[];
  globalIssues: RouteValidationIssue[];
  hasErrors: boolean;
  hasWarnings: boolean;
}

/**
 * Validates a single order's coordinates.
 */
export function validateCoordinates(order: Order): { isValid: boolean; reason?: string } {
  if (order.lat === undefined || order.lng === undefined || order.lat === null || order.lng === null) {
    return { isValid: false, reason: 'Координаты не заданы' };
  }
  if (isNaN(order.lat) || isNaN(order.lng)) {
    return { isValid: false, reason: 'Координаты не являются числами' };
  }
  if (order.lat === 0 && order.lng === 0) {
    return { isValid: false, reason: 'Нулевые координаты (0, 0)' };
  }
  if (order.lat < -90 || order.lat > 90) {
    return { isValid: false, reason: `Широта ${order.lat} вне допустимого диапазона [-90, 90]` };
  }
  if (order.lng < -180 || order.lng > 180) {
    return { isValid: false, reason: `Долгота ${order.lng} вне допустимого диапазона [-180, 180]` };
  }
  return { isValid: true };
}

/**
 * Validates a single route in isolation and in context of assigned truck/limits.
 */
export function validateSingleRoute(
  route: Route,
  allOrders: Order[],
  limits: RoutingLimits,
  orderOccurrenceMap?: Map<string, string[]>
): RouteValidationResult {
  const issues: RouteValidationIssue[] = [];
  const orderMap = new Map(allOrders.map(o => [o.id, o]));

  const routeOrders: Order[] = [];
  let unknownOrdersCount = 0;

  for (const id of (route.orderIds || [])) {
    const o = orderMap.get(id);
    if (o) {
      routeOrders.push(o);
    } else {
      unknownOrdersCount++;
      issues.push({
        code: 'UNKNOWN_ORDER',
        severity: 'ERROR',
        message: `Неизвестный заказ в маршруте: ID ${id}`,
        detail: 'Заказ отсутствует в основном списке заказов',
        orderId: id
      });
    }
  }

  // 1. Empty route check
  if ((route.orderIds || []).length === 0) {
    issues.push({
      code: 'EMPTY_ROUTE',
      severity: 'WARNING',
      message: 'Маршрут не содержит ни одного заказа'
    });
  }

  // 2. Determine vehicle and capacity limits using unified getEffectiveCapacityLimit
  const effectiveCap = getEffectiveCapacityLimit(routeOrders, limits, route.truckTypeId, true);
  const assignedTruck = effectiveCap.truck;
  const maxWeight = effectiveCap.baseMaxWeight;
  const maxVolume = effectiveCap.baseMaxVolume;
  const effectiveMaxWeight = effectiveCap.effectiveMaxWeight;
  const effectiveMaxVolume = effectiveCap.effectiveMaxVolume;

  // highest load in the truck along the route (store-to-store transfers are picked up on the way)
  const { w: totalWeight, v: totalVolume } = peakLoad(routeOrders);
  const storeNames = new Set(routeOrders.map(o => o.customerName));

  // Weight check with consistent tolerance
  let weightOk = true;
  if (effectiveMaxWeight > 0 && totalWeight > effectiveMaxWeight) {
    weightOk = false;
    const overload = Math.round(totalWeight - maxWeight);
    issues.push({
      code: 'WEIGHT_OVERLOAD',
      severity: 'ERROR',
      message: `Перегруз по весу на ${overload} кг (сверх допуска 3%)`,
      detail: `Факт: ${Math.round(totalWeight)} кг, Лимит: ${Math.round(maxWeight)} кг ${effectiveCap.truckName ? `(${effectiveCap.truckName})` : ''}`
    });
  } else if (maxWeight > 0 && totalWeight > maxWeight) {
    // Within 3% tolerance: warning, NOT error
    issues.push({
      code: 'WEIGHT_TOLERANCE_WARNING',
      severity: 'WARNING',
      message: `Загрузка по весу ${Math.round((totalWeight / maxWeight) * 100)}% (в пределах допустимого отклонения 3%)`,
      detail: `Факт: ${Math.round(totalWeight)} кг, Базовый лимит: ${Math.round(maxWeight)} кг`
    });
  }

  // Volume check with consistent tolerance
  let volumeOk = true;
  if (effectiveMaxVolume > 0 && totalVolume > effectiveMaxVolume) {
    volumeOk = false;
    const overload = Math.round((totalVolume - maxVolume) * 10) / 10;
    issues.push({
      code: 'VOLUME_OVERLOAD',
      severity: 'ERROR',
      message: `Перегруз по объему на ${overload} м³ (сверх допуска 3%)`,
      detail: `Факт: ${Math.round(totalVolume * 10) / 10} м³, Лимит: ${Math.round(maxVolume * 10) / 10} м³ ${effectiveCap.truckName ? `(${effectiveCap.truckName})` : ''}`
    });
  } else if (maxVolume > 0 && totalVolume > maxVolume) {
    // Within 3% tolerance: warning, NOT error
    issues.push({
      code: 'VOLUME_TOLERANCE_WARNING',
      severity: 'WARNING',
      message: `Загрузка по объему ${Math.round((totalVolume / maxVolume) * 100)}% (в пределах допустимого отклонения 3%)`,
      detail: `Факт: ${Math.round(totalVolume * 10) / 10} м³, Базовый лимит: ${Math.round(maxVolume * 10) / 10} м³`
    });
  }

  // Max stops check
  if (limits.maxCustomers > 0 && storeNames.size > limits.maxCustomers) {
    issues.push({
      code: 'MAX_STOPS_EXCEEDED',
      severity: 'WARNING',
      message: `Превышен лимит магазинов (${storeNames.size} из ${limits.maxCustomers})`
    });
  }

  // 3. Coordinate validation
  let coordinatesOk = true;
  for (const o of routeOrders) {
    const coordCheck = validateCoordinates(o);
    if (!coordCheck.isValid) {
      coordinatesOk = false;
      issues.push({
        code: 'INVALID_COORDINATES',
        severity: 'ERROR',
        message: `Некорректные координаты заказа "${o.orderNumber}" (${o.customerName})`,
        detail: coordCheck.reason,
        orderId: o.id
      });
    }
  }

  // 4. Duplicate order assignments across routes
  // Note: One store can have multiple orders in different routes (ALLOWED).
  // But the same ORDER ID in multiple routes is an ERROR!
  let ordersUniqueOk = true;
  if (orderOccurrenceMap) {
    for (const orderId of route.orderIds) {
      const assignedIn = orderOccurrenceMap.get(orderId) || [];
      if (assignedIn.length > 1) {
        ordersUniqueOk = false;
        const o = orderMap.get(orderId);
        issues.push({
          code: 'DUPLICATE_ORDER',
          severity: 'ERROR',
          message: `Дубликат: заказ "${o?.orderNumber || orderId}" назначен в ${assignedIn.length} маршрута(ов)`,
          detail: `В маршрутах: ${assignedIn.join(', ')}`,
          orderId
        });
      }
    }
  }

  // 5. Vehicle compatibility check (rank and truck type requirements)
  let vehicleOk = true;
  if (assignedTruck && limits.truckTypes) {
    for (const o of routeOrders) {
      if (o.allowedTruckType) {
        const allowedTruck = limits.truckTypes.find(t => t.id === o.allowedTruckType);
        if (allowedTruck && assignedTruck.rank > allowedTruck.rank) {
          vehicleOk = false;
          issues.push({
            code: 'VEHICLE_INCOMPATIBLE',
            severity: 'ERROR',
            message: `Несовместимый транспорт для заказа "${o.orderNumber}"`,
            detail: `Требуется авто ранга ≤ ${allowedTruck.name}, назначен: ${assignedTruck.name}`,
            orderId: o.id
          });
        }
      }
    }
  }

  // 6. Dates consistency
  let datesConsistent = true;
  const distinctDates = Array.from(new Set(routeOrders.map(o => o.shippingDate).filter(Boolean)));
  if (distinctDates.length > 1 && limits.allowCombineDates === false) {
    datesConsistent = false;
    issues.push({
      code: 'MULTIPLE_SHIPPING_DATES',
      severity: 'WARNING',
      message: `В маршруте объединены разные даты доставки (${distinctDates.length})`,
      detail: distinctDates.join(', ')
    });
  }

  // 7. Road distance vs straight distance check
  const distInfo = getRouteDistanceInfo(route, routeOrders);
  let roadDistanceOk = true;
  if (distInfo.isFallback || !distInfo.hasRoadData) {
    roadDistanceOk = false;
    issues.push({
      code: 'STRAIGHT_DISTANCE_FALLBACK',
      severity: 'WARNING',
      message: 'Реальное дорожное расстояние недоступно',
      detail: `Используется расчетное расстояние по прямой: ${distInfo.straightDistanceKm} км`
    });
  }

  const errorCount = issues.filter(i => i.severity === 'ERROR').length;
  const warningCount = issues.filter(i => i.severity === 'WARNING').length;

  const status = errorCount > 0 ? 'ERROR' : warningCount > 0 ? 'WARNING' : 'VALID';

  return {
    routeId: route.id,
    routeName: route.name,
    status,
    issues,
    errorCount,
    warningCount,
    checks: {
      weightOk,
      volumeOk,
      coordinatesOk,
      ordersUniqueOk,
      vehicleOk,
      roadDistanceOk,
      datesConsistent
    },
    metrics: {
      totalWeight,
      maxWeight,
      weightPercent: maxWeight > 0 ? Math.round((totalWeight / maxWeight) * 100) : 0,
      totalVolume,
      maxVolume,
      volumePercent: maxVolume > 0 ? Math.round((totalVolume / maxVolume) * 100) : 0,
      orderCount: routeOrders.length,
      storeCount: storeNames.size,
      straightDistanceKm: distInfo.straightDistanceKm,
      roadDistanceKm: distInfo.roadDistanceKm,
      roadDurationMin: distInfo.roadDurationMin,
      routingSource: distInfo.routingSource,
      truckTypeName: assignedTruck?.name
    }
  };
}

/**
 * Comprehensive Plan Validator that checks all routes, order distribution completeness,
 * duplicate assignments, and system constraints.
 */
export function validateRoutePlan(
  routes: Route[],
  orders: Order[],
  limits: RoutingLimits
): PlanValidationResult {
  const globalIssues: RouteValidationIssue[] = [];

  // Map each orderId to all route names it is assigned to
  const orderOccurrenceMap = new Map<string, string[]>();
  (routes || []).forEach(route => {
    (route.orderIds || []).forEach(orderId => {
      const existing = orderOccurrenceMap.get(orderId) || [];
      existing.push(route.name);
      orderOccurrenceMap.set(orderId, existing);
    });
  });

  // Calculate duplicate orders count
  let duplicateOrdersCount = 0;
  orderOccurrenceMap.forEach((routeNames, orderId) => {
    if (routeNames.length > 1) {
      duplicateOrdersCount++;
    }
  });

  if (duplicateOrdersCount > 0) {
    globalIssues.push({
      code: 'GLOBAL_DUPLICATES',
      severity: 'ERROR',
      message: `Обнаружено ${duplicateOrdersCount} заказов, назначенных в несколько маршрутов одновременно!`
    });
  }

  // Calculate unassigned orders count
  const allAssignedIds = new Set(Array.from(orderOccurrenceMap.keys()));
  const unassignedOrders = orders.filter(o => !allAssignedIds.has(o.id));
  const unassignedCount = unassignedOrders.length;

  if (unassignedCount > 0) {
    globalIssues.push({
      code: 'UNASSIGNED_ORDERS',
      severity: 'INFO',
      message: `${unassignedCount} заказов не распределены по маршрутам`,
      detail: `Всего заказов: ${orders.length}, распределено: ${allAssignedIds.size}`
    });
  }

  // Validate each route individually
  const routeResults = routes.map(route => 
    validateSingleRoute(route, orders, limits, orderOccurrenceMap)
  );

  const errorRoutesCount = routeResults.filter(r => r.status === 'ERROR').length;
  const warningRoutesCount = routeResults.filter(r => r.status === 'WARNING').length;
  const validRoutesCount = routeResults.filter(r => r.status === 'VALID').length;
  const fallbackRoutesCount = routeResults.filter(r => !r.checks.roadDistanceOk).length;

  const hasErrors = errorRoutesCount > 0 || globalIssues.some(i => i.severity === 'ERROR');
  const hasWarnings = warningRoutesCount > 0 || globalIssues.some(i => i.severity === 'WARNING');

  const status: 'VALID' | 'WARNING' | 'ERROR' = hasErrors ? 'ERROR' : hasWarnings ? 'WARNING' : 'VALID';

  return {
    status,
    totalRoutes: routes.length,
    validRoutesCount,
    warningRoutesCount,
    errorRoutesCount,
    totalOrders: orders.length,
    assignedOrdersCount: allAssignedIds.size,
    unassignedOrdersCount: unassignedCount,
    duplicateOrdersCount,
    unknownOrdersCount: 0,
    fallbackRoutesCount,
    routeResults,
    globalIssues,
    hasErrors,
    hasWarnings
  };
}
