import type { Dataset, Id } from '../domain/types';

/**
 * Speicherschnittstelle. Die UI kennt nur dieses Interface.
 *
 * Erste Umsetzung: `EncryptedIndexedDbRepository` (lokal, verschlüsselt).
 * Später möglich: `HttpRepository` für ein eigenes Backend.
 */
export interface Repository {
  /** Existiert bereits ein (verschlüsselter) Datenbestand? */
  isInitialized(): Promise<boolean>;
  /** Legt einen neuen Datenbestand mit Passphrase an und entsperrt ihn. */
  create(passphrase: string, data: Dataset): Promise<void>;
  /** Entsperrt und lädt den Datenbestand. Wirft `WrongPassphraseError`. */
  unlock(passphrase: string): Promise<Dataset>;
  isUnlocked(): boolean;
  /** Speichert den gesamten Datenbestand (verschlüsselt). */
  save(data: Dataset): Promise<void>;
  /** Vergisst den Schlüssel. */
  lock(): void;
  /** Verschlüsselt alles mit einem neuen Schlüssel. */
  changePassphrase(current: string, next: string, data: Dataset): Promise<void>;

  putAttachment(id: Id, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  getAttachment(id: Id): Promise<Uint8Array<ArrayBuffer> | null>;
  deleteAttachment(id: Id): Promise<void>;
  listAttachmentIds(): Promise<Id[]>;

  /** Ersetzt den gesamten Bestand inkl. Belege (z. B. beim Import). */
  replaceAll(data: Dataset, attachments: Map<Id, Uint8Array<ArrayBuffer>>): Promise<void>;
  /** Verschlüsselte Sicherung mit dem aktuellen Schlüssel. */
  exportBackup(data: Dataset): Promise<string>;
  /** Löscht alle lokalen Daten unwiderruflich. */
  destroy(): Promise<void>;
}
