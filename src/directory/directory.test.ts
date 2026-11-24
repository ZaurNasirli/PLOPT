import { beforeEach, describe, expect, it } from 'vitest';
import { applyIncoming, directoryStore, findConflicts, resolvedKey } from './directory';

beforeEach(() => directoryStore.set([]));

describe('store directory', () => {
  it('adds new stores, fills empty fields silently, reports real differences', () => {
    applyIncoming([{ code: 'A1', name: 'Shop One', region: 'NORTH', lat: 40.1, lng: 49.8 }], new Map());
    expect(directoryStore.get()).toHaveLength(1);
    const incoming = [{ code: 'a1', name: 'Shop  one', region: 'SOUTH', format: 'Express', lat: 40.1000004, lng: 49.8, phone: '123' }];
    const conflicts = findConflicts(directoryStore.get(), incoming);
    // name differs only by case/spaces, coords within 10 m, format/phone are empty in the directory
    expect(conflicts.map(c => c.field)).toEqual(['region']);
    const res = applyIncoming(incoming, new Map()); // directory wins
    const rec = res.get(resolvedKey('a1'))!;
    expect(rec.region).toBe('NORTH');
    expect(rec.format).toBe('Express');
    expect(rec.phone).toBe('123');
    expect(rec.imports).toBe(2);
  });

  it('the file wins where chosen', () => {
    applyIncoming([{ code: 'B2', name: 'Old', lat: 40, lng: 49 }], new Map());
    const incoming = [{ code: 'B2', name: 'New', lat: 40.5, lng: 49.5 }];
    const conflicts = findConflicts(directoryStore.get(), incoming);
    expect(conflicts.map(c => c.field).sort()).toEqual(['coords', 'name']);
    const res = applyIncoming(incoming, new Map([[conflicts.find(c => c.field === 'name')!.id, 'file' as const]]));
    const rec = res.get('b2')!;
    expect(rec.name).toBe('New');
    expect([rec.lat, rec.lng]).toEqual([40, 49]);
  });
});
