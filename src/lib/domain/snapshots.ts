/**
 * Monatliche Snapshots aller Kontostände.
 *
 * Für jeden Budgetmonat ab Eröffnung eines Kontos wird der Saldo am
 * Monatsende (bzw. heute für den laufenden Monat) gespeichert. Snapshots
 * nicht abgeschlossener Monate werden bei jeder Änderung aktualisiert,
 * Snapshots abgeschlossener Monate (MonthClosing) bleiben eingefroren.
 *
 * Bei Anlagekonten zählt der Marktwert der Positionen (Kurs zum Stichtag) dazu.
 */
import { budgetMonthEnd, budgetMonthOf, monthRange } from './dates';
import { holdingValue } from './investments';
import type {
  Dataset,
  Holding,
  Id,
  IsoDate,
  Money,
  MonthKey,
  Snapshot,
  Transaction,
} from './types';

export function updateSnapshots(d: Dataset, today: IsoDate): number {
  const start = d.settings.monthStartDay;
  const current = budgetMonthOf(today, start);
  const closed = new Set(d.monthClosings.map((c) => c.month));
  const existing = new Map<string, Snapshot>(
    d.snapshots.map((s) => [`${s.accountId}|${s.month}`, s]),
  );
  const byAccount = new Map<Id, Transaction[]>();
  for (const t of d.transactions) {
    const l = byAccount.get(t.accountId);
    if (l) l.push(t);
    else byAccount.set(t.accountId, [t]);
  }
  const holdingsByAccount = new Map<Id, Holding[]>();
  for (const h of d.holdings) {
    if (h.quantity === 0) continue;
    const l = holdingsByAccount.get(h.accountId);
    if (l) l.push(h);
    else holdingsByAccount.set(h.accountId, [h]);
  }
  let changed = 0;
  for (const acc of d.accounts) {
    const txs = (byAccount.get(acc.id) ?? []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    let firstDate = acc.openingDate;
    if (txs[0] && txs[0].date < firstDate) firstDate = txs[0].date;
    const firstMonth = budgetMonthOf(firstDate, start);
    if (firstMonth > current) continue;
    let i = 0;
    let bal: Money = 0;
    let openingApplied = false;
    for (const month of monthRange(firstMonth, current)) {
      const end = month === current ? today : budgetMonthEnd(month, start);
      while (i < txs.length && txs[i]!.date <= end) bal += txs[i++]!.amount;
      if (!openingApplied && acc.openingDate <= end) {
        bal += acc.openingBalance;
        openingApplied = true;
      }
      // Anlagekonten: Marktwert der Positionen zum Stichtag dazurechnen
      const holdings = holdingsByAccount.get(acc.id) ?? [];
      const value = bal + holdings.reduce((a, h) => a + holdingValue(d, h, end), 0);
      const key = `${acc.id}|${month}`;
      const snap = existing.get(key);
      if (snap) {
        if (closed.has(month) || snap.balance === value) continue;
        snap.balance = value;
        changed++;
      } else {
        const s: Snapshot = { month, accountId: acc.id, balance: value };
        d.snapshots.push(s);
        existing.set(key, s);
        changed++;
      }
    }
  }
  return changed;
}

/** Summe der Snapshots je Monat (z. B. für den Vermögensverlauf). */
export function netWorthByMonth(
  d: Dataset,
  filter: (accountId: Id) => boolean = () => true,
): Map<MonthKey, Money> {
  const out = new Map<MonthKey, Money>();
  for (const s of d.snapshots) {
    if (!filter(s.accountId)) continue;
    out.set(s.month, (out.get(s.month) ?? 0) + s.balance);
  }
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}
