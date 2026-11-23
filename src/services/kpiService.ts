// Expanded KPI & Analytics Service
// Computes comprehensive Operational, Economic, Fleet, Problem Route, and Data Quality metrics.

import { Route, Order } from '../types';
import { RoutingLimits } from './routingService';
import { getEffectiveCapacityLimit, parseTimeSlot } from './optimizer/ConstraintValidator';

export interface RouteDetailKpi {
  id: string;
  name: string;
  color: string;
  orderCount: number;
  customerCount: number;
  weight: number;
  volume: number;
  distanceKm: number;
  durationMinutes: number;
  drivingDurationMin: number;
  waitingDurationMin: number;
  serviceDurationMin: number;
  totalDurationMin: number;
  isRealRoad: boolean;
  truckTypeName: string;
  maxWeight: number;
  maxVolume: number;
  weightLoadPercent: number;
  volumeLoadPercent: number;
  peakLoadPercent: number;
  bottleneck: 'volume' | 'weight';
  cost: number;
  costPerKg: number;
  costPerM3: number;
  costPerKm: number;
  issues: ProblemIssue[];
}

export interface ProblemIssue {
  type: 'overload' | 'critical_load' | 'underload' | 'fallback_distance' | 'missing_coords' | 'long_distance' | 'many_stops';
  severity: 'high' | 'medium' | 'low';
  message: string;
}

export interface ProblemRoute {
  route: Route;
  issues: ProblemIssue[];
  weightPercent: number;
  volumePercent: number;
}

export interface OperationalKpi {
  ordersTotal: number;
  ordersInRoute: number;
  ordersUnassigned: number;
  ordersInRoutePercent: number;

  customersTotal: number;
  customersInRoute: number;

  routesCount: number;
  vehiclesCount: number;

  totalVolumeM3: number;
  totalWeightKg: number;
  totalDistanceKm: number;
  totalDurationMinutes: number;
  totalDrivingMinutes: number;
  totalWaitingMinutes: number;
  totalServiceMinutes: number;

  avgVolumeLoadPercent: number;
  avgWeightLoadPercent: number;
  maxLoadPercent: number;
  minLoadPercent: number;

  overloadedRoutesCount: number;
  criticallyLoadedRoutesCount: number;
  underloadedRoutesCount: number;

  avgStopsPerRoute: number;
  avgVolumePerRoute: number;
  avgWeightPerRoute: number;
  avgDistancePerRoute: number;
  avgDurationPerRoute: number;
}

export interface EconomicKpi {
  totalCost: number;
  costPerRoute: number;
  costPerCustomer: number;
  costPerM3: number;
  costPerKg: number;
  costPerKm: number;
  currency: string;
}

export interface DataQualityKpi {
  totalOrdersChecked: number;
  validCoordsCount: number;
  missingCoordsCount: number;
  coordsQualityPercent: number;

  routesTotal: number;
  roadDistanceRoutesCount: number;
  fallbackDistanceRoutesCount: number;
  roadQualityPercent: number;

  unassignedOrdersCount: number;
  duplicateOrdersCount: number;
  overloadedRoutesCount: number;

  overallScore: number; // 0 to 100
  status: 'excellent' | 'good' | 'warning' | 'critical';
}

export interface FullKpiReport {
  operational: OperationalKpi;
  economic: EconomicKpi;
  dataQuality: DataQualityKpi;
  routeKpis: RouteDetailKpi[];
  problemRoutes: ProblemRoute[];
  timestamp: number;
}

export class KpiService {
  public static calculateReport(
    routes: Route[],
    orders: Order[],
    limits: RoutingLimits
  ): FullKpiReport {
    const ordersMap = new Map(orders.map(o => [o.id, o]));
    const truckTypes = limits.truckTypes || [];

    // Economics settings from limits (defaults if unspecified)
    const baseCostPerKm = limits.costPerKm ?? 2.0;
    const baseCostPerStore = limits.costPerStore ?? 5.0;
    const baseCostPerRoute = limits.costPerRoute ?? 15.0;
    const baseCostPerKg = limits.costPerKg ?? 0.05;
    const currency = '₼';

    // Route-level calculations
    const routeKpis: RouteDetailKpi[] = routes.map(route => {
      const routeOrders = route.orderIds.map(id => ordersMap.get(id)).filter(Boolean) as Order[];
      const weight = Math.round(routeOrders.reduce((sum, o) => sum + (o.weight || 0), 0));
      const volume = Math.round(routeOrders.reduce((sum, o) => sum + (o.volume || 0), 0) * 10) / 10;
      const customerNames = new Set(routeOrders.map(o => o.customerName));
      const customerCount = customerNames.size;

      // Determine truck capacities using unified getEffectiveCapacityLimit
      const effectiveCap = getEffectiveCapacityLimit(routeOrders, limits, route.truckTypeId, true);
      const maxW = effectiveCap.baseMaxWeight;
      const maxV = effectiveCap.baseMaxVolume;
      const truckTypeName = effectiveCap.truckName || `Авто (${maxW} кг / ${maxV} м³)`;

      const weightLoadPercent = maxW > 0 ? Math.round((weight / maxW) * 100) : 0;
      const volumeLoadPercent = maxV > 0 ? Math.round((volume / maxV) * 100) : 0;
      const peakLoadPercent = Math.max(weightLoadPercent, volumeLoadPercent);
      const bottleneck: 'volume' | 'weight' = volumeLoadPercent >= weightLoadPercent ? 'volume' : 'weight';

      // Unified Duration: Driving + Waiting + Service = Total
      const servicePerStop = limits.serviceTimeMinutes ?? 10;
      const drivingDurationMin = route.drivingDurationMin ?? route.roadDurationMin ?? (route.distance ? Math.max(1, Math.round((route.distance / 38) * 60)) : Math.round((customerCount * 6) + (route.distance * 1.5)));
      const serviceDurationMin = route.serviceDurationMin ?? (customerCount * servicePerStop);

      // Compute waiting time if not already stored on route
      let waitingDurationMin = route.waitingDurationMin ?? 0;
      if (route.waitingDurationMin === undefined && routeOrders.length > 0) {
        let currentMin = 8 * 60; // 08:00
        const avgDrive = drivingDurationMin / (customerCount + 1);
        for (const o of routeOrders) {
          currentMin += avgDrive;
          if (o.timeSlot) {
            const slot = parseTimeSlot(o.timeSlot);
            if (currentMin < slot.startMinutes) {
              waitingDurationMin += (slot.startMinutes - currentMin);
              currentMin = slot.startMinutes;
            }
          }
          currentMin += servicePerStop;
        }
        waitingDurationMin = Math.round(waitingDurationMin);
      }

      const totalDurationMin = route.totalDurationMin ?? route.durationMinutes ?? Math.round(drivingDurationMin + waitingDurationMin + serviceDurationMin);
      const durationMinutes = totalDurationMin;

      // Economic Cost for Route
      const routeCost = Math.round(
        baseCostPerRoute + 
        (route.distance * baseCostPerKm) + 
        (customerCount * baseCostPerStore) + 
        (weight * baseCostPerKg)
      );

      const costPerKg = weight > 0 ? Math.round((routeCost / weight) * 100) / 100 : 0;
      const costPerM3 = volume > 0 ? Math.round((routeCost / volume) * 100) / 100 : 0;
      const costPerKm = route.distance > 0 ? Math.round((routeCost / route.distance) * 100) / 100 : 0;

      // Identify problem issues for this route
      const issues: ProblemIssue[] = [];

      if (weightLoadPercent > 100 || volumeLoadPercent > 100) {
        issues.push({
          type: 'overload',
          severity: 'high',
          message: `Перегруз: ${weightLoadPercent > 100 ? `вес ${weightLoadPercent}%` : ''} ${volumeLoadPercent > 100 ? `объем ${volumeLoadPercent}%` : ''}`.trim()
        });
      } else if (weightLoadPercent > 95 || volumeLoadPercent > 95) {
        issues.push({
          type: 'critical_load',
          severity: 'medium',
          message: `Предельная загрузка (максимум ${peakLoadPercent}%)`
        });
      } else if (peakLoadPercent < 40 && routeOrders.length > 0) {
        issues.push({
          type: 'underload',
          severity: 'medium',
          message: `Существенный недогруз (загрузка всего ${peakLoadPercent}%)`
        });
      }

      if (!route.isRealRoad) {
        issues.push({
          type: 'fallback_distance',
          severity: 'medium',
          message: 'Используется расчет по прямой (OSRM fallback), не по дорогам'
        });
      }

      const missingCoordsOrders = routeOrders.filter(o => !o.lat || !o.lng);
      if (missingCoordsOrders.length > 0) {
        issues.push({
          type: 'missing_coords',
          severity: 'high',
          message: `${missingCoordsOrders.length} точек без координат`
        });
      }

      if (route.distance > 150) {
        issues.push({
          type: 'long_distance',
          severity: 'low',
          message: `Большой пробег: ${route.distance} км`
        });
      }

      if (customerCount > 18) {
        issues.push({
          type: 'many_stops',
          severity: 'low',
          message: `Много остановок: ${customerCount} точек`
        });
      }

      return {
        id: route.id,
        name: route.name,
        color: route.color,
        orderCount: routeOrders.length,
        customerCount,
        weight,
        volume,
        distanceKm: route.distance,
        durationMinutes,
        drivingDurationMin,
        waitingDurationMin,
        serviceDurationMin,
        totalDurationMin,
        isRealRoad: Boolean(route.isRealRoad),
        truckTypeName,
        maxWeight: maxW,
        maxVolume: maxV,
        weightLoadPercent,
        volumeLoadPercent,
        peakLoadPercent,
        bottleneck,
        cost: routeCost,
        costPerKg,
        costPerM3,
        costPerKm,
        issues
      };
    });

    // Operational KPI Aggregates
    const ordersTotal = orders.length;
    const ordersInRoute = orders.filter(o => o.status === 'in-route').length;
    const ordersUnassigned = ordersTotal - ordersInRoute;
    const ordersInRoutePercent = ordersTotal > 0 ? Math.round((ordersInRoute / ordersTotal) * 100) : 0;

    const allCustomers = new Set(orders.map(o => o.customerName));
    const inRouteCustomerNames = new Set(
      orders.filter(o => o.status === 'in-route').map(o => o.customerName)
    );

    const routesCount = routes.length;
    const vehiclesCount = routes.length; // 1 truck per active route

    const totalVolumeM3 = Math.round(routeKpis.reduce((sum, r) => sum + r.volume, 0) * 10) / 10;
    const totalWeightKg = Math.round(routeKpis.reduce((sum, r) => sum + r.weight, 0));
    const totalDistanceKm = Math.round(routeKpis.reduce((sum, r) => sum + r.distanceKm, 0) * 10) / 10;
    const totalDurationMinutes = routeKpis.reduce((sum, r) => sum + r.durationMinutes, 0);
    const totalDrivingMinutes = routeKpis.reduce((sum, r) => sum + r.drivingDurationMin, 0);
    const totalWaitingMinutes = routeKpis.reduce((sum, r) => sum + r.waitingDurationMin, 0);
    const totalServiceMinutes = routeKpis.reduce((sum, r) => sum + r.serviceDurationMin, 0);

    const avgVolumeLoadPercent = routesCount > 0
      ? Math.round(routeKpis.reduce((sum, r) => sum + r.volumeLoadPercent, 0) / routesCount)
      : 0;

    const avgWeightLoadPercent = routesCount > 0
      ? Math.round(routeKpis.reduce((sum, r) => sum + r.weightLoadPercent, 0) / routesCount)
      : 0;

    const maxLoadPercent = routeKpis.length > 0
      ? Math.max(...routeKpis.map(r => r.peakLoadPercent))
      : 0;

    const minLoadPercent = routeKpis.length > 0
      ? Math.min(...routeKpis.map(r => r.peakLoadPercent))
      : 0;

    const overloadedRoutesCount = routeKpis.filter(r => r.weightLoadPercent > 100 || r.volumeLoadPercent > 100).length;
    const criticallyLoadedRoutesCount = routeKpis.filter(r => (r.weightLoadPercent > 95 || r.volumeLoadPercent > 95) && r.weightLoadPercent <= 100 && r.volumeLoadPercent <= 100).length;
    const underloadedRoutesCount = routeKpis.filter(r => r.peakLoadPercent < 50 && r.orderCount > 0).length;

    const avgStopsPerRoute = routesCount > 0 ? Math.round((routeKpis.reduce((s, r) => s + r.customerCount, 0) / routesCount) * 10) / 10 : 0;
    const avgVolumePerRoute = routesCount > 0 ? Math.round((totalVolumeM3 / routesCount) * 10) / 10 : 0;
    const avgWeightPerRoute = routesCount > 0 ? Math.round(totalWeightKg / routesCount) : 0;
    const avgDistancePerRoute = routesCount > 0 ? Math.round((totalDistanceKm / routesCount) * 10) / 10 : 0;
    const avgDurationPerRoute = routesCount > 0 ? Math.round(totalDurationMinutes / routesCount) : 0;

    const operational: OperationalKpi = {
      ordersTotal,
      ordersInRoute,
      ordersUnassigned,
      ordersInRoutePercent,
      customersTotal: allCustomers.size,
      customersInRoute: inRouteCustomerNames.size,
      routesCount,
      vehiclesCount,
      totalVolumeM3,
      totalWeightKg,
      totalDistanceKm,
      totalDurationMinutes,
      totalDrivingMinutes,
      totalWaitingMinutes,
      totalServiceMinutes,
      avgVolumeLoadPercent,
      avgWeightLoadPercent,
      maxLoadPercent,
      minLoadPercent,
      overloadedRoutesCount,
      criticallyLoadedRoutesCount,
      underloadedRoutesCount,
      avgStopsPerRoute,
      avgVolumePerRoute,
      avgWeightPerRoute,
      avgDistancePerRoute,
      avgDurationPerRoute
    };

    // Economic KPIs
    const totalCost = routeKpis.reduce((sum, r) => sum + r.cost, 0);
    const costPerRoute = routesCount > 0 ? Math.round(totalCost / routesCount) : 0;
    const costPerCustomer = inRouteCustomerNames.size > 0 ? Math.round((totalCost / inRouteCustomerNames.size) * 10) / 10 : 0;
    const costPerM3 = totalVolumeM3 > 0 ? Math.round((totalCost / totalVolumeM3) * 10) / 10 : 0;
    const costPerKg = totalWeightKg > 0 ? Math.round((totalCost / totalWeightKg) * 100) / 100 : 0;
    const costPerKm = totalDistanceKm > 0 ? Math.round((totalCost / totalDistanceKm) * 10) / 10 : 0;

    const economic: EconomicKpi = {
      totalCost,
      costPerRoute,
      costPerCustomer,
      costPerM3,
      costPerKg,
      costPerKm,
      currency
    };

    // Data Quality Check
    const ordersWithCoords = orders.filter(o => Boolean(o.lat && o.lng && o.lat !== 0 && o.lng !== 0)).length;
    const missingCoordsCount = ordersTotal - ordersWithCoords;
    const coordsQualityPercent = ordersTotal > 0 ? Math.round((ordersWithCoords / ordersTotal) * 100) : 100;

    const roadDistanceRoutesCount = routes.filter(r => r.isRealRoad).length;
    const fallbackDistanceRoutesCount = routesCount - roadDistanceRoutesCount;
    const roadQualityPercent = routesCount > 0 ? Math.round((roadDistanceRoutesCount / routesCount) * 100) : 100;

    // Check duplicate order numbers
    const orderNumCounts = new Map<string, number>();
    let duplicateOrdersCount = 0;
    (orders || []).forEach(o => {
      const key = (o.orderNumber || o.id).trim();
      const count = (orderNumCounts.get(key) || 0) + 1;
      orderNumCounts.set(key, count);
      if (count === 2) duplicateOrdersCount += 2;
      else if (count > 2) duplicateOrdersCount += 1;
    });

    // Score from 0 to 100
    let qualityScore = 100;
    if (missingCoordsCount > 0) qualityScore -= Math.min(30, missingCoordsCount * 5);
    if (fallbackDistanceRoutesCount > 0) qualityScore -= Math.min(25, fallbackDistanceRoutesCount * 8);
    if (overloadedRoutesCount > 0) qualityScore -= Math.min(25, overloadedRoutesCount * 12);
    if (duplicateOrdersCount > 0) qualityScore -= Math.min(15, duplicateOrdersCount * 3);
    if (ordersUnassigned > 0) qualityScore -= Math.min(10, Math.round((ordersUnassigned / ordersTotal) * 10));
    qualityScore = Math.max(10, Math.min(100, qualityScore));

    let qualityStatus: 'excellent' | 'good' | 'warning' | 'critical' = 'excellent';
    if (qualityScore >= 90) qualityStatus = 'excellent';
    else if (qualityScore >= 75) qualityStatus = 'good';
    else if (qualityScore >= 50) qualityStatus = 'warning';
    else qualityStatus = 'critical';

    const dataQuality: DataQualityKpi = {
      totalOrdersChecked: ordersTotal,
      validCoordsCount: ordersWithCoords,
      missingCoordsCount,
      coordsQualityPercent,
      routesTotal: routesCount,
      roadDistanceRoutesCount,
      fallbackDistanceRoutesCount,
      roadQualityPercent,
      unassignedOrdersCount: ordersUnassigned,
      duplicateOrdersCount,
      overloadedRoutesCount,
      overallScore: qualityScore,
      status: qualityStatus
    };

    // Problem Routes list
    const problemRoutes: ProblemRoute[] = routeKpis
      .filter(rk => rk.issues.length > 0)
      .map(rk => {
        const originalRoute = routes.find(r => r.id === rk.id)!;
        return {
          route: originalRoute,
          issues: rk.issues,
          weightPercent: rk.weightLoadPercent,
          volumePercent: rk.volumeLoadPercent
        };
      });

    return {
      operational,
      economic,
      dataQuality,
      routeKpis,
      problemRoutes,
      timestamp: Date.now()
    };
  }
}
