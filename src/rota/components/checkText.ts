import { fmt, RotaI18n } from '../i18n';
import type { CheckResult } from '../state/checks';
import type { Weekday } from '../types';

/** Text of a check result in the interface language (day ids become day names) */
export function checkText(r: CheckResult, i18n: RotaI18n): string {
  const params: Record<string, string | number> = { ...(r.params ?? {}) };
  if (typeof params.day === 'string') params.day = i18n.dayShort(params.day as Weekday);
  return fmt((i18n.t.checks as Record<string, string>)[r.code] ?? r.code, params);
}
