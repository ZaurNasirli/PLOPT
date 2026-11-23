import React, { useMemo } from 'react';
import { 
  Eye, 
  EyeOff, 
  Wand2, 
  Info, 
  Trash2, 
  Navigation, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  Clock,
  Lock,
  Unlock,
  Star
} from 'lucide-react';
import { Route, Order } from '../../types';
import { RoutingLimits } from '../../services/routingService';
import { cn } from '../../lib/utils';
import { Button } from '../common/UIComponents';
import { getRouteDistanceInfo, formatDurationMinutes, calculateRouteLegs } from '../../services/distanceHelper';
import { validateSingleRoute } from '../../services/routeValidator';
import { useTranslation } from '../../i18n/I18nContext';

interface RouteCardProps {
  route: Route;
  orders: Order[];
  onDelete: () => void;
  onToggleVisibility: () => void;
  onShowDetails: () => void;
  onHover: (id: string | null) => void;
  onClick?: () => void;
  onOptimize: () => void;
  onOpenValidator?: () => void;
  onToggleLock?: () => void;
  isHovered: boolean;
  isSelected?: boolean;
  limits: RoutingLimits;
}

export const RouteCard: React.FC<RouteCardProps> = ({ 
  route, 
  orders, 
  onDelete, 
  onToggleVisibility, 
  onShowDetails, 
  onHover, 
  onClick, 
  onOptimize,
  onOpenValidator,
  onToggleLock,
  isHovered, 
  isSelected, 
  limits 
}) => {
  const { t } = useTranslation();
  const isLocked = limits.lockedRoutes?.includes(route.id) ?? false;
  const stats = useMemo(() => {
    return {
      weight: orders.reduce((sum, o) => sum + o.weight, 0),
      volume: orders.reduce((sum, o) => sum + o.volume, 0),
      satir: orders.reduce((sum, o) => sum + o.satir, 0),
      customers: new Set(orders.map(o => o.customerName)).size
    };
  }, [orders]);

  const deliveryDates = useMemo(() => {
    return Array.from(new Set(orders.map(o => o.shippingDate).filter(Boolean))) as string[];
  }, [orders]);

  // Distance information with strict straight vs road separation
  const distInfo = useMemo(() => {
    return getRouteDistanceInfo(route, orders);
  }, [route, orders]);

  // Round-trip leg breakdown (Warehouse -> Stores -> Warehouse)
  const legs = useMemo(() => {
    return calculateRouteLegs(route, orders);
  }, [route, orders]);

  // Route validation evaluation
  const validation = useMemo(() => {
    return validateSingleRoute(route, orders, limits);
  }, [route, orders, limits]);

  const assignedTruck = route.truckTypeId 
    ? limits.truckTypes?.find(t => t.id === route.truckTypeId) 
    : undefined;

  const maxWeight = assignedTruck?.maxWeight || limits.maxWeight || 0;
  const maxVolume = assignedTruck?.maxVolume || limits.maxVolume || 0;

  const weightPercent = maxWeight > 0 ? (stats.weight / maxWeight) * 100 : 0;
  const volumePercent = maxVolume > 0 ? (stats.volume / maxVolume) * 100 : 0;

  const routeCost = useMemo(() => {
    if (!limits.costModel?.enabled) return null;
    const fuelRate = limits.costModel.fuelCostPerKm ?? 0.45;
    const driverRate = limits.costModel.driverCostPerHour ?? 8.0;
    const vehicleFixed = limits.costModel.vehicleFixedCost ?? 35.0;
    const toll = limits.costModel.tollCostPerRoute ?? 0.0;
    const distKm = distInfo.roadDistanceKm ?? distInfo.straightDistanceKm ?? 0;
    const durHours = (distInfo.roadDurationMin ?? 180) / 60;
    return Math.round(distKm * fuelRate + durHours * driverRate + vehicleFixed + toll);
  }, [limits.costModel, distInfo]);

  const qualityScore = useMemo(() => {
    const detourRatio = distInfo.roadDistanceKm && distInfo.straightDistanceKm > 0
      ? distInfo.roadDistanceKm / distInfo.straightDistanceKm
      : 1.25;
    const geography = Math.round(Math.max(50, Math.min(100, 100 - (detourRatio - 1.1) * 45)));
    const volume = Math.round(volumePercent >= 80 ? Math.min(100, volumePercent + 6) : Math.max(35, volumePercent));
    const distance = Math.round(Math.max(55, Math.min(100, 95 - (detourRatio - 1.15) * 35)));
    const duration = Math.round((distInfo.roadDurationMin ?? 180) <= 480 ? 93 : 75);
    const timeWindows = validation.status === 'VALID' ? 100 : validation.status === 'WARNING' ? 80 : 50;
    const balance = orders.length >= 6 && orders.length <= 28 ? 92 : 84;
    return Math.round(
      volume * 0.25 +
      geography * 0.20 +
      distance * 0.20 +
      duration * 0.15 +
      timeWindows * 0.10 +
      balance * 0.10
    );
  }, [distInfo, volumePercent, validation.status, orders.length]);

  return (
    <div 
      className={cn(
        "p-2 transition-all duration-200 cursor-pointer border rounded-xl relative flex flex-col gap-1.5",
        !route.isVisible 
          ? "bg-slate-100/60 dark:bg-slate-900/40 border-slate-300/60 dark:border-slate-800 text-slate-400 opacity-60" 
          : !distInfo.isRealRoad 
            ? "bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800" 
            : "bg-card border-slate-200 dark:border-slate-800 text-card-foreground shadow-sm hover:shadow-md",
        isHovered ? "ring-2 ring-primary shadow-md scale-[1.005]" : "",
        isSelected ? "ring-2 ring-primary bg-primary/5" : ""
      )}
      onClick={onClick}
      onMouseEnter={() => onHover(route.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 truncate">
          <div 
            className="w-2.5 h-2.5 rounded-full shrink-0 transition-colors" 
            style={{ backgroundColor: route.isVisible ? route.color : '#94a3b8' }} 
          />
          <span className="font-bold text-xs truncate max-w-[110px]">{route.name}</span>
          
          {deliveryDates.length > 0 && (
            <span 
              className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[8px] font-bold bg-primary/10 text-primary border border-primary/20 shrink-0" 
              title={`${t('filterShippingDates')}: ${deliveryDates.join(', ')}`}
            >
              📅 {deliveryDates.length === 1 ? deliveryDates[0] : `${deliveryDates.length} ${t('shippingDatesCount')}`}
            </span>
          )}

          {route.routingSource === 'AI_GEMINI' && (
            <span
              className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[8px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 shrink-0"
              title="Маршрут сформирован нейросетью Gemini 3.8 Flash"
            >
              🤖 AI
            </span>
          )}

          {/* Road / Straight Distance Status Badge */}
          {distInfo.isRealRoad && distInfo.roadDistanceKm !== undefined ? (
            <span 
              className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[8px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0"
              title={`${t('statusOsrmActive')}: ${distInfo.roadDistanceKm} ${t('unitKm')} ${distInfo.roadDurationMin ? `(~${formatDurationMinutes(distInfo.roadDurationMin)})` : ''}. ${t('statusFallback')}: ${distInfo.straightDistanceKm} ${t('unitKm')}`}
            >
              <Navigation size={8} /> OSRM
            </span>
          ) : (
            <span 
              className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[8px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shrink-0"
              title={distInfo.warning || t('statusFallback')}
            >
              <AlertTriangle size={8} /> {t('straightBadge')}
            </span>
          )}

          {/* Unified Validation Status Indicator */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onOpenValidator) onOpenValidator();
            }}
            className={cn(
              "inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[8px] font-bold border transition-colors shrink-0",
              validation.status === 'VALID' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20",
              validation.status === 'WARNING' && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20",
              validation.status === 'ERROR' && "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20"
            )}
            title={validation.issues.length > 0 
              ? validation.issues.map(i => `${i.severity}: ${i.message}`).join('\n') 
              : t('planValidationOk')}
          >
            {validation.status === 'VALID' && <CheckCircle2 size={8} />}
            {validation.status === 'WARNING' && <AlertTriangle size={8} />}
            {validation.status === 'ERROR' && <XCircle size={8} />}
            <span>{validation.status === 'VALID' ? 'OK' : validation.status === 'WARNING' ? t('planValidationWarnShort') : t('planValidationErrShort')}</span>
          </button>

          {/* Route Quality Score Badge (Requirement 12) */}
          <span 
            className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[8px] font-bold bg-primary/10 text-primary border border-primary/20 shrink-0"
            title={`Route Quality Score: ${qualityScore}/100`}
          >
            <Star size={8} className="fill-primary" /> {qualityScore}
          </span>

          {/* Cost Model Badge if enabled (Requirement 13) */}
          {routeCost !== null && (
            <span 
              className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[8px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0"
              title={`Расчетные затраты: ${routeCost} AZN`}
            >
              {routeCost} AZN
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {onToggleLock && (
            <Button 
              variant="ghost" 
              size="icon" 
              className={cn("h-6 w-6 rounded-md cursor-pointer", isLocked && "text-amber-500 hover:text-amber-600 bg-amber-500/10")} 
              title={isLocked ? "Маршрут зафиксирован (Locked Route)" : "Зафиксировать маршрут"}
              onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
            >
              {isLocked ? <Lock size={12} /> : <Unlock size={12} className="opacity-60" />}
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            className={cn("h-6 w-6 rounded-md cursor-pointer", !route.isVisible && "text-rose-500 hover:text-rose-600")} 
            title={route.isVisible ? t('btnHideRouteLines') : t('btnShowRouteLines')}
            onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
          >
            {route.isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md cursor-pointer" title={t('btnOptimizeRoute')} onClick={(e) => { e.stopPropagation(); onOptimize(); }}>
            <Wand2 size={12} />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md cursor-pointer" title={t('btnDetails')} onClick={(e) => { e.stopPropagation(); onShowDetails(); }}>
            <Info size={12} />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md text-destructive hover:text-destructive cursor-pointer" title={t('btnDelete')} onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {/* Metrics Row: Clear distinction between Road and Straight distance */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium bg-muted/40 px-2 py-0.5 rounded-md">
        <span><b>{stats.customers}</b> {t('unitPointsShort')} • <b>{orders.length}</b> {t('unitOrdersShort')}</span>
        <span><b>{Math.ceil(stats.volume)}</b> {t('unitM3')} • <b>{Math.ceil(stats.weight)}</b> {t('unitKg')}</span>
        
        {distInfo.isRealRoad && distInfo.roadDistanceKm !== undefined ? (
          <span className="font-bold text-foreground" title={`Полный круг (Склад → Магазины → Склад): ${legs.totalRoundTripKm} км (Выезд: ${legs.fromWarehouseKm} км, По точкам: ${legs.betweenStoresKm} км, Возврат: ${legs.toWarehouseKm} км)`}>
            🔄 {legs.totalRoundTripKm} {t('unitKm')}
            {distInfo.roadDurationMin && (
              <span className="text-[9px] font-normal text-muted-foreground ml-1">
                ({formatDurationMinutes(distInfo.roadDurationMin)})
              </span>
            )}
          </span>
        ) : (
          <span className="font-bold text-amber-600 dark:text-amber-400" title={`Полный круг по прямой (Склад → Магазины → Склад): ${legs.totalRoundTripKm} км`}>
            🔄 {legs.totalRoundTripKm} {t('unitKm')} ({t('straightBadge')})
          </span>
        )}
      </div>

      {/* Round-Trip Breakdown Row: Warehouse -> Stores -> Warehouse */}
      {orders.length > 0 && (
        <div className="flex items-center justify-between text-[9px] text-muted-foreground bg-primary/5 border border-primary/15 px-2 py-0.5 rounded-md">
          <span title="Дистанция от склада до 1-го магазина">
            🏭 Склад → 1-й: <b className="text-foreground">{legs.fromWarehouseKm} {t('unitKm')}</b>
          </span>
          <span title="Дистанция между магазинами маршрута">
            🏪 По точкам: <b className="text-foreground">{legs.betweenStoresKm} {t('unitKm')}</b>
          </span>
          <span title="Обратный путь от последнего магазина на склад">
            ↩ На склад: <b className="text-primary">{legs.toWarehouseKm} {t('unitKm')}</b>
          </span>
        </div>
      )}

      {/* Volume (Primary load factor) & Weight Progress Bars */}
      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <div className="space-y-0.5">
          <div className="flex justify-between text-[8px] text-muted-foreground">
            <span className="font-semibold text-foreground">Объём (осн.)</span>
            <span className={cn(
              "font-bold", 
              volumePercent >= 80 ? "text-emerald-600 dark:text-emerald-400" : volumePercent > 100 ? "text-destructive" : "text-foreground"
            )}>
              {Math.round(volumePercent)}%
            </span>
          </div>
          <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
            <div 
              className={cn("h-full transition-all duration-300", volumePercent > 100 ? "bg-destructive" : volumePercent >= 80 ? "bg-emerald-500" : "bg-primary")}
              style={{ width: `${Math.min(100, volumePercent)}%` }}
            />
          </div>
        </div>
        <div className="space-y-0.5">
          <div className="flex justify-between text-[8px] text-muted-foreground">
            <span>Вес (лимит)</span>
            <span className={cn("font-medium", weightPercent > 100 && "text-destructive font-bold")}>
              {Math.round(weightPercent)}%
            </span>
          </div>
          <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
            <div 
              className={cn("h-full transition-all duration-300", weightPercent > 100 ? "bg-destructive" : "bg-slate-400 dark:bg-slate-500")}
              style={{ width: `${Math.min(100, weightPercent)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
