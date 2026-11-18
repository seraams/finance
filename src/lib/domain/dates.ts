import type { IsoDate, MonthKey } from './types';

/** Heutiges Datum in lokaler Zeit als `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

export function toIsoDate(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parts(date: IsoDate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y ?? 1970, m ?? 1, d ?? 1];
}

/** Kalendermonat eines Datums. */
export function calendarMonth(date: IsoDate): MonthKey {
  return date.slice(0, 7);
}

/**
 * Budgetmonat eines Datums. Beginnt der Monat z. B. am 25., gehört der
 * 24. März noch zum Budgetmonat Februar und der 25. März zum März.
 */
export function budgetMonthOf(date: IsoDate, monthStartDay = 1): MonthKey {
  const [y, m, d] = parts(date);
  if (d >= monthStartDay) return monthKey(y, m);
  return addMonths(monthKey(y, m), -1);
}

export function monthKey(year: number, month: number): MonthKey {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
}

/** Anzahl Monate von `a` bis `b` (b − a). */
export function monthDiff(a: MonthKey, b: MonthKey): number {
  const [ya, ma] = a.split('-').map(Number) as [number, number];
  const [yb, mb] = b.split('-').map(Number) as [number, number];
  return yb * 12 + mb - (ya * 12 + ma);
}

/** Alle Monate von `from` bis `to` (inklusiv). */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  const n = monthDiff(from, to);
  for (let i = 0; i <= n; i++) out.push(addMonths(from, i));
  return out;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Erster Tag (inklusiv) eines Budgetmonats. */
export function budgetMonthStart(month: MonthKey, monthStartDay = 1): IsoDate {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const day = Math.min(monthStartDay, daysInMonth(y, m));
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** Letzter Tag (inklusiv) eines Budgetmonats. */
export function budgetMonthEnd(month: MonthKey, monthStartDay = 1): IsoDate {
  const next = budgetMonthStart(addMonths(month, 1), monthStartDay);
  return addDays(next, -1);
}

export function addDays(date: IsoDate, delta: number): IsoDate {
  const [y, m, d] = parts(date);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b;
}
