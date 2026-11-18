/**
 * Rückerstattungen: positive Buchung, verknüpft mit der Originalbuchung
 * (`refundOfId`), auf dieselben Ausgabe-Kategorien. Sie senkt damit die
 * Ausgabe der Kategorie (Statistik und Budget) statt als Einnahme zu zählen.
 */
import { splitByWeights } from './shared';
import { originOf, splitsOf, type TransactionInput } from './transactions';
import type { Dataset, Id, IsoDate, Money, Transaction } from './types';

/** Erstellt das Eingabeobjekt für eine Rückerstattung (Betrag positiv). */
export function refundInput(
  d: Dataset,
  originalId: Id,
  amount: Money,
  date: IsoDate,
  accountId?: Id,
): TransactionInput {
  const raw = d.transactions.find((t) => t.id === originalId);
  if (!raw) throw new Error('Original not found');
  const original = originOf(d, raw);
  const abs = Math.abs(amount);
  const catSplits = splitsOf(d, original.id).filter((s) => s.categoryId && s.amount < 0);
  const shares = splitByWeights(
    abs,
    catSplits.map((s) => Math.abs(s.amount)),
  );
  return {
    accountId: accountId ?? original.accountId,
    date,
    amount: abs,
    payee: original.payee,
    note: '',
    refundOfId: original.id,
    tagIds: [...original.tagIds],
    splits: catSplits
      .map((s, i) => ({
        categoryId: s.categoryId!,
        amount: shares[i] ?? 0,
        ...(s.potId ? { potId: s.potId } : {}),
      }))
      .filter((s) => s.amount !== 0),
  };
}

export function refundsOf(d: Dataset, originalId: Id): Transaction[] {
  return d.transactions.filter((t) => t.refundOfId === originalId);
}

/** Bereits erstatteter Betrag (positiv). */
export function refundedAmount(d: Dataset, originalId: Id): Money {
  return refundsOf(d, originalId).reduce((a, t) => a + t.amount, 0);
}

/**
 * Noch erstattbarer Betrag einer Ausgabe: nur der Ausgabe-Anteil (Kategorie-
 * Splits), nicht Umbuchungsanteile wie die Anteile anderer bei geteilten Kosten.
 */
export function refundable(d: Dataset, originalId: Id): Money {
  const t = d.transactions.find((x) => x.id === originalId);
  if (!t || t.amount >= 0) return 0;
  const splits = splitsOf(d, t.id);
  const expense = splits.length
    ? splits.filter((s) => s.categoryId && s.amount < 0).reduce((a, s) => a - s.amount, 0)
    : -t.amount;
  return Math.max(0, expense - refundedAmount(d, originalId));
}
