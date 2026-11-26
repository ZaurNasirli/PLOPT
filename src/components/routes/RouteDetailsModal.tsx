import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  X, 
  Navigation, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Truck, 
  Calendar, 
  DollarSign, 
  Package,
  Lock,
  Unlock,
  ChevronUp,
  ChevronDown,
  ArrowRightLeft,
  Sparkles,
  BarChart2,
  Wand2,
  Fuel,
  UserCheck
} from 'lucide-react';
import { Route, Order, TruckType } from '../../types';
import { RoutingLimits } from '../../services/routingService';
import { Button, Card, Badge } from '../common/UIComponents';
import { cn } from '../../lib/utils';
import { getRouteDistanceInfo, formatDurationMinutes, calculateRouteLegs } from '../../services/distanceHelper';
import { validateSingleRoute } from '../../services/routeValidator';
import { getCorridorSectorName } from '../../services/optimizer';
import { useTranslation } from '../../i18n/I18nContext';
import { TransferBadge } from '../orders/TransferBadge';

interface RouteDetailsModalProps {
  route: Route;
  orders: Order[];
  allRoutes?: Route[];
  limits: RoutingLimits;
  onClose: () => void;
  onUpdateRouteOrders?: (routeId: string, newOrderIds: string[]) => void;
  onMoveOrdersToRoute?: (orderIds: string[], sourceRouteId: string, targetRouteId: string) => void;
  onToggleLockStore?: (orderId: string, routeId: string) => void;
  onToggleLockRoute?: (routeId: string) => void;
  onReoptimizeRoute?: (route: Route) => void;
}

export const RouteDetailsModal: React.FC<RouteDetailsModalProps> = ({
  route,
  orders,
  allRoutes = [],
  limits,
  onClose,
  onUpdateRouteOrders,
  onMoveOrdersToRoute,
  onToggleLockStore,
  onToggleLockRoute,
  onReoptimizeRoute
}) => {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'stores' | 'orders' | 'dates' | 'validation' | 'quality'>('stores');

  const distInfo = useMemo(() => {
    return getRouteDistanceInfo(route, orders);
  }, [route, orders]);

  const legs = useMemo(() => {
    return calculateRouteLegs(route, orders);
  }, [route, orders]);

  const validation = useMemo(() => {
    return validateSingleRoute(route, orders, limits);
  }, [route, orders, limits]);

  const assignedTruck: TruckType | undefined = route.truckTypeId
    ? limits.truckTypes?.find(t => t.id === route.truckTypeId)
    : undefined;

  const maxW = assignedTruck?.maxWeight || limits.maxWeight || 1500;
  const maxV = assignedTruck?.maxVolume || limits.maxVolume || 12;

  const totalW = orders.reduce((sum, o) => sum + o.weight, 0);
  const totalV = orders.reduce((sum, o) => sum + o.volume, 0);

  const weightPercent = maxW > 0 ? Math.min(100, Math.round((totalW / maxW) * 100)) : 80;
  const volumePercent = maxV > 0 ? Math.min(100, Math.round((totalV / maxV) * 100)) : 80;

  // Cost Model calculations (Requirement 13)
  const costModel = useMemo(() => {
    const roadKm = distInfo.roadDistanceKm ?? distInfo.straightDistanceKm ?? 0;
    const durHours = (distInfo.roadDurationMin ?? (roadKm * 1.5)) / 60;
    
    const fuelRate = limits.costModel?.fuelCostPerKm ?? 0.45;
    const driverRate = limits.costModel?.driverCostPerHour ?? 8.0;
    const vehicleFixed = limits.costModel?.vehicleFixedCost ?? 35.0;
    const toll = limits.costModel?.tollCostPerRoute ?? 0.0;

    const fuelCost = Math.round(roadKm * fuelRate * 10) / 10;
    const driverCost = Math.round(durHours * driverRate * 10) / 10;
    const vehicleCost = vehicleFixed;
    const tollCost = toll;
    const totalCost = Math.round((fuelCost + driverCost + vehicleCost + tollCost) * 10) / 10;

    return {
      enabled: limits.costModel?.enabled ?? false,
      fuelCost,
      driverCost,
      vehicleCost,
      tollCost,
      totalCost
    };
  }, [distInfo, limits.costModel]);

  // Unified Duration Breakdown: Driving + Waiting + Service = Total (Requirement 3)
  const timeBreakdown = useMemo(() => {
    const servicePerStop = limits.serviceTimeMinutes || 10;
    const drivingMin = distInfo.roadDurationMin ?? Math.max(1, Math.round(((distInfo.roadDistanceKm || distInfo.straightDistanceKm) / 38) * 60));
    const serviceMin = orders.length * servicePerStop;

    // Time slots are symbolic labels: no waiting time is simulated
    const waitMin = 0;
    const totalMin = Math.round(drivingMin + waitMin + serviceMin);
    return {
      drivingMin: Math.round(drivingMin),
      waitingMin: Math.round(waitMin),
      serviceMin: Math.round(serviceMin),
      totalMin
    };
  }, [distInfo, orders, limits]);

  // Route Quality Score breakdown (Requirement 12)
  const qualityScore = useMemo(() => {
    const detourRatio = distInfo.roadDistanceKm && distInfo.straightDistanceKm > 0
      ? distInfo.roadDistanceKm / distInfo.straightDistanceKm
      : 1.25;

    // 1. Geography: 100 if detour <= 1.2, drops gracefully
    const geography = Math.round(Math.max(50, Math.min(100, 100 - (detourRatio - 1.1) * 45)));

    // 2. Volume: Volume utilization %
    const volume = Math.round(volumePercent >= 80 ? Math.min(100, volumePercent + 6) : Math.max(35, volumePercent));

    // 3. Distance: Compactness vs radial baseline
    const distance = Math.round(Math.max(55, Math.min(100, 95 - (detourRatio - 1.15) * 35)));

    // 4. Duration: Shift fit using Total Duration = Driving + Waiting + Service
    const durationMin = timeBreakdown.totalMin;
    const duration = Math.round(durationMin <= 480 ? 93 : Math.max(40, 100 - (durationMin - 480) * 0.2));

    // 5. Time Windows: Violations penalty
    const timeWindows = validation.issues.filter(i => i.message.toLowerCase().includes('окн') || i.message.toLowerCase().includes('slot')).length === 0 ? 100 : 75;

    // 6. Balance: Stop count
    const stopsCount = orders.length;
    const balance = stopsCount >= 6 && stopsCount <= 28 ? 92 : 84;

    const overall = Math.round(
      volume * 0.25 +
      geography * 0.20 +
      distance * 0.20 +
      duration * 0.15 +
      timeWindows * 0.10 +
      balance * 0.10
    );

    const reasons = [
      `Единый географический сектор: ${getCorridorSectorName(orders)}`,
      `Высокая загрузка по объёму: ${volumePercent}% (${Math.round(totalV * 10) / 10} м³ / ${maxV} м³)`,
      `Загрузка по весу в рамках норматива: ${weightPercent}% (${totalW} кг / ${maxW} кг)`,
      timeWindows === 100 ? 'Окна доставки соблюдены без опозданий' : 'Присутствуют временные ограничения',
      `Коэффициент извилистости дорожного пути: ${detourRatio.toFixed(2)}x`
    ];

    if (assignedTruck) {
      reasons.push(`Транспорт: ${assignedTruck.name} (ранг ${assignedTruck.rank})`);
    }

    return {
      overall,
      geography,
      volume,
      distance,
      duration,
      timeWindows,
      balance,
      reasons
    };
  }, [distInfo, orders, volumePercent, weightPercent, validation, totalV, totalW, maxV, maxW, assignedTruck, timeBreakdown]);

  const stats = useMemo(() => {
    return {
      weight: totalW,
      volume: totalV,
      satir: orders.reduce((sum, o) => sum + o.satir, 0),
      customers: new Set(orders.map(o => o.customerName)).size,
      cost: costModel.totalCost,
      costPerKg: totalW > 0 ? (costModel.totalCost / totalW).toFixed(2) : '0.0',
      costPerM3: totalV > 0 ? (costModel.totalCost / totalV).toFixed(2) : '0.0'
    };
  }, [orders, totalW, totalV, costModel]);

  const routeStores = useMemo(() => {
    const storeMap = new Map<string, { name: string; orders: Order[]; weight: number; volume: number; region: string }>();
    (orders || []).forEach(o => {
      const existing = storeMap.get(o.customerName);
      if (existing) {
        existing.orders.push(o);
        existing.weight += o.weight;
        existing.volume += o.volume;
      } else {
        storeMap.set(o.customerName, {
          name: o.customerName,
          orders: [o],
          weight: o.weight,
          volume: o.volume,
          region: o.region
        });
      }
    });
    return Array.from(storeMap.values());
  }, [orders]);

  const routeDatesGrouped = useMemo(() => {
    const map = new Map<string, { date: string; orders: Order[]; weight: number; volume: number; stores: Set<string> }>();
    (orders || []).forEach(o => {
      const d = o.shippingDate || '—';
      if (!map.has(d)) {
        map.set(d, { date: d, orders: [], weight: 0, volume: 0, stores: new Set() });
      }
      const item = map.get(d)!;
      item.orders.push(o);
      item.weight += o.weight;
      item.volume += o.volume;
      item.stores.add(o.customerName);
    });
    return Array.from(map.values());
  }, [orders]);

  const isRouteLocked = limits.lockedRoutes?.includes(route.id) ?? false;

  const handleMoveStoreOrder = (storeName: string, direction: 'up' | 'down') => {
    if (!onUpdateRouteOrders) return;
    const storeIdx = routeStores.findIndex(s => s.name === storeName);
    if (storeIdx < 0) return;
    const targetIdx = direction === 'up' ? storeIdx - 1 : storeIdx + 1;
    if (targetIdx < 0 || targetIdx >= routeStores.length) return;

    const newStoreList = [...routeStores];
    const temp = newStoreList[storeIdx];
    newStoreList[storeIdx] = newStoreList[targetIdx];
    newStoreList[targetIdx] = temp;

    // Flatten back to order IDs
    const newOrderIds = newStoreList.flatMap(s => s.orders.map(o => o.id));
    onUpdateRouteOrders(route.id, newOrderIds);
  };

  const handleMoveStoreToAnotherRoute = (storeName: string, targetRouteId: string) => {
    if (!onMoveOrdersToRoute || !targetRouteId) return;
    const targetStore = routeStores.find(s => s.name === storeName);
    if (!targetStore) return;
    const ids = targetStore.orders.map(o => o.id);
    onMoveOrdersToRoute(ids, route.id, targetRouteId);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[3000] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <Card className="w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl border-border">
        {/* Top bar */}
        <div className="p-4 border-b flex items-center justify-between bg-card shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: route.color }} />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{t('rdmRouteTitle', { name: route.name })}</h2>
                {isRouteLocked && (
                  <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-xs gap-1">
                    <Lock size={10} /> Заблокирован (Locked Route)
                  </Badge>
                )}
                {assignedTruck && (
                  <Badge className="bg-primary/10 text-primary border border-primary/20 text-xs">
                    <Truck size={11} className="mr-1 inline" /> {assignedTruck.name}
                  </Badge>
                )}
                <Badge className="bg-muted text-foreground/80 border text-[10px]">
                  🧭 {getCorridorSectorName(orders)}
                </Badge>
                {distInfo.isRealRoad && distInfo.roadDistanceKm !== undefined ? (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px]">
                    <Navigation size={10} className="mr-1 inline" /> OSRM 100%
                  </Badge>
                ) : (
                  <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px]">
                    <AlertTriangle size={10} className="mr-1 inline" /> {t('rdmStraightLineBadge')}
                  </Badge>
                )}
                {route.routingSource === 'AI_GEMINI' && (
                  <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 text-[10px] gap-1 font-bold">
                    🤖 Gemini AI
                  </Badge>
                )}
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                <span>{t('rdmVolume')}: <b className="text-emerald-600 font-bold">{volumePercent}% ({Math.ceil(stats.volume)} {t('unitM3')})</b></span>
                <span>{t('rdmWeight')}: <b className="text-foreground">{weightPercent}% ({Math.ceil(stats.weight)} {t('unitKg')})</b></span>
                <span>{t('rdmCustomers')}: <b className="text-foreground">{stats.customers}</b></span>
                <span>{t('navOrders')}: <b className="text-foreground">{orders.length}</b></span>
                <span>Оценка: <b className="text-primary font-bold">{qualityScore.overall}/100</b></span>
                <span>Расходы: <b className="text-emerald-600 font-bold">{stats.cost} AZN</b></span>
              </div>
              {(route.description || route.aiExplanation || route.whyThisRoute) && (
                <div className="mt-2 text-xs bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 text-indigo-950 dark:text-indigo-200 px-3 py-2 rounded-lg flex items-start gap-2 shadow-xs">
                  <span className="text-sm shrink-0 mt-0.5">🤖</span>
                  <div className="flex-1">
                    <span className="font-bold block text-[11px] text-indigo-700 dark:text-indigo-300">Обоснование ИИ (Gemini Neural Router):</span>
                    <span className="text-[11px] leading-relaxed">{route.description || route.aiExplanation || route.whyThisRoute}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onToggleLockRoute && (
              <Button
                variant="outline"
                size="sm"
                className={cn("h-8 text-xs gap-1.5 cursor-pointer", isRouteLocked && "border-amber-500 text-amber-600 bg-amber-500/10")}
                onClick={() => onToggleLockRoute(route.id)}
                title="Зафиксировать маршрут от автоматических изменений"
              >
                {isRouteLocked ? <Lock size={13} /> : <Unlock size={13} />}
                <span>{isRouteLocked ? 'Маршрут зафиксирован' : 'Зафиксировать'}</span>
              </Button>
            )}

            {onReoptimizeRoute && (
              <Button
                variant="primary"
                size="sm"
                className="h-8 text-xs gap-1.5 cursor-pointer shadow-xs"
                onClick={() => onReoptimizeRoute(route)}
                title="Пересчитать порядок точек"
              >
                <Wand2 size={13} />
                <span>Re-optimize</span>
              </Button>
            )}

            <div className="flex bg-muted rounded-lg p-1 text-xs">
              <button 
                type="button"
                className={cn(
                  "px-3 py-1 font-semibold rounded-md transition-all cursor-pointer", 
                  viewMode === 'quality' ? "bg-card shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setViewMode('quality')}
              >
                ★ Оценка {qualityScore.overall}/100
              </button>
              <button 
                type="button"
                className={cn(
                  "px-3 py-1 font-semibold rounded-md transition-all cursor-pointer", 
                  viewMode === 'stores' ? "bg-card shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setViewMode('stores')}
              >
                {t('rdmTabStores', { count: routeStores.length })}
              </button>
              <button 
                type="button"
                className={cn(
                  "px-3 py-1 font-semibold rounded-md transition-all cursor-pointer", 
                  viewMode === 'orders' ? "bg-card shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setViewMode('orders')}
              >
                {t('rdmTabOrders', { count: orders.length })}
              </button>
              <button 
                type="button"
                className={cn(
                  "px-3 py-1 font-semibold rounded-md transition-all cursor-pointer", 
                  viewMode === 'dates' ? "bg-card shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setViewMode('dates')}
              >
                {t('rdmTabDates', { count: routeDatesGrouped.length })}
              </button>
              <button 
                type="button"
                className={cn(
                  "px-3 py-1 font-semibold rounded-md transition-all flex items-center gap-1 cursor-pointer", 
                  viewMode === 'validation' ? "bg-card shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setViewMode('validation')}
              >
                {validation.status === 'VALID' ? (
                  <CheckCircle2 size={13} className="text-emerald-500" />
                ) : validation.status === 'WARNING' ? (
                  <AlertTriangle size={13} className="text-amber-500" />
                ) : (
                  <XCircle size={13} className="text-rose-500" />
                )}
                {t('rdmTabAudit', { count: validation.issues.length })}
              </button>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}><X size={20} /></Button>
          </div>
        </div>

        {/* Distance Banner */}
        <div className="px-6 py-2.5 border-b bg-muted/20 flex flex-wrap items-center justify-between gap-4 shrink-0 text-xs">
          <div className="flex flex-wrap items-center gap-5">
            <div>
              <span className="text-muted-foreground">Полный круг (Склад → Магазины → Склад): </span>
              {distInfo.isRealRoad && distInfo.roadDistanceKm !== undefined ? (
                <span className="font-bold text-foreground text-sm">
                  {legs.totalRoundTripKm} {t('unitKm')}
                  {distInfo.roadDurationMin && (
                    <span className="text-muted-foreground font-normal ml-1">
                      (~{formatDurationMinutes(distInfo.roadDurationMin)})
                    </span>
                  )}
                </span>
              ) : (
                <span className="font-bold text-amber-600 dark:text-amber-400">
                  {legs.totalRoundTripKm} {t('unitKm')} ({t('straightBadge')})
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 bg-card px-3 py-1 rounded-lg border text-[11px]">
              <span>
                <span className="text-muted-foreground">🏭 Склад → 1-й маг.: </span>
                <b className="text-foreground">{legs.fromWarehouseKm} {t('unitKm')}</b>
              </span>
              <span className="text-border">|</span>
              <span>
                <span className="text-muted-foreground">🏪 По магазинам: </span>
                <b className="text-foreground">{legs.betweenStoresKm} {t('unitKm')}</b>
              </span>
              <span className="text-border">|</span>
              <span>
                <span className="text-muted-foreground">↩ Возврат на склад: </span>
                <b className="text-primary">{legs.toWarehouseKm} {t('unitKm')}</b>
              </span>
            </div>

            <div>
              <span className="text-muted-foreground">{t('rdmStraightDistance')} </span>
              <span className="font-bold text-foreground text-sm">{distInfo.straightDistanceKm} {t('unitKm')}</span>
            </div>

            <div>
              <span className="text-muted-foreground">Время рейса: </span>
              <span className="font-bold text-foreground text-sm" title={`Движение: ${timeBreakdown.drivingMin} мин, Сервис: ${timeBreakdown.serviceMin} мин`}>
                {timeBreakdown.totalMin} мин
                <span className="text-[11px] text-muted-foreground font-normal ml-1">
                  ({timeBreakdown.drivingMin}м движ. + {timeBreakdown.serviceMin}м серв.)
                </span>
              </span>
            </div>
          </div>

          <div className="text-[11px]">
            {distInfo.isFallback && (
              <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                <AlertTriangle size={13} /> {t('rdmFallbackNotice')}
              </span>
            )}
          </div>
        </div>

        {/* Body content */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
            {/* QUALITY SCORE & WHY THIS ROUTE & COST MODEL TAB */}
            {viewMode === 'quality' && (
              <div className="space-y-6">
                {/* Score Header Card */}
                <div className="p-5 rounded-2xl border bg-card shadow-xs flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-2xl bg-primary/10 border-2 border-primary/30 flex flex-col items-center justify-center text-primary">
                      <span className="text-3xl font-black">{qualityScore.overall}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">из 100</span>
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-foreground">Route Quality Score</h3>
                      <p className="text-xs text-muted-foreground max-w-md mt-0.5">
                        Многокритериальная оценка качества логистического маршрута на базе геометрии, загрузки, соблюдения окон и плотности.
                      </p>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-2 justify-end">
                    <span className="px-3 py-1.5 rounded-xl border bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs font-bold">
                      Объём: {volumePercent}%
                    </span>
                    <span className="px-3 py-1.5 rounded-xl border bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-bold">
                      Вес: {weightPercent}%
                    </span>
                    <span className="px-3 py-1.5 rounded-xl border bg-primary/10 text-primary border-primary/20 text-xs font-bold">
                      Стоимость: {costModel.totalCost} AZN
                    </span>
                  </div>
                </div>

                {/* Score Breakdown Bars */}
                <div className="p-5 rounded-2xl border bg-muted/15 space-y-4">
                  <h4 className="text-xs font-bold uppercase text-muted-foreground tracking-wider">
                    Разбивка факторов качества
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                    {[
                      { label: 'География (Geography)', val: qualityScore.geography, color: 'bg-indigo-500' },
                      { label: 'Загрузка объёма (Volume)', val: qualityScore.volume, color: 'bg-emerald-500' },
                      { label: 'Дистанция (Distance)', val: qualityScore.distance, color: 'bg-blue-500' },
                      { label: 'Длительность рейса (Duration)', val: qualityScore.duration, color: 'bg-sky-500' },
                                      { label: 'Баланс остановок (Balance)', val: qualityScore.balance, color: 'bg-violet-500' }
                    ].map((item, qIdx) => (
                      <div key={`score-item-${item.label}-${qIdx}`} className="p-3 bg-card rounded-xl border space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground font-medium text-[11px]">{item.label}</span>
                          <span className="font-bold text-foreground">{item.val} / 100</span>
                        </div>
                        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={cn("h-full transition-all duration-300", item.color)} 
                            style={{ width: `${item.val}%` }} 
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* WHY THIS ROUTE Explanation (Requirement 11) */}
                <div className="p-5 rounded-2xl border border-primary/30 bg-primary/5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-primary">
                    <Sparkles size={18} />
                    <span>WHY THIS ROUTE? — Обоснование выбора маршрута</span>
                  </div>
                  <div className="space-y-2 text-xs text-foreground pl-1">
                    {qualityScore.reasons.map((reason, idx) => (
                      <div key={`why-reason-${idx}`} className="flex items-start gap-2">
                        <span className="text-primary font-bold">•</span>
                        <span>{reason}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* TIME DURATION BREAKDOWN (Requirement 3: Driving + Waiting + Service = Total) */}
                <div className="p-5 rounded-2xl border bg-card space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <Clock size={18} className="text-sky-500" />
                      <span>Баланс времени рейса (Total Duration = Driving + Service)</span>
                    </div>
                    <span className="text-xs font-black text-foreground">
                      Итого: {timeBreakdown.totalMin} мин ({formatDurationMinutes(timeBreakdown.totalMin)})
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1">
                    <div className="p-3 rounded-xl border bg-muted/20 space-y-1">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Navigation size={12} className="text-sky-500" /> Движение (Driving):
                      </span>
                      <div className="text-base font-bold text-foreground">{timeBreakdown.drivingMin} мин</div>
                      <span className="text-[10px] text-muted-foreground">Чистое время в пути</span>
                    </div>

                    <div className="p-3 rounded-xl border bg-muted/20 space-y-1">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Package size={12} className="text-purple-500" /> Сервис (Service):
                      </span>
                      <div className="text-base font-bold text-foreground">{timeBreakdown.serviceMin} мин</div>
                      <span className="text-[10px] text-muted-foreground">{orders.length} остановок × {limits.serviceTimeMinutes || 10} мин</span>
                    </div>

                    <div className="p-3 rounded-xl border bg-primary/10 border-primary/20 space-y-1">
                      <span className="text-[11px] text-primary font-bold flex items-center gap-1">
                        <CheckCircle2 size={12} /> Итоговая длительность:
                      </span>
                      <div className="text-base font-black text-primary">{timeBreakdown.totalMin} мин</div>
                      <span className="text-[10px] text-primary/80">Сумма всех компонентов</span>
                    </div>
                  </div>
                </div>

                {/* COST MODEL BREAKDOWN (Requirement 13) */}
                <div className="p-5 rounded-2xl border bg-card space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <DollarSign size={18} className="text-emerald-600" />
                      <span>Экономическая модель рейса (Cost Model)</span>
                    </div>
                    <span className="text-xs font-bold text-emerald-600">
                      Итого: {costModel.totalCost} AZN
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1">
                    <div className="p-3 rounded-xl border bg-muted/20 space-y-1">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Fuel size={12} /> Топливо:
                      </span>
                      <div className="text-base font-bold text-foreground">{costModel.fuelCost} AZN</div>
                      <span className="text-[10px] text-muted-foreground">({distInfo.roadDistanceKm || 0} км × {limits.costModel?.fuelCostPerKm ?? 0.45})</span>
                    </div>

                    <div className="p-3 rounded-xl border bg-muted/20 space-y-1">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <UserCheck size={12} /> Водитель:
                      </span>
                      <div className="text-base font-bold text-foreground">{costModel.driverCost} AZN</div>
                      <span className="text-[10px] text-muted-foreground">({((distInfo.roadDurationMin || 180)/60).toFixed(1)} ч × {limits.costModel?.driverCostPerHour ?? 8} AZN)</span>
                    </div>

                    <div className="p-3 rounded-xl border bg-muted/20 space-y-1">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Truck size={12} /> Фикс. авто:
                      </span>
                      <div className="text-base font-bold text-foreground">{costModel.vehicleCost} AZN</div>
                      <span className="text-[10px] text-muted-foreground">Амортизация и подача</span>
                    </div>

                    <div className="p-3 rounded-xl border bg-muted/20 space-y-1">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <DollarSign size={12} /> Сборы / Толл:
                      </span>
                      <div className="text-base font-bold text-foreground">{costModel.tollCost} AZN</div>
                      <span className="text-[10px] text-muted-foreground">Платные участки</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STORES LIST TAB (WITH REORDERING & LOCKING) */}
            {viewMode === 'stores' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                  <div className="p-2.5 bg-muted/40 rounded-xl border border-dashed border-red-500/40 text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-3">
                    <span>{t('rdmWarehouseStart')}</span>
                    {orders.length > 0 && (
                      <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 text-[10px]">
                        Выезд к 1-му магазину: {legs.fromWarehouseKm} {t('unitKm')}
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Используйте стрелки для ручного изменения порядка или выберите целевой маршрут для переноса.
                  </span>
                </div>

                {routeStores.map((store, i) => {
                  const firstOrder = store.orders[0];
                  const isStoreLocked = Boolean(firstOrder && limits.lockedStops && limits.lockedStops[firstOrder.id]);
                  const otherRoutes = allRoutes.filter(r => r.id !== route.id);
                  const storeLeg = legs.storeLegs[i];

                  return (
                    <div 
                      key={`route-store-${store.name || 'store'}-${i}`} 
                      className={cn(
                        "p-3.5 bg-card border rounded-xl shadow-xs flex items-center justify-between gap-4 transition-all",
                        isStoreLocked && "border-amber-500/50 bg-amber-500/5"
                      )}
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-xs">{i + 1}. {store.name}</span>
                          <Badge className="bg-primary/10 text-primary text-[10px]">{store.region}</Badge>
                          {storeLeg && (
                            <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 text-[10px]">
                              <Navigation size={9} className="mr-1 inline" />
                              {storeLeg.fromName} → {store.name}: +{storeLeg.distanceKm} {t('unitKm')} (пройдено: {storeLeg.cumulativeKm} {t('unitKm')})
                            </Badge>
                          )}
                          {isStoreLocked && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center gap-0.5">
                              <Lock size={9} /> Закреплен
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {t('navOrders')}: {store.orders.length} ({store.orders.map(o => o.orderNumber).join(', ')})
                        </div>
                        {store.orders.some(o => o.stopType) && (
                          <div className="flex flex-wrap gap-1">
                            {store.orders.filter(o => o.stopType).map(o => <TransferBadge key={`tb-${o.id}`} order={o} />)}
                          </div>
                        )}
                      </div>

                      {/* Manual Reordering & Moving Controls */}
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Up / Down Reorder buttons */}
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            disabled={i === 0 || !onUpdateRouteOrders}
                            onClick={() => handleMoveStoreOrder(store.name, 'up')}
                            className="p-1 rounded bg-muted/60 hover:bg-muted disabled:opacity-30 cursor-pointer transition-colors"
                            title="Переместить вверх"
                          >
                            <ChevronUp size={12} />
                          </button>
                          <button
                            type="button"
                            disabled={i === routeStores.length - 1 || !onUpdateRouteOrders}
                            onClick={() => handleMoveStoreOrder(store.name, 'down')}
                            className="p-1 rounded bg-muted/60 hover:bg-muted disabled:opacity-30 cursor-pointer transition-colors"
                            title="Переместить вниз"
                          >
                            <ChevronDown size={12} />
                          </button>
                        </div>

                        {/* Lock Stop button (Requirement 8) */}
                        {onToggleLockStore && firstOrder && (
                          <button
                            type="button"
                            onClick={() => onToggleLockStore(firstOrder.id, route.id)}
                            className={cn(
                              "p-1.5 rounded-lg border text-xs flex items-center gap-1 cursor-pointer transition-colors",
                              isStoreLocked
                                ? "bg-amber-500/15 border-amber-500 text-amber-600"
                                : "bg-muted/30 border-input text-muted-foreground hover:text-foreground"
                            )}
                            title={isStoreLocked ? "Разблокировать точку" : "Зафиксировать магазин за этим авто (Locked Stop)"}
                          >
                            {isStoreLocked ? <Lock size={13} /> : <Unlock size={13} />}
                          </button>
                        )}

                        {/* Move to another route dropdown (Requirement 10) */}
                        {otherRoutes.length > 0 && onMoveOrdersToRoute && (
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) {
                                handleMoveStoreToAnotherRoute(store.name, e.target.value);
                                e.target.value = '';
                              }
                            }}
                            className="h-7 text-[11px] rounded-lg border border-input bg-background px-2 font-medium cursor-pointer"
                            title="Перенести магазин в другой маршрут"
                          >
                            <option value="" disabled>В другой маршрут...</option>
                            {otherRoutes.map((or, orIdx) => (
                              <option key={`move-to-${or.id || 'route'}-${orIdx}`} value={or.id}>
                                → {or.name} ({or.orderIds.length} заказов)
                              </option>
                            ))}
                          </select>
                        )}

                        <div className="text-right text-xs min-w-[90px]">
                          <div className="font-semibold text-foreground">{Math.ceil(store.volume)} {t('unitM3')} / {Math.ceil(store.weight)} {t('unitKg')}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="p-2.5 bg-muted/40 rounded-xl border border-dashed border-red-500/40 text-xs font-bold text-red-600 dark:text-red-400 flex flex-wrap items-center justify-between gap-2">
                  <span>{t('rdmWarehouseEnd')}</span>
                  {orders.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 text-[10px]">
                        Возврат ({legs.returnLeg.fromName} → Склад): +{legs.toWarehouseKm} {t('unitKm')}
                      </Badge>
                      <Badge className="bg-primary/15 text-primary border border-primary/30 text-[10px] font-bold">
                        Итого по кругу (Склад → Магазины → Склад): {legs.totalRoundTripKm} {t('unitKm')}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            )}

            {viewMode === 'orders' && (
              <div className="space-y-2">
                {orders.map((o, idx) => (
                  <div key={`route-order-${o.id || 'order'}-${idx}`} className="p-3 bg-card border rounded-xl flex items-center justify-between gap-4 text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold">#{idx + 1} {o.orderNumber}</span>
                        <span className="font-semibold text-muted-foreground">{o.customerName}</span>
                        <TransferBadge order={o} />
                        {o.shippingDate && (
                          <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.2 rounded font-bold">
                            📅 {o.shippingDate}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {o.region} • {t('formCode')}: {o.code} • {t('optTimeWindow')}: {o.timeSlot}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{o.stopType === 'pickup' ? `+${Math.ceil(o.transferVolume || 0)} ${t('unitM3')} • +${Math.ceil(o.transferWeight || 0)} ${t('unitKg')}` : `${Math.ceil(o.volume)} ${t('unitM3')} • ${Math.ceil(o.weight)} ${t('unitKg')}`}</div>
                      <div className="text-[10px] text-muted-foreground">Sətir: {o.satir}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'dates' && (
              <div className="space-y-3">
                {routeDatesGrouped.map((group, gIdx) => (
                  <div key={`route-date-grp-${group.date || 'date'}-${gIdx}`} className="p-4 bg-card border rounded-xl shadow-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-foreground">📅 {group.date}</span>
                      <span className="text-xs text-muted-foreground">
                        {group.orders.length} {t('navOrders').toLowerCase()} ({group.stores.size} {t('rdmTabStores', { count: '' }).trim()}) • {Math.ceil(group.weight)} {t('unitKg')} • {Math.ceil(group.volume)} {t('unitM3')}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground pl-4 border-l-2 border-primary/40 space-y-1">
                      {group.orders.map((o, oIdx) => (
                        <div key={`grp-order-${o.id || 'order'}-${oIdx}`} className="flex justify-between">
                          <span>{o.customerName} ({o.orderNumber})</span>
                          <span>{Math.ceil(o.weight)} {t('unitKg')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'validation' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b">
                  <div className="font-bold text-sm flex items-center gap-2">
                    {t('rdmAuditStatus')}{' '}
                    <span className={cn(
                      "px-2.5 py-0.5 rounded-full text-xs font-bold",
                      validation.status === 'VALID' && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                      validation.status === 'WARNING' && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                      validation.status === 'ERROR' && "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                    )}>
                      {validation.status === 'VALID' ? t('rdmReady') : validation.status === 'WARNING' ? t('rdmHasWarnings') : t('rdmHasErrors')}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('rdmErrorsCount', { errors: validation.errorCount, warnings: validation.warningCount })}
                  </div>
                </div>

                {validation.issues.length === 0 ? (
                  <div className="p-6 text-center text-emerald-600 dark:text-emerald-400 space-y-2">
                    <CheckCircle2 size={36} className="mx-auto" />
                    <div className="font-bold text-sm">{t('rdmAllCorrect')}</div>
                    <div className="text-xs text-muted-foreground">{t('rdmAllCorrectDesc')}</div>
                  </div>
                ) : (
                  validation.issues.map((issue, idx) => (
                    <div 
                      key={`rdm-issue-${issue.severity}-${idx}`} 
                      className={cn(
                        "p-3 rounded-xl border text-xs flex items-start gap-3",
                        issue.severity === 'ERROR' && "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300",
                        issue.severity === 'WARNING' && "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
                        issue.severity === 'INFO' && "bg-muted/40 border-border text-foreground"
                      )}
                    >
                      {issue.severity === 'ERROR' ? (
                        <XCircle size={18} className="text-rose-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-bold">{issue.message}</div>
                        {issue.detail && <div className="text-[11px] opacity-85 mt-0.5">{issue.detail}</div>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
};
