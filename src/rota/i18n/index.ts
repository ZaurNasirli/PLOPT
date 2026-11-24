import { useMemo } from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import type { Weekday } from '../types';
import { ru, RotaDict } from './ru';
import { az } from './az';
import { en } from './en';
import { tr } from './tr';

export type RotaLang = 'ru' | 'az' | 'en' | 'tr';
const DICTS: Record<RotaLang, RotaDict> = { ru, az, en, tr };

export function getRotaDict(lang: string): RotaDict {
  return DICTS[lang as RotaLang] ?? ru;
}

/** Fills {name} placeholders */
export function fmt(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

export interface RotaI18n {
  lang: RotaLang;
  t: RotaDict;
  f: typeof fmt;
  dayShort: (d: Weekday) => string;
  dayFull: (d: Weekday) => string;
  /** m³ with 1 decimal */
  m3: (v: number) => string;
  /** integer with thousands separators */
  int: (v: number) => string;
  /** percent with 1 decimal, e.g. "12.8%" */
  pct: (v: number) => string;
  num: (v: number, digits: number) => string;
}

export function makeRotaI18n(lang: string): RotaI18n {
  const l = (DICTS[lang as RotaLang] ? lang : 'ru') as RotaLang;
  const t = DICTS[l];
  // Azerbaijani writes numbers like Turkish (1.583,7); browsers often lack the az number data and fall
  // back to English (1,583.7), so the Turkish number format is used for az
  const numLocale = l === 'az' ? 'tr-TR' : t.locale;
  const nf1 = new Intl.NumberFormat(numLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat(numLocale, { maximumFractionDigits: 0 });
  const cache = new Map<number, Intl.NumberFormat>();
  const nfd = (d: number) => {
    let f = cache.get(d);
    if (!f) cache.set(d, (f = new Intl.NumberFormat(numLocale, { minimumFractionDigits: d, maximumFractionDigits: d })));
    return f;
  };
  const safe = (v: number) => (Number.isFinite(v) ? v : 0);
  return {
    lang: l,
    t,
    f: fmt,
    dayShort: d => t.days.short[d],
    dayFull: d => t.days.full[d],
    m3: v => nf1.format(safe(v)),
    int: v => nf0.format(Math.round(safe(v))),
    pct: v => `${nf1.format(safe(v))}%`,
    num: (v, d) => nfd(d).format(safe(v)),
  };
}

/** Rota texts in the app's current language (one language switch for the whole app) */
export function useRotaI18n(): RotaI18n {
  const { language } = useTranslation();
  return useMemo(() => makeRotaI18n(language), [language]);
}
