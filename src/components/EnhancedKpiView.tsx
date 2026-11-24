import React, { useState } from 'react';
import { 
  BarChart3, 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  AlertCircle, 
  CheckCircle2, 
  Truck, 
  Layers, 
  Scale, 
  Clock, 
  MapPin, 
  ShieldCheck, 
  Database, 
  Trash2, 
  Eye, 
  ChevronRight,
  Info
} from 'lucide-react';
import { KpiService, FullKpiReport, RouteDetailKpi } from '../services/kpiService';
import { distanceMatrixManager } from '../services/distanceMatrixManager';
import { routingProvider } from '../services/routingProvider';
import { Route, Order } from '../types';
import { RoutingLimits } from '../services/routingService';
import { cn } from '../lib/utils';

interface EnhancedKpiViewProps {
  routes: Route[];
  orders: Order[];
  limits: RoutingLimits;
  onSelectRoute?: (routeId: string) => void;
  onOpenDetailedModal?: () => void;
}

export const EnhancedKpiView: React.FC<EnhancedKpiViewProps> = ({
  routes,
  orders,
  limits,
  onSelectRoute,
  onOpenDetailedModal
}) => {
  const [activeTab, setActiveTab] = useState<'operations' | 'economics' | 'problems' | 'quality'>('operations');
  const [cacheNotification, setCacheNotification] = useState<string | null>(null);

  const report: FullKpiReport = React.useMemo(() => {
    return KpiService.calculateReport(routes, orders, limits);
  }, [routes, orders, limits]);

  const { operational, economic, dataQuality, routeKpis, problemRoutes } = report;

  const handleClearMatrixCache = () => {
    distanceMatrixManager.clearCache();
    routingProvider.clearCache();
    setCacheNotification('Кэш дорожной матрицы и маршрутов очищен.');
    setTimeout(() => setCacheNotification(null), 3000);
  };

  const cacheStats = distanceMatrixManager.getCacheStats();

  return (
    <div className="flex flex-col h-full space-y-3.5 text-card-foreground">
      {/* Tab Navigation Pill Bar */}
      <div className="flex items-center justify-between border-b pb-2 gap-1">
        <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('operations')}
            className={cn(
              "px-2.5 py-1 rounded-md transition-all flex items-center gap-1",
              activeTab === 'operations' ? "bg-card shadow-xs text-primary font-bold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <BarChart3 size={13} />
            <span>Операции</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('economics')}
            className={cn(
              "px-2.5 py-1 rounded-md transition-all flex items-center gap-1",
              activeTab === 'economics' ? "bg-card shadow-xs text-emerald-600 font-bold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <DollarSign size={13} />
            <span>Экономика</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('problems')}
            className={cn(
              "px-2.5 py-1 rounded-md transition-all flex items-center gap-1",
              activeTab === 'problems' ? "bg-card shadow-xs text-amber-600 font-bold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <AlertTriangle size={13} />
            <span>Внимание {problemRoutes.length > 0 && `(${problemRoutes.length})`}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('quality')}
            className={cn(
              "px-2.5 py-1 rounded-md transition-all flex items-center gap-1",
              activeTab === 'quality' ? "bg-card shadow-xs text-sky-600 font-bold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ShieldCheck size={13} />
            <span>Качество ({dataQuality.overallScore}%)</span>
          </button>
        </div>

        {onOpenDetailedModal && (
          <button
            type="button"
            onClick={onOpenDetailedModal}
            className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Развернуть подробную аналитику на весь экран"
          >
            <Layers size={14} />
          </button>
        )}
      </div>

      {cacheNotification && (
        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[11px] border border-emerald-500/20 font-medium">
          {cacheNotification}
        </div>
      )}

      {/* TAB 1: OPERATIONS */}
      {activeTab === 'operations' && (
        <div className="space-y-3.5 overflow-y-auto flex-1 pr-1 scrollbar-thin">
          {/* Main Hero Metrics Grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-xl border bg-card space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                <Truck size={12} className="text-primary" /> Маршруты / Авто
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-foreground">{operational.routesCount}</span>
                <span className="text-xs text-muted-foreground">рейсов</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Авто: <b>{operational.vehiclesCount}</b> • Ср. остановок: <b>{operational.avgStopsPerRoute}</b>
              </div>
            </div>

            <div className="p-3 rounded-xl border bg-card space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                <Layers size={12} className="text-emerald-500" /> Пробег OSRM
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-foreground">{operational.totalDistanceKm}</span>
                <span className="text-xs text-muted-foreground font-semibold">км</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Ср. на рейс: <b>{operational.avgDistancePerRoute} км</b>
              </div>
            </div>

            <div className="p-3 rounded-xl border bg-card space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                <Scale size={12} className="text-sky-500" /> Общий вес
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-foreground">{operational.totalWeightKg}</span>
                <span className="text-xs text-muted-foreground font-semibold">кг</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Ср. загрузка по весу: <b>{operational.avgWeightLoadPercent}%</b>
              </div>
            </div>

            <div className="p-3 rounded-xl border bg-card space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                <Layers size={12} className="text-purple-500" /> Общий объем
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-foreground">{operational.totalVolumeM3}</span>
                <span className="text-xs text-muted-foreground font-semibold">м³</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Ср. загрузка по объему: <b>{operational.avgVolumeLoadPercent}%</b>
              </div>
            </div>
          </div>

          {/* Time Duration Balance Breakdown (Requirement 3: Driving + Waiting + Service) */}
          <div className="p-3 rounded-xl border bg-card space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold flex items-center gap-1.5 text-foreground">
                <Clock size={14} className="text-sky-500" /> Баланс времени рейсов (Всего: {operational.totalDurationMinutes} мин)
              </span>
              <span className="text-[10px] text-muted-foreground font-semibold">
                Ср. на рейс: {operational.avgDurationPerRoute} мин
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="p-2 rounded-lg border bg-muted/20 space-y-0.5">
                <span className="text-muted-foreground block text-[9px]">Движение (Driving):</span>
                <span className="font-bold text-foreground text-xs">{operational.totalDrivingMinutes} мин</span>
              </div>
              <div className="p-2 rounded-lg border bg-muted/20 space-y-0.5">
                <span className="text-muted-foreground block text-[9px]">Сервис (Service):</span>
                <span className="font-bold text-foreground text-xs">{operational.totalServiceMinutes} мин</span>
              </div>
            </div>
          </div>

          {/* Orders & Customers Progress Bar */}
          <div className="p-3 rounded-xl border bg-card space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-emerald-500" /> Распределение заказов
              </span>
              <span className="font-semibold text-muted-foreground">
                {operational.ordersInRoute} из {operational.ordersTotal} ({operational.ordersInRoutePercent}%)
              </span>
            </div>

            <div className="w-full h-2 bg-muted rounded-full overflow-hidden flex">
              <div 
                className="bg-emerald-500 h-full transition-all duration-300" 
                style={{ width: `${operational.ordersInRoutePercent}%` }} 
                title={`В рейсах: ${operational.ordersInRoute}`}
              />
              <div 
                className="bg-amber-500/60 h-full transition-all duration-300" 
                style={{ width: `${100 - operational.ordersInRoutePercent}%` }} 
                title={`Свободно: ${operational.ordersUnassigned}`}
              />
            </div>

            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>В рейсах: <b className="text-emerald-600 font-bold">{operational.ordersInRoute}</b></span>
              <span>Не распределено: <b className="text-amber-600 font-bold">{operational.ordersUnassigned}</b></span>
              <span>Клиентов/Точек: <b className="text-foreground font-bold">{operational.customersTotal}</b></span>
            </div>
          </div>

          {/* Detailed Routes Dual Load List with Bottleneck */}
          <div className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Загрузка по рейсам и лимитирующий фактор
            </h4>

            <div className="space-y-1.5">
              {routeKpis.map((r, rIdx) => (
                <div 
                  key={`kpi-route-${r.id}-${rIdx}`} 
                  className="p-2.5 rounded-xl border bg-card hover:border-primary/50 transition-colors flex flex-col gap-1.5"
                  onClick={() => onSelectRoute?.(r.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 truncate">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                      <span className="font-bold text-xs truncate max-w-[120px]">{r.name}</span>
                      <span className="text-[10px] text-muted-foreground">({r.customerCount} точек)</span>
                    </div>

                    {/* Bottleneck Badge */}
                    <span className={cn(
                      "px-1.5 py-0.2 rounded text-[8px] font-bold border",
                      r.bottleneck === 'volume' 
                        ? "bg-sky-500/10 text-sky-600 border-sky-500/20" 
                        : "bg-purple-500/10 text-purple-600 border-purple-500/20"
                    )}>
                      Лимит: {r.bottleneck === 'volume' ? 'Объём' : 'Вес'}
                    </span>
                  </div>

                  {/* Dual Bars */}
                  <div className="grid grid-cols-2 gap-2 text-[9px]">
                    {/* Weight Bar */}
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Вес ({r.weight}/{r.maxWeight} кг)</span>
                        <span className={cn("font-bold", r.weightLoadPercent > 100 ? "text-rose-600" : "text-foreground")}>
                          {r.weightLoadPercent}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={cn("h-full rounded-full transition-all", r.weightLoadPercent > 100 ? "bg-rose-500" : "bg-primary")}
                          style={{ width: `${Math.min(100, r.weightLoadPercent)}%` }}
                        />
                      </div>
                    </div>

                    {/* Volume Bar */}
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Объем ({r.volume}/{r.maxVolume} м³)</span>
                        <span className={cn("font-bold", r.volumeLoadPercent > 100 ? "text-rose-600" : "text-foreground")}>
                          {r.volumeLoadPercent}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={cn("h-full rounded-full transition-all", r.volumeLoadPercent > 100 ? "bg-rose-500" : "bg-emerald-500")}
                          style={{ width: `${Math.min(100, r.volumeLoadPercent)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ECONOMICS */}
      {activeTab === 'economics' && (
        <div className="space-y-3.5 overflow-y-auto flex-1 pr-1 scrollbar-thin">
          {/* Hero Total Cost */}
          <div className="p-4 rounded-xl border bg-emerald-500/5 border-emerald-500/20 space-y-1">
            <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <DollarSign size={13} /> Общая расчетная стоимость доставки
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{economic.totalCost}</span>
              <span className="text-base font-bold text-emerald-600/80">{economic.currency}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Включает базовую ставку за рейс, километраж по OSRM, стоимость точек доставки и массу груза.
            </p>
          </div>

          {/* Unit Economics Breakdown */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-xl border bg-card space-y-1">
              <span className="text-[10px] font-semibold text-muted-foreground">На 1 маршрут</span>
              <div className="text-xl font-bold text-foreground">{economic.costPerRoute} {economic.currency}</div>
              <span className="text-[9px] text-muted-foreground">В среднем на авто</span>
            </div>

            <div className="p-3 rounded-xl border bg-card space-y-1">
              <span className="text-[10px] font-semibold text-muted-foreground">На 1 точку / магазин</span>
              <div className="text-xl font-bold text-foreground">{economic.costPerCustomer} {economic.currency}</div>
              <span className="text-[9px] text-muted-foreground">Стоимость доставки точки</span>
            </div>

            <div className="p-3 rounded-xl border bg-card space-y-1">
              <span className="text-[10px] font-semibold text-muted-foreground">На 1 м³ объема</span>
              <div className="text-xl font-bold text-foreground">{economic.costPerM3} {economic.currency}</div>
              <span className="text-[9px] text-muted-foreground">Удельная на объем</span>
            </div>

            <div className="p-3 rounded-xl border bg-card space-y-1">
              <span className="text-[10px] font-semibold text-muted-foreground">На 1 км пути</span>
              <div className="text-xl font-bold text-foreground">{economic.costPerKm} {economic.currency}</div>
              <span className="text-[9px] text-muted-foreground">Себестоимость километра</span>
            </div>
          </div>

          {/* Per-Route Economics List */}
          <div className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Себестоимость по маршрутам
            </h4>
            <div className="space-y-1.5">
              {routeKpis.map((r, rIdx) => (
                <div key={`cost-route-${r.id}-${rIdx}`} className="p-2.5 rounded-xl border bg-card flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                    <span className="font-bold truncate max-w-[130px]">{r.name}</span>
                    <span className="text-[10px] text-muted-foreground">({r.distanceKm} км)</span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-black text-emerald-600 dark:text-emerald-400 text-sm">{r.cost} {economic.currency}</span>
                    <div className="text-[9px] text-muted-foreground">{r.costPerKm} ₼/км • {r.costPerM3} ₼/м³</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PROBLEM ROUTES ("ТРЕБУЮТ ВНИМАНИЯ") */}
      {activeTab === 'problems' && (
        <div className="space-y-3.5 overflow-y-auto flex-1 pr-1 scrollbar-thin">
          {problemRoutes.length === 0 ? (
            <div className="p-8 text-center border rounded-xl bg-emerald-500/5 border-emerald-500/20 space-y-2">
              <CheckCircle2 size={32} className="mx-auto text-emerald-500" />
              <h4 className="font-bold text-sm text-emerald-600 dark:text-emerald-400">Проблем не обнаружено</h4>
              <p className="text-xs text-muted-foreground">
                Все маршруты сбалансированы, не перегружены и используют подтвержденные дорожные линии OSRM.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Обнаружено рейсов с замечаниями:</span>
                <span className="font-bold text-amber-600">{problemRoutes.length}</span>
              </div>

              {problemRoutes.map(({ route, issues, weightPercent, volumePercent }, prIdx) => (
                <div 
                  key={`prob-route-${route.id}-${prIdx}`} 
                  className="p-3 rounded-xl border bg-card space-y-2 hover:shadow-xs transition-shadow"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 truncate">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: route.color }} />
                      <span className="font-bold text-xs truncate">{route.name}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectRoute?.(route.id)}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                    >
                      <Eye size={11} /> На карте
                    </button>
                  </div>

                  {/* Issues List */}
                  <div className="space-y-1">
                    {issues.map((issue, idx) => (
                      <div 
                        key={`issue-${issue.type || idx}-${idx}`}
                        className={cn(
                          "px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1.5",
                          issue.severity === 'high' 
                            ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20" 
                            : issue.severity === 'medium'
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20"
                              : "bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20"
                        )}
                      >
                        {issue.severity === 'high' ? <AlertCircle size={11} className="shrink-0" /> : <AlertTriangle size={11} className="shrink-0" />}
                        <span>{issue.message}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between text-[10px] text-muted-foreground pt-1 border-t">
                    <span>Загрузка: вес <b>{weightPercent}%</b> • объем <b>{volumePercent}%</b></span>
                    <span>{route.distance} км</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: DATA QUALITY & CACHE */}
      {activeTab === 'quality' && (
        <div className="space-y-3.5 overflow-y-auto flex-1 pr-1 scrollbar-thin">
          {/* Quality Score Hero */}
          <div className="p-4 rounded-xl border bg-card flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground">Оценка качества данных</span>
              <div className="flex items-baseline gap-2">
                <span className={cn(
                  "text-3xl font-black",
                  dataQuality.overallScore >= 80 ? "text-emerald-600" : dataQuality.overallScore >= 60 ? "text-amber-600" : "text-rose-600"
                )}>
                  {dataQuality.overallScore}%
                </span>
                <span className="text-xs font-bold text-muted-foreground uppercase">
                  {dataQuality.status === 'excellent' ? 'Отлично' : dataQuality.status === 'good' ? 'Хорошо' : 'Требует внимания'}
                </span>
              </div>
            </div>
            <div className="p-3 bg-primary/10 text-primary rounded-2xl">
              <ShieldCheck size={28} />
            </div>
          </div>

          {/* Checklist */}
          <div className="p-3.5 rounded-xl border bg-card space-y-2 text-xs">
            <h4 className="font-bold text-[11px] uppercase tracking-wider text-muted-foreground">
              Диагностика геоданных и маршрутов
            </h4>

            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  {dataQuality.missingCoordsCount === 0 ? <CheckCircle2 size={13} className="text-emerald-500" /> : <AlertCircle size={13} className="text-rose-500" />}
                  Геокоординаты точек ({dataQuality.coordsQualityPercent}%)
                </span>
                <span className="font-semibold text-muted-foreground">
                  {dataQuality.validCoordsCount} из {dataQuality.totalOrdersChecked}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  {dataQuality.fallbackDistanceRoutesCount === 0 ? <CheckCircle2 size={13} className="text-emerald-500" /> : <AlertTriangle size={13} className="text-amber-500" />}
                  Дорожное покрытие OSRM ({dataQuality.roadQualityPercent}%)
                </span>
                <span className="font-semibold text-muted-foreground">
                  {dataQuality.roadDistanceRoutesCount} по дорогам / {dataQuality.fallbackDistanceRoutesCount} прямых
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  {dataQuality.unassignedOrdersCount === 0 ? <CheckCircle2 size={13} className="text-emerald-500" /> : <Info size={13} className="text-sky-500" />}
                  Нераспределенные заказы
                </span>
                <span className="font-semibold text-muted-foreground">
                  {dataQuality.unassignedOrdersCount} заказов
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  {dataQuality.duplicateOrdersCount === 0 ? <CheckCircle2 size={13} className="text-emerald-500" /> : <AlertTriangle size={13} className="text-amber-500" />}
                  Дубликаты номеров заказов
                </span>
                <span className="font-semibold text-muted-foreground">
                  {dataQuality.duplicateOrdersCount}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  {dataQuality.overloadedRoutesCount === 0 ? <CheckCircle2 size={13} className="text-emerald-500" /> : <AlertCircle size={13} className="text-rose-500" />}
                  Перегруз транспорта
                </span>
                <span className="font-semibold text-muted-foreground">
                  {dataQuality.overloadedRoutesCount} маршрутов
                </span>
              </div>
            </div>
          </div>

          {/* Distance Matrix Cache Management */}
          <div className="p-3.5 rounded-xl border bg-card space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold flex items-center gap-1.5">
                <Database size={14} className="text-primary" /> Кэш матрицы расстояний
              </span>
              <span className="text-[10px] text-muted-foreground font-semibold">
                ~{cacheStats.estimatedMemoryKb} КБ
              </span>
            </div>

            <p className="text-[11px] text-muted-foreground leading-normal">
              Матрица расстояний сохраняет результаты вычислений OSRM по координатам. Повторная оптимизация не делает лишних запросов к сети.
            </p>

            <div className="grid grid-cols-2 gap-2 text-[10px] bg-muted/40 p-2 rounded-lg border">
              <div>Сохранено пар: <b className="text-foreground">{cacheStats.totalPairs}</b></div>
              <div>По дорогам OSRM: <b className="text-emerald-600">{cacheStats.roadPairs}</b></div>
            </div>

            <button
              type="button"
              onClick={handleClearMatrixCache}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-input bg-background hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
            >
              <Trash2 size={12} />
              <span>Очистить кэш матрицы расстояний</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
