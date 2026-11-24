import { DIGIT_DAY, RotaDataset, RotaStore, Weekday } from '../types';

/** Demo stores in the store-file format (only for the "Load demo" button; the module starts empty) */
export function generateDemoDataset(name: string): RotaDataset {
  let seed = 20261124;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const parties: Array<[string, string]> = [
    ['16--00 Part 1', '08:00 - 12:00'], ['16--00 Part 2', '08:00 - 16:00'], ['12--30 Part 1', '16:00 - 23:00'],
    ['12--30 Part 2', '16:00 - 02:00'], ['15--00 Part 1', '00:00 - 08:00'],
  ];
  const regions: Array<[string, number, number]> = [
    ['NIZAMI-XETAI', 40.385, 49.89], ['YASAMAL-ECEMI', 40.39, 49.81], ['NERIMANOV-AZADLIQ', 40.41, 49.87], ['XIRDALAN-MASAZI', 40.45, 49.76],
  ];
  const receiving = ['7/24', '07:00 - 00:00', '08:00 - 23:00', '07:00 - 02:00', ''];
  const dayPatterns = ['135', '246', '14', '25', '36', '1234', '12345', '15', '123456', '1357', '246'];
  const stores: RotaStore[] = [];
  for (let i = 0; i < 84; i++) {
    const segment = i % 6 === 0 ? 'Franchise' : i % 4 === 0 ? 'Urban' : 'ARAZ';
    const format = segment === 'Franchise' ? 'Franchise' : pick(['Supermarket', 'Minimarket', 'Express', 'Superstore']);
    const [party, batch] = pick(parties);
    const [region, lat, lng] = regions[i % regions.length];
    const days = pick(dayPatterns).split('').map(c => DIGIT_DAY[+c]) as Weekday[];
    const volume = 6 + rnd() * 60;
    stores.push({
      storeCode: `D${String(100 + i)}`,
      storeName: `Demo ${format} ${i + 1}`,
      party, region, storeFormat: format, segment,
      originalDays: days,
      lat: +(lat + (rnd() - 0.5) * 0.05).toFixed(5),
      lng: +(lng + (rnd() - 0.5) * 0.07).toFixed(5),
      weeklyVolume: volume,
      weeklyWeight: volume * (380 + rnd() * 120),
      weeklyQty: Math.round(volume * (35 + rnd() * 15)),
      receivingTime: pick(receiving),
      batchTime: batch,
      rowNumber: i + 2,
    });
  }
  return { name, importedAt: new Date().toISOString(), volumeMode: 'weekly', stores, isDemo: true };
}
