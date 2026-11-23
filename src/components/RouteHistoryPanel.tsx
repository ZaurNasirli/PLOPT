import React, { useState, useEffect } from 'react';
import { 
  History, 
  RotateCcw, 
  GitCompare, 
  Trash2, 
  Wand2, 
  PlusCircle, 
  MinusCircle, 
  Truck, 
  ArrowRightLeft, 
  Bookmark, 
  CheckCircle, 
  Layers, 
  TrendingDown, 
  TrendingUp,
  Filter
} from 'lucide-react';
import { routeHistoryService, RouteHistoryEntry, RouteHistoryActionType } from '../services/routeHistoryService';
import { Route, Order } from '../types';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n/I18nContext';

interface RouteHistoryPanelProps {
  currentRoutes: Route[];
  currentOrders: Order[];
  onRestoreState: (routes: Route[], orders: Order[], message: string) => void;
  onCompareVersions: (entry: RouteHistoryEntry) => void;
}

export const RouteHistoryPanel: React.FC<RouteHistoryPanelProps> = ({
  currentRoutes,
  currentOrders,
  onRestoreState,
  onCompareVersions
}) => {
  const { t } = useTranslation();
  const [history, setHistory] = useState<RouteHistoryEntry[]>(() => routeHistoryService.getHistory());
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'optimization' | 'routes' | 'orders' | 'scenarios'>('all');

  useEffect(() => {
    const unsub = routeHistoryService.subscribe(entries => {
      setHistory(entries);
    });
    return unsub;
  }, []);

  const handleUndo = () => {
    const undoData = routeHistoryService.popUndoSnapshot();
    if (undoData) {
      onRestoreState(undoData.routes, undoData.orders, `Undo: "${undoData.entryTitle}"`);
    }
  };

  const handleRestoreEntry = (entry: RouteHistoryEntry) => {
    const snapshot = routeHistoryService.getSnapshotToRestore(entry.id);
    if (snapshot) {
      onRestoreState(
        snapshot.routes,
        snapshot.orders,
        `Restored: "${entry.title}" (${entry.timeFormatted})`
      );
    }
  };

  const handleClearHistory = () => {
    if (window.confirm(t('historyConfirmClear'))) {
      routeHistoryService.clearHistory();
    }
  };

  const getActionBadge = (type: RouteHistoryActionType) => {
    switch (type) {
      case 'route_optimized':
      case 'mass_optimized':
        return {
          icon: <Wand2 size={12} />,
          label: t('historyBadgeOptimization'),
          className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
        };
      case 'route_created':
        return {
          icon: <PlusCircle size={12} />,
          label: t('historyBadgeCreation'),
          className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
        };
      case 'route_deleted':
        return {
          icon: <MinusCircle size={12} />,
          label: t('historyBadgeDeletion'),
          className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
        };
      case 'order_added':
      case 'order_removed':
      case 'order_moved':
        return {
          icon: <ArrowRightLeft size={12} />,
          label: t('historyBadgeOrders'),
          className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20'
        };
      case 'vehicle_changed':
        return {
          icon: <Truck size={12} />,
          label: t('historyBadgeTransport'),
          className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
        };
      case 'scenario_saved':
      case 'scenario_restored':
        return {
          icon: <Bookmark size={12} />,
          label: t('historyBadgeScenario'),
          className: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20'
        };
      default:
        return {
          icon: <Layers size={12} />,
          label: t('historyBadgeChange'),
          className: 'bg-muted text-muted-foreground border-border'
        };
    }
  };

  const filteredHistory = history.filter(item => {
    if (selectedFilter === 'all') return true;
    if (selectedFilter === 'optimization') return item.actionType === 'route_optimized' || item.actionType === 'mass_optimized';
    if (selectedFilter === 'routes') return item.actionType === 'route_created' || item.actionType === 'route_deleted' || item.actionType === 'stops_reordered' || item.actionType === 'route_updated';
    if (selectedFilter === 'orders') return item.actionType === 'order_added' || item.actionType === 'order_removed' || item.actionType === 'order_moved' || item.actionType === 'batch_action';
    if (selectedFilter === 'scenarios') return item.actionType === 'scenario_saved' || item.actionType === 'scenario_restored';
    return true;
  });

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Header and Quick Undo */}
      <div className="flex items-center justify-between gap-2 pb-1 border-b">
        <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-muted-foreground">
          <History size={14} className="text-primary" />
          <span>{t('historyPanelTitle', { count: history.length })}</span>
        </div>

        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleUndo}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs cursor-pointer"
                title={t('historyUndoTitle')}
              >
                <RotateCcw size={11} />
                <span>{t('historyUndoBtn')}</span>
              </button>
              <button
                type="button"
                onClick={handleClearHistory}
                className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                title={t('historyClearTitle')}
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none text-[10px]">
        <button
          type="button"
          onClick={() => setSelectedFilter('all')}
          className={cn(
            "px-2 py-0.5 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer",
            selectedFilter === 'all' ? "bg-primary text-primary-foreground font-bold" : "bg-muted text-muted-foreground hover:bg-accent"
          )}
        >
          {t('historyFilterAll', { count: history.length })}
        </button>
        <button
          type="button"
          onClick={() => setSelectedFilter('optimization')}
          className={cn(
            "px-2 py-0.5 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer",
            selectedFilter === 'optimization' ? "bg-primary text-primary-foreground font-bold" : "bg-muted text-muted-foreground hover:bg-accent"
          )}
        >
          {t('historyFilterOptimization')}
        </button>
        <button
          type="button"
          onClick={() => setSelectedFilter('routes')}
          className={cn(
            "px-2 py-0.5 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer",
            selectedFilter === 'routes' ? "bg-primary text-primary-foreground font-bold" : "bg-muted text-muted-foreground hover:bg-accent"
          )}
        >
          {t('historyFilterRoutes')}
        </button>
        <button
          type="button"
          onClick={() => setSelectedFilter('orders')}
          className={cn(
            "px-2 py-0.5 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer",
            selectedFilter === 'orders' ? "bg-primary text-primary-foreground font-bold" : "bg-muted text-muted-foreground hover:bg-accent"
          )}
        >
          {t('historyFilterOrders')}
        </button>
        <button
          type="button"
          onClick={() => setSelectedFilter('scenarios')}
          className={cn(
            "px-2 py-0.5 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer",
            selectedFilter === 'scenarios' ? "bg-primary text-primary-foreground font-bold" : "bg-muted text-muted-foreground hover:bg-accent"
          )}
        >
          {t('historyFilterScenarios')}
        </button>
      </div>

      {/* History Timeline */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
        {filteredHistory.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground border rounded-xl border-dashed bg-muted/20 space-y-2">
            <History size={28} className="mx-auto opacity-30" />
            <p className="text-xs font-medium">{t('historyPanelEmpty')}</p>
            <p className="text-[10px] text-muted-foreground/70">
              {t('historyEmptyDesc')}
            </p>
          </div>
        ) : (
          filteredHistory.map((entry, idx) => {
            const badge = getActionBadge(entry.actionType);
            const isLatest = idx === 0;

            return (
              <div 
                key={`history-entry-${entry.id || 'entry'}-${idx}`}
                className={cn(
                  "p-2.5 rounded-xl border transition-all flex flex-col gap-1.5 bg-card hover:shadow-sm",
                  isLatest ? "ring-1 ring-primary/30 border-primary/40" : "border-border"
                )}
              >
                {/* Header: Badge + Timestamp + Actions */}
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border", badge.className)}>
                      {badge.icon}
                      <span>{badge.label}</span>
                    </span>
                    {isLatest && (
                      <span className="px-1 py-0.2 rounded text-[8px] font-bold bg-primary text-primary-foreground">
                        {t('historyCurrentBadge')}
                      </span>
                    )}
                  </div>

                  <span className="text-[10px] text-muted-foreground font-medium">
                    {entry.timeFormatted}
                  </span>
                </div>

                {/* Title & Description */}
                <div>
                  <h4 className="text-xs font-bold text-foreground leading-snug">
                    {entry.title}
                  </h4>
                  {entry.description && (
                    <p className="text-[11px] text-muted-foreground leading-normal mt-0.5">
                      {entry.description}
                    </p>
                  )}
                </div>

                {/* Diff Metric Pills */}
                {entry.diff && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] bg-muted/40 p-1.5 rounded-lg border border-border/40">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">{t('navRoutes')}:</span>
                      <span className="font-semibold">{entry.diff.routesBefore} → {entry.diff.routesAfter}</span>
                      {entry.diff.routesDelta !== 0 && (
                        <span className={cn("font-bold text-[9px]", entry.diff.routesDelta < 0 ? "text-emerald-600" : "text-amber-600")}>
                          ({entry.diff.routesDelta > 0 ? `+${entry.diff.routesDelta}` : entry.diff.routesDelta})
                        </span>
                      )}
                    </div>

                    <span className="text-muted-foreground">•</span>

                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">{t('historyMileageLabel')}:</span>
                      <span className="font-semibold">{entry.diff.distanceBefore} → {entry.diff.distanceAfter} {t('unitKm')}</span>
                      {entry.diff.distanceDelta !== 0 && (
                        <span className={cn("font-bold text-[9px] flex items-center gap-0.5", entry.diff.distanceDelta < 0 ? "text-emerald-600" : "text-rose-600")}>
                          {entry.diff.distanceDelta < 0 ? <TrendingDown size={9} /> : <TrendingUp size={9} />}
                          {entry.diff.distanceDelta > 0 ? `+${entry.diff.distanceDelta}` : entry.diff.distanceDelta} {t('unitKm')}
                        </span>
                      )}
                    </div>

                    {entry.diff.avgVolumeLoadDelta !== 0 && (
                      <>
                        <span className="text-muted-foreground">•</span>
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground">{t('historyLoadLabel')}:</span>
                          <span className={cn("font-bold text-[9px]", entry.diff.avgVolumeLoadDelta > 0 ? "text-emerald-600" : "text-amber-600")}>
                            {entry.diff.avgVolumeLoadDelta > 0 ? `+${entry.diff.avgVolumeLoadDelta}%` : `${entry.diff.avgVolumeLoadDelta}%`}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Footer Controls */}
                <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/50">
                  <button
                    type="button"
                    onClick={() => onCompareVersions(entry)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border border-input bg-background hover:bg-accent transition-colors cursor-pointer"
                    title={t('historyCompareTitle')}
                  >
                    <GitCompare size={11} />
                    <span>{t('historyCompareBtn')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRestoreEntry(entry)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
                    title={t('historyRestoreTitle')}
                  >
                    <RotateCcw size={11} />
                    <span>{t('historyRestoreBtn')}</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
