/**
 * Schulden als Konten (Typ `debt`, Saldo negativ) mit Raten als
 * wiederkehrende Umbuchung auf das Schuldkonto.
 */
import { accountBalances } from './balances';
import { addMonths, todayIso } from './dates';
import { parseRrule, perYear } from './recurring';
import type { Dataset, Id, IsoDate, Money, Recurring } from './types';

export interface DebtStatus {
  accountId: Id;
  name: string;
  /** Offener Betrag (positiv). */
  outstanding: Money;
  /** Aktive Ratenpläne auf dieses Konto. */
  plans: Recurring[];
  /** Durchschnittliche Rate pro Monat (positiv). */
  monthlyRate: Money;
  /** Verbleibende Monate (aufgerundet), `null` ohne Rate. */
  monthsLeft: number | null;
  /** Voraussichtlich getilgt im Monat. */
  payoffMonth: string | null;
}

/** Ratenpläne: aktive wiederkehrende Umbuchungen auf das Schuldkonto. */
export function ratePlans(d: Dataset, debtId: Id): Recurring[] {
  return d.recurring.filter(
    (r) =>
      r.active &&
      (r.template.splits.some((s) => s.counterAccountId === debtId) ||
        (r.template.accountId === debtId && r.template.amount > 0)),
  );
}

export function debtStatus(d: Dataset, debtId: Id, today: IsoDate = todayIso()): DebtStatus {
  const acc = d.accounts.find((a) => a.id === debtId);
  const balance = accountBalances(d).get(debtId) ?? 0;
  const outstanding = Math.max(0, -balance);
  const plans = ratePlans(d, debtId);
  const monthlyRate = Math.round(
    plans.reduce(
      (a, r) => a + (Math.abs(r.template.amount) * perYear(parseRrule(r.rrule))) / 12,
      0,
    ),
  );
  const monthsLeft = monthlyRate > 0 ? Math.ceil(outstanding / monthlyRate) : null;
  return {
    accountId: debtId,
    name: acc?.name ?? '',
    outstanding,
    plans,
    monthlyRate,
    monthsLeft,
    payoffMonth:
      monthsLeft !== null ? addMonths(today.slice(0, 7), Math.max(0, monthsLeft - 1)) : null,
  };
}

export function debtStatuses(d: Dataset, today: IsoDate = todayIso()): DebtStatus[] {
  return d.accounts
    .filter((a) => a.type === 'debt' && !a.archived)
    .map((a) => debtStatus(d, a.id, today));
}
