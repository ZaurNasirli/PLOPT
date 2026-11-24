import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, Polygon, Circle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-lasso';
import { Eye, EyeOff, Navigation, MapPin, Paintbrush, MousePointerClick, Check, X, RotateCcw, AlertCircle, Plus, Sparkles } from 'lucide-react';
import { Order, Route, Store, Zone, StreetHighlight, StoreMarkerLabelMode, RoadBarrier } from '../../types';
import { BarrierLayers, BarrierClickHandler, FlyToPoint } from './BarrierLayers';
import { Button, Card } from '../common/UIComponents';
import { cn } from '../../lib/utils';
import { WAREHOUSE_LOCATION } from '../../mockData';

// Helper for rounding up numbers
const roundUp = (val: number): number => Math.ceil(val);

function StreetClickHandler({
  isActive,
  onMapClickStreet
}: {
  isActive: boolean;
  onMapClickStreet?: (lat: number, lng: number) => void;
}) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    if (isActive) {
      L.DomUtil.addClass(container, 'crosshair-cursor');
    } else {
      L.DomUtil.removeClass(container, 'crosshair-cursor');
    }
    return () => {
      L.DomUtil.removeClass(container, 'crosshair-cursor');
    };
  }, [isActive, map]);

  useMapEvents({
    click: (e) => {
      if (!isActive || !onMapClickStreet) return;
      onMapClickStreet(e.latlng.lat, e.latlng.lng);
    }
  });

  return null;
}

function StreetBrushHandler({
  isActive,
  brushRadiusMeters,
  onAddBrushPoint,
  onBrushComplete
}: {
  isActive: boolean;
  brushRadiusMeters: number;
  onAddBrushPoint?: (point: [number, number]) => void;
  onBrushComplete?: () => void;
}) {
  const map = useMap();
  const [isPainting, setIsPainting] = useState(false);
  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null);

  useEffect(() => {
    const container = map.getContainer();
    if (isActive) {
      map.dragging.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
      map.boxZoom.disable();
      L.DomUtil.addClass(container, 'brush-cursor');
    } else {
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
      L.DomUtil.removeClass(container, 'brush-cursor');
      setIsPainting(false);
      setCursorPos(null);
    }
    return () => {
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
      L.DomUtil.removeClass(container, 'brush-cursor');
    };
  }, [isActive, map]);

  useMapEvents({
    mousedown: (e) => {
      if (!isActive || !onAddBrushPoint) return;
      setIsPainting(true);
      onAddBrushPoint([e.latlng.lat, e.latlng.lng]);
    },
    mousemove: (e) => {
      if (!isActive) return;
      setCursorPos([e.latlng.lat, e.latlng.lng]);
      if (isPainting && onAddBrushPoint) {
        onAddBrushPoint([e.latlng.lat, e.latlng.lng]);
      }
    },
    mouseup: () => {
      if (!isActive) return;
      if (isPainting) {
        setIsPainting(false);
        onBrushComplete?.();
      }
    }
  });

  if (!isActive || !cursorPos) return null;

  return (
    <Circle
      center={cursorPos}
      radius={brushRadiusMeters}
      pathOptions={{
        color: '#06b6d4',
        fillColor: '#06b6d4',
        fillOpacity: 0.18,
        weight: 1.5,
        dashArray: '4, 4'
      }}
    />
  );
}

interface ZonePolygonProps {
  key?: string;
  zone: Zone;
  onUpdate: (newPoly: [number, number][]) => void;
  allZones: Zone[];
}

function ZonePolygon({ zone, onUpdate, allZones }: ZonePolygonProps) {
  const [isEditing, setIsEditing] = useState(false);

  const handleVertexDrag = (idx: number, newPos: [number, number]) => {
    const newPoly = [...zone.polygon];
    
    // Snapping logic
    let snappedPos = newPos;
    const SNAP_THRESHOLD = 0.001; // Roughly 100 meters

    for (const otherZone of allZones) {
      if (otherZone.id === zone.id) continue;
      for (const vertex of otherZone.polygon) {
        const dist = Math.sqrt(Math.pow(vertex[0] - newPos[0], 2) + Math.pow(vertex[1] - newPos[1], 2));
        if (dist < SNAP_THRESHOLD) {
          snappedPos = vertex;
          break;
        }
      }
    }

    newPoly[idx] = snappedPos;
    onUpdate(newPoly);
  };

  return (
    <>
      <Polygon 
        positions={zone.polygon} 
        pathOptions={{ 
          fillColor: zone.color, 
          color: zone.color, 
          weight: isEditing ? 3 : 2, 
          fillOpacity: 0.2 
        }}
        eventHandlers={{
          click: () => setIsEditing(!isEditing)
        }}
      >
        <Popup>
          <div className="p-2">
            <h4 className="font-bold text-sm">{zone.name}</h4>
            <p className="text-xs text-muted-foreground">{zone.orderIds.length} заказов</p>
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-2 w-full text-xs"
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? 'Завершить редактирование' : 'Редактировать вершины'}
            </Button>
          </div>
        </Popup>
      </Polygon>

      {isEditing && zone.polygon.map((point, idx) => (
        <Marker 
          key={`zone-vertex-${zone.id || 'z'}-${idx}`}
          position={point}
          draggable={true}
          icon={L.divIcon({
            className: 'vertex-icon',
            html: `<div style="background: white; border: 2px solid ${zone.color}; width: 10px; height: 10px; border-radius: 50%;"></div>`,
            iconSize: [10, 10],
            iconAnchor: [5, 5]
          })}
          eventHandlers={{
            drag: (e) => {
              const newPos = e.target.getLatLng();
              handleVertexDrag(idx, [newPos.lat, newPos.lng]);
            }
          }}
        />
      ))}
    </>
  );
}

function LassoHandler({ onSelect, orders }: { onSelect: (ids: string[]) => void, orders: Order[] }) {
  const map = useMap();
  
  useEffect(() => {
    if (!map) return;
    
    // @ts-ignore
    const lasso = L.lasso(map, {
      intersect: true
    });

    const handleLassoFinished = (e: any) => {
      const selectedLayers = e.layers;
      const ids: string[] = [];
      
      selectedLayers.forEach((layer: any) => {
        // Try to get orderIds from marker options first (most reliable)
        if (layer.options && layer.options.orderIds) {
          ids.push(...layer.options.orderIds);
        } else if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
          const pos = layer.getLatLng();
          const ordersAtPos = orders.filter(o => 
            Math.abs(o.lat - pos.lat) < 0.0001 && 
            Math.abs(o.lng - pos.lng) < 0.0001
          );
          ids.push(...ordersAtPos.map(o => o.id));
        }
      });
      
      if (ids.length > 0) {
        onSelect(ids);
      }
    };

    map.on('lasso.finished', handleLassoFinished);
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey) {
        lasso.enable();
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey) {
        lasso.disable();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      map.off('lasso.finished', handleLassoFinished);
    };
  }, [map, orders, onSelect]);

  return null;
}

function MapEventsHandler({ 
  onCreateRoute, 
  focusedStore, 
  onClearSelection,
  selectedRouteId,
  routes,
  orders,
  onClearRouteSelection,
  onHoverRoute
}: { 
  onCreateRoute: () => void; 
  focusedStore: Store | null; 
  onClearSelection: () => void;
  selectedRouteId?: string | null;
  routes?: Route[];
  orders?: Order[];
  onClearRouteSelection?: () => void;
  onHoverRoute?: (id: string | null) => void;
  storeMarkersRef?: React.MutableRefObject<Map<string, L.Marker>>;
}) {
  const map = useMap();

  useEffect(() => {
    if (focusedStore) {
      map.setView([focusedStore.lat, focusedStore.lng], 16, { animate: true });
    }
  }, [focusedStore, focusedStore?.focusTrigger, map]);

  useEffect(() => {
    if (!selectedRouteId || !routes || !orders) return;
    const selectedRoute = routes.find(r => r.id === selectedRouteId);
    if (!selectedRoute) return;

    const routeOrders = orders.filter(o => selectedRoute.orderIds.includes(o.id));
    if (routeOrders.length === 0) return;

    const points: [number, number][] = [
      [WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng],
      ...routeOrders.map(o => [o.lat, o.lng] as [number, number])
    ];

    if (selectedRoute.geometry && selectedRoute.geometry.length > 0) {
      selectedRoute.geometry.forEach(p => points.push(p));
    }

    try {
      const bounds = L.latLngBounds(points);
      // the route panel covers roughly the lower half of the map: keep the route above it
      const bottomPad = Math.round(map.getSize().y * 0.5) + 24;
      map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [50, bottomPad], maxZoom: 15, animate: true });
    } catch (e) {
      console.error('Error auto-centering map on route:', e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRouteId, map]);

  useMapEvents({
    click: () => {
      onClearRouteSelection?.();
      onHoverRoute?.(null);
    },
    mousedown: (e) => {
      if (e.originalEvent.button === 1) { // Wheel click
        onCreateRoute();
      }
    },
    contextmenu: () => {
      onClearSelection();
    }
  });
  return null;
}

export interface MapViewProps {
  orders: Order[];
  routes: Route[];
  selectedOrderIds: string[];
  onToggleOrder: (id: string | string[]) => void;
  streetHighlights: StreetHighlight[];
  onCreateRoute: () => void;
  focusedStore: Store | null;
  onClearSelection: () => void;
  isRouting: boolean;
  routingProgress: { percent: number; message: string; logs: string[] };
  setIsRouting: (val: boolean) => void;
  hoveredRouteId: string | null;
  selectedRouteId: string | null;
  zones: Zone[];
  isDrawingZone?: boolean;
  currentDrawingPolygon?: [number, number][];
  onAddPointToDrawingPolygon?: (point: [number, number]) => void;
  onUpdateZonePolygon: (id: string, polygon: [number, number][]) => void;
  showAllRouteLines: boolean;
  onToggleAllRouteLines: () => void;
  onRecalculateAllRoadGeometry?: () => void;
  isCalculatingGeometry?: boolean;
  streetLineWidth?: number;
  streetLineOpacity?: number;
  onHoverRoute?: (id: string | null) => void;
  onClearRouteSelection?: () => void;
  // Street selection props
  activeStreetMode?: 'name' | 'click' | 'brush' | null;
  onSetActiveStreetMode?: (mode: 'name' | 'click' | 'brush' | null) => void;
  onMapClickStreet?: (lat: number, lng: number) => void;
  isClickingStreetLoading?: boolean;
  brushRadiusMeters?: number;
  onSetBrushRadiusMeters?: (radius: number) => void;
  currentBrushTrail?: [number, number][];
  currentBrushOrderIds?: string[];
  onAddBrushPoint?: (point: [number, number]) => void;
  onBrushComplete?: () => void;
  onSaveCurrentBrushAsStreet?: () => void;
  onClearCurrentBrush?: () => void;
  onSelectStreetOrders?: (orderIds: string[]) => void;
  onOpenStreetsTab?: () => void;
  onSelectRoute?: (id: string | null) => void;
  storeMarkerLabelMode?: StoreMarkerLabelMode;
  // Road barriers
  barriers?: RoadBarrier[];
  barrierPlacementMode?: 'point' | 'zone' | null;
  barrierZoneRadius?: number;
  onMapClickBarrier?: (lat: number, lng: number) => void;
  onSetBarrierPlacementMode?: (mode: 'point' | 'zone' | null) => void;
  onToggleBarrier?: (id: string) => void;
  onDeleteBarrier?: (id: string) => void;
  isPlacingBarrier?: boolean;
  focusPoint?: { lat: number; lng: number; zoom?: number; ts: number } | null;
}

export function MapView({ 
  orders, 
  routes, 
  selectedOrderIds, 
  onToggleOrder, 
  streetHighlights = [], 
  onCreateRoute, 
  focusedStore, 
  onClearSelection, 
  isRouting, 
  routingProgress, 
  setIsRouting, 
  hoveredRouteId, 
  selectedRouteId, 
  zones, 
  isDrawingZone, 
  currentDrawingPolygon, 
  onAddPointToDrawingPolygon, 
  onUpdateZonePolygon, 
  showAllRouteLines, 
  onToggleAllRouteLines, 
  onRecalculateAllRoadGeometry, 
  isCalculatingGeometry, 
  streetLineWidth = 6, 
  streetLineOpacity = 0.9, 
  onHoverRoute, 
  onClearRouteSelection, 
  onSelectRoute, 
  activeStreetMode = null, 
  onSetActiveStreetMode, 
  onMapClickStreet, 
  isClickingStreetLoading = false, 
  brushRadiusMeters = 80, 
  onSetBrushRadiusMeters, 
  currentBrushTrail = [], 
  currentBrushOrderIds = [], 
  onAddBrushPoint, 
  onBrushComplete, 
  onSaveCurrentBrushAsStreet, 
  onClearCurrentBrush, 
  onSelectStreetOrders, 
  onOpenStreetsTab,
  storeMarkerLabelMode = ['volume'],
  barriers = [],
  barrierPlacementMode = null,
  barrierZoneRadius = 300,
  onMapClickBarrier,
  onSetBarrierPlacementMode,
  onToggleBarrier,
  onDeleteBarrier,
  isPlacingBarrier = false,
  focusPoint = null
}: MapViewProps) {
  const [contextMenu, setContextMenu] = useState<{ 
    x: number; 
    y: number; 
    storeName: string; 
    orders: Order[];
    storeCode?: string;
    region?: string;
    stopSequenceNumber?: number | null;
    totalVolume: number;
    totalWeight: number;
    totalSatir: number;
    routeName?: string;
    routeColor?: string;
  } | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const storeMarkersRef = useRef<Map<string, L.Marker>>(new Map());

  const handleMapClick = () => {
    setContextMenu(null);
  };

  return (
    <div 
      ref={mapContainerRef}
      className="w-full h-full relative" 
      onClick={handleMapClick}
    >
      <MapContainer 
        center={[WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng]} 
        zoom={12} 
        className="w-full h-full"
        zoomControl={false}
      >
        <TileLayer
          crossOrigin=""
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        
        <LassoHandler onSelect={(ids) => onToggleOrder(ids)} orders={orders} />
        <MapEventsHandler 
          onCreateRoute={onCreateRoute} 
          focusedStore={focusedStore} 
          onClearSelection={onClearSelection} 
          selectedRouteId={selectedRouteId}
          routes={routes}
          orders={orders}
          onClearRouteSelection={onClearRouteSelection}
          onHoverRoute={onHoverRoute}
          storeMarkersRef={storeMarkersRef}
        />

        {/* Zones */}
        {zones.filter(z => z.isVisible).map((zone, zIdx) => (
          <ZonePolygon 
            key={`map-zone-${zone.id || 'z'}-${zIdx}`} 
            zone={zone} 
            onUpdate={(newPoly) => onUpdateZonePolygon(zone.id, newPoly)}
            allZones={zones}
          />
        ))}

        {/* Road barriers (closed roads) */}
        <BarrierLayers barriers={barriers} onToggleBarrier={onToggleBarrier} onDeleteBarrier={onDeleteBarrier} />
        <BarrierClickHandler isActive={Boolean(barrierPlacementMode)} onMapClick={onMapClickBarrier} />
        <FlyToPoint target={focusPoint} />

        {/* Interactive Street Click Handler (Способ 2) */}
        <StreetClickHandler 
          isActive={activeStreetMode === 'click'} 
          onMapClickStreet={onMapClickStreet} 
        />

        {/* Interactive Street Brush Handler (Способ 3) */}
        <StreetBrushHandler 
          isActive={activeStreetMode === 'brush'} 
          brushRadiusMeters={brushRadiusMeters} 
          onAddBrushPoint={onAddBrushPoint} 
          onBrushComplete={onBrushComplete} 
        />

        {/* Highlighted Streets Layers (Способы 1, 2, 3) */}
        {streetHighlights.filter(s => s.isVisible !== false).map((street, stIdx) => {
          const lines: [number, number][][] = street.multiCoordinates && street.multiCoordinates.length > 0
            ? street.multiCoordinates
            : (street.coordinates && street.coordinates.length >= 2 ? [street.coordinates] : []);

          if (lines.length === 0) return null;

          const currentThickness = street.thickness || streetLineWidth;
          const currentOpacity = street.opacity !== undefined ? street.opacity : streetLineOpacity;

          const baseWidth = street.source === 'brush' 
            ? Math.max(currentThickness, 5) 
            : currentThickness;
          const auraWidth = street.source === 'brush' 
            ? Math.max(baseWidth * 2.4, (street.brushRadius || 80) / 3) 
            : baseWidth * 2.2;
          const auraOpacity = Math.min(0.55, currentOpacity * 0.38);

          return (
            <React.Fragment key={`map-street-${street.id || 'st'}-${stIdx}`}>
              {lines.map((segCoords, segIdx) => (
                <React.Fragment key={`map-street-seg-${street.id || 'st'}-${segIdx}`}>
                  {/* Outer glowing aura */}
                  <Polyline
                    positions={segCoords}
                    pathOptions={{
                      color: street.color,
                      weight: auraWidth,
                      opacity: auraOpacity,
                      lineCap: 'round',
                      lineJoin: 'round'
                    }}
                  />
                  {/* Core solid road line */}
                  <Polyline
                    positions={segCoords}
                    pathOptions={{
                      color: street.color,
                      weight: baseWidth,
                      opacity: currentOpacity,
                      lineCap: 'round',
                      lineJoin: 'round'
                    }}
                  >
                    {segIdx === 0 && (
                      <Popup>
                        <div className="p-1.5 space-y-1.5 text-xs max-w-xs">
                          <div className="font-bold flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: street.color }} />
                            <span className="truncate">{street.name}</span>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <span>Способ:</span>
                            <span className="font-semibold text-foreground">
                              {street.source === 'name' ? '🔤 По названию' : street.source === 'click' ? '👆 Клик на карте' : '🖌️ Ручная кисть'}
                            </span>
                          </div>
                          <div className="text-[10.5px]">
                            Прилегающих заказов: <span className="font-bold text-primary">{street.orderIds?.length || 0}</span>
                          </div>
                          {street.orderIds && street.orderIds.length > 0 && onSelectStreetOrders && (
                            <Button
                              size="sm"
                              className="w-full h-7 text-[10px] mt-1 gap-1"
                              onClick={() => onSelectStreetOrders(street.orderIds || [])}
                            >
                              <Check size={12} /> Выбрать заказы улицы
                            </Button>
                          )}
                        </div>
                      </Popup>
                    )}
                  </Polyline>
                </React.Fragment>
              ))}
            </React.Fragment>
          );
        })}

        {/* Live Brush Trail while user is actively painting with brush */}
        {currentBrushTrail && currentBrushTrail.length > 1 && (
          <>
            <Polyline
              positions={currentBrushTrail}
              pathOptions={{
                color: '#06b6d4',
                weight: Math.max(16, brushRadiusMeters / 2.5),
                opacity: 0.45,
                lineCap: 'round',
                lineJoin: 'round'
              }}
            />
            <Polyline
              positions={currentBrushTrail}
              pathOptions={{
                color: '#0891b2',
                weight: 3.5,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round'
              }}
            />
          </>
        )}

        {/* Warehouse */}
        <CircleMarker 
          center={[WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng]} 
          radius={8}
          pathOptions={{ fillColor: 'red', color: 'white', weight: 2, fillOpacity: 1 }}
        >
          <Popup>Склад (Баку)</Popup>
        </CircleMarker>

        {/* Stores (Aggregated) */}
        {Array.from(new Set(orders.map(o => o.customerName))).map((storeName, storeIdx) => {
          const storeOrders = orders.filter(o => o.customerName === storeName);
          if (storeOrders.length === 0) return null;
          
          const firstOrder = storeOrders[0];
          const allSelected = storeOrders.every(o => selectedOrderIds.includes(o.id));
          const someSelected = storeOrders.some(o => selectedOrderIds.includes(o.id));
          const isInRoute = storeOrders.some(o => o.status === 'in-route');
          
          // Identify if this store belongs to any route
          const storeRoute = routes.find(r => storeOrders.some(o => r.orderIds.includes(o.id) || o.routeId === r.id));

          // Hover and Selection state
          const isHoveredRoute = Boolean(hoveredRouteId && storeOrders.some(o => o.routeId === hoveredRouteId || (routes.find(r => r.id === hoveredRouteId)?.orderIds.includes(o.id))));
          const isSelectedRoute = Boolean(!hoveredRouteId && selectedRouteId && storeOrders.some(o => o.routeId === selectedRouteId || (routes.find(r => r.id === selectedRouteId)?.orderIds.includes(o.id))));
          const isHighlighted = Boolean(isHoveredRoute || isSelectedRoute);
          const activeRoute = isHighlighted ? routes.find(r => r.id === (isHoveredRoute ? hoveredRouteId : selectedRouteId)) : null;
          
          // Determine sequential stop position along the active route (1-based by unique store)
          let stopSequenceNumber: number | null = null;
          if (activeRoute) {
            const uniqueRouteStores: string[] = [];
            for (const oid of activeRoute.orderIds) {
              const ord = orders.find(o => o.id === oid);
              if (ord && !uniqueRouteStores.includes(ord.customerName)) {
                uniqueRouteStores.push(ord.customerName);
              }
            }
            const seqIndex = uniqueRouteStores.indexOf(storeName);
            if (seqIndex !== -1) {
              stopSequenceNumber = seqIndex + 1;
            }
          }
          
          let color = '#3b82f6'; // Blue default for unassigned stores
          if (allSelected) color = '#10b981'; // Green
          else if (someSelected) color = '#8b5cf6'; // Purple (partial)
          else if (isHighlighted && activeRoute) color = activeRoute.color;
          else if (storeRoute) color = storeRoute.color; // Assigned route's color
          else if (isInRoute) color = '#f59e0b'; // Yellow fallback

          const totalVolume = storeOrders.reduce((sum, o) => sum + o.volume, 0);
          const totalWeight = storeOrders.reduce((sum, o) => sum + o.weight, 0);
          const totalSatir = storeOrders.reduce((sum, o) => sum + (o.satir || 0), 0);
          const storeCode = storeOrders.find(o => o.code)?.code || '';

          const selectedModes = Array.isArray(storeMarkerLabelMode) 
            ? storeMarkerLabelMode 
            : (storeMarkerLabelMode ? [storeMarkerLabelMode] : ['volume']);

          // Sequence requirement: код  название - обьем/вес/товар
          // 1. Identity part: code, name separated by two spaces "  "
          const identityParts: string[] = [];
          if (selectedModes.includes('code')) {
            const c = storeCode || (storeName.length > 8 ? storeName.slice(0, 6) : storeName);
            if (c) identityParts.push(c);
          }
          if (selectedModes.includes('name')) {
            identityParts.push(storeName);
          }
          const identityStr = identityParts.join('  ');

          // 2. Metrics part: volume, weight, items separated by "/"
          const metricParts: string[] = [];
          const isSingleMetricOnly = selectedModes.length === 1 && !identityStr;
          if (selectedModes.includes('volume')) {
            metricParts.push(isSingleMetricOnly ? `${roundUp(totalVolume)} м³` : `${roundUp(totalVolume)}`);
          }
          if (selectedModes.includes('weight')) {
            metricParts.push(isSingleMetricOnly ? `${roundUp(totalWeight)} кг` : `${roundUp(totalWeight)}`);
          }
          if (selectedModes.includes('items')) {
            const count = totalSatir > 0 ? totalSatir : storeOrders.length;
            metricParts.push(isSingleMetricOnly ? `${count} тов.` : `${count}`);
          }
          const metricsStr = metricParts.join('/');

          // 3. Between groups: dash " - "
          let markerLabel = '';
          if (identityStr && metricsStr) {
            markerLabel = `${identityStr} - ${metricsStr}`;
          } else if (identityStr) {
            markerLabel = identityStr;
          } else if (metricsStr) {
            markerLabel = metricsStr;
          } else {
            markerLabel = `${roundUp(totalVolume)} м³`;
          }

          const isBrushedStore = currentBrushOrderIds && currentBrushOrderIds.length > 0 && currentBrushOrderIds.some(id => storeOrders.some(o => o.id === id));
          const matchingStreet = streetHighlights.find(s => s.isVisible !== false && s.orderIds?.some(id => storeOrders.some(o => o.id === id)));

          let markerBorder = isHighlighted ? '3px solid white' : '2px solid white';
          let markerBoxShadow = '0 3px 6px rgba(0,0,0,0.3)';
          let extraStyle = '';
          if (isBrushedStore) {
            markerBorder = '3px solid #06b6d4';
            markerBoxShadow = '0 0 14px #06b6d4, 0 3px 6px rgba(0,0,0,0.3)';
            extraStyle = 'transform: translate(-50%, -50%) scale(1.15);';
          } else if (matchingStreet) {
            markerBorder = `3px solid ${matchingStreet.color}`;
            markerBoxShadow = `0 0 10px ${matchingStreet.color}, 0 3px 6px rgba(0,0,0,0.3)`;
          }

          // Strict dimming: ONLY dim when hovering over a route and this store isn't on that route.
          // When hoveredRouteId is null and no route is selected, opacity is strictly 1 (completely normal).
          const isDimmed = Boolean((hoveredRouteId && !isHoveredRoute) || (!hoveredRouteId && selectedRouteId && !isSelectedRoute));
          const markerOpacity = isDimmed ? 0.22 : 1;
          const filterStyle = isDimmed ? 'filter: grayscale(0.6);' : '';

          const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="
              position: absolute;
              transform: translate(-50%, -50%);
              background-color: ${color};
              min-width: ${isHighlighted ? '30px' : '26px'};
              max-width: ${isHighlighted ? '280px' : '240px'};
              width: max-content;
              height: ${isHighlighted ? '27px' : '23px'};
              padding: 0 ${isHighlighted ? '8px' : '6px'};
              border-radius: 9999px;
              border: ${markerBorder};
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 3.5px;
              color: white;
              font-size: ${isHighlighted ? '11px' : '10px'};
              font-weight: 700;
              box-shadow: ${markerBoxShadow};
              transition: opacity 0.2s ease, transform 0.2s ease, filter 0.2s ease;
              z-index: ${isHighlighted ? 1000 : 1};
              opacity: ${markerOpacity};
              ${filterStyle}
              pointer-events: auto;
              user-select: none;
              line-height: 1;
              white-space: nowrap;
              ${extraStyle}
            ">
              ${stopSequenceNumber !== null ? `<span style="background: rgba(0,0,0,0.32); border-radius: 6px; padding: 1px 3.5px; font-size: 8.5px; line-height: 1; flex-shrink: 0;">№${stopSequenceNumber}</span>` : ''}
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${markerLabel}</span>
            </div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
            popupAnchor: [0, -14],
          });

          return (
            <Marker 
              key={`store-marker-${storeName || 'store'}-${storeIdx}-${selectedModes.join('_')}-${isHighlighted ? 'hl' : 'norm'}-${isDimmed ? 'dim' : 'nodim'}-${color}`}
              ref={(markerRef) => {
                if (markerRef) {
                  storeMarkersRef.current.set(storeName, markerRef);
                } else {
                  storeMarkersRef.current.delete(storeName);
                }
              }}
              position={[firstOrder.lat, firstOrder.lng]} 
              icon={icon}
              // @ts-ignore
              orderIds={storeOrders.map(o => o.id)}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  onToggleOrder(storeOrders.map(o => o.id));
                },
                contextmenu: (e) => {
                  L.DomEvent.stopPropagation(e);
                  setContextMenu({ 
                    x: e.originalEvent.clientX, 
                    y: e.originalEvent.clientY, 
                    storeName, 
                    orders: storeOrders,
                    storeCode,
                    region: firstOrder.region || '',
                    stopSequenceNumber,
                    totalVolume,
                    totalWeight,
                    totalSatir,
                    routeName: storeRoute?.name || (activeRoute?.name || undefined),
                    routeColor: storeRoute?.color || (activeRoute?.color || undefined),
                  });
                }
              }}
            />
          );
        })}

        {/* Routes Polylines & Animated Direction Arrows */}
        {showAllRouteLines && routes.filter(r => r.isVisible !== false).map((route, routeIdx) => {
          const routeOrders = route.orderIds
            .map(id => orders.find(o => o.id === id))
            .filter((o): o is Order => Boolean(o));
          if (routeOrders.length === 0) return null;
          const isHighlighted = route.id === hoveredRouteId || (!hoveredRouteId && route.id === selectedRouteId);
          const anyHovered = Boolean(hoveredRouteId);
          const anySelected = Boolean(selectedRouteId);
          const opacity = anyHovered 
            ? (isHighlighted ? 1 : 0.2) 
            : (anySelected ? (isHighlighted ? 1 : 0.18) : 0.85);
          
          const positions: [number, number][] = route.geometry && route.geometry.length > 0 
            ? route.geometry 
            : [
                [WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng],
                ...routeOrders.map(o => [o.lat, o.lng] as [number, number]),
                [WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng]
              ];

          return (
            <Polyline 
              key={`route-line-${route.id}-${routeIdx}-${isHighlighted ? 'hl' : 'no'}-${anyHovered ? 'hov' : 'idle'}`}
              positions={positions}
              pathOptions={{ 
                color: route.color, 
                weight: isHighlighted ? 6.5 : 3.5, 
                opacity: opacity,
                dashArray: route.geometry ? undefined : '10, 10'
              }}
              eventHandlers={{
                mouseover: () => onHoverRoute?.(route.id),
                mouseout: () => onHoverRoute?.(null),
                click: () => onSelectRoute?.(route.id)
              }}
            />
          );
        })}
      </MapContainer>

      {/* Top Banner when Street Click or Brush Mode is active */}
      <AnimatePresence>
        {barrierPlacementMode && (
          <motion.div
            key="barrier-mode-banner"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-card/95 backdrop-blur-md border border-red-500/40 shadow-xl rounded-full px-4 py-2 flex items-center gap-3 text-xs font-medium max-w-[calc(100%-24px)]"
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
            </span>
            <span className="font-semibold text-foreground">
              {isPlacingBarrier
                ? 'Привязываем барьер к дороге...'
                : barrierPlacementMode === 'point'
                  ? 'Кликните по улице — этот участок дороги будет закрыт'
                  : `Кликните в центр закрываемой зоны (радиус ${barrierZoneRadius} м)`}
            </span>
            {isPlacingBarrier && <div className="animate-spin w-3.5 h-3.5 border-2 border-red-500 border-t-transparent rounded-full shrink-0" />}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] rounded-full hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => onSetBarrierPlacementMode?.(null)}
            >
              <Check size={13} className="mr-1" /> Готово
            </Button>
          </motion.div>
        )}

        {activeStreetMode === 'click' && (
          <motion.div
            key="street-mode-click-banner"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-card/95 backdrop-blur-md border border-sky-500/40 shadow-xl rounded-full px-4 py-2 flex items-center gap-3 text-xs font-medium"
          >
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500"></span>
              </span>
              <span className="font-semibold text-foreground">
                {isClickingStreetLoading ? 'Определяем улицу по координатам...' : 'Режим клика: нажмите на любую улицу на карте'}
              </span>
            </div>
            {isClickingStreetLoading && (
              <div className="animate-spin w-3.5 h-3.5 border-2 border-sky-500 border-t-transparent rounded-full" />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] rounded-full hover:bg-accent text-muted-foreground hover:text-foreground"
              onClick={() => onSetActiveStreetMode?.(null)}
            >
              <X size={13} className="mr-1" /> Завершить
            </Button>
          </motion.div>
        )}

        {activeStreetMode === 'brush' && (
          <motion.div
            key="street-mode-brush-banner"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-card/95 backdrop-blur-md border border-cyan-500/40 shadow-xl rounded-2xl px-4 py-2 flex flex-wrap items-center gap-3 text-xs font-medium"
          >
            <div className="flex items-center gap-2">
              <Paintbrush size={14} className="text-cyan-500" />
              <span>Зажмите ЛКМ и ведите по карте</span>
              <span className="text-[11px] text-muted-foreground font-normal">
                (Радиус: <strong className="text-foreground">{brushRadiusMeters}м</strong> | Захвачено: <strong className="text-cyan-600 dark:text-cyan-400">{currentBrushOrderIds?.length || 0}</strong> зак.)
              </span>
            </div>

            <div className="flex items-center gap-1.5 ml-auto">
              {currentBrushTrail && currentBrushTrail.length > 0 && (
                <>
                  <Button
                    size="sm"
                    className="h-6 px-2.5 text-[11px] bg-cyan-600 hover:bg-cyan-700 text-white rounded-full gap-1 shadow-sm"
                    onClick={onSaveCurrentBrushAsStreet}
                  >
                    <Check size={12} /> Сохранить в список
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] rounded-full hover:bg-accent text-muted-foreground"
                    onClick={onClearCurrentBrush}
                    title="Сбросить нарисованный мазок"
                  >
                    <RotateCcw size={12} className="mr-1" /> Сброс
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] rounded-full hover:bg-accent text-muted-foreground hover:text-foreground"
                onClick={() => onSetActiveStreetMode?.(null)}
              >
                <X size={13} className="mr-1" /> Выйти
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context Menu (Store Indicators & Orders Multi-select on Right Click) */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-[2000] bg-card border shadow-2xl rounded-xl p-3 min-w-[270px] max-w-[320px] text-card-foreground backdrop-blur-md"
            style={{ 
              left: Math.max(12, Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 330)), 
              top: Math.max(12, Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 420)) 
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            onMouseLeave={() => setContextMenu(null)}
          >
            {/* Store Title, Code & Close Button */}
            <div className="flex items-start justify-between gap-2 pb-2 border-b border-border/70">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-sm truncate text-foreground" title={contextMenu.storeName}>
                    {contextMenu.storeName}
                  </span>
                  {contextMenu.storeCode && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold border">
                      #{contextMenu.storeCode}
                    </span>
                  )}
                </div>
                {contextMenu.region && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                    <MapPin size={11} className="shrink-0 text-primary" />
                    <span className="truncate">{contextMenu.region}</span>
                  </div>
                )}
                {contextMenu.routeName && (
                  <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted/70 text-foreground border border-border/50">
                    <span 
                      className="w-2 h-2 rounded-full shrink-0" 
                      style={{ backgroundColor: contextMenu.routeColor || '#f59e0b' }} 
                    />
                    <span className="truncate">{contextMenu.routeName}</span>
                    {contextMenu.stopSequenceNumber !== null && contextMenu.stopSequenceNumber !== undefined && (
                      <span className="opacity-80">· №{contextMenu.stopSequenceNumber}</span>
                    )}
                  </div>
                )}
              </div>
              <button 
                type="button"
                onClick={() => setContextMenu(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors shrink-0 cursor-pointer"
                title="Закрыть"
              >
                <X size={14} />
              </button>
            </div>

            {/* Store Metrics Summary (Показатели магазина) */}
            <div className="grid grid-cols-2 gap-1.5 my-2.5 p-2 rounded-lg bg-muted/40 border border-border/40 text-xs">
              <div className="flex flex-col">
                <span className="text-[10px] text-muted-foreground font-medium">Заказов:</span>
                <span className="font-bold text-foreground text-xs">{contextMenu.orders.length}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-muted-foreground font-medium">Общий объём:</span>
                <span className="font-bold text-foreground text-xs">{roundUp(contextMenu.totalVolume)} м³</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-muted-foreground font-medium">Общий вес:</span>
                <span className="font-bold text-foreground text-xs">{roundUp(contextMenu.totalWeight)} кг</span>
              </div>
              {contextMenu.totalSatir > 0 && (
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground font-medium">Товаров (Sətir):</span>
                  <span className="font-bold text-foreground text-xs">{contextMenu.totalSatir}</span>
                </div>
              )}
            </div>

            {/* Orders selection header + quick actions */}
            <div className="flex items-center justify-between pb-1.5 pt-0.5 text-[11px]">
              <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                Заказы ({contextMenu.orders.length})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const allIds = contextMenu.orders.map(o => o.id);
                    const notSelected = allIds.filter(id => !selectedOrderIds.includes(id));
                    if (notSelected.length > 0) {
                      onToggleOrder(notSelected);
                    }
                  }}
                  className="text-[10px] text-primary hover:underline font-medium cursor-pointer"
                >
                  Выбрать все
                </button>
                <span className="text-muted-foreground/40">|</span>
                <button
                  type="button"
                  onClick={() => {
                    const selectedInStore = contextMenu.orders.filter(o => selectedOrderIds.includes(o.id)).map(o => o.id);
                    if (selectedInStore.length > 0) {
                      onToggleOrder(selectedInStore);
                    }
                  }}
                  className="text-[10px] text-muted-foreground hover:text-foreground font-medium cursor-pointer"
                >
                  Снять
                </button>
              </div>
            </div>

            {/* List of orders */}
            <div className="max-h-44 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
              {contextMenu.orders.map((order, oIdx) => {
                const isSelected = selectedOrderIds.includes(order.id);
                return (
                  <label 
                    key={`ctx-order-${order.id || 'order'}-${oIdx}`} 
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs transition-colors border",
                      isSelected 
                        ? "bg-primary/10 border-primary/30 text-foreground" 
                        : "hover:bg-muted/60 border-transparent text-muted-foreground hover:text-foreground"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input 
                      type="checkbox" 
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        onToggleOrder(order.id);
                      }}
                      className="rounded border-input text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer shrink-0"
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-foreground text-[11px] truncate">
                          {order.orderNumber}
                        </span>
                        {order.satir !== undefined && order.satir > 0 && (
                          <span className="text-[9px] text-muted-foreground font-mono">
                            {order.satir} тов.
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {roundUp(order.volume)} м³ · {roundUp(order.weight)} кг
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Routing Progress Overlay */}
      <AnimatePresence>
        {isRouting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2000] bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <Card className="w-full max-w-2xl shadow-2xl border-primary/20">
              <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h2 className="text-2xl font-bold text-primary">Создание маршрутов</h2>
                    <p className="text-sm text-muted-foreground">{routingProgress.message}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-black text-primary">{routingProgress.percent}%</div>
                  </div>
                </div>

                <div className="w-full h-3 bg-muted rounded-full overflow-hidden border">
                  <motion.div 
                    className="h-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${routingProgress.percent}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>

                <div className="bg-black/5 dark:bg-white/5 rounded-lg p-4 h-64 overflow-y-auto font-mono text-[10px] space-y-1 scrollbar-thin border">
                  {routingProgress.logs.map((log, i) => (
                    <div key={`routing-log-line-${i}`} className={cn(i === 0 ? "text-primary font-bold" : "text-muted-foreground")}>
                      {i === 0 ? "> " : "  "} {log}
                    </div>
                  ))}
                </div>

                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => setIsRouting(false)}>Отмена</Button>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
