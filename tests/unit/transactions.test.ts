import { describe, expect, it } from 'vitest';
import { accountBalance } from '../../src/lib/domain/balances';
import { deleteAccount, deleteCategory, saveTag } from '../../src/lib/domain/entities';
import {
  deleteTransaction,
  filterTransactions,
  originOf,
  saveTransaction,
  toInput,
  transactionKind,
  validateTransaction,
  TransactionValidationError,
} from '../../src/lib/domain/transactions';
import { cat, setup } from './helpers';

describe('Buchungen', () => {
  it('creates a simple expense', () => {
    const { d, priv } = setup();
    const tx = saveTransaction(d, {
      accountId: priv,
      date: '2026-02-01',
      amount: -2550,
      payee: ' Coop ',
      splits: [{ categoryId: cat(d, 'Lebensmittel'), amount: -2550 }],
    });
    expect(tx.payee).toBe('Coop');
    expect(d.splits.filter((s) => s.transactionId === tx.id)).toHaveLength(1);
    expect(transactionKind(d, tx)).toBe('expense');
    expect(accountBalance(d, priv)).toBe(100000 - 2550);
  });

  it('validates split sums and targets', () => {
    const { d, priv } = setup();
    const base = { accountId: priv, date: '2026-02-01', amount: -1000 };
    expect(
      validateTransaction(d, { ...base, splits: [{ categoryId: cat(d, 'Miete'), amount: -900 }] }),
    ).toContain('split-sum-mismatch');
    expect(validateTransaction(d, { ...base, splits: [{ amount: -1000 }] })).toContain(
      'split-target-missing',
    );
    expect(
      validateTransaction(d, { ...base, splits: [{ counterAccountId: priv, amount: -1000 }] }),
    ).toContain('split-self-transfer');
    expect(validateTransaction(d, { ...base, amount: 0, splits: [] })).toContain('amount-invalid');
    expect(validateTransaction(d, { ...base, date: '2026-02-30', splits: [] })).toContain(
      'date-invalid',
    );
    expect(() => saveTransaction(d, { ...base, amount: 10.5, splits: [] })).toThrow(
      TransactionValidationError,
    );
  });

  it('creates mirrored transactions for transfers and keeps them in sync', () => {
    const { d, priv, savings } = setup();
    const tx = saveTransaction(d, {
      accountId: priv,
      date: '2026-02-01',
      amount: -50000,
      splits: [{ counterAccountId: savings, amount: -50000 }],
    });
    expect(tx.transferId).toBe(tx.id);
    const mirror = d.transactions.find((t) => t.transferId === tx.id && t.id !== tx.id)!;
    expect(mirror.accountId).toBe(savings);
    expect(mirror.amount).toBe(50000);
    expect(originOf(d, mirror).id).toBe(tx.id);
    expect(transactionKind(d, tx)).toBe('transfer');

    // Bearbeiten über den Ursprung
    const input = toInput(d, mirror);
    input.amount = -60000;
    input.splits[0]!.amount = -60000;
    saveTransaction(d, input);
    expect(accountBalance(d, savings)).toBe(560000);
    expect(d.transactions.filter((t) => t.transferId === tx.id)).toHaveLength(2);

    // Löschen über den Spiegel löscht beide
    const m2 = d.transactions.find((t) => t.transferId === tx.id && t.id !== tx.id)!;
    deleteTransaction(d, m2.id);
    expect(d.transactions).toHaveLength(0);
    expect(d.splits).toHaveLength(0);
  });

  it('models shared costs: 90 CHF zu dritt → 30 Ausgabe, 60 Umbuchung', () => {
    const { d, priv, roommate } = setup();
    const tx = saveTransaction(d, {
      accountId: priv,
      date: '2026-02-01',
      amount: -9000,
      splits: [
        { categoryId: cat(d, 'Lebensmittel'), amount: -3000 },
        { counterAccountId: roommate, amount: -6000 },
      ],
    });
    expect(transactionKind(d, tx)).toBe('mixed');
    expect(accountBalance(d, roommate)).toBe(6000);
    // Rückzahlung per Twint: Umbuchung, kein Einkommen
    saveTransaction(d, {
      accountId: roommate,
      date: '2026-02-03',
      amount: -6000,
      splits: [{ counterAccountId: priv, amount: -6000 }],
    });
    expect(accountBalance(d, roommate)).toBe(0);
    expect(accountBalance(d, priv)).toBe(100000 - 3000);
  });

  it('rejects editing a mirror directly', () => {
    const { d, priv, savings } = setup();
    const tx = saveTransaction(d, {
      accountId: priv,
      date: '2026-02-01',
      amount: -100,
      splits: [{ counterAccountId: savings, amount: -100 }],
    });
    const mirror = d.transactions.find((t) => t.transferId === tx.id && t.id !== tx.id)!;
    expect(() =>
      saveTransaction(d, {
        id: mirror.id,
        accountId: savings,
        date: '2026-02-01',
        amount: 100,
        splits: [],
      }),
    ).toThrow();
  });

  it('filters and searches', () => {
    const { d, priv, savings } = setup();
    const tag = saveTag(d, 'Ferien');
    saveTransaction(d, {
      accountId: priv,
      date: '2026-02-01',
      amount: -2000,
      payee: 'Migros Bern',
      splits: [{ categoryId: cat(d, 'Lebensmittel'), amount: -2000 }],
    });
    saveTransaction(d, {
      accountId: priv,
      date: '2026-03-01',
      amount: -9900,
      payee: 'SBB',
      tagIds: [tag.id],
      splits: [{ categoryId: cat(d, 'ÖV'), amount: -9900 }],
    });
    saveTransaction(d, {
      accountId: savings,
      date: '2026-03-02',
      amount: 1000,
      payee: 'Zins',
      splits: [],
    });
    expect(filterTransactions(d, { text: 'migros' })).toHaveLength(1);
    expect(filterTransactions(d, { text: '99.00' })).toHaveLength(1);
    expect(filterTransactions(d, { categoryId: cat(d, 'Essen') })).toHaveLength(1);
    expect(filterTransactions(d, { accountId: savings })).toHaveLength(1);
    expect(filterTransactions(d, { tagId: tag.id })).toHaveLength(1);
    expect(filterTransactions(d, { from: '2026-03-01' })).toHaveLength(2);
    expect(filterTransactions(d, { kind: 'uncategorized' })).toHaveLength(1);
    const all = filterTransactions(d, {});
    expect(all.map((t) => t.date)).toEqual(['2026-03-02', '2026-03-01', '2026-02-01']);
  });

  it('deleting a category leaves the amount uncategorized', () => {
    const { d, priv } = setup();
    const tx = saveTransaction(d, {
      accountId: priv,
      date: '2026-02-01',
      amount: -2000,
      splits: [{ categoryId: cat(d, 'Kleidung'), amount: -2000 }],
    });
    deleteCategory(d, cat(d, 'Kleidung'));
    expect(transactionKind(d, tx)).toBe('uncategorized');
    expect(() => deleteCategory(d, cat(d, 'Essen'))).toThrow();
  });

  it('deleting an account with force removes its transactions and mirrors', () => {
    const { d, priv, savings } = setup();
    saveTransaction(d, {
      accountId: priv,
      date: '2026-02-01',
      amount: -100,
      splits: [{ counterAccountId: savings, amount: -100 }],
    });
    expect(() => deleteAccount(d, savings)).toThrow();
    deleteAccount(d, savings, true);
    expect(d.transactions).toHaveLength(0);
    expect(d.accounts.some((a) => a.id === savings)).toBe(false);
  });
});
