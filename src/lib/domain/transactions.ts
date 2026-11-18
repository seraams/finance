/**
 * Buchungen anlegen, ändern, löschen – inklusive Aufteilungen (Splits) und
 * gespiegelter Gegenbuchungen bei Umbuchungen.
 *
 * Eine Umbuchung von Konto X nach Y über 100 CHF:
 *   Ursprung  (X, −100, Split {counterAccountId: Y, −100}, transferId = eigene ID)
 *   Spiegel   (Y, +100, Split {counterAccountId: X, +100}, transferId = Ursprungs-ID)
 *
 * Geteilte Kosten (90 CHF Einkauf zu dritt):
 *   Ursprung  (Privat, −90, Splits [Lebensmittel −30, Gegenkonto Mitbewohner −60])
 *   Spiegel   (Mitbewohner, +60)
 */
import { isMirror } from './balances';
import { isIsoDate } from './dates';
import { uuidv7 } from './ids';
import type { Dataset, Id, IsoDate, Money, Split, Transaction } from './types';

export interface SplitInput {
  categoryId?: Id;
  counterAccountId?: Id;
  potId?: Id;
  amount: Money;
  note?: string;
}

export interface TransactionInput {
  id?: Id;
  accountId: Id;
  date: IsoDate;
  amount: Money;
  payee?: string;
  note?: string;
  tagIds?: Id[];
  attachmentIds?: Id[];
  refundOfId?: Id;
  recurringId?: Id;
  importHash?: string;
  splits: SplitInput[];
}

export type TransactionError =
  | 'account-missing'
  | 'date-invalid'
  | 'amount-invalid'
  | 'split-sum-mismatch'
  | 'split-target-missing'
  | 'split-self-transfer'
  | 'split-amount-invalid';

export function validateTransaction(d: Dataset, input: TransactionInput): TransactionError[] {
  const errors = new Set<TransactionError>();
  if (!d.accounts.some((a) => a.id === input.accountId)) errors.add('account-missing');
  if (!isIsoDate(input.date)) errors.add('date-invalid');
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) errors.add('amount-invalid');
  let total = 0;
  for (const s of input.splits) {
    if (!Number.isSafeInteger(s.amount) || s.amount === 0) errors.add('split-amount-invalid');
    total += s.amount;
    const hasCat = !!s.categoryId;
    const hasCounter = !!s.counterAccountId;
    if (hasCat === hasCounter) errors.add('split-target-missing');
    if (hasCounter && s.counterAccountId === input.accountId) errors.add('split-self-transfer');
    if (hasCounter && !d.accounts.some((a) => a.id === s.counterAccountId))
      errors.add('split-target-missing');
  }
  if (input.splits.length > 0 && total !== input.amount) errors.add('split-sum-mismatch');
  return [...errors];
}

export class TransactionValidationError extends Error {
  constructor(public readonly errors: TransactionError[]) {
    super(`Invalid transaction: ${errors.join(', ')}`);
  }
}

/** Ursprungsbuchung einer Umbuchungsgruppe (oder die Buchung selbst). */
export function originOf(d: Dataset, tx: Transaction): Transaction {
  if (!isMirror(tx)) return tx;
  return d.transactions.find((t) => t.id === tx.transferId) ?? tx;
}

export function splitsOf(d: Dataset, txId: Id): Split[] {
  return d.splits.filter((s) => s.transactionId === txId);
}

function removeMirrors(d: Dataset, originId: Id): void {
  const mirrorIds = new Set(
    d.transactions.filter((t) => t.transferId === originId && t.id !== originId).map((t) => t.id),
  );
  if (mirrorIds.size === 0) return;
  d.transactions = d.transactions.filter((t) => !mirrorIds.has(t.id));
  d.splits = d.splits.filter((s) => !mirrorIds.has(s.transactionId));
}

/**
 * Legt eine Buchung an oder aktualisiert sie. Bearbeitet man eine gespiegelte
 * Gegenbuchung, muss die Ursprungsbuchung übergeben werden (siehe `originOf`).
 * Mutiert `d` und gibt die gespeicherte Ursprungsbuchung zurück.
 */
export function saveTransaction(d: Dataset, input: TransactionInput): Transaction {
  const errors = validateTransaction(d, input);
  if (errors.length > 0) throw new TransactionValidationError(errors);

  const existing = input.id ? d.transactions.find((t) => t.id === input.id) : undefined;
  if (existing && isMirror(existing)) {
    throw new Error('Mirror transactions must be edited via their origin');
  }
  const id = existing?.id ?? input.id ?? uuidv7();
  const hasCounter = input.splits.some((s) => s.counterAccountId);

  const tx: Transaction = {
    id,
    accountId: input.accountId,
    date: input.date,
    amount: input.amount,
    payee: (input.payee ?? '').trim(),
    note: (input.note ?? '').trim(),
    tagIds: [...(input.tagIds ?? [])],
    attachmentIds: [...(input.attachmentIds ?? existing?.attachmentIds ?? [])],
    ...(hasCounter ? { transferId: id } : {}),
    ...(input.refundOfId ? { refundOfId: input.refundOfId } : {}),
    ...(input.recurringId ? { recurringId: input.recurringId } : {}),
    ...((input.importHash ?? existing?.importHash)
      ? { importHash: input.importHash ?? existing?.importHash }
      : {}),
  };

  // alte Splits und Spiegel entfernen
  removeMirrors(d, id);
  d.splits = d.splits.filter((s) => s.transactionId !== id);

  if (existing) {
    const i = d.transactions.findIndex((t) => t.id === id);
    d.transactions[i] = tx;
  } else {
    d.transactions.push(tx);
  }

  for (const s of input.splits) {
    const split: Split = {
      id: uuidv7(),
      transactionId: id,
      amount: s.amount,
      note: (s.note ?? '').trim(),
      ...(s.categoryId ? { categoryId: s.categoryId } : {}),
      ...(s.counterAccountId ? { counterAccountId: s.counterAccountId } : {}),
      ...(s.potId ? { potId: s.potId } : {}),
    };
    d.splits.push(split);
    if (s.counterAccountId) {
      const mirrorId = uuidv7();
      d.transactions.push({
        id: mirrorId,
        accountId: s.counterAccountId,
        date: tx.date,
        amount: -s.amount,
        payee: tx.payee,
        note: split.note || tx.note,
        transferId: id,
        tagIds: [],
        attachmentIds: [],
      });
      d.splits.push({
        id: uuidv7(),
        transactionId: mirrorId,
        counterAccountId: tx.accountId,
        amount: -s.amount,
        note: '',
      });
    }
  }
  return tx;
}

/** Löscht eine Buchung samt Splits und Gegenbuchungen (auch wenn ein Spiegel übergeben wird). */
export function deleteTransaction(d: Dataset, txId: Id): void {
  const tx = d.transactions.find((t) => t.id === txId);
  if (!tx) return;
  const origin = originOf(d, tx);
  removeMirrors(d, origin.id);
  d.transactions = d.transactions.filter((t) => t.id !== origin.id);
  d.splits = d.splits.filter((s) => s.transactionId !== origin.id);
  // Beleg-Metadaten entfernen (die Bytes räumt die Sitzung auf)
  d.attachments = d.attachments.filter((a) => a.transactionId !== origin.id);
  // Verweise von Rückerstattungen lösen
  for (const t of d.transactions) if (t.refundOfId === origin.id) delete t.refundOfId;
}

/** Wandelt eine gespeicherte Buchung zurück in ein Eingabeobjekt (für Formulare). */
export function toInput(d: Dataset, tx: Transaction): TransactionInput {
  const origin = originOf(d, tx);
  return {
    id: origin.id,
    accountId: origin.accountId,
    date: origin.date,
    amount: origin.amount,
    payee: origin.payee,
    note: origin.note,
    tagIds: [...origin.tagIds],
    attachmentIds: [...origin.attachmentIds],
    ...(origin.refundOfId ? { refundOfId: origin.refundOfId } : {}),
    ...(origin.recurringId ? { recurringId: origin.recurringId } : {}),
    ...(origin.importHash ? { importHash: origin.importHash } : {}),
    splits: splitsOf(d, origin.id).map((s) => ({
      amount: s.amount,
      note: s.note,
      ...(s.categoryId ? { categoryId: s.categoryId } : {}),
      ...(s.counterAccountId ? { counterAccountId: s.counterAccountId } : {}),
      ...(s.potId ? { potId: s.potId } : {}),
    })),
  };
}

export type TxKind = 'expense' | 'income' | 'transfer' | 'mixed' | 'uncategorized';

/** Grobe Art einer Buchung für Anzeige und Filter. */
export function transactionKind(d: Dataset, tx: Transaction): TxKind {
  const splits = splitsOf(d, tx.id);
  if (splits.length === 0) return 'uncategorized';
  const hasCounter = splits.some((s) => s.counterAccountId);
  const cats = splits.filter((s) => s.categoryId);
  if (hasCounter && cats.length === 0) return 'transfer';
  if (hasCounter) return 'mixed';
  const kinds = new Set(cats.map((s) => d.categories.find((c) => c.id === s.categoryId)?.kind));
  if (kinds.size === 1 && kinds.has('income')) return 'income';
  if (kinds.size === 1 && kinds.has('expense')) return 'expense';
  return 'mixed';
}

export interface TransactionFilter {
  text?: string;
  accountId?: Id;
  categoryId?: Id;
  tagId?: Id;
  from?: IsoDate;
  to?: IsoDate;
  kind?: TxKind;
}

/** Filtert und sortiert Buchungen (neueste zuerst). */
export function filterTransactions(d: Dataset, f: TransactionFilter): Transaction[] {
  const text = f.text?.trim().toLowerCase();
  const catIds = f.categoryId
    ? new Set([
        f.categoryId,
        ...d.categories.filter((c) => c.parentId === f.categoryId).map((c) => c.id),
      ])
    : undefined;
  const splitsByTx = new Map<Id, Split[]>();
  for (const s of d.splits) {
    const l = splitsByTx.get(s.transactionId);
    if (l) l.push(s);
    else splitsByTx.set(s.transactionId, [s]);
  }
  const accountNames = new Map(d.accounts.map((a) => [a.id, a.name.toLowerCase()]));
  const catNames = new Map(d.categories.map((c) => [c.id, c.name.toLowerCase()]));
  return d.transactions
    .filter((tx) => {
      if (f.accountId && tx.accountId !== f.accountId) return false;
      if (f.from && tx.date < f.from) return false;
      if (f.to && tx.date > f.to) return false;
      if (f.tagId && !tx.tagIds.includes(f.tagId)) return false;
      const splits = splitsByTx.get(tx.id) ?? [];
      if (catIds && !splits.some((s) => s.categoryId && catIds.has(s.categoryId))) return false;
      if (f.kind && transactionKind(d, tx) !== f.kind) return false;
      if (text) {
        const amountStr = (Math.abs(tx.amount) / 100).toFixed(2);
        const hay = [
          tx.payee,
          tx.note,
          amountStr,
          accountNames.get(tx.accountId) ?? '',
          ...splits.map((s) => (s.categoryId ? (catNames.get(s.categoryId) ?? '') : s.note)),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    })
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
}
