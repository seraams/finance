import type { IDBPDatabase } from 'idb';
import { openFinanzDb, type FinanzDb, type MetaValues } from './db';

/**
 * Unverschlüsselte Metadaten: Sprache, Theme (für den Sperrbildschirm) und
 * der Fehlversuchszähler. Enthält keine Finanzdaten.
 */
export class MetaStore {
  private dbPromise: Promise<IDBPDatabase<FinanzDb>>;

  constructor(dbName?: string) {
    this.dbPromise = openFinanzDb(dbName);
  }

  async get<K extends keyof MetaValues>(key: K): Promise<MetaValues[K] | undefined> {
    const db = await this.dbPromise;
    return (await db.get('meta', key)) as MetaValues[K] | undefined;
  }

  async set<K extends keyof MetaValues>(key: K, value: MetaValues[K]): Promise<void> {
    const db = await this.dbPromise;
    await db.put('meta', value, key);
  }
}
