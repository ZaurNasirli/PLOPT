import { describe, expect, it } from 'vitest';
import { changeReasons, rowSpread, truckLoad } from './analytics';
import { emptyRuleSet } from '../rules/types';
import type { StoreView, Weekday } from '../types';

const view = (p: Partial<StoreView>): StoreView => ({
  storeCode: 'S', storeName: 'S', party: '12--30 Part 1', region: 'R', storeFormat: 'Express', segment: 'ARAZ',
  originalDays: ['Пн', 'Ср', 'Пт'], lat: null, lng: null, weeklyVolume: 30, weeklyWeight: 300, weeklyQty: 30,
  receivingTime: '', batchTime: '', rowNumber: 2, currentDays: ['Пн', 'Ср', 'Пт'], currentParty: '12--30 Part 1',
  currentPartyWindow: '', dailyVolume: 10, dailyWeight: 100, dailyQty: 10, daysChanged: false, partyChanged: false, ...p,
});

function rules() {
  const rs = emptyRuleSet('t');
  const party = (id: string, name: string, chainOrder: number | null, truckM3: number | null = null) =>
    ({ id, code: id, name, window: '08:00 - 16:00', chainOrder, fixed: false, truckM3, truckKg: null, trucksPerDay: 2 });
  rs.parties = [party('a', '12--30 Part 1', 3, 10), party('b', '12--30 Part 2', 5), party('c', '16--00 Part 3', 1)];
  const seg = (value: string, partyChange: 'chain_up' | 'swap_part') => ({
    id: value, kind: 'segment' as const, value, partyChange, maxStepsUp: 2, bonus1: 1, bonus2: 0.1, changePenalty: 3, changeDayCount: true,
    maxPlusDays: null, maxMinusDays: null, minDays: null, maxDays: null, minDaysOneDay: null, sundayMin: null, sundayMax: null,
  });
  rs.segments = [seg('ARAZ', 'swap_part'), seg('Urban', 'chain_up')];
  return rs;
}
const WD: Weekday[] = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

describe('analytics', () => {
  it('spread over working days', () => {
    expect(rowSpread([10, 10, 10, 10, 10, 10, 0], WD)).toBe(0);
    expect(rowSpread([12, 10, 10, 10, 10, 8, 0], WD)).toBeCloseTo(40, 6);
  });

  it('names a party change by the store rule: Part swap for ARAZ, chain step for Urban', () => {
    const rs = rules();
    const araz = view({ currentParty: '12--30 Part 2', partyChanged: true });
    expect(changeReasons(araz, rs, WD)).toEqual([{ code: 'swapPart' }]);
    const urban = view({ segment: 'Urban', currentParty: '12--30 Part 2', partyChanged: true });
    expect(changeReasons(urban, rs, WD)).toEqual([{ code: 'chainUp', steps: 1 }]); // chain orders 3 → 5 are neighbours
    const moved = view({ currentDays: ['Вт', 'Чт', 'Сб'], daysChanged: true });
    expect(changeReasons(moved, rs, WD)).toEqual([{ code: 'daysMoved' }]);
    const sunday = view({ originalDays: ['Пн', 'Вс'], currentDays: ['Вт', 'Пт'], daysChanged: true });
    expect(changeReasons(sunday, rs, WD)).toEqual([{ code: 'rescheduled' }]);
  });

  it('truck load per party and day against capacity × trucks', () => {
    const rows = truckLoad([view({}), view({ storeCode: 'T' })], rules());
    expect(rows).toHaveLength(1);
    expect(rows[0].days[0].m3).toBeCloseTo(20);
    expect(rows[0].days[0].pctM3).toBeCloseTo(100); // 20 m³ / (10 m³ × 2 trucks)
    expect(rows[0].days[1].pctM3).toBe(0);
  });
});
