/** Stores page: the store directory shared by Yol, Ritm and Proqnoz. */
import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n/I18nContext';
import type { StoreRecord } from '../types';
import { storeKeyOf } from '../services/storeDirectory';
import { applyIncoming, directoryStore, findConflicts, findRecord, IncomingStore, useDirectory } from './directory';
import { askDirectoryConflicts } from './ConflictDialog';
import { headerKey } from '../rota/data/storeImport';
import { saveWorkbook } from '../rota/core/download';

type EditKey = 'code' | 'name' | 'address' | 'lat' | 'lng' | 'contactPerson' | 'phone' | 'receivingWindow' | 'access' | 'vehicleLimits' | 'notes' | 'region' | 'format';
const EDIT_FIELDS: Array<{ key: EditKey; label: string; wide?: boolean }> = [
  { key: 'code', label: 'dirFieldCode' }, { key: 'name', label: 'dirFieldName' },
  { key: 'region', label: 'dirFieldRegion' }, { key: 'format', label: 'dirFieldFormat' },
  { key: 'address', label: 'dirFieldAddress', wide: true },
  { key: 'lat', label: 'dirFieldLat' }, { key: 'lng', label: 'dirFieldLng' },
  { key: 'contactPerson', label: 'dirFieldContact' }, { key: 'phone', label: 'dirFieldPhone' },
  { key: 'receivingWindow', label: 'dirFieldReceiving' }, { key: 'vehicleLimits', label: 'dirFieldVehicle' },
  { key: 'access', label: 'dirFieldAccess', wide: true }, { key: 'notes', label: 'dirFieldNotes', wide: true },
];

/** Header names per field (ru / az / en / tr), compared case- and accent-insensitively */
const ALIASES: Record<EditKey | 'coordinates', string[]> = {
  code: ['код магазина', 'код', 'müştəri kodu', 'mağaza kodu', 'store code', 'code', 'mağaza kodu', 'kod'],
  name: ['название магазина', 'название', 'магазин', 'müştəri adı', 'mağaza adı', 'store name', 'name', 'ad'],
  address: ['адрес', 'address', 'ünvan', 'adres'],
  lat: ['широта', 'enlem', 'lat', 'latitude', 'enlik'],
  lng: ['долгота', 'boylam', 'lng', 'lon', 'longitude', 'uzunluq'],
  coordinates: ['координаты', 'coordinates', 'koordinatlar'],
  contactPerson: ['контактное лицо', 'контакт', 'contact person', 'contact', 'əlaqə şəxsi', 'ilgili kişi'],
  phone: ['телефон', 'phone', 'tel', 'telefon'],
  receivingWindow: ['окно приёмки', 'окно приемки', 'время приёмки', 'время приемки', 'iş vaxtı', 'qəbul vaxtı', 'receiving window', 'receiving time', 'teslim alma saati'],
  access: ['подъезд и разгрузка', 'подъезд', 'разгрузка', 'access', 'giriş və boşaltma', 'giriş ve boşaltma'],
  vehicleLimits: ['ограничения по машинам', 'ограничения', 'vehicle limits', 'maşın məhdudiyyətləri', 'araç kısıtlamaları'],
  notes: ['заметки', 'примечание', 'комментарий', 'notes', 'comment', 'qeydlər', 'qeyd', 'notlar'],
  region: ['регион', 'alt', 'region', 'bölgə', 'bölge'],
  format: ['формат', 'format', 'store format'],
};

function readDirectoryFile(data: ArrayBuffer): IncomingStore[] | null {
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true, blankrows: false });
  if (!rows.length) return [];
  const headers = (rows[0] as unknown[]).map(h => headerKey(String(h ?? '')));
  const col: Partial<Record<EditKey | 'coordinates', number>> = {};
  const used = new Set<number>();
  for (const [field, aliases] of Object.entries(ALIASES) as Array<[EditKey | 'coordinates', string[]]>) {
    for (const a of aliases.map(headerKey)) {
      const i = headers.findIndex((h, k) => !used.has(k) && h === a);
      if (i >= 0) { col[field] = i; used.add(i); break; }
    }
  }
  if (col.code === undefined && col.name === undefined) return null;
  const text = (r: unknown[], f: EditKey) => (col[f] === undefined ? '' : String(r[col[f]!] ?? '').trim());
  const num = (v: string) => { const n = Number(v.replace(',', '.')); return v && Number.isFinite(n) ? n : null; };
  return (rows.slice(1) as unknown[][]).map(r => {
    let lat = num(text(r, 'lat')), lng = num(text(r, 'lng'));
    if ((lat === null || lng === null) && col.coordinates !== undefined) {
      const parts = String(r[col.coordinates] ?? '').split(/[,;\s]+/).map(Number).filter(Number.isFinite);
      if (parts.length >= 2) { lat = parts[0]; lng = parts[1]; }
    }
    return {
      code: text(r, 'code'), name: text(r, 'name'), address: text(r, 'address'), lat, lng, contactPerson: text(r, 'contactPerson'),
      phone: text(r, 'phone'), receivingWindow: text(r, 'receivingWindow'), access: text(r, 'access'), vehicleLimits: text(r, 'vehicleLimits'),
      notes: text(r, 'notes'), region: text(r, 'region'), format: text(r, 'format'),
    };
  }).filter(s => s.code || s.name);
}

const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '' && !(typeof v === 'number' && !Number.isFinite(v));

export const DirectoryPage: React.FC = () => {
  const { t } = useTranslation();
  const list = useDirectory();
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [format, setFormat] = useState('');
  const [edit, setEdit] = useState<{ original: StoreRecord | null; draft: Record<EditKey, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const regions = useMemo(() => [...new Set(list.map(r => r.region).filter(Boolean) as string[])].sort(), [list]);
  const formats = useMemo(() => [...new Set(list.map(r => r.format).filter(Boolean) as string[])].sort(), [list]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return list
      .filter(r => (!region || r.region === region) && (!format || r.format === format))
      .filter(r => !s || [r.code, r.name, r.address, r.contactPerson, r.phone].some(v => String(v ?? '').toLowerCase().includes(s)))
      .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
  }, [list, q, region, format]);

  const flash = (s: string) => { setToast(s); setTimeout(() => setToast(null), 3500); };
  const open = (r: StoreRecord | null) => {
    const v = (x: unknown) => (has(x) ? String(x) : '');
    setError(null);
    setEdit({
      original: r,
      draft: {
        code: v(r?.code), name: v(r?.name), address: v(r?.address), lat: v(r?.lat), lng: v(r?.lng), contactPerson: v(r?.contactPerson), phone: v(r?.phone),
        receivingWindow: v(r?.receivingWindow), access: v(r?.access), vehicleLimits: v(r?.vehicleLimits), notes: v(r?.notes), region: v(r?.region), format: v(r?.format),
      },
    });
  };
  const save = () => {
    if (!edit) return;
    const d = edit.draft;
    if (!d.code.trim() && !d.name.trim()) { setError(t('dirCodeRequired')); return; }
    const key = storeKeyOf(d.code, d.name);
    if (key !== edit.original?.key && list.some(r => r.key === key)) { setError(t('dirCodeExists')); return; }
    const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() && Number.isFinite(n) ? n : NaN; };
    const now = new Date().toISOString();
    const rec: StoreRecord = {
      ...(edit.original ?? { firstSeen: now, lastSeen: now, imports: 0 }),
      key, code: d.code.trim(), name: d.name.trim() || d.code.trim(), lat: num(d.lat), lng: num(d.lng),
      address: d.address.trim(), contactPerson: d.contactPerson.trim(), phone: d.phone.trim(), receivingWindow: d.receivingWindow.trim(),
      access: d.access.trim(), vehicleLimits: d.vehicleLimits.trim(), notes: d.notes.trim(), region: d.region.trim(), format: d.format.trim(), updatedAt: now,
    } as StoreRecord;
    directoryStore.set(prev => [...prev.filter(r => r.key !== edit.original?.key && r.key !== key), rec]);
    setEdit(null);
  };

  const importFile = async (file: File) => {
    const incoming = readDirectoryFile(await file.arrayBuffer());
    if (!incoming) { flash(t('dirImportMissing')); return; }
    const before = directoryStore.get();
    const conflicts = findConflicts(before, incoming);
    const newCount = incoming.filter(s => !findRecord(before, s.code, s.name)).length;
    const resolution = await askDirectoryConflicts(conflicts, file.name, newCount);
    applyIncoming(incoming, resolution);
    flash(t('dirImported', { added: newCount, updated: new Set([...resolution.keys()].map(k => k.split('|')[0])).size }));
  };

  const exportFile = () => {
    const head = EDIT_FIELDS.map(f => t(f.label));
    const rows = shown.map(r => EDIT_FIELDS.map(f => {
      const v = (r as unknown as Record<string, unknown>)[f.key];
      return has(v) ? v : '';
    }));
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = head.map((h, i) => ({ wch: i === 1 || i === 4 ? 28 : Math.max(10, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t('pageStores').slice(0, 31));
    saveWorkbook(wb, `${t('pageStores')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const input = 'h-9 px-2.5 rounded-lg border bg-background text-[13px]';
  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b bg-card">
        <div className="mr-2">
          <h1 className="text-[17px] font-bold leading-tight">{t('dirTitle')}</h1>
          <div className="text-[12px] text-muted-foreground">{t('dirCount', { n: list.length })}</div>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('dirSearch')} aria-label={t('dirSearch')} className={cn(input, 'pl-8 w-60')} />
        </div>
        <select value={region} onChange={e => setRegion(e.target.value)} className={input} aria-label={t('dirFieldRegion')}>
          <option value="">{t('dirAllRegions')}</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={format} onChange={e => setFormat(e.target.value)} className={input} aria-label={t('dirFieldFormat')}>
          <option value="">{t('dirAllFormats')}</option>
          {formats.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <span className="ml-auto" />
        <button type="button" onClick={() => open(null)} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold cursor-pointer"><Plus size={14} /> {t('dirAdd')}</button>
        <button type="button" onClick={() => fileRef.current?.click()} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border text-[13px] font-semibold hover:bg-muted cursor-pointer"><Upload size={14} /> {t('dirImport')}</button>
        <button type="button" onClick={exportFile} disabled={!shown.length} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border text-[13px] font-semibold hover:bg-muted cursor-pointer disabled:opacity-40"><Download size={14} /> {t('dirExport')}</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
      </div>

      <div className="flex-1 overflow-auto p-4">
        {list.length === 0 ? (
          <p className="text-[13px] text-muted-foreground max-w-xl">{t('dirEmpty')}</p>
        ) : (
          <div className="rounded-xl border bg-card overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="text-muted-foreground bg-muted/50 sticky top-0">
                <tr>
                  {['dirFieldCode', 'dirFieldName', 'dirFieldRegion', 'dirFieldFormat', 'dirFieldAddress', 'dirFieldContact', 'dirFieldPhone', 'dirFieldReceiving', 'dirFieldVehicle', 'dirFieldCoords'].map(k => (
                    <th key={k} className="text-left px-2.5 py-2 whitespace-nowrap">{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.key} onClick={() => open(r)} className="border-t hover:bg-muted/40 cursor-pointer">
                    <td className="px-2.5 py-1.5 font-semibold whitespace-nowrap">{r.code || '—'}</td>
                    <td className="px-2.5 truncate max-w-56">{r.name}</td>
                    <td className="px-2.5 text-muted-foreground whitespace-nowrap">{r.region || ''}</td>
                    <td className="px-2.5 text-muted-foreground whitespace-nowrap">{r.format || ''}</td>
                    <td className="px-2.5 truncate max-w-56">{r.address || ''}</td>
                    <td className="px-2.5 whitespace-nowrap">{r.contactPerson || ''}</td>
                    <td className="px-2.5 whitespace-nowrap">{r.phone || ''}</td>
                    <td className="px-2.5 whitespace-nowrap">{r.receivingWindow || ''}</td>
                    <td className="px-2.5 truncate max-w-40">{r.vehicleLimits || ''}</td>
                    <td className="px-2.5 whitespace-nowrap tabular-nums text-muted-foreground">{Number.isFinite(r.lat) && Number.isFinite(r.lng) ? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}` : t('dirNoCoords')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {edit && (
        <div className="fixed inset-y-0 right-0 z-[2000] w-full max-w-lg bg-card border-l shadow-2xl flex flex-col" role="dialog" aria-label={edit.original?.name ?? t('dirNewTitle')}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
            <h2 className="text-[16px] font-bold truncate">{edit.original ? `${edit.original.code} · ${edit.original.name}` : t('dirNewTitle')}</h2>
            <button type="button" onClick={() => setEdit(null)} aria-label={t('dirClose')} className="h-8 w-8 inline-flex items-center justify-center rounded-lg border hover:bg-muted cursor-pointer"><X size={15} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-3">
            {EDIT_FIELDS.map(f => (
              <label key={f.key} className={cn('block', f.wide && 'col-span-2')}>
                <span className="block text-[11.5px] text-muted-foreground mb-0.5">{t(f.label)}</span>
                {f.wide && f.key !== 'address' ? (
                  <textarea rows={3} value={edit.draft[f.key]} onChange={e => setEdit({ ...edit, draft: { ...edit.draft, [f.key]: e.target.value } })}
                    className="w-full px-2.5 py-1.5 rounded-lg border bg-background text-[13px]" />
                ) : (
                  <input value={edit.draft[f.key]} onChange={e => setEdit({ ...edit, draft: { ...edit.draft, [f.key]: e.target.value } })}
                    inputMode={f.key === 'lat' || f.key === 'lng' ? 'decimal' : undefined} className={cn(input, 'w-full')} />
                )}
              </label>
            ))}
            {edit.original && (
              <p className="col-span-2 text-[11.5px] text-muted-foreground">{t('dirLastSeen')}: {new Date(edit.original.lastSeen).toLocaleString()}</p>
            )}
            {error && <p className="col-span-2 text-[12.5px] text-destructive">{error}</p>}
          </div>
          <div className="px-4 py-3 border-t flex gap-2">
            {edit.original && (
              <button type="button" onClick={() => {
                if (window.confirm(t('dirDeleteConfirm', { name: edit.original!.name }))) { directoryStore.set(prev => prev.filter(r => r.key !== edit.original!.key)); setEdit(null); }
              }} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border text-[13px] font-semibold text-destructive hover:bg-destructive/10 cursor-pointer"><Trash2 size={14} /> {t('dirDelete')}</button>
            )}
            <span className="ml-auto" />
            <button type="button" onClick={() => setEdit(null)} className="h-9 px-3 rounded-lg border text-[13px] font-semibold hover:bg-muted cursor-pointer">{t('dirCancel')}</button>
            <button type="button" onClick={save} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-bold cursor-pointer">{t('dirSave')}</button>
          </div>
        </div>
      )}
      {toast && <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[3100] bg-foreground text-background text-[13px] font-semibold px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}
    </div>
  );
};
