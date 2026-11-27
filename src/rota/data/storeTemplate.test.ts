import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildStoreTemplate } from './storeTemplate';
import { autoDetectMapping, buildStores, missingRequired, readStoreWorkbook } from './storeImport';

describe('Ritm store template', () => {
  it('is recognised without manual mapping and imports its example rows without errors', () => {
    const buf = XLSX.write(buildStoreTemplate(), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const sheet = readStoreWorkbook(buf, 'Ritm_magazalar_sablon.xlsx');
    const m = autoDetectMapping(sheet.headers);
    expect(missingRequired(m)).toEqual([]);
    // two «Format» columns: shop format first, segment second
    expect([m.storeFormat, m.segment, m.receivingTime, m.batchTime, m.lat, m.lng]).toEqual([4, 6, 12, 13, 7, 8]);
    const res = buildStores(sheet, m, 'weekly');
    expect(res.stores).toHaveLength(5);
    expect(res.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(res.stores[0]).toMatchObject({ storeCode: 'AA01', party: '16--00 Part 1', segment: 'ARAZ', storeFormat: 'Supermarket' });
  });
});
