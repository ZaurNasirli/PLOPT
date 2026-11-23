// Unified Routing Provider Layer
// Provides resilient OSRM road routing, fallback mechanisms, concurrency control, and status tracking.

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export type RoutingProviderStatus = 
  | 'osrm_active' 
  | 'backup_active' 
  | 'fallback_haversine' 
  | 'unavailable';

export interface RoutingProviderStatusInfo {
  status: RoutingProviderStatus;
  label: string;
  description: string;
  activeEndpointName: string;
  lastChecked: number;
  consecutiveErrors: number;
  totalRequests: number;
  roadRequestsSuccess: number;
  fallbackRequestsCount: number;
}

export interface RouteNavDetails {
  geometry: [number, number][];
  distanceKm: number;
  durationMinutes?: number;
  isRealRoad: boolean;
  isFallback: boolean;
  providerUsed: 'osrm' | 'backup' | 'haversine';
  summary?: string;
}

export interface PairDistanceResult {
  distanceKm: number;
  durationMinutes: number;
  isRealRoad: boolean;
  isFallback: boolean;
  providerUsed: 'osrm' | 'backup' | 'haversine';
}

type StatusListener = (info: RoutingProviderStatusInfo) => void;

class RoutingProviderService {
  private static instance: RoutingProviderService;

  // Primary & Backup Endpoints
  private readonly primaryEndpoint = 'https://router.project-osrm.org/route/v1/driving/';
  private readonly backupEndpoint = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';
  
  // Cache for route geometry & nav details
  private navCache = new Map<string, RouteNavDetails>();
  private readonly MAX_CACHE_ENTRIES = 500;

  // Provider Health & Status
  private currentStatus: RoutingProviderStatus = 'osrm_active';
  private consecutiveErrors = 0;
  private totalRequests = 0;
  private roadRequestsSuccess = 0;
  private fallbackRequestsCount = 0;
  private activeEndpointName = 'OSRM (Project OSRM)';
  private statusListeners = new Set<StatusListener>();

  // Concurrency Queue to prevent 429 Too Many Requests
  private activeRequests = 0;
  private readonly MAX_CONCURRENT = 3;
  private queue: (() => void)[] = [];

  private constructor() {
    this.loadCacheFromStorage();
  }

  public static getInstance(): RoutingProviderService {
    if (!RoutingProviderService.instance) {
      RoutingProviderService.instance = new RoutingProviderService();
    }
    return RoutingProviderService.instance;
  }

  private loadCacheFromStorage() {
    try {
      const stored = localStorage.getItem('routing_nav_cache_v2');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          parsed.forEach(([k, v]) => {
            this.navCache.set(k, v);
          });
        }
      }
    } catch {
      // Storage unavailable or quota exceeded; fallback to in-memory only
    }
  }

  private persistCacheDebounced = (() => {
    let timer: any = null;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const entries = Array.from(this.navCache.entries()).slice(-150); // Keep last 150 in local storage
          localStorage.setItem('routing_nav_cache_v2', JSON.stringify(entries));
        } catch {
          // ignore quota error
        }
      }, 3000);
    };
  })();

  public clearCache() {
    this.navCache.clear();
    try {
      localStorage.removeItem('routing_nav_cache_v2');
    } catch {
      // ignore
    }
  }

  public getCacheSize(): number {
    return this.navCache.size;
  }

  public subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => this.statusListeners.delete(listener);
  }

  private notifyStatus() {
    const info = this.getStatus();
    this.statusListeners.forEach(listener => {
      try {
        listener(info);
      } catch {
        // ignore subscriber errors
      }
    });
  }

  public getStatus(): RoutingProviderStatusInfo {
    let label = 'OSRM — работает';
    let description = 'Дорожные маршруты строятся через основной OSRM сервер.';

    switch (this.currentStatus) {
      case 'osrm_active':
        label = 'OSRM — работает';
        description = 'Основной сервер дорожной маршрутизации OSRM доступен.';
        break;
      case 'backup_active':
        label = 'Резервный маршрутизатор — работает';
        description = 'Основной OSRM недоступен. Используется резервный OpenStreetMap сервер.';
        break;
      case 'fallback_haversine':
        label = 'Прямой расчет (Haversine)';
        description = 'Сервис дорожной маршрутизации временно недоступен. Используется расчетное расстояние по прямой.';
        break;
      case 'unavailable':
        label = 'Маршрутизация недоступна';
        description = 'Сбой сети или маршрутизатора. Используется аварийный расчет.';
        break;
    }

    return {
      status: this.currentStatus,
      label,
      description,
      activeEndpointName: this.activeEndpointName,
      lastChecked: Date.now(),
      consecutiveErrors: this.consecutiveErrors,
      totalRequests: this.totalRequests,
      roadRequestsSuccess: this.roadRequestsSuccess,
      fallbackRequestsCount: this.fallbackRequestsCount
    };
  }

  private setStatus(status: RoutingProviderStatus, endpointName: string) {
    if (this.currentStatus !== status || this.activeEndpointName !== endpointName) {
      this.currentStatus = status;
      this.activeEndpointName = endpointName;
      this.notifyStatus();
    }
  }

  // Concurrency Gate
  private async acquireSlot(): Promise<() => void> {
    if (this.activeRequests < this.MAX_CONCURRENT) {
      this.activeRequests++;
      return () => this.releaseSlot();
    }

    return new Promise(resolve => {
      this.queue.push(() => {
        this.activeRequests++;
        resolve(() => this.releaseSlot());
      });
    });
  }

  private releaseSlot() {
    this.activeRequests--;
    if (this.queue.length > 0 && this.activeRequests < this.MAX_CONCURRENT) {
      const next = this.queue.shift();
      if (next) next();
    }
  }

  // Low-level fetcher with timeout and abort
  private async fetchOsrmRoute(
    endpoint: string,
    coordsParam: string,
    timeoutMs: number = 6000
  ): Promise<{ coordinates: [number, number][]; distanceMeters: number; durationSeconds: number } | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `${endpoint}${coordsParam}?overview=full&geometries=geojson`;
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) return null;
      const data = await response.json();
      if (data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
        const route = data.routes[0];
        const coordinates = route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
        return {
          coordinates,
          distanceMeters: route.distance || 0,
          durationSeconds: route.duration || 0
        };
      }
    } catch {
      clearTimeout(timeoutId);
    }
    return null;
  }

  // Fetch road navigation for a single chunk of points (<= 15 points)
  private async fetchChunkWithFallbacks(
    points: { lat: number; lng: number }[]
  ): Promise<{
    coordinates: [number, number][];
    distanceMeters: number;
    durationSeconds: number;
    isRealRoad: boolean;
    providerUsed: 'osrm' | 'backup' | 'haversine';
  }> {
    if (points.length < 2) {
      return {
        coordinates: points.map(p => [p.lat, p.lng]),
        distanceMeters: 0,
        durationSeconds: 0,
        isRealRoad: false,
        providerUsed: 'haversine'
      };
    }

    this.totalRequests++;
    const coordsParam = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');

    // 1. Attempt Primary OSRM Endpoint
    const release1 = await this.acquireSlot();
    let primaryRes = null;
    try {
      primaryRes = await this.fetchOsrmRoute(this.primaryEndpoint, coordsParam, 5500);
    } finally {
      release1();
    }

    if (primaryRes) {
      this.consecutiveErrors = 0;
      this.roadRequestsSuccess++;
      this.setStatus('osrm_active', 'OSRM (Project OSRM)');
      return {
        ...primaryRes,
        isRealRoad: true,
        providerUsed: 'osrm'
      };
    }

    // 2. Attempt Backup OpenStreetMap Router
    await new Promise(r => setTimeout(r, 120));
    const release2 = await this.acquireSlot();
    let backupRes = null;
    try {
      backupRes = await this.fetchOsrmRoute(this.backupEndpoint, coordsParam, 6500);
    } finally {
      release2();
    }

    if (backupRes) {
      this.consecutiveErrors = 0;
      this.roadRequestsSuccess++;
      this.setStatus('backup_active', 'OpenStreetMap DE (Резервный)');
      return {
        ...backupRes,
        isRealRoad: true,
        providerUsed: 'backup'
      };
    }

    // 3. Retry Primary OSRM once with backoff if network blip
    await new Promise(r => setTimeout(r, 250));
    const release3 = await this.acquireSlot();
    let retryRes = null;
    try {
      retryRes = await this.fetchOsrmRoute(this.primaryEndpoint, coordsParam, 6000);
    } finally {
      release3();
    }

    if (retryRes) {
      this.consecutiveErrors = 0;
      this.roadRequestsSuccess++;
      this.setStatus('osrm_active', 'OSRM (Project OSRM)');
      return {
        ...retryRes,
        isRealRoad: true,
        providerUsed: 'osrm'
      };
    }

    // 4. If chunk has > 2 points, break down pairwise to attempt real road on subsegments
    if (points.length > 2) {
      const combinedCoords: [number, number][] = [];
      let combinedDist = 0;
      let combinedDuration = 0;
      let anyRoad = false;

      for (let i = 0; i < points.length - 1; i++) {
        const pair = [points[i], points[i + 1]];
        const pairRes = await this.fetchChunkWithFallbacks(pair);
        if (pairRes.isRealRoad) anyRoad = true;
        combinedDist += pairRes.distanceMeters;
        combinedDuration += pairRes.durationSeconds;

        if (combinedCoords.length === 0) {
          combinedCoords.push(...pairRes.coordinates);
        } else {
          combinedCoords.push(...pairRes.coordinates.slice(1));
        }
      }

      return {
        coordinates: combinedCoords,
        distanceMeters: combinedDist,
        durationSeconds: combinedDuration,
        isRealRoad: anyRoad,
        providerUsed: anyRoad ? 'osrm' : 'haversine'
      };
    }

    // 5. Ultimate Fallback: Haversine straight line distance
    this.consecutiveErrors++;
    this.fallbackRequestsCount++;
    if (this.consecutiveErrors >= 3) {
      this.setStatus('fallback_haversine', 'Haversine Direct Fallback');
    }

    let straightDistMeters = 0;
    for (let i = 0; i < points.length - 1; i++) {
      straightDistMeters += calculateDistance(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) * 1000;
    }

    // Road factor estimate for Haversine ~ 1.25x for driving duration estimate
    const estimatedDrivingDurationSec = Math.round((straightDistMeters / 1000) * 1.6 * 60);

    return {
      coordinates: points.map(p => [p.lat, p.lng]),
      distanceMeters: straightDistMeters,
      durationSeconds: estimatedDrivingDurationSec,
      isRealRoad: false,
      providerUsed: 'haversine'
    };
  }

  /**
   * Main unified method to retrieve full road navigation details
   */
  public async getRouteNavDetails(points: { lat: number; lng: number }[]): Promise<RouteNavDetails> {
    if (!points || points.length < 2) {
      return {
        geometry: [],
        distanceKm: 0,
        durationMinutes: 0,
        isRealRoad: false,
        isFallback: true,
        providerUsed: 'haversine',
        summary: 'Недостаточно точек'
      };
    }

    // Unique cache key
    const cacheKey = points.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
    const cached = this.navCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const CHUNK_SIZE = 12; // Maximum waypoints per OSRM query
    let finalGeometry: [number, number][] = [];
    let totalDistMeters = 0;
    let totalDurationSec = 0;
    let anyRealRoad = false;
    let lastProvider: 'osrm' | 'backup' | 'haversine' = 'osrm';

    if (points.length <= CHUNK_SIZE) {
      const res = await this.fetchChunkWithFallbacks(points);
      finalGeometry = res.coordinates;
      totalDistMeters = res.distanceMeters;
      totalDurationSec = res.durationSeconds;
      anyRealRoad = res.isRealRoad;
      lastProvider = res.providerUsed;
    } else {
      // Overlapping sliding windows: [0..11], [11..22], ...
      for (let i = 0; i < points.length - 1; i += (CHUNK_SIZE - 1)) {
        const slice = points.slice(i, Math.min(points.length, i + CHUNK_SIZE));
        const res = await this.fetchChunkWithFallbacks(slice);
        if (res.isRealRoad) anyRealRoad = true;
        totalDistMeters += res.distanceMeters;
        totalDurationSec += res.durationSeconds;
        lastProvider = res.providerUsed;

        if (finalGeometry.length === 0) {
          finalGeometry.push(...res.coordinates);
        } else {
          finalGeometry.push(...res.coordinates.slice(1));
        }

        // Friendly interval between chunks
        await new Promise(r => setTimeout(r, 60));
      }
    }

    const distanceKm = Math.round((totalDistMeters / 1000) * 10) / 10;
    const durationMinutes = Math.round(totalDurationSec / 60);

    const result: RouteNavDetails = {
      geometry: finalGeometry,
      distanceKm,
      durationMinutes,
      isRealRoad: anyRealRoad,
      isFallback: !anyRealRoad,
      providerUsed: anyRealRoad ? lastProvider : 'haversine',
      summary: anyRealRoad 
        ? `${distanceKm} км по дорогам (~${durationMinutes} мин)`
        : `${distanceKm} км по прямой (Haversine fallback)`
    };

    // Store in cache
    this.navCache.set(cacheKey, result);
    if (this.navCache.size > this.MAX_CACHE_ENTRIES) {
      const first = this.navCache.keys().next().value;
      if (first) this.navCache.delete(first);
    }
    this.persistCacheDebounced();

    return result;
  }

  /**
   * Fast Pairwise Road Distance & Duration
   */
  public async getPairDistance(
    p1: { lat: number; lng: number },
    p2: { lat: number; lng: number }
  ): Promise<PairDistanceResult> {
    const nav = await this.getRouteNavDetails([p1, p2]);
    return {
      distanceKm: nav.distanceKm,
      durationMinutes: nav.durationMinutes || Math.round(nav.distanceKm * 1.5),
      isRealRoad: nav.isRealRoad,
      isFallback: nav.isFallback,
      providerUsed: nav.providerUsed
    };
  }
}

export const routingProvider = RoutingProviderService.getInstance();
