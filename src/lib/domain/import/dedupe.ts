/**
 * Duplikaterkennung beim Bank-Import.
 *
 * Schlüssel: Bankreferenz (falls vorhanden), sonst Konto + Datum + Betrag + Text.
 * Kommt derselbe Schlüssel in einer Datei mehrfach vor (zwei gleiche Kaffees am
 * selben Tag), wird die n-te Wiederholung mitgezählt, damit echte
 * Mehrfachbuchungen nicht als Duplikat gelten.
 */
import type { Dataset, Id } from '../types';
import type { ImportedRow } from './csv';

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** FNV-1a (32 Bit) als kompakter, nicht-kryptografischer Hash. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function baseKey(
  accountId: Id,
  row: Pick<ImportedRow, 'date' | 'amount' | 'payee' | 'note' | 'reference'>,
): string {
  if (row.reference) return `ref|${accountId}|${row.reference}`;
  return `txt|${accountId}|${row.date}|${row.amount}|${normalizeText(`${row.payee} ${row.note}`)}`;
}

export function importHash(base: string, occurrence: number): string {
  return `${fnv1a(base)}${fnv1a(`${base}#`)}-${occurrence}`;
}

export interface DedupeResult<T> {
  row: T;
  hash: string;
  duplicate: boolean;
}

/**
 * Berechnet die Hashes der Zeilen und markiert Duplikate gegenüber dem Bestand.
 */
export function markDuplicates<T extends ImportedRow>(
  d: Dataset,
  accountId: Id,
  rows: T[],
): DedupeResult<T>[] {
  const existing = new Set(
    d.transactions
      .filter((t) => t.accountId === accountId && t.importHash)
      .map((t) => t.importHash!),
  );
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = baseKey(accountId, row);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const hash = importHash(base, n);
    return { row, hash, duplicate: existing.has(hash) };
  });
}
