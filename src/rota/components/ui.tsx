/**
 * Small building blocks of the Rota module. They use the module's palette (ink / brand / night),
 * so both skins (PL/OPT and LogistikPro) apply to them.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useRotaI18n } from '../i18n';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const BTN: Record<BtnVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 border border-brand-600',
  secondary: 'bg-ink-0 text-ink-800 border border-ink-200 hover:border-brand-400 hover:text-brand-700',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 border border-transparent',
  danger: 'bg-ink-0 text-rose-700 border border-rose-200 hover:bg-rose-50',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 border border-emerald-600',
};

export const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; icon?: React.ReactNode }> = ({
  variant = 'secondary', size = 'md', icon, className, children, type, ...rest
}) => (
  <button
    type={type ?? 'button'}
    className={cn(
      'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none',
      size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8.5 px-3 text-[13px]',
      BTN[variant],
      className
    )}
    {...rest}
  >
    {icon}
    {children}
  </button>
);

export const IconBtn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }> = ({ label, className, children, ...rest }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    className={cn('h-8 w-8 inline-flex items-center justify-center rounded-lg border border-ink-200 bg-ink-0 text-ink-700 hover:border-brand-400 hover:text-brand-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors', className)}
    {...rest}
  >
    {children}
  </button>
);

export const Modal: React.FC<{
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'md' | 'lg' | 'xl';
}> = ({ title, onClose, children, footer, width = 'lg' }) => {
  const { t } = useRotaI18n();
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[3000] bg-night-950/45 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'bg-ink-0 text-ink-900 rounded-2xl shadow-2xl border border-ink-200 w-full max-h-[90vh] flex flex-col',
          width === 'md' ? 'max-w-lg' : width === 'lg' ? 'max-w-3xl' : 'max-w-6xl'
        )}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-ink-200">
          <h2 id={titleId} className="text-[16px] font-bold">{title}</h2>
          <IconBtn label={t.common.close} onClick={onClose}><X size={15} /></IconBtn>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-ink-200 flex flex-wrap items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};

/** Multi-select with "all" = empty selection (filters are inactive when nothing is picked) */
export const MultiSelect: React.FC<{
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  render?: (v: string) => React.ReactNode;
}> = ({ label, options, selected, onChange, render }) => {
  const { t, f } = useRotaI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const active = selected.length > 0;
  const toggle = (o: string) => {
    const next = selected.includes(o) ? selected.filter(x => x !== o) : [...selected, o];
    onChange(next.length === options.length ? [] : next);
  };
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={cn(
          'h-8 px-2.5 rounded-lg border text-[12.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors',
          active ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-200 bg-ink-0 text-ink-700 hover:border-ink-300'
        )}
      >
        {label}
        <span className={cn('px-1.5 rounded-full text-[11px] tabular-nums', active ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600')}>
          {active ? selected.length : t.filters.any}
        </span>
        <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 mt-1 w-64 bg-ink-0 border border-ink-200 rounded-xl shadow-xl z-[1200] p-2">
          <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-ink-100">
            <span className="text-[12px] font-bold text-ink-800">{label}</span>
            {active && (
              <button type="button" className="text-[11.5px] font-semibold text-brand-700 hover:underline cursor-pointer" onClick={() => onChange([])}>
                {t.common.reset}
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {options.map(o => (
              <label key={o} className="flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-ink-50 text-[12.5px] text-ink-800 cursor-pointer select-none">
                <input type="checkbox" className="accent-brand-600 w-3.5 h-3.5" checked={selected.includes(o)} onChange={() => toggle(o)} />
                <span className="truncate">{render ? render(o) : o}</span>
              </label>
            ))}
          </div>
          {active && <div className="px-1.5 pt-1.5 text-[11px] text-ink-500">{f(t.filters.selectedN, { n: selected.length })}</div>}
        </div>
      )}
    </div>
  );
};

export const ToggleChip: React.FC<{ pressed: boolean; onClick: () => void; children: React.ReactNode; title?: string }> = ({ pressed, onClick, children, title }) => (
  <button
    type="button"
    aria-pressed={pressed}
    title={title}
    onClick={onClick}
    className={cn(
      'h-8 px-2.5 rounded-lg border text-[12.5px] font-semibold cursor-pointer transition-colors whitespace-nowrap',
      pressed ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-200 bg-ink-0 text-ink-700 hover:border-ink-300'
    )}
  >
    {children}
  </button>
);

export const SeverityDot: React.FC<{ severity: 'error' | 'warning' | 'info' }> = ({ severity }) => (
  <span
    className={cn(
      'inline-block w-2 h-2 rounded-full shrink-0',
      severity === 'error' ? 'bg-rose-500' : severity === 'warning' ? 'bg-amber-500' : 'bg-sky-500'
    )}
  />
);

/** Colour for a party name (stable, from a fixed palette that reads well in both skins) */
const PARTY_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#dc2626', '#4f46e5', '#0d9488', '#ca8a04', '#9333ea'];
export function partyColor(party: string, allParties: string[]): string {
  const i = allParties.indexOf(party);
  if (i >= 0) return PARTY_COLORS[i % PARTY_COLORS.length];
  let h = 0;
  for (const ch of party) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PARTY_COLORS[h % PARTY_COLORS.length];
}
