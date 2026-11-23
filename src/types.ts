export interface TruckType {
  id: string;
  name: string;
  maxWeight: number;
  maxVolume: number;
  rank: number; // Higher rank means bigger truck
}

export interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  code: string;
  weight: number;
  volume: number;
  region: string;
  satir: number;
  days: number[]; // Array of days (1-7)
  timeSlot: string;
  shippingDate?: string;
  distance?: number;
  lat: number;
  lng: number;
  routeId?: string;
  isImportedRoute?: boolean;
  status: 'in-route' | 'not-in-route';
  allowedTruckType?: string; // ID of the truck type
  warehouseType?: string; // Тип склада
  isLocked?: boolean; // Manual lock to current route
  lockedRouteId?: string;
}

export interface Store {
  name: string;
  orders: Order[];
  totalWeight: number;
  totalVolume: number;
  totalSatir: number;
  orderCount: number;
  region: string;
  days: number[];
  timeSlots: string[];
  shippingDates: string[];
  lat: number;
  lng: number;
  focusTrigger?: number;
  warehouseTypes?: string[];
  warehouseType?: string;
}

export interface Zone {
  id: string;
  name: string;
  polygon: [number, number][]; // Array of [lat, lng]
  color: string;
  isVisible: boolean;
  orderIds: string[];
}

export type RoutingSource = 'OSRM' | 'BACKUP' | 'HAVERSINE' | 'AI_GEMINI';

export interface Route {
  id: string;
  name: string;
  color: string;
  orderIds: string[];
  isVisible: boolean;
  distance: number; // Backward-compatible display distance (roadDistanceKm ?? straightDistanceKm)
  straightDistanceKm?: number; // Haversine / straight-line calculated distance in km
  roadDistanceKm?: number; // True road network distance from OSRM in km (undefined if unavailable/fallback)
  roadDurationMin?: number; // True road travel time in minutes from OSRM
  routingSource?: RoutingSource; // Source of distance calculation
  isImported?: boolean;
  geometry?: [number, number][];
  truckTypeId?: string;
  isRealRoad?: boolean;
  durationMinutes?: number;
  drivingDurationMin?: number;
  waitingDurationMin?: number;
  serviceDurationMin?: number;
  totalDurationMin?: number;
  isLocked?: boolean;
  qualityScore?: number; // 0..100
  qualityBreakdown?: {
    geography: number;
    volume: number;
    distance: number;
    duration: number;
    timeWindows: number;
    balance: number;
  };
  whyThisRoute?: string;
  costBreakdown?: {
    fuelCost: number;
    driverCost: number;
    vehicleCost: number;
    tollCost: number;
    totalCost: number;
  };
  isInefficient?: boolean;
  inefficientReason?: string;
  description?: string;
  aiExplanation?: string;
}

export interface StreetGroup {
  id: string;
  name: string;
  color: string;
  createdAt?: string;
  isCollapsed?: boolean;
  thickness?: number;
  opacity?: number;
}

export interface StreetHighlight {
  id: string;
  name: string;
  color: string;
  groupId?: string;
  geoJson?: any;
  coordinates?: [number, number][];
  multiCoordinates?: [number, number][][];
  orderIds?: string[];
  source?: 'name' | 'click' | 'brush';
  createdAt?: string;
  brushRadius?: number;
  isVisible?: boolean;
  thickness?: number;
  opacity?: number;
}

export interface RouteVersion {
  id: string;
  name: string;
  routes: Route[];
  orders: Order[];
  createdAt: string;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  truckTypeName: string;
  licensePlate: string;
  status: 'active' | 'on-shift' | 'off-duty' | 'vacation';
  rating: number;
  shiftsCount: number;
}

export interface Shift {
  id: string;
  driverId: string;
  date: string; // YYYY-MM-DD
  type: 'morning' | 'evening' | 'full-day' | 'off-duty';
  routeId?: string;
}

export type StoreMarkerLabelOption = 'code' | 'name' | 'volume' | 'weight' | 'items';
export type StoreMarkerLabelMode = StoreMarkerLabelOption[];
