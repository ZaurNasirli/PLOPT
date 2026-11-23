import React, { useEffect, useMemo } from 'react';
import { Marker, Polyline, Circle, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { RoadBarrier } from '../../types';
import { useTranslation } from '../../i18n/I18nContext';

const ACTIVE = '#dc2626';
const INACTIVE = '#9ca3af';

function noEntryIcon(active: boolean): L.DivIcon {
  const color = active ? ACTIVE : INACTIVE;
  return L.divIcon({
    className: 'road-barrier-icon',
    html: `<svg width="26" height="26" viewBox="0 0 26 26" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,.45))">
      <circle cx="13" cy="13" r="11" fill="${color}" stroke="white" stroke-width="2.5"/>
      <rect x="6.5" y="11" width="13" height="4" rx="1" fill="white"/>
    </svg>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -12]
  });
}

interface BarrierLayersProps {
  barriers: RoadBarrier[];
  onToggleBarrier?: (id: string) => void;
  onDeleteBarrier?: (id: string) => void;
}

export function BarrierLayers({ barriers, onToggleBarrier, onDeleteBarrier }: BarrierLayersProps) {
  const { t } = useTranslation();
  const icons = useMemo(() => ({ on: noEntryIcon(true), off: noEntryIcon(false) }), []);

  const kindLabel = (b: RoadBarrier) =>
    b.kind === 'point' ? t('barrierKindPoint') : b.kind === 'street' ? t('barrierKindStreet') : t('barrierKindZone');

  const popup = (b: RoadBarrier) => (
    <Popup>
      <div className="space-y-1.5 min-w-[170px]">
        <div className="font-bold text-sm">{b.name}</div>
        <div className="text-[11px] text-gray-500">
          {kindLabel(b)}{b.kind === 'zone' && b.radiusMeters ? ` · ${b.radiusMeters} м` : ''}
          {' · '}{b.isActive ? t('barrierActive') : t('barrierInactive')}
        </div>
        <div className="flex gap-1.5 pt-1">
          {onToggleBarrier && (
            <button
              type="button"
              className="px-2 py-1 rounded border text-[11px] font-semibold hover:bg-gray-100 cursor-pointer"
              onClick={() => onToggleBarrier(b.id)}
            >
              {b.isActive ? t('barrierDisable') : t('barrierEnable')}
            </button>
          )}
          {onDeleteBarrier && (
            <button
              type="button"
              className="px-2 py-1 rounded border border-red-300 text-red-600 text-[11px] font-semibold hover:bg-red-50 cursor-pointer"
              onClick={() => onDeleteBarrier(b.id)}
            >
              {t('barrierDelete')}
            </button>
          )}
        </div>
      </div>
    </Popup>
  );

  return (
    <>
      {barriers.map(b => {
        const color = b.isActive ? ACTIVE : INACTIVE;
        const opacity = b.isActive ? 0.95 : 0.5;
        return (
          <React.Fragment key={`barrier-${b.id}`}>
            {b.kind === 'zone' && (
              <Circle
                center={[b.lat, b.lng]}
                radius={b.radiusMeters || 200}
                pathOptions={{ color, weight: 2.5, dashArray: '8 6', fillColor: color, fillOpacity: b.isActive ? 0.14 : 0.06 }}
              >
                {popup(b)}
              </Circle>
            )}
            {b.kind === 'street' && (b.path || []).map((line, i) => (
              <Polyline
                key={`barrier-${b.id}-line-${i}`}
                positions={line}
                pathOptions={{ color, weight: 7, opacity, dashArray: '12 8', lineCap: 'butt' }}
              >
                {popup(b)}
              </Polyline>
            ))}
            {b.kind === 'point' && b.blockedSegment && b.blockedSegment.length >= 2 && (
              <Polyline
                positions={b.blockedSegment}
                pathOptions={{ color, weight: 8, opacity, dashArray: '10 6', lineCap: 'butt' }}
              >
                {popup(b)}
              </Polyline>
            )}
            <Marker position={[b.lat, b.lng]} icon={b.isActive ? icons.on : icons.off}>
              {popup(b)}
            </Marker>
          </React.Fragment>
        );
      })}
    </>
  );
}

/** Captures map clicks while a barrier placement mode is active. */
export function BarrierClickHandler({
  isActive,
  onMapClick
}: {
  isActive: boolean;
  onMapClick?: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    if (isActive) L.DomUtil.addClass(container, 'crosshair-cursor');
    else L.DomUtil.removeClass(container, 'crosshair-cursor');
    return () => L.DomUtil.removeClass(container, 'crosshair-cursor');
  }, [isActive, map]);

  useMapEvents({
    click: e => {
      if (isActive && onMapClick) onMapClick(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

/** Flies the map to a point whenever `target.ts` changes. */
export function FlyToPoint({ target }: { target?: { lat: number; lng: number; zoom?: number; ts: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom ?? 16, { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.ts]);
  return null;
}
