import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  X, 
  ShieldCheck, 
  Navigation, 
  Truck, 
  Layers, 
  PackageCheck,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { PlanValidationResult, RouteValidationResult } from '../../services/routeValidator';
import { Route, Order, TruckType } from '../../types';
import { Button, Card, Badge } from '../common/UIComponents';
import { cn } from '../../lib/utils';
import { formatDurationMinutes } from '../../services/distanceHelper';
import { useTranslation } from '../../i18n/I18nContext';

interface RouteValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  planResult: PlanValidationResult;
  routes?: Route[];
  orders?: Order[];
  truckTypes?: TruckType[];
  onSelectRoute?: (routeId: string) => void;
  onRecalculateRoads?: () => void;
  isCalculatingRoads?: boolean;
}

export const RouteValidationModal: React.FC<RouteValidationModalProps> = ({
  isOpen,
  onClose,
  planResult,
  routes,
  orders,
  truckTypes,
  onSelectRoute,
  onRecalculateRoads,
  isCalculatingRoads
}) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings' | 'valid'>('all');
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);

  const filteredRoutes = useMemo(() => {
    return planResult.routeResults.filter(res => {
      if (filter === 'errors') return res.status === 'ERROR';
      if (filter === 'warnings') return res.status === 'WARNING';
      if (filter === 'valid') return res.status === 'VALID';
      return true;
    });
  }, [planResult.routeResults, filter]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[3000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 15 }}
          className="bg-card text-card-foreground border shadow-2xl rounded-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="p-5 border-b bg-muted/30 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className={cn(
                "p-2.5 rounded-xl border flex items-center justify-center",
                planResult.status === 'VALID' && "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
                planResult.status === 'WARNING' && "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400",
                planResult.status === 'ERROR' && "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
              )}>
                {planResult.status === 'VALID' && <CheckCircle2 size={24} />}
                {planResult.status === 'WARNING' && <AlertTriangle size={24} />}
                {planResult.status === 'ERROR' && <XCircle size={24} />}
              </div>
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  {t('rvmTitle')}
                  <span className={cn(
                    "text-xs px-2.5 py-0.5 rounded-full font-bold border",
                    planResult.status === 'VALID' && "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
                    planResult.status === 'WARNING' && "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400",
                    planResult.status === 'ERROR' && "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
                  )}>
                    {planResult.status === 'VALID' ? t('rvmReady') : planResult.status === 'WARNING' ? t('rdmHasWarnings') : t('rvmNeedsFix')}
                  </span>
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t('rvmSubtitle')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {onRecalculateRoads && planResult.fallbackRoutesCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRecalculateRoads}
                  disabled={isCalculatingRoads}
                  className="gap-2 text-xs"
                  title={t('rvmTraceTitle')}
                >
                  <Navigation size={14} className={isCalculatingRoads ? "animate-spin text-primary" : ""} />
                  {isCalculatingRoads ? t('rvmTracing') : t('rvmTraceRoadsBtn', { count: planResult.fallbackRoutesCount })}
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
                <X size={20} />
              </Button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 border-b bg-muted/10 shrink-0 text-xs">
            <div className="p-3 bg-card border rounded-xl shadow-xs">
              <div className="text-muted-foreground flex items-center justify-between">
                <span>{t('rvmTotalRoutes')}</span>
                <Layers size={14} className="text-muted-foreground/70" />
              </div>
              <div className="text-lg font-bold mt-1">{planResult.totalRoutes}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{planResult.validRoutesCount} ok</span> •{' '}
                <span className="text-amber-600 dark:text-amber-400 font-semibold">{planResult.warningRoutesCount} warn</span> •{' '}
                <span className="text-rose-600 dark:text-rose-400 font-semibold">{planResult.errorRoutesCount} err</span>
              </div>
            </div>

            <div className="p-3 bg-card border rounded-xl shadow-xs">
              <div className="text-muted-foreground flex items-center justify-between">
                <span>{t('rvmOrdersDistribution')}</span>
                <PackageCheck size={14} className="text-muted-foreground/70" />
              </div>
              <div className="text-lg font-bold mt-1">
                {planResult.assignedOrdersCount} / {planResult.totalOrders}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {planResult.unassignedOrdersCount > 0 ? (
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                    {t('rvmUnassignedOrders', { count: planResult.unassignedOrdersCount })}
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{t('rvmAllOrdersAssigned')}</span>
                )}
              </div>
            </div>

            <div className="p-3 bg-card border rounded-xl shadow-xs">
              <div className="text-muted-foreground flex items-center justify-between">
                <span>{t('rvmOrdersUniqueness')}</span>
                <ShieldCheck size={14} className="text-muted-foreground/70" />
              </div>
              <div className="text-lg font-bold mt-1">
                {planResult.duplicateOrdersCount === 0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400">100% ok</span>
                ) : (
                  <span className="text-rose-600 dark:text-rose-400">{t('rvmDuplicateOrders', { count: planResult.duplicateOrdersCount })}</span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {planResult.duplicateOrdersCount > 0 
                  ? t('rvmHasDuplicates')
                  : t('rvmStrictlySingleRoute')}
              </div>
            </div>

            <div className="p-3 bg-card border rounded-xl shadow-xs">
              <div className="text-muted-foreground flex items-center justify-between">
                <span>{t('rvmRoadData')}</span>
                <Navigation size={14} className="text-muted-foreground/70" />
              </div>
              <div className="text-lg font-bold mt-1">
                {planResult.totalRoutes - planResult.fallbackRoutesCount} / {planResult.totalRoutes}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {planResult.fallbackRoutesCount > 0 ? (
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                    {t('rvmViaStraight', { count: planResult.fallbackRoutesCount })}
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{t('rvmAllOsrmRoads')}</span>
                )}
              </div>
            </div>

            <div className="p-3 bg-card border rounded-xl shadow-xs">
              <div className="text-muted-foreground flex items-center justify-between">
                <span>{t('rvmTruckOverloads')}</span>
                <Truck size={14} className="text-muted-foreground/70" />
              </div>
              <div className="text-lg font-bold mt-1">
                {planResult.routeResults.filter(r => !r.checks.weightOk || !r.checks.volumeOk).length}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {planResult.routeResults.some(r => !r.checks.weightOk || !r.checks.volumeOk) 
                  ? <span className="text-rose-600 dark:text-rose-400 font-semibold">{t('rvmHasOverloaded')}</span>
                  : <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{t('rvmWeightVolumeNormal')}</span>}
              </div>
            </div>
          </div>

          {/* Global Plan Issues Banner if any */}
          {planResult.globalIssues.length > 0 && (
            <div className="p-3 mx-4 mt-3 border rounded-xl bg-amber-500/10 border-amber-500/30 text-xs space-y-1.5 shrink-0">
              <div className="font-bold flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                <AlertCircle size={15} /> {t('rvmGlobalIssues')}
              </div>
              {planResult.globalIssues.map((issue, idx) => (
                <div key={`global-issue-${issue.message?.slice(0, 15) || 'gi'}-${idx}`} className="flex items-start gap-2 text-muted-foreground pl-5">
                  <span className="font-semibold text-foreground">• {issue.message}</span>
                  {issue.detail && <span className="text-[11px] text-muted-foreground">({issue.detail})</span>}
                </div>
              ))}
            </div>
          )}

          {/* Filter tabs */}
          <div className="px-5 pt-3 flex items-center gap-2 border-b bg-card shrink-0">
            <button
              onClick={() => setFilter('all')}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold border-b-2 transition-all cursor-pointer",
                filter === 'all' 
                  ? "border-primary text-primary" 
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t('rvmTabAll', { count: planResult.totalRoutes })}
            </button>
            <button
              onClick={() => setFilter('errors')}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5",
                filter === 'errors' 
                  ? "border-rose-500 text-rose-600 dark:text-rose-400" 
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <XCircle size={13} className="text-rose-500" />
              {t('rvmTabErrors', { count: planResult.errorRoutesCount })}
            </button>
            <button
              onClick={() => setFilter('warnings')}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5",
                filter === 'warnings' 
                  ? "border-amber-500 text-amber-600 dark:text-amber-400" 
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <AlertTriangle size={13} className="text-amber-500" />
              {t('rvmTabWarnings', { count: planResult.warningRoutesCount })}
            </button>
            <button
              onClick={() => setFilter('valid')}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5",
                filter === 'valid' 
                  ? "border-emerald-500 text-emerald-600 dark:text-emerald-400" 
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <CheckCircle2 size={13} className="text-emerald-500" />
              {t('rvmTabValid', { count: planResult.validRoutesCount })}
            </button>
          </div>

          {/* Route Cards List */}
          <div className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-thin bg-muted/5">
            {filteredRoutes.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground space-y-2">
                <CheckCircle2 size={36} className="mx-auto text-muted-foreground/40" />
                <div className="font-semibold text-sm">{t('rvmNoRoutesCategory')}</div>
                <div className="text-xs">{t('rvmNoRoutesCategoryDesc')}</div>
              </div>
            ) : (
              filteredRoutes.map((result, rIdx) => {
                const isExpanded = expandedRouteId === result.routeId;

                return (
                  <Card 
                    key={`val-route-${result.routeId}-${rIdx}`} 
                    className={cn(
                      "p-4 transition-all border",
                      result.status === 'ERROR' && "border-rose-500/40 bg-rose-500/[0.02]",
                      result.status === 'WARNING' && "border-amber-500/40 bg-amber-500/[0.02]",
                      result.status === 'VALID' && "border-border hover:border-primary/40"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-3 h-3 rounded-full shrink-0",
                          result.status === 'VALID' && "bg-emerald-500",
                          result.status === 'WARNING' && "bg-amber-500",
                          result.status === 'ERROR' && "bg-rose-500"
                        )} />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-foreground">{result.routeName}</span>
                            {result.metrics.truckTypeName && (
                              <Badge className="bg-primary/10 text-primary border border-primary/20 text-[10px]">
                                {result.metrics.truckTypeName}
                              </Badge>
                            )}
                            <span className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider",
                              result.status === 'VALID' && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                              result.status === 'WARNING' && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                              result.status === 'ERROR' && "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                            )}>
                              {result.status === 'VALID' ? t('rdmReady') : result.status === 'WARNING' ? t('rdmHasWarnings') : t('rdmHasErrors')}
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {t('navOrders')}: {result.metrics.orderCount} • {t('rdmTabStores', { count: '' }).trim()}: {result.metrics.storeCount}
                          </div>
                        </div>
                      </div>

                      {/* Distance & Source Info */}
                      <div className="text-right text-xs">
                        {result.metrics.roadDistanceKm !== undefined ? (
                          <div>
                            <div className="font-bold text-foreground">
                              {t('rdmRoadDistance')} {result.metrics.roadDistanceKm} {t('unitKm')}
                              {result.metrics.roadDurationMin && (
                                <span className="font-normal text-muted-foreground ml-1">
                                  ({formatDurationMinutes(result.metrics.roadDurationMin)})
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                              OSRM 100% • {t('rdmStraightDistance')} {result.metrics.straightDistanceKm} {t('unitKm')}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="font-bold text-amber-600 dark:text-amber-400">
                              {result.metrics.straightDistanceKm} {t('unitKm')} ({t('rdmStraightLineBadge').toLowerCase()})
                            </div>
                            <div className="text-[10px] text-amber-600/80">
                              ⚠ {t('rdmUnavailableStraight')}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-1.5">
                        {onSelectRoute && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 text-xs gap-1 text-primary hover:text-primary/80"
                            onClick={() => {
                              onSelectRoute(result.routeId);
                              onClose();
                            }}
                          >
                            <ExternalLink size={13} />
                            {t('rvmToRoute')}
                          </Button>
                        )}
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="h-8 w-8 cursor-pointer"
                          onClick={() => setExpandedRouteId(isExpanded ? null : result.routeId)}
                          title={isExpanded ? "Collapse" : "Expand"}
                        >
                          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </Button>
                      </div>
                    </div>

                    {/* Quick Audit Pills */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t text-[11px]">
                      <div className="flex items-center gap-1.5">
                        {result.checks.weightOk ? (
                          <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle size={13} className="text-rose-500 shrink-0" />
                        )}
                        <span className="text-muted-foreground">{t('rdmWeight')}</span>
                        <span className={cn("font-medium", !result.checks.weightOk && "text-rose-600 font-bold")}>
                          {Math.round(result.metrics.totalWeight)} / {result.metrics.maxWeight || '—'} {t('unitKg')}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {result.checks.volumeOk ? (
                          <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle size={13} className="text-rose-500 shrink-0" />
                        )}
                        <span className="text-muted-foreground">{t('rdmVolume')}</span>
                        <span className={cn("font-medium", !result.checks.volumeOk && "text-rose-600 font-bold")}>
                          {Math.round(result.metrics.totalVolume * 10) / 10} / {result.metrics.maxVolume || '—'} {t('unitM3')}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {result.checks.ordersUniqueOk ? (
                          <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle size={13} className="text-rose-500 shrink-0" />
                        )}
                        <span className="text-muted-foreground">{t('rvmUniqueness')}</span>
                        <span className="font-medium">
                          {result.checks.ordersUniqueOk ? t('rvmUnique') : t('rvmDuplicate')}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {result.checks.roadDistanceOk ? (
                          <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        ) : (
                          <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                        )}
                        <span className="text-muted-foreground">{t('rvmTracingPill')}</span>
                        <span className="font-medium">
                          {result.checks.roadDistanceOk ? 'OSRM' : t('rdmStraightLineBadge')}
                        </span>
                      </div>
                    </div>

                    {/* Detailed Issues List */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-3 pt-3 border-t space-y-2 overflow-hidden"
                        >
                          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                            {t('rdmTabAudit', { count: result.issues.length })}
                          </div>
                          {result.issues.length === 0 ? (
                            <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 p-2 bg-emerald-500/10 rounded-lg">
                              <CheckCircle2 size={14} /> {t('rvmAllLimitsCompliant')}
                            </div>
                          ) : (
                            result.issues.map((issue, idx) => (
                              <div
                                key={`route-issue-${issue.severity}-${idx}`}
                                className={cn(
                                  "p-2.5 rounded-lg text-xs flex items-start justify-between gap-2 border",
                                  issue.severity === 'ERROR' && "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300",
                                  issue.severity === 'WARNING' && "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
                                  issue.severity === 'INFO' && "bg-muted/50 border-border text-foreground"
                                )}
                              >
                                <div className="flex items-start gap-2">
                                  {issue.severity === 'ERROR' ? (
                                    <XCircle size={15} className="text-rose-500 shrink-0 mt-0.5" />
                                  ) : (
                                    <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                                  )}
                                  <div>
                                    <div className="font-semibold">{issue.message}</div>
                                    {issue.detail && (
                                      <div className="text-[11px] opacity-80 mt-0.5">{issue.detail}</div>
                                    )}
                                  </div>
                                </div>
                                <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-background/50 shrink-0">
                                  {issue.severity === 'ERROR' ? t('rdmHasErrors') : t('rdmHasWarnings')}
                                </span>
                              </div>
                            ))
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t bg-card flex items-center justify-between shrink-0">
            <div className="text-xs text-muted-foreground">
              {t('rvmTotalAudited', { routes: planResult.totalRoutes, orders: planResult.totalOrders })}
            </div>
            <Button variant="primary" onClick={onClose}>
              {t('btnCancel')}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
