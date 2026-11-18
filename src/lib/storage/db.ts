import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EncryptedBlob, KdfParams } from '../crypto/crypto';

/** Verschlüsselter Hauptdatensatz (ein Blob). */
export interface VaultRecord extends EncryptedBlob {
  envelopeVersion: 1;
  kdf: KdfParams;
}

/** Unverschlüsselte, nicht sensible Metadaten (siehe docs/SECURITY.md). */
export interface MetaValues {
  prefs: { language: 'de' | 'en'; theme: 'system' | 'light' | 'dark' };
  unlock: { failedAttempts: number; lockedUntil: number };
}

export interface FinanzDb extends DBSchema {
  vault: { key: 'main'; value: VaultRecord };
  attachments: { key: string; value: EncryptedBlob };
  meta: { key: keyof MetaValues; value: MetaValues[keyof MetaValues] };
}

export const DB_NAME = 'finanzplaner';
export const DB_VERSION = 1;

export function openFinanzDb(name = DB_NAME): Promise<IDBPDatabase<FinanzDb>> {
  return openDB<FinanzDb>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('vault');
        db.createObjectStore('attachments');
        db.createObjectStore('meta');
      }
    },
  });
}
