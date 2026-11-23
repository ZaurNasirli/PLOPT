import React from 'react';
import { 
  BarChart2, TrendingUp, AlertTriangle, MapPin, Maximize2, 
  Info, MousePointer2, FileSpreadsheet, Trash2, Layers
} from 'lucide-react';
import { Button } from '../common/UIComponents';
import { Route, Order } from '../../types';
import { RoutingLimits, calculateDistance } from '../../services/routingService';
import { useTranslation } from '../../i18n/I18nContext';
import { WeeklyOrdersTrendWidget } from './WeeklyOrdersTrendWidget';

interface AnalyticsPanelProps {
  routes: Route[];
  orders: Order[];
  routingLimits: RoutingLimits;
  selectedRouteId?: string | null;
  onHoverRoute?: (id: string | null) => void;
  onSelectRouteDetails?: (route: Route) => void;
  onSelectRouteId?: (id: string | null) => void;
  onOpenFullAnalytics: () => void;
  onExportAnalytics: () => void;
  onClearAllRoutes: () => void;
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({
  routes,
  orders,
  routingLimits,
  selectedRouteId,
  onHoverRoute,
  onSelectRouteDetails,
  onSelectRouteId,
  onOpenFullAnalytics,
  onExportAnalytics,
  onClearAllRoutes,
}) => {
  const { t } = useTranslation();

  const roundUp = (num: number, decimals: number = 2) => {
    const factor = Math.pow(10, decimals);
    return (Math.ceil(num * factor) / factor).toFixed(decimals);
  };

  const formatDec1 = (num: number) => num.toFixed(1);

  return (
    <div className="p-4 space-y-4 overflow-y-auto flex-1 scrollbar-thin w-full overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[10px] text-muted-foreground">
          {t('analyticsRoutesCount', { count: routes.length })}
        </h3>
        {routes.length > 0 && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-destructive h-7 px-2 text-[10px] cursor-pointer" 
            onClick={onClearAllRoutes}
          >
            {t('btnClearAllRoutes')}
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 border rounded-lg bg-card">
            <span className="text-[10px] text-muted-foreground uppercase font-bold">{t('analyticsAvgLoadWeight')}</span>
            <div className="text-lg font-bold mt-1 text-primary">
              {routes.length > 0 && routingLimits.maxWeight > 0 ? (
                Math.round((routes.reduce((sum, r) => {
                  const rOrders = orders.filter(o => r.orderIds.includes(o.id));
                  return sum + rOrders.reduce((s, o) => s + o.weight, 0);
                }, 0) / (routes.length * routingLimits.maxWeight)) * 100)
              ) : 0}%
            </div>
          </div>
          <div className="p-3 border rounded-lg bg-card">
            <span className="text-[10px] text-muted-foreground uppercase font-bold">{t('analyticsAvgLoadVolume')}</span>
            <div className="text-lg font-bold mt-1 text-primary">
              {routes.length > 0 && routingLimits.maxVolume > 0 ? (
                Math.round((routes.reduce((sum, r) => {
                  const rOrders = orders.filter(o => r.orderIds.includes(o.id));
                  return sum + rOrders.reduce((s, o) => s + o.volume, 0);
                }, 0) / (routes.length * routingLimits.maxVolume)) * 100)
              ) : 0}%
            </div>
          </div>
        </div>

        {/* Weekly Orders Trend Line Chart (Recharts) */}
        <WeeklyOrdersTrendWidget orders={orders} />

        {/* Vehicle utilization bars */}
        <div className="space-y-2 pt-2 border-t">
          <h4 className="text-[10px] font-bold uppercase text-muted-foreground">{t('analyticsVehicleLoad')}</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {routes.map((r, rIdx) => {
              const rOrders = orders.filter(o => r.orderIds.includes(o.id));
              const weight = rOrders.reduce((s, o) => s + o.weight, 0);
              const percent = Math.min(100, Math.round((weight / (routingLimits.maxWeight || 1)) * 100));
              return (
                <div key={`analytics-load-${r.id || 'route'}-${rIdx}`} className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="font-medium truncate max-w-[170px]">{r.name}</span>
                    <span className="text-muted-foreground">{percent}% ({roundUp(weight)} {t('unitKg')})</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-300" 
                      style={{ width: `${percent}%` }} 
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detailed breakdown / recommendations */}
        <div className="space-y-2 pt-4 border-t">
          <h4 className="text-[10px] font-bold uppercase text-muted-foreground">{t('analyticsDetailedBreakdown')}</h4>
          <div className="space-y-2">
            <details className="group border rounded-lg overflow-hidden bg-card/30">
              <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-card/50 transition-colors list-none">
                <div className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-bold">{t('analyticsMultiRegionRoutes')}</span>
                </div>
                <span className="text-xs text-muted-foreground">▼</span>
              </summary>
              <div className="p-2 space-y-1 border-t bg-card/10">
                <div className="px-2 py-1 mb-1 bg-primary/5 rounded text-[9px] text-primary italic">
                  {t('analyticsMultiRegionRec')}
                </div>
                {routes.filter(r => new Set(orders.filter(o => r.orderIds.includes(o.id)).map(o => o.region)).size >= 2).length === 0 ? (
                  <div className="text-[10px] text-center py-2 text-muted-foreground italic">{t('analyticsNoMultiRegion')}</div>
                ) : (
                  routes.filter(r => new Set(orders.filter(o => r.orderIds.includes(o.id)).map(o => o.region)).size >= 2).map((r, rIdx) => (
                    <div 
                      key={`analytics-multireg-${r.id || 'r'}-${rIdx}`} 
                      className="flex items-center justify-between p-2 rounded hover:bg-primary/10 cursor-pointer transition-colors"
                      onMouseEnter={() => onHoverRoute?.(r.id)}
                      onMouseLeave={() => onHoverRoute?.(null)}
                      onClick={() => onSelectRouteDetails?.(r)}
                    >
                      <span className="text-[10px] font-medium">{r.name}</span>
                      <span className="text-[10px] text-muted-foreground">{t('analyticsRegCount', { count: new Set(orders.filter(o => r.orderIds.includes(o.id)).map(o => o.region)).size })}</span>
                    </div>
                  ))
                )}
              </div>
            </details>

            <details className="group border rounded-lg overflow-hidden bg-card/30">
              <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-card/50 transition-colors list-none">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-orange-500" />
                  <span className="text-xs font-bold">{t('analyticsLongDistances')}</span>
                </div>
                <span className="text-xs text-muted-foreground">▼</span>
              </summary>
              <div className="p-2 space-y-1 border-t bg-card/10">
                <div className="px-2 py-1 mb-1 bg-orange-500/5 rounded text-[9px] text-orange-600 italic">
                  {t('analyticsLongDistanceRec')}
                </div>
                {routes.filter(r => r.distance > 50).length === 0 ? (
                  <div className="text-[10px] text-center py-2 text-muted-foreground italic">{t('analyticsAllDistancesNormal')}</div>
                ) : (
                  routes.filter(r => r.distance > 50).sort((a, b) => b.distance - a.distance).map((r, rIdx) => (
                    <div 
                      key={`analytics-longdist-${r.id || 'r'}-${rIdx}`} 
                      className="flex items-center justify-between p-2 rounded hover:bg-primary/10 cursor-pointer transition-colors"
                      onMouseEnter={() => onHoverRoute?.(r.id)}
                      onMouseLeave={() => onHoverRoute?.(null)}
                      onClick={() => onSelectRouteDetails?.(r)}
                    >
                      <span className="text-[10px] font-medium">{r.name}</span>
                      <span className="text-[10px] text-orange-500 font-bold">{formatDec1(r.distance)} {t('unitKm')}</span>
                    </div>
                  ))
                )}
              </div>
            </details>

            <details className="group border rounded-lg overflow-hidden bg-card/30">
              <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-card/50 transition-colors list-none">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                  <span className="text-xs font-bold">{t('analyticsLowLoad')}</span>
                </div>
                <span className="text-xs text-muted-foreground">▼</span>
              </summary>
              <div className="p-2 space-y-1 border-t bg-card/10">
                <div className="px-2 py-1 mb-1 bg-destructive/5 rounded text-[9px] text-destructive italic">
                  {t('analyticsLowLoadRec')}
                </div>
                {routes.filter(r => {
                  const rOrders = orders.filter(o => r.orderIds.includes(o.id));
                  const weight = rOrders.reduce((s, o) => s + o.weight, 0);
                  const volume = rOrders.reduce((s, o) => s + o.volume, 0);
                  const weightUtil = routingLimits.maxWeight > 0 ? (weight / routingLimits.maxWeight) : 0;
                  const volumeUtil = routingLimits.maxVolume > 0 ? (volume / routingLimits.maxVolume) : 0;
                  return weightUtil < 0.5 && volumeUtil < 0.5;
                }).length === 0 ? (
                  <div className="text-[10px] text-center py-2 text-muted-foreground italic">{t('analyticsAllVehiclesLoaded')}</div>
                ) : (
                  routes.filter(r => {
                    const rOrders = orders.filter(o => r.orderIds.includes(o.id));
                    const weight = rOrders.reduce((s, o) => s + o.weight, 0);
                    const volume = rOrders.reduce((s, o) => s + o.volume, 0);
                    const weightUtil = routingLimits.maxWeight > 0 ? (weight / routingLimits.maxWeight) : 0;
                    const volumeUtil = routingLimits.maxVolume > 0 ? (volume / routingLimits.maxVolume) : 0;
                    return weightUtil < 0.5 && volumeUtil < 0.5;
                  }).map((r, rIdx) => {
                    const rOrders = orders.filter(o => r.orderIds.includes(o.id));
                    const weight = rOrders.reduce((s, o) => s + o.weight, 0);
                    const weightUtil = Math.round((routingLimits.maxWeight > 0 ? (weight / routingLimits.maxWeight) : 0) * 100);
                    return (
                      <div 
                        key={`analytics-lowload-${r.id || 'r'}-${rIdx}`} 
                        className="flex items-center justify-between p-2 rounded hover:bg-primary/10 cursor-pointer transition-colors"
                        onMouseEnter={() => onHoverRoute?.(r.id)}
                        onMouseLeave={() => onHoverRoute?.(null)}
                        onClick={() => onSelectRouteDetails?.(r)}
                      >
                        <span className="text-[10px] font-medium">{r.name}</span>
                        <span className="text-[10px] text-destructive font-bold">{weightUtil}% {t('orderWeight')}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </details>
          </div>
        </div>

        {/* Summary counts */}
        <div className="space-y-2 pt-2 border-t">
          <div className="flex justify-between text-xs p-2 border rounded bg-card">
            <span className="text-muted-foreground">{t('analyticsTotalRoutesCount')}</span>
            <span className="font-bold">{routes.length}</span>
          </div>
          <div className="flex justify-between text-xs p-2 border rounded bg-card">
            <span className="text-muted-foreground">{t('analyticsUniqueStopsCount')}</span>
            <span className="font-bold">
              {new Set(orders.filter(o => o.status === 'in-route').map(o => o.customerName)).size}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="pt-3 flex gap-2">
          <Button 
            variant="outline" 
            className="flex-1 gap-2 text-xs h-9 cursor-pointer"
            onClick={onOpenFullAnalytics}
          >
            <BarChart2 className="w-4 h-4 text-primary" />
            {t('analyticsDetailedBtn')}
          </Button>
          <Button 
            variant="outline" 
            className="gap-2 text-xs h-9 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/20 cursor-pointer"
            onClick={onExportAnalytics}
            title={t('analyticsExportExcelTitle')}
          >
            <FileSpreadsheet className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
