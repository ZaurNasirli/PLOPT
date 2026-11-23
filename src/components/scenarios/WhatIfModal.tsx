import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  X, 
  Play, 
  Truck, 
  TrendingDown, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  ArrowRight, 
  DollarSign, 
  Clock, 
  Layers, 
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { Route, Order, TruckType } from '../../types';
import { RoutingLimits } from '../../services/routingService';
import { runSmartLogistics, getVRPConfigForMode } from '../../services/smartLogisticsOptimizer';
import { calculateSolutionMetrics } from '../../services/optimizer/OptimizationResult';
import { buildRoadMatrixLookup } from '../../services/optimizer/DistanceMatrix';
import { WAREHOUSE_LOCATION } from '../../mockData';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n/I18nContext';

export interface WhatIfScenarioResult {
  id: string;
  name: string;
  targetTrucks: number;
  actualTrucks: number;
  totalDistanceKm: number;
  totalDurationMin: number;
  avgRouteDurationMin: number;
  worstRouteDurationMin: number;
  worstRouteDistanceKm: number;
  avgVolumeUtilization: number;
  avgWeightUtilization: number;
  cost: number;
  routes: Route[];
  feasible: boolean;
  notes?: string;
}

interface WhatIfModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRoutes: Route[];
  orders: Order[];
  limits: RoutingLimits;
  onApplyScenario: (routes: Route[]) => void;
}

export const WhatIfModal: React.FC<WhatIfModalProps> = ({
  isOpen,
  onClose,
  currentRoutes,
  orders,
  limits,
  onApplyScenario
}) => {
  const { t } = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [scenarios, setScenarios] = useState<WhatIfScenarioResult[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentVehicleCount = currentRoutes.filter(r => r.orderIds.length > 0).length || 6;

  const computeScenarioCost = (distKm: number, durMin: number, vehicles: number): number => {
    const fuelRate = limits.costModel?.fuelCostPerKm ?? 0.45;
    const driverRate = limits.costModel?.driverCostPerHour ?? 8.0;
    const vehicleFixed = limits.costModel?.vehicleFixedCost ?? 35.0;
    const toll = limits.costModel?.tollCostPerRoute ?? 0.0;
    return Math.round(
      distKm * fuelRate + 
      (durMin / 60) * driverRate + 
      vehicles * vehicleFixed + 
      vehicles * toll
    );
  };

  const handleRunWhatIfAnalysis = async () => {
    setIsRunning(true);
    setScenarios([]);
    try {
      const activeOrders = orders.filter(o => o.status !== 'delivered');
      if (activeOrders.length === 0) {
        setIsRunning(false);
        return;
      }

      const matrix = await buildRoadMatrixLookup(activeOrders, WAREHOUSE_LOCATION);
      const fleetOptions = [
        Math.max(1, currentVehicleCount - 1),
        currentVehicleCount,
        currentVehicleCount + 1
      ];

      // Remove duplicate counts
      const uniqueCounts = Array.from(new Set(fleetOptions)).sort((a, b) => a - b);
      const results: WhatIfScenarioResult[] = [];

      for (const targetFleet of uniqueCounts) {
        const scenarioLimits: RoutingLimits = {
          ...limits,
          maxVehicles: targetFleet,
          optimizationMode: 'fast'
        };

        const generatedRoutes = await runSmartLogistics(
          activeOrders,
          scenarioLimits,
          () => {}
        );

        const activeGenRoutes = generatedRoutes.filter(r => r.orderIds.length > 0);
        const actualCount = activeGenRoutes.length;

        // Calculate route metrics
        const solutionIndices = activeGenRoutes.map(r => 
          r.orderIds.map(id => {
            const idx = activeOrders.findIndex(o => o.id === id);
            return idx >= 0 ? idx + 1 : -1;
          }).filter(i => i > 0)
        );

        const metrics = calculateSolutionMetrics(
          solutionIndices,
          activeOrders,
          matrix,
          scenarioLimits,
          getVRPConfigForMode('fast')
        );

        // Find worst route (longest route)
        let worstDur = 0;
        let worstDist = 0;
        activeGenRoutes.forEach(r => {
          const rIndices = r.orderIds.map(id => activeOrders.findIndex(o => o.id === id) + 1).filter(i => i > 0);
          const d = matrix.calculateRoundTripDistance(rIndices);
          const dur = matrix.calculateRoundTripDuration(rIndices) + (r.orderIds.length * 10);
          if (dur > worstDur) worstDur = dur;
          if (d > worstDist) worstDist = d;
        });

        const avgDur = actualCount > 0 ? Math.round(metrics.totalDurationMin / actualCount) : 0;
        const totalCost = computeScenarioCost(metrics.totalDistanceKm, metrics.totalDurationMin, actualCount);

        const isTargetMatch = actualCount <= targetFleet;
        const name = `${targetFleet} ${targetFleet === 1 ? 'авто' : targetFleet < 5 ? 'авто' : 'авто'}`;

        results.push({
          id: `scenario-${targetFleet}-trucks`,
          name: `Сценарий: ${name}`,
          targetTrucks: targetFleet,
          actualTrucks: actualCount,
          totalDistanceKm: metrics.totalDistanceKm,
          totalDurationMin: metrics.totalDurationMin,
          avgRouteDurationMin: avgDur,
          worstRouteDurationMin: worstDur,
          worstRouteDistanceKm: worstDist,
          avgVolumeUtilization: metrics.avgVolumeUtilization,
          avgWeightUtilization: metrics.avgWeightUtilization,
          cost: totalCost,
          routes: generatedRoutes,
          feasible: isTargetMatch
        });
      }

      setScenarios(results);
      if (results.length > 0) {
        setSelectedScenarioId(results[1]?.id || results[0].id);
      }
    } catch (e) {
      console.error('What-If analysis error:', e);
    } finally {
      setIsRunning(false);
    }
  };

  const currentScenario = scenarios.find(s => s.id === selectedScenarioId);

  return (
    <div className="fixed inset-0 z-[3500] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="bg-card border shadow-2xl rounded-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh] text-card-foreground"
      >
        {/* Header */}
        <div className="p-5 border-b flex items-center justify-between bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/15 text-primary rounded-xl">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                🔮 What-If Analysis: Моделирование флота и сценариев
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Сравнение сценариев количества машин (5 vs 6 vs 7 авто), оценка компромисса между пробегом и ресурсами
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 scrollbar-thin">
          <div className="p-4 rounded-xl border bg-muted/20 flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-foreground block">
                Сравнение сценариев размера автопарка
              </span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Текущий флот: <b>{currentVehicleCount} авто</b>. Анализ протестирует компрессию на -1 авто ({Math.max(1, currentVehicleCount - 1)}) и расширение на +1 авто ({currentVehicleCount + 1}).
              </p>
            </div>
            <button
              type="button"
              disabled={isRunning}
              onClick={handleRunWhatIfAnalysis}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-all cursor-pointer shrink-0",
                isRunning
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {isRunning ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Моделирование сценариев...</span>
                </>
              ) : (
                <>
                  <Play size={14} />
                  <span>Рассчитать What-If сценарии</span>
                </>
              )}
            </button>
          </div>

          {scenarios.length > 0 && (
            <div className="space-y-6">
              {/* Scenario Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {scenarios.map((sc, idx) => {
                  const isSelected = sc.id === selectedScenarioId;
                  const isBase = sc.targetTrucks === currentVehicleCount;
                  const baseScenario = scenarios.find(s => s.targetTrucks === currentVehicleCount) || scenarios[0];
                  
                  const distDeltaPct = baseScenario.totalDistanceKm > 0
                    ? Math.round(((sc.totalDistanceKm - baseScenario.totalDistanceKm) / baseScenario.totalDistanceKm) * 1000) / 10
                    : 0;

                  return (
                    <div
                      key={`whatif-sc-${sc.id || 'sc'}-${idx}`}
                      onClick={() => setSelectedScenarioId(sc.id)}
                      className={cn(
                        "p-4 rounded-xl border-2 transition-all cursor-pointer relative space-y-3",
                        isSelected
                          ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary/20"
                          : "border-border hover:border-primary/50 bg-card shadow-xs"
                      )}
                    >
                      <div className="flex items-center justify-between border-b pb-2">
                        <div className="flex items-center gap-2">
                          <Truck size={16} className="text-primary" />
                          <span className="font-bold text-sm">{sc.name}</span>
                        </div>
                        {isBase && (
                          <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            Текущий
                          </span>
                        )}
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Дистанция:</span>
                          <span className="font-bold text-foreground">
                            {sc.totalDistanceKm} км
                            {!isBase && distDeltaPct !== 0 && (
                              <span className={cn("text-[10px] ml-1.5 font-semibold", distDeltaPct > 0 ? "text-amber-600" : "text-emerald-600")}>
                                ({distDeltaPct > 0 ? `+${distDeltaPct}%` : `${distDeltaPct}%`})
                              </span>
                            )}
                          </span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Длительность:</span>
                          <span className="font-semibold text-foreground">{sc.totalDurationMin} мин</span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Загрузка объёма:</span>
                          <span className="font-bold text-emerald-600">{sc.avgVolumeUtilization}%</span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Загрузка веса:</span>
                          <span className="font-semibold text-foreground">{sc.avgWeightUtilization}%</span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Худший маршрут:</span>
                          <span className="font-semibold text-foreground">{sc.worstRouteDurationMin} мин ({sc.worstRouteDistanceKm} км)</span>
                        </div>

                        <div className="flex justify-between pt-1 border-t">
                          <span className="text-muted-foreground">Расчетная стоимость:</span>
                          <span className="font-bold text-primary">{sc.cost} AZN</span>
                        </div>
                      </div>

                      {/* Trade-off pill */}
                      {!isBase && (
                        <div className={cn(
                          "p-2 rounded-lg text-[10px] leading-tight font-medium border",
                          sc.targetTrucks < baseScenario.targetTrucks
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20"
                            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                        )}>
                          {sc.targetTrucks < baseScenario.targetTrucks ? (
                            <span>
                              ⚡ Экономит 1 машину, но увеличивает пробег на <b>{Math.abs(distDeltaPct)}%</b>
                            </span>
                          ) : (
                            <span>
                              ✓ Сокращает пробег на <b>{Math.abs(distDeltaPct)}%</b>, но требует +1 машину (+{sc.cost - baseScenario.cost} AZN)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Action Bar for selected scenario */}
              {currentScenario && (
                <div className="p-4 rounded-xl border bg-muted/30 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-foreground">
                      Выбран: {currentScenario.name} ({currentScenario.actualTrucks} машин, {currentScenario.totalDistanceKm} км, {currentScenario.cost} AZN)
                    </span>
                    <p className="text-[11px] text-muted-foreground">
                      Применив этот сценарий, текущие маршруты на карте будут заменены на результат данного моделирования.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onApplyScenario(currentScenario.routes);
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0"
                  >
                    <CheckCircle2 size={14} />
                    <span>Применить данный сценарий</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
