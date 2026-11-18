/**
 * Salden von Konten und Töpfen.
 *
 * Topf-Salden werden aus expliziten Topfbewegungen (`PotMove`) und aus
 * Buchungen *abgeleitet* (siehe docs/DECISIONS.md, «Abgeleitete Topfeffekte»):
 *
 * - Anfangssaldo eines budgetrelevanten Kontos → Puffer
 * - Einnahme-Split auf budgetrelevantem Konto → Puffer (oder `potId`)
 * - Ausgabe-Split auf budgetrelevantem Konto → Monatsbudget (oder `potId`)
 * - Umbuchung, die die Grenze budgetrelevant ↔ nicht budgetrelevant
 *   überschreitet (z. B. ins Depot) → `potId` (Standard: Puffer)
 * - Nicht aufgeteilter Rest einer Buchung (unkategorisiert):
 *   Abfluss → Monatsbudget, Zufluss → Puffer
 *
 * Gespiegelte Gegenbuchungen einer Umbuchung erzeugen keine Topfeffekte,
 * damit nichts doppelt gezählt wird.
 */
import type {
  Account,
  Category,
  Dataset,
  Id,
  IsoDate,
  Money,
  Pot,
  PotKind,
  PotMoveReason,
  Split,
  Transaction,
} from './types';

export function findPot(d: Dataset, kind: PotKind): Pot | undefined {
  return d.pots.find((p) => p.kind === kind);
}

export function isMirror(tx: Transaction): boolean {
  return tx.transferId !== undefined && tx.transferId !== tx.id;
}

export function isTransferOrigin(tx: Transaction): boolean {
  return tx.transferId !== undefined && tx.transferId === tx.id;
}

/** Index für schnelle Zugriffe; einmal pro Berechnung erstellen. */
export interface DatasetIndex {
  accounts: Map<Id, Account>;
  categories: Map<Id, Category>;
  pots: Map<Id, Pot>;
  splitsByTx: Map<Id, Split[]>;
  bufferId?: Id;
  monthlyId?: Id;
}

export function indexDataset(d: Dataset): DatasetIndex {
  const splitsByTx = new Map<Id, Split[]>();
  for (const s of d.splits) {
    const list = splitsByTx.get(s.transactionId);
    if (list) list.push(s);
    else splitsByTx.set(s.transactionId, [s]);
  }
  return {
    accounts: new Map(d.accounts.map((a) => [a.id, a])),
    categories: new Map(d.categories.map((c) => [c.id, c])),
    pots: new Map(d.pots.map((p) => [p.id, p])),
    splitsByTx,
    bufferId: findPot(d, 'buffer')?.id,
    monthlyId: findPot(d, 'monthly')?.id,
  };
}

/** Saldo eines Kontos per Datum (inklusiv). Ohne Datum: alle Buchungen. */
export function accountBalance(d: Dataset, accountId: Id, asOf?: IsoDate): Money {
  const acc = d.accounts.find((a) => a.id === accountId);
  if (!acc) return 0;
  let bal = !asOf || acc.openingDate <= asOf ? acc.openingBalance : 0;
  for (const tx of d.transactions) {
    if (tx.accountId === accountId && (!asOf || tx.date <= asOf)) bal += tx.amount;
  }
  return bal;
}

export function accountBalances(d: Dataset, asOf?: IsoDate): Map<Id, Money> {
  const out = new Map<Id, Money>();
  for (const a of d.accounts) out.set(a.id, !asOf || a.openingDate <= asOf ? a.openingBalance : 0);
  for (const tx of d.transactions) {
    if (asOf && tx.date > asOf) continue;
    if (out.has(tx.accountId)) out.set(tx.accountId, (out.get(tx.accountId) ?? 0) + tx.amount);
  }
  return out;
}

export interface PotEffect {
  potId: Id;
  amount: Money;
  date: IsoDate;
  reason: PotMoveReason | 'expense' | 'uncategorized';
  transactionId?: Id;
  splitId?: Id;
  potMoveId?: Id;
}

/** Topf, den ein Kategorie-Split standardmässig belastet. */
function defaultPotForCategory(idx: DatasetIndex, categoryId: Id | undefined, amount: Money) {
  const cat = categoryId ? idx.categories.get(categoryId) : undefined;
  if (!cat) return amount < 0 ? idx.monthlyId : idx.bufferId;
  return cat.kind === 'income' ? idx.bufferId : idx.monthlyId;
}

/** Alle Topfeffekte (explizit und abgeleitet) bis `asOf` (inklusiv). */
export function potEffects(d: Dataset, asOf?: IsoDate, idx = indexDataset(d)): PotEffect[] {
  const effects: PotEffect[] = [];
  const within = (date: IsoDate) => !asOf || date <= asOf;

  for (const a of d.accounts) {
    if (a.budgetRelevant && a.openingBalance !== 0 && within(a.openingDate) && idx.bufferId) {
      effects.push({
        potId: idx.bufferId,
        amount: a.openingBalance,
        date: a.openingDate,
        reason: 'opening',
      });
    }
  }

  for (const tx of d.transactions) {
    if (!within(tx.date) || isMirror(tx)) continue;
    const acc = idx.accounts.get(tx.accountId);
    if (!acc) continue;
    const splits = idx.splitsByTx.get(tx.id) ?? [];
    let covered = 0;
    for (const s of splits) {
      covered += s.amount;
      if (s.counterAccountId) {
        const counter = idx.accounts.get(s.counterAccountId);
        const counterBR = counter?.budgetRelevant ?? false;
        if (acc.budgetRelevant === counterBR) continue;
        // Raten auf Schuldkonten sind Budgetzeilen (Monatsbudget), alles andere
        // (z. B. Einzahlung ins Depot) kommt standardmässig aus dem Puffer.
        const otherSide = acc.budgetRelevant ? counter : acc;
        const potId =
          s.potId ?? (otherSide?.type === 'debt' ? idx.monthlyId : undefined) ?? idx.bufferId;
        if (!potId) continue;
        effects.push({
          potId,
          amount: acc.budgetRelevant ? s.amount : -s.amount,
          date: tx.date,
          reason: 'transfer',
          transactionId: tx.id,
          splitId: s.id,
        });
      } else if (acc.budgetRelevant) {
        const potId = s.potId ?? defaultPotForCategory(idx, s.categoryId, s.amount);
        if (!potId) continue;
        const cat = s.categoryId ? idx.categories.get(s.categoryId) : undefined;
        effects.push({
          potId,
          amount: s.amount,
          date: tx.date,
          reason: cat ? (cat.kind === 'income' ? 'income' : 'expense') : 'uncategorized',
          transactionId: tx.id,
          splitId: s.id,
        });
      }
    }
    const rest = tx.amount - covered;
    if (rest !== 0 && acc.budgetRelevant) {
      const potId = rest < 0 ? idx.monthlyId : idx.bufferId;
      if (potId) {
        effects.push({
          potId,
          amount: rest,
          date: tx.date,
          reason: 'uncategorized',
          transactionId: tx.id,
        });
      }
    }
  }

  for (const m of d.potMoves) {
    if (!within(m.date)) continue;
    if (m.fromPotId)
      effects.push({
        potId: m.fromPotId,
        amount: -m.amount,
        date: m.date,
        reason: m.reason,
        potMoveId: m.id,
      });
    if (m.toPotId)
      effects.push({
        potId: m.toPotId,
        amount: m.amount,
        date: m.date,
        reason: m.reason,
        potMoveId: m.id,
      });
  }
  return effects;
}

/** Salden aller Töpfe. Effekte auf nicht (mehr) existierende Töpfe werden ignoriert. */
export function potBalances(d: Dataset, asOf?: IsoDate): Map<Id, Money> {
  const idx = indexDataset(d);
  const out = new Map<Id, Money>(d.pots.map((p) => [p.id, 0]));
  for (const e of potEffects(d, asOf, idx)) {
    if (out.has(e.potId)) out.set(e.potId, (out.get(e.potId) ?? 0) + e.amount);
  }
  return out;
}

export function potBalance(d: Dataset, potId: Id, asOf?: IsoDate): Money {
  return potBalances(d, asOf).get(potId) ?? 0;
}

export function bufferBalance(d: Dataset, asOf?: IsoDate): Money {
  const id = findPot(d, 'buffer')?.id;
  return id ? potBalance(d, id, asOf) : 0;
}
