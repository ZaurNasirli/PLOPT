import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { Wand2, X, Check, TrendingUp, ArrowRight } from 'lucide-react';
import { Route, Order } from '../../types';
import { Button } from '../common/UIComponents';
import { cn } from '../../lib/utils';
import { 
  getDistanceMatrix, 
  getRouteTotalDistance, 
  optimizeRouteNearestNeighbor, 
  optimizeRoute2Opt, 
  optimizeRouteGreedy 
} from '../../services/routingService';
import { WAREHOUSE_LOCATION } from '../../mockData';
import { useTranslation } from '../../i18n/I18nContext';

interface OptimizationModalProps {
  route: Route;
  orders: Order[];
  onClose: () => void;
  onApply: (newOrderIds: string[], newDistance: number) => void;
}

export const OptimizationModal: React.FC<OptimizationModalProps> = ({
  route,
  orders,
  onClose,
  onApply
}) => {
  const { t } = useTranslation();
  const [selectedVersion, setSelectedVersion] = useState<number>(0);
  const [matrix, setMatrix] = useState<number[][] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchMatrix = async () => {
      setIsLoading(true);
      const m = await getDistanceMatrix([WAREHOUSE_LOCATION, ...orders]);
      setMatrix(m);
      setIsLoading(false);
    };
    fetchMatrix();
  }, [orders]);

  const versions = useMemo(() => {
    if (!matrix) return [];

    const currentOrderIds = route.orderIds;
    const currentOrders = currentOrderIds.map(id => orders.find(o => o.id === id)).filter(Boolean) as Order[];
    const currentDist = getRouteTotalDistance(currentOrders, matrix, orders);

    // Version 1: Nearest Neighbor
    const nnOrders = optimizeRouteNearestNeighbor(currentOrders, matrix);
    const nnDist = getRouteTotalDistance(nnOrders, matrix, currentOrders);

    // Version 2: 2-Opt Improvement
    const opt2Orders = optimizeRoute2Opt(currentOrders, matrix, currentOrders);
    const opt2Dist = getRouteTotalDistance(opt2Orders, matrix, currentOrders);

    // Version 3: Greedy Edge Selection
    const greedyOrders = optimizeRouteGreedy(currentOrders, matrix);
    const greedyDist = getRouteTotalDistance(greedyOrders, matrix, currentOrders);

    // Version 4: NN + 2-Opt
    const combinedOrders = optimizeRoute2Opt(nnOrders, matrix, currentOrders);
    const combinedDist = getRouteTotalDistance(combinedOrders, matrix, currentOrders);

    return [
      { key: 'current', name: t('optVerCurrent'), orderIds: currentOrderIds, distance: currentDist, description: t('optVerCurrentDesc') },
      { key: 'nn', name: t('optVerNN'), orderIds: nnOrders.map(o => o.id), distance: nnDist, description: t('optVerNNDesc') },
      { key: 'greedy', name: t('optVerGreedy'), orderIds: greedyOrders.map(o => o.id), distance: greedyDist, description: t('optVerGreedyDesc') },
      { key: 'opt2', name: t('optVer2Opt'), orderIds: opt2Orders.map(o => o.id), distance: opt2Dist, description: t('optVer2OptDesc') },
      { key: 'combined', name: t('optVerCombined'), orderIds: combinedOrders.map(o => o.id), distance: combinedDist, description: t('optVerCombinedDesc') }
    ].sort((a, b) => a.distance - b.distance);
  }, [route.orderIds, orders, matrix, t]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-background border rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="font-bold">{t('optModalLoadingMatrix')}</p>
        </div>
      </div>
    );
  }

  const currentVersion = versions[selectedVersion] || versions[0];
  const originalDist = versions.find(v => v.key === 'current')?.distance || route.distance;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-background border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b flex items-center justify-between bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Wand2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">{t('optModalTitle')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('optModalPointsSubtitle', { name: route.name, count: orders.length })} • Склад → Магазины → Склад
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X size={20} /></Button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {versions.map((v, idx) => (
              <div 
                key={`opt-ver-${v.name || 'v'}-${idx}`}
                className={cn(
                  "p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col gap-2",
                  selectedVersion === idx 
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20" 
                    : "border-border hover:border-primary/50 bg-card"
                )}
                onClick={() => setSelectedVersion(idx)}
              >
                <div className="flex justify-between items-start">
                  <span className="font-bold text-sm">{v.name}</span>
                  {selectedVersion === idx && <Check size={16} className="text-primary" />}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black tracking-tight">{v.distance}</span>
                  <span className="text-xs text-muted-foreground font-medium uppercase">{t('unitKm')}</span>
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{v.description}</p>
                {v.distance < originalDist && (
                  <div className="mt-auto pt-2 flex items-center gap-1 text-green-500 font-bold text-[10px]">
                    <TrendingUp size={12} />
                    {t('optSavingPercent', { percent: ((originalDist - v.distance) / originalDist * 100).toFixed(1) })}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="bg-muted/30 rounded-xl p-4 border border-dashed">
            <h3 className="text-xs font-bold uppercase tracking-wider mb-3 text-muted-foreground">{t('optCompareResult')}</h3>
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 text-center">
                <div className="text-sm font-medium text-muted-foreground mb-1">{t('optBefore')}</div>
                <div className="text-xl font-bold">{originalDist} {t('unitKm')}</div>
              </div>
              <div className="flex items-center text-primary">
                <ArrowRight size={24} />
              </div>
              <div className="flex-1 text-center">
                <div className="text-sm font-medium text-muted-foreground mb-1">{t('optAfter')}</div>
                <div className="text-xl font-bold text-primary">{currentVersion.distance} {t('unitKm')}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 border-t bg-muted/20 flex gap-3">
          <Button variant="outline" className="flex-1 cursor-pointer" onClick={onClose}>{t('btnCancel')}</Button>
          <Button 
            className="flex-1 gap-2 cursor-pointer font-semibold" 
            onClick={() => onApply(currentVersion.orderIds, currentVersion.distance)}
            disabled={currentVersion.key === 'current'}
          >
            {t('optApplyButton')} <Check size={18} />
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
