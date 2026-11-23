import { Order, Route } from '../../types';
import type { RoutingLimits } from '../routingService';

export type OptimizationMode = 'fast' | 'balanced' | 'quality' | 'cost_saver' | 'fleet_saver' | 'time_saver';

export interface SmartVRPConfig {
  // --- Optimization Mode ---
  mode: OptimizationMode;

  // --- Multi-start parameters ---
  multiStartIterations: number;
  ilsMaxPerturbations: number;
  ilsLocalSearchDepth: number;

  // --- Normalized Objective Function Weights (Sum == 1.0) ---
  distanceWeight: number;           // 0.30 - Total road distance
  durationWeight: number;           // 0.20 - Driving + waiting + service duration
  vehicleCountWeight: number;       // 0.20 - Fixed dispatch cost per vehicle
  capacityUtilizationWeight: number;// 0.15 - Volume utilization (primary load driver)
  geographicCompactnessWeight: number;// 0.07 - Natural directional corridor & shape
  stopBalanceWeight: number;        // 0.05 - Balanced stop distribution across fleet
  regionConsistencyWeight: number;  // 0.03 - Geographic region consistency
  timeWindowWeight: number;         // Separate time window penalty weight (0.05)
  routeStabilityWeight: number;     // 0.00 to 0.15 - Preference for maintaining previous assignments

  // --- Detour thresholds (road distance / radial baseline) ---
  detourThresholdLow: number;       // 1.20 - Low detour (normal)
  detourThresholdMid: number;       // 1.45 - Medium detour
  detourThresholdHigh: number;      // 1.70 - Severe detour penalty

  // --- Dynamic Underutilization Thresholds ---
  underutilizedCriticalThreshold: number; // 0.20 (20% load - critical penalty)
  underutilizedModerateThreshold: number; // 0.35 (35% load - moderate penalty)
  underutilizedTargetThreshold: number;   // 0.50 (50%+ load - healthy zone)

  // --- Local Search Pass Limits ---
  twoOptMaxPasses: number;
  orOptMaxPasses: number;
  interRouteMaxIterations: number;
  crossExchangeMaxBlocks: number;
  enableThreeOpt: boolean;

  // --- Time Windows & Service Times ---
  defaultServiceTimeMinutes: number; // default service duration per customer stop (e.g. 10 min)
  depotStartHour: number;           // 08:00 start of dispatch day
  maxRouteDurationHours: number;    // 10 hours max shift duration

  // --- Search time budget ---
  /** Overrides the mode's default time budget (milliseconds) */
  timeBudgetMs?: number;
}

/**
 * Time budget for one optimization (one date/time-slot group), by mode and number of stops.
 * The search (multi-start + ruin & recreate) uses the whole budget and stops on time.
 */
export function getTimeBudgetMs(config: SmartVRPConfig, stops: number): number {
  if (config.timeBudgetMs && config.timeBudgetMs > 0) return config.timeBudgetMs;
  switch (config.mode) {
    case 'fast': return Math.min(6000, 1500 + 15 * stops);
    case 'quality': return Math.min(40000, 6000 + 100 * stops);
    default: return Math.min(15000, 3000 + 40 * stops);
  }
}

export const DEFAULT_VRP_CONFIG_BALANCED: SmartVRPConfig = {
  mode: 'balanced',
  multiStartIterations: 10,
  ilsMaxPerturbations: 3,
  ilsLocalSearchDepth: 25,

  distanceWeight: 0.28,
  durationWeight: 0.19,
  vehicleCountWeight: 0.19,
  capacityUtilizationWeight: 0.14,
  geographicCompactnessWeight: 0.07,
  stopBalanceWeight: 0.05,
  regionConsistencyWeight: 0.03,
  timeWindowWeight: 0.05,
  routeStabilityWeight: 0.00,

  detourThresholdLow: 1.20,
  detourThresholdMid: 1.45,
  detourThresholdHigh: 1.70,

  underutilizedCriticalThreshold: 0.20,
  underutilizedModerateThreshold: 0.35,
  underutilizedTargetThreshold: 0.50,

  twoOptMaxPasses: 35,
  orOptMaxPasses: 20,
  interRouteMaxIterations: 40,
  crossExchangeMaxBlocks: 2,
  enableThreeOpt: false,

  defaultServiceTimeMinutes: 10,
  depotStartHour: 8,
  maxRouteDurationHours: 10
};

export const DEFAULT_VRP_CONFIG_FAST: SmartVRPConfig = {
  ...DEFAULT_VRP_CONFIG_BALANCED,
  mode: 'fast',
  multiStartIterations: 3,
  ilsMaxPerturbations: 1,
  ilsLocalSearchDepth: 15,
  twoOptMaxPasses: 20,
  orOptMaxPasses: 10,
  interRouteMaxIterations: 20,
  crossExchangeMaxBlocks: 1,
  enableThreeOpt: false
};

export const DEFAULT_VRP_CONFIG_QUALITY: SmartVRPConfig = {
  ...DEFAULT_VRP_CONFIG_BALANCED,
  mode: 'quality',
  multiStartIterations: 20,
  ilsMaxPerturbations: 5,
  ilsLocalSearchDepth: 40,
  twoOptMaxPasses: 60,
  orOptMaxPasses: 35,
  interRouteMaxIterations: 70,
  crossExchangeMaxBlocks: 3,
  enableThreeOpt: true
};

export const DEFAULT_VRP_CONFIG_COST_SAVER: SmartVRPConfig = {
  ...DEFAULT_VRP_CONFIG_BALANCED,
  mode: 'cost_saver',
  multiStartIterations: 12,
  distanceWeight: 0.32,
  vehicleCountWeight: 0.24,
  durationWeight: 0.14,
  capacityUtilizationWeight: 0.15,
  geographicCompactnessWeight: 0.05,
  stopBalanceWeight: 0.03,
  regionConsistencyWeight: 0.02,
  timeWindowWeight: 0.05
};

export const DEFAULT_VRP_CONFIG_FLEET_SAVER: SmartVRPConfig = {
  ...DEFAULT_VRP_CONFIG_BALANCED,
  mode: 'fleet_saver',
  multiStartIterations: 14,
  vehicleCountWeight: 0.38,
  capacityUtilizationWeight: 0.24,
  distanceWeight: 0.14,
  durationWeight: 0.09,
  geographicCompactnessWeight: 0.05,
  stopBalanceWeight: 0.03,
  regionConsistencyWeight: 0.02,
  timeWindowWeight: 0.05
};

export const DEFAULT_VRP_CONFIG_TIME_SAVER: SmartVRPConfig = {
  ...DEFAULT_VRP_CONFIG_BALANCED,
  mode: 'time_saver',
  multiStartIterations: 12,
  durationWeight: 0.35,
  timeWindowWeight: 0.14,
  distanceWeight: 0.20,
  vehicleCountWeight: 0.11,
  capacityUtilizationWeight: 0.08,
  geographicCompactnessWeight: 0.06,
  stopBalanceWeight: 0.04,
  regionConsistencyWeight: 0.02
};

/**
 * Ensures sum(weights) === 1.0 across all 8 primary objective components.
 */
export function normaliseWeights(config?: Partial<SmartVRPConfig>): SmartVRPConfig {
  const merged: SmartVRPConfig = {
    ...DEFAULT_VRP_CONFIG_BALANCED,
    ...(config || {})
  };

  const sum =
    (merged.distanceWeight || 0) +
    (merged.durationWeight || 0) +
    (merged.vehicleCountWeight || 0) +
    (merged.capacityUtilizationWeight || 0) +
    (merged.geographicCompactnessWeight || 0) +
    (merged.stopBalanceWeight || 0) +
    (merged.regionConsistencyWeight || 0) +
    (merged.timeWindowWeight || 0);

  if (sum > 0 && Math.abs(sum - 1.0) > 0.0001) {
    return {
      ...merged,
      distanceWeight: Math.round(((merged.distanceWeight || 0) / sum) * 1000) / 1000,
      durationWeight: Math.round(((merged.durationWeight || 0) / sum) * 1000) / 1000,
      vehicleCountWeight: Math.round(((merged.vehicleCountWeight || 0) / sum) * 1000) / 1000,
      capacityUtilizationWeight: Math.round(((merged.capacityUtilizationWeight || 0) / sum) * 1000) / 1000,
      geographicCompactnessWeight: Math.round(((merged.geographicCompactnessWeight || 0) / sum) * 1000) / 1000,
      stopBalanceWeight: Math.round(((merged.stopBalanceWeight || 0) / sum) * 1000) / 1000,
      regionConsistencyWeight: Math.round(((merged.regionConsistencyWeight || 0) / sum) * 1000) / 1000,
      timeWindowWeight: Math.round(((merged.timeWindowWeight || 0) / sum) * 1000) / 1000
    };
  }
  return merged;
}

export interface EffectiveObjectiveWeights {
  distance: number;
  duration: number;
  vehicleCount: number;
  volumeUtilization: number;
  geographicCompactness: number;
  stopBalance: number;
  regionConsistency: number;
  timeWindow: number;
  sum: number;
  routeStabilityPenalty: number;
}

export function getEffectiveObjectiveWeights(config: SmartVRPConfig): EffectiveObjectiveWeights {
  const norm = normaliseWeights(config);
  const sum = Math.round((
    norm.distanceWeight +
    norm.durationWeight +
    norm.vehicleCountWeight +
    norm.capacityUtilizationWeight +
    norm.geographicCompactnessWeight +
    norm.stopBalanceWeight +
    norm.regionConsistencyWeight +
    norm.timeWindowWeight
  ) * 1000) / 1000;

  return {
    distance: norm.distanceWeight,
    duration: norm.durationWeight,
    vehicleCount: norm.vehicleCountWeight,
    volumeUtilization: norm.capacityUtilizationWeight,
    geographicCompactness: norm.geographicCompactnessWeight,
    stopBalance: norm.stopBalanceWeight,
    regionConsistency: norm.regionConsistencyWeight,
    timeWindow: norm.timeWindowWeight,
    sum,
    routeStabilityPenalty: norm.routeStabilityWeight || 0
  };
}

export function getVRPConfigForMode(mode?: OptimizationMode, overrides?: Partial<SmartVRPConfig>): SmartVRPConfig {
  let base: SmartVRPConfig;
  switch (mode) {
    case 'fast':
      base = DEFAULT_VRP_CONFIG_FAST;
      break;
    case 'quality':
      base = DEFAULT_VRP_CONFIG_QUALITY;
      break;
    case 'cost_saver':
      base = DEFAULT_VRP_CONFIG_COST_SAVER;
      break;
    case 'fleet_saver':
      base = DEFAULT_VRP_CONFIG_FLEET_SAVER;
      break;
    case 'time_saver':
      base = DEFAULT_VRP_CONFIG_TIME_SAVER;
      break;
    case 'balanced':
    default:
      base = DEFAULT_VRP_CONFIG_BALANCED;
      break;
  }
  return normaliseWeights({ ...base, ...(overrides || {}) });
}

export interface RouteMetrics {
  distanceKm: number;
  drivingDurationMin: number;
  waitingDurationMin: number;
  serviceDurationMin: number;
  totalDurationMin: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  weightUtilization: number;
  volumeUtilization: number;
  peakUtilization: number;
  stopsCount: number;
  detourRatio: number;
  timeWindowLatenessMinutes: number;
  score: number;
  explanation: RouteExplanation;
}

export interface RouteExplanation {
  corridorName: string;
  loadBadge: string;
  efficiencyBadge: string;
  timeWindowBadge: string;
  highlights: string[];
}

export interface SolutionMetrics {
  totalDistanceKm: number;
  totalDrivingDurationMin: number;
  totalWaitingDurationMin: number;
  totalServiceDurationMin: number;
  totalDurationMin: number;
  vehiclesCount: number;
  totalStops: number;
  avgVolumeUtilization: number;
  minVolumeUtilization: number;
  maxVolumeUtilization: number;
  avgWeightUtilization: number;
  loadVariance: number;
  geographicCompactnessScore: number;
  timeWindowViolationsCount: number;
  totalNormalizedScore: number;
  isRealRoad: boolean;
  hasFallback: boolean;
}

export interface OptimizationComparison {
  before: SolutionMetrics;
  after: SolutionMetrics;
  distanceDeltaKm: number;
  distancePercentChange: number;
  durationDeltaMin: number;
  durationPercentChange: number;
  vehiclesDelta: number;
  volumeUtilizationDelta: number;
  scoreImprovementPercent: number;
  executionTimeMs: number;
}
