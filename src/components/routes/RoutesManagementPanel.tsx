import React from 'react';
import { 
  Plus, 
  Wand2, 
  Download, 
  FileSpreadsheet,
  Eye, 
  EyeOff, 
  ShieldCheck, 
  AlertTriangle, 
  AlertOctagon, 
  Navigation, 
  Calendar, 
  Layers, 
  Package, 
  Filter, 
  MousePointer2, 
  Save, 
  Trash2, 
  ChevronRight, 
  ChevronDown,
  Sparkles,
  Lock
} from 'lucide-react';
import { Route, Order, TruckType } from '../../types';
import { RoutingLimits } from '../../services/routingService';
import { RouteSummaryList } from './RouteSummaryList';
import { RouteListFilter, RouteListSort } from './RouteViewParts';
import { RouteInsight } from '../../services/routeInsights';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n/I18nContext';

const roundUp = (val: number | string | undefined | null): string => {
  if (val === undefined || val === null || val === '') return '0.0';
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
  if (isNaN(n)) return '0.0';
  return (Math.round(n * 10) / 10).toFixed(1);
};

const formatDec1 = (val: number | string | undefined | null): string => {
  if (val === undefined || val === null || val === '') return '0.0';
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
  if (isNaN(n)) return '0.0';
  return n.toFixed(1);
};

export interface RoutesManagementPanelProps {
  routes: Route[];
  orders: Order[];
  routingLimits: RoutingLimits;
  selectedOrderIds: string[];
  isOptimizingAll: boolean;
  showAllRouteLines: boolean;
  planValidationResult: {
    status: 'VALID' | 'WARNING' | 'ERROR';
    errorRoutesCount: number;
    warningRoutesCount: number;
  };
  routeGroupingMode?: 'date' | 'type' | 'all';
  dateGroupedRoutes: any[];
  selectedRouteDateFilter: string;
  quickDateFilter: 'all' | 'today' | 'tomorrow' | 'next7' | null;
  selectedShippingDates: string[];
  todayMatchingDates: string[];
  tomorrowMatchingDates: string[];
  next7MatchingDates: string[];
  collapsedDateGroups: Record<string, boolean>;
  hoveredRouteId: string | null;
  selectedRouteId: string | null;
  routeVersions: any[];
  onCreateRoute: () => void;
  onOptimizeAll: () => void;
  onExportRoutesToPdf: () => void;
  onExportRoutesToExcel?: () => void;
  onToggleShowAllRouteLines: () => void;
  onOpenValidationModal: () => void;
  onSetRouteGroupingMode?: (mode: 'date' | 'type' | 'all') => void;
  onSelectRouteDateFilter: (date: string) => void;
  onToggleDateGroupCollapse: (date: string) => void;
  onSetCollapsedDateGroups: (groups: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  onToggleDateRoutesVisibility: (routes: Route[]) => void;
  onSelectOrderIds: (ids: string[]) => void;
  onSetHoveredRouteId: (id: string | null) => void;
  onSetSelectedRouteId: (id: string | null) => void;
  onDeleteRoute: (routeId: string) => void;
  onToggleRouteVisibility: (routeId: string) => void;
  onShowRouteDetails: (route: Route) => void;
  onOptimizeRoute: (route: Route) => void;
  onSaveVersion: (name: string) => void;
  onClearCreatedRoutes: () => void;
  onClearAllRoutes: () => void;
  onExportDateRoutesToPdf: (group: any) => void;
  onToggleLockRoute?: (routeId: string) => void;
  onOpenWhatIf?: () => void;
  onOpenConstraints?: () => void;
  // New route list
  routeListItems: RouteInsight[];
  routeListTotal: number;
  routeListFilter: RouteListFilter;
  routeListSort: RouteListSort;
  onSetRouteListFilter: (f: RouteListFilter) => void;
  onSetRouteListSort: (s: RouteListSort) => void;
  onOpenSummaryTable: () => void;
}

export const RoutesManagementPanel: React.FC<RoutesManagementPanelProps> = ({
  routes,
  orders,
  routingLimits,
  selectedOrderIds,
  isOptimizingAll,
  showAllRouteLines,
  planValidationResult,
  routeGroupingMode,
  dateGroupedRoutes,
  selectedRouteDateFilter,
  quickDateFilter,
  selectedShippingDates,
  todayMatchingDates,
  tomorrowMatchingDates,
  next7MatchingDates,
  collapsedDateGroups,
  hoveredRouteId,
  selectedRouteId,
  routeVersions,
  onCreateRoute,
  onOptimizeAll,
  onExportRoutesToPdf,
  onExportRoutesToExcel,
  onToggleShowAllRouteLines,
  onOpenValidationModal,
  onSetRouteGroupingMode,
  onSelectRouteDateFilter,
  onToggleDateGroupCollapse,
  onSetCollapsedDateGroups,
  onToggleDateRoutesVisibility,
  onSelectOrderIds,
  onSetHoveredRouteId,
  onSetSelectedRouteId,
  onDeleteRoute,
  onToggleRouteVisibility,
  onShowRouteDetails,
  onOptimizeRoute,
  onSaveVersion,
  onClearCreatedRoutes,
  onClearAllRoutes,
  onExportDateRoutesToPdf,
  onToggleLockRoute,
  onOpenWhatIf,
  onOpenConstraints,
  routeListItems,
  routeListTotal,
  routeListFilter,
  routeListSort,
  onSetRouteListFilter,
  onSetRouteListSort,
  onOpenSummaryTable,
}) => {
  const { t } = useTranslation();

  return (
    <div 
      className="flex-1 overflow-y-auto scrollbar-thin space-y-4 pr-1"
      onMouseLeave={() => {
        if (hoveredRouteId) onSetHoveredRouteId(null);
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button 
            type="button"
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer",
              selectedOrderIds.length === 0
                ? "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
            onClick={onCreateRoute} 
            disabled={selectedOrderIds.length === 0}
          >
            <Plus size={16} /> 
            <span>{t('btnCreateRoute')}</span>
          </button>
          <button 
            type="button"
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-semibold shadow-xs transition-colors cursor-pointer",
              isOptimizingAll || routes.length === 0
                ? "bg-muted/40 text-muted-foreground border-border cursor-not-allowed opacity-60"
                : "bg-background hover:bg-accent text-foreground border-input"
            )}
            onClick={onOptimizeAll} 
            disabled={isOptimizingAll || routes.length === 0}
          >
            {isOptimizingAll ? (
              <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <Wand2 size={16} className="text-primary" />
            )}
            <span>{t('btnOptimizeAll')}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button 
            type="button"
            className={cn(
              "w-full flex items-center justify-center gap-1.5 text-xs font-semibold h-8 rounded-lg border transition-colors cursor-pointer",
              routes.length === 0
                ? "bg-muted/40 text-muted-foreground border-border cursor-not-allowed opacity-60"
                : "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
            )}
            onClick={onExportRoutesToExcel}
            disabled={routes.length === 0}
            title="Экспорт маршрутов и точек в Excel (.xlsx)"
          >
            <FileSpreadsheet size={14} className="text-emerald-600 dark:text-emerald-400" />
            <span>Экспорт Excel</span>
          </button>

          <button 
            type="button"
            className={cn(
              "w-full flex items-center justify-center gap-1.5 text-xs font-semibold h-8 rounded-lg border transition-colors cursor-pointer",
              routes.length === 0
                ? "bg-muted/40 text-muted-foreground border-border cursor-not-allowed opacity-60"
                : "bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary"
            )}
            onClick={onExportRoutesToPdf}
            disabled={routes.length === 0}
            title={t('exportPdfDesc')}
          >
            <Download size={14} />
            <span>{t('btnExportPdf')}</span>
          </button>
        </div>

        <button 
          type="button"
          className={cn(
            "w-full flex items-center justify-center gap-1.5 text-xs font-semibold h-8 rounded-lg border transition-colors cursor-pointer",
            !showAllRouteLines 
              ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/20"
              : "bg-background hover:bg-accent text-foreground border-input"
          )}
          onClick={onToggleShowAllRouteLines}
        >
          {showAllRouteLines ? <Eye size={14} className="text-emerald-500" /> : <EyeOff size={14} className="text-rose-500" />}
          <span>{showAllRouteLines ? t('btnHideRouteLines') : t('btnShowRouteLines')}</span>
        </button>

        <button 
          type="button"
          className={cn(
            "w-full flex items-center justify-center gap-1.5 text-xs font-semibold h-8 rounded-lg border transition-colors cursor-pointer",
            planValidationResult.status === 'ERROR' && "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/20",
            planValidationResult.status === 'WARNING' && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20",
            planValidationResult.status === 'VALID' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
          )}
          onClick={onOpenValidationModal}
          title={t('planValidationDesc')}
        >
          {planValidationResult.status === 'VALID' ? (
            <ShieldCheck size={14} className="text-emerald-500" />
          ) : planValidationResult.status === 'WARNING' ? (
            <AlertTriangle size={14} className="text-amber-500" />
          ) : (
            <AlertOctagon size={14} className="text-rose-500" />
          )}
          <span>
            {t('planValidation')}: {planValidationResult.status === 'VALID' ? t('planValidationOk') : `${planValidationResult.errorRoutesCount} ${t('planValidationErrors')}, ${planValidationResult.warningRoutesCount} ${t('planValidationWarnings')}`}
          </span>
        </button>

        {/* What-If & Constraints Quick Actions */}
        <div className="grid grid-cols-2 gap-2">
          {onOpenWhatIf && (
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold cursor-pointer transition-colors shadow-2xs"
              onClick={onOpenWhatIf}
              title="What-If Анализ: Моделирование сценариев (5 vs 6 vs 7 машин)"
            >
              <Sparkles size={13} />
              <span>What-If Анализ</span>
            </button>
          )}
          {onOpenConstraints && (
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-background hover:bg-accent text-foreground text-xs font-semibold cursor-pointer transition-colors shadow-2xs"
              onClick={onOpenConstraints}
              title="Ограничения: Must Stay Together, Avoid Together, Фиксация точек"
            >
              <Lock size={12} className="text-amber-500" />
              <span>Связки / Lock</span>
            </button>
          )}
        </div>
      </div>

      {routes.length > 0 && (
        <div className="p-2.5 bg-muted/40 border rounded-xl space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-muted-foreground flex items-center gap-1.5 text-[11px]">
              <Navigation size={13} className="text-emerald-500 shrink-0" />
              {t('navPathOsrm')}:
            </span>
            <span className="font-bold text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              {routes.filter(r => r.isRealRoad).length} / {routes.length}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {routes.filter(r => r.isRealRoad).length === routes.length ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">{t('allRoutesRealRoad')}</span>
            ) : (
              <span>{t('calculatingNavPath', { count: routes.length - routes.filter(r => r.isRealRoad).length })}</span>
            )}
          </div>
        </div>
      )}

      {/* Route List Header & Date-grouped Routes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs px-0.5 pt-0.5">
          <span className="text-muted-foreground font-medium text-[11px]">
            {t('totalRoutes')}: <span className="text-foreground font-bold">{routes.length}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <button 
              type="button"
              className="text-primary h-6 px-2 text-[10px] hover:bg-primary/10 rounded flex items-center cursor-pointer transition-colors font-medium" 
              onClick={() => {
                const name = `${t('scenarioWord')} ${routeVersions.length + 1}`;
                onSaveVersion(name);
              }}
              title={t('btnSaveScenario')}
            >
              <Save size={11} className="mr-1" />
              {t('btnSave')}
            </button>
            {routes.length > 0 && (
              <button 
                type="button"
                className="text-destructive h-6 px-2 text-[10px] hover:bg-destructive/10 rounded flex items-center cursor-pointer transition-colors font-medium" 
                onClick={onClearAllRoutes}
                title={t('btnClearAllRoutes')}
              >
                <Trash2 size={11} className="mr-1" />
                {t('btnClearAll')}
              </button>
            )}
          </div>
        </div>

        {/* Quick Date Chips Filter */}
          {dateGroupedRoutes.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <button
                type="button"
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 transition-colors border cursor-pointer",
                  selectedRouteDateFilter === 'all' && (quickDateFilter === 'all' || selectedShippingDates.length === 0)
                    ? "bg-primary text-primary-foreground border-primary shadow-xs ring-1 ring-primary/40" 
                    : "bg-muted/40 hover:bg-muted text-muted-foreground border-border"
                )}
                onClick={() => onSelectRouteDateFilter('all')}
                title={t('filterAllDates')}
              >
                {t('filterAllDates')} ({dateGroupedRoutes.length})
              </button>
              {dateGroupedRoutes.map((g, gIdx) => {
                const isDateActive = selectedRouteDateFilter === g.date || 
                  selectedShippingDates.includes(g.date) ||
                  (quickDateFilter === 'today' && todayMatchingDates.includes(g.date)) ||
                  (quickDateFilter === 'tomorrow' && tomorrowMatchingDates.includes(g.date)) ||
                  (quickDateFilter === 'next7' && next7MatchingDates.includes(g.date));
                
                const isToday = todayMatchingDates.includes(g.date);
                const isTomorrow = tomorrowMatchingDates.includes(g.date);

                return (
                  <button
                    key={`route-date-tab-${g.date || 'date'}-${gIdx}`}
                    type="button"
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 transition-all border flex items-center gap-1.5 cursor-pointer",
                      isDateActive
                        ? "bg-primary text-primary-foreground border-primary shadow-xs ring-2 ring-primary/30 font-bold" 
                        : "bg-muted/40 hover:bg-muted text-muted-foreground border-border"
                    )}
                    onClick={() => onSelectRouteDateFilter(g.date)}
                    title={g.date}
                  >
                    <span>{g.date}</span>
                    {isToday && (
                      <span className={cn("text-[8px] px-1 py-0.2 rounded font-extrabold uppercase", isDateActive ? "bg-amber-400 text-slate-950" : "bg-amber-500/20 text-amber-600 dark:text-amber-400")}>
                        {t('dateToday')}
                      </span>
                    )}
                    {isTomorrow && (
                      <span className={cn("text-[8px] px-1 py-0.2 rounded font-extrabold uppercase", isDateActive ? "bg-blue-300 text-slate-950" : "bg-blue-500/20 text-blue-600 dark:text-blue-400")}>
                        {t('dateTomorrow')}
                      </span>
                    )}
                    <span className={cn(
                      "text-[9px] px-1 py-0.2 rounded font-bold",
                      isDateActive ? "bg-primary-foreground/20 text-white" : "bg-muted text-foreground"
                    )}>
                      {g.routes.length}{t('unitRoutesShort')} / {g.orders.length}{t('unitOrdersShort')}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Route list: uniform rows with status and load (details of one route open over the map) */}
          <RouteSummaryList
            items={routeListItems}
            totalCount={routeListTotal}
            selectedRouteId={selectedRouteId}
            lockedRouteIds={routingLimits.lockedRoutes || []}
            filter={routeListFilter}
            sort={routeListSort}
            onSetFilter={onSetRouteListFilter}
            onSetSort={onSetRouteListSort}
            onSelect={onSetSelectedRouteId}
            onHover={onSetHoveredRouteId}
            onOpenTable={onOpenSummaryTable}
          />
        </div>
    </div>
  );
};
