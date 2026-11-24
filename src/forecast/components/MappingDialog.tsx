/** Which column of the orders file is what: shown when a required column was not found, or on request. */
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '../../i18n/I18nContext';
import { missingOrderFields, ORDER_FIELDS, OrderMapping, OrdersSheet } from '../ordersImport';

export const MappingDialog: React.FC<{
  sheet: OrdersSheet;
  initial: OrderMapping;
  onCancel: () => void;
  onApply: (m: OrderMapping) => void;
}> = ({ sheet, initial, onCancel, onApply }) => {
  const { t } = useTranslation();
  const [m, setM] = useState<OrderMapping>(initial);
  const missing = missingOrderFields(m);
  const preview = sheet.rows.slice(0, 5);
  const cellText = (v: unknown) => (v instanceof Date ? v.toLocaleDateString() : String(v ?? ''));
  return (
    <div className="fixed inset-0 z-[3000] bg-black/45 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={t('fcMapTitle')} className="bg-card text-foreground border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b">
          <div>
            <h2 className="text-[16px] font-bold">{t('fcMapTitle')} · {sheet.fileName}</h2>
            <p className="text-[12.5px] text-muted-foreground mt-1">{t('fcMapText')}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label={t('fcClose')} className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border hover:bg-muted cursor-pointer"><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {ORDER_FIELDS.map(f => (
              <label key={f} className="block">
                <span className="block text-[11.5px] text-muted-foreground mb-0.5">{t(`fcField_${f}`)}{(f === 'date' || f === 'code') && ' *'}</span>
                <select value={m[f]} onChange={e => setM({ ...m, [f]: Number(e.target.value) })}
                  className="h-9 w-full px-2 rounded-lg border bg-background text-[13px] cursor-pointer">
                  <option value={-1}>{t('fcNotUsed')}</option>
                  {sheet.headers.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="text-[12.5px] text-destructive">{t('fcMapMissing', { fields: missing.map(f => t(`fcField_${f}`)).join(', ') })}</p>
          )}
          <div>
            <h3 className="text-[12.5px] font-semibold mb-1">{t('fcPreview')}</h3>
            <div className="rounded-lg border overflow-x-auto">
              <table className="text-[11.5px] w-full">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>{sheet.headers.map((h, i) => <th key={i} className="text-left px-2 py-1 whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.map((r, k) => (
                    <tr key={k} className="border-t">{sheet.headers.map((_, i) => <td key={i} className="px-2 py-0.5 whitespace-nowrap">{cellText(r[i])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-9 px-3 rounded-lg border text-[13px] font-semibold hover:bg-muted cursor-pointer">{t('fcCancel')}</button>
          <button type="button" disabled={missing.length > 0} onClick={() => onApply(m)}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">{t('fcCalculate')}</button>
        </div>
      </div>
    </div>
  );
};
