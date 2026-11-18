/**
 * Geteilte Kosten: Personen (Mitbewohner usw.) sind Konten vom Typ `person`.
 *
 * - Saldo > 0: die Person schuldet mir Geld.
 * - Saldo < 0: ich schulde der Person Geld.
 *
 * Ich zahle für alle: Ausgabe = mein Anteil, die Anteile der anderen sind
 * Umbuchungen auf deren Personenkonten.
 * Eine Person zahlt für mich: Buchung auf ihrem Konto, nur mein Anteil als Ausgabe.
 * Ausgleich: Umbuchung zwischen Personenkonto und meinem Konto (z. B. Twint).
 */
import { accountBalances } from './balances';
import { saveTransaction, type SplitInput } from './transactions';
import type { Dataset, Id, IsoDate, Money, Transaction } from './types';

/** Teilt einen Betrag exakt auf n Anteile; Rest-Rappen gehen an die ersten Anteile. */
export function splitEqually(total: Money, n: number): Money[] {
  if (n <= 0) return [];
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const rest = abs - base * n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < rest ? 1 : 0)));
}

/** Teilt nach Gewichten (z. B. 2:1:1) exakt auf; Rest an den grössten Anteil. */
export function splitByWeights(total: Money, weights: number[]): Money[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (sum <= 0) return splitEqually(total, weights.length);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const shares = weights.map((w) => Math.floor((abs * Math.max(0, w)) / sum));
  const rest = abs - shares.reduce((a, b) => a + b, 0);
  let maxIdx = 0;
  weights.forEach((w, i) => {
    if (w > (weights[maxIdx] ?? 0)) maxIdx = i;
  });
  shares[maxIdx] = (shares[maxIdx] ?? 0) + rest;
  return shares.map((s) => sign * s);
}

export interface SharedExpenseInput {
  date: IsoDate;
  /** Gesamtbetrag (positiv). */
  total: Money;
  payee?: string;
  note?: string;
  categoryId: Id;
  /** Wer hat bezahlt: mein Konto (`me`) oder ein Personenkonto. */
  paidBy: { kind: 'me'; accountId: Id } | { kind: 'person'; personId: Id };
  /** Beteiligte Personen (ohne mich). */
  participants: Id[];
  /** Mache ich mit? (Sonst habe ich nur ausgelegt.) */
  includeMe: boolean;
  /** Optionale Gewichte: [ich, ...participants]. Standard: gleich. */
  weights?: number[];
}

export interface SharedShares {
  me: Money;
  others: { personId: Id; amount: Money }[];
}

export function sharedShares(input: SharedExpenseInput): SharedShares {
  const people = [...(input.includeMe ? ['__me__'] : []), ...input.participants];
  const weights = input.weights
    ? input.includeMe
      ? input.weights
      : input.weights.slice(1)
    : undefined;
  const shares = weights
    ? splitByWeights(input.total, weights)
    : splitEqually(input.total, people.length);
  const me = input.includeMe ? (shares[0] ?? 0) : 0;
  const offset = input.includeMe ? 1 : 0;
  return {
    me,
    others: input.participants.map((personId, i) => ({
      personId,
      amount: shares[i + offset] ?? 0,
    })),
  };
}

/** Erfasst eine geteilte Ausgabe als Buchung(en). */
export function saveSharedExpense(d: Dataset, input: SharedExpenseInput): Transaction[] {
  const { me, others } = sharedShares(input);
  const base = { date: input.date, payee: input.payee ?? '', note: input.note ?? '' };
  const out: Transaction[] = [];
  if (input.paidBy.kind === 'me') {
    const splits: SplitInput[] = [];
    if (me > 0) splits.push({ categoryId: input.categoryId, amount: -me });
    for (const o of others) {
      if (o.amount > 0) splits.push({ counterAccountId: o.personId, amount: -o.amount });
    }
    out.push(
      saveTransaction(d, {
        ...base,
        accountId: input.paidBy.accountId,
        amount: -input.total,
        splits,
      }),
    );
  } else {
    // Eine Person hat bezahlt: Ich schulde ihr meinen Anteil.
    const payer = input.paidBy.personId;
    if (me > 0) {
      out.push(
        saveTransaction(d, {
          ...base,
          accountId: payer,
          amount: -me,
          splits: [{ categoryId: input.categoryId, amount: -me }],
        }),
      );
    }
  }
  return out;
}

export interface PersonBalance {
  accountId: Id;
  name: string;
  /** > 0: schuldet mir; < 0: ich schulde. */
  balance: Money;
}

/** «Wer schuldet wem»: alle Personenkonten mit Saldo, grösste Beträge zuerst. */
export function whoOwesWhom(d: Dataset, includeZero = false): PersonBalance[] {
  const bal = accountBalances(d);
  return d.accounts
    .filter((a) => a.type === 'person' && (includeZero || (bal.get(a.id) ?? 0) !== 0))
    .map((a) => ({ accountId: a.id, name: a.name, balance: bal.get(a.id) ?? 0 }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
}

/**
 * Ausgleichsbuchung: bringt das Personenkonto auf 0 (oder um `amount`
 * näher an 0), Geld fliesst über `viaAccountId` (z. B. Twint).
 */
export function settlePerson(
  d: Dataset,
  personId: Id,
  viaAccountId: Id,
  date: IsoDate,
  amount?: Money,
  payee = '',
): Transaction | null {
  const balance = accountBalances(d).get(personId) ?? 0;
  if (balance === 0) return null;
  const abs = Math.min(Math.abs(balance), amount !== undefined ? Math.abs(amount) : Infinity);
  if (abs <= 0) return null;
  // Saldo > 0: Person zahlt mir → Abfluss vom Personenkonto auf mein Konto.
  const fromPerson = balance > 0;
  return saveTransaction(d, {
    accountId: fromPerson ? personId : viaAccountId,
    date,
    amount: -abs,
    payee,
    note: 'settle',
    splits: [{ counterAccountId: fromPerson ? viaAccountId : personId, amount: -abs }],
  });
}
