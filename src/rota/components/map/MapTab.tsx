/**
 * Map tab: one big map (clusters, colour by days / party / segment, legend, lasso selection)
 * or seven mini maps (one per day) with the store list below; store days are dragged between
 * the mini maps with the same checks as on the Kanban.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet-lasso';
import { Lasso } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useRotaI18n } from '../../i18n';
import { ALL_WEEKDAYS, StoreView, Weekday } from '../../types';
import type { PlanChecker } from '../../state/checks';
import type { MoveRequest } from '../../state/actions';
import { nameKey } from '../../core/names';
import { partyColor, ToggleChip } from '../ui';
import { checkText } from '../checkText';

export type ColorBy = 'day' | 'party' | 'segment';
export const DAY_COLORS: Record<Weekday, string> = {
  Пн: '#2563eb', Вт: '#059669', Ср: '#d97706', Чт: '#7c3aed', Пт: '#db2777', Сб: '#0891b2', Вс: '#64748b',
};
const SEGMENT_COLORS = ['#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#84cc16'];
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; OpenStreetMap';
const DRAG_MIME = 'application/x-rota-store-day';

function segmentColor(seg: string, all: string[]): string {
  const i = all.indexOf(seg);
  return SEGMENT_COLORS[(i >= 0 ? i : 0) % SEGMENT_COLORS.length];
}

/** Pin: a ring split by the shipment days, or a single colour */
function pinHtml(colors: string[], size: number, ring = false): string {
  const bg = colors.length <= 1
    ? colors[0] ?? '#94a3b8'
    : `conic-gradient(${colors.map((c, k) => `${c} ${(k * 360) / colors.length}deg ${((k + 1) * 360) / colors.length}deg`).join(',')})`;
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 0 0 1px rgba(15,23,42,.45)${ring ? ',0 0 0 4px rgba(37,99,235,.45)' : ''}"></div>`;
}

function pointInPolygon(lat: number, lng: number, poly: L.LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.lng > lng) !== (b.lng > lng) && lat < ((b.lat - a.lat) * (lng - a.lng)) / (b.lng - a.lng) + a.lat) inside = !inside;
  }
  return inside;
}

const withCoords = (v: StoreView) => v.lat !== null && v.lng !== null;

export const MapTab: React.FC<{
  views: StoreView[];
  parties: string[];
  workingDays: Weekday[];
  checker: PlanChecker;
  hovered: string | null;
  focusCodes: Set<string>;
  onHover: (code: string | null) => void;
  onOpen: (code: string) => void;
  onSelectStores: (codes: string[]) => void;
  onMove: (requests: MoveRequest[]) => void;
}> = props => {
  const { t, f, int } = useRotaI18n();
  const [mode, setMode] = useState<'big' | 'mini'>(() => { try { return localStorage.getItem('rota_map_mode') === 'mini' ? 'mini' : 'big'; } catch { return 'big'; } });
  const [colorBy, setColorBy] = useState<ColorBy>('day');
  useEffect(() => { try { localStorage.setItem('rota_map_mode', mode); } catch { /* ignore */ } }, [mode]);
  const segments = useMemo(() => [...new Set(props.views.map(v => v.segment))].sort(), [props.views]);
  const { parties } = props;
  const colorsOf = useCallback((v: StoreView, day?: Weekday): string[] => {
    if (colorBy === 'party' || (colorBy === 'day' && day)) return [partyColor(v.currentParty, parties)];
    if (colorBy === 'segment') return [segmentColor(v.segment, segments)];
    return v.currentDays.map(d => DAY_COLORS[d]);
  }, [colorBy, parties, segments]);
  const missing = props.views.filter(v => !withCoords(v)).length;

  const legend: Array<{ label: string; color: string }> =
    colorBy === 'segment' ? segments.map(s => ({ label: s || '—', color: segmentColor(s, segments) }))
    : colorBy === 'party' || mode === 'mini' ? props.parties.filter(p => props.views.some(v => nameKey(v.currentParty) === nameKey(p))).map(p => ({ label: p, color: partyColor(p, props.parties) }))
    : ALL_WEEKDAYS.map(d => ({ label: d, color: DAY_COLORS[d] }));

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-ink-200 bg-ink-0">
        <ToggleChip pressed={mode === 'big'} onClick={() => setMode('big')}>{t.mapv.big}</ToggleChip>
        <ToggleChip pressed={mode === 'mini'} onClick={() => setMode('mini')}>{t.mapv.mini}</ToggleChip>
        <span className="w-px h-5 bg-ink-200 mx-1" />
        <span className="text-[12px] text-ink-500">{t.mapv.colorBy}:</span>
        {(['day', 'party', 'segment'] as ColorBy[]).map(c => (
          <ToggleChip key={c} pressed={colorBy === c} onClick={() => setColorBy(c)}>
            {c === 'day' ? t.mapv.byDay : c === 'party' ? t.mapv.byParty : t.mapv.bySegment}
          </ToggleChip>
        ))}
        {missing > 0 && <span className="ml-auto text-[12px] text-amber-700">{f(t.mapv.noCoords, { n: int(missing) })}</span>}
      </div>
      {mode === 'big'
        ? <BigMap {...props} colorsOf={colorsOf} legend={legend} />
        : <MiniMaps {...props} colorsOf={colorsOf} legend={legend} />}
    </div>
  );
};

type MapProps = React.ComponentProps<typeof MapTab> & {
  colorsOf: (v: StoreView, day?: Weekday) => string[];
  legend: Array<{ label: string; color: string }>;
};

const Legend: React.FC<{ items: Array<{ label: string; color: string }> }> = ({ items }) => {
  const { dayShort } = useRotaI18n();
  return (
    <div className="absolute left-3 bottom-3 z-[500] rounded-xl border border-ink-200 bg-ink-0/95 px-3 py-2 shadow-lg max-w-64">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] text-ink-800">
        {items.map(i => (
          <li key={i.label} className="flex items-center gap-1.5 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: i.color }} />
            <span className="truncate">{(ALL_WEEKDAYS as string[]).includes(i.label) ? dayShort(i.label as Weekday) : i.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

function useResize(el: HTMLElement | null, map: L.Map | null) {
  useEffect(() => {
    if (!el || !map) return;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, map]);
}

function tooltipHtml(v: StoreView, dayShort: (d: Weekday) => string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  return `<b>${esc(v.storeCode)}</b> ${esc(v.storeName)}<br/>${esc(v.currentParty)} · ${v.currentDays.map(dayShort).join(' ')}`;
}

// ------------------------------------------------------------------------------------------------

const BigMap: React.FC<MapProps> = ({ views, hovered, focusCodes, onHover, onOpen, onSelectStores, colorsOf, legend }) => {
  const { t, dayShort } = useRotaI18n();
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const cluster = useRef<L.MarkerClusterGroup | null>(null);
  const highlight = useRef<L.CircleMarker | null>(null);
  const fittedFor = useRef('');
  const [lassoOn, setLassoOn] = useState(false);
  const lasso = useRef<{ enable(): void; disable(): void } | null>(null);
  const viewsRef = useRef(views);
  viewsRef.current = views;

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([40.4, 49.87], 10);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(m);
    cluster.current = L.markerClusterGroup({ maxClusterRadius: 38, disableClusteringAtZoom: 15, showCoverageOnHover: false });
    m.addLayer(cluster.current);
    lasso.current = L.lasso(m, { intersect: true });
    m.on('lasso.finished', (e: L.LeafletEvent) => {
      const poly = (e as unknown as { latLngs: L.LatLng[] }).latLngs;
      const codes = viewsRef.current.filter(v => withCoords(v) && pointInPolygon(v.lat!, v.lng!, poly)).map(v => v.storeCode);
      if (codes.length) onSelectStores(codes);
      setLassoOn(false);
    });
    setMap(m);
    return () => { m.remove(); setMap(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useResize(box.current, map);

  useEffect(() => {
    if (!lasso.current) return;
    if (lassoOn) lasso.current.enable(); else lasso.current.disable();
  }, [lassoOn]);

  // markers
  useEffect(() => {
    const c = cluster.current;
    if (!map || !c) return;
    c.clearLayers();
    const markers: L.Marker[] = [];
    for (const v of views) {
      if (!withCoords(v)) continue;
      const mk = L.marker([v.lat!, v.lng!], { icon: L.divIcon({ html: pinHtml(colorsOf(v), 14), className: '', iconSize: [18, 18], iconAnchor: [9, 9] }) });
      mk.bindTooltip(tooltipHtml(v, dayShort), { direction: 'top', offset: [0, -8] });
      mk.on('click', () => onOpen(v.storeCode));
      mk.on('mouseover', () => onHover(v.storeCode));
      mk.on('mouseout', () => onHover(null));
      markers.push(mk);
    }
    c.addLayers(markers);
    const key = views.map(v => v.storeCode).join(',');
    if (key !== fittedFor.current && markers.length) {
      fittedFor.current = key;
      map.fitBounds(L.latLngBounds(markers.map(m => m.getLatLng())).pad(0.08), { animate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, views, colorsOf]);

  // hover highlight (outside the clusters, so it is always visible)
  useEffect(() => {
    if (!map) return;
    highlight.current?.remove();
    highlight.current = null;
    const v = hovered ? views.find(x => x.storeCode === hovered) : null;
    if (v && withCoords(v)) highlight.current = L.circleMarker([v.lat!, v.lng!], { radius: 13, color: '#2563eb', weight: 3, fillOpacity: 0.1, interactive: false }).addTo(map);
  }, [map, hovered, views]);

  // stores picked in the conflicts panel
  useEffect(() => {
    if (!map || !focusCodes.size) return;
    const pts = views.filter(v => focusCodes.has(v.storeCode) && withCoords(v)).map(v => L.latLng(v.lat!, v.lng!));
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 15 });
  }, [map, focusCodes, views]);

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={box} className="absolute inset-0" />
      <div className="absolute top-3 right-3 z-[500]">
        <button type="button" onClick={() => setLassoOn(o => !o)} aria-pressed={lassoOn}
          className={cn('h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border text-[12.5px] font-semibold shadow cursor-pointer', lassoOn ? 'bg-brand-600 border-brand-600 text-white' : 'bg-ink-0 border-ink-200 text-ink-800 hover:border-brand-400')}>
          <Lasso size={14} /> {lassoOn ? t.mapv.lassoOn : t.mapv.lasso}
        </button>
      </div>
      <Legend items={legend} />
    </div>
  );
};

// ------------------------------------------------------------------------------------------------

const MiniMaps: React.FC<MapProps> = props => {
  const { views, workingDays } = props;
  const { t, f } = useRotaI18n();
  const maps = useRef<Map<Weekday, L.Map>>(new Map());
  const syncing = useRef(false);
  const register = (d: Weekday, m: L.Map | null) => {
    if (!m) { maps.current.delete(d); return; }
    maps.current.set(d, m);
    m.on('moveend', () => {
      if (syncing.current) return;
      syncing.current = true;
      for (const [d2, other] of maps.current) if (d2 !== d) other.setView(m.getCenter(), m.getZoom(), { animate: false });
      syncing.current = false;
    });
  };
  const bounds = useMemo(() => {
    const pts = views.filter(withCoords).map(v => L.latLng(v.lat!, v.lng!));
    return pts.length ? L.latLngBounds(pts).pad(0.05) : null;
  }, [views]);
  const days = ALL_WEEKDAYS.filter(d => workingDays.includes(d) || views.some(v => v.currentDays.includes(d)));
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <p className="px-4 pt-2 text-[11.5px] text-ink-500">{t.mapv.dragHint}</p>
      <div className="grid gap-2 p-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {days.map(d => (
          <MiniMap key={d} day={d} working={workingDays.includes(d)} {...props} bounds={bounds} register={register} />
        ))}
      </div>
      <StoreList {...props} />
      <p className="px-4 pb-3 text-[11px] text-ink-400">{f(t.mapv.list, { n: views.length })}</p>
    </div>
  );
};

const MiniMap: React.FC<MapProps & { day: Weekday; working: boolean; bounds: L.LatLngBounds | null; register: (d: Weekday, m: L.Map | null) => void }> = ({
  day, working, views, colorsOf, onOpen, onHover, onMove, hovered, bounds, register,
}) => {
  const { t, f, dayShort, m3 } = useRotaI18n();
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [over, setOver] = useState(false);
  const list = useMemo(() => views.filter(v => v.currentDays.includes(day)), [views, day]);

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: false, attributionControl: false }).setView([40.4, 49.87], 9);
    L.tileLayer(TILE_URL, { maxZoom: 19 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    setMap(m);
    register(day, m);
    return () => { register(day, null); m.remove(); setMap(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useResize(box.current, map);
  useEffect(() => { if (map && bounds) map.fitBounds(bounds, { animate: false }); }, [map, bounds]);

  useEffect(() => {
    if (!map || !layer.current) return;
    layer.current.clearLayers();
    for (const v of list) {
      if (!withCoords(v)) continue;
      const mk = L.marker([v.lat!, v.lng!], { icon: L.divIcon({ html: pinHtml(colorsOf(v, day), hovered === v.storeCode ? 14 : 10, hovered === v.storeCode), className: '', iconSize: [14, 14], iconAnchor: [7, 7] }) });
      mk.bindTooltip(tooltipHtml(v, dayShort), { direction: 'top' });
      mk.on('click', () => onOpen(v.storeCode));
      mk.on('mouseover', () => onHover(v.storeCode));
      mk.on('mouseout', () => onHover(null));
      mk.on('add', () => {
        const el = mk.getElement();
        if (!el) return;
        el.draggable = true;
        el.addEventListener('dragstart', e => {
          e.dataTransfer?.setData(DRAG_MIME, JSON.stringify({ code: v.storeCode, day }));
          e.dataTransfer?.setData('text/plain', v.storeCode);
        });
      });
      mk.addTo(layer.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, list, colorsOf, hovered]);

  const vol = list.reduce((s, v) => s + v.dailyVolume, 0);
  return (
    <div
      className={cn('rounded-xl border overflow-hidden bg-ink-0 flex flex-col', over ? 'border-brand-500 ring-2 ring-brand-300' : working ? 'border-ink-200' : 'border-dashed border-ink-300')}
      onDragOver={e => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault();
        setOver(false);
        try {
          const data = JSON.parse(e.dataTransfer.getData(DRAG_MIME)) as { code: string; day: Weekday };
          if (data.day !== day) onMove([{ code: data.code, fromDay: data.day, toDay: day, addDay: e.altKey || e.shiftKey }]);
        } catch { /* not a store day */ }
      }}
    >
      <div className={cn('flex items-center justify-between px-2.5 py-1.5 text-[12px]', working ? 'bg-night-900 text-white' : 'bg-ink-200 text-ink-600')}>
        <span className="font-bold">{dayShort(day)}</span>
        <span className="tabular-nums opacity-80">{f(t.mapv.storesOnDay, { n: list.length })} · {m3(vol)} {t.units.m3}</span>
      </div>
      {/* PL/OPT styles .leaflet-container with height: 100%, so the size is set on a wrapper */}
      <div className="h-56 w-full"><div ref={box} className="w-full h-full" /></div>
    </div>
  );
};

const LIST_LIMIT = 150;

const StoreList: React.FC<MapProps> = ({ views, parties, checker, hovered, onHover, onOpen, onMove }) => {
  const i18n = useRotaI18n();
  const { t, f, dayShort, m3 } = i18n;
  const [shown, setShown] = useState(LIST_LIMIT);
  const rows = views.slice(0, shown);
  return (
    <div className="mx-3 mb-2 rounded-xl border border-ink-200 bg-ink-0 overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead className="text-[11.5px] text-ink-500 bg-ink-50">
          <tr>
            <th className="text-left px-2 py-1.5">{t.importer.fields.storeCode}</th>
            <th className="text-left px-2">{t.importer.fields.storeName}</th>
            <th className="text-left px-2">{t.filters.region}</th>
            <th className="text-left px-2">{t.filters.segment}</th>
            <th className="text-left px-2">{t.mapv.party}</th>
            <th className="text-left px-2">{t.mapv.days}</th>
            <th className="text-right px-2">{t.mapv.perDay}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(v => (
            <tr key={v.storeCode} onMouseEnter={() => onHover(v.storeCode)} onMouseLeave={() => onHover(null)}
              className={cn('border-t border-ink-100', hovered === v.storeCode && 'bg-brand-50')}>
              <td className="px-2 py-1 font-semibold text-ink-900"><button type="button" className="hover:underline cursor-pointer" onClick={() => onOpen(v.storeCode)}>{v.storeCode}</button></td>
              <td className="px-2 truncate max-w-48 text-ink-800">{v.storeName}</td>
              <td className="px-2 text-ink-600">{v.region}</td>
              <td className="px-2 text-ink-600">{v.segment}</td>
              <td className="px-2">
                <select value={v.currentParty} onChange={e => onMove([{ code: v.storeCode, party: e.target.value }])}
                  className="h-7 px-1 rounded-md border border-ink-200 bg-ink-0 text-[12px] text-ink-900 cursor-pointer max-w-44"
                  style={{ boxShadow: `inset 3px 0 0 ${partyColor(v.currentParty, parties)}` }}>
                  {parties.map(p => {
                    const reason = nameKey(p) === nameKey(v.currentParty) ? null : checker.checkParty(v.storeCode, p);
                    return <option key={p} value={p} disabled={reason !== null}>{p}{reason ? ` — ${checkText(reason, i18n)}` : ''}</option>;
                  })}
                </select>
              </td>
              <td className="px-2">
                <span className="inline-flex gap-1">
                  {v.currentDays.map(d => (
                    <span key={d} draggable
                      onDragStart={e => { e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ code: v.storeCode, day: d })); e.dataTransfer.setData('text/plain', v.storeCode); }}
                      className="px-1.5 rounded text-[11px] font-bold text-white cursor-grab" style={{ backgroundColor: DAY_COLORS[d] }}>
                      {dayShort(d)}
                    </span>
                  ))}
                </span>
              </td>
              <td className="px-2 text-right tabular-nums text-ink-800">{m3(v.dailyVolume)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {views.length > shown && (
        <button type="button" onClick={() => setShown(s => s + LIST_LIMIT)} className="w-full py-2 text-[12px] font-semibold text-brand-700 hover:bg-ink-50 cursor-pointer">
          {f(t.mapv.showMore, { n: views.length - shown })}
        </button>
      )}
    </div>
  );
};
