/** Editable table cells of the rules editor. Every cell has an id so a rules check can jump to it. */
import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useRotaI18n } from '../../i18n';

export const cellId = (sheet: string, rowId: string, field: string) => `rule-${sheet}-${rowId}-${field}`;

const base = 'w-full h-7.5 px-1.5 rounded-md border border-transparent bg-transparent text-[12.5px] text-ink-900 hover:border-ink-200 focus:border-brand-500 focus:bg-ink-0 focus:outline-none';

export const TextCell: React.FC<{ id: string; value: string; onChange: (v: string) => void; placeholder?: string; list?: string; mono?: boolean; invalid?: boolean }> = ({
  id, value, onChange, placeholder, list, mono, invalid,
}) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      id={id}
      className={cn(base, mono && 'font-mono', invalid && 'border-rose-300 bg-rose-50')}
      value={draft}
      list={list}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onChange(draft.trim()); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
};

/** Number cell: empty = not set (null). Commits on blur / Enter, keeps what was typed while it is not a number yet. */
export const NumCell: React.FC<{ id: string; value: number | null; onChange: (v: number | null) => void; integer?: boolean; invalid?: boolean }> = ({
  id, value, onChange, integer, invalid,
}) => {
  const show = (v: number | null) => (v === null ? '' : String(v));
  const [draft, setDraft] = useState(show(value));
  useEffect(() => setDraft(show(value)), [value]);
  const parsed = draft.trim() === '' ? null : Number(draft.trim().replace(',', '.').replace('−', '-'));
  const bad = parsed !== null && (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)));
  const commit = () => {
    if (bad) { setDraft(show(value)); return; }
    if (parsed !== value) onChange(parsed);
  };
  return (
    <input
      id={id}
      inputMode="decimal"
      className={cn(base, 'text-right tabular-nums', (bad || invalid) && 'border-rose-300 bg-rose-50')}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
};

export function SelectCell<T extends string>({ id, value, options, onChange, invalid, allowEmpty = true }: {
  id: string;
  value: T | null;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T | null) => void;
  invalid?: boolean;
  allowEmpty?: boolean;
}) {
  return (
    <select
      id={id}
      className={cn(base, 'cursor-pointer pr-1', value === null && 'text-ink-400', invalid && 'border-rose-300 bg-rose-50')}
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? null : (e.target.value as T))}
    >
      {(allowEmpty || value === null) && <option value="">—</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export const BoolCell: React.FC<{ id: string; value: boolean | null; onChange: (v: boolean | null) => void; invalid?: boolean; allowEmpty?: boolean }> = ({
  id, value, onChange, invalid, allowEmpty = true,
}) => {
  const { t } = useRotaI18n();
  return (
    <SelectCell
      id={id}
      value={value === null ? null : value ? 'yes' : 'no'}
      options={[{ value: 'yes', label: t.rules.enums.bool.yes }, { value: 'no', label: t.rules.enums.bool.no }]}
      onChange={v => onChange(v === null ? null : v === 'yes')}
      invalid={invalid}
      allowEmpty={allowEmpty}
    />
  );
};

/** Column header with the explanation as a tooltip (explains the meaning, never suggests a value) */
export const Th: React.FC<{ label: string; tip?: string; className?: string }> = ({ label, tip, className }) => (
  <th className={cn('px-1.5 py-2 text-left text-[11.5px] font-bold text-ink-600 align-bottom', className)} title={tip}>
    <span className="inline-flex items-start gap-1">
      <span>{label}</span>
      {tip && <Info size={11} className="text-ink-400 shrink-0 mt-0.5" aria-hidden="true" />}
    </span>
  </th>
);
