import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Map as MapIcon, 
  Truck, 
  Package, 
  Sliders, 
  Search, 
  RotateCcw, 
  Sun, 
  Moon, 
  Navigation, 
  MapPin, 
  ExternalLink, 
  Phone, 
  ChevronRight, 
  Check, 
  X, 
  Filter, 
  Layers, 
  Upload, 
  Download, 
  ShieldCheck, 
  Sparkles, 
  Building2, 
  Clock, 
  Play, 
  CheckSquare, 
  Square, 
  FileSpreadsheet,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Monitor,
  Eye,
  EyeOff
, ArrowLeftRight } from 'lucide-react';
import { Order, Route, Store, TruckType, Zone, StreetHighlight, StoreMarkerLabelMode, RouteVersion, RoadBarrier } from '../../types';
import { MapView } from '../map/MapView';
import { MobileBottomSheet } from './MobileBottomSheet';
import { LanguageSelector } from '../common/LanguageSelector';
import { Button, Card, Badge, Input } from '../common/UIComponents';
import { BulkActionsMenu } from '../BulkActionsMenu';
import { useTranslation } from '../../i18n/I18nContext';
import { WAREHOUSE_LOCATION } from '../../mockData';
import { cn } from '../../lib/utils';

export type MobileTab = 'map' | 'routes' | 'orders' | 'dispatch';

interface AndroidMobileLayoutProps {
  cloudSlot?: React.ReactNode;
  barriers?: RoadBarrier[];
  orders: Order[];
  filteredOrders: Order[];
  stores: Store[];
  filteredStores: Store[];
  routes: Route[];
  selectedOrderIds: string[];
  onToggleOrder: (orderIds: string[] | string) => void;
  selectedRouteId: string | null;
  onSelectRoute: (id: string | null) => void;
  hoveredRouteId: string | null;
  onHoverRoute: (id: string | null) => void;
  focusedStore: Store | null;
  onClearSelection: () => void;
  onSelectStore: (store: Store) => void;
  onCreateRoute: () => void;
  isRouting: boolean;
  routingProgress: { percent: number; message: string; logs: string[] };
  setIsRouting: (isRouting: boolean) => void;
  onOpenRouterModal: () => void;
  onOpenHelpModal: () => void;
  onOpenAuditModal: () => void;
  onImportExcel: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExportTemplate: () => void;
  onAddTransfer?: () => void;
  onUndo: () => void;
  canUndo?: boolean;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onSwitchToDesktop: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedShippingDates: string[];
  allShippingDates: string[];
  onSelectShippingDate: (date: string | 'all') => void;
  truckTypes: TruckType[];
  zones: Zone[];
  streetHighlights: StreetHighlight[];
  onUpdateZonePolygon?: (id: string, polygon: [number, number][]) => void;
  routeVersions: RouteVersion[];
  storeMarkerLabelMode: StoreMarkerLabelMode;
  onToggleStoreMarkerLabelMode?: (mode: StoreMarkerLabelMode) => void;
  showAllRouteLines: boolean;
  onToggleAllRouteLines: () => void;
}

const roundUp = (val: number, decimals = 1): number => {
  const factor = Math.pow(10, decimals);
  return Math.ceil(val * factor) / factor;
};

export const openExternalNavigation = (lat: number, lng: number, label?: string) => {
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  if (isAndroid) {
    window.location.href = `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label || 'Точка доставки')})`;
    return;
  }
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
};

export const AndroidMobileLayout: React.FC<AndroidMobileLayoutProps> = ({
  cloudSlot,
  barriers = [],
  orders,
  filteredOrders,
  stores,
  filteredStores,
  routes,
  selectedOrderIds,
  onToggleOrder,
  selectedRouteId,
  onSelectRoute,
  hoveredRouteId,
  onHoverRoute,
  focusedStore,
  onClearSelection,
  onSelectStore,
  onCreateRoute,
  isRouting,
  routingProgress,
  setIsRouting,
  onOpenRouterModal,
  onOpenHelpModal,
  onOpenAuditModal,
  onImportExcel,
  onExportTemplate,
  onAddTransfer,
  onUndo,
  canUndo = true,
  isDarkMode,
  onToggleDarkMode,
  onSwitchToDesktop,
  searchQuery,
  onSearchChange,
  selectedShippingDates,
  allShippingDates,
  onSelectShippingDate,
  truckTypes,
  zones,
  streetHighlights,
  onUpdateZonePolygon,
  routeVersions,
  storeMarkerLabelMode,
  showAllRouteLines,
  onToggleAllRouteLines
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<MobileTab>('map');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeStoreDetail, setActiveStoreDetail] = useState<Store | null>(null);
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | 'in-route' | 'not-in-route'>('all');
  const [bottomSheetState, setBottomSheetState] = useState<'peek' | 'half' | 'full'>('peek');

  // Active route
  const activeRoute = useMemo(() => {
    return routes.find(r => r.id === selectedRouteId) || null;
  }, [routes, selectedRouteId]);

  const getTruckName = (route: Route, fallback: string) =>
    truckTypes.find(t => t.id === route.truckTypeId)?.name || fallback;

  const activeRouteOrders = useMemo(() => {
    if (!activeRoute || !activeRoute.orderIds) return [];
    const map = new Map((orders || []).map(o => [o.id, o]));
    return activeRoute.orderIds.map(id => map.get(id)).filter((o): o is Order => Boolean(o));
  }, [activeRoute, orders]);

  const activeRouteVolume = useMemo(() => {
    return activeRouteOrders.reduce((s, o) => s + (o.volume || 0), 0);
  }, [activeRouteOrders]);

  // Overall stats
  const totalVolume = useMemo(() => orders.reduce((sum, o) => sum + (o.volume || 0), 0), [orders]);
  const totalWeight = useMemo(() => orders.reduce((sum, o) => sum + (o.weight || 0), 0), [orders]);
  const inRouteOrdersCount = useMemo(() => orders.filter(o => o.routeId).length, [orders]);

  // Filtered orders list for Orders tab
  const mobileFilteredStores = useMemo(() => {
    let result = filteredStores;
    if (orderStatusFilter === 'in-route') {
      result = result.filter(s => s.orders.some(o => o.routeId));
    } else if (orderStatusFilter === 'not-in-route') {
      result = result.filter(s => s.orders.some(o => !o.routeId));
    }
    return result;
  }, [filteredStores, orderStatusFilter]);

  const handleStoreClick = (store: Store) => {
    onSelectStore(store);
    setActiveStoreDetail(store);
    setBottomSheetState('half');
  };

  const handleSelectRouteFromMobile = (routeId: string) => {
    onSelectRoute(routeId);
    setActiveTab('map');
    setBottomSheetState('half');
  };

  return (
    <div className="w-full h-full flex flex-col bg-background text-foreground overflow-hidden relative font-sans select-none">
      {/* 1. Android Top App Bar (Material 3 styled) */}
      <header className="shrink-0 bg-card border-b border-border/80 px-3 py-2 safe-area-pt flex flex-col gap-1.5 z-[1100] shadow-xs">
        <div className="flex items-center justify-between gap-2">
          {/* Left: App Logo & Status */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shadow-xs border border-primary/20">
              <Truck size={17} />
            </div>
            <div>
              <div className="font-bold text-xs leading-none tracking-tight flex items-center gap-1.5">
                <span>SmartRoute</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <span className="text-[10px] text-muted-foreground font-medium">
                {routes.length} марш. · {orders.length} зак.
              </span>
            </div>
          </div>

          {/* Right: Quick Actions */}
          <div className="flex items-center gap-1.5">
            {/* Cloud database status / sign-in */}
            {cloudSlot}

            {/* Quick Undo */}
            <button
              type="button"
              onClick={onUndo}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
              title={t('btnUndo')}
            >
              <RotateCcw size={15} />
            </button>

            {/* Quick Search Toggle */}
            <button
              type="button"
              onClick={() => setIsSearchOpen(prev => !prev)}
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer",
                isSearchOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
              )}
              title="Поиск"
            >
              <Search size={15} />
            </button>

            {/* Language Selector (Flags) */}
            <LanguageSelector />

            {/* Dark Mode Toggle */}
            <button
              type="button"
              onClick={onToggleDarkMode}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
              title={isDarkMode ? t('btnLightMode') : t('btnDarkMode')}
            >
              {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            {/* Switch to Desktop Format */}
            <button
              type="button"
              onClick={onSwitchToDesktop}
              className="h-8 px-2 rounded-lg bg-muted/60 hover:bg-accent text-[11px] font-semibold flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title={t('viewFormatDesktop')}
            >
              <Monitor size={13} />
              <span className="hidden xs:inline">{t('viewFormatDesktop')}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Search Input */}
        <AnimatePresence>
          {isSearchOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden pt-1"
            >
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t('searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="w-full h-8 pl-8 pr-8 rounded-lg bg-muted/50 border border-input text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => onSearchChange('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Horizontal Quick Date Chips */}
        {(allShippingDates?.length || 0) > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => onSelectShippingDate('all')}
              className={cn(
                "px-2.5 py-1 rounded-full whitespace-nowrap font-medium transition-colors shrink-0",
                (selectedShippingDates?.length || 0) === 0
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "bg-muted/70 text-muted-foreground hover:text-foreground"
              )}
            >
              Все даты
            </button>
            {allShippingDates.map((date, dateIdx) => {
              const isSelected = selectedShippingDates.includes(date);
              return (
                <button
                  key={`mobile-date-${date || 'undated'}-${dateIdx}`}
                  type="button"
                  onClick={() => onSelectShippingDate(date)}
                  className={cn(
                    "px-2.5 py-1 rounded-full whitespace-nowrap transition-colors shrink-0",
                    isSelected
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "bg-muted/70 text-muted-foreground hover:text-foreground font-medium"
                  )}
                >
                  {date}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* 2. Main Content Body (Viewports depending on active tab) */}
      <main className="flex-1 w-full overflow-hidden relative">
        {/* TAB 1: MAP VIEW */}
        <div className={cn("w-full h-full relative", activeTab === 'map' ? 'block' : 'hidden')}>
          <MapView
            barriers={barriers}
            orders={filteredOrders}
            routes={routes}
            selectedOrderIds={selectedOrderIds}
            onToggleOrder={onToggleOrder}
            onCreateRoute={onCreateRoute}
            focusedStore={focusedStore}
            onClearSelection={onClearSelection}
            isRouting={isRouting}
            routingProgress={routingProgress}
            setIsRouting={setIsRouting}
            hoveredRouteId={hoveredRouteId}
            selectedRouteId={selectedRouteId}
            zones={zones}
            streetHighlights={streetHighlights}
            onUpdateZonePolygon={onUpdateZonePolygon || (() => {})}
            showAllRouteLines={showAllRouteLines}
            onToggleAllRouteLines={onToggleAllRouteLines}
            onHoverRoute={onHoverRoute}
            onClearRouteSelection={() => onSelectRoute(null)}
            onSelectRoute={onSelectRoute}
            storeMarkerLabelMode={storeMarkerLabelMode}
          />

          {/* Floating Action Buttons (FABs) on the Map */}
          <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2 pointer-events-auto">
            {/* Recenter Warehouse FAB */}
            <button
              type="button"
              onClick={() => {
                // Focus to warehouse
                onClearSelection();
              }}
              className="w-10 h-10 rounded-full bg-card/95 text-foreground shadow-lg border border-border flex items-center justify-center hover:bg-card active:scale-95 transition-all cursor-pointer"
              title={t('mobileRecenter')}
              aria-label={t('mobileRecenter')}
            >
              <Navigation size={18} className="text-primary" />
            </button>

            {/* Toggle Route Lines FAB */}
            <button
              type="button"
              onClick={onToggleAllRouteLines}
              className={cn(
                "w-10 h-10 rounded-full shadow-lg border flex items-center justify-center active:scale-95 transition-all cursor-pointer",
                showAllRouteLines 
                  ? "bg-card/95 text-foreground border-border" 
                  : "bg-muted/90 text-muted-foreground border-border/80"
              )}
              title={showAllRouteLines ? "Скрыть линии маршрутов" : "Показать линии маршрутов"}
            >
              {showAllRouteLines ? <Eye size={18} className="text-primary" /> : <EyeOff size={18} />}
            </button>

            {/* Quick Run Routing FAB */}
            <button
              type="button"
              onClick={onOpenRouterModal}
              className="w-11 h-11 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all cursor-pointer border-2 border-background"
              title="Запустить маршрутизацию"
            >
              <Play size={18} className="fill-current ml-0.5" />
            </button>
          </div>

          {/* Map Interactive Android Bottom Sheet */}
          <MobileBottomSheet
            isOpen={activeTab === 'map'}
            state={bottomSheetState}
            onStateChange={setBottomSheetState}
            peekContent={
              activeStoreDetail ? (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 font-bold">
                    <MapPin size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs truncate text-foreground">
                      {activeStoreDetail.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {activeStoreDetail.orders.length} зак. · {roundUp(activeStoreDetail.orders.reduce((s, o) => s + (o.volume || 0), 0))} м³
                    </div>
                  </div>
                </div>
              ) : activeRoute ? (
                <div className="flex items-center gap-2">
                  <div 
                    className="w-3 h-8 rounded-full shrink-0" 
                    style={{ backgroundColor: activeRoute.color || '#3b82f6' }} 
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs truncate text-foreground flex items-center gap-1.5">
                      <span>{activeRoute.name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary/10 text-primary font-mono font-semibold">
                        {getTruckName(activeRoute, 'Грузовик')}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {activeRoute.orderIds?.length || 0} точек · {roundUp(activeRoute.distance || 0)} км · {roundUp(activeRouteVolume)} м³
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                    <Truck size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs text-foreground">
                      {routes.length} маршрутов создано
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {inRouteOrdersCount} из {orders.length} заказов распределено ({roundUp(totalVolume)} м³)
                    </div>
                  </div>
                </div>
              )
            }
          >
            {/* Sheet Expanded Content */}
            {activeStoreDetail ? (
              /* Selected Store Detail View */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-foreground">{activeStoreDetail.name}</h4>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openExternalNavigation(activeStoreDetail.lat, activeStoreDetail.lng, activeStoreDetail.name)}
                      className="h-8 px-2.5 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                    >
                      <ExternalLink size={13} />
                      <span>{t('mobileOpenNavigator')}</span>
                    </Button>
                    {activeStoreDetail.phone && (
                      <a
                        href={`tel:${activeStoreDetail.phone}`}
                        className="h-8 px-2.5 rounded-lg border border-input bg-background hover:bg-accent text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Phone size={13} className="text-emerald-500" />
                        <span>Позвонить</span>
                      </a>
                    )}
                  </div>
                </div>

                {activeStoreDetail.address && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin size={12} className="shrink-0" />
                    <span>{activeStoreDetail.address}</span>
                  </p>
                )}

                <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-muted/40 border border-border/60 text-center">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase font-bold">Заказы</div>
                    <div className="text-xs font-bold text-foreground">{activeStoreDetail.orders.length}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase font-bold">Вес</div>
                    <div className="text-xs font-bold text-foreground">
                      {roundUp(activeStoreDetail.orders.reduce((s, o) => s + (o.weight || 0), 0))} кг
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase font-bold">Объем</div>
                    <div className="text-xs font-bold text-foreground">
                      {roundUp(activeStoreDetail.orders.reduce((s, o) => s + (o.volume || 0), 0))} м³
                    </div>
                  </div>
                </div>

                {/* Orders list in this store */}
                <div className="space-y-1.5">
                  <div className="text-xs font-bold text-foreground">Позиции заказов:</div>
                  {activeStoreDetail.orders.map((order, orderIdx) => (
                    <div 
                      key={`store-order-${order.id || 'order'}-${orderIdx}`}
                      className="p-2 rounded-lg bg-card border border-border/80 text-xs flex items-center justify-between"
                    >
                      <div>
                        <div className="font-semibold text-foreground">№ {order.orderNumber || order.id}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {order.shippingDate} · {order.timeSlot || 'Любое время'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-primary">{roundUp(order.volume || 0)} м³</div>
                        <div className="text-[10px] text-muted-foreground">{roundUp(order.weight || 0)} кг</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : activeRoute ? (
              /* Selected Route Detail View */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-sm text-foreground">{activeRoute.name}</h4>
                    <p className="text-xs text-muted-foreground">
                      {activeRoute.driverName || 'Водитель не назначен'} · {getTruckName(activeRoute, 'Грузовик')}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const firstOrder = activeRouteOrders[0];
                      if (firstOrder) {
                        openExternalNavigation(firstOrder.lat, firstOrder.lng, firstOrder.customerName);
                      }
                    }}
                    className="h-8 px-2.5 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                  >
                    <ExternalLink size={13} />
                    <span>{t('mobileOpenNavigator')}</span>
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-muted/40 border border-border/60 text-center">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase font-bold">Остановок</div>
                    <div className="text-xs font-bold text-foreground">{activeRoute.orderIds?.length || 0}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase font-bold">Дистанция</div>
                    <div className="text-xs font-bold text-foreground">{roundUp(activeRoute.distance || 0)} км</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase font-bold">Объем</div>
                    <div className="text-xs font-bold text-foreground">{roundUp(activeRouteVolume)} м³</div>
                  </div>
                </div>

                {/* Sequence of stops */}
                <div className="space-y-1.5">
                  <div className="text-xs font-bold text-foreground">Последовательность точек ({activeRoute.orderIds?.length || 0}):</div>
                  <div className="space-y-1.5 max-h-60 overflow-y-auto scrollbar-thin pr-1">
                    {activeRouteOrders.map((order, index) => (
                      <div
                        key={`route-stop-${order.id}-${index}`}
                        className="p-2 rounded-xl bg-card border border-border/80 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold text-[10px] flex items-center justify-center shrink-0">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="font-semibold truncate text-foreground">{order.customerName}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{order.region || 'Баку'}</div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => openExternalNavigation(order.lat, order.lng, order.customerName)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                          title="Открыть в навигаторе"
                        >
                          <Navigation size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* Routes Overview in Sheet */
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">
                    Маршруты на карте ({routes.length})
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onOpenRouterModal}
                    className="h-7 text-xs text-primary font-bold hover:bg-primary/10"
                  >
                    Пересчитать
                  </Button>
                </div>

                {routes.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                    {t('mobileNoRoutesNotice')}
                  </div>
                ) : (
                  routes.map((r, rIdx) => (
                    <div
                      key={`route-sheet-${r.id || 'route'}-${rIdx}`}
                      onClick={() => onSelectRoute(r.id)}
                      className={cn(
                        "p-2.5 rounded-xl border text-xs flex items-center justify-between cursor-pointer transition-all",
                        selectedRouteId === r.id
                          ? "border-primary bg-primary/10 shadow-xs"
                          : "border-border bg-card hover:bg-muted/40"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-3 h-8 rounded-full shrink-0" style={{ backgroundColor: r.color || '#3b82f6' }} />
                        <div className="min-w-0">
                          <div className="font-bold text-foreground truncate">{r.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {r.orderIds?.length || 0} точек · {roundUp(r.distance || 0)} км · {getTruckName(r, 'Авто')}
                          </div>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                    </div>
                  ))
                )}
              </div>
            )}
          </MobileBottomSheet>
        </div>

        {/* TAB 2: ROUTES LIST VIEW */}
        <div className={cn("w-full h-full overflow-y-auto p-3 space-y-3 pb-24", activeTab === 'routes' ? 'block' : 'hidden')}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground">Сформированные маршруты</h2>
              <p className="text-xs text-muted-foreground">
                {routes.length} маршрутов · {roundUp(routes.reduce((s, r) => s + (r.distance || 0), 0))} км всего
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={onOpenRouterModal}
              className="gap-1.5 text-xs font-bold shadow-sm"
            >
              <Play size={13} className="fill-current" />
              <span>{t('mobileRunRouting')}</span>
            </Button>
          </div>

          {routes.length === 0 ? (
            <div className="p-8 text-center space-y-3 bg-muted/20 rounded-2xl border border-dashed">
              <Truck size={36} className="mx-auto text-muted-foreground/40" />
              <p className="text-sm font-semibold text-foreground">Маршруты пока не созданы</p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                {t('mobileNoRoutesNotice')}
              </p>
              <Button variant="primary" size="sm" onClick={onOpenRouterModal} className="mt-2">
                Открыть настройки расчета
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {routes.map((route, idx) => {
                const rOrders = (orders || []).filter(o => route.orderIds?.includes(o.id));
                const totalVol = rOrders.reduce((s, o) => s + (o.volume || 0), 0);
                const totalWt = rOrders.reduce((s, o) => s + (o.weight || 0), 0);
                const truckLimit = truckTypes.find(t => t.id === route.truckTypeId);
                const maxVol = truckLimit?.maxVolume || 10;
                const maxWt = truckLimit?.maxWeight || 1500;
                const volPercent = Math.min(100, Math.round((totalVol / maxVol) * 100));
                const isOverloaded = totalVol > maxVol || totalWt > maxWt;

                return (
                  <Card
                    key={`mobile-route-${route.id || 'route'}-${idx}`}
                    className={cn(
                      "p-3.5 space-y-3 transition-all border",
                      selectedRouteId === route.id
                        ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20"
                        : "border-border hover:border-primary/40 bg-card"
                    )}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3.5 h-10 rounded-full shrink-0" 
                          style={{ backgroundColor: route.color || '#3b82f6' }} 
                        />
                        <div>
                          <div className="font-bold text-sm text-foreground flex items-center gap-1.5">
                            <span>{route.name}</span>
                            {isOverloaded && (
                              <span className="px-1.5 py-0.2 rounded-full bg-rose-500/10 text-rose-500 text-[10px] font-bold border border-rose-500/20">
                                Перегруз
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {route.driverName || 'Водитель не назначен'} · {getTruckName(route, 'Грузовик')}
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-bold text-xs text-primary">{roundUp(route.distance || 0)} км</div>
                        <div className="text-[10px] text-muted-foreground">{route.orderIds?.length || 0} точек</div>
                      </div>
                    </div>

                    {/* Progress meters for Weight & Volume */}
                    <div className="space-y-1.5 text-xs bg-muted/30 p-2.5 rounded-xl border border-border/40">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Объем:</span>
                        <span className="font-mono font-bold">
                          {roundUp(totalVol)} / {maxVol} м³ ({volPercent}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all",
                            volPercent > 100 ? "bg-rose-500" : "bg-primary"
                          )}
                          style={{ width: `${volPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleSelectRouteFromMobile(route.id)}
                        className="flex-1 h-9 text-xs font-semibold gap-1.5 cursor-pointer"
                      >
                        <MapIcon size={14} />
                        <span>Показать на карте</span>
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const firstOrderId = route.orderIds?.[0];
                          const firstOrder = firstOrderId ? orders.find(o => o.id === firstOrderId) : null;
                          if (firstOrder) {
                            openExternalNavigation(firstOrder.lat, firstOrder.lng, firstOrder.customerName);
                          }
                        }}
                        className="h-9 px-3 text-xs gap-1.5 cursor-pointer border-input hover:border-primary text-foreground"
                        title={t('mobileOpenNavigator')}
                      >
                        <Navigation size={14} className="text-primary" />
                        <span className="hidden xs:inline">{t('mobileOpenNavigator')}</span>
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* TAB 3: ORDERS & STORES VIEW */}
        <div className={cn("w-full h-full overflow-y-auto p-3 space-y-3 pb-24", activeTab === 'orders' ? 'block' : 'hidden')}>
          {/* Header & Status Chips */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground">Заказы и клиенты</h2>
              <span className="text-xs text-muted-foreground font-mono">
                {mobileFilteredStores.length} точ. · {filteredOrders.length} зак.
              </span>
            </div>

            {/* Quick Status Filter Tabs */}
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-muted/50 border border-border/60 text-xs">
              <button
                type="button"
                onClick={() => setOrderStatusFilter('all')}
                className={cn(
                  "py-1.5 rounded-lg font-semibold transition-all cursor-pointer",
                  orderStatusFilter === 'all'
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Все ({filteredStores.length})
              </button>
              <button
                type="button"
                onClick={() => setOrderStatusFilter('in-route')}
                className={cn(
                  "py-1.5 rounded-lg font-semibold transition-all cursor-pointer",
                  orderStatusFilter === 'in-route'
                    ? "bg-card text-primary shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                В маршруте
              </button>
              <button
                type="button"
                onClick={() => setOrderStatusFilter('not-in-route')}
                className={cn(
                  "py-1.5 rounded-lg font-semibold transition-all cursor-pointer",
                  orderStatusFilter === 'not-in-route'
                    ? "bg-card text-amber-500 shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Без маршрута
              </button>
            </div>
          </div>

          {/* Stores List */}
          <div className="space-y-2">
            {mobileFilteredStores.map((store, sIdx) => {
              const storeOrderIds = store.orders.map(o => o.id);
              const selectedCount = storeOrderIds.filter(id => selectedOrderIds.includes(id)).length;
              const isFullySelected = storeOrderIds.length > 0 && selectedCount === storeOrderIds.length;
              const isPartiallySelected = selectedCount > 0 && selectedCount < storeOrderIds.length;
              const storeVolume = roundUp(store.orders.reduce((s, o) => s + (o.volume || 0), 0));
              const storeWeight = roundUp(store.orders.reduce((s, o) => s + (o.weight || 0), 0));
              const isAssigned = store.orders.some(o => o.routeId);

              return (
                <div
                  key={`mobile-store-${store.name || 'store'}-${sIdx}`}
                  onClick={() => handleStoreClick(store)}
                  className={cn(
                    "p-3 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2",
                    isFullySelected
                      ? "border-primary bg-primary/10 shadow-xs"
                      : "border-border bg-card hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Checkbox with big hit area for finger */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleOrder(storeOrderIds);
                        }}
                        className="w-8 h-8 -ml-1 rounded-lg flex items-center justify-center hover:bg-primary/20 text-muted-foreground transition-colors cursor-pointer shrink-0"
                      >
                        {isFullySelected ? (
                          <CheckSquare size={18} className="text-primary" />
                        ) : isPartiallySelected ? (
                          <div className="w-4 h-4 rounded border-2 border-primary bg-primary/20 flex items-center justify-center">
                            <div className="w-2 h-0.5 bg-primary rounded-full" />
                          </div>
                        ) : (
                          <Square size={18} className="text-muted-foreground/60" />
                        )}
                      </button>

                      <div className="min-w-0">
                        <div className="font-bold text-xs truncate text-foreground">
                          {store.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {store.region || 'Баку'} · {store.orders.length} зак.
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-bold text-xs text-primary">{storeVolume} м³</div>
                      <div className="text-[10px] text-muted-foreground">{storeWeight} кг</div>
                    </div>
                  </div>

                  {/* Badges / Navigation */}
                  <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[11px]">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-semibold",
                      isAssigned 
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" 
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    )}>
                      {isAssigned ? 'В маршруте' : 'Ожидает'}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openExternalNavigation(store.lat, store.lng, store.name);
                      }}
                      className="text-primary hover:underline font-semibold flex items-center gap-1 text-[11px]"
                    >
                      <Navigation size={12} />
                      <span>{t('mobileOpenNavigator')}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* TAB 4: DISPATCHER / TOOLS VIEW */}
        <div className={cn("w-full h-full overflow-y-auto p-4 space-y-4 pb-24", activeTab === 'dispatch' ? 'block' : 'hidden')}>
          <div>
            <h2 className="text-base font-bold text-foreground">Панель управления диспетчера</h2>
            <p className="text-xs text-muted-foreground">
              Авто-маршрутизация, лимиты грузовиков и инструменты
            </p>
          </div>

          {/* Big Action Card: Auto-routing */}
          <Card className="p-4 bg-gradient-to-br from-primary/15 via-primary/5 to-card border-primary/40 space-y-3 shadow-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-md">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-foreground">Авто-маршрутизация</h3>
                  <p className="text-xs text-muted-foreground">Генерация оптимальных путей</p>
                </div>
              </div>
            </div>

            <p className="text-xs text-foreground/80 leading-relaxed">
              Автоматическое распределение {orders.length} заказов по {truckTypes.length} типам авто с учетом вместимости, временных окон и дорог OSRM.
            </p>

            <Button
              variant="primary"
              size="lg"
              onClick={onOpenRouterModal}
              className="w-full h-11 text-sm font-bold gap-2 shadow-lg cursor-pointer rounded-xl"
            >
              <Play size={16} className="fill-current" />
              <span>Запустить расчет маршрутов</span>
            </Button>
          </Card>

          {/* Quick Actions Grid (Touch-friendly 2 columns) */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Trucks & Limits */}
            <button
              type="button"
              onClick={onOpenRouterModal}
              className="p-3.5 rounded-2xl bg-card border border-border hover:border-primary/40 text-left transition-all cursor-pointer shadow-xs active:scale-98"
            >
              <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-500 flex items-center justify-center mb-2">
                <Truck size={17} />
              </div>
              <div className="font-bold text-xs text-foreground">Грузовики и лимиты</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{truckTypes.length} типов транспорта</div>
            </button>

            {/* Route Audit */}
            <button
              type="button"
              onClick={onOpenAuditModal}
              className="p-3.5 rounded-2xl bg-card border border-border hover:border-primary/40 text-left transition-all cursor-pointer shadow-xs active:scale-98"
            >
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-2">
                <ShieldCheck size={17} />
              </div>
              <div className="font-bold text-xs text-foreground">Аудит маршрутов</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Проверка нарушений и веса</div>
            </button>

            {/* Import Excel */}
            <label className="p-3.5 rounded-2xl bg-card border border-border hover:border-primary/40 text-left transition-all cursor-pointer shadow-xs active:scale-98 block">
              <input type="file" className="hidden" onChange={onImportExcel} accept=".xlsx, .xls" />
              <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center mb-2">
                <Upload size={17} />
              </div>
              <div className="font-bold text-xs text-foreground">{t('btnImportExcel')}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Загрузить таблицу заказов</div>
            </label>

            {/* Export Template */}
            <button
              type="button"
              onClick={onExportTemplate}
              className="p-3.5 rounded-2xl bg-card border border-border hover:border-primary/40 text-left transition-all cursor-pointer shadow-xs active:scale-98"
            >
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-2">
                <FileSpreadsheet size={17} />
              </div>
              <div className="font-bold text-xs text-foreground">{t('btnExportTemplate')}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Скачать образец таблицы</div>
            </button>

            {/* Store-to-store transfer */}
            {onAddTransfer && (
              <button
                type="button"
                onClick={onAddTransfer}
                className="p-3.5 rounded-2xl bg-card border border-border hover:border-primary/40 text-left transition-all cursor-pointer shadow-xs active:scale-98"
              >
                <div className="w-8 h-8 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center mb-2">
                  <ArrowLeftRight size={17} />
                </div>
                <div className="font-bold text-xs text-foreground">{t('transferAddButton')}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{t('transferFrom')} → {t('transferTo')}</div>
              </button>
            )}

            {/* Scenarios & History */}
            <button
              type="button"
              onClick={onOpenHelpModal}
              className="p-3.5 rounded-2xl bg-card border border-border hover:border-primary/40 text-left transition-all cursor-pointer shadow-xs active:scale-98"
            >
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center mb-2">
                <Layers size={17} />
              </div>
              <div className="font-bold text-xs text-foreground">Справка и инструкция</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Руководство диспетчера</div>
            </button>

            {/* Switch View Format */}
            <button
              type="button"
              onClick={onSwitchToDesktop}
              className="p-3.5 rounded-2xl bg-card border border-border hover:border-primary/40 text-left transition-all cursor-pointer shadow-xs active:scale-98"
            >
              <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center mb-2">
                <Monitor size={17} />
              </div>
              <div className="font-bold text-xs text-foreground">{t('viewFormatDesktop')}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Вернуться в полный вид</div>
            </button>
          </div>
        </div>
      </main>

      {/* 3. Android Material 3 Bottom Navigation Bar */}
      <nav className="shrink-0 h-16 bg-card/95 backdrop-blur-md border-t border-border px-3 flex items-center justify-around z-[1400] shadow-2xl safe-area-pb">
        {[
          { id: 'map' as MobileTab, label: t('mobileNavMap'), icon: MapIcon },
          { 
            id: 'routes' as MobileTab, 
            label: t('mobileNavRoutes'), 
            icon: Truck, 
            badge: routes.length > 0 ? routes.length : undefined 
          },
          { 
            id: 'orders' as MobileTab, 
            label: t('mobileNavOrders'), 
            icon: Package, 
            badge: selectedOrderIds.length > 0 ? selectedOrderIds.length : undefined 
          },
          { id: 'dispatch' as MobileTab, label: t('mobileNavDispatch'), icon: Sliders }
        ].map((item, navIdx) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={`nav-item-${item.id}-${navIdx}`}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "flex-1 h-full flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative py-1",
                isActive 
                  ? "text-primary font-bold" 
                  : "text-muted-foreground hover:text-foreground font-medium"
              )}
            >
              {/* Active pill background (Material 3 style) */}
              <div className={cn(
                "relative px-4 py-0.5 rounded-full flex items-center justify-center transition-all",
                isActive ? "bg-primary/15 text-primary" : "bg-transparent"
              )}>
                <Icon size={20} className={isActive ? "stroke-[2.4]" : "stroke-[1.8]"} />
                {item.badge !== undefined && (
                  <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground font-bold text-[9px] flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] leading-none tracking-tight">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
