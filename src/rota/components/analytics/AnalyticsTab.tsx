/**
 * Analytics: before / after by day (chart + table), by party and region, heat maps day × region
 * and day × party, the "N or 0" matrix and truck load per party × day. Exports: Excel in the
 * reference layout (formulas) and PDF.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useRotaI18n } from '../../i18n';
import { ALL_WEEKDAYS, StoreView, Weekday } from '../../types';
import type { RuleSet } from '../../rules/types';
import { byParty, byRegion, dimTotals, groupMatrix, Metric, rowSpread, truckLoad, Which } from '../../state/analytics';
import { dayTotals, DayTotal, spreadPct } from '../../state/views';
import { nameKey } from '../../core/names';
import { BalancePanel } from '../BalancePanel';
import { Btn, ToggleChip } from '../ui';

const METRIC_KEY: Record<Metric, keyof DayTotal> = { volume: 'volume', weight: 'weight', qty: 'qty', stores: 'stores' };

export const AnalyticsTab: React.FC<{
  views: StoreView[];
  rules: RuleSet | null;
  rulesComplete: boolean;
  workingDays: Weekday[];
  right: React.ReactNode;
  onExportExcel: () => Promise<void>;
  onToast: (s: string) => void;
}> = ({ views, rules, rulesComplete, workingDays, right, onExportExcel, onToast }) => {
  const i18n = useRotaI18n();
  const { t, dayShort, m3, int, num } = i18n;
  const [metric, setMetric] = useState<Metric>('volume');
  const [heatWhich, setHeatWhich] = useState<Which>('current');
  const [busy, setBusy] = useState(false);
  const pdfRef = useRef<HTMLDivElement>(null);
  const fmtMetric = (v: number) => (metric === 'volume' ? m3(v) : int(v));
  const metricLabel = (m: Metric) => (m === 'volume' ? t.units.m3 : m === 'weight' ? t.units.kg : m === 'qty' ? t.units.pcs : t.balance.stores);

  const before = useMemo(() => dayTotals(views, 'original'), [views]);
  const after = useMemo(() => dayTotals(views, 'current'), [views]);
  const meanAfter = useMemo(() => {
    const tot = ALL_WEEKDAYS.reduce((s, d) => s + after[d][METRIC_KEY[metric]], 0);
    return workingDays.length ? tot / workingDays.length : 0;
  }, [after, metric, workingDays]);
  const chartData = ALL_WEEKDAYS.map(d => ({ day: dayShort(d), before: before[d][METRIC_KEY[metric]], after: after[d][METRIC_KEY[metric]] }));

  const N = rules?.general.groupMin ?? 0;
  const groups = useMemo(() => (rules && N > 1 ? groupMatrix(views, rules.general.groupKeys ?? 'party+region+day') : []), [views, rules, N]);
  const trucks = useMemo(() => truckLoad(views, rules), [views, rules]);
  const partyOrder = (rules?.parties ?? []).map(p => p.name);

  const exportPdf = async () => {
    if (!pdfRef.current) return;
    setBusy(true);
    try {
      const [{ toJpeg }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
      const node = pdfRef.current;
      const bg = getComputedStyle(node).backgroundColor || '#ffffff';
      const png = await toJpeg(node, { pixelRatio: 1.25, backgroundColor: bg, quality: 0.85 });
      const img = new Image();
      img.src = png;
      await img.decode();
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight(), margin = 24;
      const scale = (pw - margin * 2) / img.width;
      const pageH = (ph - margin * 2) / scale; // source pixels per page
      for (let y = 0, page = 0; y < img.height; y += pageH, page++) {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = Math.min(pageH, img.height - y);
        canvas.getContext('2d')!.drawImage(img, 0, y, img.width, canvas.height, 0, 0, img.width, canvas.height);
        if (page) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.82), 'JPEG', margin, margin, pw - margin * 2, canvas.height * scale);
      }
      pdf.save(`${t.xls.fileName}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      onToast(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-6">
      <BalancePanel totals={after} workingDays={workingDays} showWeight right={right} />
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        {!rulesComplete && <span className="text-[12px] text-amber-700">{t.ana.needRules}</span>}
        <span className="ml-auto" />
        <Btn icon={<FileSpreadsheet size={14} />} disabled={busy || !views.length} onClick={async () => { setBusy(true); try { await onExportExcel(); } finally { setBusy(false); } }}>
          {busy ? t.ana.exporting : t.ana.exportExcel}
        </Btn>
        <Btn icon={<FileDown size={14} />} disabled={busy || !views.length} onClick={exportPdf}>{t.ana.exportPdf}</Btn>
      </div>

      <div ref={pdfRef} className="p-4 space-y-4 bg-ink-50">
        {/* Before / after by day */}
        <section className="rounded-xl border border-ink-200 bg-ink-0 p-3">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-[14px] font-bold text-ink-900 mr-2">{t.ana.chartTitle}</h3>
            {(['volume', 'qty', 'weight', 'stores'] as Metric[]).map(m => (
              <ToggleChip key={m} pressed={metric === m} onClick={() => setMetric(m)}>{metricLabel(m)}</ToggleChip>
            ))}
          </div>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-ink-200)" />
                  <XAxis dataKey="day" tick={{ fill: 'var(--color-ink-600)', fontSize: 12 }} axisLine={{ stroke: 'var(--color-ink-300)' }} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--color-ink-500)', fontSize: 11 }} axisLine={false} tickLine={false} width={64} tickFormatter={v => fmtMetric(Number(v))} />
                  <Tooltip
                    cursor={{ fill: 'var(--color-ink-100)' }}
                    contentStyle={{ background: 'var(--color-ink-0)', border: '1px solid var(--color-ink-200)', borderRadius: 10, color: 'var(--color-ink-900)', fontSize: 12 }}
                    formatter={(v: number, name: string) => [fmtMetric(v), name === 'before' ? t.opt.before : t.opt.after]}
                  />
                  <Legend formatter={v => <span style={{ color: 'var(--color-ink-700)', fontSize: 12 }}>{v === 'before' ? t.opt.before : t.opt.after}</span>} />
                  <ReferenceLine y={meanAfter} stroke="var(--color-ink-500)" strokeDasharray="4 4" label={{ value: t.ana.mean, fill: 'var(--color-ink-500)', fontSize: 11, position: 'insideTopRight' }} />
                  <Bar dataKey="before" fill="var(--rota-viz-before)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="after" fill="var(--rota-viz-after)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full text-[12px] tabular-nums">
              <thead className="text-ink-500">
                <tr><th className="text-left py-1"> </th><th className="text-right">{t.opt.before}</th><th className="text-right">{t.opt.after}</th></tr>
              </thead>
              <tbody>
                {ALL_WEEKDAYS.map(d => (
                  <tr key={d} className={cn('border-t border-ink-100', !workingDays.includes(d) && 'text-ink-400')}>
                    <td className="py-1 font-semibold">{dayShort(d)}</td>
                    <td className="text-right">{fmtMetric(before[d][METRIC_KEY[metric]])}</td>
                    <td className="text-right font-bold text-ink-900">{fmtMetric(after[d][METRIC_KEY[metric]])}</td>
                  </tr>
                ))}
                <tr className="border-t border-ink-300">
                  <td className="py-1 font-semibold">{t.ana.spread}</td>
                  <td className="text-right">{num(spreadPct(before, METRIC_KEY[metric], workingDays), 1)}%</td>
                  <td className="text-right font-bold text-ink-900">{num(spreadPct(after, METRIC_KEY[metric], workingDays), 1)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* By party / region with heat maps */}
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-ink-500">{t.ana.view}:</span>
          <ToggleChip pressed={heatWhich === 'original'} onClick={() => setHeatWhich('original')}>{t.opt.before}</ToggleChip>
          <ToggleChip pressed={heatWhich === 'current'} onClick={() => setHeatWhich('current')}>{t.opt.after}</ToggleChip>
          <span className="text-[11.5px] text-ink-500">{t.ana.heatHint}</span>
        </div>
        <div className="grid xl:grid-cols-2 gap-4">
          <HeatTable title={`${t.ana.heatParty} · ${t.ana.byParty}`} views={views} which={heatWhich} keyOf={byParty} order={partyOrder} workingDays={workingDays} />
          <HeatTable title={`${t.ana.heatRegion} · ${t.ana.byRegion}`} views={views} which={heatWhich} keyOf={byRegion} order={[]} workingDays={workingDays} />
        </div>

        {/* N or 0 */}
        {groups.length > 0 && (
          <section className="rounded-xl border border-ink-200 bg-ink-0 p-3">
            <h3 className="text-[14px] font-bold text-ink-900">{t.ana.groupMatrix}</h3>
            <p className="text-[11.5px] text-ink-500 mb-2">{i18n.f(t.ana.groupHint, { max: N - 1 })}</p>
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="text-[12px] tabular-nums">
                <thead className="sticky top-0 bg-ink-0 text-ink-500">
                  <tr>
                    <th className="text-left px-2 py-1">{t.filters.party}</th>
                    <th className="text-left px-2">{t.filters.region}</th>
                    {ALL_WEEKDAYS.map(d => <th key={d} className="px-2 text-center">{dayShort(d)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, k) => (
                    <tr key={k} className="border-t border-ink-100">
                      <td className="px-2 py-0.5 text-ink-800 whitespace-nowrap">{g.party || '—'}</td>
                      <td className="px-2 text-ink-600 whitespace-nowrap">{g.region || '—'}</td>
                      {ALL_WEEKDAYS.map((d, i) => {
                        const b = g.before[i], a = g.after[i];
                        const bad = (n: number) => n > 0 && n < N;
                        return (
                          <td key={d} className="px-1.5 text-center whitespace-nowrap">
                            <span className={cn('px-1 rounded', bad(b) ? 'bg-rose-100 text-rose-800 font-bold' : 'text-ink-500')}>{b || '·'}</span>
                            <span className="text-ink-300"> | </span>
                            <span className={cn('px-1 rounded', bad(a) ? 'bg-rose-100 text-rose-800 font-bold' : 'text-ink-900')}>{a || '·'}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Truck load */}
        <section className="rounded-xl border border-ink-200 bg-ink-0 p-3">
          <h3 className="text-[14px] font-bold text-ink-900">{t.ana.trucks}</h3>
          <p className="text-[11.5px] text-ink-500 mb-2">{t.ana.trucksHint}</p>
          {trucks.length === 0 ? <p className="text-[12.5px] text-ink-500">{t.ana.noTrucks}</p> : (
            <div className="overflow-x-auto">
              <table className="text-[12px] tabular-nums">
                <thead className="text-ink-500">
                  <tr><th className="text-left px-2 py-1">{t.filters.party}</th>{ALL_WEEKDAYS.map(d => <th key={d} className="px-2 text-center">{dayShort(d)}</th>)}</tr>
                </thead>
                <tbody>
                  {trucks.map(r => (
                    <tr key={r.party} className="border-t border-ink-100">
                      <td className="px-2 py-1 text-ink-800 whitespace-nowrap">{r.party}</td>
                      {r.days.map((c, i) => {
                        const pct = Math.max(c.pctM3 ?? 0, c.pctKg ?? 0);
                        const over = pct > 100;
                        return (
                          <td key={i} className="px-2 text-center whitespace-nowrap" title={`${m3(c.m3)} ${t.units.m3} · ${int(c.kg)} ${t.units.kg}`}>
                            {c.pctM3 === null && c.pctKg === null ? '—' : (
                              <span className={cn('px-1 rounded', over ? 'bg-rose-100 text-rose-800 font-bold' : 'text-ink-800')}>
                                {over && '▲ '}{num(pct, 0)}%{over && <span className="sr-only"> {t.ana.overload}</span>}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

/** Table with a diverging colour per cell: deviation of the day from the row mean */
const HeatTable: React.FC<{
  title: string;
  views: StoreView[];
  which: Which;
  keyOf: (v: StoreView, w: Which) => string;
  order: string[];
  workingDays: Weekday[];
}> = ({ title, views, which, keyOf, order, workingDays }) => {
  const { t, dayShort, m3, num } = useRotaI18n();
  const rows = useMemo(() => {
    const m = dimTotals(views, which, keyOf, 'volume');
    const before = dimTotals(views, 'original', keyOf, 'volume');
    const after = dimTotals(views, 'current', keyOf, 'volume');
    const keys = [...m.keys()].sort((a, b) => {
      const ia = order.findIndex(o => nameKey(o) === nameKey(a)), ib = order.findIndex(o => nameKey(o) === nameKey(b));
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
    });
    return keys.map(k => ({ key: k, row: m.get(k)!, sb: rowSpread(before.get(k) ?? new Array(7).fill(0), workingDays), sa: rowSpread(after.get(k) ?? new Array(7).fill(0), workingDays) }));
  }, [views, which, keyOf, order, workingDays]);
  const cellBg = (v: number, mean: number) => {
    if (mean <= 0) return undefined;
    const dev = Math.max(-1, Math.min(1, (v - mean) / mean / 0.25));
    const pole = dev >= 0 ? 'var(--rota-viz-pos)' : 'var(--rota-viz-neg)';
    return `color-mix(in oklab, ${pole} ${Math.round(Math.abs(dev) * 55)}%, var(--rota-viz-mid))`;
  };
  return (
    <section className="rounded-xl border border-ink-200 bg-ink-0 p-3 min-w-0">
      <h3 className="text-[14px] font-bold text-ink-900 mb-2">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[11.5px] tabular-nums border-separate border-spacing-[2px]">
          <thead className="text-ink-500">
            <tr>
              <th className="text-left px-1"> </th>
              {ALL_WEEKDAYS.map(d => <th key={d} className="px-1 text-center font-semibold">{dayShort(d)}</th>)}
              <th className="px-1 text-right">{t.ana.spread}<br /><span className="font-normal">{t.opt.before} → {t.opt.after}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const mean = r.row.reduce((a, b) => a + b, 0) / Math.max(1, workingDays.length);
              return (
                <tr key={r.key}>
                  <td className="px-1 text-ink-800 whitespace-nowrap max-w-40 truncate" title={r.key}>{r.key}</td>
                  {ALL_WEEKDAYS.map((d, i) => (
                    <td key={d} className={cn('px-1 py-1 text-center rounded-md', workingDays.includes(d) ? 'text-ink-900' : 'text-ink-400')}
                      style={{ background: workingDays.includes(d) ? cellBg(r.row[i], mean) : undefined }}
                      title={`${r.key} · ${dayShort(d)}: ${m3(r.row[i])} ${t.units.m3}`}>
                      {r.row[i] ? m3(r.row[i]) : '·'}
                    </td>
                  ))}
                  <td className="px-1 text-right whitespace-nowrap text-ink-700">{num(r.sb, 0)}% → <b className="text-ink-900">{num(r.sa, 1)}%</b></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
