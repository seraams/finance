/**
 * Invariante: Summe der Salden aller budgetrelevanten Konten
 *           = Summe aller Töpfe (Puffer + Monatsbudget + Sparziele + Rücklagen).
 *
 * Eine Differenz wird als «nicht zugeordnet» angezeigt und muss verteilt werden.
 */
import { accountBalances, findPot, potBalances } from './balances';
import { uuidv7 } from './ids';
import type { Dataset, Id, IsoDate, Money, PotMove } from './types';

export interface InvariantResult {
  accountsTotal: Money;
  potsTotal: Money;
  /** accountsTotal − potsTotal. Positiv: Geld ohne Topf; negativ: Töpfe ohne Deckung. */
  unassigned: Money;
  ok: boolean;
}

export function checkInvariant(d: Dataset, asOf?: IsoDate): InvariantResult {
  const accBal = accountBalances(d, asOf);
  let accountsTotal = 0;
  for (const a of d.accounts) {
    if (a.budgetRelevant) accountsTotal += accBal.get(a.id) ?? 0;
  }
  let potsTotal = 0;
  for (const v of potBalances(d, asOf).values()) potsTotal += v;
  const unassigned = accountsTotal - potsTotal;
  return { accountsTotal, potsTotal, unassigned, ok: unassigned === 0 };
}

/**
 * Verteilt den nicht zugeordneten Betrag in einen Topf (Standard: Puffer).
 * Ein negativer Betrag wird aus dem Topf entnommen.
 * Gibt die erzeugte Topfbewegung zurück (oder `null`, wenn nichts zu tun ist).
 */
export function assignUnassigned(d: Dataset, date: IsoDate, potId?: Id): PotMove | null {
  const { unassigned } = checkInvariant(d);
  if (unassigned === 0) return null;
  const target = potId ?? findPot(d, 'buffer')?.id;
  if (!target) return null;
  const move: PotMove = {
    id: uuidv7(),
    date,
    amount: Math.abs(unassigned),
    reason: 'manual',
    note: 'unassigned',
    ...(unassigned > 0 ? { toPotId: target } : { fromPotId: target }),
  };
  d.potMoves.push(move);
  return move;
}
