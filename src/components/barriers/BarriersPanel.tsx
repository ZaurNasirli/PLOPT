import React, { useState } from 'react';
import { Ban, CircleDot, Construction, Crosshair, Eye, EyeOff, Info, Pencil, RefreshCw, Route as RouteIcon, Trash2, X } from 'lucide-react';
import { RoadBarrier, StreetHighlight } from '../../types';
import { useTranslation } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';

interface BarriersPanelProps {
  barriers: RoadBarrier[];
  placementMode: 'point' | 'zone' | null;
  onSetPlacementMode: (mode: 'point' | 'zone' | null) => void;
  zoneRadius: number;
  onSetZoneRadius: (radius: number) => void;
  streets: StreetHighlight[];
  onCloseStreet: (streetId: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onFocus: (barrier: RoadBarrier) => void;
  onClearAll: () => void;
  onRebuildRoutes: () => void;
  isRebuilding: boolean;
  detourRoutes: number;
  blockedRoutes: number;
}

const streetLines = (s: StreetHighlight): [number, number][][] =>
  s.multiCoordinates && s.multiCoordinates.length > 0
    ? s.multiCoordinates
    : s.coordinates && s.coordinates.length >= 2 ? [s.coordinates] : [];

export const BarriersPanel: React.FC<BarriersPanelProps> = ({
  barriers, placementMode, onSetPlacementMode, zoneRadius, onSetZoneRadius, streets, onCloseStreet,
  onToggle, onDelete, onRename, onFocus, onClearAll, onRebuildRoutes, isRebuilding, detourRoutes, blockedRoutes
}) => {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [streetPickerOpen, setStreetPickerOpen] = useState(false);

  const closableStreets = streets.filter(s => streetLines(s).length > 0);
  const closedStreetNames = new Set(barriers.filter(b => b.kind === 'street').map(b => b.name));
  const activeCount = barriers.filter(b => b.isActive).length;

  const kindIcon = (b: RoadBarrier) =>
    b.kind === 'point' ? <Ban size={14} /> : b.kind === 'zone' ? <CircleDot size={14} /> : <Construction size={14} />;
  const kindLabel = (b: RoadBarrier) =>
    b.kind === 'point' ? t('barrierKindPoint') : b.kind === 'street' ? t('barrierKindStreet') : t('barrierKindZone');

  return (
    <div className="p-3 space-y-3 overflow-y-auto flex-1 scrollbar-thin">
      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/5 border border-red-500/20 text-[11px] text-muted-foreground leading-relaxed">
        <Info size={14} className="text-red-500 shrink-0 mt-0.5" />
        <span>{t('barriersHint')}</span>
      </div>

      {/* Add barrier */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          id="barrier-mode-point"
          onClick={() => onSetPlacementMode(placementMode === 'point' ? null : 'point')}
          className={cn(
            'h-9 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors',
            placementMode === 'point' ? 'bg-red-600 text-white border-red-600' : 'hover:border-red-500 hover:text-red-600'
          )}
        >
          <Ban size={14} /> {t('barrierAddPoint')}
        </button>
        <button
          type="button"
          id="barrier-mode-zone"
          onClick={() => onSetPlacementMode(placementMode === 'zone' ? null : 'zone')}
          className={cn(
            'h-9 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors',
            placementMode === 'zone' ? 'bg-red-600 text-white border-red-600' : 'hover:border-red-500 hover:text-red-600'
          )}
        >
          <CircleDot size={14} /> {t('barrierAddZone')}
        </button>
      </div>

      {placementMode === 'zone' && (
        <div className="space-y-1 p-2 rounded-lg border bg-card">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">{t('barrierZoneRadius')}</span>
            <span className="font-bold">{zoneRadius} м</span>
          </div>
          <input
            type="range"
            min={50}
            max={1500}
            step={50}
            value={zoneRadius}
            onChange={e => onSetZoneRadius(Number(e.target.value))}
            className="w-full accent-red-600"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => setStreetPickerOpen(o => !o)}
          className="w-full h-9 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer hover:border-red-500 hover:text-red-600"
        >
          <Construction size={14} /> {t('barrierCloseStreet')}
        </button>
        {streetPickerOpen && (
          <div className="p-2 rounded-lg border bg-card space-y-1 max-h-48 overflow-y-auto">
            {closableStreets.length === 0 ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed">{t('barrierNoStreets')}</p>
            ) : (
              closableStreets.map(s => (
                <button
                  key={`close-street-${s.id}`}
                  type="button"
                  disabled={closedStreetNames.has(s.name)}
                  onClick={() => { onCloseStreet(s.id); setStreetPickerOpen(false); }}
                  className="w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 hover:bg-red-500/10 disabled:opacity-40 cursor-pointer disabled:cursor-default"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="truncate flex-1">{s.name}</span>
                  {closedStreetNames.has(s.name) && <span className="text-[10px] text-red-500">{t('barrierStreetClosed')}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Status */}
      {barriers.length > 0 && (
        <div className="p-2.5 rounded-lg border bg-card space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">{t('barrierActiveCount', { count: activeCount, total: barriers.length })}</span>
            <button type="button" onClick={onClearAll} className="text-[11px] text-destructive hover:underline cursor-pointer">
              {t('barrierClearAll')}
            </button>
          </div>
          {(detourRoutes > 0 || blockedRoutes > 0) && (
            <div className="text-[11px] space-y-0.5">
              {detourRoutes > 0 && <div className="text-emerald-600 dark:text-emerald-400">✓ {t('barrierRoutesDetour', { count: detourRoutes })}</div>}
              {blockedRoutes > 0 && <div className="text-destructive">⚠ {t('barrierRoutesBlocked', { count: blockedRoutes })}</div>}
            </div>
          )}
          <button
            type="button"
            onClick={onRebuildRoutes}
            disabled={isRebuilding}
            className="w-full h-8 rounded-lg border text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw size={13} className={isRebuilding ? 'animate-spin' : ''} /> {t('barrierRebuildRoutes')}
          </button>
        </div>
      )}

      {/* List */}
      <div className="space-y-1.5">
        {barriers.length === 0 ? (
          <p className="text-[11px] text-muted-foreground text-center py-4">{t('barrierEmpty')}</p>
        ) : (
          barriers.map(b => (
            <div
              key={`barrier-row-${b.id}`}
              className={cn('p-2 rounded-lg border bg-card flex items-center gap-2', !b.isActive && 'opacity-55')}
            >
              <span className={cn('shrink-0', b.isActive ? 'text-red-600' : 'text-muted-foreground')}>{kindIcon(b)}</span>
              <div className="min-w-0 flex-1">
                {editingId === b.id ? (
                  <form
                    onSubmit={e => { e.preventDefault(); onRename(b.id, editingName.trim() || b.name); setEditingId(null); }}
                    className="flex gap-1"
                  >
                    <input
                      autoFocus
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onBlur={() => { onRename(b.id, editingName.trim() || b.name); setEditingId(null); }}
                      className="w-full h-6 px-1.5 text-xs rounded border bg-background"
                    />
                    <button type="button" onMouseDown={() => setEditingId(null)} className="cursor-pointer"><X size={12} /></button>
                  </form>
                ) : (
                  <div className="text-xs font-semibold truncate" title={b.name}>{b.name}</div>
                )}
                <div className="text-[10px] text-muted-foreground">
                  {kindLabel(b)}{b.kind === 'zone' && b.radiusMeters ? ` · ${b.radiusMeters} м` : ''}{b.createdAt ? ` · ${b.createdAt}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button type="button" title={t('barrierShowOnMap')} onClick={() => onFocus(b)} className="p-1 rounded hover:bg-accent cursor-pointer"><Crosshair size={13} /></button>
                <button type="button" title={t('barrierRename')} onClick={() => { setEditingId(b.id); setEditingName(b.name); }} className="p-1 rounded hover:bg-accent cursor-pointer"><Pencil size={13} /></button>
                <button type="button" title={b.isActive ? t('barrierDisable') : t('barrierEnable')} onClick={() => onToggle(b.id)} className="p-1 rounded hover:bg-accent cursor-pointer">
                  {b.isActive ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button type="button" title={t('barrierDelete')} onClick={() => onDelete(b.id)} className="p-1 rounded hover:bg-destructive/10 text-destructive cursor-pointer"><Trash2 size={13} /></button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground leading-relaxed">
        <RouteIcon size={12} className="shrink-0 mt-0.5" />
        <span>{t('barrierEngineNote')}</span>
      </div>
    </div>
  );
};
