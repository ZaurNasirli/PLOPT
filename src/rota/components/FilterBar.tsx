import React from 'react';
import { Search, X } from 'lucide-react';
import { useRotaI18n } from '../i18n';
import { ALL_WEEKDAYS, Weekday } from '../types';
import { RotaFilters, EMPTY_FILTERS, filtersActive } from '../state/views';
import { MultiSelect, ToggleChip } from './ui';

export interface FilterOptions {
  regions: string[];
  parties: string[];
  segments: string[];
  formats: string[];
}

/** Filters shared by every tab */
export const FilterBar: React.FC<{
  filters: RotaFilters;
  options: FilterOptions;
  shown: number;
  total: number;
  onChange: (f: RotaFilters) => void;
}> = ({ filters, options, shown, total, onChange }) => {
  const { t, f, dayShort, int } = useRotaI18n();
  const set = (patch: Partial<RotaFilters>) => onChange({ ...filters, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-ink-200 bg-ink-0">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          type="search"
          value={filters.search}
          onChange={e => set({ search: e.target.value })}
          placeholder={t.filters.searchPlaceholder}
          aria-label={t.common.search}
          className="h-8 w-48 pl-8 pr-2 rounded-lg border border-ink-200 bg-ink-0 text-[12.5px] text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
        />
      </div>
      <MultiSelect label={t.filters.region} options={options.regions} selected={filters.regions} onChange={v => set({ regions: v })} />
      <MultiSelect label={t.filters.party} options={options.parties} selected={filters.parties} onChange={v => set({ parties: v })} />
      <MultiSelect label={t.filters.segment} options={options.segments} selected={filters.segments} onChange={v => set({ segments: v })} />
      <MultiSelect label={t.filters.format} options={options.formats} selected={filters.formats} onChange={v => set({ formats: v })} />
      <select
        value={filters.day}
        onChange={e => set({ day: e.target.value as Weekday | 'all' })}
        aria-label={t.filters.day}
        className="h-8 px-2 rounded-lg border border-ink-200 bg-ink-0 text-[12.5px] font-semibold text-ink-700 cursor-pointer"
      >
        <option value="all">{t.filters.allDays}</option>
        {ALL_WEEKDAYS.map(d => <option key={d} value={d}>{dayShort(d)}</option>)}
      </select>
      <ToggleChip pressed={filters.onlyChanged} onClick={() => set({ onlyChanged: !filters.onlyChanged })}>{t.filters.onlyChanged}</ToggleChip>
      <ToggleChip pressed={filters.onlyViolations} onClick={() => set({ onlyViolations: !filters.onlyViolations })}>{t.filters.onlyViolations}</ToggleChip>
      <ToggleChip pressed={filters.onlyUneven} onClick={() => set({ onlyUneven: !filters.onlyUneven })}>{t.filters.onlyUneven}</ToggleChip>
      <ToggleChip pressed={filters.onlyLocked} onClick={() => set({ onlyLocked: !filters.onlyLocked })}>🔒 {t.filters.onlyLocked}</ToggleChip>
      {filtersActive(filters) && (
        <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="h-8 px-2 inline-flex items-center gap-1 rounded-lg text-[12.5px] font-semibold text-ink-600 hover:text-rose-700 cursor-pointer">
          <X size={13} /> {t.filters.reset}
        </button>
      )}
      <span className="ml-auto text-[12px] text-ink-500 tabular-nums">{f(t.filters.shown, { shown: int(shown), total: int(total) })}</span>
    </div>
  );
};
