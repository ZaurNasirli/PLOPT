import { describe, expect, it } from 'vitest';
import { formatWindow, isStrictWindowText, parseWindow, windowsOverlap } from './time';

const opts = { emptyIs247: true, s724Is247: true };
const w = (s: string) => parseWindow(s, opts);

describe('time windows', () => {
  it('parses plain and overnight windows', () => {
    expect(w('08:00 - 16:00')).toEqual({ kind: 'window', start: 480, end: 960 });
    expect(w('16:00 - 02:00')).toEqual({ kind: 'window', start: 960, end: 1560 });
    expect(w('07:00 - 00:00')).toEqual({ kind: 'window', start: 420, end: 1440 });
    expect(formatWindow(w('16:00 - 02:00'))).toBe('16:00 - 02:00');
  });

  it('treats empty and 7/24 by the rules', () => {
    expect(w('')).toEqual({ kind: 'always' });
    expect(w('7/24')).toEqual({ kind: 'always' });
    expect(parseWindow('', { emptyIs247: false, s724Is247: true })).toEqual({ kind: 'unknown' });
    expect(parseWindow('7/24', { emptyIs247: true, s724Is247: false })).toEqual({ kind: 'unknown' });
    expect(w('abc').kind).toBe('invalid');
  });

  it('overlap across midnight on both sides', () => {
    // party 16:00–02:00 vs store 07:00–02:00
    expect(windowsOverlap(w('16:00 - 02:00'), w('07:00 - 02:00'), false)).toBe(true);
    // party 00:00–08:00 vs store open until 02:00 (the after-midnight part overlaps)
    expect(windowsOverlap(w('00:00 - 08:00'), w('07:00 - 02:00'), false)).toBe(true);
    expect(windowsOverlap(w('00:00 - 01:00'), w('20:00 - 02:00'), false)).toBe(true);
    // party 00:00–08:00 vs store 08:00–23:00 only touches
    expect(windowsOverlap(w('00:00 - 08:00'), w('08:00 - 23:00'), false)).toBe(false);
    expect(windowsOverlap(w('00:00 - 08:00'), w('08:00 - 23:00'), true)).toBe(true);
    // store closing at midnight vs night party starting at midnight: touching only
    expect(windowsOverlap(w('00:00 - 08:00'), w('07:00 - 00:00'), false)).toBe(true); // 07:00–08:00 overlaps
    expect(windowsOverlap(w('16:00 - 23:00'), w('00:00 - 08:00'), false)).toBe(false);
    expect(windowsOverlap(w('16:00 - 02:00'), w('00:00 - 08:00'), false)).toBe(true);
  });

  it('always overlaps, unknown never does', () => {
    expect(windowsOverlap({ kind: 'always' }, w('08:00 - 12:00'), false)).toBe(true);
    expect(windowsOverlap({ kind: 'unknown' }, w('08:00 - 12:00'), false)).toBe(false);
  });

  it('strict format for the rules sheet', () => {
    expect(isStrictWindowText('08:00 - 16:00')).toBe(true);
    expect(isStrictWindowText('8:00-16:00')).toBe(false);
  });
});
