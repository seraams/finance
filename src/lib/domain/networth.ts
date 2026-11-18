/**
 * Vermögen und Vermögensverlauf (aus den Monats-Snapshots).
 */
import { addMonths, budgetMonthEnd, monthRange } from './dates';
import { accountValues } from './investments';
import { expensesByCategory, monthlyFlows, savingsRate } from './stats';
import type { Account, Dataset, Id, IsoDate, Money, MonthKey } from './types';

export type WealthGroup = 'liquid' | 'investments' | 'debts' | 'other';

export function wealthGroup(a: Account): WealthGroup {
  if (a.type === 'debt') return 'debts';
  if (a.type === 'brokerage' || a.type === 'pension3a' || a.type === 'crypto') return 'investments';
  if (a.budgetRelevant) return 'liquid';
  return 'other';
}

export interface NetWorth {
  total: Money;
  liquid: Money;
  investments: Money;
  debts: Money;
  other: Money;
}

const empty = (): NetWorth => ({ total: 0, liquid: 0, investments: 0, debts: 0, other: 0 });

export function netWorth(d: Dataset, asOf?: IsoDate): NetWorth {
  const values = accountValues(d, asOf);
  const out = empty();
  for (const a of d.accounts) {
    const v = values.get(a.id) ?? 0;
    out[wealthGroup(a)] += v;
    out.total += v;
  }
  return out;
}

/** Verlauf je Monat aus den Snapshots, aufgeteilt nach Gruppen. */
export function netWorthHistory(d: Dataset): ({ month: MonthKey } & NetWorth)[] {
  const accounts = new Map<Id, Account>(d.accounts.map((a) => [a.id, a]));
  const byMonth = new Map<MonthKey, NetWorth>();
  for (const s of d.snapshots) {
    const a = accounts.get(s.accountId);
    if (!a) continue;
    let nw = byMonth.get(s.month);
    if (!nw) byMonth.set(s.month, (nw = empty()));
    nw[wealthGroup(a)] += s.balance;
    nw.total += s.balance;
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, nw]) => ({ month, ...nw }));
}

export interface YearMonthRow {
  month: MonthKey;
  income: Money;
  expense: Money;
  net: Money;
  savingsRate: number | null;
  /** Vermögen am Monatsende (Snapshot), `null` ohne Daten. */
  netWorth: Money | null;
  /** Veränderung des Vermögens gegenüber dem Vormonat. */
  netWorthChange: Money | null;
}

export interface YearReport {
  year: number;
  rows: YearMonthRow[];
  income: Money;
  expense: Money;
  net: Money;
  savingsRate: number | null;
  netWorthStart: Money | null;
  netWorthEnd: Money | null;
  /** Ausgaben je Hauptkategorie im Jahr, absteigend. */
  byCategory: { categoryId: Id; amount: Money }[];
  /** Bester / schlechtester Monat nach Saldo. */
  bestMonth?: MonthKey;
  worstMonth?: MonthKey;
}

export function yearReport(d: Dataset, year: number): YearReport {
  const months = monthRange(`${year}-01`, `${year}-12`);
  const flows = monthlyFlows(d, months);
  const history = new Map(netWorthHistory(d).map((h) => [h.month, h.total]));
  const prevEnd = history.get(addMonths(months[0]!, -1)) ?? null;
  let prev = prevEnd;
  const rows: YearMonthRow[] = flows.map((f) => {
    const nw = history.get(f.month) ?? null;
    const row: YearMonthRow = {
      month: f.month,
      income: f.income,
      expense: f.expense,
      net: f.income - f.expense,
      savingsRate: savingsRate(f.income, f.expense),
      netWorth: nw,
      netWorthChange: nw !== null && prev !== null ? nw - prev : null,
    };
    if (nw !== null) prev = nw;
    return row;
  });
  const income = rows.reduce((a, r) => a + r.income, 0);
  const expense = rows.reduce((a, r) => a + r.expense, 0);
  const cat = new Map<Id, Money>();
  for (const m of months) {
    for (const c of expensesByCategory(d, m))
      cat.set(c.categoryId, (cat.get(c.categoryId) ?? 0) + c.amount);
  }
  const active = rows.filter((r) => r.income !== 0 || r.expense !== 0);
  const best = active.reduce<YearMonthRow | undefined>(
    (b, r) => (!b || r.net > b.net ? r : b),
    undefined,
  );
  const worst = active.reduce<YearMonthRow | undefined>(
    (b, r) => (!b || r.net < b.net ? r : b),
    undefined,
  );
  const withNw = rows.filter((r) => r.netWorth !== null);
  return {
    year,
    rows,
    income,
    expense,
    net: income - expense,
    savingsRate: savingsRate(income, expense),
    netWorthStart: prevEnd ?? withNw[0]?.netWorth ?? null,
    netWorthEnd: withNw[withNw.length - 1]?.netWorth ?? null,
    byCategory: [...cat.entries()]
      .map(([categoryId, amount]) => ({ categoryId, amount }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount),
    ...(best ? { bestMonth: best.month } : {}),
    ...(worst ? { worstMonth: worst.month } : {}),
  };
}

/** Stichtag für den Wert eines Monats (Monatsende des Budgetmonats). */
export function monthEndDate(d: Dataset, month: MonthKey): IsoDate {
  return budgetMonthEnd(month, d.settings.monthStartDay);
}
