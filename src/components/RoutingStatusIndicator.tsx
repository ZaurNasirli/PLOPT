import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle, 
  RefreshCw, 
  Database, 
  Trash2, 
  ChevronDown, 
  Info, 
  Server 
} from 'lucide-react';
import { routingProvider, RoutingProviderStatusInfo } from '../services/routingProvider';
import { distanceMatrixManager, MatrixCacheStats } from '../services/distanceMatrixManager';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n/I18nContext';

export const RoutingStatusIndicator: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation();
  const [statusInfo, setStatusInfo] = useState<RoutingProviderStatusInfo>(() => routingProvider.getStatus());
  const [cacheStats, setCacheStats] = useState<MatrixCacheStats>(() => distanceMatrixManager.getCacheStats());
  const [isOpen, setIsOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    const unsub = routingProvider.subscribeStatus((info) => {
      setStatusInfo(info);
      setCacheStats(distanceMatrixManager.getCacheStats());
    });
    return unsub;
  }, []);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      // Test with 2 points in Baku
      const testPoints = [
        { lat: 40.4093, lng: 49.8671 },
        { lat: 40.3850, lng: 49.8300 }
      ];
      const start = Date.now();
      const res = await routingProvider.getRouteNavDetails(testPoints);
      const elapsed = Date.now() - start;

      if (res.isRealRoad) {
        setTestResult(`✓ Road route loaded in ${elapsed}ms (${res.distanceKm} km) via ${res.providerUsed.toUpperCase()}`);
      } else {
        setTestResult(`⚠ OSRM offline. Used Haversine fallback (${res.distanceKm} km)`);
      }
      setStatusInfo(routingProvider.getStatus());
      setCacheStats(distanceMatrixManager.getCacheStats());
    } catch (e: any) {
      setTestResult(`Error: ${e?.message || 'Request failed'}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleClearCache = () => {
    distanceMatrixManager.clearCache();
    routingProvider.clearCache();
    setCacheStats(distanceMatrixManager.getCacheStats());
    setTestResult(t('routingCacheCleared'));
  };

  const getBadgeStyle = () => {
    switch (statusInfo.status) {
      case 'osrm_active':
        return {
          bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
          dot: 'bg-emerald-500',
          icon: <CheckCircle2 size={12} className="text-emerald-500" />
        };
      case 'backup_active':
        return {
          bg: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
          dot: 'bg-sky-500',
          icon: <Radio size={12} className="text-sky-500" />
        };
      case 'fallback_haversine':
        return {
          bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
          dot: 'bg-amber-500 animate-pulse',
          icon: <AlertTriangle size={12} className="text-amber-500" />
        };
      case 'unavailable':
      default:
        return {
          bg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
          dot: 'bg-rose-500',
          icon: <AlertCircle size={12} className="text-rose-500" />
        };
    }
  };

  const badge = getBadgeStyle();

  return (
    <div className={cn("relative inline-block", className)}>
      {/* Trigger Icon Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "h-8 w-8 flex items-center justify-center rounded-lg border shadow-xs transition-all hover:opacity-90 cursor-pointer relative",
          badge.bg
        )}
        title={`OSRM: ${statusInfo.label} (${t('routingStatusTriggerTitle')})`}
        aria-label="OSRM Routing Status"
      >
        <Radio size={15} className="shrink-0" />
        <span className={cn("absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ring-1 ring-card", badge.dot)} />
      </button>

      {/* Popover Card */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-card border rounded-xl shadow-xl p-3.5 z-50 text-xs space-y-3 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-2 border-b">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <Server size={16} className="text-primary" />
              <span>{t('routingStatusTitle')}</span>
            </div>
            <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold border", badge.bg)}>
              {statusInfo.status}
            </span>
          </div>

          <div className="space-y-1.5 text-muted-foreground text-[11px]">
            <p className="font-medium text-foreground">{statusInfo.description}</p>
            <div className="flex justify-between text-[10px]">
              <span>{t('routingServer')}</span>
              <span className="font-semibold text-foreground truncate max-w-[160px]" title={statusInfo.activeEndpointName}>
                {statusInfo.activeEndpointName}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span>{t('routingRoadRequestsSuccess')}</span>
              <span className="font-semibold text-emerald-600">{statusInfo.roadRequestsSuccess}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span>{t('routingFallbackHaversine')}</span>
              <span className="font-semibold text-amber-600">{statusInfo.fallbackRequestsCount}</span>
            </div>
          </div>

          {/* Matrix Cache Stats */}
          <div className="bg-muted/40 p-2 rounded-lg border border-border/60 space-y-1">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
              <span className="flex items-center gap-1">
                <Database size={11} /> {t('routingCacheTitle')}
              </span>
              <span>~{cacheStats.estimatedMemoryKb} KB</span>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[10px]">
              <div>{t('routingCacheTotalPairs')} <b className="text-foreground">{cacheStats.totalPairs}</b></div>
              <div>{t('routingCacheRoadPairs')} <b className="text-emerald-600">{cacheStats.roadPairs}</b></div>
            </div>
          </div>

          {/* Feedback message from test or cache clear */}
          {testResult && (
            <div className="p-2 rounded bg-accent/60 text-[10px] leading-tight text-foreground border border-border">
              {testResult}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={isTesting}
              onClick={handleTestConnection}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RefreshCw size={12} className={cn(isTesting ? "animate-spin" : "")} />
              {isTesting ? t('routingTesting') : t('routingTestBtn')}
            </button>
            <button
              type="button"
              onClick={handleClearCache}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-input bg-background hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors cursor-pointer"
              title={t('routingClearCacheTitle')}
            >
              <Trash2 size={12} />
              <span>{t('routingClearCacheBtn')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const RoutingFallbackAlertBanner: React.FC = () => {
  const { t } = useTranslation();
  const [statusInfo, setStatusInfo] = useState<RoutingProviderStatusInfo>(() => routingProvider.getStatus());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const unsub = routingProvider.subscribeStatus((info) => {
      setStatusInfo(info);
      if (info.status === 'osrm_active') {
        setDismissed(false);
      }
    });
    return unsub;
  }, []);

  if (dismissed || statusInfo.status === 'osrm_active') {
    return null;
  }

  const isFallback = statusInfo.status === 'fallback_haversine' || statusInfo.status === 'unavailable';

  return (
    <div className={cn(
      "w-full px-4 py-2 flex items-center justify-between text-xs border-b transition-colors shadow-xs",
      isFallback 
        ? "bg-amber-500/10 text-amber-900 dark:text-amber-200 border-amber-500/30" 
        : "bg-sky-500/10 text-sky-900 dark:text-sky-200 border-sky-500/30"
    )}>
      <div className="flex items-center gap-2">
        {isFallback ? <AlertTriangle size={16} className="text-amber-600 shrink-0" /> : <Info size={16} className="text-sky-600 shrink-0" />}
        <span>
          <b>{statusInfo.label}:</b> {statusInfo.description}
        </span>
      </div>
      <button 
        type="button"
        onClick={() => setDismissed(true)}
        className="text-[11px] underline font-medium hover:opacity-80 ml-4 shrink-0 cursor-pointer"
      >
        {t('routingHideAlert')}
      </button>
    </div>
  );
};
