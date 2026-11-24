/** Actions on the selected cards / stores: party, move a day, locks. */
import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useRotaI18n } from '../../i18n';
import { ALL_WEEKDAYS, Weekday } from '../../types';
import { Btn } from '../ui';
import { parseCardKey } from './KanbanTab';
import type { LockKind } from '../../state/actions';

export const BulkBar: React.FC<{
  selected: Set<string>;
  parties: string[];
  hasRules: boolean;
  onParty: (codes: string[], party: string) => void;
  onMoveDay: (cards: Array<{ code: string; day: Weekday }>, to: Weekday) => void;
  onLock: (codes: string[], kind: LockKind) => void;
  onClear: () => void;
}> = ({ selected, parties, hasRules, onParty, onMoveDay, onLock, onClear }) => {
  const { t, f, dayShort } = useRotaI18n();
  const cards = useMemo(() => [...selected].map(parseCardKey), [selected]);
  const codes = useMemo(() => [...new Set(cards.map(c => c.code))], [cards]);
  const days = useMemo(() => ALL_WEEKDAYS.filter(d => cards.some(c => c.day === d)), [cards]);
  const [party, setParty] = useState('');
  const [from, setFrom] = useState<Weekday | ''>('');
  const [to, setTo] = useState<Weekday | ''>('');
  const fromDay = (from || days[0]) as Weekday | undefined;
  const sel = 'h-8 px-2 rounded-lg border border-ink-200 bg-ink-0 text-[12.5px] text-ink-800 cursor-pointer';
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-brand-200 bg-brand-50 text-[12.5px]">
      <span className="font-bold text-brand-800">{f(t.bulk.selected, { n: codes.length })}</span>
      <span className="w-px h-5 bg-brand-200" />
      <select value={party} onChange={e => setParty(e.target.value)} className={sel} aria-label={t.bulk.party}>
        <option value="">{t.bulk.party}: {t.bulk.choose}</option>
        {parties.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <Btn size="sm" disabled={!party} onClick={() => onParty(codes, party)}>{t.bulk.apply}</Btn>
      <span className="w-px h-5 bg-brand-200" />
      <span className="text-ink-600">{t.bulk.moveDay}</span>
      <select value={fromDay ?? ''} onChange={e => setFrom(e.target.value as Weekday)} className={sel}>
        {days.map(d => <option key={d} value={d}>{dayShort(d)}</option>)}
      </select>
      →
      <select value={to} onChange={e => setTo(e.target.value as Weekday)} className={sel}>
        <option value="">—</option>
        {ALL_WEEKDAYS.map(d => <option key={d} value={d}>{dayShort(d)}</option>)}
      </select>
      <Btn size="sm" disabled={!to || !fromDay || to === fromDay} onClick={() => fromDay && to && onMoveDay(cards.filter(c => c.day === fromDay), to)}>{t.bulk.apply}</Btn>
      <span className="w-px h-5 bg-brand-200" />
      <span title={hasRules ? undefined : t.bulk.needRules} className="inline-flex gap-1">
        <Btn size="sm" variant="ghost" disabled={!hasRules} onClick={() => onLock(codes, 'days')}>🔒 {t.bulk.lockDays}</Btn>
        <Btn size="sm" variant="ghost" disabled={!hasRules} onClick={() => onLock(codes, 'party')}>🔒 {t.bulk.lockParty}</Btn>
        <Btn size="sm" variant="ghost" disabled={!hasRules} onClick={() => onLock(codes, 'all')}>🔒 {t.bulk.lockAll}</Btn>
        <Btn size="sm" variant="ghost" disabled={!hasRules} onClick={() => onLock(codes, 'none')}>🔓 {t.bulk.unlock}</Btn>
      </span>
      <button type="button" onClick={onClear} className="ml-auto inline-flex items-center gap-1 text-ink-600 hover:text-ink-900 font-semibold cursor-pointer"><X size={13} /> {t.bulk.clear}</button>
    </div>
  );
};
