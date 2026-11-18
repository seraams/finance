/**
 * Monatsbudget pro Kategorie, Selbst-Gehalt-Auszahlung.
 */
import {
  bufferBalance,
  findPot,
  indexDataset,
  isMirror,
  potBalances,
  potEffects,
} from './balances';
import { salaryPayout, type SalaryPayout } from './buffer';
import { budgetMonthOf, monthDiff, addMonths } from './dates';
import { uuidv7 } from './ids';
import type { Dataset, Id, IsoDate, Money, MonthKey, PotMove } from './types';

export function getBudget(d: Dataset, month: MonthKey, categoryId: Id): Money {
  return d.budgets.find((b) => b.month === month && b.categoryId === categoryId)?.amount ?? 0;
}

export function setBudget(d: Dataset, month: MonthKey, categoryId: Id, amount: Money): void {
  const i = d.budgets.findIndex((b) => b.month === month && b.categoryId === categoryId);
  if (amount === 0) {
    if (i >= 0) d.budgets.splice(i, 1);
    return;
  }
  if (i >= 0) d.budgets[i]!.amount = amount;
  else d.budgets.push({ month, categoryId, amount });
}

/** Übernimmt alle Budgets des Vormonats, ohne bestehende zu überschreiben. */
export function copyBudgetsFromPreviousMonth(d: Dataset, month: MonthKey): number {
  const prev = addMonths(month, -1);
  let n = 0;
  for (const b of d.budgets.filter((x) => x.month === prev)) {
    if (!d.budgets.some((x) => x.month === month && x.categoryId === b.categoryId)) {
      d.budgets.push({ month, categoryId: b.categoryId, amount: b.amount });
      n++;
    }
  }
  return n;
}

/**
 * Ausgaben pro Kategorie und Budgetmonat, die das Monatsbudget belasten
 * (budgetrelevante Konten, Kategorie-Splits ohne abweichenden Topf).
 * Werte: Summe der Split-Beträge (Ausgaben negativ, Rückerstattungen positiv).
 */
export function monthlySpending(d: Dataset): Map<MonthKey, Map<Id, Money>> {
  const idx = indexDataset(d);
  const start = d.settings.monthStartDay;
  const out = new Map<MonthKey, Map<Id, Money>>();
  for (const tx of d.transactions) {
    if (isMirror(tx)) continue;
    const acc = idx.accounts.get(tx.accountId);
    if (!acc?.budgetRelevant) continue;
    const month = budgetMonthOf(tx.date, start);
    for (const s of idx.splitsByTx.get(tx.id) ?? []) {
      if (!s.categoryId || (s.potId && s.potId !== idx.monthlyId)) continue;
      const cat = idx.categories.get(s.categoryId);
      if (!cat || cat.kind !== 'expense') continue;
      let m = out.get(month);
      if (!m) out.set(month, (m = new Map()));
      m.set(s.categoryId, (m.get(s.categoryId) ?? 0) + s.amount);
    }
  }
  return out;
}

export interface CategoryMonthStatus {
  categoryId: Id;
  /** Übertrag aus dem Vormonat (nur bei `rolloverRest`, nie negativ). */
  carryIn: Money;
  budget: Money;
  /** Ausgaben als positive Zahl. */
  spent: Money;
  /** carryIn + budget − spent. Negativ = überzogen. */
  rest: Money;
  /** Anteil verbraucht (spent / (carryIn + budget)), 0 ohne Budget. */
  usage: number;
}

/**
 * Status jeder Ausgabe-Kategorie in einem Budgetmonat.
 * Übertrag: Ist `rolloverRest` gesetzt, wird ein positiver Rest in den
 * nächsten Monat übernommen. Überzogene Beträge werden nicht übertragen
 * (sie werden im Monatsabschluss aus dem Puffer gedeckt).
 */
export function categoryStatuses(d: Dataset, month: MonthKey): Map<Id, CategoryMonthStatus> {
  const spending = monthlySpending(d);
  const out = new Map<Id, CategoryMonthStatus>();
  const budgetMonths = d.budgets.map((b) => b.month);
  const spendMonths = [...spending.keys()];
  const all = [...budgetMonths, ...spendMonths].filter((m) => m <= month).sort();
  const first = all[0] ?? month;

  for (const cat of d.categories) {
    if (cat.kind !== 'expense') continue;
    let carry = 0;
    let status: CategoryMonthStatus | undefined;
    const span = monthDiff(first, month);
    for (let i = 0; i <= span; i++) {
      const m = addMonths(first, i);
      const budget = getBudget(d, m, cat.id);
      const spent = 0 - (spending.get(m)?.get(cat.id) ?? 0);
      const carryIn = cat.rolloverRest ? carry : 0;
      const rest = carryIn + budget - spent;
      const available = carryIn + budget;
      status = {
        categoryId: cat.id,
        carryIn,
        budget,
        spent,
        rest,
        usage: available > 0 ? spent / available : spent > 0 ? Infinity : 0,
      };
      carry = Math.max(0, rest);
    }
    if (status) out.set(cat.id, status);
  }
  return out;
}

/** Summe der Selbst-Gehalt-Auszahlungen in einem Budgetmonat. */
export function salaryPaidInMonth(d: Dataset, month: MonthKey): Money {
  return d.potMoves
    .filter(
      (m) => m.reason === 'salary' && budgetMonthOf(m.date, d.settings.monthStartDay) === month,
    )
    .reduce((a, m) => a + m.amount, 0);
}

/**
 * Bucht das Selbst-Gehalt vom Puffer ins Monatsbudget.
 * Anlaufphase: Ist der Puffer kleiner als S, wird nur min(S, P) ausgezahlt.
 * Bereits im selben Monat ausgezahlte Beträge werden angerechnet.
 */
export function previewSalary(d: Dataset, date: IsoDate): SalaryPayout {
  const month = budgetMonthOf(date, d.settings.monthStartDay);
  const remaining = Math.max(0, d.settings.salary - salaryPaidInMonth(d, month));
  const payout = salaryPayout(remaining, bufferBalance(d, date));
  // Anlaufphase bezieht sich auf das volle S
  return { ...payout, startupPhase: payout.amount < remaining };
}

export function paySalary(d: Dataset, date: IsoDate): PotMove | null {
  const buffer = findPot(d, 'buffer');
  const monthly = findPot(d, 'monthly');
  if (!buffer || !monthly) return null;
  const { amount } = previewSalary(d, date);
  if (amount <= 0) return null;
  const move: PotMove = {
    id: uuidv7(),
    date,
    fromPotId: buffer.id,
    toPotId: monthly.id,
    amount,
    reason: 'salary',
  };
  d.potMoves.push(move);
  return move;
}

export interface MonthOverview {
  month: MonthKey;
  salaryPaid: Money;
  budgeted: Money;
  spent: Money;
  /** Aktueller Saldo des Monatsbudget-Topfs. */
  monthlyPot: Money;
  /** Monatsbudget-Topf minus Summe der positiven Kategorie-Reste. */
  unbudgeted: Money;
  /** Andere Belastungen des Monatsbudgets in diesem Monat (Raten, Rücklagen), positiv. */
  otherCharges: Money;
}

export function monthOverview(d: Dataset, month: MonthKey, asOf?: IsoDate): MonthOverview {
  const statuses = categoryStatuses(d, month);
  let budgeted = 0;
  let spent = 0;
  let positiveRests = 0;
  for (const s of statuses.values()) {
    budgeted += s.budget + s.carryIn;
    spent += s.spent;
    positiveRests += Math.max(0, s.rest);
  }
  const monthlyId = findPot(d, 'monthly')?.id;
  const monthlyPot = monthlyId ? (potBalances(d, asOf).get(monthlyId) ?? 0) : 0;
  let otherCharges = 0;
  if (monthlyId) {
    for (const e of potEffects(d, asOf)) {
      if (e.potId !== monthlyId || budgetMonthOf(e.date, d.settings.monthStartDay) !== month)
        continue;
      if (e.reason === 'transfer' || e.reason === 'reserve') otherCharges -= e.amount;
    }
  }
  return {
    otherCharges,
    month,
    salaryPaid: salaryPaidInMonth(d, month),
    budgeted,
    spent,
    monthlyPot,
    unbudgeted: monthlyPot - positiveRests,
  };
}
