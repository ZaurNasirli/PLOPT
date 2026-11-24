/** Rota module: shipment-day and party planning for stores. */

export type Weekday = 'Пн' | 'Вт' | 'Ср' | 'Чт' | 'Пт' | 'Сб' | 'Вс';

/** Internal day ids (also the order of columns). Display names come from the translations. */
export const ALL_WEEKDAYS: Weekday[] = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** 1 = Monday … 7 = Sunday, the digits used in the store file ("135") */
export const DAY_DIGIT: Record<Weekday, number> = { Пн: 1, Вт: 2, Ср: 3, Чт: 4, Пт: 5, Сб: 6, Вс: 7 };
export const DIGIT_DAY: Record<number, Weekday> = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 7: 'Вс' };

/** How the volume / weight / quantity columns of the store file are meant */
export type VolumeMode = 'weekly' | 'per_delivery';

/** One store as imported from the store file. Static: the plan lives in PlanSnapshot. */
export interface RotaStore {
  storeCode: string;
  storeName: string;
  /** party (shipment batch) name, normalised: trimmed, single spaces, one spelling per case-insensitive name */
  party: string;
  region: string;
  /** shop format: Supermarket / Minimarket / Express / Franchise / Superstore … */
  storeFormat: string;
  /** segment: ARAZ / Urban / Franchise … (case normalised) */
  segment: string;
  /** days in the file, may include Sunday */
  originalDays: Weekday[];
  lat: number | null;
  lng: number | null;
  /** weekly totals (m³ / kg / pcs) */
  weeklyVolume: number;
  weeklyWeight: number;
  weeklyQty: number;
  /** receiving window as written in the file ('' = empty) */
  receivingTime: string;
  /** party window as written in the file ('' = empty) */
  batchTime: string;
  /** Excel row number, for messages */
  rowNumber: number;
}

/** The plan: days and party of every store (by store code). Undo/redo and scenarios store these. */
export interface PlanSnapshot {
  days: Record<string, Weekday[]>;
  party: Record<string, string>;
}

export interface RotaDataset {
  name: string;
  importedAt: string;
  volumeMode: VolumeMode;
  stores: RotaStore[];
  /** true when loaded with the "Load demo" button */
  isDemo?: boolean;
  /** header of the store file for each field (to export in the same layout) */
  headers?: Partial<Record<string, string>>;
}

/** A store with its current plan, as the screens show it. */
export interface StoreView extends RotaStore {
  currentDays: Weekday[];
  currentParty: string;
  /** current party's window: from the active rule set, else from the store file */
  currentPartyWindow: string;
  dailyVolume: number;
  dailyWeight: number;
  dailyQty: number;
  /** share of the week per weekday (0 = Mon) for the real-rhythm split; null = even split */
  shareCur?: number[] | null;
  shareOrig?: number[] | null;
  daysChanged: boolean;
  partyChanged: boolean;
}

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ImportIssue {
  severity: ValidationSeverity;
  /** translation key in the `importIssues` section */
  code: string;
  rowNumber?: number;
  storeCode?: string;
  storeName?: string;
  column?: string;
  value?: string;
  params?: Record<string, string | number>;
}
