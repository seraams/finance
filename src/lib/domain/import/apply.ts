/**
 * Import-Vorschau und Übernahme in den Datenbestand.
 */
import { applyRules } from '../rules';
import { saveTransaction } from '../transactions';
import type { Dataset, Id } from '../types';
import type { ImportedRow } from './csv';
import { markDuplicates } from './dedupe';

export interface PreviewRow {
  row: ImportedRow;
  hash: string;
  duplicate: boolean;
  /** Vorschlag aus den Auto-Regeln; in der Vorschau änderbar. */
  categoryId?: Id;
  include: boolean;
}

export function buildPreview(d: Dataset, accountId: Id, rows: ImportedRow[]): PreviewRow[] {
  const valid = new Set(d.categories.filter((c) => !c.archived).map((c) => c.id));
  return markDuplicates(d, accountId, rows).map(({ row, hash, duplicate }) => {
    const categoryId = applyRules(d.rules, row, valid);
    return { row, hash, duplicate, include: !duplicate, ...(categoryId ? { categoryId } : {}) };
  });
}

/** Übernimmt die ausgewählten Zeilen als Buchungen. Gibt die Anzahl zurück. */
export function commitImport(d: Dataset, accountId: Id, preview: PreviewRow[]): number {
  const existing = new Set(
    d.transactions
      .filter((t) => t.accountId === accountId && t.importHash)
      .map((t) => t.importHash),
  );
  const valid = new Set(d.categories.map((c) => c.id));
  let n = 0;
  for (const p of preview) {
    if (!p.include || existing.has(p.hash)) continue;
    const cat = p.categoryId && valid.has(p.categoryId) ? p.categoryId : undefined;
    saveTransaction(d, {
      accountId,
      date: p.row.date,
      amount: p.row.amount,
      payee: p.row.payee,
      note: p.row.note,
      importHash: p.hash,
      splits: cat ? [{ categoryId: cat, amount: p.row.amount }] : [],
    });
    existing.add(p.hash);
    n++;
  }
  return n;
}
