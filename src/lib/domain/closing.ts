/**
 * Rücklagen und geführter Monatsabschluss.
 *
 * Schritte des Abschlusses für Budgetmonat M:
 *  1. unkategorisierte Buchungen zuordnen       → `uncategorizedInMonth`
 *  2. Kontostände mit der Bank abgleichen        → `reconcileAccount`
 *  3. offene Salden bei Personen zeigen          → `personBalances`
 *  4. Reste übertragen / in den Puffer zurück    → `settleRests`
 *  5. Selbst-Gehalt für M+1 auszahlen            → `paySalary` + `payReserves`
 *  6. Überlauf verteilen                         → `distributeOverflowToGoals`
 *  7. Snapshot, Bericht, Monat sperren           → `closeMonth`, `monthReport`
 */
import {
  accountBalances,
  bufferBalance,
  findPot,
  indexDataset,
  isMirror,
  potBalances,
} from './balances';
import { bufferTarget, distributeOverflow, overflow, reserveContribution } from './buffer';
import { categoryStatuses } from './budget';
import { addMonths, budgetMonthEnd, budgetMonthOf, budgetMonthStart, monthDiff } from './dates';
import { uuidv7 } from './ids';
import { updateSnapshots } from './snapshots';
import { expensesByCategory, monthlyFlows, savingsRate } from './stats';
import { saveTransaction } from './transactions';
import type { Dataset, Id, IsoDate, Money, MonthKey, PotMove, Transaction } from './types';

// ---------- Rücklagen ----------

export interface ReserveLine {
  potId: Id;
  name: string;
  target: Money;
  /** Angespart zu Monatsbeginn (A). */
  saved: Money;
  monthsLeft: number;
  /** r für diesen Monat. */
  contribution: Money;
  /** In diesem Monat bereits zugewiesen. */
  moved: Money;
  /** Noch zuzuweisen. */
  due: Money;
  /** Fälligkeit liegt vor dem Monat → Datum anpassen. */
  overdue: boolean;
}

/** Rücklage-Beiträge r = (B − A) / n je Rücklage-Topf für den Budgetmonat. */
export function reserveSchedule(d: Dataset, month: MonthKey): ReserveLine[] {
  const start = d.settings.monthStartDay;
  const balances = potBalances(d);
  const out: ReserveLine[] = [];
  for (const pot of d.pots) {
    if (pot.kind !== 'reserve' || !pot.targetAmount || !pot.targetDate) continue;
    const moved = d.potMoves
      .filter(
        (m) =>
          m.reason === 'reserve' && m.toPotId === pot.id && budgetMonthOf(m.date, start) === month,
      )
      .reduce((a, m) => a + m.amount, 0);
    const saved = (balances.get(pot.id) ?? 0) - moved;
    const dueMonth = budgetMonthOf(pot.targetDate, start);
    const diff = monthDiff(month, dueMonth);
    const overdue = diff < 0;
    const monthsLeft = Math.max(1, diff);
    const contribution = overdue ? 0 : reserveContribution(pot.targetAmount, saved, monthsLeft);
    out.push({
      potId: pot.id,
      name: pot.name,
      target: pot.targetAmount,
      saved,
      monthsLeft,
      contribution,
      moved,
      due: Math.max(0, contribution - moved),
      overdue,
    });
  }
  return out;
}

/** Bucht die fälligen Rücklage-Beiträge vom Monatsbudget in die Rücklagen. */
export function payReserves(d: Dataset, month: MonthKey, date: IsoDate): PotMove[] {
  const monthly = findPot(d, 'monthly');
  if (!monthly) return [];
  const moves: PotMove[] = [];
  for (const line of reserveSchedule(d, month)) {
    if (line.due <= 0) continue;
    const m: PotMove = {
      id: uuidv7(),
      date,
      fromPotId: monthly.id,
      toPotId: line.potId,
      amount: line.due,
      reason: 'reserve',
    };
    d.potMoves.push(m);
    moves.push(m);
  }
  return moves;
}

// ---------- Monatsabschluss ----------

export function isMonthClosed(d: Dataset, month: MonthKey): boolean {
  return d.monthClosings.some((c) => c.month === month);
}

export function isDateInClosedMonth(d: Dataset, date: IsoDate): boolean {
  return isMonthClosed(d, budgetMonthOf(date, d.settings.monthStartDay));
}

/** Ältester noch offener Monat vor dem laufenden (oder `undefined`). */
export function nextMonthToClose(d: Dataset, today: IsoDate): MonthKey | undefined {
  const start = d.settings.monthStartDay;
  const current = budgetMonthOf(today, start);
  let first: IsoDate | undefined;
  for (const t of d.transactions) if (!first || t.date < first) first = t.date;
  for (const a of d.accounts) if (!first || a.openingDate < first) first = a.openingDate;
  if (!first) return undefined;
  for (let m = budgetMonthOf(first, start); m < current; m = addMonths(m, 1)) {
    if (!isMonthClosed(d, m)) return m;
  }
  return undefined;
}

/** Schritt 1: Buchungen des Monats mit ganz oder teilweise fehlender Kategorie. */
export function uncategorizedInMonth(d: Dataset, month: MonthKey): Transaction[] {
  const idx = indexDataset(d);
  const start = d.settings.monthStartDay;
  return d.transactions
    .filter((tx) => {
      if (isMirror(tx) || tx.holdingId || budgetMonthOf(tx.date, start) !== month) return false;
      const covered = (idx.splitsByTx.get(tx.id) ?? []).reduce((a, s) => a + s.amount, 0);
      return covered !== tx.amount;
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Schritt 2: Bankabgleich. Erzeugt bei Abweichung eine Korrekturbuchung
 * (unkategorisiert) am Stichtag. Gibt die Differenz zurück.
 */
export function reconcileAccount(
  d: Dataset,
  accountId: Id,
  date: IsoDate,
  bankBalance: Money,
  payee = 'Korrektur Bankabgleich',
): Money {
  const appBalance = accountBalances(d, date).get(accountId) ?? 0;
  const diff = bankBalance - appBalance;
  if (diff !== 0) {
    saveTransaction(d, { accountId, date, amount: diff, payee, note: 'reconcile', splits: [] });
  }
  return diff;
}

/** Schritt 3: offene Salden bei Personen (positiv: Person schuldet mir). */
export function personBalances(d: Dataset, asOf?: IsoDate): { accountId: Id; balance: Money }[] {
  const bal = accountBalances(d, asOf);
  return d.accounts
    .filter((a) => a.type === 'person' && (bal.get(a.id) ?? 0) !== 0)
    .map((a) => ({ accountId: a.id, balance: bal.get(a.id) ?? 0 }));
}

export interface RestSettlement {
  /** Rest, der in den Puffer zurückgeht (Monatsbudget → Puffer). */
  returned: Money;
  /** Aus dem Puffer gedeckte Überzüge (Puffer → Monatsbudget). */
  covered: Money;
  /** In den nächsten Monat übertragene positive Reste. */
  carried: Money;
  overspentCategoryIds: Id[];
}

function closingNote(month: MonthKey): string {
  return `closing:${month}`;
}

/**
 * Schritt 4 (Vorschau): Am Monatsende bleiben nur die übertragbaren Reste
 * im Monatsbudget. Der Rest geht in den Puffer zurück; fehlt Geld
 * (Überzug), wird es aus dem Puffer gedeckt.
 */
export function previewRests(d: Dataset, month: MonthKey): RestSettlement {
  const start = d.settings.monthStartDay;
  const end = budgetMonthEnd(month, start);
  const monthlyId = findPot(d, 'monthly')?.id;
  const potBal = monthlyId ? (potBalances(d, end).get(monthlyId) ?? 0) : 0;
  const statuses = categoryStatuses(d, month);
  let carried = 0;
  const overspent: Id[] = [];
  for (const s of statuses.values()) {
    const cat = d.categories.find((c) => c.id === s.categoryId);
    if (cat?.rolloverRest && s.rest > 0) carried += s.rest;
    if (s.rest < 0) overspent.push(s.categoryId);
  }
  const delta = potBal - carried;
  return {
    returned: Math.max(0, delta),
    covered: Math.max(0, -delta),
    carried,
    overspentCategoryIds: overspent,
  };
}

/** Schritt 4: bucht die Reste. Idempotent je Monat. */
export function settleRests(d: Dataset, month: MonthKey): RestSettlement {
  const preview = previewRests(d, month);
  const note = closingNote(month);
  if (
    d.potMoves.some((m) => m.note === note && (m.reason === 'rest' || m.reason === 'overspend'))
  ) {
    return { ...preview, returned: 0, covered: 0 };
  }
  const buffer = findPot(d, 'buffer');
  const monthly = findPot(d, 'monthly');
  if (!buffer || !monthly) return preview;
  const date = budgetMonthEnd(month, d.settings.monthStartDay);
  if (preview.returned > 0) {
    d.potMoves.push({
      id: uuidv7(),
      date,
      fromPotId: monthly.id,
      toPotId: buffer.id,
      amount: preview.returned,
      reason: 'rest',
      note,
    });
  }
  if (preview.covered > 0) {
    d.potMoves.push({
      id: uuidv7(),
      date,
      fromPotId: buffer.id,
      toPotId: monthly.id,
      amount: preview.covered,
      reason: 'overspend',
      note,
    });
  }
  return preview;
}

/**
 * Schritt 6 (Vorschau): Überlauf Ü = max(0, P − N × S) auf Sparziele nach Gewicht.
 * Ziele, die ihren Zielbetrag erreicht haben, erhalten nichts; Anteile werden
 * auf den fehlenden Betrag begrenzt, der Rest bleibt im Puffer.
 */
export function previewOverflow(d: Dataset, date: IsoDate): Map<Id, Money> {
  const P = bufferBalance(d, date);
  const total = overflow(P, bufferTarget(d.settings.salary, d.settings.bufferMonths));
  if (total <= 0 || d.settings.salary <= 0) return new Map();
  const balances = potBalances(d, date);
  const goals = d.pots.filter(
    (p) =>
      p.kind === 'goal' &&
      (p.weight ?? 0) > 0 &&
      (!p.targetAmount || (balances.get(p.id) ?? 0) < p.targetAmount),
  );
  const shares = distributeOverflow(
    total,
    goals.map((g) => ({ id: g.id, weight: g.weight ?? 0 })),
  );
  for (const g of goals) {
    if (!g.targetAmount) continue;
    const missing = g.targetAmount - (balances.get(g.id) ?? 0);
    const s = shares.get(g.id) ?? 0;
    if (s > missing) shares.set(g.id, Math.max(0, missing));
  }
  for (const [id, v] of shares) if (v <= 0) shares.delete(id);
  return shares;
}

export function distributeOverflowToGoals(d: Dataset, date: IsoDate): PotMove[] {
  const buffer = findPot(d, 'buffer');
  if (!buffer) return [];
  const moves: PotMove[] = [];
  for (const [potId, amount] of previewOverflow(d, date)) {
    const m: PotMove = {
      id: uuidv7(),
      date,
      fromPotId: buffer.id,
      toPotId: potId,
      amount,
      reason: 'overflow',
    };
    d.potMoves.push(m);
    moves.push(m);
  }
  return moves;
}

export interface MonthReport {
  month: MonthKey;
  income: Money;
  expense: Money;
  savingsRate: number | null;
  byCategory: { categoryId: Id; amount: Money }[];
  overspentCategoryIds: Id[];
  buffer: Money;
}

export function monthReport(d: Dataset, month: MonthKey): MonthReport {
  const [flow] = monthlyFlows(d, [month]);
  const statuses = categoryStatuses(d, month);
  return {
    month,
    income: flow?.income ?? 0,
    expense: flow?.expense ?? 0,
    savingsRate: savingsRate(flow?.income ?? 0, flow?.expense ?? 0),
    byCategory: expensesByCategory(d, month),
    overspentCategoryIds: [...statuses.values()].filter((s) => s.rest < 0).map((s) => s.categoryId),
    buffer: bufferBalance(d, budgetMonthEnd(month, d.settings.monthStartDay)),
  };
}

/** Schritt 7: Snapshot aktualisieren und Monat sperren. */
export function closeMonth(d: Dataset, month: MonthKey, today: IsoDate, now = new Date()): void {
  updateSnapshots(d, today);
  if (!isMonthClosed(d, month)) d.monthClosings.push({ month, closedAt: now.toISOString() });
}

/** Hebt die Sperre eines Monats wieder auf (Snapshots werden wieder aktualisiert). */
export function reopenMonth(d: Dataset, month: MonthKey): void {
  d.monthClosings = d.monthClosings.filter((c) => c.month !== month);
}

/** Datum, an dem das Selbst-Gehalt für den Folgemonat gebucht wird. */
export function nextMonthStart(d: Dataset, month: MonthKey): IsoDate {
  return budgetMonthStart(addMonths(month, 1), d.settings.monthStartDay);
}
