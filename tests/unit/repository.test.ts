import { beforeEach, describe, expect, it } from 'vitest';
import { WrongPassphraseError } from '../../src/lib/crypto/crypto';
import { createEmptyDataset } from '../../src/lib/domain/defaults';
import { saveAccount } from '../../src/lib/domain/entities';
import { EncryptedIndexedDbRepository, LockedError } from '../../src/lib/storage/encrypted-idb';
import {
  plainJsonExport,
  readEncryptedBackup,
  readPlainJson,
  transactionsCsv,
} from '../../src/lib/storage/backup';
import { MetaStore } from '../../src/lib/storage/meta';
import { migrate, UnsupportedFormatError } from '../../src/lib/storage/migrations';
import { saveTransaction } from '../../src/lib/domain/transactions';

let n = 0;
function repo() {
  return new EncryptedIndexedDbRepository({ dbName: `test-${++n}`, iterations: 1000 });
}

function sample() {
  const d = createEmptyDataset('de');
  const acc = saveAccount(d, {
    name: 'Privatkonto',
    type: 'private',
    openingBalance: 123450,
    openingDate: '2026-01-01',
  });
  saveTransaction(d, {
    accountId: acc.id,
    date: '2026-01-02',
    amount: -4590,
    payee: 'Bäckerei Erfunden',
    splits: [],
  });
  return d;
}

describe('EncryptedIndexedDbRepository', () => {
  let r: EncryptedIndexedDbRepository;
  beforeEach(() => {
    r = repo();
  });

  it('stores only ciphertext', async () => {
    expect(await r.isInitialized()).toBe(false);
    await r.create('meine geheime passphrase', sample());
    const raw = JSON.stringify(await r.rawVault());
    expect(raw).not.toContain('Privatkonto');
    expect(raw).not.toContain('Bäckerei');
    expect(raw).not.toContain('123450');
    expect(await r.isInitialized()).toBe(true);
  });

  it('save → lock → unlock round trip', async () => {
    const d = sample();
    await r.create('meine geheime passphrase', d);
    d.settings.salary = 300000;
    await r.save(d);
    r.lock();
    expect(r.isUnlocked()).toBe(false);
    await expect(r.save(d)).rejects.toBeInstanceOf(LockedError);
    const loaded = await r.unlock('meine geheime passphrase');
    expect(loaded.settings.salary).toBe(300000);
    expect(loaded.transactions[0]!.payee).toBe('Bäckerei Erfunden');
  });

  it('rejects a wrong passphrase', async () => {
    await r.create('richtig richtig', sample());
    r.lock();
    await expect(r.unlock('falsch falsch')).rejects.toBeInstanceOf(WrongPassphraseError);
    expect(r.isUnlocked()).toBe(false);
  });

  it('uses a new IV on every save', async () => {
    const d = sample();
    await r.create('passphrase passphrase', d);
    const a = await r.rawVault();
    await r.save(d);
    const b = await r.rawVault();
    expect(a!.iv).not.toBe(b!.iv);
    expect(a!.kdf.salt).toBe(b!.kdf.salt);
  });

  it('serializes concurrent saves in order', async () => {
    const d = sample();
    await r.create('passphrase passphrase', d);
    const saves = [];
    for (let i = 1; i <= 10; i++) {
      d.settings.salary = i;
      saves.push(r.save(d));
    }
    await Promise.all(saves);
    r.lock();
    expect((await r.unlock('passphrase passphrase')).settings.salary).toBe(10);
  });

  it('encrypts attachments separately and re-encrypts on passphrase change', async () => {
    const d = sample();
    await r.create('alte passphrase', d);
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await r.putAttachment('att-1', bytes);
    expect(await r.getAttachment('att-1')).toEqual(bytes);
    await r.changePassphrase('alte passphrase', 'neue passphrase', d);
    r.lock();
    await expect(r.unlock('alte passphrase')).rejects.toBeInstanceOf(WrongPassphraseError);
    await r.unlock('neue passphrase');
    expect(await r.getAttachment('att-1')).toEqual(bytes);
  });

  it('refuses to change the passphrase with a wrong current passphrase', async () => {
    const d = sample();
    await r.create('alte passphrase', d);
    await expect(r.changePassphrase('falsch', 'neu neu neu', d)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
    r.lock();
    await r.unlock('alte passphrase');
  });

  it('exports an encrypted backup that can be restored with the passphrase', async () => {
    const d = sample();
    await r.create('backup passphrase', d);
    await r.putAttachment('att-1', new Uint8Array([9, 8, 7]));
    const file = await r.exportBackup(d);
    expect(file).not.toContain('Bäckerei');
    const restored = await readEncryptedBackup(file, 'backup passphrase');
    expect(restored.dataset.transactions[0]!.payee).toBe('Bäckerei Erfunden');
    expect(restored.attachments.get('att-1')).toEqual(new Uint8Array([9, 8, 7]));
    await expect(readEncryptedBackup(file, 'falsch')).rejects.toBeInstanceOf(WrongPassphraseError);

    const other = repo();
    await other.create('andere passphrase', createEmptyDataset());
    await other.replaceAll(restored.dataset, restored.attachments);
    other.lock();
    const loaded = await other.unlock('andere passphrase');
    expect(loaded.accounts[0]!.name).toBe('Privatkonto');
    expect(await other.getAttachment('att-1')).toEqual(new Uint8Array([9, 8, 7]));
  });

  it('destroy wipes everything', async () => {
    await r.create('passphrase passphrase', sample());
    await r.destroy();
    expect(await r.isInitialized()).toBe(false);
  });
});

describe('MetaStore', () => {
  it('stores non-sensitive prefs', async () => {
    const m = new MetaStore(`meta-${++n}`);
    expect(await m.get('prefs')).toBeUndefined();
    await m.set('prefs', { language: 'en', theme: 'dark' });
    expect(await m.get('prefs')).toEqual({ language: 'en', theme: 'dark' });
  });
});

describe('Klartext-Export und Migrationen', () => {
  it('plain JSON round trip', () => {
    const d = sample();
    const back = readPlainJson(plainJsonExport(d));
    expect(back).toEqual(d);
  });

  it('CSV export has one line per split and escapes formulas', () => {
    const d = sample();
    d.transactions[0]!.payee = '=HYPERLINK("x")';
    const csv = transactionsCsv(d);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('date;account;amount');
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[1]).toContain('-45.90');
  });

  it('migrates version 0 data and ensures required pots', () => {
    const migrated = migrate({ accounts: [{ id: 'a', name: 'X', type: 'cash' }], settings: {} });
    expect(migrated.formatVersion).toBe(1);
    expect(migrated.transactions).toEqual([]);
    expect(migrated.accounts[0]!.openingBalance).toBe(0);
    expect(migrated.pots.map((p) => p.kind)).toEqual(['buffer', 'monthly']);
    expect(migrated.settings.bufferMonths).toBe(5);
  });

  it('rejects newer formats', () => {
    expect(() => migrate({ formatVersion: 999 })).toThrow(UnsupportedFormatError);
  });
});
