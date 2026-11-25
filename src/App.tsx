import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, ScatterChart, Scatter
} from 'recharts';
import { 
  Upload, Search, Plus, Trash2, Eye, EyeOff, Edit2, Download, 
  Sun, Moon, Filter, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, X, MapPin, Package, Users, 
  Layers, Navigation, Info, Play, FileSpreadsheet, MousePointer2, BarChart2, Save, Truck, TrendingUp, AlertTriangle, Maximize2, Clock, Check, Wand2, ArrowRight,
  Settings, HelpCircle, LayoutDashboard, Calendar, CheckSquare, Square, Sliders, History, Activity, Sparkles, RefreshCw, RotateCcw,
  ShieldCheck, CheckCircle2, AlertOctagon, Tag, Store as StoreIcon, Building2, Smartphone, Construction
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { Order, Route, StreetHighlight, StreetGroup, Store, RouteVersion, TruckType, Zone, StoreMarkerLabelMode, StoreMarkerLabelOption, RoadBarrier, StoreRecord } from './types';
import { useCloudSync } from './hooks/useCloudSync';
import { CloudSyncButton } from './components/common/CloudSyncButton';
import { BarriersPanel } from './components/barriers/BarriersPanel';
import { setRoadBarriers, getBarrierHash, getActiveBarriers, anyBarrierTouchesPath } from './services/barriers/barrierStore';
import { valhallaLocate } from './services/barriers/valhallaClient';
import { buildStoreLookup } from './services/storeDirectory';
import { roadCache } from './services/cloud/roadCache';
import { buildRouteInsights } from './services/routeInsights';
import { assignFleetToRoutes } from './services/optimizer/FleetAssignment';
import { orderInsights, RouteListFilter, RouteListSort } from './components/routes/RouteViewParts';
import { RouteFocusPanel } from './components/routes/RouteFocusPanel';
import { RouteSummaryTable } from './components/routes/RouteSummaryTable';
import { AlgorithmSelector } from './components/AlgorithmSelector';
import { BulkActionsMenu } from './components/BulkActionsMenu';
import { RouterModal } from './components/RouterModal';
import { MOCK_ORDERS, WAREHOUSE_LOCATION } from './mockData';
import { 
  runSavings, runSweep, runCluster, runGenetic, runTabu, 
  runLocalSearch, runVNS, runILS, runACO, runPSO, runBCO, runLNS,
  runTabuSearch, runGeneticAlgorithm, runClarkeWrightSavings, runPartitioned,
  calculateDistance, RoutingLimits, ProgressUpdate, getRouteGeometry, getRouteNavDetails,
  optimizeRoute2Opt, optimizeRouteNearestNeighbor, optimizeRouteGreedy, getRouteTotalDistance, getDistanceMatrix
} from './services/routingService';
import { exportRoutesToPdf } from './services/pdfExportService';
import { RouteHistoryPanel } from './components/RouteHistoryPanel';
import { VersionCompareModal } from './components/VersionCompareModal';
import { EnhancedKpiView } from './components/EnhancedKpiView';
import { OptimizationDiffModal } from './components/OptimizationDiffModal';
import { routeHistoryService, RouteHistoryEntry } from './services/routeHistoryService';

// Modular Components
import { RoutesManagementPanel } from './components/routes/RoutesManagementPanel';
import { RouteDetailsModal } from './components/routes/RouteDetailsModal';
import { OptimizationModal } from './components/routes/OptimizationModal';
import { RouteValidationModal } from './components/routes/RouteValidationModal';
import { ConstraintsModal } from './components/routes/ConstraintsModal';
import { FullAnalyticsModal } from './components/analytics/FullAnalyticsModal';
import { AnalyticsPanel } from './components/analytics/AnalyticsPanel';
import { ScenariosPanel } from './components/scenarios/ScenariosPanel';
import { WhatIfModal } from './components/scenarios/WhatIfModal';
import { HelpModal } from './components/help/HelpModal';
import { StoreCard } from './components/orders/StoreCard';
import { DropdownFilter, FilterItem, StatBlock, DataValue } from './components/orders/OrderFilterComponents';
import { ExcelMappingModal, REQUIRED_FIELDS } from './components/excel/ExcelMappingModal';
import { MapView } from './components/map/MapView';
import { StreetHighlightPanel } from './components/streets/StreetHighlightPanel';
import { LanguageSelector } from './components/common/LanguageSelector';
import { AndroidMobileLayout } from './components/mobile/AndroidMobileLayout';
import { AndroidDeviceFrame } from './components/mobile/AndroidDeviceFrame';
import { useTranslation } from './i18n/I18nContext';
import { ensureRotaLoaded, rotaStore, useRotaWorkspace } from './rota/store/workspace';
import { applyIncoming, directoryStore, findConflicts, findRecord, IncomingStore, useDirectory } from './directory/directory';
import { askDirectoryConflicts, DirectoryConflictHost } from './directory/ConflictDialog';
import { DirectoryPage } from './directory/DirectoryPage';

// The Rota planning module is loaded only when its page is opened
const RotaModule = React.lazy(() => import('./rota/RotaModule'));
const ForecastPage = React.lazy(() => import('./forecast/ForecastPage'));
import { 
  getStreetByClick, 
  findOrdersInBrush, 
  createStreetFromBrush,
  POPULAR_BAKU_STREETS 
} from './services/streetService';

// Services
import { validateRoutePlan } from './services/routeValidator';
import { applyNavDetailsToRoute, getRouteDistanceInfo, calculateStraightRouteDistance, calculateRouteLegs } from './services/distanceHelper';

// --- Utils ---
const roundUp = (val: number | string | undefined | null): string => {
  if (val === undefined || val === null || val === '') return '0.0';
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
  if (isNaN(n)) return '0.0';
  return (Math.round(n * 10) / 10).toFixed(1);
};

const formatDec1 = (val: number | string | undefined | null): string => {
  if (val === undefined || val === null || val === '') return '0.0';
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
  if (isNaN(n)) return '0.0';
  return (Math.round(n * 10) / 10).toFixed(1);
};

/**
 * Robust numeric parser for Excel data imports.
 * Handles strings with commas, spaces, currency symbols, European vs US notation, etc.
 */
const parseExcelNumber = (val: any, fallback = 0): number => {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'number') return isNaN(val) ? fallback : val;
  let str = String(val).trim();
  if (str === '' || str === '-' || str.toLowerCase() === 'nan' || str.toLowerCase() === 'null') return fallback;
  // Strip non-breaking spaces and whitespace
  str = str.replace(/[\s\u00A0]/g, '');
  // If both comma and dot exist (e.g. 1,234.56 or 1.234,56)
  if (str.includes(',') && str.includes('.')) {
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      // European format: 1.234,56 -> 1234.56
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 1,234.56 -> 1234.56
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    // Single comma is decimal separator: 12,5 -> 12.5
    str = str.replace(',', '.');
  }
  // Remove non-numeric characters except leading minus and decimal dot
  str = str.replace(/[^0-9.-]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? fallback : Math.round(num * 1000) / 1000;
};

const isPointInPolygon = (point: [number, number], polygon: [number, number][]) => {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// Robust date string normalizer to DD.MM.YYYY
const normalizeDateStr = (val: any): string => {
  if (val === null || val === undefined) return '';
  // If Date object
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    return `${String(val.getDate()).padStart(2, '0')}.${String(val.getMonth() + 1).padStart(2, '0')}.${val.getFullYear()}`;
  }
  // If Excel serial number
  if (typeof val === 'number' && val > 20000 && val < 60000) {
    try {
      const date = new Date(Math.round((val - 25569) * 86400 * 1000));
      if (!isNaN(date.getTime())) {
        return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}`;
      }
    } catch (e) {}
  }
  const str = String(val).trim();
  if (!str || str === '-' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') return '';

  // Numeric string Excel serial (e.g., "45480")
  if (/^\d{5}$/.test(str)) {
    const num = Number(str);
    if (num > 20000 && num < 60000) {
      try {
        const date = new Date(Math.round((num - 25569) * 86400 * 1000));
        if (!isNaN(date.getTime())) {
          return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}`;
        }
      } catch (e) {}
    }
  }

  // DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY (with optional time)
  const dmy = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (dmy) {
    const day = String(parseInt(dmy[1], 10)).padStart(2, '0');
    const month = String(parseInt(dmy[2], 10)).padStart(2, '0');
    const year = dmy[3];
    return `${day}.${month}.${year}`;
  }

  // YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD (with optional time)
  const ymd = str.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (ymd) {
    const year = ymd[1];
    const month = String(parseInt(ymd[2], 10)).padStart(2, '0');
    const day = String(parseInt(ymd[3], 10)).padStart(2, '0');
    return `${day}.${month}.${year}`;
  }

  // Fallback native Date parse
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return `${String(parsed.getDate()).padStart(2, '0')}.${String(parsed.getMonth() + 1).padStart(2, '0')}.${parsed.getFullYear()}`;
    }
  } catch (e) {}

  return str;
};

// Robust date parser returning start-of-day Date object
const parseOrderDate = (dateStr: string | undefined | null): Date | null => {
  if (!dateStr) return null;
  const norm = normalizeDateStr(dateStr);
  if (!norm) return null;
  const dmy = norm.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10) - 1;
    const year = parseInt(dmy[3], 10);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

// --- Components ---

const Card = ({ children, className, id, onClick, onMouseEnter, onMouseLeave }: { 
  children: React.ReactNode, 
  className?: string, 
  id?: string, 
  onClick?: () => void,
  onMouseEnter?: () => void,
  onMouseLeave?: () => void
}) => (
  <div 
    id={id} 
    className={cn("bg-card text-card-foreground rounded-xl border shadow-sm overflow-hidden", className)} 
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
  >
    {children}
  </div>
);

const Button = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  className, 
  onClick,
  id,
  disabled,
  title
}: { 
  children: React.ReactNode, 
  variant?: 'primary' | 'outline' | 'ghost' | 'destructive', 
  size?: 'sm' | 'md' | 'lg' | 'icon',
  className?: string,
  onClick?: (e: any) => void,
  id?: string,
  disabled?: boolean,
  title?: string
}) => {
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90"
  };
  const sizes = {
    sm: "h-8 px-3 text-xs",
    md: "h-10 px-4 py-2",
    lg: "h-12 px-8",
    icon: "h-8 w-8 p-0"
  };
  return (
    <button 
      id={id}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </button>
  );
};

const Badge = ({ children, className, onRemove }: { children: React.ReactNode, className?: string, onRemove?: () => void }) => (
  <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium", className)}>
    {children}
    {onRemove && (
      <button onClick={onRemove} className="hover:opacity-70">
        <X size={10} />
      </button>
    )}
  </span>
);

const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input 
    className={cn(
      "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
);

const Select = ({ children, className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select 
    className={cn(
      "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    {children}
  </select>
);

// --- Main App ---

const DEFAULT_TRUCK_TYPES: TruckType[] = [
  { id: 'truck-1', name: 'Газель 1.5т', maxWeight: 1500, maxVolume: 10, rank: 1 },
  { id: 'truck-2', name: 'Фургон 3.0т', maxWeight: 3000, maxVolume: 18, rank: 2 },
  { id: 'truck-3', name: 'Грузовик 5.0т', maxWeight: 5000, maxVolume: 30, rank: 3 }
];

export type LeftPanelTab = 'stores' | 'routes' | 'history' | 'analytics' | 'streets' | 'barriers' | 'scenarios';

/**
 * Sanitizes routes before serializing to localStorage.
 * Road geometry arrays can have thousands of lat/lng coordinate pairs per route, easily exceeding
 * the 5MB browser quota limit. We strip the heavy road geometries on disk since they are automatically
 * calculated on demand, while keeping distances, durations, stop sequences, and road flags.
 */
function sanitizeRoutesForStorage(routesToSave: Route[]): Route[] {
  return routesToSave.map(r => {
    const { geometry, ...rest } = r;
    return rest as Route;
  });
}

function safeSetStorageItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    // If quota exceeded, clean up non-essential caches
    try {
      localStorage.removeItem('routing_matrix_cache_v2');
      localStorage.removeItem('routing_nav_cache_v2');
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

export default function App() {
  const { t, language } = useTranslation();
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [orders, setOrders] = useState<Order[]>(() => {
    try {
      const saved = localStorage.getItem('autosave_orders_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return MOCK_ORDERS;
  });

  const [routes, setRoutes] = useState<Route[]>(() => {
    try {
      const saved = localStorage.getItem('autosave_routes_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return [];
  });

  const [lastAutosaveTime, setLastAutosaveTime] = useState<string | null>(() => {
    try {
      return localStorage.getItem('autosave_timestamp_v1') || null;
    } catch {
      return null;
    }
  });
  const [isAutosaving, setIsAutosaving] = useState(false);

  // Latest state for the autosave timer (the interval must not be reset on every change,
  // otherwise it never fires while the user keeps editing)
  const autosaveStateRef = useRef({ orders, routes });
  autosaveStateRef.current = { orders, routes };

  // Autosave orders and routes state every 30 seconds for protection against accidental tab closure
  useEffect(() => {
    const saveStateToStorage = () => {
      try {
        const { orders, routes } = autosaveStateRef.current;
        const sanitizedRoutes = sanitizeRoutesForStorage(routes);
        safeSetStorageItem('autosave_orders_v1', JSON.stringify(orders));
        safeSetStorageItem('autosave_routes_v1', JSON.stringify(sanitizedRoutes));
        const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        safeSetStorageItem('autosave_timestamp_v1', nowStr);
        setLastAutosaveTime(nowStr);
        setIsAutosaving(true);
        setTimeout(() => setIsAutosaving(false), 2000);
      } catch {
        // ignore storage errors
      }
    };

    // Save every 30 seconds
    const interval = setInterval(saveStateToStorage, 30000);

    // Save beforeunload to guarantee persistence when tab is closed
    const handleBeforeUnload = () => {
      try {
        const { orders, routes } = autosaveStateRef.current;
        const sanitizedRoutes = sanitizeRoutesForStorage(routes);
        safeSetStorageItem('autosave_orders_v1', JSON.stringify(orders));
        safeSetStorageItem('autosave_routes_v1', JSON.stringify(sanitizedRoutes));
        safeSetStorageItem('autosave_timestamp_v1', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } catch {}
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Global Ctrl+Z / Cmd+Z Undo hotkey
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const activeTag = (document.activeElement?.tagName || '').toLowerCase();
        if (activeTag === 'input' || activeTag === 'textarea') {
          return;
        }
        e.preventDefault();
        const undoData = routeHistoryService.popUndoSnapshot();
        if (undoData) {
          setRoutes(undoData.routes);
          setOrders(undoData.orders);
          setSaveNotification(`Откат действия: "${undoData.entryTitle}"`);
          setTimeout(() => setSaveNotification(null), 3000);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [isWhatIfOpen, setIsWhatIfOpen] = useState(false);
  const [isConstraintsOpen, setIsConstraintsOpen] = useState(false);
  const [streetHighlights, setStreetHighlights] = useState<StreetHighlight[]>(() => {
    try {
      const saved = localStorage.getItem('streetHighlights');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [streetGroups, setStreetGroups] = useState<StreetGroup[]>(() => {
    try {
      const saved = localStorage.getItem('streetGroups');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [streetLineWidth, setStreetLineWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('streetLineWidth');
      return saved ? Number(saved) : 6;
    } catch {
      return 6;
    }
  });

  const [streetLineOpacity, setStreetLineOpacity] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('streetLineOpacity');
      return saved ? Number(saved) : 0.9;
    } catch {
      return 0.9;
    }
  });

  useEffect(() => {
    safeSetStorageItem('streetHighlights', JSON.stringify(streetHighlights));
  }, [streetHighlights]);

  useEffect(() => {
    safeSetStorageItem('streetGroups', JSON.stringify(streetGroups));
  }, [streetGroups]);

  useEffect(() => {
    safeSetStorageItem('streetLineWidth', String(streetLineWidth));
  }, [streetLineWidth]);

  useEffect(() => {
    safeSetStorageItem('streetLineOpacity', String(streetLineOpacity));
  }, [streetLineOpacity]);

  // Street Selection Modes & Brush States (3 способа выделения улиц)
  const [activeStreetMode, setActiveStreetMode] = useState<'name' | 'click' | 'brush' | null>(null);
  const [brushRadiusMeters, setBrushRadiusMeters] = useState<number>(80);
  const [currentBrushTrail, setCurrentBrushTrail] = useState<[number, number][]>([]);
  const [currentBrushOrderIds, setCurrentBrushOrderIds] = useState<string[]>([]);
  const [isClickingStreetLoading, setIsClickingStreetLoading] = useState<boolean>(false);
  const [newStreetName, setNewStreetName] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  
  // Filters
  const [rangeType, setRangeType] = useState<'volume' | 'weight' | 'satir'>('volume');
  const [rangeValues, setRangeValues] = useState({ min: '', max: '' });
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedTimes, setSelectedTimes] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedTruckTypes, setSelectedTruckTypes] = useState<string[]>([]);
  const [selectedShippingDates, setSelectedShippingDates] = useState<string[]>([]);
  const [selectedWarehouseTypes, setSelectedWarehouseTypes] = useState<string[]>([]);
  const [quickDateFilter, setQuickDateFilter] = useState<'all' | 'today' | 'tomorrow' | 'next7' | null>(null);
  const [selectedRouteDateFilter, setSelectedRouteDateFilter] = useState<string>('all');
  
  // Date calculation helpers for quick date toggle
  const todayDateObj = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  const tomorrowDateObj = useMemo(() => {
    return new Date(todayDateObj.getTime() + 24 * 60 * 60 * 1000);
  }, [todayDateObj]);

  const next7DaysEndDateObj = useMemo(() => {
    return new Date(todayDateObj.getTime() + 8 * 24 * 60 * 60 * 1000);
  }, [todayDateObj]);

  // Find all distinct normalized date strings present in orders (sorted chronologically)
  const allOrderShippingDates = useMemo(() => {
    const dates = new Set<string>();
    (orders || []).forEach(o => {
      const norm = normalizeDateStr(o.shippingDate);
      if (norm) dates.add(norm);
    });
    return Array.from(dates).sort((a, b) => {
      const dateA = parseOrderDate(a);
      const dateB = parseOrderDate(b);
      if (dateA && dateB) return dateA.getTime() - dateB.getTime();
      return a.localeCompare(b);
    });
  }, [orders]);

  const todayMatchingDates = useMemo(() => {
    return allOrderShippingDates.filter(d => {
      const parsed = parseOrderDate(d);
      if (!parsed) return false;
      return parsed.getTime() === todayDateObj.getTime();
    });
  }, [allOrderShippingDates, todayDateObj]);

  const tomorrowMatchingDates = useMemo(() => {
    return allOrderShippingDates.filter(d => {
      const parsed = parseOrderDate(d);
      if (!parsed) return false;
      return parsed.getTime() === tomorrowDateObj.getTime();
    });
  }, [allOrderShippingDates, tomorrowDateObj]);

  const next7MatchingDates = useMemo(() => {
    return allOrderShippingDates.filter(d => {
      const parsed = parseOrderDate(d);
      if (!parsed) return false;
      return parsed >= todayDateObj && parsed < next7DaysEndDateObj;
    });
  }, [allOrderShippingDates, todayDateObj, next7DaysEndDateObj]);

  const quickDateCounts = useMemo(() => {
    const todayCount = orders.filter(o => {
      const d = normalizeDateStr(o.shippingDate);
      return d && todayMatchingDates.includes(d);
    }).length;
    const tomorrowCount = orders.filter(o => {
      const d = normalizeDateStr(o.shippingDate);
      return d && tomorrowMatchingDates.includes(d);
    }).length;
    const next7Count = orders.filter(o => {
      const d = normalizeDateStr(o.shippingDate);
      return d && next7MatchingDates.includes(d);
    }).length;
    return { today: todayCount, tomorrow: tomorrowCount, next7: next7Count };
  }, [orders, todayMatchingDates, tomorrowMatchingDates, next7MatchingDates]);

  const handleQuickDateSelect = (type: 'all' | 'today' | 'tomorrow' | 'next7') => {
    if (type === 'all') {
      setQuickDateFilter('all');
      setSelectedShippingDates([]);
      setSelectedRouteDateFilter('all');
      return;
    }

    if (quickDateFilter === type) {
      setQuickDateFilter('all');
      setSelectedShippingDates([]);
      setSelectedRouteDateFilter('all');
    } else {
      setQuickDateFilter(type);
      if (type === 'today') {
        const matching = todayMatchingDates.length > 0 ? todayMatchingDates : [
          `${String(todayDateObj.getDate()).padStart(2, '0')}.${String(todayDateObj.getMonth() + 1).padStart(2, '0')}.${todayDateObj.getFullYear()}`
        ];
        setSelectedShippingDates(matching);
        setSelectedRouteDateFilter(matching[0] || 'all');
      } else if (type === 'tomorrow') {
        const matching = tomorrowMatchingDates.length > 0 ? tomorrowMatchingDates : [
          `${String(tomorrowDateObj.getDate()).padStart(2, '0')}.${String(tomorrowDateObj.getMonth() + 1).padStart(2, '0')}.${tomorrowDateObj.getFullYear()}`
        ];
        setSelectedShippingDates(matching);
        setSelectedRouteDateFilter(matching[0] || 'all');
      } else if (type === 'next7') {
        setSelectedShippingDates(next7MatchingDates.length > 0 ? next7MatchingDates : allOrderShippingDates);
        setSelectedRouteDateFilter('all');
      }
    }
  };

  const handleSelectRouteDateFilter = (date: string) => {
    if (date === 'all') {
      setSelectedRouteDateFilter('all');
      setSelectedShippingDates([]);
      setQuickDateFilter('all');
    } else {
      const normDate = normalizeDateStr(date) || date;
      setSelectedRouteDateFilter(normDate);
      setSelectedShippingDates([normDate]);
      if (todayMatchingDates.includes(normDate)) {
        setQuickDateFilter('today');
      } else if (tomorrowMatchingDates.includes(normDate)) {
        setQuickDateFilter('tomorrow');
      } else if (next7MatchingDates.includes(normDate)) {
        setQuickDateFilter('next7');
      } else {
        setQuickDateFilter(null);
      }
    }
  };
  
  const [focusedStore, setFocusedStore] = useState<Store | null>(null);
  const [storeMarkerLabelMode, setStoreMarkerLabelMode] = useState<StoreMarkerLabelMode>(['volume']);
  const [isStatsCardOpen, setIsStatsCardOpen] = useState(false);
  const [isFiltersCardOpen, setIsFiltersCardOpen] = useState(false);
  const [selectedRouteDetails, setSelectedRouteDetails] = useState<Route | null>(null);
  const [selectedRouteForOptimization, setSelectedRouteForOptimization] = useState<Route | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null);
  
  // Panel states
  const [leftWidth, setLeftWidth] = useState(() => {
    try {
      if (typeof window !== 'undefined') {
        return Math.min(360, Math.max(290, Math.round(window.innerWidth * 0.24)));
      }
    } catch {
      // ignore
    }
    return 330;
  });
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isRouterModalOpen, setIsRouterModalOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  // Dropdown states
  const [openDropdown, setOpenDropdown] = useState<'day' | 'region' | 'time' | 'status' | 'truck' | 'shippingDate' | 'warehouseType' | null>(null);

  // Routing states
  const [routingLimits, setRoutingLimits] = useState<RoutingLimits>(() => {
    try {
      const saved = localStorage.getItem('routingLimits');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          maxWeight: parsed.maxWeight || 0,
          maxVolume: parsed.maxVolume || 0,
          maxSatir: parsed.maxSatir || 0,
          maxCustomers: parsed.maxCustomers || 0,
          maxRegions: parsed.maxRegions || 0,
          truckTypes: parsed.truckTypes && parsed.truckTypes.length > 0 ? parsed.truckTypes : DEFAULT_TRUCK_TYPES,
          costPerRoute: parsed.costPerRoute ?? 50,
          costPerKm: parsed.costPerKm ?? 2,
          costPerStore: parsed.costPerStore ?? 5,
          costPerKg: parsed.costPerKg ?? 0.1,
          allowCombineTimeSlots: parsed.allowCombineTimeSlots !== undefined ? parsed.allowCombineTimeSlots : false,
          allowCombineDates: parsed.allowCombineDates !== undefined ? parsed.allowCombineDates : false,
          optimizationMode: parsed.optimizationMode || 'balanced',
          timeWindowMode: parsed.timeWindowMode || 'soft',
          serviceTimeMinutes: parsed.serviceTimeMinutes ?? 10,
        };
      }
    } catch {
      // ignore storage errors
    }
    return {
      maxWeight: 0,
      maxVolume: 0,
      maxSatir: 0,
      maxCustomers: 0,
      maxRegions: 0,
      truckTypes: DEFAULT_TRUCK_TYPES,
      costPerRoute: 50,
      costPerKm: 2,
      costPerStore: 5,
      costPerKg: 0.1,
      allowCombineTimeSlots: false,
      allowCombineDates: false,
      optimizationMode: 'balanced',
      timeWindowMode: 'soft',
      serviceTimeMinutes: 10,
    };
  });
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<string>('smart_logistics');
  const [isRouting, setIsRouting] = useState(false);
  const [isCalculatingGeometry, setIsCalculatingGeometry] = useState(false);
  const [routingProgress, setRoutingProgress] = useState({ percent: 0, message: '', logs: [] as string[] });

  // Route Versions
  const [routeVersions, setRouteVersions] = useState<RouteVersion[]>(() => {
    try {
      const saved = localStorage.getItem('routeVersions');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    safeSetStorageItem('routingLimits', JSON.stringify(routingLimits));
  }, [routingLimits]);

  useEffect(() => {
    safeSetStorageItem('routeVersions', JSON.stringify(routeVersions));
  }, [routeVersions]);

  // --- Store directory: every store ever imported (synced to the cloud database) ---
  // shared with Ritm, Proqnoz and the Stores page; saved by the directory store itself
  const storeDirectory = useDirectory();
  const setStoreDirectory = directoryStore.set;

  // --- Road barriers (closed roads the router must avoid) ---
  const [barriers, setBarriers] = useState<RoadBarrier[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('road_barriers_v1') || 'null');
      const list = Array.isArray(parsed) ? parsed : [];
      setRoadBarriers(list); // routing services must know them before the first render
      return list;
    } catch {
      return [];
    }
  });
  const [barrierPlacementMode, setBarrierPlacementModeState] = useState<'point' | 'zone' | null>(null);
  const [barrierZoneRadius, setBarrierZoneRadius] = useState(300);
  const [isPlacingBarrier, setIsPlacingBarrier] = useState(false);
  const [mapFocusPoint, setMapFocusPoint] = useState<{ lat: number; lng: number; zoom?: number; ts: number } | null>(null);
  const [barrierHash, setBarrierHash] = useState(() => getBarrierHash());

  useEffect(() => {
    setRoadBarriers(barriers);
    setBarrierHash(getBarrierHash());
    safeSetStorageItem('road_barriers_v1', JSON.stringify(barriers));
  }, [barriers]);

  // Rota module data (kept outside the page so it is saved and synced while the page is closed)
  const rotaWorkspace = useRotaWorkspace();
  useEffect(() => { ensureRotaLoaded(); }, []);

  // The old Rota page (drivers & shifts) was replaced by the Rota planning module; drop its leftovers
  useEffect(() => {
    try {
      localStorage.removeItem('rota_drivers');
      localStorage.removeItem('rota_shifts');
    } catch {
      // ignore
    }
  }, []);

  // --- Cloud database (Firebase Firestore) ---
  // Everything the user works with is synced for the signed-in account; localStorage stays as offline copy.
  const cloudValues = useMemo(() => ({
    orders,
    routes: sanitizeRoutesForStorage(routes), // road geometry is heavy and recalculated on demand
    routeVersions,
    streetHighlights,
    streetGroups,
    barriers,
    storeDirectory,
    rota: rotaWorkspace,
    settings: { routingLimits, streetLineWidth, streetLineOpacity }
  }), [orders, routes, routeVersions, streetHighlights, streetGroups, barriers, storeDirectory, rotaWorkspace, routingLimits, streetLineWidth, streetLineOpacity]);

  const applyCloudData = useCallback((data: Record<string, unknown>) => {
    if (Array.isArray(data.orders)) setOrders(data.orders as Order[]);
    if (Array.isArray(data.routes)) setRoutes(data.routes as Route[]);
    if (Array.isArray(data.routeVersions)) setRouteVersions(data.routeVersions as RouteVersion[]);
    if (Array.isArray(data.streetHighlights)) setStreetHighlights(data.streetHighlights as StreetHighlight[]);
    if (Array.isArray(data.streetGroups)) setStreetGroups(data.streetGroups as StreetGroup[]);
    if (Array.isArray(data.barriers)) setBarriers(data.barriers as RoadBarrier[]);
    if (Array.isArray(data.storeDirectory)) setStoreDirectory(data.storeDirectory as StoreRecord[]);
    if (data.rota && typeof data.rota === 'object') rotaStore.replaceWorkspace(data.rota);
    const settings = data.settings as { routingLimits?: Partial<RoutingLimits>; streetLineWidth?: number; streetLineOpacity?: number } | undefined;
    if (settings?.routingLimits) {
      setRoutingLimits(prev => ({
        ...prev,
        ...settings.routingLimits,
        truckTypes: settings.routingLimits?.truckTypes?.length ? settings.routingLimits.truckTypes : prev.truckTypes
      }));
    }
    if (typeof settings?.streetLineWidth === 'number') setStreetLineWidth(settings.streetLineWidth);
    if (typeof settings?.streetLineOpacity === 'number') setStreetLineOpacity(settings.streetLineOpacity);
    // Selections may point to ids that no longer exist
    setSelectedOrderIds([]);
    setSelectedRouteId(null);
  }, []);

  const cloud = useCloudSync(cloudValues, applyCloudData);

  // Live numbers for the cloud panel: store directory and learned road distances
  const [roadCacheVersion, setRoadCacheVersion] = useState(0);
  useEffect(() => roadCache.subscribe(() => setRoadCacheVersion(v => v + 1)), []);
  const cloudDetails = useMemo(() => {
    const rc = roadCache.stats();
    const lastTotal = rc.lastHits + rc.lastFetched;
    return [
      { label: t('storeDirectoryCount'), value: String(storeDirectory.length) },
      { label: t('roadCacheCount'), value: rc.cellsSaved.toLocaleString() },
      ...(lastTotal > 0 ? [{ label: t('roadCacheLastHit'), value: `${Math.round((rc.lastHits / lastTotal) * 100)}%` }] : [])
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeDirectory.length, roadCacheVersion, language]);
  const [currentPage, setCurrentPage] = useState<'home' | 'routing' | 'rota' | 'forecast' | 'stores'>('routing');
  const [isTopCollapsed, setIsTopCollapsed] = useState(false);
  const [showFullAnalytics, setShowFullAnalytics] = useState(false);
  const [leftPanelTab, setLeftPanelTab] = useState<LeftPanelTab>('stores');
  const [compareEntry, setCompareEntry] = useState<RouteHistoryEntry | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [optimizationDiffEntry, setOptimizationDiffEntry] = useState<RouteHistoryEntry | null>(null);
  const [showAllRouteLines, setShowAllRouteLines] = useState<boolean>(true);
  const [routeGroupingMode, setRouteGroupingMode] = useState<'date' | 'type' | 'all'>('date');
  const [collapsedDateGroups, setCollapsedDateGroups] = useState<Record<string, boolean>>({});
  const [excelMapping, setExcelMapping] = useState<{
    show: boolean;
    data: any[];
    headers: string[];
    mapping: Record<string, string>;
  }>({ show: false, data: [], headers: [], mapping: {} });
  const [zones, setZones] = useState<Zone[]>([]);
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [editingScenarioName, setEditingScenarioName] = useState('');

  const [isOptimizingAll, setIsOptimizingAll] = useState(false);

  // View Format: 'desktop' | 'mobile' (Android optimized)
  const [viewFormat, setViewFormat] = useState<'desktop' | 'mobile'>(() => {
    try {
      const saved = localStorage.getItem('app_view_format');
      if (saved === 'desktop' || saved === 'mobile') return saved;
      if (typeof window !== 'undefined' && window.innerWidth < 768) return 'mobile';
    } catch {
      // ignore
    }
    return 'desktop';
  });

  const [showDeviceFrame, setShowDeviceFrame] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('app_mobile_frame');
      if (saved !== null) return saved === 'true';
    } catch {
      // ignore
    }
    return false;
  });

  const handleSetViewFormat = (format: 'desktop' | 'mobile') => {
    setViewFormat(format);
    try {
      localStorage.setItem('app_view_format', format);
    } catch {
      // ignore
    }
  };

  const handleToggleDeviceFrame = () => {
    setShowDeviceFrame(prev => {
      const next = !prev;
      try {
        localStorage.setItem('app_mobile_frame', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleToggleOrder = (ids: string[] | string) => {
    const idArray = Array.isArray(ids) ? ids : [ids];
    const allSelected = idArray.every(id => selectedOrderIds.includes(id));
    if (allSelected) {
      setSelectedOrderIds(prev => prev.filter(id => !idArray.includes(id)));
    } else {
      setSelectedOrderIds(prev => Array.from(new Set([...prev, ...idArray])));
    }
  };

  const handleUndo = () => {
    const undoData = routeHistoryService.popUndoSnapshot();
    if (undoData) {
      setRoutes(undoData.routes);
      setOrders(undoData.orders);
      setSaveNotification(`Откат действия: "${undoData.entryTitle}"`);
      setTimeout(() => setSaveNotification(null), 3000);
    } else {
      setSaveNotification('Нет записанных действий для отката');
      setTimeout(() => setSaveNotification(null), 2000);
    }
  };

  const handleDeleteZone = (id: string) => {
    setZones(prev => prev.filter(z => z.id !== id));
  };

  const handleUpdateZoneName = (id: string, name: string) => {
    setZones(prev => prev.map(z => z.id === id ? { ...z, name } : z));
  };

  // --- Street Highlighting Handlers (3 способа выделения улиц: по названию, кликом, кистью) ---
  const handleMapClickStreet = async (lat: number, lng: number) => {
    setIsClickingStreetLoading(true);
    try {
      const result = await getStreetByClick(lat, lng, orders);
      if (!result) {
        setSaveNotification('В этой точке не удалось определить название улицы. Попробуйте кликнуть ближе к проезжей части.');
        setTimeout(() => setSaveNotification(null), 4000);
        return;
      }

      const matchedOrderIds = result.orders.map(o => o.id);
      const colors = ['#06b6d4', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];

      const newHighlight: StreetHighlight = {
        id: `street-${Date.now()}`,
        name: result.name,
        color: randomColor,
        coordinates: result.coordinates,
        orderIds: matchedOrderIds,
        source: 'click',
        isVisible: true,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setStreetHighlights(prev => [newHighlight, ...prev]);

      if (matchedOrderIds.length > 0) {
        setSelectedOrderIds(prev => Array.from(new Set([...prev, ...matchedOrderIds])));
        setSaveNotification(`Выбрана улица кликом: ${result.name} (${matchedOrderIds.length} заказов выбрано)`);
      } else {
        setSaveNotification(`Выбрана улица: ${result.name}`);
      }
      setTimeout(() => setSaveNotification(null), 4000);
    } catch {
      setSaveNotification('Ошибка при определении улицы по координатам');
      setTimeout(() => setSaveNotification(null), 3000);
    } finally {
      setIsClickingStreetLoading(false);
    }
  };

  const handleAddBrushPoint = (point: [number, number]) => {
    setCurrentBrushTrail(prev => {
      const updated = [...prev, point];
      const matchedOrders = findOrdersInBrush(updated, brushRadiusMeters, orders);
      setCurrentBrushOrderIds(matchedOrders.map(o => o.id));
      return updated;
    });
  };

  const handleBrushComplete = () => {
    if (currentBrushOrderIds.length > 0) {
      setSaveNotification(`Мазок кисти: захвачено ${currentBrushOrderIds.length} заказов. Нажмите "Сохранить", чтобы добавить в список.`);
      setTimeout(() => setSaveNotification(null), 3500);
    }
  };

  const handleSaveCurrentBrushAsStreet = (customName?: string) => {
    if (currentBrushTrail.length === 0) {
      setSaveNotification('Сначала проведите кистью по карте!');
      setTimeout(() => setSaveNotification(null), 3000);
      return;
    }

    const newHighlight = createStreetFromBrush(
      currentBrushTrail,
      brushRadiusMeters,
      orders,
      customName
    );

    setStreetHighlights(prev => [newHighlight, ...prev]);

    if (newHighlight.orderIds && newHighlight.orderIds.length > 0) {
      setSelectedOrderIds(prev => Array.from(new Set([...prev, ...(newHighlight.orderIds || [])])));
    }

    setSaveNotification(`Выделение кистью сохранено: "${newHighlight.name}" (${newHighlight.orderIds?.length || 0} заказов)`);
    setTimeout(() => setSaveNotification(null), 4000);

    setCurrentBrushTrail([]);
    setCurrentBrushOrderIds([]);
  };

  const handleClearCurrentBrush = () => {
    setCurrentBrushTrail([]);
    setCurrentBrushOrderIds([]);
    setSaveNotification('Мазок кисти очищен');
    setTimeout(() => setSaveNotification(null), 2500);
  };

  const handleToggleStreetVisibility = (id: string) => {
    setStreetHighlights(prev => prev.map(s => s.id === id ? { ...s, isVisible: !s.isVisible } : s));
  };

  const handleDeleteStreet = (id: string) => {
    setStreetHighlights(prev => prev.filter(s => s.id !== id));
  };

  const handleUpdateStreet = (streetId: string, updates: Partial<StreetHighlight>) => {
    setStreetHighlights(prev => prev.map(s => s.id === streetId ? { ...s, ...updates } : s));
  };

  const handleAddGroup = (name: string, color: string): StreetGroup => {
    const newGroup: StreetGroup = {
      id: `group-${Date.now()}`,
      name: name.trim() || `Группа ${streetGroups.length + 1}`,
      color: color || '#3b82f6',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isCollapsed: false
    };
    setStreetGroups(prev => [...prev, newGroup]);
    setSaveNotification(`Создана группа: "${newGroup.name}"`);
    setTimeout(() => setSaveNotification(null), 2500);
    return newGroup;
  };

  const handleUpdateGroup = (groupId: string, updates: Partial<StreetGroup>) => {
    setStreetGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...updates } : g));
    if (updates.color || updates.thickness !== undefined || updates.opacity !== undefined) {
      // Synchronously change colors, thickness, opacity of all streets in this group
      setStreetHighlights(prev => prev.map(s => {
        if (s.groupId === groupId) {
          return {
            ...s,
            ...(updates.color ? { color: updates.color } : {}),
            ...(updates.thickness !== undefined ? { thickness: updates.thickness } : {}),
            ...(updates.opacity !== undefined ? { opacity: updates.opacity } : {})
          };
        }
        return s;
      }));
    }
  };

  const handleDeleteGroup = (groupId: string, deleteStreets: boolean = false) => {
    setStreetGroups(prev => prev.filter(g => g.id !== groupId));
    if (deleteStreets) {
      setStreetHighlights(prev => prev.filter(s => s.groupId !== groupId));
    } else {
      setStreetHighlights(prev => prev.map(s => s.groupId === groupId ? { ...s, groupId: undefined } : s));
    }
    setSaveNotification('Группа удалена');
    setTimeout(() => setSaveNotification(null), 2500);
  };

  const handleAssignStreetToGroup = (streetId: string, groupId?: string) => {
    const targetGroup = streetGroups.find(g => g.id === groupId);
    setStreetHighlights(prev => prev.map(s => {
      if (s.id === streetId) {
        return {
          ...s,
          groupId: groupId || undefined,
          color: targetGroup ? targetGroup.color : s.color
        };
      }
      return s;
    }));
  };

  const handleBulkAssignStreetsToGroup = (streetIds: string[], groupId?: string) => {
    const targetGroup = streetGroups.find(g => g.id === groupId);
    setStreetHighlights(prev => prev.map(s => {
      if (streetIds.includes(s.id)) {
        return {
          ...s,
          groupId: groupId || undefined,
          color: targetGroup ? targetGroup.color : s.color
        };
      }
      return s;
    }));
    setSaveNotification(`${streetIds.length} улиц перенесено ${targetGroup ? `в группу "${targetGroup.name}"` : 'в "Без группы"'}`);
    setTimeout(() => setSaveNotification(null), 3000);
  };

  const handleSelectStreetOrders = (orderIds: string[]) => {
    setSelectedOrderIds(prev => Array.from(new Set([...prev, ...orderIds])));
    setSaveNotification(`Выбрано ${orderIds.length} заказов с улицы`);
    setTimeout(() => setSaveNotification(null), 3000);
  };

  const handleOptimizeAll = async () => {
    if (routes.length === 0) return;
    setIsOptimizingAll(true);
    const prevRoutes = [...routes];
    const prevOrders = [...orders];
    
    try {
      const updatedRoutes = [...routes];
      const orderMap = new Map(orders.map(o => [o.id, o]));
      
      const lockedRouteIds = new Set(routingLimits.lockedRoutes || []);
      for (let i = 0; i < updatedRoutes.length; i++) {
        const route = updatedRoutes[i];
        if (lockedRouteIds.has(route.id)) continue; // locked: keep the stop order
        const routeOrders = route.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o));
        if (routeOrders.length < 2) continue;

        const matrix = await getDistanceMatrix([WAREHOUSE_LOCATION, ...routeOrders]);
        
        // Try all methods and pick the best round-trip sequence (Warehouse -> Stores -> Warehouse)
        const nn = optimizeRouteNearestNeighbor(routeOrders, matrix);
        const opt2 = optimizeRoute2Opt(routeOrders, matrix, routeOrders);
        const greedy = optimizeRouteGreedy(routeOrders, matrix);
        const combined = optimizeRoute2Opt(nn, matrix, routeOrders);

        const versions = [
          { orders: routeOrders, dist: getRouteTotalDistance(routeOrders, matrix, routeOrders) },
          { orders: nn, dist: getRouteTotalDistance(nn, matrix, routeOrders) },
          { orders: opt2, dist: getRouteTotalDistance(opt2, matrix, routeOrders) },
          { orders: greedy, dist: getRouteTotalDistance(greedy, matrix, routeOrders) },
          { orders: combined, dist: getRouteTotalDistance(combined, matrix, routeOrders) }
        ].sort((a, b) => a.dist - b.dist);

        const best = versions[0];
        
        // Update geometry & full round-trip nav distance (Warehouse -> Stores -> Warehouse)
        const nav = await getRouteNavDetails([WAREHOUSE_LOCATION, ...best.orders, WAREHOUSE_LOCATION]);
        const updatedBase: Route = {
          ...route,
          orderIds: best.orders.map(o => o.id),
          distance: best.dist
        };
        updatedRoutes[i] = applyNavDetailsToRoute(updatedBase, best.orders, nav);
      }
      
      setRoutes(updatedRoutes);
      setSaveNotification('Все маршруты успешно оптимизированы (Склад → Магазины → Склад)!');
      
      const historyEntry = routeHistoryService.recordChange({
        action: '2-Opt Оптимизация порядка точек',
        description: `Оптимизирована геометрия и порядок для ${updatedRoutes.length} маршрутов`,
        routesBefore: prevRoutes,
        routesAfter: updatedRoutes,
        ordersBefore: prevOrders,
        ordersAfter: prevOrders,
        source: 'optimization'
      });
      setOptimizationDiffEntry(historyEntry);

      setTimeout(() => setSaveNotification(null), 3000);
    } catch {
      setSaveNotification('Не удалось завершить оптимизацию всех маршрутов');
    } finally {
      setIsOptimizingAll(false);
    }
  };

  const handleRecalculateAllRoadGeometry = async () => {
    if (routes.length === 0 || isCalculatingGeometry) return;
    setIsCalculatingGeometry(true);
    setSaveNotification('Прокладка реальных навигационных линий OSRM (Склад → Магазины → Склад)...');
    const orderMap = new Map(orders.map(o => [o.id, o]));
    
    let updatedCount = 0;
    for (const route of routes) {
      const routeOrders = route.orderIds
        .map(id => orderMap.get(id))
        .filter((o): o is Order => Boolean(o));
      if (routeOrders.length === 0) continue;

      const points = [
        WAREHOUSE_LOCATION,
        ...routeOrders.map(o => ({ lat: o.lat, lng: o.lng })),
        WAREHOUSE_LOCATION
      ];

      try {
        const nav = await getRouteNavDetails(points);
        setRoutes(prev => prev.map(r => r.id === route.id ? applyNavDetailsToRoute(r, routeOrders, nav) : r));
        if (nav.isRealRoad) updatedCount++;
      } catch {
        // fallback already preserved on route
      }
      await new Promise(r => setTimeout(r, 60));
    }

    setIsCalculatingGeometry(false);
    setSaveNotification(`Навигационные линии обновлены: ${updatedCount} из ${routes.length} по реальным дорогам!`);
    setTimeout(() => setSaveNotification(null), 3500);
  };

  // --- Road barrier handlers ---
  const setBarrierPlacementMode = (mode: 'point' | 'zone' | null) => {
    setBarrierPlacementModeState(mode);
    if (mode) setActiveStreetMode(null);
  };

  const barrierTimestamp = () =>
    new Date().toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const handleMapClickBarrier = async (lat: number, lng: number) => {
    if (!barrierPlacementMode || isPlacingBarrier) return;
    const id = `barrier-${Date.now()}`;
    const createdAt = barrierTimestamp();

    if (barrierPlacementMode === 'zone') {
      setBarriers(prev => [...prev, {
        id, kind: 'zone', lat, lng, radiusMeters: barrierZoneRadius, isActive: true, createdAt,
        name: t('barrierZoneDefaultName', { n: prev.filter(b => b.kind === 'zone').length + 1 })
      }]);
      return;
    }

    // Point barrier: snap to the nearest drivable road to show exactly which segment is closed
    setIsPlacingBarrier(true);
    try {
      const snap = await valhallaLocate({ lat, lng });
      setBarriers(prev => [...prev, {
        id, kind: 'point', isActive: true, createdAt,
        lat: snap?.lat ?? lat,
        lng: snap?.lng ?? lng,
        blockedSegment: snap?.segment && snap.segment.length >= 2 ? snap.segment : undefined,
        name: snap?.name || t('barrierDefaultName', { n: prev.length + 1 })
      }]);
      if (!snap) {
        setSaveNotification('Не удалось привязать барьер к дороге (сервер Valhalla недоступен) — он поставлен в точку клика');
      } else if (calculateDistance(lat, lng, snap.lat, snap.lng) > 0.12) {
        setSaveNotification('Барьер привязан к ближайшей дороге в ' + Math.round(calculateDistance(lat, lng, snap.lat, snap.lng) * 1000) + ' м от клика');
      }
    } finally {
      setIsPlacingBarrier(false);
    }
  };

  const handleCloseStreet = (streetId: string) => {
    const street = streetHighlights.find(s => s.id === streetId);
    if (!street) return;
    const lines = street.multiCoordinates && street.multiCoordinates.length > 0
      ? street.multiCoordinates
      : street.coordinates && street.coordinates.length >= 2 ? [street.coordinates] : [];
    if (lines.length === 0) return;
    setBarriers(prev => [...prev, {
      id: `barrier-${Date.now()}`, kind: 'street', name: street.name, isActive: true, createdAt: barrierTimestamp(),
      lat: lines[0][0][0], lng: lines[0][0][1], path: lines
    }]);
    setSaveNotification(`Улица «${street.name}» закрыта для проезда`);
  };

  const handleToggleBarrier = (id: string) =>
    setBarriers(prev => prev.map(b => b.id === id ? { ...b, isActive: !b.isActive } : b));
  const handleDeleteBarrier = (id: string) => setBarriers(prev => prev.filter(b => b.id !== id));
  const handleRenameBarrier = (id: string, name: string) =>
    setBarriers(prev => prev.map(b => b.id === id ? { ...b, name } : b));
  const handleClearBarriers = () => {
    if (barriers.length === 0) return;
    if (window.confirm(`Удалить все барьеры (${barriers.length})?`)) setBarriers([]);
  };
  const handleFocusBarrier = (b: RoadBarrier) =>
    setMapFocusPoint({ lat: b.lat, lng: b.lng, zoom: b.kind === 'zone' ? 15 : 17, ts: Date.now() });

  // Rebuild road lines: after barriers change only the routes that touch a barrier (or were rebuilt
  // around one before) are recalculated; the panel button rebuilds every route.
  const [isRebuildingBarrierRoutes, setIsRebuildingBarrierRoutes] = useState(false);
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  const rebuildRoutesForBarriers = async (onlyAffected: boolean) => {
    const active = getActiveBarriers();
    const targets = routesRef.current.filter(r =>
      !onlyAffected ||
      Boolean(r.barrierStatus) ||
      (active.length > 0 && Array.isArray(r.geometry) && r.geometry.length > 1 && anyBarrierTouchesPath(active, r.geometry))
    );
    if (targets.length === 0) return;

    setIsRebuildingBarrierRoutes(true);
    const orderMap = new Map(ordersRef.current.map(o => [o.id, o]));
    let detours = 0;
    let blocked = 0;
    for (const route of targets) {
      const routeOrders = route.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o));
      if (routeOrders.length === 0) continue;
      try {
        const nav = await getRouteNavDetails([
          WAREHOUSE_LOCATION,
          ...routeOrders.map(o => ({ lat: o.lat, lng: o.lng })),
          WAREHOUSE_LOCATION
        ]);
        if (nav.barrierStatus === 'detour') detours++;
        if (nav.barrierStatus === 'blocked') blocked++;
        setRoutes(prev => prev.map(r => r.id === route.id ? applyNavDetailsToRoute(r, routeOrders, nav) : r));
      } catch {
        // keep the previous line
      }
    }
    setIsRebuildingBarrierRoutes(false);
    if (active.length > 0) {
      setSaveNotification(
        `Линии маршрутов перестроены: в объезд ${detours}` + (blocked > 0 ? `, через барьер (объезд не найден) ${blocked}` : '')
      );
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => { void rebuildRoutesForBarriers(true); }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barrierHash]);

  useEffect(() => {
    if (activeStreetMode) setBarrierPlacementModeState(null);
  }, [activeStreetMode]);

  const barrierRouteStats = useMemo(() => ({
    detour: routes.filter(r => r.barrierStatus === 'detour').length,
    blocked: routes.filter(r => r.barrierStatus === 'blocked').length
  }), [routes]);

  const handleRenameScenario = (id: string, newName: string) => {
    setRouteVersions(prev => prev.map(v => v.id === id ? { ...v, name: newName } : v));
    setEditingScenarioId(null);
  };

  const handleExportAnalytics = () => {
    const wb = XLSX.utils.book_new();
    const orderMap = new Map(orders.map(o => [o.id, o]));
    
    const routeEfficiencyData = routes.map(r => {
      const rOrders = r.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o));
      const weight = rOrders.reduce((s, o) => s + o.weight, 0);
      const volume = rOrders.reduce((s, o) => s + o.volume, 0);
      const truckType = routingLimits.truckTypes?.find(t => t.id === r.truckTypeId);
      const maxW = truckType?.maxWeight || routingLimits.maxWeight;
      const maxV = truckType?.maxVolume || routingLimits.maxVolume;
      const legs = calculateRouteLegs(r, rOrders);
      return {
        name: r.name,
        weightLoad: maxW > 0 ? Math.round((weight / maxW) * 100) : 0,
        volumeLoad: maxV > 0 ? Math.round((volume / maxV) * 100) : 0,
        orders: rOrders.length,
        distance: legs.totalRoundTripKm
      };
    });

    // Summary Sheet
    const summaryData = [
      ['Параметр', 'Значение'],
      ['Всего маршрутов', routes.length],
      ['Общая дистанция Склад -> Магазины -> Склад (км)', Math.round(routeEfficiencyData.reduce((sum, r) => sum + r.distance, 0) * 10) / 10],
      ['Средняя загрузка (%)', routes.length > 0 ? Math.round(routeEfficiencyData.reduce((sum, r) => sum + r.weightLoad, 0) / routes.length) : 0],
      ['Общий вес (кг)', orders.filter(o => o.status === 'in-route').reduce((sum, o) => sum + o.weight, 0)],
      ['Общий объем (м³)', orders.filter(o => o.status === 'in-route').reduce((sum, o) => sum + o.volume, 0)]
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Сводка');
    
    // Routes Sheet
    const routesData = routes.map(r => {
      const rOrders = r.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o));
      const weight = rOrders.reduce((s, o) => s + o.weight, 0);
      const volume = rOrders.reduce((s, o) => s + o.volume, 0);
      const storesCount = new Set(rOrders.map(o => o.customerName)).size;
      const legs = calculateRouteLegs(r, rOrders);
      
      const truckType = routingLimits.truckTypes?.find(t => t.id === r.truckTypeId);
      const maxW = truckType?.maxWeight || routingLimits.maxWeight;
      const maxV = truckType?.maxVolume || routingLimits.maxVolume;
      
      return {
        'Название': r.name,
        'Дистанция Склад -> Магазины -> Склад (км)': legs.totalRoundTripKm,
        'Выезд со склада (км)': legs.fromWarehouseKm,
        'По магазинам (км)': legs.betweenStoresKm,
        'Возврат на склад (км)': legs.toWarehouseKm,
        'Кол-во заказов': rOrders.length,
        'Кол-во магазинов': storesCount,
        'Вес (кг)': weight,
        'Объем (м³)': volume,
        'Загрузка веса (%)': maxW > 0 ? Math.round((weight / maxW) * 100) : 0,
        'Загрузка объема (%)': maxV > 0 ? Math.round((volume / maxV) * 100) : 0
      };
    });
    const wsRoutes = XLSX.utils.json_to_sheet(routesData);
    XLSX.utils.book_append_sheet(wb, wsRoutes, 'Маршруты');
    
    XLSX.writeFile(wb, 'analytics_report.xlsx');
  };

  const handleRunRouting = async () => {
    const algo = selectedAlgorithm || 'smart_logistics';
    if (!selectedAlgorithm) {
      setSelectedAlgorithm('smart_logistics');
    }
    
    const prevRoutes = [...routes];
    const prevOrders = [...orders];
    
    // Get orders that match current filters (prefer not-in-route first)
    const filteredStoreNames = new Set(filteredStores.map(s => s.name));
    let availableOrders = filteredOrders.filter(o => o.status === 'not-in-route');

    // If all matching orders are already in a route (e.g. re-running routing with another algorithm),
    // allow re-routing all filtered orders, or all non-delivered orders if status filter hid them
    if (availableOrders.length === 0) {
      if (filteredOrders.length > 0) {
        availableOrders = filteredOrders;
      } else {
        const allMatchingOrders = orders.filter(o => filteredStoreNames.has(o.customerName));
        availableOrders = allMatchingOrders.length > 0
          ? allMatchingOrders
          : orders;
      }
    }

    // Locked routes stay exactly as they are: their orders never go back into routing
    const lockedRouteIds = new Set(routingLimits.lockedRoutes || []);
    const lockedOrderIds = new Set(routes.filter(r => lockedRouteIds.has(r.id)).flatMap(r => r.orderIds));
    const lockedSkipped = availableOrders.filter(o => lockedOrderIds.has(o.id)).length;
    availableOrders = availableOrders.filter(o => !lockedOrderIds.has(o.id));

    if (availableOrders.length === 0) {
      setSaveNotification(lockedSkipped > 0
        ? 'Все выбранные заказы находятся в заблокированных маршрутах — пересчитывать нечего'
        : 'Нет доступных заказов для маршрутизации (проверьте фильтры магазинов и дат)');
      return;
    }

    setIsRouting(true);
    setRoutingProgress({ percent: 0, message: 'Подготовка данных...', logs: ['Запуск алгоритма: ' + algo] });
    
    const onProgress = (update: ProgressUpdate) => {
      setRoutingProgress(prev => ({
        percent: update.percent,
        message: update.message,
        logs: update.log ? [update.log, ...prev.logs].slice(0, 50) : prev.logs
      }));
    };

    try {
      let resultRoutes: Route[] = [];
      const limits: RoutingLimits = {
        ...routingLimits
      };

      const start = Date.now();
      switch (algo) {
        case 'ai_mode': {
          const { runAIRouting } = await import('./services/aiLogisticsOptimizer');
          resultRoutes = await runAIRouting(availableOrders, limits, onProgress, limits.aiStrategyPrompt);
          break;
        }
        case 'smart_logistics': {
          const { runSmartLogistics } = await import('./services/smartLogisticsOptimizer');
          resultRoutes = await runSmartLogistics(availableOrders, limits, onProgress);
          break;
        }
        case 'sisr':
        case 'hgs': {
          const { runSmartLogistics } = await import('./services/smartLogisticsOptimizer');
          resultRoutes = await runSmartLogistics(availableOrders, limits, onProgress, undefined, algo);
          break;
        }
        case 'savings': resultRoutes = await runPartitioned(runSavings, availableOrders, limits, onProgress); break;
        case 'sweep': resultRoutes = await runPartitioned(runSweep, availableOrders, limits, onProgress); break;
        case 'cluster': resultRoutes = await runPartitioned(runCluster, availableOrders, limits, onProgress); break;
        case 'genetic': resultRoutes = await runPartitioned(runGenetic, availableOrders, limits, onProgress); break;
        case 'tabu': resultRoutes = await runPartitioned(runTabu, availableOrders, limits, onProgress); break;
        case 'nn': {
          const { runNearestNeighbor } = await import('./services/routingService');
          resultRoutes = await runPartitioned(runNearestNeighbor, availableOrders, limits, onProgress); 
          break;
        }
        case 'fi': {
          const { runFarthestInsertion } = await import('./services/routingService');
          resultRoutes = await runPartitioned(runFarthestInsertion, availableOrders, limits, onProgress); 
          break;
        }
        case 'sa': {
          const { runSimulatedAnnealing } = await import('./services/routingService');
          resultRoutes = await runPartitioned(runSimulatedAnnealing, availableOrders, limits, onProgress); 
          break;
        }
        case 'grasp': {
          const { runGRASP } = await import('./services/routingService');
          resultRoutes = await runPartitioned(runGRASP, availableOrders, limits, onProgress); 
          break;
        }
        case 'ni': {
          const { runNearestInsertion } = await import('./services/routingService');
          resultRoutes = await runPartitioned(runNearestInsertion, availableOrders, limits, onProgress); 
          break;
        }
        case 'rg': {
          const { runRandomizedGreedy } = await import('./services/routingService');
          resultRoutes = await runPartitioned(runRandomizedGreedy, availableOrders, limits, onProgress); 
          break;
        }
        case 'ss': {
          const { runSequentialSavings } = await import('./services/routingService');
          resultRoutes = await runPartitioned(runSequentialSavings, availableOrders, limits, onProgress); 
          break;
        }
        case 'ls': resultRoutes = await runPartitioned(runLocalSearch, availableOrders, limits, onProgress); break;
        case 'vns': resultRoutes = await runPartitioned(runVNS, availableOrders, limits, onProgress); break;
        case 'ils': resultRoutes = await runPartitioned(runILS, availableOrders, limits, onProgress); break;
        case 'aco': resultRoutes = await runPartitioned(runACO, availableOrders, limits, onProgress); break;
        case 'pso': resultRoutes = await runPartitioned(runPSO, availableOrders, limits, onProgress); break;
        case 'bco': resultRoutes = await runPartitioned(runBCO, availableOrders, limits, onProgress); break;
        case 'lns': resultRoutes = await runPartitioned(runLNS, availableOrders, limits, onProgress); break;
        case 'tabu_search': resultRoutes = await runPartitioned(runTabuSearch, availableOrders, limits, onProgress); break;
        case 'genetic_algo': resultRoutes = await runPartitioned(runGeneticAlgorithm, availableOrders, limits, onProgress); break;
        case 'cw_savings': resultRoutes = await runPartitioned(runClarkeWrightSavings, availableOrders, limits, onProgress); break;
        default: {
          const { runSmartLogistics } = await import('./services/smartLogisticsOptimizer');
          resultRoutes = await runSmartLogistics(availableOrders, limits, onProgress);
          break;
        }
      }

      if (resultRoutes.length === 0) {
        setSaveNotification('Не удалось сформировать маршруты. Проверьте лимиты веса/объема транспорта.');
        setIsRouting(false);
        return;
      }

      // Update routes immediately: clean reassignment
      const newOrderIds = new Set(resultRoutes.flatMap(r => r.orderIds));
      const updatedPrev = prevRoutes
        .map(r => ({
          ...r,
          orderIds: r.orderIds.filter(id => !newOrderIds.has(id))
        }))
        .filter(r => r.orderIds.length > 0);
      // Trucks actually available (counts per type, one route per truck per day); existing routes keep theirs
      const fleet = assignFleetToRoutes([...updatedPrev, ...resultRoutes], prevOrders, routingLimits, new Set(updatedPrev.map(r => r.id)));
      const finalRoutes = fleet.routes;
      const shortageText = Object.entries(fleet.shortage)
        .map(([id, c]) => `${routingLimits.truckTypes?.find(t => t.id === id)?.name || id} ×${c}`)
        .join(', ');
      const finalOrders = prevOrders.map(o => {
        const foundRoute = resultRoutes.find(r => r.orderIds.includes(o.id));
        return foundRoute ? { ...o, status: 'in-route' as const, routeId: foundRoute.id } : o;
      });

      setRoutes(finalRoutes);
      setOrders(finalOrders);

      // Record in history & trigger optimization comparison modal
      const historyEntry = routeHistoryService.recordChange({
        action: `Оптимизация (${algo})`,
        description: `Сформировано ${resultRoutes.length} маршрут(ов) по алгоритму "${algo}"`,
        routesBefore: prevRoutes,
        routesAfter: finalRoutes,
        ordersBefore: prevOrders,
        ordersAfter: finalOrders,
        source: 'optimization'
      });
      setOptimizationDiffEntry(historyEntry);

      onProgress({ percent: 100, message: `Маршрутизация завершена! Сформировано ${resultRoutes.length} маршрут(ов).` });
      setSaveNotification(shortageText
        ? `Создано ${resultRoutes.length} маршрут(ов). Не хватает машин: ${shortageText} — такие маршруты отмечены «Нет машины»`
        : `Успешно создано ${resultRoutes.length} маршрут(ов)`);
      setTimeout(() => setIsRouting(false), 800);

      // Background geometry & road navigation calculation
      const ordersForGeometry = availableOrders;
      const calculateGeometry = async () => {
        setIsCalculatingGeometry(true);
        const orderMap = new Map(ordersForGeometry.map(o => [o.id, o]));

        for (let i = 0; i < resultRoutes.length; i++) {
          const route = resultRoutes[i];
          // Preserve the exact optimized stop sequence!
          const routeOrders = route.orderIds
            .map(id => orderMap.get(id))
            .filter((o): o is Order => Boolean(o));

          if (routeOrders.length === 0) continue;

          const points = [
            WAREHOUSE_LOCATION,
            ...routeOrders.map(o => ({ lat: o.lat, lng: o.lng })),
            WAREHOUSE_LOCATION
          ];
          
          try {
            const nav = await getRouteNavDetails(points);
            setRoutes(prev => prev.map(r => r.id === route.id ? applyNavDetailsToRoute(r, routeOrders, nav) : r));
          } catch {
            // fallback already preserved on route
          }
          // Small delay to avoid blocking UI
          await new Promise(r => setTimeout(r, 60));
        }
        setIsCalculatingGeometry(false);
      };

      calculateGeometry();

    } catch (error) {
      setSaveNotification('Ошибка при выполнении алгоритма: ' + (error instanceof Error ? error.message : 'Сбой вычислений'));
      setIsRouting(false);
    }
  };

  const [saveNotification, setSaveNotification] = useState<string | null>(null);

  useEffect(() => {
    if (saveNotification) {
      const timer = setTimeout(() => setSaveNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveNotification]);

  const handleSaveVersion = (name?: string) => {
    const version: RouteVersion = {
      id: Date.now().toString(),
      name: name || `Сценарий ${(routeVersions.length + 1).toString().padStart(2, '0')}`,
      routes: sanitizeRoutesForStorage(JSON.parse(JSON.stringify(routes))),
      orders: JSON.parse(JSON.stringify(orders)),
      createdAt: new Date().toLocaleString()
    };
    setRouteVersions(prev => [...prev, version]);
    setSaveNotification('Сценарий успешно сохранен!');
  };

  const handleLoadVersion = (version: RouteVersion) => {
    setRoutes(version.routes);
    setOrders(version.orders);
  };

  const handleApplyWhatIfScenario = (newRoutes: Route[]) => {
    setRoutes(newRoutes);
    const orderRouteMap = new Map<string, string>();
    newRoutes.forEach(r => {
      r.orderIds.forEach(id => orderRouteMap.set(id, r.id));
    });
    setOrders(prev => prev.map(o => {
      const assignedRouteId = orderRouteMap.get(o.id);
      if (assignedRouteId) {
        return { ...o, status: 'in-route' as const, routeId: assignedRouteId };
      }
      return { ...o, status: 'not-in-route' as const, routeId: undefined };
    }));
    setSaveNotification(`Применен сценарий What-If: сформировано ${newRoutes.length} маршрутов`);
    setTimeout(() => setSaveNotification(null), 3000);
  };

  // Helper to recalculate round-trip distance & road geometry (Warehouse -> Stores -> Warehouse) after manual route edits
  const recalculateRouteRoundTrip = (routeId: string, newOrderIds: string[]) => {
    const orderMap = new Map(orders.map(o => [o.id, o]));
    const routeOrders = newOrderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o));
    const straightKm = calculateStraightRouteDistance(routeOrders);
    const fallbackGeo: [number, number][] = routeOrders.length > 0
      ? [
          [WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng],
          ...routeOrders.map(o => [o.lat, o.lng] as [number, number]),
          [WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng]
        ]
      : [];

    setRoutes(prev => prev.map(r => r.id === routeId ? {
      ...r,
      orderIds: newOrderIds,
      distance: straightKm,
      straightDistanceKm: straightKm,
      geometry: fallbackGeo
    } : r));

    if (routeOrders.length > 0) {
      const points = [
        WAREHOUSE_LOCATION,
        ...routeOrders.map(o => ({ lat: o.lat, lng: o.lng })),
        WAREHOUSE_LOCATION
      ];
      getRouteNavDetails(points).then(nav => {
        setRoutes(prev => prev.map(r => r.id === routeId ? applyNavDetailsToRoute({ ...r, orderIds: newOrderIds }, routeOrders, nav) : r));
        setSelectedRouteDetails(prev => prev && prev.id === routeId ? applyNavDetailsToRoute({ ...prev, orderIds: newOrderIds }, routeOrders, nav) : prev);
      }).catch(() => {});
    }
  };

  const handleUpdateRouteOrders = (routeId: string, newOrderIds: string[]) => {
    const orderMap = new Map(orders.map(o => [o.id, o]));
    const routeOrders = newOrderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o));
    const straightKm = calculateStraightRouteDistance(routeOrders);
    setSelectedRouteDetails(prev => prev && prev.id === routeId ? { ...prev, orderIds: newOrderIds, distance: straightKm, straightDistanceKm: straightKm } : prev);
    recalculateRouteRoundTrip(routeId, newOrderIds);
    setSaveNotification('Порядок точек и полный круг (Склад → Магазины → Склад) обновлены');
    setTimeout(() => setSaveNotification(null), 2500);
  };

  const handleMoveOrdersToRoute = (orderIdsToMove: string[], sourceRouteId: string, targetRouteId: string) => {
    const moveSet = new Set(orderIdsToMove);
    const sourceRoute = routes.find(r => r.id === sourceRouteId);
    const targetRoute = routes.find(r => r.id === targetRouteId);
    const newSourceIds = sourceRoute ? sourceRoute.orderIds.filter(id => !moveSet.has(id)) : [];
    const newTargetIds = targetRoute ? [...targetRoute.orderIds, ...orderIdsToMove] : [...orderIdsToMove];

    setRoutes(prev => prev.map(r => {
      if (r.id === sourceRouteId) {
        return { ...r, orderIds: newSourceIds };
      }
      if (r.id === targetRouteId) {
        return { ...r, orderIds: newTargetIds };
      }
      return r;
    }));

    setOrders(prev => prev.map(o => {
      if (moveSet.has(o.id)) {
        return { ...o, routeId: targetRouteId, status: 'in-route' as const };
      }
      return o;
    }));

    setSelectedRouteDetails(prev => {
      if (prev && prev.id === sourceRouteId) {
        return { ...prev, orderIds: newSourceIds };
      }
      return prev;
    });

    recalculateRouteRoundTrip(sourceRouteId, newSourceIds);
    recalculateRouteRoundTrip(targetRouteId, newTargetIds);

    setSaveNotification(`Точки (${orderIdsToMove.length}) перемещены в маршрут "${targetRoute?.name || targetRouteId}"`);
    setTimeout(() => setSaveNotification(null), 3000);
  };

  const handleToggleLockStore = (orderId: string, routeId: string) => {
    setRoutingLimits(prev => {
      const nextLockedStops = { ...(prev.lockedStops || {}) };
      if (nextLockedStops[orderId]) {
        delete nextLockedStops[orderId];
      } else {
        nextLockedStops[orderId] = routeId;
      }
      return { ...prev, lockedStops: nextLockedStops };
    });
  };

  const handleToggleLockRoute = (routeId: string) => {
    setRoutingLimits(prev => {
      const current = prev.lockedRoutes || [];
      const updated = current.includes(routeId)
        ? current.filter(id => id !== routeId)
        : [...current, routeId];
      return { ...prev, lockedRoutes: updated };
    });
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      let headers: string[] = [];
      let rawData: any[] = [];
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const headerRow = ws ? (XLSX.utils.sheet_to_json(ws, { header: 1 })[0] as any[] | undefined) : undefined;
        headers = Array.from(headerRow || [], h => (h === undefined || h === null ? '' : String(h))).filter(h => h.trim() !== '');
        rawData = ws ? (XLSX.utils.sheet_to_json(ws) as any[]) : [];
      } catch {
        setSaveNotification('Не удалось прочитать файл Excel. Проверьте формат файла (.xlsx, .xls, .csv).');
        return;
      }
      if (headers.length === 0 || rawData.length === 0) {
        setSaveNotification('Файл Excel пустой или в первой строке нет заголовков столбцов.');
        return;
      }
      // Filter out completely blank rows
      const data = rawData.filter(row => {
        if (!row || typeof row !== 'object') return false;
        return Object.values(row).some(v => v !== undefined && v !== null && String(v).trim() !== '');
      });

      const initialMapping: Record<string, string> = {};
      let allFound = true;

      REQUIRED_FIELDS.forEach(field => {
        const foundHeader = headers.find(h => 
          String(h).toLowerCase().trim() === field.label.toLowerCase().trim() || 
          (field.synonyms || []).includes(String(h).toLowerCase().trim())
        );
        if (foundHeader) {
          initialMapping[field.key] = String(foundHeader);
        } else if (!field.optional) {
          allFound = false;
        }
      });

      if (allFound) {
        processImportedData(data, initialMapping);
      } else {
        setExcelMapping({
          show: true,
          data,
          headers: headers.map(String),
          mapping: initialMapping
        });
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const processImportedData = async (data: any[], mapping: Record<string, string>) => {
    const cleanDate = (val: any): string => {
      const normalized = normalizeDateStr(val);
      if (normalized) return normalized;
      const today = new Date();
      return `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
    };

    // Filter out rows that have no order number or customer name
    const validRows = data.filter(row => {
      const ordNum = mapping['orderNumber'] ? row[mapping['orderNumber']] : undefined;
      const custName = mapping['customerName'] ? row[mapping['customerName']] : undefined;
      const wt = mapping['weight'] ? row[mapping['weight']] : undefined;
      const vol = mapping['volume'] ? row[mapping['volume']] : undefined;
      return (ordNum !== undefined && String(ordNum).trim() !== '') ||
             (custName !== undefined && String(custName).trim() !== '') ||
             (wt !== undefined && String(wt).trim() !== '') ||
             (vol !== undefined && String(vol).trim() !== '');
    });

    const newOrders: Order[] = validRows.map((row, index) => {
      const dayVal = mapping['days'] ? row[mapping['days']] : undefined;
      const dayStr = String(dayVal || '');
      const days = dayStr.replace(/[^1-7]/g, '').split('').map(Number);
      
      const rawDateVal = mapping['shippingDate'] ? row[mapping['shippingDate']] : undefined;
      const shippingDate = cleanDate(rawDateVal);

      const rawRouteVal = mapping['routeId'] ? row[mapping['routeId']] : undefined;
      let routeStr = '';
      if (rawRouteVal !== undefined && rawRouteVal !== null) {
        routeStr = String(rawRouteVal).trim();
      }
      const hasRoute = routeStr !== '' && 
                       routeStr !== '-' && 
                       routeStr.toLowerCase() !== 'undefined' && 
                       routeStr.toLowerCase() !== 'null' && 
                       routeStr.toLowerCase() !== 'нет';

      const rawDistVal = mapping['distance'] ? row[mapping['distance']] : undefined;
      let parsedDist: number | undefined = undefined;
      if (rawDistVal !== undefined && rawDistVal !== null && String(rawDistVal).trim() !== '') {
        const num = parseExcelNumber(rawDistVal, -1);
        if (num >= 0) parsedDist = num;
      }

      // Robust coordinate parsing & auto-correction
      let lat = parseExcelNumber(mapping['lat'] ? row[mapping['lat']] : undefined, NaN);
      let lng = parseExcelNumber(mapping['lng'] ? row[mapping['lng']] : undefined, NaN);

      // Auto-correct swapped coordinates if detected (e.g. lat > 45 and lng < 45 in Azerbaijan region)
      if (lat > 45 && lng < 43 && lng > 35) {
        const temp = lat;
        lat = lng;
        lng = temp;
      }
      const coordsFromFile = Number.isFinite(lat) && Number.isFinite(lng) && lat >= 30 && lat <= 50 && lng >= 40 && lng <= 60;
      if (!coordsFromFile) {
        // filled from the store directory below, warehouse as the last resort
        lat = WAREHOUSE_LOCATION.lat;
        lng = WAREHOUSE_LOCATION.lng;
      }

      const orderNumber = String(mapping['orderNumber'] && row[mapping['orderNumber']] !== undefined ? row[mapping['orderNumber']] : index + 1).trim();
      const customerName = String(mapping['customerName'] && row[mapping['customerName']] !== undefined ? row[mapping['customerName']] : 'Неизвестно').trim();
      const code = String(mapping['code'] && row[mapping['code']] !== undefined ? row[mapping['code']] : '').trim();
      const region = String(mapping['region'] && row[mapping['region']] !== undefined ? row[mapping['region']] : 'Центр').trim();
      const timeSlot = String(mapping['timeSlot'] && row[mapping['timeSlot']] !== undefined ? row[mapping['timeSlot']] : 'Утро').trim();

      const rawWarehouseType = mapping['warehouseType'] && row[mapping['warehouseType']] !== undefined ? row[mapping['warehouseType']] : undefined;
      const warehouseType = rawWarehouseType !== undefined && rawWarehouseType !== null ? String(rawWarehouseType).trim() : undefined;

      const weight = Math.max(0, parseExcelNumber(mapping['weight'] ? row[mapping['weight']] : undefined, 0));
      const volume = Math.max(0, parseExcelNumber(mapping['volume'] ? row[mapping['volume']] : undefined, 0));
      const satir = Math.max(1, Math.round(parseExcelNumber(mapping['satir'] ? row[mapping['satir']] : undefined, 1)));

      return {
        id: `imp-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
        orderNumber: orderNumber || `${index + 1}`,
        customerName: customerName || 'Неизвестно',
        code: code,
        weight: weight,
        volume: volume,
        region: region || 'Центр',
        satir: satir,
        days: days.length > 0 ? days : [1, 2, 3, 4, 5],
        timeSlot: timeSlot || 'Утро',
        shippingDate: shippingDate,
        distance: parsedDist,
        lat: lat,
        lng: lng,
        status: hasRoute ? 'in-route' : 'not-in-route',
        routeId: hasRoute ? routeStr : undefined,
        allowedTruckType: mapping['allowedTruckType'] && row[mapping['allowedTruckType']] ? String(row[mapping['allowedTruckType']]).trim() : undefined,
        warehouseType: warehouseType || undefined,
        __coordsFromFile: coordsFromFile
      } as Order & { __coordsFromFile?: boolean };
    });

    // Store directory: restore missing/invalid coordinates, then remember every store of this import
    const lookupStore = buildStoreLookup(storeDirectory);
    const trustedIds = new Set<string>();
    let restoredCoords = 0;
    let withoutCoords = 0;
    for (const o of newOrders as (Order & { __coordsFromFile?: boolean })[]) {
      if (o.__coordsFromFile) {
        trustedIds.add(o.id);
      } else {
        const known = lookupStore(o.code, o.customerName);
        if (known && Number.isFinite(known.lat) && Number.isFinite(known.lng)) {
          o.lat = known.lat;
          o.lng = known.lng;
          restoredCoords++;
        } else {
          withoutCoords++;
        }
      }
      delete o.__coordsFromFile;
    }
    // The file and the directory may disagree (name, region, coordinates): ask which one is the main source
    const incomingStores = new Map<string, IncomingStore>();
    for (const o of newOrders) {
      if (!o.code && !o.customerName) continue;
      const k = (o.code || o.customerName).trim().toLowerCase();
      if (incomingStores.has(k)) continue;
      incomingStores.set(k, {
        code: o.code || '', name: o.customerName, region: o.region || undefined,
        lat: trustedIds.has(o.id) ? o.lat : null, lng: trustedIds.has(o.id) ? o.lng : null,
      });
    }
    const incomingList = [...incomingStores.values()];
    const dirNow = directoryStore.get();
    const conflicts = findConflicts(dirNow, incomingList);
    const newStores = incomingList.filter(s => !findRecord(dirNow, s.code, s.name)).length;
    const resolution = await askDirectoryConflicts(conflicts, 'Yol · Excel', newStores);
    const resolved = applyIncoming(incomingList, resolution);
    for (const o of newOrders) {
      const rec = resolved.get((o.code || o.customerName).trim().toLowerCase().replace(/\s+/g, ' '));
      if (!rec) continue;
      // where the directory stays the main source, the orders take its values
      if (rec.name) o.customerName = rec.name;
      if (rec.region) o.region = rec.region;
      if (Number.isFinite(rec.lat) && Number.isFinite(rec.lng)) { o.lat = rec.lat; o.lng = rec.lng; }
    }

    // Reconstruct ready-made routes from orders with route numbers
    const importedRouteGroups = new Map<string, Order[]>();
    newOrders.forEach(o => {
      if (o.status === 'in-route' && o.routeId) {
        if (!importedRouteGroups.has(o.routeId)) {
          importedRouteGroups.set(o.routeId, []);
        }
        importedRouteGroups.get(o.routeId)!.push(o);
      }
    });

    const ROUTE_COLORS = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', 
      '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
    ];

    const reconstructedRoutes: Route[] = [];
    let routeIdx = 0;

    importedRouteGroups.forEach((routeOrders, rawRouteId) => {
      const routeName = rawRouteId.toLowerCase().startsWith('маршрут') || rawRouteId.toLowerCase().startsWith('route')
        ? rawRouteId
        : `Маршрут ${rawRouteId}`;
      
      const totalWeight = routeOrders.reduce((sum, o) => sum + o.weight, 0);
      const totalVolume = routeOrders.reduce((sum, o) => sum + o.volume, 0);
      const storesCount = new Set(routeOrders.map(o => o.customerName)).size;

      let dist = 0;
      const explicitDistSum = routeOrders.reduce((sum, o) => sum + (o.distance || 0), 0);
      if (explicitDistSum > 0) {
        dist = Math.round(explicitDistSum * 10) / 10;
      } else {
        let prevLat = WAREHOUSE_LOCATION.lat;
        let prevLng = WAREHOUSE_LOCATION.lng;
        routeOrders.forEach(o => {
          if (o.lat && o.lng) {
            dist += calculateDistance(prevLat, prevLng, o.lat, o.lng);
            prevLat = o.lat;
            prevLng = o.lng;
          }
        });
        if (routeOrders.length > 0) {
          dist += calculateDistance(prevLat, prevLng, WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng);
        }
        dist = Math.round(dist * 10) / 10;
      }

      const routeObj: Route = {
        id: rawRouteId,
        name: routeName,
        color: ROUTE_COLORS[routeIdx % ROUTE_COLORS.length],
        orderIds: routeOrders.map(o => o.id),
        distance: dist,
        isVisible: true,
        isImported: true
      };

      reconstructedRoutes.push(routeObj);
      routeIdx++;
    });

    setOrders(newOrders);
    setRoutes(reconstructedRoutes);
    setExcelMapping({ show: false, data: [], headers: [], mapping: {} });
    setSelectedShippingDates([]);
    const directoryNote = [
      newStores > 0 ? `в справочник добавлено магазинов: ${newStores}` : '',
      resolution.size > 0 ? `обновлено из файла: ${new Set([...resolution.keys()].map(k => k.split('|')[0])).size}` : '',
      restoredCoords > 0 ? `координаты из справочника: ${restoredCoords}` : '',
      withoutCoords > 0 ? `без координат (поставлены на склад): ${withoutCoords}` : ''
    ].filter(Boolean).join(', ');
    setSaveNotification((reconstructedRoutes.length > 0
      ? `Импортировано ${newOrders.length} заказов и воссоздано ${reconstructedRoutes.length} готовых маршрутов!`
      : `Успешно импортировано ${newOrders.length} заказов`) + (directoryNote ? ` (${directoryNote})` : '')
    );
    setTimeout(() => setSaveNotification(null), 6000);

    // Calculate background geometry & road navigation details for imported routes in batches
    if (reconstructedRoutes.length > 0) {
      setTimeout(async () => {
        setIsCalculatingGeometry(true);
        const orderMap = new Map(newOrders.map(o => [o.id, o]));
        for (const route of reconstructedRoutes) {
          const routeOrders = route.orderIds
            .map(id => orderMap.get(id))
            .filter((o): o is Order => Boolean(o));
          if (routeOrders.length === 0) continue;
          const points = [
            WAREHOUSE_LOCATION,
            ...routeOrders.map(o => ({ lat: o.lat, lng: o.lng })),
            WAREHOUSE_LOCATION
          ];
          try {
            const nav = await getRouteNavDetails(points);
            setRoutes(prev => prev.map(r => r.id === route.id ? applyNavDetailsToRoute(r, routeOrders, nav) : r));
          } catch {
            // fallback already preserved on route
          }
          await new Promise(res => setTimeout(res, 60));
        }
        setIsCalculatingGeometry(false);
      }, 100);
    }
  };

  const handleExportTemplate = () => {
    const template = [
      {
        'номер заказа': '123',
        'название магазина': 'Магазин 1',
        'код': 'C001',
        'день': '1,2,3',
        'регион': 'Нариманов',
        'время': 'Утро',
        'дата отправки': '07.07.2026',
        'тип склада': 'Основной склад',
        'обьем заказа': 1.5,
        'вес': 100,
        'sətir': 5,
        'тип грузовика': 'type-b',
        'дистанция (км)': 12.5,
        'широта': 40.5346,
        'долгота': 49.9524,
        'номер маршрута': 'Маршрут 1'
      }
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "route_template.xlsx");
  };

  const handleExportData = () => {
    const wb = XLSX.utils.book_new();
    const orderMap = new Map(orders.map(o => [o.id, o]));
    
    // 1. Сводная таблица по всем маршрутам (Склад -> Магазины -> Склад)
    const routesSummaryData = routes.map((r, rIdx) => {
      const rOrders = r.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o));
      const weight = rOrders.reduce((s, o) => s + o.weight, 0);
      const volume = rOrders.reduce((s, o) => s + o.volume, 0);
      const truckType = routingLimits.truckTypes?.find(t => t.id === r.truckTypeId);
      const maxW = truckType?.maxWeight || routingLimits.maxWeight;
      const maxV = truckType?.maxVolume || routingLimits.maxVolume;
      const storesCount = new Set(rOrders.map(o => o.customerName)).size;
      const legs = calculateRouteLegs(r, rOrders);
      
      return {
        '№': rIdx + 1,
        'Название маршрута': r.name,
        'Транспорт': truckType ? truckType.name : 'Стандартный',
        'Магазинов (остановок)': storesCount,
        'Заказов всего': rOrders.length,
        'Дистанция Склад → Магазины → Склад (км)': legs.totalRoundTripKm,
        'Выезд со склада (км)': legs.fromWarehouseKm,
        'Между магазинами (км)': legs.betweenStoresKm,
        'Возврат на склад (км)': legs.toWarehouseKm,
        'Время в пути (мин)': r.roadDurationMin ?? r.durationMinutes ?? '',
        'Вес (кг)': Math.round(weight),
        'Загрузка веса (%)': maxW > 0 ? Math.round((weight / maxW) * 100) : 0,
        'Объем (м³)': Number(volume.toFixed(2)),
        'Загрузка объема (%)': maxV > 0 ? Math.round((volume / maxV) * 100) : 0,
        'Тип расчета': r.routingSource || (r.isRealRoad ? 'OSRM' : 'HAVERSINE'),
        'Обоснование / Район': r.description || r.whyThisRoute || ''
      };
    });
    const wsSummary = XLSX.utils.json_to_sheet(routesSummaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Сводка маршрутов");

    // 2. Детализация остановок по маршрутам в порядке объезда (включая возврат на склад)
    const exportData: any[] = [];
    routes.forEach(r => {
      const rOrders = r.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o));
      const legs = calculateRouteLegs(r, rOrders);
      const truckType = r.truckTypeId ? routingLimits.truckTypes?.find(t => t.id === r.truckTypeId) : null;

      rOrders.forEach((o, stopIdx) => {
        exportData.push({
          'Маршрут': r.name,
          'Порядок остановки': stopIdx + 1,
          'Номер заказа': o.orderNumber,
          'Магазин': o.customerName,
          'Код': o.code,
          'Район / Регион': o.region,
          'Вес (кг)': o.weight,
          'Объем (м³)': o.volume,
          'Sətir': o.satir,
          'Время': o.timeSlot,
          'Дата отправки': o.shippingDate || '',
          'Тип склада': o.warehouseType || '',
          'Назначенный грузовик': truckType ? truckType.name : '',
          'Широта': o.lat,
          'Долгота': o.lng
        });
      });

      if (rOrders.length > 0) {
        exportData.push({
          'Маршрут': r.name,
          'Порядок остановки': `${rOrders.length + 1} (Возврат)`,
          'Номер заказа': 'СКЛАД',
          'Магазин': `Возврат на склад (${legs.returnLeg.fromName} → Склад: ${legs.toWarehouseKm} км, Итого круг: ${legs.totalRoundTripKm} км)`,
          'Код': 'DEPOT',
          'Район / Регион': 'Склад (Баку)',
          'Вес (кг)': 0,
          'Объем (м³)': 0,
          'Sətir': 0,
          'Время': '',
          'Дата отправки': '',
          'Тип склада': '',
          'Назначенный грузовик': truckType ? truckType.name : '',
          'Широта': WAREHOUSE_LOCATION.lat,
          'Долгота': WAREHOUSE_LOCATION.lng
        });
      }
    });

    // Добавляем оставшиеся заказы не в маршруте, если есть
    const unroutedOrders = orders.filter(o => !routes.some(r => r.orderIds.includes(o.id)));
    unroutedOrders.forEach(o => {
      exportData.push({
        'Маршрут': 'Не распределен',
        'Порядок остановки': '',
        'Номер заказа': o.orderNumber,
        'Магазин': o.customerName,
        'Код': o.code,
        'Район / Регион': o.region,
        'Вес (кг)': o.weight,
        'Объем (м³)': o.volume,
        'Sətir': o.satir,
        'Время': o.timeSlot,
        'Дата отправки': o.shippingDate || '',
        'Тип склада': o.warehouseType || '',
        'Назначенный грузовик': '',
        'Широта': o.lat,
        'Долгота': o.lng
      });
    });

    const wsStops = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, wsStops, "Точки и остановки");

    // Other versions (если есть сохраненные версии)
    // Excel sheet names: max 31 chars, unique, without : \ / ? * [ ]
    const usedSheetNames = new Set(wb.SheetNames.map(n => n.toLowerCase()));
    const makeSheetName = (raw: string) => {
      const base = (raw || 'Сценарий').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Сценарий';
      let name = base;
      for (let i = 2; usedSheetNames.has(name.toLowerCase()); i++) {
        const suffix = ` (${i})`;
        name = base.slice(0, 31 - suffix.length) + suffix;
      }
      usedSheetNames.add(name.toLowerCase());
      return name;
    };
    (routeVersions || []).forEach(v => {
      const vData = (v.orders || []).map(o => {
        const route = (v.routes || []).find(r => r.id === o.routeId);
        const truckType = route?.truckTypeId ? routingLimits.truckTypes?.find(t => t.id === route.truckTypeId) : null;
        return {
          'Маршрут': route ? route.name : '',
          'Номер заказа': o.orderNumber,
          'Магазин': o.customerName,
          'Код': o.code,
          'Вес (кг)': o.weight,
          'Объем (м³)': o.volume,
          'Регион': o.region,
          'Время': o.timeSlot,
          'Дата отправки': o.shippingDate || '',
          'Назначенный грузовик': truckType ? truckType.name : '',
          'Широта': o.lat,
          'Долгота': o.lng
        };
      });
      const vWs = XLSX.utils.json_to_sheet(vData);
      XLSX.utils.book_append_sheet(wb, vWs, makeSheetName(v.name));
    });

    XLSX.writeFile(wb, "routes_export.xlsx");
    setSaveNotification('Маршруты успешно экспортированы в Excel (routes_export.xlsx)');
  };

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const stores = useMemo(() => {
    const storeMap = new Map<string, Store>();
    (orders || []).forEach(order => {
      const existing = storeMap.get(order.customerName);
      const normDate = normalizeDateStr(order.shippingDate);
      if (existing) {
        existing.orders.push(order);
        existing.totalWeight += order.weight;
        existing.totalVolume += order.volume;
        existing.totalSatir += order.satir;
        existing.orderCount += 1;
        if (!existing.warehouseType && order.warehouseType) {
          existing.warehouseType = order.warehouseType;
        }
        if (order.warehouseType) {
          if (!existing.warehouseTypes) existing.warehouseTypes = [];
          if (!existing.warehouseTypes.includes(order.warehouseType)) {
            existing.warehouseTypes.push(order.warehouseType);
          }
        }
        existing.days = Array.from(new Set([...existing.days, ...order.days])).sort((a, b) => a - b);
        if (!existing.timeSlots.includes(order.timeSlot)) {
          existing.timeSlots.push(order.timeSlot);
        }
        if (normDate && !existing.shippingDates.includes(normDate)) {
          existing.shippingDates.push(normDate);
        }
      } else {
        storeMap.set(order.customerName, {
          name: order.customerName,
          orders: [order],
          totalWeight: order.weight,
          totalVolume: order.volume,
          totalSatir: order.satir,
          orderCount: 1,
          region: order.region,
          days: order.days,
          timeSlots: [order.timeSlot],
          shippingDates: normDate ? [normDate] : [],
          warehouseType: order.warehouseType,
          warehouseTypes: order.warehouseType ? [order.warehouseType] : [],
          lat: order.lat,
          lng: order.lng
        });
      }
    });
    return Array.from(storeMap.values());
  }, [orders]);

  // Order-level filter matching for full consistency across left list, map, stats, and selection
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesSearch = 
          order.customerName.toLowerCase().includes(q) || 
          order.code.toLowerCase().includes(q) ||
          (order.orderNumber && order.orderNumber.toLowerCase().includes(q));
        if (!matchesSearch) return false;
      }

      // Days filter: MUST match ALL selected days (AND logic)
      if (selectedDays.length > 0) {
        const matchesDay = selectedDays.every(d => order.days.includes(d));
        if (!matchesDay) return false;
      }

      // Region filter: match ANY selected region
      if (selectedRegions.length > 0) {
        if (!selectedRegions.includes(order.region)) return false;
      }

      // Time filter: match ANY selected time slot
      if (selectedTimes.length > 0) {
        if (!selectedTimes.includes(order.timeSlot)) return false;
      }

      // Status filter: match ANY selected status
      if (selectedStatuses.length > 0) {
        if (!selectedStatuses.includes(order.status)) return false;
      }

      // Truck type filter: match ANY selected truck type
      if (selectedTruckTypes.length > 0) {
        if (!order.allowedTruckType || !selectedTruckTypes.includes(order.allowedTruckType)) return false;
      }

      // Shipping Date filter: match ANY selected shipping date
      if (selectedShippingDates.length > 0) {
        const normDate = normalizeDateStr(order.shippingDate);
        const matchesShippingDate = selectedShippingDates.some(d => normalizeDateStr(d) === normDate);
        if (!matchesShippingDate) return false;
      }

      // Warehouse type filter: match ANY selected warehouse type
      if (selectedWarehouseTypes.length > 0) {
        const wType = order.warehouseType || 'Не указан';
        if (!selectedWarehouseTypes.includes(wType)) return false;
      }

      return true;
    });
  }, [orders, searchQuery, selectedDays, selectedRegions, selectedTimes, selectedStatuses, selectedTruckTypes, selectedShippingDates, selectedWarehouseTypes]);

  // Aggregated filtered stores containing ONLY matching orders
  const filteredStores = useMemo(() => {
    const storeMap = new Map<string, Store>();
    (filteredOrders || []).forEach(order => {
      const existing = storeMap.get(order.customerName);
      const normDate = normalizeDateStr(order.shippingDate);
      if (existing) {
        existing.orders.push(order);
        existing.totalWeight += order.weight;
        existing.totalVolume += order.volume;
        existing.totalSatir += order.satir;
        existing.orderCount += 1;
        if (!existing.warehouseType && order.warehouseType) {
          existing.warehouseType = order.warehouseType;
        }
        if (order.warehouseType) {
          if (!existing.warehouseTypes) existing.warehouseTypes = [];
          if (!existing.warehouseTypes.includes(order.warehouseType)) {
            existing.warehouseTypes.push(order.warehouseType);
          }
        }
        existing.days = Array.from(new Set([...existing.days, ...order.days])).sort((a, b) => a - b);
        if (!existing.timeSlots.includes(order.timeSlot)) {
          existing.timeSlots.push(order.timeSlot);
        }
        if (normDate && !existing.shippingDates.includes(normDate)) {
          existing.shippingDates.push(normDate);
        }
      } else {
        storeMap.set(order.customerName, {
          name: order.customerName,
          orders: [order],
          totalWeight: order.weight,
          totalVolume: order.volume,
          totalSatir: order.satir,
          orderCount: 1,
          region: order.region,
          days: order.days,
          timeSlots: [order.timeSlot],
          shippingDates: normDate ? [normDate] : [],
          warehouseType: order.warehouseType,
          warehouseTypes: order.warehouseType ? [order.warehouseType] : [],
          lat: order.lat,
          lng: order.lng
        });
      }
    });

    let result = Array.from(storeMap.values());

    if (rangeValues.min || rangeValues.max) {
      result = result.filter(store => {
        const val = rangeType === 'volume' ? store.totalVolume : rangeType === 'weight' ? store.totalWeight : store.totalSatir;
        return (!rangeValues.min || val >= Number(rangeValues.min)) &&
               (!rangeValues.max || val <= Number(rangeValues.max));
      });
    }

    return result;
  }, [filteredOrders, rangeType, rangeValues]);

  const stats = useMemo(() => {
    // Top panel stats don't react to filters
    const totalWeight = orders.reduce((sum, o) => sum + o.weight, 0);
    const totalVolume = orders.reduce((sum, o) => sum + o.volume, 0);
    const totalSatir = orders.reduce((sum, o) => sum + o.satir, 0);
    
    const inRouteOrders = orders.filter(o => o.status === 'in-route');
    const inRouteWeight = inRouteOrders.reduce((sum, o) => sum + o.weight, 0);
    const inRouteVolume = inRouteOrders.reduce((sum, o) => sum + o.volume, 0);
    const inRouteSatir = inRouteOrders.reduce((sum, o) => sum + o.satir, 0);

    const totalDistance = routes.reduce((sum, r) => sum + r.distance, 0);

    return {
      total: { orders: orders.length, customers: stores.length, weight: totalWeight, volume: totalVolume, satir: totalSatir },
      inRoute: { orders: inRouteOrders.length, customers: new Set(inRouteOrders.map(o => o.customerName)).size, weight: inRouteWeight, volume: inRouteVolume, satir: inRouteSatir, routeCount: routes.length, distance: totalDistance },
      notInRoute: { orders: orders.length - inRouteOrders.length, customers: new Set(orders.filter(o => o.status !== 'in-route').map(o => o.customerName)).size, weight: totalWeight - inRouteWeight, volume: totalVolume - inRouteVolume, satir: totalSatir - inRouteSatir }
    };
  }, [orders, stores, routes]);

  const filteredStats = useMemo(() => {
    const weight = filteredStores.reduce((sum, s) => sum + s.totalWeight, 0);
    const volume = filteredStores.reduce((sum, s) => sum + s.totalVolume, 0);
    const satir = filteredStores.reduce((sum, s) => sum + s.totalSatir, 0);
    const ordersCount = filteredStores.reduce((sum, s) => sum + s.orderCount, 0);
    return { weight, volume, satir, ordersCount, customers: filteredStores.length };
  }, [filteredStores]);

  const filteredWarehouseStats = useMemo(() => {
    const countsMap = new Map<string, { count: number; volume: number; weight: number }>();
    (filteredOrders || []).forEach(o => {
      const wt = o.warehouseType || 'Не указан';
      const existing = countsMap.get(wt) || { count: 0, volume: 0, weight: 0 };
      existing.count += 1;
      existing.volume += o.volume;
      existing.weight += o.weight;
      countsMap.set(wt, existing);
    });
    const breakdown = Array.from(countsMap.entries()).map(([name, data]) => ({
      name,
      ordersCount: data.count,
      volume: data.volume,
      weight: data.weight
    }));
    return {
      breakdown,
      uniqueCount: countsMap.size,
      primaryType: breakdown.length === 1 ? breakdown[0].name : (breakdown.length > 1 ? `${breakdown.length} типов` : '—')
    };
  }, [filteredOrders]);

  const planValidationResult = useMemo(() => {
    return validateRoutePlan(routes, orders, routingLimits);
  }, [routes, orders, routingLimits]);

  const handleAddStreet = () => {
    if (!newStreetName) return;
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    setStreetHighlights([...streetHighlights, { id: Date.now().toString(), name: newStreetName, color: randomColor }]);
    setNewStreetName('');
  };

  const handleCreateRoute = (explicitOrderIds?: string[]) => {
    // Explicit ids are passed by callers that cannot wait for a selection state update (e.g. streets panel)
    const orderMapById = new Map(orders.map(o => [o.id, o]));
    const idsForRoute = Array.from(new Set(Array.isArray(explicitOrderIds) ? explicitOrderIds : selectedOrderIds))
      .filter(id => orderMapById.has(id));
    if (idsForRoute.length === 0) return;
    const idSet = new Set(idsForRoute);
    const prevRoutes = [...routes];
    const prevOrders = [...orders];
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const routeOrders = idsForRoute.map(id => orderMapById.get(id)!);
    const newRouteId = Date.now().toString();

    // Calculate initial straight line distance
    let dist = 0;
    let prevLat = WAREHOUSE_LOCATION.lat;
    let prevLng = WAREHOUSE_LOCATION.lng;
    routeOrders.forEach(o => {
      if (o.lat && o.lng) {
        dist += calculateDistance(prevLat, prevLng, o.lat, o.lng);
        prevLat = o.lat;
        prevLng = o.lng;
      }
    });
    if (routeOrders.length > 0) {
      dist += calculateDistance(prevLat, prevLng, WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng);
    }
    dist = Math.round(dist * 10) / 10;

    const newRoute: Route = {
      id: newRouteId,
      name: `Маршрут ${routes.length + 1}`,
      color: randomColor,
      orderIds: [...idsForRoute],
      isVisible: true,
      distance: dist,
      isRealRoad: false
    };

    // Orders can belong to only one route: detach them from their previous routes
    const affectedRoutes = prevRoutes.filter(r => r.orderIds.some(id => idSet.has(id)));
    const nextRoutes = [
      ...prevRoutes
        .map(r => affectedRoutes.includes(r) ? { ...r, orderIds: r.orderIds.filter(id => !idSet.has(id)) } : r)
        .filter(r => r.orderIds.length > 0),
      newRoute
    ];
    const nextOrders = prevOrders.map(o => idSet.has(o.id) ? { ...o, status: 'in-route' as const, routeId: newRoute.id } : o);
    setRoutes(nextRoutes);
    setOrders(nextOrders);
    setSelectedOrderIds([]);
    affectedRoutes.forEach(r => {
      const remainingIds = r.orderIds.filter(id => !idSet.has(id));
      if (remainingIds.length > 0) recalculateRouteRoundTrip(r.id, remainingIds);
    });

    routeHistoryService.recordChange({
      action: 'Создание маршрута',
      description: `Создан "${newRoute.name}" с ${idsForRoute.length} заказами`,
      routesBefore: prevRoutes,
      routesAfter: nextRoutes,
      ordersBefore: prevOrders,
      ordersAfter: nextOrders,
      source: 'manual'
    });

    // Async fetch OSRM navigation path & real road distance (Warehouse -> Stores -> Warehouse)
    const points = [
      WAREHOUSE_LOCATION,
      ...routeOrders.map(o => ({ lat: o.lat, lng: o.lng })),
      WAREHOUSE_LOCATION
    ];
    getRouteNavDetails(points).then(nav => {
      setRoutes(prev => prev.map(r => r.id === newRouteId ? applyNavDetailsToRoute(r, routeOrders, nav) : r));
    }).catch(() => {});
  };

  const handleBulkSelectAll = (orderIds: string[]) => {
    setSelectedOrderIds(orderIds);
  };

  const handleBulkClearSelection = () => {
    setSelectedOrderIds([]);
  };

  const handleBulkDeleteOrders = (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    const count = orderIds.length;
    const deleteSet = new Set(orderIds);
    const affectedRoutes = routes.filter(r => r.orderIds.some(id => deleteSet.has(id)));
    setOrders(prev => prev.filter(o => !deleteSet.has(o.id)));
    setRoutes(prev => prev.map(r => ({
      ...r,
      orderIds: r.orderIds.filter(id => !deleteSet.has(id))
    })).filter(r => r.orderIds.length > 0));
    setSelectedOrderIds(prev => prev.filter(id => !deleteSet.has(id)));

    affectedRoutes.forEach(r => {
      const remainingIds = r.orderIds.filter(id => !deleteSet.has(id));
      if (remainingIds.length > 0) {
        recalculateRouteRoundTrip(r.id, remainingIds);
      }
    });

    setSaveNotification(`Удалено ${count} заказов`);
    setTimeout(() => setSaveNotification(null), 3500);
  };

  const handleBulkAssignRegion = (orderIds: string[], newRegion: string) => {
    if (orderIds.length === 0 || !newRegion) return;
    setOrders(prev => prev.map(o => orderIds.includes(o.id) ? { ...o, region: newRegion } : o));
    setSaveNotification(`Регион "${newRegion}" назначен для ${orderIds.length} заказов`);
    setTimeout(() => setSaveNotification(null), 3500);
  };

  const handleBulkAssignRoute = (orderIds: string[], targetRouteId: string) => {
    if (orderIds.length === 0 || !targetRouteId) return;
    const targetRoute = routes.find(r => r.id === targetRouteId);
    if (!targetRoute) return;

    const prevRoutes = [...routes];
    const prevOrders = [...orders];

    const mergedOrderIds = Array.from(new Set([...targetRoute.orderIds, ...orderIds]));
    const orderMap = new Map(orders.map(o => [o.id, o]));
    const routeOrders = mergedOrderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o));
    const straightKm = calculateStraightRouteDistance(routeOrders);

    // Orders can belong to only one route: detach them from any other route first
    const moveSet = new Set(orderIds);
    const otherAffectedRoutes = routes.filter(r => r.id !== targetRouteId && r.orderIds.some(id => moveSet.has(id)));
    const nextRoutes = routes
      .map(r => {
        if (r.id === targetRouteId) {
          return { ...r, orderIds: mergedOrderIds, distance: straightKm, straightDistanceKm: straightKm };
        }
        return otherAffectedRoutes.includes(r) ? { ...r, orderIds: r.orderIds.filter(id => !moveSet.has(id)) } : r;
      })
      .filter(r => r.id === targetRouteId || r.orderIds.length > 0);
    const nextOrders = orders.map(o => moveSet.has(o.id) ? { ...o, status: 'in-route' as const, routeId: targetRouteId } : o);

    setRoutes(nextRoutes);
    setOrders(nextOrders);
    setSelectedOrderIds([]);
    otherAffectedRoutes.forEach(r => {
      const remainingIds = r.orderIds.filter(id => !moveSet.has(id));
      if (remainingIds.length > 0) recalculateRouteRoundTrip(r.id, remainingIds);
    });
    setSaveNotification(`Добавлено ${orderIds.length} заказов в маршрут "${targetRoute.name}"`);
    setTimeout(() => setSaveNotification(null), 3500);

    routeHistoryService.recordChange({
      action: 'Добавление в маршрут',
      actionType: 'order_added',
      description: `Добавлено ${orderIds.length} заказов в маршрут "${targetRoute.name}"`,
      routesBefore: prevRoutes,
      routesAfter: nextRoutes,
      ordersBefore: prevOrders,
      ordersAfter: nextOrders,
      source: 'manual'
    });

    const points = [
      WAREHOUSE_LOCATION,
      ...routeOrders.map(o => ({ lat: o.lat, lng: o.lng })),
      WAREHOUSE_LOCATION
    ];
    getRouteNavDetails(points).then(nav => {
      setRoutes(prev => prev.map(r => r.id === targetRouteId ? applyNavDetailsToRoute(r, routeOrders, nav) : r));
    }).catch(() => {});
  };

  const handleBulkRemoveFromRoute = (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    const prevRoutes = [...routes];
    const prevOrders = [...orders];
    const removeSet = new Set(orderIds);
    const affectedRoutes = routes.filter(r => r.orderIds.some(id => removeSet.has(id)));

    const nextRoutes = routes.map(r => ({
      ...r,
      orderIds: r.orderIds.filter(id => !removeSet.has(id))
    })).filter(r => r.orderIds.length > 0);

    const nextOrders = orders.map(o => removeSet.has(o.id) ? { ...o, status: 'not-in-route' as const, routeId: undefined } : o);

    setRoutes(nextRoutes);
    setOrders(nextOrders);
    setSaveNotification(`Снят маршрут с ${orderIds.length} заказов`);
    setTimeout(() => setSaveNotification(null), 3500);

    affectedRoutes.forEach(r => {
      const remainingIds = r.orderIds.filter(id => !removeSet.has(id));
      if (remainingIds.length > 0) {
        recalculateRouteRoundTrip(r.id, remainingIds);
      }
    });

    routeHistoryService.recordChange({
      action: 'Снятие с маршрута',
      actionType: 'order_removed',
      description: `Снято ${orderIds.length} заказов с маршрутов`,
      routesBefore: prevRoutes,
      routesAfter: nextRoutes,
      ordersBefore: prevOrders,
      ordersAfter: nextOrders,
      source: 'manual'
    });
  };

  const handleBulkChangeShippingDate = (orderIds: string[], newDate: string) => {
    if (orderIds.length === 0) return;
    const normDate = normalizeDateStr(newDate) || newDate;
    setOrders(prev => prev.map(o => orderIds.includes(o.id) ? { ...o, shippingDate: normDate } : o));
    setSaveNotification(`Дата доставки обновлена для ${orderIds.length} заказов`);
    setTimeout(() => setSaveNotification(null), 3500);
  };

  const handleBulkChangeTimeSlot = (orderIds: string[], newTimeSlot: string) => {
    if (orderIds.length === 0 || !newTimeSlot) return;
    setOrders(prev => prev.map(o => orderIds.includes(o.id) ? { ...o, timeSlot: newTimeSlot } : o));
    setSaveNotification(`Окно времени обновлено для ${orderIds.length} заказов`);
    setTimeout(() => setSaveNotification(null), 3500);
  };

  const toggleDateGroupCollapse = (date: string) => {
    setCollapsedDateGroups(prev => ({
      ...prev,
      [date]: !prev[date]
    }));
  };

  const handleCreateRouteForDateOrders = (orderList: Order[], dateTitle: string) => {
    if (orderList.length === 0) return;
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const orderIds = orderList.map(o => o.id);
    const newRouteId = Date.now().toString();
    const dist = calculateStraightRouteDistance(orderList);

    const newRoute: Route = {
      id: newRouteId,
      name: `Маршрут (${dateTitle})`,
      color: randomColor,
      orderIds: [...orderIds],
      isVisible: true,
      distance: dist,
      straightDistanceKm: dist,
      isRealRoad: false
    };

    const prevRoutes = [...routes];
    const prevOrders = [...orders];
    const nextRoutes = [...routes, newRoute];
    const nextOrders = orders.map(o => orderIds.includes(o.id) ? { ...o, status: 'in-route' as const, routeId: newRoute.id } : o);

    setRoutes(nextRoutes);
    setOrders(nextOrders);
    setSaveNotification(`Создан маршрут для даты ${dateTitle} (${orderList.length} заказов)`);
    setTimeout(() => setSaveNotification(null), 3000);

    routeHistoryService.recordChange({
      action: 'Создание маршрута',
      actionType: 'route_created',
      description: `Создан "${newRoute.name}" (${orderList.length} заказов)`,
      routesBefore: prevRoutes,
      routesAfter: nextRoutes,
      ordersBefore: prevOrders,
      ordersAfter: nextOrders,
      source: 'manual'
    });

    const points = [
      WAREHOUSE_LOCATION,
      ...orderList.map(o => ({ lat: o.lat, lng: o.lng })),
      WAREHOUSE_LOCATION
    ];
    getRouteNavDetails(points).then(nav => {
      setRoutes(prev => prev.map(r => r.id === newRouteId ? applyNavDetailsToRoute(r, orderList, nav) : r));
    }).catch(() => {});
  };

  const handleToggleDateRoutesVisibility = (dateRoutes: Route[]) => {
    if (dateRoutes.length === 0) return;
    const allVisible = dateRoutes.every(r => r.isVisible);
    const targetState = !allVisible;
    const dateRouteIds = new Set(dateRoutes.map(r => r.id));
    setRoutes(prev => prev.map(r => dateRouteIds.has(r.id) ? { ...r, isVisible: targetState } : r));
  };

  const handleExportRoutesToPdf = async () => {
    if (routes.length === 0) {
      setSaveNotification('Нет маршрутов для экспорта!');
      setTimeout(() => setSaveNotification(null), 3000);
      return;
    }
    const success = await exportRoutesToPdf({
      routes,
      orders,
      truckTypes: routingLimits.truckTypes,
      title: 'Отчет по маршрутам доставки'
    });
    if (success) {
      setSaveNotification('PDF-отчет успешно сформирован!');
      setTimeout(() => setSaveNotification(null), 3500);
    }
  };

  const handleExportDateRoutesToPdf = async (group: any) => {
    const success = await exportRoutesToPdf({
      routes: group.routes,
      orders,
      truckTypes: routingLimits.truckTypes,
      title: `Отчет по маршрутам на ${group.date}`
    });
    if (success) {
      setSaveNotification(`PDF-отчет для даты ${group.date} сформирован!`);
      setTimeout(() => setSaveNotification(null), 3000);
    }
  };

  const handleClearCreatedRoutes = () => {
    const prevRoutes = [...routes];
    const prevOrders = [...orders];
    const nextRoutes = routes.filter(r => r.isImported);
    // Keep assignments only for orders that still belong to a remaining (imported) route
    const keptOrderRoute = new Map<string, string>();
    nextRoutes.forEach(r => r.orderIds.forEach(id => keptOrderRoute.set(id, r.id)));
    const nextOrders = orders.map(o => keptOrderRoute.has(o.id)
      ? { ...o, status: 'in-route' as const, routeId: keptOrderRoute.get(o.id) }
      : { ...o, status: 'not-in-route' as const, routeId: undefined });
    setRoutes(nextRoutes);
    setOrders(nextOrders);
    routeHistoryService.recordChange({
      action: 'Очистка созданных маршрутов',
      actionType: 'route_deleted',
      description: `Удалено ${prevRoutes.length - nextRoutes.length} созданных маршрутов`,
      routesBefore: prevRoutes,
      routesAfter: nextRoutes,
      ordersBefore: prevOrders,
      ordersAfter: nextOrders,
      source: 'manual'
    });
  };

  const handleDeleteRoute = (routeId: string) => {
    const targetRoute = routes.find(r => r.id === routeId);
    const nextRoutes = routes.filter(r => r.id !== routeId);
    const nextOrders = orders.map(o => o.routeId === routeId ? { ...o, status: 'not-in-route' as const, routeId: undefined } : o);
    setRoutes(nextRoutes);
    setOrders(nextOrders);
    if (selectedRouteId === routeId) setSelectedRouteId(null);
    routeHistoryService.recordChange({
      action: 'Удаление маршрута',
      actionType: 'route_deleted',
      description: `Удален маршрут "${targetRoute?.name || routeId}"`,
      routesBefore: routes,
      routesAfter: nextRoutes,
      ordersBefore: orders,
      ordersAfter: nextOrders,
      source: 'manual'
    });
  };

  const handleClearAllRoutes = () => {
    if (routes.length === 0) return;
    const prevRoutes = [...routes];
    const prevOrders = [...orders];
    const nextOrders = orders.map(o => ({ ...o, status: 'not-in-route' as const, routeId: undefined }));
    setRoutes([]);
    setOrders(nextOrders);
    setSelectedRouteId(null);
    routeHistoryService.recordChange({
      action: 'Очистка всех маршрутов',
      actionType: 'route_deleted',
      description: `Удалено ${prevRoutes.length} маршрутов`,
      routesBefore: prevRoutes,
      routesAfter: [],
      ordersBefore: prevOrders,
      ordersAfter: nextOrders,
      source: 'manual'
    });
  };

  const dateGroupedRoutes = useMemo(() => {
    const dateSet = new Set<string>();
    (orders || []).forEach(o => {
      const norm = normalizeDateStr(o.shippingDate);
      if (norm) {
        dateSet.add(norm);
      }
    });

    const hasUndatedOrders = orders.some(o => !normalizeDateStr(o.shippingDate));
    const sortedDates = Array.from(dateSet).sort((a, b) => {
      const dateA = parseOrderDate(a);
      const dateB = parseOrderDate(b);
      if (dateA && dateB) return dateA.getTime() - dateB.getTime();
      return a.localeCompare(b);
    });
    if ((hasUndatedOrders || sortedDates.length === 0) && !sortedDates.includes('Без даты')) {
      sortedDates.push('Без даты');
    }
    const cleanSortedDates = Array.from(new Set(sortedDates));

    return cleanSortedDates.map(date => {
      const isUndated = date === 'Без даты';
      const ordersForDate = orders.filter(o => {
        const norm = normalizeDateStr(o.shippingDate);
        return isUndated ? !norm : norm === date;
      });
      const dateOrderIds = new Set(ordersForDate.map(o => o.id));
      
      const routesForDate = routes.filter(r => r.orderIds.some(id => dateOrderIds.has(id)));
      const unassignedOrders = ordersForDate.filter(o => o.status === 'not-in-route');
      const assignedOrders = ordersForDate.filter(o => o.status === 'in-route');
      
      const totalWeight = ordersForDate.reduce((sum, o) => sum + o.weight, 0);
      const totalVolume = ordersForDate.reduce((sum, o) => sum + o.volume, 0);
      const unassignedWeight = unassignedOrders.reduce((sum, o) => sum + o.weight, 0);
      const unassignedVolume = unassignedOrders.reduce((sum, o) => sum + o.volume, 0);
      const totalDistance = routesForDate.reduce((sum, r) => sum + (r.distance || 0), 0);
      const customerCount = new Set(ordersForDate.map(o => o.customerName)).size;

      return {
        date,
        orders: ordersForDate,
        routes: routesForDate,
        unassignedOrders,
        assignedOrders,
        totalWeight,
        totalVolume,
        unassignedWeight,
        unassignedVolume,
        totalDistance,
        customerCount
      };
    }).filter(group => group.orders.length > 0 || group.routes.length > 0);
  }, [orders, routes]);

  // --- Route viewer: summary list, one route in focus over the map, summary table ---
  const [routeListFilter, setRouteListFilter] = useState<RouteListFilter>('all');
  const [routeListSort, setRouteListSort] = useState<RouteListSort>('num');
  const [showRouteSummaryTable, setShowRouteSummaryTable] = useState(false);
  const routeInsights = useMemo(() => buildRouteInsights(routes, orders, routingLimits), [routes, orders, routingLimits]);
  const routeListBase = useMemo(() => {
    if (selectedRouteDateFilter === 'all') return routeInsights;
    const group = dateGroupedRoutes.find(g => g.date === selectedRouteDateFilter);
    if (!group) return routeInsights;
    const ids = new Set(group.routes.map(r => r.id));
    return routeInsights.filter(i => ids.has(i.route.id));
  }, [routeInsights, selectedRouteDateFilter, dateGroupedRoutes]);
  const routeListItems = useMemo(() => orderInsights(routeListBase, routeListFilter, routeListSort), [routeListBase, routeListFilter, routeListSort]);
  const focusedInsight = selectedRouteId ? routeInsights.find(i => i.route.id === selectedRouteId) || null : null;
  const focusedPosition = focusedInsight ? routeListItems.findIndex(i => i.route.id === focusedInsight.route.id) + 1 : 0;

  const stepFocusedRoute = (delta: number) => {
    if (routeListItems.length === 0) return;
    const pos = routeListItems.findIndex(i => i.route.id === selectedRouteId);
    const next = pos < 0 ? 0 : (pos + delta + routeListItems.length) % routeListItems.length;
    const id = routeListItems[next].route.id;
    setHoveredRouteId(null);
    setSelectedRouteId(id);
    document.getElementById(`rv-row-${id}`)?.scrollIntoView({ block: 'nearest' });
  };

  // ←/→ switch the route in focus (not while typing or inside a dialog)
  const stepRef = useRef(stepFocusedRoute);
  stepRef.current = stepFocusedRoute;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || el.closest('[role="dialog"]'))) return;
      if (leftPanelTab !== 'routes' && !selectedRouteId) return;
      e.preventDefault();
      stepRef.current(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leftPanelTab, selectedRouteId]);


  const toggleOrderSelection = (id: string) => {
    setSelectedOrderIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const selectedStats = useMemo(() => {
    const selected = orders.filter(o => selectedOrderIds.includes(o.id));
    return {
      count: selected.length,
      weight: selected.reduce((sum, o) => sum + o.weight, 0),
      volume: selected.reduce((sum, o) => sum + o.volume, 0)
    };
  }, [selectedOrderIds, orders]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft) {
        const newWidth = Math.max(260, Math.min(650, e.clientX));
        setLeftWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
    };

    if (isResizingLeft) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingLeft]);

  // Mobile Android View Branch
  if (viewFormat === 'mobile') {
    const isSmallScreen = typeof window !== 'undefined' && window.innerWidth < 768;
    const mobileContent = (
      <AndroidMobileLayout
        cloudSlot={<CloudSyncButton cloud={cloud} variant="mobile" details={cloudDetails} />}
        barriers={barriers}
        orders={orders}
        filteredOrders={filteredOrders}
        stores={stores}
        filteredStores={filteredStores}
        routes={routes}
        selectedOrderIds={selectedOrderIds}
        onToggleOrder={handleToggleOrder}
        selectedRouteId={selectedRouteId}
        onSelectRoute={setSelectedRouteId}
        hoveredRouteId={hoveredRouteId}
        onHoverRoute={setHoveredRouteId}
        focusedStore={focusedStore}
        onClearSelection={() => {
          setSelectedOrderIds([]);
          setFocusedStore(null);
          setSelectedRouteId(null);
        }}
        onSelectStore={(store) => setFocusedStore(store)}
        onCreateRoute={handleCreateRoute}
        isRouting={isRouting}
        routingProgress={routingProgress}
        setIsRouting={setIsRouting}
        onOpenRouterModal={() => setIsRouterModalOpen(true)}
        onOpenHelpModal={() => setIsHelpOpen(true)}
        onOpenAuditModal={() => setIsValidationModalOpen(true)}
        onImportExcel={handleImportExcel}
        onExportTemplate={handleExportTemplate}
        onUndo={handleUndo}
        canUndo={true}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        onSwitchToDesktop={() => handleSetViewFormat('desktop')}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedShippingDates={selectedShippingDates || []}
        allShippingDates={allOrderShippingDates || []}
        onSelectShippingDate={handleQuickDateSelect}
        truckTypes={routingLimits?.truckTypes || []}
        zones={zones || []}
        streetHighlights={streetHighlights || []}
        onUpdateZonePolygon={(id, polygon) => {
          setZones(prev => prev.map(z => z.id === id ? { ...z, polygon } : z));
        }}
        routeVersions={routeVersions}
        storeMarkerLabelMode={storeMarkerLabelMode}
        showAllRouteLines={showAllRouteLines}
        onToggleAllRouteLines={() => setShowAllRouteLines(!showAllRouteLines)}
      />
    );

    return (
      <div className={cn("w-full h-full h-[100dvh] overflow-hidden flex flex-col bg-background text-foreground", isDarkMode && "dark")}>
        {isSmallScreen || !showDeviceFrame ? (
          <div className="w-full h-full flex-1 overflow-hidden flex flex-col">
            {mobileContent}
          </div>
        ) : (
          <AndroidDeviceFrame
            onSwitchToDesktop={() => handleSetViewFormat('desktop')}
            showDeviceFrame={showDeviceFrame}
            onToggleDeviceFrame={handleToggleDeviceFrame}
          >
            {mobileContent}
          </AndroidDeviceFrame>
        )}
        <DirectoryConflictHost />

        {/* Global Modals for Mobile */}
        <HelpModal 
          isOpen={isHelpOpen} 
          onClose={() => setIsHelpOpen(false)} 
        />
        <RouterModal
          isOpen={isRouterModalOpen}
          onClose={() => setIsRouterModalOpen(false)}
          routingLimits={routingLimits}
          setRoutingLimits={setRoutingLimits}
          selectedAlgorithm={selectedAlgorithm}
          setSelectedAlgorithm={setSelectedAlgorithm}
          isRouting={isRouting}
          onRunRouting={handleRunRouting}
          hasFilteredStores={filteredStores.length > 0}
          onOpenWhatIf={() => setIsWhatIfOpen(true)}
          onOpenConstraints={() => setIsConstraintsOpen(true)}
        />
        <WhatIfModal
          isOpen={isWhatIfOpen}
          onClose={() => setIsWhatIfOpen(false)}
          currentRoutes={routes}
          orders={orders}
          limits={routingLimits}
          onApplyScenario={handleApplyWhatIfScenario}
        />
        <ConstraintsModal
          isOpen={isConstraintsOpen}
          onClose={() => setIsConstraintsOpen(false)}
          limits={routingLimits}
          setLimits={setRoutingLimits}
          orders={orders}
          routes={routes}
        />
        <RouteValidationModal
          isOpen={isValidationModalOpen}
          onClose={() => setIsValidationModalOpen(false)}
          planResult={planValidationResult}
          routes={routes}
          orders={orders}
          truckTypes={routingLimits.truckTypes}
          onSelectRoute={(routeId) => {
            setSelectedRouteId(routeId);
            setIsValidationModalOpen(false);
          }}
        />
        <ExcelMappingModal
          show={excelMapping.show}
          data={excelMapping.data}
          headers={excelMapping.headers}
          mapping={excelMapping.mapping}
          requiredFields={REQUIRED_FIELDS}
          onClose={() => setExcelMapping({ show: false, data: [], headers: [], mapping: {} })}
          onUpdateMapping={(key, val) => {
            setExcelMapping(prev => ({
              ...prev,
              mapping: { ...prev.mapping, [key]: val }
            }));
          }}
          onProcessImport={(data, mapping) => processImportedData(data, mapping)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full h-[100dvh] w-full bg-background text-foreground overflow-hidden font-sans relative">
      {/* Top Panel */}
      <motion.header 
        animate={{ height: isTopCollapsed ? 0 : 'auto', opacity: isTopCollapsed ? 0 : 1 }}
        className={cn(
          "flex items-center justify-between px-3 sm:px-4 py-1.5 border-b bg-card z-[2000] min-h-[50px] relative gap-2 shrink-0",
          isTopCollapsed && "min-h-0 py-0 border-none overflow-hidden"
        )}
      >
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="flex items-center gap-1 sm:gap-1.5 mr-1 sm:mr-2">
            <Button 
              variant={currentPage === 'home' ? 'primary' : 'ghost'} 
              size="sm" 
              onClick={() => setCurrentPage('home')}
              className="px-2.5 sm:px-3 h-8 gap-1.5 text-xs font-semibold"
            >
              <LayoutDashboard size={14} /> 
              <span className="hidden sm:inline">{t('homePage')}</span>
            </Button>
            <Button 
              variant={currentPage === 'routing' ? 'primary' : 'ghost'} 
              size="sm" 
              onClick={() => setCurrentPage('routing')}
              className="px-2.5 sm:px-3 h-8 gap-1.5 text-xs font-semibold"
            >
              <Navigation size={14} /> 
              <span>{t('pageRouting')}</span>
            </Button>
            <Button 
              variant={currentPage === 'rota' ? 'primary' : 'ghost'} 
              size="sm" 
              onClick={() => setCurrentPage('rota')}
              className="px-2.5 sm:px-3 h-8 gap-1.5 text-xs font-semibold"
            >
              <Users size={14} /> 
              <span className="hidden md:inline">{t('pageRota')}</span>
            </Button>
            <Button 
              variant={currentPage === 'forecast' ? 'primary' : 'ghost'} 
              size="sm" 
              onClick={() => setCurrentPage('forecast')}
              className="px-2.5 sm:px-3 h-8 gap-1.5 text-xs font-semibold"
            >
              <TrendingUp size={14} /> 
              <span className="hidden md:inline">{t('pageForecast')}</span>
            </Button>
            <Button 
              variant={currentPage === 'stores' ? 'primary' : 'ghost'} 
              size="sm" 
              onClick={() => setCurrentPage('stores')}
              className="px-2.5 sm:px-3 h-8 gap-1.5 text-xs font-semibold"
            >
              <MapPin size={14} /> 
              <span className="hidden md:inline">{t('pageStores')}</span>
            </Button>
          </div>
          {currentPage === 'routing' && (
            <div className="flex items-center gap-1 sm:gap-1.5">
              <Button 
                variant="primary" 
                size="icon" 
                className="h-8 w-8 shadow-xs cursor-pointer"
                onClick={() => setIsRouterModalOpen(true)}
                title={t('btnRouter')}
              >
                <Sliders size={15} /> 
              </Button>
              <label className="cursor-pointer" title={t('btnImportExcel')}>
                <Input type="file" className="hidden" onChange={handleImportExcel} accept=".xlsx, .xls" />
                <Button variant="outline" size="icon" className="h-8 w-8 pointer-events-none shadow-xs hover:border-primary">
                  <Upload size={15} /> 
                </Button>
              </label>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleExportTemplate} title={t('btnExportTemplate')}>
                <FileSpreadsheet size={15} />
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className={cn(
                  "h-8 px-2 sm:px-2.5 text-xs font-semibold gap-1.5 cursor-pointer shadow-xs",
                  routes.length === 0 ? "opacity-50 pointer-events-none text-muted-foreground" : "hover:border-emerald-500 hover:text-emerald-600 text-foreground border-emerald-500/30 bg-emerald-500/5"
                )} 
                onClick={handleExportData} 
                title="Экспорт сформированных маршрутов в Excel (.xlsx)"
                disabled={routes.length === 0}
              >
                <FileSpreadsheet size={14} className="text-emerald-600 dark:text-emerald-400" />
                <span className="hidden xl:inline">Экспорт маршрутов (.xlsx)</span>
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 xl:gap-3 shrink min-w-0 justify-end">
          {/* Quick Undo & Autosave icon buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="icon"
              onClick={handleUndo}
              className="h-8 w-8 cursor-pointer shadow-xs hover:border-primary"
              title={t('btnUndo')}
            >
              <RotateCcw size={14} className="text-primary" />
            </Button>

            <div 
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-input bg-card/60 relative cursor-default shadow-xs"
              title={isAutosaving ? t('saving') : (lastAutosaveTime ? t('autosavedAt', { time: lastAutosaveTime }) : t('autosave30s'))}
            >
              <Save size={15} className={cn("transition-colors", isAutosaving ? "text-amber-500 animate-pulse" : "text-emerald-500")} />
              <span className={cn("absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ring-1 ring-card", isAutosaving ? "bg-amber-500 animate-ping" : "bg-emerald-500")} />
            </div>

            <CloudSyncButton cloud={cloud} details={cloudDetails} />
          </div>

          <div className="flex items-center gap-2 sm:gap-3 xl:gap-4 shrink min-w-0">
            <StatBlock label={t('statTotal')} data={stats.total} color="text-muted-foreground" rangeType={rangeType} />
            <StatBlock label={t('statInRoute')} data={stats.inRoute} color="text-green-500" isRoute rangeType={rangeType} />
            <StatBlock label={t('statNotInRoute')} data={stats.notInRoute} color="text-orange-500" rangeType={rangeType} />
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Switch to Android Mobile View (Icon button) */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleSetViewFormat('mobile')}
              className="h-8 w-8 hover:border-primary shadow-xs cursor-pointer"
              title={t('viewFormatMobile')}
            >
              <Smartphone size={15} className="text-primary" />
            </Button>
            <LanguageSelector />
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => setIsHelpOpen(true)}
              title={t('btnHelp')}
            >
              <HelpCircle size={17} />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => setIsDarkMode(!isDarkMode)}
              title={isDarkMode ? t('btnLightMode') : t('btnDarkMode')}
            >
              {isDarkMode ? <Sun size={17} /> : <Moon size={17} />}
            </Button>
          </div>
        </div>
      </motion.header>

      {/* Toggle Button Top */}
      <Button
        variant="outline"
        size="icon"
        className={cn(
          "absolute left-1/2 -translate-x-1/2 z-[100] h-4 w-12 rounded-t-none border-t-0 shadow-sm transition-all bg-card hover:bg-accent",
          isTopCollapsed ? "top-0" : "top-[50px]"
        )}
        onClick={() => setIsTopCollapsed(!isTopCollapsed)}
      >
        {isTopCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </Button>

      <div className="flex flex-1 overflow-hidden relative">
        {currentPage === 'home' && (
          <div className="flex-1 flex items-center justify-center bg-background">
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-bold text-muted-foreground opacity-20">{t('homePage')}</h2>
              <p className="text-muted-foreground opacity-40">{t('emptyPageNotice')}</p>
            </div>
          </div>
        )}

        {currentPage === 'stores' && <DirectoryPage />}

        {currentPage === 'forecast' && (
          <React.Suspense fallback={<div className="flex-1 grid place-items-center text-muted-foreground">…</div>}>
            <ForecastPage onOpenRitm={() => setCurrentPage('rota')} />
          </React.Suspense>
        )}

        {currentPage === 'rota' && (
          <React.Suspense fallback={<div className="flex-1 grid place-items-center text-muted-foreground">…</div>}>
            <RotaModule />
          </React.Suspense>
        )}

        {currentPage === 'routing' && (
          <>
            {/* Left Panel */}
        <aside 
          className={cn(
            "border-r bg-card flex flex-col z-40 relative transition-all duration-300 ease-in-out",
            isLeftCollapsed ? "w-0 border-none" : ""
          )}
          style={{ width: isLeftCollapsed ? 0 : leftWidth }}
        >
          {!isLeftCollapsed && (
            <div className="p-3 space-y-3 flex flex-col h-full w-full overflow-hidden">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input 
                  placeholder={t('searchPlaceholder')} 
                  className="pl-9" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Toggle Buttons for Collapsible Sections (hidden by default) */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  id="toggle-stats-card-btn"
                  onClick={() => setIsStatsCardOpen(prev => !prev)}
                  className={cn(
                    "flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer",
                    isStatsCardOpen
                      ? "bg-primary/10 border-primary text-primary shadow-xs ring-1 ring-primary/30"
                      : "bg-muted/40 hover:bg-muted/70 text-muted-foreground hover:text-foreground border-border"
                  )}
                  title={isStatsCardOpen ? t('hideStats') : t('showStats')}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <BarChart2 size={13} className={isStatsCardOpen ? "text-primary" : "text-muted-foreground"} />
                    <span className="truncate">{t('toggleStats')}</span>
                  </div>
                  <ChevronDown size={13} className={cn("transition-transform duration-200 shrink-0", isStatsCardOpen && "rotate-180 text-primary")} />
                </button>

                <button
                  type="button"
                  id="toggle-filters-card-btn"
                  onClick={() => setIsFiltersCardOpen(prev => !prev)}
                  className={cn(
                    "flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer",
                    isFiltersCardOpen || (
                      (rangeValues.min ? 1 : 0) +
                      (rangeValues.max ? 1 : 0) +
                      selectedDays.length +
                      selectedRegions.length +
                      selectedTimes.length +
                      selectedStatuses.length +
                      selectedTruckTypes.length +
                      selectedShippingDates.length +
                      selectedWarehouseTypes.length
                    ) > 0
                      ? "bg-primary/10 border-primary text-primary shadow-xs ring-1 ring-primary/30"
                      : "bg-muted/40 hover:bg-muted/70 text-muted-foreground hover:text-foreground border-border"
                  )}
                  title={isFiltersCardOpen ? t('hideFilters') : t('showFilters')}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Filter size={13} className={isFiltersCardOpen || (
                      (rangeValues.min ? 1 : 0) +
                      (rangeValues.max ? 1 : 0) +
                      selectedDays.length +
                      selectedRegions.length +
                      selectedTimes.length +
                      selectedStatuses.length +
                      selectedTruckTypes.length +
                      selectedShippingDates.length +
                      selectedWarehouseTypes.length
                    ) > 0 ? "text-primary" : "text-muted-foreground"} />
                    <span className="truncate">{t('toggleFilters')}</span>
                    {(
                      (rangeValues.min ? 1 : 0) +
                      (rangeValues.max ? 1 : 0) +
                      selectedDays.length +
                      selectedRegions.length +
                      selectedTimes.length +
                      selectedStatuses.length +
                      selectedTruckTypes.length +
                      selectedShippingDates.length +
                      selectedWarehouseTypes.length
                    ) > 0 && (
                      <span className="px-1 py-0.2 text-[9px] font-bold rounded-full bg-primary text-primary-foreground">
                        {(rangeValues.min ? 1 : 0) +
                         (rangeValues.max ? 1 : 0) +
                         selectedDays.length +
                         selectedRegions.length +
                         selectedTimes.length +
                         selectedStatuses.length +
                         selectedTruckTypes.length +
                         selectedShippingDates.length +
                         selectedWarehouseTypes.length}
                      </span>
                    )}
                  </div>
                  <ChevronDown size={13} className={cn("transition-transform duration-200 shrink-0", isFiltersCardOpen && "rotate-180 text-primary")} />
                </button>
              </div>

              {/* General Data Card (Collapsible, hidden by default) */}
              {isStatsCardOpen && (
                <Card className="p-2 animate-in fade-in-50 duration-200">
                  <h3 className="text-[10px] font-semibold mb-1 uppercase tracking-wider text-muted-foreground">Общие данные (фильтр)</h3>
                  <div className="grid grid-cols-3 gap-y-1 gap-x-2">
                    <DataValue label="Вес" value={`${roundUp(filteredStats.weight)} кг`} />
                    <DataValue label="Объём" value={`${roundUp(filteredStats.volume)} м³`} />
                    <DataValue label="Заказчики" value={filteredStats.customers} />
                    <DataValue label="Заказы" value={filteredStats.ordersCount} />
                    <DataValue label="Sətir" value={filteredStats.satir} />
                    <DataValue label="Общий путь" value={`${formatDec1(routes.reduce((sum, r) => sum + (r.distance || 0), 0))} км`} />
                  </div>

                  {/* Warehouse Type in General Data */}
                  <div className="mt-2 pt-1.5 border-t space-y-1 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground font-semibold flex items-center gap-1">
                        <Building2 size={11} className="text-primary" />
                        Тип склада:
                      </span>
                      <span className="font-bold text-foreground">
                        {filteredWarehouseStats.primaryType}
                      </span>
                    </div>
                    {filteredWarehouseStats.breakdown.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {filteredWarehouseStats.breakdown.map((b, bIdx) => (
                          <span key={`wh-breakdown-${b.name || 'item'}-${bIdx}`} className="px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono text-[9px] border border-border/40">
                            <strong className="text-foreground">{b.name}</strong>: {b.ordersCount} зак. ({roundUp(b.volume)} м³)
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {routes.length > 0 && (
                    <div className="mt-2 pt-1.5 border-t flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground font-medium">Правильный путь (OSRM):</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        {routes.filter(r => r.isRealRoad).length} из {routes.length}
                      </span>
                    </div>
                  )}

                  {/* Store Marker Label Mode Switcher (Multi-select) */}
                  <div className="mt-2 pt-1.5 border-t space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground font-semibold flex items-center gap-1">
                        <Tag size={11} className="text-primary" />
                        Иконка магазина (мультивыбор):
                      </span>
                      <span className="text-[9px] font-bold text-primary truncate max-w-[140px]" title="Выбранные метки">
                        {(Array.isArray(storeMarkerLabelMode) ? storeMarkerLabelMode : [storeMarkerLabelMode || 'volume'])
                          .map(m => m === 'volume' ? 'Объём' : m === 'weight' ? 'Вес' : m === 'items' ? 'Товар' : m === 'code' ? 'Код' : 'Назв.')
                          .join(' + ')}
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/60">
                      {[
                        { id: 'code' as StoreMarkerLabelOption, label: 'Код', title: 'Код магазина' },
                        { id: 'name' as StoreMarkerLabelOption, label: 'Назв.', title: 'Название магазина' },
                        { id: 'volume' as StoreMarkerLabelOption, label: 'Объём', title: 'Объём (м³)' },
                        { id: 'weight' as StoreMarkerLabelOption, label: 'Вес', title: 'Вес (кг)' },
                        { id: 'items' as StoreMarkerLabelOption, label: 'Товар', title: 'Количество товаров/sətir' },
                      ].map((mode, mIdx) => {
                        const currentList = Array.isArray(storeMarkerLabelMode) ? storeMarkerLabelMode : [storeMarkerLabelMode || 'volume'];
                        const isSelected = currentList.includes(mode.id);
                        return (
                          <button
                            key={`marker-mode-${mode.id}-${mIdx}`}
                            type="button"
                            id={`store-marker-mode-${mode.id}`}
                            onClick={() => {
                              setStoreMarkerLabelMode(prev => {
                                const arr = Array.isArray(prev) ? prev : [prev || 'volume'];
                                if (arr.includes(mode.id)) {
                                  const next = arr.filter(i => i !== mode.id);
                                  return next.length > 0 ? next : ['volume'];
                                } else {
                                  return [...arr, mode.id];
                                }
                              });
                            }}
                            className={cn(
                              "py-1 px-0.5 text-[9.5px] font-bold rounded-md transition-all text-center truncate cursor-pointer flex items-center justify-center gap-0.5",
                              isSelected
                                ? "bg-primary text-primary-foreground shadow-xs ring-1 ring-primary/40"
                                : "text-muted-foreground hover:text-foreground hover:bg-background/80"
                            )}
                            title={mode.title}
                          >
                            {isSelected && <Check size={8} className="shrink-0" />}
                            <span>{mode.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="text-[8.5px] text-muted-foreground text-center font-mono">
                      Формат: код  название - объём/вес/товар
                    </div>
                  </div>
                </Card>
              )}

              {/* Filters Card (Collapsible, hidden by default, quick date selection removed) */}
              {isFiltersCardOpen && (
                <Card className="p-2 overflow-visible animate-in fade-in-50 duration-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Фильтры</h3>
                    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[9px]" onClick={() => {
                      setRangeValues({ min: '', max: '' });
                      setSelectedDays([]);
                      setSelectedRegions([]);
                      setSelectedTimes([]);
                      setSelectedStatuses([]);
                      setSelectedTruckTypes([]);
                      setSelectedShippingDates([]);
                      setSelectedWarehouseTypes([]);
                      setQuickDateFilter(null);
                    }}>Очистить</Button>
                  </div>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <button 
                        className="text-[9px] text-primary font-bold uppercase hover:underline"
                        onClick={() => setRangeType(prev => prev === 'volume' ? 'weight' : prev === 'weight' ? 'satir' : 'volume')}
                      >
                        {rangeType === 'volume' ? 'Объём' : rangeType === 'weight' ? 'Вес' : 'Sətir'} (Мин/Макс)
                      </button>
                      <div className="flex gap-1">
                        <Input placeholder="Мин" value={rangeValues.min} onChange={(e) => setRangeValues({...rangeValues, min: e.target.value})} className="h-7 text-[11px] px-2" />
                        <Input placeholder="Макс" value={rangeValues.max} onChange={(e) => setRangeValues({...rangeValues, max: e.target.value})} className="h-7 text-[11px] px-2" />
                      </div>
                    </div>

                  <div className="grid grid-cols-2 gap-1 relative">
                    <DropdownFilter 
                      label="День" 
                      isOpen={openDropdown === 'day'} 
                      onToggle={() => setOpenDropdown(prev => prev === 'day' ? null : 'day')}
                      onClose={() => setOpenDropdown(null)}
                    >
                      {[1,2,3,4,5,6,7].map((d, dIdx) => (
                        <FilterItem 
                          key={`filter-day-${d}-${dIdx}`} 
                          label={['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][d-1]} 
                          checked={selectedDays.includes(d)}
                          onChange={() => setSelectedDays(prev => prev.includes(d) ? prev.filter(i => i !== d) : [...prev, d])}
                        />
                      ))}
                    </DropdownFilter>

                    <DropdownFilter 
                      label="Регион" 
                      isOpen={openDropdown === 'region'} 
                      onToggle={() => setOpenDropdown(prev => prev === 'region' ? null : 'region')}
                      onClose={() => setOpenDropdown(null)}
                    >
                      {Array.from(new Set(orders.map(o => o.region))).map((r: string, rIdx: number) => (
                        <FilterItem 
                          key={`filter-reg-${r}-${rIdx}`} 
                          label={r} 
                          checked={selectedRegions.includes(r)}
                          onChange={() => setSelectedRegions(prev => prev.includes(r) ? prev.filter(i => i !== r) : [...prev, r])}
                        />
                      ))}
                    </DropdownFilter>

                    <DropdownFilter 
                      label="Время" 
                      isOpen={openDropdown === 'time'} 
                      onToggle={() => setOpenDropdown(prev => prev === 'time' ? null : 'time')}
                      onClose={() => setOpenDropdown(null)}
                    >
                      {Array.from(new Set(orders.map(o => o.timeSlot))).map((t: string, tIdx: number) => (
                        <FilterItem 
                          key={`filter-time-${t}-${tIdx}`} 
                          label={t} 
                          checked={selectedTimes.includes(t)}
                          onChange={() => setSelectedTimes(prev => prev.includes(t) ? prev.filter(i => i !== t) : [...prev, t])}
                        />
                      ))}
                    </DropdownFilter>

                    <DropdownFilter 
                      label="Статус" 
                      isOpen={openDropdown === 'status'} 
                      onToggle={() => setOpenDropdown(prev => prev === 'status' ? null : 'status')}
                      onClose={() => setOpenDropdown(null)}
                    >
                      <FilterItem 
                        label="В маршруте" 
                        checked={selectedStatuses.includes('in-route')}
                        onChange={() => setSelectedStatuses(prev => prev.includes('in-route') ? prev.filter(i => i !== 'in-route') : [...prev, 'in-route'])}
                      />
                      <FilterItem 
                        label="Не в маршруте" 
                        checked={selectedStatuses.includes('not-in-route')}
                        onChange={() => setSelectedStatuses(prev => prev.includes('not-in-route') ? prev.filter(i => i !== 'not-in-route') : [...prev, 'not-in-route'])}
                      />
                    </DropdownFilter>

                    <DropdownFilter 
                      label="Тип авто" 
                      isOpen={openDropdown === 'truck'} 
                      onToggle={() => setOpenDropdown(prev => prev === 'truck' ? null : 'truck')}
                      onClose={() => setOpenDropdown(null)}
                    >
                      {routingLimits.truckTypes.map((t: TruckType, tIdx: number) => (
                        <FilterItem 
                          key={`filter-truck-${t.id || t.name}-${tIdx}`} 
                          label={t.name} 
                          checked={selectedTruckTypes.includes(t.name)}
                          onChange={() => setSelectedTruckTypes(prev => prev.includes(t.name) ? prev.filter(i => i !== t.name) : [...prev, t.name])}
                        />
                      ))}
                    </DropdownFilter>

                    <DropdownFilter 
                      label="Дата" 
                      isOpen={openDropdown === 'shippingDate'} 
                      onToggle={() => setOpenDropdown(prev => prev === 'shippingDate' ? null : 'shippingDate')}
                      onClose={() => setOpenDropdown(null)}
                    >
                      <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-border/60 text-[10px]">
                        <button
                          type="button"
                          className="text-primary font-bold hover:underline flex items-center gap-1"
                          onClick={() => handleQuickDateSelect('all')}
                        >
                          Все даты (Сбросить)
                        </button>
                        {selectedShippingDates.length > 0 && (
                          <span className="text-[9px] text-muted-foreground font-mono">
                            Выбрано: {selectedShippingDates.length}
                          </span>
                        )}
                      </div>
                      {allOrderShippingDates.map((d: string, dIdx: number) => {
                        const isToday = todayMatchingDates.includes(d);
                        const isTomorrow = tomorrowMatchingDates.includes(d);
                        const count = orders.filter(o => normalizeDateStr(o.shippingDate) === d).length;
                        const badgeText = isToday ? ' (Сегодня)' : isTomorrow ? ' (Завтра)' : '';
                        const isChecked = selectedShippingDates.some(sel => normalizeDateStr(sel) === d);
                        return (
                          <FilterItem 
                            key={`filter-date-${d}-${dIdx}`} 
                            label={`${d}${badgeText} (${count})`} 
                            checked={isChecked}
                            onChange={() => {
                              setQuickDateFilter(null);
                              const next = isChecked
                                ? selectedShippingDates.filter(i => normalizeDateStr(i) !== d) 
                                : [...selectedShippingDates.filter(i => normalizeDateStr(i) !== d), d];
                              setSelectedShippingDates(next);
                              if (next.length === 1) {
                                setSelectedRouteDateFilter(next[0]);
                                if (todayMatchingDates.includes(next[0])) {
                                  setQuickDateFilter('today');
                                } else if (tomorrowMatchingDates.includes(next[0])) {
                                  setQuickDateFilter('tomorrow');
                                } else if (next7MatchingDates.includes(next[0])) {
                                  setQuickDateFilter('next7');
                                }
                              } else if (next.length === 0) {
                                setSelectedRouteDateFilter('all');
                                setQuickDateFilter('all');
                              } else {
                                setSelectedRouteDateFilter('all');
                              }
                            }}
                          />
                        );
                      })}
                    </DropdownFilter>

                    <DropdownFilter 
                      label="Тип склада" 
                      isOpen={openDropdown === 'warehouseType'} 
                      onToggle={() => setOpenDropdown(prev => prev === 'warehouseType' ? null : 'warehouseType')}
                      onClose={() => setOpenDropdown(null)}
                    >
                      {Array.from(new Set(orders.map(o => o.warehouseType || 'Не указан'))).map((wt: string, wtIdx: number) => {
                        const count = orders.filter(o => (o.warehouseType || 'Не указан') === wt).length;
                        return (
                          <FilterItem 
                            key={`filter-whtype-${wt}-${wtIdx}`} 
                            label={`${wt} (${count})`} 
                            checked={selectedWarehouseTypes.includes(wt)}
                            onChange={() => setSelectedWarehouseTypes(prev => 
                              prev.includes(wt) ? prev.filter(i => i !== wt) : [...prev, wt]
                            )}
                          />
                        );
                      })}
                    </DropdownFilter>
                  </div>
                </div>
              </Card>
              )}

              {/* Icon-only tab switcher with hover tooltips */}
              <div className="grid grid-cols-7 gap-1 bg-muted/40 p-1 rounded-xl shrink-0 border border-border/50">
                {[
                  { 
                    id: 'stores' as LeftPanelTab, 
                    label: `${t('tabStores')} (${filteredStores.length})`, 
                    icon: <StoreIcon size={16} /> 
                  },
                  { 
                    id: 'routes' as LeftPanelTab, 
                    label: `${t('tabRoutes')} (${routes.length})`, 
                    icon: <Truck size={16} />,
                    hasBadge: routes.length > 0
                  },
                  { 
                    id: 'history' as LeftPanelTab, 
                    label: t('tabHistory'), 
                    icon: <History size={16} /> 
                  },
                  { 
                    id: 'analytics' as LeftPanelTab, 
                    label: t('tabAnalytics'), 
                    icon: <BarChart2 size={16} /> 
                  },
                  { 
                    id: 'streets' as LeftPanelTab, 
                    label: `${t('tabStreets')}${streetHighlights.length > 0 ? ` (${streetHighlights.length})` : ''}`, 
                    icon: <MapPin size={16} className="text-rose-500" />,
                    hasBadge: streetHighlights.length > 0
                  },
                  { 
                    id: 'barriers' as LeftPanelTab, 
                    label: `${t('tabBarriers')}${barriers.length > 0 ? ` (${barriers.filter(b => b.isActive).length})` : ''}`, 
                    icon: <Construction size={16} className="text-red-500" />,
                    hasBadge: barriers.some(b => b.isActive)
                  },
                  { 
                    id: 'scenarios' as LeftPanelTab, 
                    label: `${t('tabScenarios')} (${routeVersions.length})`, 
                    icon: <Layers size={16} /> 
                  },
                ].map((tab, tabIdx) => (
                  <button
                    key={`left-panel-tab-${tab.id}-${tabIdx}`}
                    type="button"
                    id={`left-tab-${tab.id}`}
                    onClick={() => setLeftPanelTab(tab.id)}
                    className={cn(
                      "h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer relative",
                      leftPanelTab === tab.id
                        ? "bg-card text-primary shadow-xs ring-1 ring-primary/30 font-bold"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/80"
                    )}
                    title={tab.label}
                    aria-label={tab.label}
                  >
                    {tab.icon}
                    {tab.hasBadge && (
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary" />
                    )}
                  </button>
                ))}
              </div>

              {leftPanelTab === 'stores' && (
                <>
                  {/* Bulk Actions Menu & Selection Bar for Orders */}
                  <BulkActionsMenu 
                    orders={orders}
                    stores={stores}
                    filteredStores={filteredStores}
                    selectedOrderIds={selectedOrderIds}
                    routes={routes}
                    onSelectAll={handleBulkSelectAll}
                    onClearSelection={handleBulkClearSelection}
                    onDeleteSelected={handleBulkDeleteOrders}
                    onAssignRegion={handleBulkAssignRegion}
                    onAssignRoute={handleBulkAssignRoute}
                    onRemoveFromRoute={handleBulkRemoveFromRoute}
                    onChangeShippingDate={handleBulkChangeShippingDate}
                    onChangeTimeSlot={handleBulkChangeTimeSlot}
                    onCreateRouteFromSelected={handleCreateRoute}
                  />

                  <div className="flex-1 overflow-y-auto scrollbar-thin space-y-2 pr-1">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Магазины ({filteredStores.length})</h3>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className={cn("h-6 px-2 text-[10px]", showDetails && "text-primary")}
                        onClick={() => setShowDetails(!showDetails)}
                      >
                        {showDetails ? 'Скрыть инфо' : 'Подробно'}
                      </Button>
                    </div>
                    {filteredStores.map((store: Store, storeIdx: number) => (
                      <StoreCard 
                        key={`store-card-${store.name || 'store'}-${storeIdx}`} 
                        store={store} 
                        showDetails={showDetails}
                        isSelected={store.orders.length > 0 && store.orders.every(o => selectedOrderIds.includes(o.id))}
                        selectedOrderIds={selectedOrderIds}
                        onToggleSelectStore={() => {
                          const storeOrderIds = store.orders.map(o => o.id);
                          const allSelected = storeOrderIds.every(id => selectedOrderIds.includes(id));
                          if (allSelected) {
                            setSelectedOrderIds(prev => prev.filter(id => !storeOrderIds.includes(id)));
                          } else {
                            setSelectedOrderIds(prev => Array.from(new Set([...prev, ...storeOrderIds])));
                            setFocusedStore({ ...store, focusTrigger: Date.now() });
                          }
                        }}
                        onToggleOrder={(orderId) => {
                          setSelectedOrderIds(prev => 
                            prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
                          );
                          setFocusedStore({ ...store, focusTrigger: Date.now() });
                        }}
                        onToggle={() => {
                          setFocusedStore({ ...store, focusTrigger: Date.now() });
                        }}
                      />
                    ))}
                  </div>
                </>
              )}

              {leftPanelTab === 'routes' && (
                <RoutesManagementPanel
                  routes={routes}
                  orders={orders}
                  routingLimits={routingLimits}
                  selectedOrderIds={selectedOrderIds}
                  isOptimizingAll={isOptimizingAll}
                  showAllRouteLines={showAllRouteLines}
                  planValidationResult={planValidationResult}
                  routeGroupingMode={routeGroupingMode}
                  dateGroupedRoutes={dateGroupedRoutes}
                  selectedRouteDateFilter={selectedRouteDateFilter}
                  quickDateFilter={quickDateFilter}
                  selectedShippingDates={selectedShippingDates}
                  todayMatchingDates={todayMatchingDates}
                  tomorrowMatchingDates={tomorrowMatchingDates}
                  next7MatchingDates={next7MatchingDates}
                  collapsedDateGroups={collapsedDateGroups}
                  hoveredRouteId={hoveredRouteId}
                  selectedRouteId={selectedRouteId}
                  routeVersions={routeVersions}
                  onCreateRoute={handleCreateRoute}
                  onOptimizeAll={handleOptimizeAll}
                  onExportRoutesToPdf={handleExportRoutesToPdf}
                  onExportRoutesToExcel={handleExportData}
                  onToggleShowAllRouteLines={() => setShowAllRouteLines(!showAllRouteLines)}
                  onOpenValidationModal={() => setIsValidationModalOpen(true)}
                  onSetRouteGroupingMode={setRouteGroupingMode}
                  onSelectRouteDateFilter={handleSelectRouteDateFilter}
                  onToggleDateGroupCollapse={toggleDateGroupCollapse}
                  onSetCollapsedDateGroups={setCollapsedDateGroups}
                  onToggleDateRoutesVisibility={handleToggleDateRoutesVisibility}
                  onSelectOrderIds={setSelectedOrderIds}
                  onSetHoveredRouteId={setHoveredRouteId}
                  onSetSelectedRouteId={(id) => setSelectedRouteId(selectedRouteId === id ? null : id)}
                  onDeleteRoute={handleDeleteRoute}
                  routeListItems={routeListItems}
                  routeListTotal={routeListBase.length}
                  routeListFilter={routeListFilter}
                  routeListSort={routeListSort}
                  onSetRouteListFilter={setRouteListFilter}
                  onSetRouteListSort={setRouteListSort}
                  onOpenSummaryTable={() => setShowRouteSummaryTable(true)}
                  onToggleRouteVisibility={(routeId) => {
                    setRoutes(prev => prev.map(r => r.id === routeId ? { ...r, isVisible: !r.isVisible } : r));
                  }}
                  onShowRouteDetails={(route) => setSelectedRouteDetails(route)}
                  onOptimizeRoute={(route) => setSelectedRouteForOptimization(route)}
                  onSaveVersion={handleSaveVersion}
                  onClearCreatedRoutes={handleClearCreatedRoutes}
                  onClearAllRoutes={handleClearAllRoutes}
                  onExportDateRoutesToPdf={handleExportDateRoutesToPdf}
                  onToggleLockRoute={handleToggleLockRoute}
                  onOpenWhatIf={() => setIsWhatIfOpen(true)}
                  onOpenConstraints={() => setIsConstraintsOpen(true)}
                />
              )}

              {leftPanelTab === 'history' && (
                <div className="flex-1 overflow-hidden flex flex-col">
                  <RouteHistoryPanel 
                    currentRoutes={routes}
                    currentOrders={orders}
                    onRestoreState={(restoredRoutes, restoredOrders, message) => {
                      setRoutes(restoredRoutes || []);
                      setOrders(restoredOrders || []);
                      setSaveNotification(message);
                      setTimeout(() => setSaveNotification(null), 3500);
                    }}
                    onCompareVersions={(entry) => {
                      setCompareEntry(entry);
                      setIsCompareModalOpen(true);
                    }}
                  />
                </div>
              )}

              {leftPanelTab === 'analytics' && (
                <AnalyticsPanel 
                  routes={routes}
                  orders={orders}
                  routingLimits={routingLimits}
                  selectedRouteId={selectedRouteId}
                  onHoverRoute={setHoveredRouteId}
                  onSelectRouteDetails={(r) => setSelectedRouteDetails(r)}
                  onSelectRouteId={(id) => setSelectedRouteId(selectedRouteId === id ? null : id)}
                  onOpenFullAnalytics={() => setShowFullAnalytics(true)}
                  onExportAnalytics={handleExportAnalytics}
                  onClearAllRoutes={handleClearAllRoutes}
                />
              )}

              {leftPanelTab === 'streets' && (
                <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col">
                  <StreetHighlightPanel
                    orders={orders}
                    streetHighlights={streetHighlights}
                    streetGroups={streetGroups}
                    onAddStreetHighlight={(highlight) => {
                      setStreetHighlights(prev => [highlight, ...prev]);
                      if (highlight.orderIds && highlight.orderIds.length > 0) {
                        setSelectedOrderIds(prev => Array.from(new Set([...prev, ...(highlight.orderIds || [])])));
                      }
                      setSaveNotification(`Добавлена улица: "${highlight.name}" (${highlight.orderIds?.length || 0} заказов)`);
                      setTimeout(() => setSaveNotification(null), 3500);
                    }}
                    onRemoveStreetHighlight={handleDeleteStreet}
                    onToggleStreetVisibility={handleToggleStreetVisibility}
                    onUpdateStreet={handleUpdateStreet}
                    onClearAllStreets={() => {
                      setStreetHighlights([]);
                      setSaveNotification('Все выделенные улицы удалены');
                      setTimeout(() => setSaveNotification(null), 2500);
                    }}
                    onSelectOrders={handleSelectStreetOrders}
                    onCreateRouteFromOrders={(orderIds) => handleCreateRoute(orderIds)}
                    selectedOrderIds={selectedOrderIds}
                    activeMode={activeStreetMode}
                    onSetActiveMode={setActiveStreetMode}
                    brushRadiusMeters={brushRadiusMeters}
                    onSetBrushRadiusMeters={setBrushRadiusMeters}
                    currentBrushTrail={currentBrushTrail}
                    currentBrushOrderIds={currentBrushOrderIds}
                    onSaveCurrentBrushAsStreet={() => handleSaveCurrentBrushAsStreet()}
                    onClearCurrentBrush={handleClearCurrentBrush}
                    onAddGroup={handleAddGroup}
                    onUpdateGroup={handleUpdateGroup}
                    onDeleteGroup={handleDeleteGroup}
                    onAssignStreetToGroup={handleAssignStreetToGroup}
                    onBulkAssignStreetsToGroup={handleBulkAssignStreetsToGroup}
                    streetLineWidth={streetLineWidth}
                    onSetStreetLineWidth={setStreetLineWidth}
                    streetLineOpacity={streetLineOpacity}
                    onSetStreetLineOpacity={setStreetLineOpacity}
                  />
                </div>
              )}

              {leftPanelTab === 'barriers' && (
                <BarriersPanel
                  barriers={barriers}
                  placementMode={barrierPlacementMode}
                  onSetPlacementMode={setBarrierPlacementMode}
                  zoneRadius={barrierZoneRadius}
                  onSetZoneRadius={setBarrierZoneRadius}
                  streets={streetHighlights}
                  onCloseStreet={handleCloseStreet}
                  onToggle={handleToggleBarrier}
                  onDelete={handleDeleteBarrier}
                  onRename={handleRenameBarrier}
                  onFocus={handleFocusBarrier}
                  onClearAll={handleClearBarriers}
                  onRebuildRoutes={() => { void rebuildRoutesForBarriers(false); }}
                  isRebuilding={isRebuildingBarrierRoutes}
                  detourRoutes={barrierRouteStats.detour}
                  blockedRoutes={barrierRouteStats.blocked}
                />
              )}

              {leftPanelTab === 'scenarios' && (
                <ScenariosPanel 
                  routeVersions={routeVersions}
                  onLoadVersion={(version) => {
                    handleLoadVersion(version);
                    setLeftPanelTab('routes');
                  }}
                  onDeleteVersion={(id) => setRouteVersions(prev => prev.filter(v => v.id !== id))}
                  onClearAllVersions={() => setRouteVersions([])}
                  onRenameScenario={handleRenameScenario}
                  onViewAnalytics={(version) => {
                    handleLoadVersion(version);
                    setLeftPanelTab('analytics');
                  }}
                  onSaveCurrentScenario={handleSaveVersion}
                  onOpenWhatIf={() => setIsWhatIfOpen(true)}
                />
              )}
            </div>
          )}
          
          {/* Resize Handle Left */}
          {!isLeftCollapsed && (
            <div 
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 z-50 transition-colors"
              onMouseDown={() => setIsResizingLeft(true)}
            />
          )}
          
          {/* Toggle Button Left */}
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "absolute top-1/2 -translate-y-1/2 z-[100] h-8 w-4 rounded-l-none border border-l-0 shadow-md transition-all",
              isLeftCollapsed ? "left-0" : "right-[-16px]"
            )}
            onClick={() => setIsLeftCollapsed(!isLeftCollapsed)}
          >
            {isLeftCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </Button>
        </aside>

        {/* Central Map (isolated stacking: map layers and the route panel always stay below dialogs) */}
        <main 
          className="flex-1 relative isolate"
          onMouseEnter={() => {
            if (hoveredRouteId) setHoveredRouteId(null);
          }}
        >
          {focusedInsight && (
            <RouteFocusPanel
              insight={focusedInsight}
              position={focusedPosition}
              total={routeListItems.length}
              isLocked={(routingLimits.lockedRoutes || []).includes(focusedInsight.route.id)}
              onPrev={() => stepFocusedRoute(-1)}
              onNext={() => stepFocusedRoute(1)}
              onClose={() => setSelectedRouteId(null)}
              onShowDetails={() => setSelectedRouteDetails(focusedInsight.route)}
              onOptimize={() => setSelectedRouteForOptimization(focusedInsight.route)}
              onToggleVisibility={() => setRoutes(prev => prev.map(r => r.id === focusedInsight.route.id ? { ...r, isVisible: !r.isVisible } : r))}
              onToggleLock={() => handleToggleLockRoute(focusedInsight.route.id)}
              onDelete={() => handleDeleteRoute(focusedInsight.route.id)}
            />
          )}
          {showRouteSummaryTable && (
            <RouteSummaryTable
              items={routeListItems}
              totalCount={routeListBase.length}
              selectedRouteId={selectedRouteId}
              filter={routeListFilter}
              sort={routeListSort}
              onSetFilter={setRouteListFilter}
              onSetSort={setRouteListSort}
              onSelect={(id) => { setSelectedRouteId(id); setShowRouteSummaryTable(false); setLeftPanelTab('routes'); }}
              onClose={() => setShowRouteSummaryTable(false)}
            />
          )}
          <MapView 
            orders={filteredOrders} 
            routes={routes} 
            selectedOrderIds={selectedOrderIds}
            storeMarkerLabelMode={storeMarkerLabelMode}
            barriers={barriers}
            barrierPlacementMode={barrierPlacementMode}
            barrierZoneRadius={barrierZoneRadius}
            onMapClickBarrier={handleMapClickBarrier}
            onSetBarrierPlacementMode={setBarrierPlacementMode}
            onToggleBarrier={handleToggleBarrier}
            onDeleteBarrier={handleDeleteBarrier}
            isPlacingBarrier={isPlacingBarrier}
            focusPoint={mapFocusPoint}
            onToggleOrder={(ids) => {
              const idArray = Array.isArray(ids) ? ids : [ids];
              const allSelected = idArray.every(id => selectedOrderIds.includes(id));
              if (allSelected) {
                setSelectedOrderIds(prev => prev.filter(id => !idArray.includes(id)));
              } else {
                setSelectedOrderIds(prev => Array.from(new Set([...prev, ...idArray])));
              }
            }}
            streetHighlights={streetHighlights}
            onCreateRoute={handleCreateRoute}
            focusedStore={focusedStore}
            onClearSelection={() => setSelectedOrderIds([])}
            isRouting={isRouting}
            routingProgress={routingProgress}
            setIsRouting={setIsRouting}
            hoveredRouteId={hoveredRouteId}
            selectedRouteId={selectedRouteId}
            onHoverRoute={setHoveredRouteId}
            onClearRouteSelection={() => setSelectedRouteId(null)}
            onSelectRoute={(id) => setSelectedRouteId(selectedRouteId === id ? null : id)}
            streetLineWidth={streetLineWidth}
            streetLineOpacity={streetLineOpacity}
            zones={zones}
            onUpdateZonePolygon={(id, polygon) => {
              setZones(prev => prev.map(z => z.id === id ? { 
                ...z, 
                polygon,
                orderIds: orders
                  .filter(o => isPointInPolygon([o.lat, o.lng], polygon))
                  .map(o => o.id)
              } : z));
            }}
            showAllRouteLines={showAllRouteLines}
            onToggleAllRouteLines={() => setShowAllRouteLines(prev => !prev)}
            onRecalculateAllRoadGeometry={handleRecalculateAllRoadGeometry}
            isCalculatingGeometry={isCalculatingGeometry}
            activeStreetMode={activeStreetMode}
            onSetActiveStreetMode={setActiveStreetMode}
            onMapClickStreet={handleMapClickStreet}
            isClickingStreetLoading={isClickingStreetLoading}
            brushRadiusMeters={brushRadiusMeters}
            onSetBrushRadiusMeters={setBrushRadiusMeters}
            currentBrushTrail={currentBrushTrail}
            currentBrushOrderIds={currentBrushOrderIds}
            onAddBrushPoint={handleAddBrushPoint}
            onBrushComplete={handleBrushComplete}
            onSaveCurrentBrushAsStreet={() => handleSaveCurrentBrushAsStreet()}
            onClearCurrentBrush={handleClearCurrentBrush}
            onSelectStreetOrders={handleSelectStreetOrders}
            onOpenStreetsTab={() => {
              setLeftPanelTab('streets');
              setIsLeftCollapsed(false);
            }}
          />

          {/* Background Task Indicator */}
          {isCalculatingGeometry && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000]">
              <motion.div 
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="bg-card/90 backdrop-blur border shadow-lg rounded-full px-4 py-2 flex items-center gap-3"
              >
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Финальный расчет дистанций и путей...</span>
              </motion.div>
            </div>
          )}
          
          {/* Selection Info Panel */}
          {selectedOrderIds.length > 0 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="bg-card/90 backdrop-blur border shadow-lg rounded-full px-6 py-3 flex items-center gap-6"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Выбрано:</span>
                  <span className="font-bold text-primary">{selectedStats.count}</span>
                </div>
                <div className="h-4 w-px bg-border" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Вес:</span>
                  <span className="font-bold">{roundUp(selectedStats.weight)} кг</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Объём:</span>
                  <span className="font-bold">{roundUp(selectedStats.volume)} м³</span>
                </div>
                <Button variant="ghost" size="sm" className="h-8 rounded-full text-destructive hover:text-destructive" onClick={() => setSelectedOrderIds([])}>
                  Очистить
                </Button>
              </motion.div>
            </div>
          )}
        </main>


      </>
    )}
  </div>

  {currentPage === 'routing' && (
    <>
      {/* Router Modal (Parameters, Trucks & Algorithms) */}
            {/* Help Modal */}
      <HelpModal 
        isOpen={isHelpOpen} 
        onClose={() => setIsHelpOpen(false)} 
      />
      <RouterModal
        isOpen={isRouterModalOpen}
        onClose={() => setIsRouterModalOpen(false)}
        routingLimits={routingLimits}
        setRoutingLimits={setRoutingLimits}
        selectedAlgorithm={selectedAlgorithm}
        setSelectedAlgorithm={setSelectedAlgorithm}
        isRouting={isRouting}
        onRunRouting={handleRunRouting}
        hasFilteredStores={filteredStores.length > 0}
        onOpenWhatIf={() => setIsWhatIfOpen(true)}
        onOpenConstraints={() => setIsConstraintsOpen(true)}
      />
      {/* Route Details Modal */}
      <AnimatePresence>
        {selectedRouteDetails && (
          <RouteDetailsModal 
            route={routes.find(r => r.id === selectedRouteDetails.id) || selectedRouteDetails} 
            orders={(routes.find(r => r.id === selectedRouteDetails.id) || selectedRouteDetails).orderIds
              .map(id => orders.find(o => o.id === id))
              .filter((o): o is Order => Boolean(o))}
            allRoutes={routes}
            limits={routingLimits}
            onClose={() => setSelectedRouteDetails(null)} 
            onUpdateRouteOrders={handleUpdateRouteOrders}
            onMoveOrdersToRoute={handleMoveOrdersToRoute}
            onToggleLockStore={handleToggleLockStore}
            onToggleLockRoute={handleToggleLockRoute}
            onReoptimizeRoute={(routeToOpt) => {
              setSelectedRouteDetails(null);
              setSelectedRouteForOptimization(routeToOpt);
            }}
          />
        )}
      </AnimatePresence>

      {/* Optimization Modal */}
      <AnimatePresence>
        {selectedRouteForOptimization && (
          <OptimizationModal 
            route={selectedRouteForOptimization} 
            orders={selectedRouteForOptimization.orderIds
              .map(id => orders.find(o => o.id === id))
              .filter((o): o is Order => Boolean(o))}
            onClose={() => setSelectedRouteForOptimization(null)}
            onApply={(newOrderIds, newDistance) => {
              const sortedOrders = newOrderIds
                .map(id => orders.find(o => o.id === id))
                .filter((o): o is Order => Boolean(o));
              getRouteNavDetails([WAREHOUSE_LOCATION, ...sortedOrders, WAREHOUSE_LOCATION]).then(nav => {
                setRoutes(prev => prev.map(r => 
                  r.id === selectedRouteForOptimization.id 
                    ? applyNavDetailsToRoute({ ...r, orderIds: newOrderIds, distance: newDistance }, sortedOrders, nav)
                    : r
                ));
                setSelectedRouteForOptimization(null);
              });
            }}
          />
        )}
      </AnimatePresence>

      {/* Save Notification */}
      <AnimatePresence>
        {saveNotification && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg text-xs font-bold flex items-center gap-2"
          >
            <Check size={14} />
            {saveNotification}
          </motion.div>
        )}
      </AnimatePresence>
      <FullAnalyticsModal 
        isOpen={showFullAnalytics}
        onClose={() => setShowFullAnalytics(false)}
        routes={routes}
        orders={orders}
        limits={routingLimits}
      />

      {/* Version Compare Modal */}
      <VersionCompareModal 
        isOpen={isCompareModalOpen}
        entry={compareEntry}
        onClose={() => {
          setIsCompareModalOpen(false);
          setCompareEntry(null);
        }}
        onRestoreSnapshot={(r, o, msg) => {
          setRoutes(r);
          setOrders(o);
          setIsCompareModalOpen(false);
          setCompareEntry(null);
          setSaveNotification(msg);
          setTimeout(() => setSaveNotification(null), 3500);
        }}
      />

      {/* Optimization Diff Modal */}
      <OptimizationDiffModal 
        isOpen={!!optimizationDiffEntry}
        entry={optimizationDiffEntry}
        onClose={() => setOptimizationDiffEntry(null)}
        onRollback={(r, o) => {
          setRoutes(r);
          setOrders(o);
          setOptimizationDiffEntry(null);
          setSaveNotification('Оптимизация отменена, исходные маршруты восстановлены');
          setTimeout(() => setSaveNotification(null), 3500);
        }}
      />

      {/* Route Validation Modal */}
      <RouteValidationModal
        isOpen={isValidationModalOpen}
        onClose={() => setIsValidationModalOpen(false)}
        planResult={planValidationResult}
        routes={routes}
        orders={orders}
        truckTypes={routingLimits.truckTypes}
        onSelectRoute={(routeId) => {
          setSelectedRouteId(routeId);
          setIsValidationModalOpen(false);
          setLeftPanelTab('routes');
          setIsLeftCollapsed(false);
        }}
      />

      {/* Excel Mapping Modal */}
      <ExcelMappingModal
        show={excelMapping.show}
        data={excelMapping.data}
        headers={excelMapping.headers}
        mapping={excelMapping.mapping}
        requiredFields={REQUIRED_FIELDS}
        onClose={() => setExcelMapping({ show: false, data: [], headers: [], mapping: {} })}
        onUpdateMapping={(key, val) => {
          setExcelMapping(prev => ({
            ...prev,
            mapping: { ...prev.mapping, [key]: val }
          }));
        }}
        onProcessImport={(data, mapping) => processImportedData(data, mapping)}
      />

      {/* What-If Analysis Modal */}
      <WhatIfModal
        isOpen={isWhatIfOpen}
        onClose={() => setIsWhatIfOpen(false)}
        currentRoutes={routes}
        orders={orders}
        limits={routingLimits}
        onApplyScenario={handleApplyWhatIfScenario}
      />

      {/* Constraints & Lock Modal */}
      <ConstraintsModal
        isOpen={isConstraintsOpen}
        onClose={() => setIsConstraintsOpen(false)}
        limits={routingLimits}
        setLimits={setRoutingLimits}
        orders={orders}
        routes={routes}
      />
    </>
  )}
  <DirectoryConflictHost />
</div>
  );
}
