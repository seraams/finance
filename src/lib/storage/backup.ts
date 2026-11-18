/**
 * Sicherungsdateien:
 * - `.finanz`: verschlüsselt (PBKDF2 + AES-GCM), enthält Bestand und Belege.
 * - Klartext-JSON / CSV: nur nach ausdrücklicher Bestätigung in der UI.
 */
import {
  decryptJson,
  deriveKey,
  encryptJson,
  fromBase64,
  toBase64,
  type EncryptedBlob,
  type KdfParams,
} from '../crypto/crypto';
import { categoryLabel } from '../domain/entities';
import { moneyToInput } from '../domain/money';
import type { Dataset, Id } from '../domain/types';
import { migrate } from './migrations';

export const BACKUP_APP = 'finanzplaner';

export interface BackupFile extends EncryptedBlob {
  app: typeof BACKUP_APP;
  type: 'backup';
  envelopeVersion: 1;
  kdf: KdfParams;
}

interface BackupPayload {
  dataset: Dataset;
  /** Beleg-ID → Base64 */
  attachments: Record<Id, string>;
}

export async function createBackup(
  key: CryptoKey,
  kdf: KdfParams,
  dataset: Dataset,
  attachments: Map<Id, Uint8Array>,
): Promise<string> {
  const payload: BackupPayload = {
    dataset,
    attachments: Object.fromEntries([...attachments].map(([id, b]) => [id, toBase64(b)])),
  };
  const blob = await encryptJson(key, payload);
  const file: BackupFile = { app: BACKUP_APP, type: 'backup', envelopeVersion: 1, kdf, ...blob };
  return JSON.stringify(file);
}

export function isEncryptedBackup(value: unknown): value is BackupFile {
  const v = value as Partial<BackupFile> | null;
  return !!v && v.app === BACKUP_APP && v.type === 'backup' && typeof v.ciphertext === 'string';
}

export interface RestoredBackup {
  dataset: Dataset;
  attachments: Map<Id, Uint8Array<ArrayBuffer>>;
}

/** Entschlüsselt eine `.finanz`-Datei. Wirft `WrongPassphraseError`. */
export async function readEncryptedBackup(
  text: string,
  passphrase: string,
): Promise<RestoredBackup> {
  const file = JSON.parse(text) as unknown;
  if (!isEncryptedBackup(file)) throw new Error('Not a finanzplaner backup');
  const key = await deriveKey(passphrase, file.kdf);
  const payload = await decryptJson<BackupPayload>(key, file);
  return {
    dataset: migrate(payload.dataset),
    attachments: new Map(
      Object.entries(payload.attachments ?? {}).map(([id, b64]) => [id, fromBase64(b64)]),
    ),
  };
}

/** Klartext-JSON-Export (nach Bestätigung). */
export function plainJsonExport(d: Dataset): string {
  return JSON.stringify({ app: BACKUP_APP, type: 'plain', dataset: d }, null, 2);
}

/** Liest Klartext-JSON (eigener Export oder nackter Datenbestand). */
export function readPlainJson(text: string): Dataset {
  const parsed = JSON.parse(text) as { app?: string; type?: string; dataset?: unknown };
  if (parsed.app === BACKUP_APP && parsed.type === 'plain') return migrate(parsed.dataset);
  if (isEncryptedBackup(parsed)) throw new Error('Encrypted backup – passphrase required');
  return migrate(parsed);
}

function csvCell(v: string): string {
  // Formel-Injektion in Tabellenkalkulationen verhindern
  const safe = /^[=+\-@\t\r]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV-Export aller Buchungen, eine Zeile pro Split (Trennzeichen `;`). */
export function transactionsCsv(d: Dataset): string {
  const accounts = new Map(d.accounts.map((a) => [a.id, a.name]));
  const tags = new Map(d.tags.map((t) => [t.id, t.name]));
  const header = [
    'date',
    'account',
    'amount',
    'payee',
    'note',
    'split_amount',
    'category',
    'counter_account',
    'tags',
    'transaction_id',
  ];
  const rows: string[][] = [header];
  const sorted = [...d.transactions].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const tx of sorted) {
    const splits = d.splits.filter((s) => s.transactionId === tx.id);
    const base = [
      tx.date,
      accounts.get(tx.accountId) ?? '',
      moneyToInput(tx.amount),
      tx.payee,
      tx.note,
    ];
    const tagStr = tx.tagIds.map((t) => tags.get(t) ?? '').join(',');
    if (splits.length === 0) rows.push([...base, '', '', '', tagStr, tx.id]);
    for (const s of splits) {
      rows.push([
        ...base,
        moneyToInput(s.amount),
        categoryLabel(d, s.categoryId),
        s.counterAccountId ? (accounts.get(s.counterAccountId) ?? '') : '',
        tagStr,
        tx.id,
      ]);
    }
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
