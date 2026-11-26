import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeftRight, X } from 'lucide-react';
import { Button, Input } from '../common/UIComponents';
import { useTranslation } from '../../i18n/I18nContext';
import type { Order, StoreRecord } from '../../types';
import { makeTransfer, TransferStore } from '../../services/transfers';

interface Props {
  show: boolean;
  onClose: () => void;
  orders: Order[];
  directory: StoreRecord[];
  onAdd: (newOrders: Order[]) => void;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Manual store-to-store transfer: sender, receiver, load, date and slot → a pickup + drop pair */
export const AddTransferModal: React.FC<Props> = ({ show, onClose, orders, directory, onAdd }) => {
  const { t } = useTranslation();

  // every store with coordinates: the directory first, then the stores of the current orders
  const stores = useMemo(() => {
    const map = new Map<string, TransferStore>();
    const put = (s: TransferStore) => {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng) || !s.name) return;
      const k = norm(s.code || s.name);
      if (!map.has(k)) map.set(k, s);
    };
    for (const r of directory) put({ code: r.code, name: r.name, lat: r.lat, lng: r.lng, region: r.region, warehouseType: r.warehouseType });
    for (const o of orders) if (o.stopType !== 'pickup') put({ code: o.code, name: o.customerName, lat: o.lat, lng: o.lng, region: o.region, warehouseType: o.warehouseType });
    return [...map.values()].sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));
  }, [directory, orders]);
  const labelOf = (s: TransferStore) => (s.code ? `${s.code} — ${s.name}` : s.name);
  const byLabel = useMemo(() => new Map(stores.map(s => [norm(labelOf(s)), s])), [stores]);
  const find = (text: string) => {
    const q = norm(text);
    if (!q) return undefined;
    return byLabel.get(q) ?? stores.find(s => norm(s.code) === q || norm(s.name) === q);
  };

  const dates = useMemo(() => [...new Set(orders.map(o => o.shippingDate).filter(Boolean) as string[])].sort(), [orders]);
  const slots = useMemo(() => [...new Set(orders.map(o => o.timeSlot).filter(Boolean))], [orders]);
  const today = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };

  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [volume, setVolume] = useState('1');
  const [weight, setWeight] = useState('0');
  const [satir, setSatir] = useState('1');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');
  const [error, setError] = useState<string | null>(null);

  const from = find(fromText), to = find(toText);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!from) return setError(t('transferErrFrom'));
    if (!to) return setError(t('transferErrTo'));
    if (norm(from.code || from.name) === norm(to.code || to.name)) return setError(t('transferErrSame'));
    const v = Number(String(volume).replace(',', '.')), w = Number(String(weight).replace(',', '.'));
    if (!(v > 0) && !(w > 0)) return setError(t('transferErrLoad'));
    const id = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const delivery: Order = {
      id,
      orderNumber: `TR-${id.slice(-4).toUpperCase()}`,
      customerName: to.name,
      code: to.code,
      weight: Math.max(0, w || 0),
      volume: Math.max(0, v || 0),
      region: to.region || '',
      satir: Math.max(1, Math.round(Number(satir) || 1)),
      days: [1, 2, 3, 4, 5, 6],
      timeSlot: slot || slots[0] || 'Утро',
      shippingDate: date || dates[0] || today(),
      lat: to.lat,
      lng: to.lng,
      status: 'not-in-route',
      warehouseType: to.warehouseType,
    };
    const [drop, pickup] = makeTransfer(delivery, from);
    onAdd([pickup, drop]);
    setFromText(''); setToText(''); setVolume('1'); setWeight('0'); setSatir('1'); setError(null);
    onClose();
  };

  const field = 'w-full h-9 text-sm bg-background border rounded-lg px-2.5 focus:ring-1 focus:ring-primary';
  return (
    <AnimatePresence>
      {show && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
          <motion.form
            onSubmit={submit}
            onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-4 border-b flex items-center justify-between bg-primary/5">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-base">{t('transferAddTitle')}</h3>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={onClose} title={t('btnClose')}>
                <X size={18} />
              </Button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              <p className="text-xs text-muted-foreground">{t('transferAddDesc')}</p>
              <datalist id="transfer-store-list">
                {stores.map(s => <option key={`ts-${s.code}-${s.name}`} value={labelOf(s)} />)}
              </datalist>
              <label className="block space-y-1">
                <span className="text-xs font-semibold">{t('transferFrom')}</span>
                <Input id="transfer-from" list="transfer-store-list" value={fromText} onChange={e => { setFromText(e.target.value); setError(null); }} placeholder={t('transferStorePlaceholder')} className={field} autoComplete="off" />
                {fromText && !from && <span className="text-[11px] text-amber-600">{t('transferNotFound')}</span>}
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold">{t('transferTo')}</span>
                <Input id="transfer-to" list="transfer-store-list" value={toText} onChange={e => { setToText(e.target.value); setError(null); }} placeholder={t('transferStorePlaceholder')} className={field} autoComplete="off" />
                {toText && !to && <span className="text-[11px] text-amber-600">{t('transferNotFound')}</span>}
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">{t('unitM3')}</span>
                  <Input id="transfer-volume" inputMode="decimal" value={volume} onChange={e => setVolume(e.target.value)} className={field} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">{t('unitKg')}</span>
                  <Input id="transfer-weight" inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value)} className={field} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">Sətir</span>
                  <Input id="transfer-satir" inputMode="numeric" value={satir} onChange={e => setSatir(e.target.value)} className={field} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">{t('transferDate')}</span>
                  <Input id="transfer-date" list="transfer-date-list" value={date} onChange={e => setDate(e.target.value)} placeholder={dates[0] || today()} className={field} />
                  <datalist id="transfer-date-list">{dates.map(d => <option key={`td-${d}`} value={d} />)}</datalist>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">{t('transferSlot')}</span>
                  <Input id="transfer-slot" list="transfer-slot-list" value={slot} onChange={e => setSlot(e.target.value)} placeholder={slots[0] || 'Утро'} className={field} />
                  <datalist id="transfer-slot-list">{slots.map(s => <option key={`tsl-${s}`} value={s} />)}</datalist>
                </label>
              </div>
              {from && to && (
                <div className="text-xs rounded-lg bg-muted/50 p-2.5 text-muted-foreground">
                  {t('transferPreview', { from: from.name, to: to.name })}
                </div>
              )}
              {error && <div className="text-xs font-semibold text-rose-600" role="alert">{error}</div>}
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>{t('btnCancel')}</Button>
              <Button type="submit" variant="primary" size="sm">{t('transferAddButton')}</Button>
            </div>
          </motion.form>
        </div>
      )}
    </AnimatePresence>
  );
};
