/**
 * Kanban: one card = one store on one day. Columns are days; with "party lanes" the rows are
 * parties, so a drop can change the day and the party at once. Alt / Shift (or "Add day")
 * adds the day instead of moving it. Selected cards move together.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import { CheckSquare, Lock, Square } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useRotaI18n } from '../../i18n';
import { ALL_WEEKDAYS, StoreView, Weekday } from '../../types';
import type { PlanChecker, StoreIssue } from '../../state/checks';
import { nameKey } from '../../core/names';
import { onDay } from '../../state/views';
import { partyColor, ToggleChip } from '../ui';
import { checkText } from '../checkText';

export interface CardKey {
  code: string;
  day: Weekday;
}
export const cardKey = (code: string, day: Weekday) => `${code}__${day}`;
export const parseCardKey = (k: string): CardKey => {
  const i = k.lastIndexOf('__');
  return { code: k.slice(0, i), day: k.slice(i + 2) as Weekday };
};

const COLUMN_LIMIT = 60;
const LANE_LIMIT = 12;

export interface KanbanDrop {
  cards: CardKey[];
  toDay: Weekday;
  toParty: string | null;
  add: boolean;
}

export const KanbanTab: React.FC<{
  views: StoreView[];
  parties: string[];
  workingDays: Weekday[];
  checker: PlanChecker;
  selected: Set<string>;
  focusCodes: Set<string>;
  onSelect: (keys: Set<string>) => void;
  onOpen: (code: string) => void;
  onDrop: (d: KanbanDrop) => void;
  onHover: (code: string | null) => void;
}> = ({ views, parties, workingDays, checker, selected, focusCodes, onSelect, onOpen, onDrop, onHover }) => {
  const { t, f, dayShort, m3 } = useRotaI18n();
  const [lanes, setLanes] = useState(() => { try { return localStorage.getItem('rota_kanban_lanes') === '1'; } catch { return false; } });
  const [addMode, setAddMode] = useState(false);
  const modifier = useRef(false);
  useEffect(() => { try { localStorage.setItem('rota_kanban_lanes', lanes ? '1' : '0'); } catch { /* ignore */ } }, [lanes]);
  // Alt / Shift at the moment the card is released (the drop callback comes after the drop animation,
  // when the key may already be up), read in the capture phase because the drag library handles keys
  useEffect(() => {
    const onUp = (e: MouseEvent) => { modifier.current = e.altKey || e.shiftKey; };
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('pointerup', onUp as EventListener, true);
    return () => { window.removeEventListener('mouseup', onUp, true); window.removeEventListener('pointerup', onUp as EventListener, true); };
  }, []);

  // cards per day (and per party for lanes)
  const byDay = useMemo(() => {
    const m = new Map<Weekday, StoreView[]>(ALL_WEEKDAYS.map(d => [d, []]));
    for (const v of views) for (const d of v.currentDays) m.get(d)!.push(v);
    for (const list of m.values()) list.sort((a, b) => a.currentParty.localeCompare(b.currentParty) || a.region.localeCompare(b.region) || a.storeCode.localeCompare(b.storeCode));
    return m;
  }, [views]);
  // every party gets a lane (also empty ones: they are drop targets)
  const laneParties = useMemo(() => {
    const ordered = [...parties];
    for (const v of views) if (!ordered.some(p => nameKey(p) === nameKey(v.currentParty))) ordered.push(v.currentParty);
    return ordered;
  }, [views, parties]);

  const handleDragEnd = useCallback((r: DropResult) => {
    if (!r.destination) return;
    const src = r.source.droppableId, dst = r.destination.droppableId;
    if (src === dst) return;
    const [dstPartyIdx, dstDay] = dst.split('::');
    const [srcPartyIdx] = src.split('::');
    const dragged = parseCardKey(r.draggableId);
    const group = selected.has(r.draggableId)
      ? [...selected].map(parseCardKey).filter(c => c.day === dragged.day)
      : [dragged];
    const toParty = lanes && dstPartyIdx !== srcPartyIdx ? laneParties[Number(dstPartyIdx)] ?? null : null;
    onDrop({ cards: group, toDay: (lanes ? dstDay : dst) as Weekday, toParty, add: addMode || modifier.current });
  }, [selected, lanes, laneParties, addMode, onDrop]);

  const toggleCard = useCallback((key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onSelect(next);
  }, [selected, onSelect]);

  const columnHead = (d: Weekday, list: StoreView[]) => {
    const vol = list.reduce((s, v) => s + onDay(v, d), 0);
    const working = workingDays.includes(d);
    return (
      <div className={cn('px-2.5 py-2 rounded-t-xl border-b', working ? 'bg-night-900 text-white border-night-900' : 'bg-ink-200 text-ink-600 border-ink-200')}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-bold">{dayShort(d)}</span>
          <span className="text-[11.5px] tabular-nums opacity-80">{f(t.kanban.storesN, { n: list.length })} · {m3(vol)} {t.units.m3}</span>
        </div>
        {!working && <div className="text-[11px] font-semibold uppercase tracking-wide">{t.kanban.noShipments}</div>}
      </div>
    );
  };

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-ink-200 bg-ink-0">
        <ToggleChip pressed={lanes} onClick={() => setLanes(l => !l)}>{t.kanban.lanes}</ToggleChip>
        <ToggleChip pressed={addMode} onClick={() => setAddMode(a => !a)} title={t.kanban.addHint}>+ {t.kanban.addMode}</ToggleChip>
        <span className="text-[11.5px] text-ink-400">{t.kanban.addHint}</span>
      </div>
      <DragDropContext onDragEnd={handleDragEnd}>
        {!lanes ? (
          <div className="flex-1 min-h-0 overflow-x-auto">
            <div className="grid grid-cols-7 gap-2 p-3 h-full min-w-[1150px]">
              {ALL_WEEKDAYS.map(d => {
                const list = byDay.get(d)!;
                const working = workingDays.includes(d);
                return (
                  <div key={d} className={cn('flex flex-col min-h-0 rounded-xl border', working ? 'border-ink-200 bg-ink-100/60' : 'border-dashed border-ink-300 bg-[repeating-linear-gradient(135deg,transparent_0_8px,var(--color-ink-100)_8px_16px)]')}>
                    {columnHead(d, list)}
                    <Cell id={d} list={list} day={d} limit={COLUMN_LIMIT} parties={parties} checker={checker} selected={selected} focusCodes={focusCodes}
                      onToggle={toggleCard} onOpen={onOpen} onHover={onHover} className="flex-1 overflow-y-auto" />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="min-w-[1250px] p-3">
              <div className="grid grid-cols-[150px_repeat(7,minmax(0,1fr))] gap-2 sticky top-0 z-10 bg-ink-50 pb-2">
                <div />
                {ALL_WEEKDAYS.map(d => <div key={d}>{columnHead(d, byDay.get(d)!)}</div>)}
              </div>
              {laneParties.map((p, pi) => (
                <div key={p} className="grid grid-cols-[150px_repeat(7,minmax(0,1fr))] gap-2 mb-2">
                  <div className="rounded-xl border border-ink-200 bg-ink-0 px-2.5 py-2 self-stretch">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: partyColor(p, parties) }} />
                      <span className="text-[12.5px] font-bold text-ink-900">{p}</span>
                    </div>
                    <div className="text-[11px] text-ink-500 tabular-nums mt-0.5">
                      {f(t.kanban.storesN, { n: views.filter(v => nameKey(v.currentParty) === nameKey(p)).length })}
                    </div>
                  </div>
                  {ALL_WEEKDAYS.map(d => {
                    const list = byDay.get(d)!.filter(v => nameKey(v.currentParty) === nameKey(p));
                    const working = workingDays.includes(d);
                    return (
                      <Cell key={d} id={`${pi}::${d}`} list={list} day={d} limit={LANE_LIMIT} parties={parties} checker={checker} selected={selected} focusCodes={focusCodes}
                        onToggle={toggleCard} onOpen={onOpen} onHover={onHover} showCount
                        className={cn('rounded-xl border min-h-16', working ? 'border-ink-200 bg-ink-100/60' : 'border-dashed border-ink-300 bg-ink-100/30')} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </DragDropContext>
    </div>
  );
};

const Cell: React.FC<{
  id: string;
  list: StoreView[];
  day: Weekday;
  limit: number;
  parties: string[];
  checker: PlanChecker;
  selected: Set<string>;
  focusCodes: Set<string>;
  onToggle: (key: string) => void;
  onOpen: (code: string) => void;
  onHover: (code: string | null) => void;
  className?: string;
  showCount?: boolean;
}> = ({ id, list, day, limit, parties, checker, selected, focusCodes, onToggle, onOpen, onHover, className, showCount }) => {
  const { t, f, m3 } = useRotaI18n();
  const [shown, setShown] = useState(limit);
  // keep focused cards (from the conflicts panel) visible
  const focusIdx = useMemo(() => list.findIndex(v => focusCodes.has(v.storeCode)), [list, focusCodes]);
  const visible = list.slice(0, Math.max(shown, focusIdx + 1));
  return (
    <Droppable droppableId={id}>
      {(prov, snap) => (
        <div ref={prov.innerRef} {...prov.droppableProps} className={cn('p-1.5 space-y-1.5', snap.isDraggingOver && 'ring-2 ring-brand-400 ring-inset', className)}>
          {showCount && list.length > 0 && (
            <div className="text-[10.5px] text-ink-500 tabular-nums px-0.5">{list.length} · {m3(list.reduce((s, v) => s + onDay(v, day), 0))} {t.units.m3}</div>
          )}
          {visible.map((v, idx) => {
            const key = cardKey(v.storeCode, day);
            return (
              <Draggable key={key} draggableId={key} index={idx}>
                {dp => (
                  <div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps}>
                    <Card v={v} day={day} parties={parties} issues={checker.storeIssues.get(v.storeCode)} locked={checker.locked.get(v.storeCode)}
                      selected={selected.has(key)} focused={focusCodes.has(v.storeCode)} onToggle={() => onToggle(key)} onOpen={() => onOpen(v.storeCode)} onHover={onHover} />
                  </div>
                )}
              </Draggable>
            );
          })}
          {prov.placeholder}
          {list.length > visible.length && (
            <button type="button" onClick={() => setShown(s => s + limit)} className="w-full py-1.5 rounded-lg text-[12px] font-semibold text-brand-700 hover:bg-ink-0 cursor-pointer">
              {f(t.kanban.showMore, { n: list.length - visible.length })}
            </button>
          )}
        </div>
      )}
    </Droppable>
  );
};

const Card = memo(function Card({ v, day, parties, issues, locked, selected, focused, onToggle, onOpen, onHover }: {
  v: StoreView;
  day: Weekday;
  parties: string[];
  issues?: StoreIssue[];
  locked?: { days: boolean; party: boolean };
  selected: boolean;
  focused: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onHover: (code: string | null) => void;
}) {
  const i18n = useRotaI18n();
  const { t, m3, int, dayShort } = i18n;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [focused]);
  const hard = issues?.filter(i => i.severity === 'hard') ?? [];
  const soft = issues?.filter(i => i.severity === 'soft') ?? [];
  const color = partyColor(v.currentParty, parties);
  return (
    <div
      ref={ref}
      onClick={e => { if (e.ctrlKey || e.metaKey) onToggle(); else onOpen(); }}
      onMouseEnter={() => onHover(v.storeCode)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        'group rounded-lg border bg-ink-0 px-2 py-1.5 text-[11.5px] leading-tight cursor-pointer shadow-sm hover:border-brand-400 transition-colors select-none',
        selected ? 'border-brand-500 ring-2 ring-brand-300' : 'border-ink-200',
        focused && 'ring-2 ring-amber-400',
        hard.length > 0 && 'border-l-4 border-l-rose-500',
        !hard.length && soft.some(s => s.code === 'groupRule') && 'border-l-4 border-l-amber-400'
      )}
      style={{ boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <div className="flex items-center gap-1">
        <button type="button" onClick={e => { e.stopPropagation(); onToggle(); }} aria-pressed={selected} aria-label={t.kanban.select}
          className={cn('shrink-0 text-ink-400 hover:text-brand-700', selected ? 'text-brand-600' : 'opacity-60 group-hover:opacity-100')}>
          {selected ? <CheckSquare size={13} /> : <Square size={13} />}
        </button>
        <span className="font-bold text-ink-900">{v.storeCode}</span>
        <span className="truncate text-ink-700 flex-1" title={v.storeName}>{v.storeName}</span>
        {locked && (locked.days || locked.party) && <Lock size={11} className="text-amber-600 shrink-0" aria-label="🔒" />}
        {(hard.length > 0 || soft.length > 0) && (
          <span className={cn('shrink-0 text-[11px]', hard.length ? 'text-rose-600' : 'text-amber-600')} title={[...hard, ...soft].map(i => checkText(i, i18n)).join('\n')}>⚠️</span>
        )}
      </div>
      <div className="text-ink-500 truncate mt-0.5">{v.region} · {v.segment} · {v.storeFormat}</div>
      <div className="flex items-center gap-1 mt-0.5">
        <span className="px-1 rounded text-[10.5px] font-semibold text-white truncate max-w-[60%]" style={{ backgroundColor: color }} title={v.currentParty}>{v.currentParty}</span>
        {v.partyChanged && <span className="text-[10px] text-brand-700 font-bold">↑</span>}
        <span className="ml-auto tabular-nums text-ink-700">{m3(onDay(v, day))} {t.units.m3}</span>
      </div>
      <div className="flex items-center gap-1 mt-0.5 text-ink-500 tabular-nums min-w-0">
        <span className="whitespace-nowrap">{int(onDay(v, day, 'qty'))} {t.units.pcs} · {int(onDay(v, day, 'weight'))} {t.units.kg}</span>
        <span className="ml-auto truncate min-w-0" title={`${t.kanban.window}: ${v.receivingTime || '—'}`}>{v.receivingTime || '—'}</span>
      </div>
      <div className="flex gap-0.5 mt-1" aria-label={v.currentDays.map(dayShort).join(' ')}>
        {ALL_WEEKDAYS.map(d => {
          const on = v.currentDays.includes(d);
          const was = v.originalDays.includes(d);
          return (
            <span key={d} title={dayShort(d)}
              className={cn('flex-1 h-1.5 rounded-sm', d === day ? 'bg-brand-600' : on ? (was ? 'bg-ink-500' : 'bg-emerald-500') : was ? 'bg-rose-300' : 'bg-ink-200')} />
          );
        })}
      </div>
    </div>
  );
});
