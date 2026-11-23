// Route History Service
// Tracks all state changes (route creation, deletion, orders add/move, optimization, etc.),
// provides snapshots, version restoration, and Before/After diff comparisons.

import { Route, Order } from '../types';

export type RouteHistoryActionType =
  | 'route_created'
  | 'route_deleted'
  | 'order_added'
  | 'order_removed'
  | 'order_moved'
  | 'stops_reordered'
  | 'route_optimized'
  | 'mass_optimized'
  | 'vehicle_changed'
  | 'route_updated'
  | 'scenario_saved'
  | 'scenario_restored'
  | 'batch_action'
  | 'manual_change';

export interface SnapshotDiff {
  routesBefore: number;
  routesAfter: number;
  routesDelta: number;

  distanceBefore: number;
  distanceAfter: number;
  distanceDelta: number;

  ordersInRouteBefore: number;
  ordersInRouteAfter: number;
  ordersInRouteDelta: number;

  weightBefore: number;
  weightAfter: number;
  weightDelta: number;

  volumeBefore: number;
  volumeAfter: number;
  volumeDelta: number;

  avgVolumeLoadBefore: number;
  avgVolumeLoadAfter: number;
  avgVolumeLoadDelta: number;

  avgWeightLoadBefore: number;
  avgWeightLoadAfter: number;
  avgWeightLoadDelta: number;

  estimatedCostBefore: number;
  estimatedCostAfter: number;
  estimatedCostDelta: number;
}

export interface RouteHistoryEntry {
  id: string;
  timestamp: number;
  timeFormatted: string;
  actionType: RouteHistoryActionType;
  title: string;
  description: string;
  routeId?: string;
  routeName?: string;
  
  // Snapshots for exact restoration
  snapshotBefore: {
    routes: Route[];
    orders: Order[];
  };
  snapshotAfter: {
    routes: Route[];
    orders: Order[];
  };

  diff: SnapshotDiff;
}

export interface RecordChangeOptions {
  action?: string;
  actionType?: RouteHistoryActionType;
  title?: string;
  description?: string;
  snapshotBefore?: { routes: Route[]; orders: Order[] };
  snapshotAfter?: { routes: Route[]; orders: Order[] };
  routesBefore?: Route[];
  routesAfter?: Route[];
  ordersBefore?: Order[];
  ordersAfter?: Order[];
  routeId?: string;
  routeName?: string;
  source?: string;
}

type HistoryChangeListener = (entries: RouteHistoryEntry[]) => void;

class RouteHistoryService {
  private static instance: RouteHistoryService;
  private entries: RouteHistoryEntry[] = [];
  private listeners = new Set<HistoryChangeListener>();
  private readonly STORAGE_KEY = 'route_history_snapshots_v1';
  private readonly MAX_ENTRIES = 50;

  private constructor() {
    this.loadFromStorage();
  }

  public static getInstance(): RouteHistoryService {
    if (!RouteHistoryService.instance) {
      RouteHistoryService.instance = new RouteHistoryService();
    }
    return RouteHistoryService.instance;
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.entries = parsed;
        }
      }
    } catch {
      // Storage unavailable or corrupt
      this.entries = [];
    }
  }

  private saveToStorage() {
    try {
      // To keep payload light, keep up to 35 most recent entries
      const slice = this.entries.slice(0, 35);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(slice));
    } catch {
      // If quota exceeded, trim more aggressively
      try {
        const minimal = this.entries.slice(0, 15);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(minimal));
      } catch {
        // ignore
      }
    }
  }

  public subscribe(listener: HistoryChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.entries);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(l => {
      try {
        l(this.entries);
      } catch {
        // ignore
      }
    });
  }

  public getHistory(): RouteHistoryEntry[] {
    return this.entries;
  }

  public clearHistory(): void {
    this.entries = [];
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch {
      // ignore
    }
    this.notify();
  }

  /**
   * Compare two state snapshots to produce metrics diff
   */
  public computeDiff(
    before: { routes: Route[]; orders: Order[] },
    after: { routes: Route[]; orders: Order[] }
  ): SnapshotDiff {
    const routesBefore = before.routes.length;
    const routesAfter = after.routes.length;

    const distanceBefore = Math.round(before.routes.reduce((s, r) => s + (r.distance || 0), 0) * 10) / 10;
    const distanceAfter = Math.round(after.routes.reduce((s, r) => s + (r.distance || 0), 0) * 10) / 10;

    const inRouteBefore = before.orders.filter(o => o.status === 'in-route').length;
    const inRouteAfter = after.orders.filter(o => o.status === 'in-route').length;

    const inRouteOrdersBefore = before.orders.filter(o => o.status === 'in-route');
    const inRouteOrdersAfter = after.orders.filter(o => o.status === 'in-route');

    const weightBefore = Math.round(inRouteOrdersBefore.reduce((s, o) => s + (o.weight || 0), 0));
    const weightAfter = Math.round(inRouteOrdersAfter.reduce((s, o) => s + (o.weight || 0), 0));

    const volumeBefore = Math.round(inRouteOrdersBefore.reduce((s, o) => s + (o.volume || 0), 0) * 10) / 10;
    const volumeAfter = Math.round(inRouteOrdersAfter.reduce((s, o) => s + (o.volume || 0), 0) * 10) / 10;

    // Load estimates (assumed maxWeight ~1500, maxVolume ~12 by default if not set)
    const calcAvgLoad = (routes: Route[], orders: Order[]) => {
      if (!routes || routes.length === 0) return { vol: 0, wt: 0 };
      let sumVolLoad = 0;
      let sumWtLoad = 0;
      (routes || []).forEach(r => {
        const rOrderIds = r.orderIds || [];
        const rOrders = (orders || []).filter(o => rOrderIds.includes(o.id));
        const w = rOrders.reduce((s, o) => s + (o.weight || 0), 0);
        const v = rOrders.reduce((s, o) => s + (o.volume || 0), 0);
        sumWtLoad += Math.min(100, (w / 1500) * 100);
        sumVolLoad += Math.min(100, (v / 12) * 100);
      });
      return {
        vol: Math.round(sumVolLoad / routes.length),
        wt: Math.round(sumWtLoad / routes.length)
      };
    };

    const loadBefore = calcAvgLoad(before.routes, before.orders);
    const loadAfter = calcAvgLoad(after.routes, after.orders);

    // Cost estimation ($/₼ 2 per km + $5 per stop + $10 per route)
    const calcCost = (routes: Route[], orders: Order[]) => {
      return routes.reduce((sum, r) => {
        const stopCount = r.orderIds.length;
        return sum + 10 + (r.distance * 2) + (stopCount * 5);
      }, 0);
    };

    const costBefore = Math.round(calcCost(before.routes, before.orders));
    const costAfter = Math.round(calcCost(after.routes, after.orders));

    return {
      routesBefore,
      routesAfter,
      routesDelta: routesAfter - routesBefore,

      distanceBefore,
      distanceAfter,
      distanceDelta: Math.round((distanceAfter - distanceBefore) * 10) / 10,

      ordersInRouteBefore: inRouteBefore,
      ordersInRouteAfter: inRouteAfter,
      ordersInRouteDelta: inRouteAfter - inRouteBefore,

      weightBefore,
      weightAfter,
      weightDelta: weightAfter - weightBefore,

      volumeBefore,
      volumeAfter,
      volumeDelta: Math.round((volumeAfter - volumeBefore) * 10) / 10,

      avgVolumeLoadBefore: loadBefore.vol,
      avgVolumeLoadAfter: loadAfter.vol,
      avgVolumeLoadDelta: loadAfter.vol - loadBefore.vol,

      avgWeightLoadBefore: loadBefore.wt,
      avgWeightLoadAfter: loadAfter.wt,
      avgWeightLoadDelta: loadAfter.wt - loadBefore.wt,

      estimatedCostBefore: costBefore,
      estimatedCostAfter: costAfter,
      estimatedCostDelta: costAfter - costBefore
    };
  }

  /**
   * Record a new action into history.
   * Supports either an options object or positional arguments.
   */
  public recordChange(
    actionTypeOrOptions: RouteHistoryActionType | RecordChangeOptions,
    titleArg?: string,
    descriptionArg?: string,
    snapshotBeforeArg?: { routes: Route[]; orders: Order[] },
    snapshotAfterArg?: { routes: Route[]; orders: Order[] },
    metaArg?: { routeId?: string; routeName?: string }
  ): RouteHistoryEntry {
    let actionType: RouteHistoryActionType = 'manual_change';
    let title = 'Изменение маршрутов';
    let description = '';
    let snapshotBefore: { routes: Route[]; orders: Order[] } = { routes: [], orders: [] };
    let snapshotAfter: { routes: Route[]; orders: Order[] } = { routes: [], orders: [] };
    let meta: { routeId?: string; routeName?: string } | undefined = metaArg;

    if (typeof actionTypeOrOptions === 'object' && actionTypeOrOptions !== null) {
      const opts = actionTypeOrOptions;
      actionType = opts.actionType || (opts.action?.includes('Оптимизац') ? 'mass_optimized' : opts.action?.includes('Создание') ? 'route_created' : 'manual_change');
      title = opts.title || opts.action || 'Изменение маршрутов';
      description = opts.description || '';
      
      snapshotBefore = opts.snapshotBefore || {
        routes: opts.routesBefore || [],
        orders: opts.ordersBefore || []
      };
      
      snapshotAfter = opts.snapshotAfter || {
        routes: opts.routesAfter || [],
        orders: opts.ordersAfter || []
      };

      meta = {
        routeId: opts.routeId,
        routeName: opts.routeName
      };
    } else {
      actionType = actionTypeOrOptions as RouteHistoryActionType;
      title = titleArg || 'Действие';
      description = descriptionArg || '';
      snapshotBefore = snapshotBeforeArg || { routes: [], orders: [] };
      snapshotAfter = snapshotAfterArg || { routes: [], orders: [] };
      meta = metaArg;
    }

    const now = new Date();
    const timeFormatted = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
      ', ' + now.toLocaleDateString([], { day: '2-digit', month: '2-digit' });

    const diff = this.computeDiff(snapshotBefore, snapshotAfter);

    // Strip heavy geometries from stored snapshot copies completely
    // to protect browser local storage quota, while keeping all route metrics, orders, vehicles, and sequences intact.
    const sanitizeRoutes = (routes: Route[]): Route[] => {
      return routes.map(r => {
        const { geometry, ...rest } = r;
        return rest as Route;
      });
    };

    const entry: RouteHistoryEntry = {
      id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      timeFormatted,
      actionType,
      title,
      description,
      routeId: meta?.routeId,
      routeName: meta?.routeName,
      snapshotBefore: {
        routes: sanitizeRoutes(JSON.parse(JSON.stringify(snapshotBefore.routes))),
        orders: JSON.parse(JSON.stringify(snapshotBefore.orders))
      },
      snapshotAfter: {
        routes: sanitizeRoutes(JSON.parse(JSON.stringify(snapshotAfter.routes))),
        orders: JSON.parse(JSON.stringify(snapshotAfter.orders))
      },
      diff
    };

    // Insert at beginning (newest first)
    this.entries = [entry, ...this.entries].slice(0, this.MAX_ENTRIES);
    this.saveToStorage();
    this.notify();
    return entry;
  }

  /**
   * Find entry and return the snapshot to restore to
   */
  public getSnapshotToRestore(entryId: string): { routes: Route[]; orders: Order[] } | null {
    const found = this.entries.find(e => e.id === entryId);
    if (!found) return null;
    return {
      routes: JSON.parse(JSON.stringify(found.snapshotBefore.routes)),
      orders: JSON.parse(JSON.stringify(found.snapshotBefore.orders))
    };
  }

  /**
   * Undo last action (restore before state of top entry)
   */
  public getUndoSnapshot(): { routes: Route[]; orders: Order[]; entryTitle: string } | null {
    if (this.entries.length === 0) return null;
    const top = this.entries[0];
    return {
      routes: JSON.parse(JSON.stringify(top.snapshotBefore.routes)),
      orders: JSON.parse(JSON.stringify(top.snapshotBefore.orders)),
      entryTitle: top.title
    };
  }

  /**
   * Pop the last action and return the snapshot to restore to,
   * allowing repeated step-by-step undo.
   */
  public popUndoSnapshot(): { routes: Route[]; orders: Order[]; entryTitle: string } | null {
    if (this.entries.length === 0) return null;
    const top = this.entries[0];
    this.entries = this.entries.slice(1);
    this.saveToStorage();
    this.notify();
    return {
      routes: JSON.parse(JSON.stringify(top.snapshotBefore.routes)),
      orders: JSON.parse(JSON.stringify(top.snapshotBefore.orders)),
      entryTitle: top.title
    };
  }

  public canUndo(): boolean {
    return this.entries.length > 0;
  }
}

export const routeHistoryService = RouteHistoryService.getInstance();
