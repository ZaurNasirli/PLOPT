/**
 * "Send to Ritm": the forecast replaces Ritm's weekly volumes (the store file values are kept to go
 * back) and the learned rhythm switches Ritm's week split to "by rhythm".
 */
import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, X } from 'lucide-react';
import { useTranslation } from '../../i18n/I18nContext';
import { ensureRotaLoaded, rotaStore, useRotaState, whenRotaLoaded } from '../../rota/store/workspace';
import type { RhythmData } from '../../rota/core/rhythm';
import { saveWorkbook } from '../../rota/core/download';
import type { Analysis, StoreForecast } from '../engine';
import { dmy } from '../exportXlsx';

const key = (code: string) => code.trim().toLowerCase();

export interface TransferResult { volumes: number; rhythm: boolean }

export const TransferDialog: React.FC<{
  analysis: Analysis;
  fileName: string;
  onClose: () => void;
  onDone: (r: TransferResult) => void;
}> = ({ analysis: a, fileName, onClose, onDone }) => {
  const { t } = useTranslation();
  useEffect(() => { ensureRotaLoaded(); }, []);
  const loaded = useRotaState(s => s.loaded);
  const dataset = useRotaState(s => s.ws.dataset);
  const [useVolumes, setUseVolumes] = useState(true);
  const [useRhythm, setUseRhythm] = useState(true);
  const [busy, setBusy] = useState(false);

  const plan = useMemo(() => {
    const byKey = new Map(a.stores.map(s => [key(s.code), s]));
    const ritm = dataset?.stores ?? [];
    const ritmKeys = new Set(ritm.map(s => key(s.storeCode)));
    const matched: Array<{ code: string; f: StoreForecast }> = [];
    const closed: string[] = [];
    const missing: string[] = [];
    for (const s of ritm) {
      const f = byKey.get(key(s.storeCode));
      if (!f) missing.push(s.storeCode);
      else if (f.status === 'closed') closed.push(s.storeCode);
      else matched.push({ code: s.storeCode, f });
    }
    const fresh = a.stores.filter(s => s.status !== 'closed' && !ritmKeys.has(key(s.code)));
    return { matched, closed, missing, fresh };
  }, [a, dataset]);

  const hasRitm = Boolean(dataset);
  const canVolumes = hasRitm && plan.matched.length > 0;

  const go = async () => {
    setBusy(true);
    await whenRotaLoaded();
    let volumes = 0;
    const ds = rotaStore.getState().ws.dataset;
    if (useVolumes && canVolumes && ds) {
      const byCode = new Map(ds.stores.map(s => [s.storeCode, s]));
      const v = new Map<string, [number, number, number]>();
      for (const { code, f } of plan.matched) {
        const s = byCode.get(code);
        if (!s) continue;
        // a measure the orders file does not have keeps the store file value
        v.set(code, [
          a.measures.volume ? f.forecast.volume : s.weeklyVolume,
          a.measures.weight ? f.forecast.weight : s.weeklyWeight,
          a.measures.qty ? f.forecast.qty : s.weeklyQty,
        ]);
      }
      volumes = rotaStore.applyForecastVolumes(v, { week: a.targetWeek, file: fileName });
    }
    if (useRhythm) {
      // patterns under Ritm's store codes (orders may spell them differently)
      const ritmCode = new Map((ds?.stores ?? []).map(s => [key(s.storeCode), s.storeCode]));
      const stores: Record<string, number[]> = {};
      for (const s of a.stores) if (s.orderDays.length >= 2) stores[ritmCode.get(key(s.code)) ?? s.code] = s.profile;
      const rhythm: RhythmData = {
        source: fileName, from: a.dataStart, to: a.dataEnd, createdAt: new Date().toISOString(),
        direction: a.rhythm.direction, chain: a.rhythm.chain, stores,
      };
      rotaStore.setRhythm(rhythm, true);
    }
    setBusy(false);
    onDone({ volumes, rhythm: useRhythm });
  };

  /** New stores in the layout of the Ritm store file, to complete and import there */
  const downloadNew = () => {
    const h = dataset?.headers ?? {};
    const head = [h.storeCode || 'Müştəri Kodu', h.storeName || 'Müştəri Adı', h.party || 'PaP', h.region || 'Alt', h.storeFormat || 'Format', h.deliveryDays || 'RG', h.segment || 'Format', h.weeklyVolume || 'H/H', h.weeklyWeight || 'H/C', h.weeklyQty || 'H/S'];
    const rows = plan.fresh.map(s => [s.code, s.name, '', s.region, s.format, Number(s.orderDays.map(d => d + 1).join('')) || '', s.segment,
      Math.round(s.forecast.volume * 100) / 100, Math.round(s.forecast.weight), Math.round(s.forecast.qty)]);
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = head.map((_, i) => ({ wch: i === 1 ? 26 : 12 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    saveWorkbook(wb, `${t('fcNewForRitmFile')}_${a.targetWeek}.xlsx`);
  };

  const list = (codes: string[]) => (
    <span className="block text-muted-foreground text-[11.5px] mt-0.5 truncate" title={codes.join(', ')}>{codes.slice(0, 12).join(', ')}{codes.length > 12 ? ' …' : ''}</span>
  );

  return (
    <div className="fixed inset-0 z-[3000] bg-black/45 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={t('fcToRitmTitle')} className="bg-card text-foreground border rounded-2xl shadow-2xl w-full max-w-xl max-h-[88vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b">
          <h2 className="text-[16px] font-bold">{t('fcToRitmTitle')}</h2>
          <button type="button" onClick={onClose} aria-label={t('fcClose')} className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border hover:bg-muted cursor-pointer"><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-[13px]">
          {!loaded ? <p className="text-muted-foreground">…</p> : (
            <>
              {hasRitm ? (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 accent-[var(--color-primary)]" checked={useVolumes && canVolumes} disabled={!canVolumes} onChange={e => setUseVolumes(e.target.checked)} />
                  <span>{t('fcToRitmVolumes', { date: dmy(a.targetWeek), n: plan.matched.length })}</span>
                </label>
              ) : (
                <p className="text-muted-foreground">{t('fcToRitmNoData')}</p>
              )}
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5 accent-[var(--color-primary)]" checked={useRhythm} onChange={e => setUseRhythm(e.target.checked)} />
                <span>{t('fcToRitmRhythm')}</span>
              </label>
              {hasRitm && (
                <div className="rounded-xl border bg-muted/30 px-3 py-2.5 space-y-2 text-[12.5px]">
                  {plan.fresh.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="flex-1">{t('fcToRitmNew', { n: plan.fresh.length })}</span>
                        <button type="button" onClick={downloadNew} className="shrink-0 h-7 px-2 inline-flex items-center gap-1 rounded-md border bg-card text-[12px] font-semibold hover:bg-muted cursor-pointer"><Download size={12} /> {t('fcDownloadList')}</button>
                      </div>
                      {list(plan.fresh.map(s => s.code))}
                    </div>
                  )}
                  {plan.closed.length > 0 && <div>{t('fcToRitmClosed', { n: plan.closed.length })}{list(plan.closed)}</div>}
                  {plan.missing.length > 0 && <div>{t('fcToRitmMissing', { n: plan.missing.length })}{list(plan.missing)}</div>}
                  <div className="text-muted-foreground">{t('fcToRitmKeep')}</div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-lg border text-[13px] font-semibold hover:bg-muted cursor-pointer">{t('fcCancel')}</button>
          <button type="button" disabled={!loaded || busy || (!(useVolumes && canVolumes) && !useRhythm)} onClick={() => void go()}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">{t('fcToRitmGo')}</button>
        </div>
      </div>
    </div>
  );
};
