import React from 'react';
import { useRotaI18n } from '../i18n';
import { ALL_WEEKDAYS, Weekday } from '../types';
import type { DayTotal } from '../state/views';
import { cn } from '../../lib/utils';

/** Colour of a deviation from the daily mean (in %) */
export function deviationTone(pct: number): string {
  const a = Math.abs(pct);
  if (a <= 3) return 'text-emerald-700 bg-emerald-50';
  if (a <= 8) return 'text-amber-700 bg-amber-50';
  return 'text-rose-700 bg-rose-50';
}

/**
 * Per-day m³ / pcs / stores with the deviation from the mean of the working days.
 * Non-working days are shown greyed ("no shipments").
 */
export const BalancePanel: React.FC<{
  totals: Record<Weekday, DayTotal>;
  workingDays: Weekday[];
  showWeight?: boolean;
  compact?: boolean;
  right?: React.ReactNode;
}> = ({ totals, workingDays, showWeight, compact, right }) => {
  const { t, dayShort, m3, int, num } = useRotaI18n();
  const metrics: Array<{ key: keyof DayTotal; label: string; fmt: (v: number) => string }> = [
    { key: 'volume', label: t.units.m3, fmt: m3 },
    { key: 'qty', label: t.units.pcs, fmt: int },
    { key: 'stores', label: t.balance.stores, fmt: int },
  ];
  if (showWeight) metrics.splice(1, 0, { key: 'weight', label: t.units.kg, fmt: int });
  const mean = (k: keyof DayTotal) => {
    if (!workingDays.length) return 0;
    return ALL_WEEKDAYS.reduce((s, d) => s + totals[d][k], 0) / workingDays.length;
  };
  return (
    <div className={cn('border-b border-ink-200 bg-ink-0', compact ? 'px-3 py-1.5' : 'px-4 py-2.5')}>
      <div className="flex items-start gap-3">
        <div className="flex-1 overflow-x-auto">
          <table className="w-full text-[12px] tabular-nums border-separate border-spacing-x-1">
            <thead>
              <tr className="text-ink-500">
                <th className="text-left font-semibold pr-2 w-14">{t.balance.title}</th>
                {ALL_WEEKDAYS.map(d => (
                  <th key={d} className={cn('font-bold text-center', workingDays.includes(d) ? 'text-ink-800' : 'text-ink-400')}>{dayShort(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => {
                const mu = mean(m.key);
                return (
                  <tr key={m.key}>
                    <td className="text-ink-500 font-semibold pr-2">{m.label}</td>
                    {ALL_WEEKDAYS.map(d => {
                      const v = totals[d][m.key];
                      const working = workingDays.includes(d);
                      const dev = working && mu > 0 ? ((v - mu) / mu) * 100 : null;
                      return (
                        <td key={d} className={cn('text-center rounded-md px-1 py-0.5', !working && 'text-ink-400')}>
                          <span className="font-semibold text-ink-900">{m.fmt(v)}</span>
                          {dev !== null && (
                            <span className={cn('ml-1 px-1 rounded text-[10.5px] font-bold', deviationTone(dev))}>
                              {dev > 0 ? '+' : ''}{num(dev, 1)}%
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {right}
      </div>
    </div>
  );
};
