/** Report: store changes (for mailing), chain moves with reasons, remaining "N or 0" violations. */
import React, { useMemo } from 'react';
import { Copy, FileSpreadsheet } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useRotaI18n } from '../../i18n';
import { ALL_WEEKDAYS, StoreView, Weekday } from '../../types';
import type { RuleSet } from '../../rules/types';
import type { PlanReport } from '../../state/planReport';
import { changeReasons, ChangeReason } from '../../state/analytics';
import { chainReasonText, exportChangesWorkbook } from '../../data/excelExport';
import { Btn } from '../ui';

export const ReportTab: React.FC<{
  views: StoreView[];
  rules: RuleSet | null;
  report: PlanReport | null;
  workingDays: Weekday[];
  onToast: (s: string) => void;
  onOpen: (code: string) => void;
}> = ({ views, rules, report, workingDays, onToast, onOpen }) => {
  const i18n = useRotaI18n();
  const { t, f, dayShort, num, int } = i18n;
  const days = (d: Weekday[]) => d.map(dayShort).join(' ');
  const reasonText = (r: ChangeReason) => {
    const R = t.rep.reasons;
    switch (r.code) {
      case 'dayCount': return f(R.dayCount, { from: r.from, to: r.to });
      case 'chainUp': return f(R.chainUp, { steps: r.steps });
      default: return R[r.code];
    }
  };
  const changed = useMemo(() => views.filter(v => v.daysChanged || v.partyChanged).map(v => ({ v, reasons: changeReasons(v, rules, workingDays) })), [views, rules, workingDays]);
  const head = [t.importer.fields.storeCode, t.importer.fields.storeName, t.filters.region, t.filters.segment, t.rep.daysBefore, t.rep.daysAfter, t.rep.partyBefore, t.rep.partyAfter, t.rep.reason];
  const rowsText = changed.map(({ v, reasons }) => [v.storeCode, v.storeName, v.region, v.segment, days(v.originalDays), days(v.currentDays), v.party, v.currentParty, reasons.map(reasonText).join('; ')]);

  const byCode = useMemo(() => new Map(views.map(v => [v.storeCode, v])), [views]);
  const chain = useMemo(() => {
    if (!report) return [];
    const order = (s: string) => ({ up1: 0, up2: 1, upMore: 1, notMoved: 2, down: 3, fixedParty: 4 } as Record<string, number>)[s] ?? 5;
    return report.report.chain
      .map(c => ({ c, v: byCode.get(report.model.codes[c.i]) }))
      .filter((x): x is { c: typeof x.c; v: StoreView } => Boolean(x.v))
      .sort((a, b) => order(a.c.status) - order(b.c.status) || a.v.party.localeCompare(b.v.party));
  }, [report, byCode]);
  const shownCodes = useMemo(() => new Set(views.map(v => v.storeCode)), [views]);
  const violations = report?.report.violations.filter(x => x.members.some(i => shownCodes.has(report.model.codes[i]))) ?? [];

  const statusText = (s: string, n: number) => f((t.rep.chainStatus as Record<string, string>)[s] ?? s, { n });
  const violationText = (vi: PlanReport['report']['violations'][number]) => {
    const r = vi.reason, R = t.rep.violationReason, codes = report!.model.codes;
    switch (r.code) {
      case 'smallGroupFixed': return f(R.smallGroupFixed, { total: r.total, why: t.rep.why[r.why] });
      case 'minDays': return f(R.minDays, { store: codes[r.store], min: r.min });
      case 'fixedCount': return f(R.fixedCount, { store: codes[r.store], count: r.count });
      default: return R.tradeoff;
    }
  };

  return (
    <div className="p-4 space-y-4">
      {report && (
        <section className="rounded-xl border border-ink-200 bg-ink-0 p-3">
          <h3 className="text-[14px] font-bold text-ink-900 mb-2">{t.rep.summary}</h3>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-700 tabular-nums">
            <span>{t.opt.spreadV}: {num(report.report.before.spreadV, 1)}% → <b className="text-ink-900">{num(report.report.after.spreadV, 1)}%</b></span>
            <span>{t.opt.spreadP}: {num(report.report.before.spreadP, 1)}% → <b className="text-ink-900">{num(report.report.after.spreadP, 1)}%</b></span>
            <span>{t.opt.spreadC}: {num(report.report.before.spreadC, 1)}% → <b className="text-ink-900">{num(report.report.after.spreadC, 1)}%</b></span>
            <span>{t.opt.groupViol}: {int(report.report.before.violations)} → <b className="text-ink-900">{int(report.report.after.violations)}</b></span>
            <span>{t.opt.storeDays}: {int(report.report.before.storeDays)} → <b className="text-ink-900">{int(report.report.after.storeDays)}</b></span>
            <span>{t.opt.partyRegion}: <b className="text-ink-900">{num(report.report.after.partySpreadMax, 1)}% / {num(report.report.after.regionSpreadMax, 1)}%</b></span>
          </div>
        </section>
      )}
      {!report && <p className="text-[12.5px] text-amber-700">{t.rep.needRules}</p>}

      <section className="rounded-xl border border-ink-200 bg-ink-0 p-3">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h3 className="text-[14px] font-bold text-ink-900">{f(t.rep.changes, { n: changed.length })}</h3>
          <span className="ml-auto" />
          <Btn size="sm" icon={<Copy size={13} />} disabled={!changed.length} onClick={() => {
            const text = [head, ...rowsText].map(r => r.join('\t')).join('\n');
            void navigator.clipboard?.writeText(text).then(() => onToast(t.rep.copied));
          }}>{t.rep.copy}</Btn>
          <Btn size="sm" icon={<FileSpreadsheet size={13} />} disabled={!changed.length} onClick={() => void exportChangesWorkbook(rowsText, head, t.xls.changesFile)}>{t.rep.exportExcel}</Btn>
        </div>
        <p className="text-[11.5px] text-ink-500 mb-2">{t.rep.changesHint}</p>
        {changed.length === 0 ? <p className="text-[12.5px] text-ink-500">{t.rep.noChanges}</p> : (
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-ink-200">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-ink-50 text-ink-500"><tr>{head.map(h => <th key={h} className="text-left px-2 py-1.5 whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {changed.map(({ v, reasons }) => (
                  <tr key={v.storeCode} className="border-t border-ink-100">
                    <td className="px-2 py-1 font-semibold"><button type="button" className="hover:underline cursor-pointer text-ink-900" onClick={() => onOpen(v.storeCode)}>{v.storeCode}</button></td>
                    <td className="px-2 text-ink-800 truncate max-w-52">{v.storeName}</td>
                    <td className="px-2 text-ink-600">{v.region}</td>
                    <td className="px-2 text-ink-600">{v.segment}</td>
                    <td className="px-2 text-ink-600 whitespace-nowrap">{days(v.originalDays)}</td>
                    <td className={cn('px-2 whitespace-nowrap', v.daysChanged ? 'font-bold text-ink-900' : 'text-ink-600')}>{days(v.currentDays)}</td>
                    <td className="px-2 text-ink-600 whitespace-nowrap">{v.party}</td>
                    <td className={cn('px-2 whitespace-nowrap', v.partyChanged ? 'font-bold text-ink-900' : 'text-ink-600')}>{v.currentParty}</td>
                    <td className="px-2 text-ink-700">{reasons.map(reasonText).join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {report && chain.length > 0 && (
        <section className="rounded-xl border border-ink-200 bg-ink-0 p-3">
          <h3 className="text-[14px] font-bold text-ink-900 mb-2">{f(t.rep.chain, { n: chain.length })}</h3>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-ink-200">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-ink-50 text-ink-500">
                <tr>
                  {[t.importer.fields.storeCode, t.importer.fields.storeName, t.filters.region, t.importer.fields.receivingTime, t.rep.partyBefore, t.rep.partyAfter, t.rep.step, t.rep.status, t.rep.reason].map(h => <th key={h} className="text-left px-2 py-1.5 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {chain.map(({ c, v }) => (
                  <tr key={v.storeCode} className="border-t border-ink-100">
                    <td className="px-2 py-1 font-semibold text-ink-900">{v.storeCode}</td>
                    <td className="px-2 text-ink-800 truncate max-w-48">{v.storeName}</td>
                    <td className="px-2 text-ink-600">{v.region}</td>
                    <td className="px-2 text-ink-600 whitespace-nowrap">{v.receivingTime || '7/24'}</td>
                    <td className="px-2 text-ink-600 whitespace-nowrap">{v.party}</td>
                    <td className="px-2 text-ink-900 whitespace-nowrap">{v.currentParty}</td>
                    <td className="px-2 text-center tabular-nums">{c.steps}</td>
                    <td className="px-2 whitespace-nowrap">
                      <span className={cn('px-1.5 rounded text-[11px] font-bold',
                        c.status === 'up1' ? 'bg-emerald-100 text-emerald-800' : c.status === 'notMoved' || c.status === 'down' ? 'bg-rose-100 text-rose-800' : c.status === 'fixedParty' ? 'bg-ink-100 text-ink-700' : 'bg-amber-100 text-amber-800')}>
                        {statusText(c.status, c.steps)}
                      </span>
                    </td>
                    <td className="px-2 text-ink-700">{c.status === 'fixedParty' || c.status === 'up1' ? '' : chainReasonText(c, report.model.parties, report.model.regions, i18n, v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report && (
        <section className="rounded-xl border border-ink-200 bg-ink-0 p-3">
          <h3 className="text-[14px] font-bold text-ink-900 mb-2">{f(t.rep.violations, { n: violations.length })}</h3>
          {violations.length === 0 ? <p className="text-[12.5px] text-ink-500">{t.conflicts.none}</p> : (
            <ul className="space-y-1 text-[12.5px]">
              {violations.map((vi, k) => (
                <li key={k} className="flex flex-wrap gap-x-2">
                  <span className="font-semibold text-ink-900">{report.model.parties[vi.party]} · {report.model.regions[vi.region]} · {dayShort(ALL_WEEKDAYS[vi.day])}</span>
                  <span className="text-ink-600">{vi.members.map(i => report.model.codes[i]).join(', ')}</span>
                  <span className={vi.reason.code === 'tradeoff' ? 'text-amber-700' : 'text-rose-700'}>— {violationText(vi)}{vi.reason.code !== 'tradeoff' && ` (${t.rep.unresolvable})`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
};
