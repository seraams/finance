/**
 * Lokaler, verschlüsselter Speicher in IndexedDB.
 *
 * - Der gesamte Datenbestand wird als JSON serialisiert, mit AES-GCM
 *   verschlüsselt (neuer IV bei jedem Speichern) und als ein Blob abgelegt.
 * - Belege werden einzeln verschlüsselt und separat gespeichert.
 * - Der Schlüssel existiert nur im Arbeitsspeicher (nicht exportierbar).
 */
import type { IDBPDatabase } from 'idb';
import {
  decryptBytes,
  decryptJson,
  deriveKey,
  encryptBytes,
  encryptJson,
  newKdfParams,
  PBKDF2_ITERATIONS,
  type KdfParams,
} from '../crypto/crypto';
import type { Dataset, Id } from '../domain/types';
import { createBackup } from './backup';
import { openFinanzDb, type FinanzDb, type VaultRecord } from './db';
import { migrate } from './migrations';
import type { Repository } from './repository';

export class LockedError extends Error {
  constructor() {
    super('Repository is locked');
  }
}

export interface EncryptedIndexedDbOptions {
  dbName?: string;
  /** Nur für Tests: weniger Iterationen. Produktion: 600'000. */
  iterations?: number;
}

export class EncryptedIndexedDbRepository implements Repository {
  private dbPromise: Promise<IDBPDatabase<FinanzDb>>;
  private key: CryptoKey | null = null;
  private kdf: KdfParams | null = null;
  private readonly iterations: number;
  private readonly dbName: string | undefined;
  /** Serialisiert Schreibvorgänge, damit kein älterer Stand einen neueren überschreibt. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: EncryptedIndexedDbOptions = {}) {
    this.dbName = opts.dbName;
    this.iterations = opts.iterations ?? PBKDF2_ITERATIONS;
    this.dbPromise = openFinanzDb(opts.dbName);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private requireKey(): CryptoKey {
    if (!this.key) throw new LockedError();
    return this.key;
  }

  async isInitialized(): Promise<boolean> {
    const db = await this.dbPromise;
    return (await db.get('vault', 'main')) !== undefined;
  }

  async create(passphrase: string, data: Dataset): Promise<void> {
    if (await this.isInitialized()) throw new Error('Already initialized');
    const kdf = newKdfParams(this.iterations);
    const key = await deriveKey(passphrase, kdf);
    const blob = await encryptJson(key, data);
    const db = await this.dbPromise;
    await db.put('vault', { envelopeVersion: 1, kdf, ...blob }, 'main');
    this.key = key;
    this.kdf = kdf;
  }

  async unlock(passphrase: string): Promise<Dataset> {
    const db = await this.dbPromise;
    const rec = await db.get('vault', 'main');
    if (!rec) throw new Error('Not initialized');
    const key = await deriveKey(passphrase, rec.kdf);
    const raw = await decryptJson<unknown>(key, rec); // wirft WrongPassphraseError
    this.key = key;
    this.kdf = rec.kdf;
    return migrate(raw);
  }

  isUnlocked(): boolean {
    return this.key !== null;
  }

  async save(data: Dataset): Promise<void> {
    const key = this.requireKey();
    const kdf = this.kdf!;
    // Serialisieren sofort (Stand zum Zeitpunkt des Aufrufs), schreiben in Reihenfolge.
    const json = JSON.stringify(data);
    return this.enqueue(async () => {
      const blob = await encryptJson(key, JSON.parse(json));
      const db = await this.dbPromise;
      await db.put('vault', { envelopeVersion: 1, kdf, ...blob } satisfies VaultRecord, 'main');
    });
  }

  lock(): void {
    this.key = null;
    this.kdf = null;
  }

  changePassphrase(current: string, next: string, data: Dataset): Promise<void> {
    return this.enqueue(async () => {
      const db = await this.dbPromise;
      const rec = await db.get('vault', 'main');
      if (!rec) throw new Error('Not initialized');
      const oldKey = await deriveKey(current, rec.kdf);
      await decryptJson(oldKey, rec); // prüft die aktuelle Passphrase
      const kdf = newKdfParams(this.iterations);
      const newKey = await deriveKey(next, kdf);

      // Erst alles entschlüsseln und neu verschlüsseln, dann atomar schreiben.
      const ids = await db.getAllKeys('attachments');
      const reencrypted = [];
      for (const id of ids) {
        const old = await db.get('attachments', id);
        if (!old) continue;
        const bytes = await decryptBytes(oldKey, old);
        reencrypted.push({ id, blob: await encryptBytes(newKey, bytes) });
      }
      const vault = await encryptJson(newKey, data);
      const tx = db.transaction(['vault', 'attachments'], 'readwrite');
      await tx.objectStore('vault').put({ envelopeVersion: 1, kdf, ...vault }, 'main');
      for (const r of reencrypted) await tx.objectStore('attachments').put(r.blob, r.id);
      await tx.done;
      this.key = newKey;
      this.kdf = kdf;
    });
  }

  async putAttachment(id: Id, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const blob = await encryptBytes(this.requireKey(), bytes);
    const db = await this.dbPromise;
    await db.put('attachments', blob, id);
  }

  async getAttachment(id: Id): Promise<Uint8Array<ArrayBuffer> | null> {
    const key = this.requireKey();
    const db = await this.dbPromise;
    const blob = await db.get('attachments', id);
    return blob ? decryptBytes(key, blob) : null;
  }

  async deleteAttachment(id: Id): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('attachments', id);
  }

  async listAttachmentIds(): Promise<Id[]> {
    const db = await this.dbPromise;
    return db.getAllKeys('attachments');
  }

  async replaceAll(data: Dataset, attachments: Map<Id, Uint8Array<ArrayBuffer>>): Promise<void> {
    const key = this.requireKey();
    const kdf = this.kdf!;
    return this.enqueue(async () => {
      const encrypted = [];
      for (const [id, bytes] of attachments) {
        encrypted.push({ id, blob: await encryptBytes(key, bytes) });
      }
      const vault = await encryptJson(key, data);
      const db = await this.dbPromise;
      const tx = db.transaction(['vault', 'attachments'], 'readwrite');
      await tx.objectStore('attachments').clear();
      for (const e of encrypted) await tx.objectStore('attachments').put(e.blob, e.id);
      await tx.objectStore('vault').put({ envelopeVersion: 1, kdf, ...vault }, 'main');
      await tx.done;
    });
  }

  async exportBackup(data: Dataset): Promise<string> {
    const key = this.requireKey();
    const attachments = new Map<Id, Uint8Array>();
    for (const id of await this.listAttachmentIds()) {
      const bytes = await this.getAttachment(id);
      if (bytes) attachments.set(id, bytes);
    }
    return createBackup(key, this.kdf!, data, attachments);
  }

  async destroy(): Promise<void> {
    this.lock();
    const db = await this.dbPromise;
    const tx = db.transaction(['vault', 'attachments', 'meta'], 'readwrite');
    await tx.objectStore('vault').clear();
    await tx.objectStore('attachments').clear();
    await tx.objectStore('meta').clear();
    await tx.done;
  }

  /** Nur für Tests: Rohdaten des Tresors lesen. */
  async rawVault(): Promise<VaultRecord | undefined> {
    const db = await this.dbPromise;
    return db.get('vault', 'main');
  }

  get databaseName(): string | undefined {
    return this.dbName;
  }
}
