/**
 * Wiederkehrende Buchungen (Fixkosten, Abos, später Raten).
 *
 * Unterstützte RRULE-Teilmenge: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL=n,
 * BYMONTHDAY=d (Ankertag für Monats-/Jahresregeln; zu grosse Tage werden auf
 * das Monatsende gekürzt, z. B. 31. → 28./29. Februar).
 */
import { addDays, isIsoDate } from './dates';
import { uuidv7 } from './ids';
import { saveTransaction, validateTransaction } from './transactions';
import type { Dataset, Id, IsoDate, Money, Recurring, RecurringTemplate } from './types';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RRule {
  freq: Freq;
  interval: number;
  byMonthDay?: number;
}

export function parseRrule(s: string): RRule {
  const parts = new Map(
    s
      .replace(/^RRULE:/i, '')
      .split(';')
      .filter(Boolean)
      .map((p) => {
        const [k, v] = p.split('=');
        return [(k ?? '').toUpperCase(), (v ?? '').toUpperCase()] as const;
      }),
  );
  const freq = parts.get('FREQ') as Freq | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
    throw new Error(`Unsupported RRULE: ${s}`);
  }
  const interval = Math.max(1, Math.floor(Number(parts.get('INTERVAL') ?? '1')) || 1);
  const bmd = parts.get('BYMONTHDAY');
  const byMonthDay = bmd ? Math.min(31, Math.max(1, Math.floor(Number(bmd)))) : undefined;
  return { freq, interval, ...(byMonthDay ? { byMonthDay } : {}) };
}

export function formatRrule(r: RRule): string {
  return [
    `FREQ=${r.freq}`,
    `INTERVAL=${r.interval}`,
    ...(r.byMonthDay && (r.freq === 'MONTHLY' || r.freq === 'YEARLY')
      ? [`BYMONTHDAY=${r.byMonthDay}`]
      : []),
  ].join(';');
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Nächstes Datum nach `date` gemäss Regel. */
export function nextOccurrence(date: IsoDate, rule: RRule): IsoDate {
  if (rule.freq === 'DAILY') return addDays(date, rule.interval);
  if (rule.freq === 'WEEKLY') return addDays(date, 7 * rule.interval);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const months = rule.freq === 'MONTHLY' ? rule.interval : 12 * rule.interval;
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const anchor = rule.byMonthDay ?? d;
  const nd = Math.min(anchor, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** Alle Termine ab `from` (inklusiv) bis `until` (inklusiv), höchstens `limit`. */
export function occurrences(from: IsoDate, rule: RRule, until: IsoDate, limit = 400): IsoDate[] {
  const out: IsoDate[] = [];
  let cur = from;
  while (cur <= until && out.length < limit) {
    out.push(cur);
    cur = nextOccurrence(cur, rule);
  }
  return out;
}

/** Ungefähre Anzahl Termine pro Jahr. */
export function perYear(rule: RRule): number {
  switch (rule.freq) {
    case 'DAILY':
      return 365 / rule.interval;
    case 'WEEKLY':
      return 52 / rule.interval;
    case 'MONTHLY':
      return 12 / rule.interval;
    case 'YEARLY':
      return 1 / rule.interval;
  }
}

/** Jahreskosten (positiv) einer wiederkehrenden Buchung. */
export function annualCost(rec: Recurring): Money {
  return Math.round(Math.abs(rec.template.amount) * perYear(parseRrule(rec.rrule)));
}

export interface RecurringInput {
  id?: Id;
  name: string;
  template: RecurringTemplate;
  rrule: string;
  nextDate: IsoDate;
  endDate?: IsoDate;
  isSubscription: boolean;
  active?: boolean;
}

export function saveRecurring(d: Dataset, input: RecurringInput): Recurring {
  parseRrule(input.rrule);
  if (!isIsoDate(input.nextDate)) throw new Error('Invalid date');
  const errors = validateTransaction(d, { ...input.template, date: input.nextDate });
  if (errors.length) throw new Error(errors.join(', '));
  const existing = input.id ? d.recurring.find((r) => r.id === input.id) : undefined;
  const rec: Recurring = {
    id: existing?.id ?? uuidv7(),
    name: input.name.trim() || input.template.payee,
    template: structuredClone(input.template),
    rrule: input.rrule,
    nextDate: input.nextDate,
    isSubscription: input.isSubscription,
    active: input.active ?? true,
    ...(input.endDate ? { endDate: input.endDate } : {}),
  };
  if (existing) d.recurring[d.recurring.indexOf(existing)] = rec;
  else d.recurring.push(rec);
  return rec;
}

export function deleteRecurring(d: Dataset, id: Id): void {
  d.recurring = d.recurring.filter((r) => r.id !== id);
  for (const t of d.transactions) if (t.recurringId === id) delete t.recurringId;
}

/**
 * Bucht alle fälligen Termine bis `today` und schiebt `nextDate` weiter.
 * Ungültige Vorlagen (z. B. gelöschtes Konto) werden deaktiviert.
 * Gibt die Anzahl erzeugter Buchungen zurück.
 */
export function materializeDue(d: Dataset, today: IsoDate): number {
  let n = 0;
  for (const rec of d.recurring) {
    if (!rec.active) continue;
    const rule = parseRrule(rec.rrule);
    let guard = 0;
    while (
      rec.nextDate <= today &&
      (!rec.endDate || rec.nextDate <= rec.endDate) &&
      guard++ < 400
    ) {
      const input = { ...rec.template, date: rec.nextDate, recurringId: rec.id };
      if (validateTransaction(d, input).length) {
        rec.active = false;
        break;
      }
      saveTransaction(d, {
        ...input,
        splits: input.splits.map((s) => ({ ...s })),
        tagIds: [...input.tagIds],
      });
      n++;
      rec.nextDate = nextOccurrence(rec.nextDate, rule);
    }
    if (rec.endDate && rec.nextDate > rec.endDate) rec.active = false;
  }
  return n;
}

/** Termine, die in den nächsten `days` Tagen fällig werden. */
export function upcoming(d: Dataset, today: IsoDate, days: number): Recurring[] {
  const limit = addDays(today, days);
  return d.recurring
    .filter((r) => r.active && r.nextDate <= limit)
    .sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
}
