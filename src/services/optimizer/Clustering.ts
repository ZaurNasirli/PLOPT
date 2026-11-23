import { Order } from '../../types';
import { RoutingLimits } from '../routingService';
import { WAREHOUSE_LOCATION } from '../../mockData';
import { calculateDistance } from '../routingService';
import { RoadMatrixLookup } from './DistanceMatrix';
import { getDepotAngle, getAngleDiff } from './ObjectiveFunction';
import { LOAD_TOLERANCE } from './ConstraintValidator';

export interface EnrichedOrderNode {
  orderIndex: number; // 1-based index in matrix
  order: Order;
  angle: number;
  radialDistanceKm: number;
}

/**
 * Stage: Capacity-Aware Directional Corridor Clustering
 * Partitions orders into corridors while strictly respecting vehicle capacity bounds.
 * If 20 stores in one sector exceed 1 truck's capacity, it pre-splits into balanced sub-clusters
 * along radial depth and spatial proximity.
 */
export function buildCapacityAwareClusters(
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits
): number[][] {
  if (orderIndices.length <= 1) return [orderIndices];

  const maxTruckW = limits.truckTypes && limits.truckTypes.length > 0
    ? Math.max(...limits.truckTypes.map(t => t.maxWeight))
    : 1500;
  const maxTruckV = limits.truckTypes && limits.truckTypes.length > 0
    ? Math.max(...limits.truckTypes.map(t => t.maxVolume))
    : 12;

  const maxW = limits.maxWeight > 0 ? Math.min(limits.maxWeight, maxTruckW) : maxTruckW;
  const maxV = limits.maxVolume > 0 ? Math.min(limits.maxVolume, maxTruckV) : maxTruckV;

  // Enrich order nodes with angle and radial distance
  const nodes: EnrichedOrderNode[] = orderIndices.map(idx => {
    const o = ordersMap[idx - 1];
    return {
      orderIndex: idx,
      order: o,
      angle: getDepotAngle(o.lat, o.lng),
      radialDistanceKm: matrix.getDistance(0, idx)
    };
  });

  // Sort deterministically by angle from depot, then by distance to depot, then ID
  nodes.sort((a, b) => {
    if (Math.abs(a.angle - b.angle) > 0.001) return a.angle - b.angle;
    if (Math.abs(a.radialDistanceKm - b.radialDistanceKm) > 0.1) return a.radialDistanceKm - b.radialDistanceKm;
    return a.order.id.localeCompare(b.order.id);
  });

  // Step 1: Group into broad directional sectors (corridors)
  const corridors: EnrichedOrderNode[][] = [];
  let currentCorridor: EnrichedOrderNode[] = [nodes[0]];
  let lastAngle = nodes[0].angle;
  let lastDist = nodes[0].radialDistanceKm;

  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    const angleDiff = getAngleDiff(lastAngle, node.angle);
    const distDiff = Math.abs(lastDist - node.radialDistanceKm);

    // Adjacent corridor threshold: ~45 degrees or ~60 degrees with moderate radial gap
    if (angleDiff < Math.PI / 4 || (angleDiff < Math.PI / 3 && distDiff < 14.0)) {
      currentCorridor.push(node);
      lastAngle = node.angle;
      lastDist = node.radialDistanceKm;
    } else {
      corridors.push(currentCorridor);
      currentCorridor = [node];
      lastAngle = node.angle;
      lastDist = node.radialDistanceKm;
    }
  }
  if (currentCorridor.length > 0) corridors.push(currentCorridor);

  // Step 2: Capacity check for each corridor.
  // If corridor exceeds vehicle limit, split into balanced sub-clusters
  const finalClusters: number[][] = [];

  for (const corridor of corridors) {
    const totalW = corridor.reduce((s, n) => s + n.order.weight, 0);
    const totalV = corridor.reduce((s, n) => s + n.order.volume, 0);
    const uniqueCustomersCount = new Set(corridor.map(n => n.order.customerName)).size;

    const neededTrucksByWeight = Math.ceil(totalW / (maxW * LOAD_TOLERANCE));
    const neededTrucksByVolume = Math.ceil(totalV / (maxV * LOAD_TOLERANCE));
    const maxStopsLimit = limits.maxCustomers > 0 ? limits.maxCustomers : 25;
    const neededTrucksByStops = Math.ceil(uniqueCustomersCount / maxStopsLimit);
    const neededTrucks = Math.max(1, neededTrucksByWeight, neededTrucksByVolume, neededTrucksByStops);

    if (neededTrucks === 1 || corridor.length <= 4) {
      // Fits within 1 vehicle
      finalClusters.push(corridor.map(n => n.orderIndex));
    } else {
      // Exceeds 1 vehicle: partition corridor into balanced, spatially contiguous sub-clusters
      // using both road distance, road duration, and radial progression
      const sortedByRadial = [...corridor].sort((a, b) => {
        if (Math.abs(a.radialDistanceKm - b.radialDistanceKm) > 2.0) {
          return a.radialDistanceKm - b.radialDistanceKm;
        }
        return a.angle - b.angle;
      });

      const targetVolume = Math.max(0.5, totalV / neededTrucks);
      const targetWeight = Math.max(10, totalW / neededTrucks);
      const targetStops = Math.max(2, Math.ceil(corridor.length / neededTrucks));

      let subCluster: number[] = [];
      let subCustomers = new Set<string>();
      let currentSubV = 0;
      let currentSubW = 0;

      for (const node of sortedByRadial) {
        const nextCustomerCount = subCustomers.has(node.order.customerName)
          ? subCustomers.size
          : subCustomers.size + 1;

        const wouldExceedCapacity =
          (currentSubV + node.order.volume > maxV * LOAD_TOLERANCE) ||
          (currentSubW + node.order.weight > maxW * LOAD_TOLERANCE) ||
          (limits.maxCustomers > 0 && nextCustomerCount > limits.maxCustomers);

        const reachedTargetLoad =
          (currentSubV >= targetVolume && currentSubW >= targetWeight * 0.75) ||
          (subCluster.length >= targetStops);

        if (subCluster.length > 0 && (wouldExceedCapacity || (reachedTargetLoad && subCluster.length >= 2))) {
          finalClusters.push(subCluster);
          subCluster = [node.orderIndex];
          subCustomers = new Set([node.order.customerName]);
          currentSubV = node.order.volume;
          currentSubW = node.order.weight;
        } else {
          subCluster.push(node.orderIndex);
          subCustomers.add(node.order.customerName);
          currentSubV += node.order.volume;
          currentSubW += node.order.weight;
        }
      }

      if (subCluster.length > 0) {
        finalClusters.push(subCluster);
      }
    }
  }

  return finalClusters;
}
