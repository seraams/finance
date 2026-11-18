/**
 * Auswertungen: Einnahmen/Ausgaben pro Monat, Ausgaben nach Kategorie, Sparquote.
 *
 * Grundlage sind Kategorie-Splits aller Konten. Umbuchungen zählen nicht.
 * Nicht aufgeteilte Restbeträge zählen als «unkategorisiert»
 * (Abfluss → Ausgabe, Zufluss → Einnahme).
 */
import { indexDataset, isMirror } from './balances';
import { addMonths, budgetMonthOf, monthRange } from './dates';
import type { Dataset, Id, Money, MonthKey } from './types';

export interface MonthFlow {
  month: MonthKey;
  income: Money;
  /** Ausgaben als positive Zahl. */
  expense: Money;
}

export const UNCATEGORIZED = '__uncategorized__';

interface FlowEntry {
  month: MonthKey;
  categoryId: Id;
  kind: 'income' | 'expense';
  amount: Money;
}

function flowEntries(d: Dataset): FlowEntry[] {
  const idx = indexDataset(d);
  const start = d.settings.monthStartDay;
  const out: FlowEntry[] = [];
  for (const tx of d.transactions) {
    if (isMirror(tx)) continue;
    const month = budgetMonthOf(tx.date, start);
    let covered = 0;
    for (const s of idx.splitsByTx.get(tx.id) ?? []) {
      covered += s.amount;
      if (!s.categoryId) continue;
      const cat = idx.categories.get(s.categoryId);
      if (!cat) {
        out.push({
          month,
          categoryId: UNCATEGORIZED,
          kind: s.amount < 0 ? 'expense' : 'income',
          amount: s.amount,
        });
        continue;
      }
      out.push({ month, categoryId: cat.parentId ?? cat.id, kind: cat.kind, amount: s.amount });
    }
    const rest = tx.amount - covered;
    if (rest !== 0) {
      out.push({
        month,
        categoryId: UNCATEGORIZED,
        kind: rest < 0 ? 'expense' : 'income',
        amount: rest,
      });
    }
  }
  return out;
}

/** Einnahmen und Ausgaben je Budgetmonat für die angegebenen Monate. */
export function monthlyFlows(d: Dataset, months: MonthKey[]): MonthFlow[] {
  const map = new Map<MonthKey, MonthFlow>(
    months.map((m) => [m, { month: m, income: 0, expense: 0 }]),
  );
  for (const e of flowEntries(d)) {
    const f = map.get(e.month);
    if (!f) continue;
    if (e.kind === 'income') f.income += e.amount;
    else f.expense -= e.amount;
  }
  return months.map((m) => map.get(m)!);
}

/** Die `n` Monate bis einschliesslich `month`. */
export function lastMonths(month: MonthKey, n: number): MonthKey[] {
  return monthRange(addMonths(month, -(n - 1)), month);
}

/** Erster Budgetmonat mit Daten (Buchung oder Kontoeröffnung). */
export function firstDataMonth(d: Dataset): MonthKey | undefined {
  const start = d.settings.monthStartDay;
  let min: string | undefined;
  for (const t of d.transactions) if (!min || t.date < min) min = t.date;
  for (const a of d.accounts) if (!min || a.openingDate < min) min = a.openingDate;
  return min ? budgetMonthOf(min, start) : undefined;
}

/**
 * Einkommen der abgeschlossenen Monate vor `currentMonth` (höchstens 12),
 * ab dem ersten Monat mit Daten. Gibt es noch keinen abgeschlossenen Monat,
 * wird der laufende Monat verwendet.
 */
export function incomeHistory(d: Dataset, currentMonth: MonthKey): Money[] {
  const first = firstDataMonth(d);
  if (!first) return [];
  let from = addMonths(currentMonth, -12);
  if (first > from) from = first;
  const to = addMonths(currentMonth, -1);
  if (from > to) return monthlyFlows(d, [currentMonth]).map((f) => f.income);
  return monthlyFlows(d, monthRange(from, to)).map((f) => f.income);
}

/** Ausgaben nach Hauptkategorie in einem Budgetmonat (positiv, absteigend sortiert). */
export function expensesByCategory(
  d: Dataset,
  month: MonthKey,
): { categoryId: Id; amount: Money }[] {
  const map = new Map<Id, Money>();
  for (const e of flowEntries(d)) {
    if (e.month !== month || e.kind !== 'expense') continue;
    map.set(e.categoryId, (map.get(e.categoryId) ?? 0) - e.amount);
  }
  return [...map.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/** Sparquote = (Einnahmen − Ausgaben) / Einnahmen; `null` ohne Einnahmen. */
export function savingsRate(income: Money, expense: Money): number | null {
  if (income <= 0) return null;
  return (income - expense) / income;
}

export interface YearRow extends MonthFlow {
  net: Money;
  savingsRate: number | null;
}

export function yearOverview(d: Dataset, year: number): { rows: YearRow[]; total: YearRow } {
  const months = monthRange(`${year}-01`, `${year}-12`);
  const rows = monthlyFlows(d, months).map((f) => ({
    ...f,
    net: f.income - f.expense,
    savingsRate: savingsRate(f.income, f.expense),
  }));
  const income = rows.reduce((a, r) => a + r.income, 0);
  const expense = rows.reduce((a, r) => a + r.expense, 0);
  return {
    rows,
    total: {
      month: String(year),
      income,
      expense,
      net: income - expense,
      savingsRate: savingsRate(income, expense),
    },
  };
}
