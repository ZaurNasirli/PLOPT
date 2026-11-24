/** One store in Proqnoz: its orders, weeks, the observed day split vs the model, next week by day. */
import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '../../i18n/I18nContext';
import { useRotaI18n } from '../../rota/i18n';
import { ALL_WEEKDAYS } from '../../rota/types';
import { scheduleShares } from '../../rota/core/rhythm';
import { Analysis, Measure, StoreForecast, weekday } from '../engine';
import { dmy } from '../exportXlsx';
import { StatusBadge } from './StatusBadge';

export const StoreDetail: React.FC<{ s: StoreForecast; a: Analysis; measure: Measure; fmt: (m: Measure, v: number) => string; onClose: () => void }> = ({ s, a, measure, fmt, onClose }) => {
  const { t } = useTranslation();
  const { dayShort, pct } = useRotaI18n();
  const model = s.orderDays.length ? scheduleShares(s.profile, s.orderDays, a.rhythm.direction) : new Array(7).fill(0);
  const unit = t(`fcUnit_${measure}`);
  const weeks = a.weeks.map((w, i) => ({ w, v: s.weekly[measure][i] })).filter(x => x.v !== null);
  return (
    <div className="fixed inset-y-0 right-0 z-[2000] w-full max-w-md bg-card text-foreground border-l shadow-2xl flex flex-col" role="dialog" aria-label={s.name}>
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b">
        <div className="min-w-0">
          <div className="text-[12px] font-mono text-muted-foreground">{s.code}</div>
          <h2 className="text-[17px] font-bold truncate">{s.name}</h2>
          <div className="text-[12px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <StatusBadge status={s.status} />
            {[s.region, s.format, s.segment].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label={t('fcClose')} className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border hover:bg-muted cursor-pointer"><X size={15} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-[12.5px]">
        <section className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border px-2.5 py-2">
            <div className="text-[11px] text-muted-foreground">{t('fcColForecast')}</div>
            <div className="text-[16px] font-bold tabular-nums">{fmt(measure, s.forecast[measure])} <span className="text-[11px] font-semibold text-muted-foreground">{unit}</span></div>
          </div>
          <div className="rounded-lg border px-2.5 py-2 col-span-2">
            <div className="text-[11px] text-muted-foreground">{t('fcColRange')}</div>
            <div className="text-[14px] font-semibold tabular-nums">{fmt(measure, s.low[measure])} – {fmt(measure, s.high[measure])} {unit}</div>
            <div className="text-[11px] text-muted-foreground">{t('fcHistoryWeeks', { n: s.historyWeeks })} · {t('fcFirstOrder', { date: dmy(s.firstDate) })} · {t('fcLastOrder', { date: dmy(s.lastDate) })}</div>
          </div>
        </section>

        {s.lowData && <p className="text-[12px] text-amber-700 dark:text-amber-300">{t('fcLowData')}</p>}

        {weeks.length > 0 && (
          <section>
            <h3 className="font-bold mb-1">{t('fcPerWeek')}</h3>
            <div className="flex flex-wrap gap-1.5">
              {weeks.map(({ w, v }) => (
                <span key={w.start} className="rounded-md border px-2 py-1 tabular-nums"><span className="text-muted-foreground">{dmy(w.start).slice(0, 5)}</span> {fmt(measure, v as number)}</span>
              ))}
              <span className="rounded-md border px-2 py-1 tabular-nums border-[var(--fc-s2)]"><span className="text-muted-foreground">{dmy(a.targetWeek).slice(0, 5)}</span> {fmt(measure, s.forecast[measure])}</span>
            </div>
          </section>
        )}

        <section>
          <h3 className="font-bold mb-1">{t('fcNextByDay')}</h3>
          <table className="w-full tabular-nums">
            <thead className="text-muted-foreground text-[11.5px]">
              <tr><th className="text-left font-semibold py-0.5">{t('fcDay')}</th><th className="text-right font-semibold">{t('fcObserved')}</th><th className="text-right font-semibold">{t('fcModel')}</th><th className="text-right font-semibold">{t('fcColForecast')}, {unit}</th></tr>
            </thead>
            <tbody>
              {ALL_WEEKDAYS.map((d, i) => (s.observedShare[i] > 0 || model[i] > 0) && (
                <tr key={d} className="border-t">
                  <td className="py-1 font-semibold">{dayShort(d)}</td>
                  <td className="text-right">{s.observedShare[i] > 0 ? pct(s.observedShare[i] * 100) : '—'}</td>
                  <td className="text-right">{model[i] > 0 ? pct(model[i] * 100) : '—'}</td>
                  <td className="text-right font-semibold">{model[i] > 0 ? fmt(measure, s.forecast[measure] * model[i]) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="font-bold mb-1">{t('fcOrdersList')} · {s.orders.length}</h3>
          <table className="w-full tabular-nums">
            <thead className="text-muted-foreground text-[11.5px]">
              <tr>
                <th className="text-left font-semibold py-0.5">{t('fcDate')}</th><th className="text-left font-semibold">{t('fcDay')}</th>
                {(['volume', 'weight', 'qty'] as Measure[]).filter(m => a.measures[m]).map(m => <th key={m} className="text-right font-semibold">{t(`fcUnit_${m}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...s.orders].reverse().map(o => (
                <tr key={o.date} className="border-t">
                  <td className="py-0.5">{dmy(o.date)}</td>
                  <td>{dayShort(ALL_WEEKDAYS[weekday(o.date)])}</td>
                  {(['volume', 'weight', 'qty'] as Measure[]).filter(m => a.measures[m]).map(m => <td key={m} className="text-right">{fmt(m, o[m])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
};
