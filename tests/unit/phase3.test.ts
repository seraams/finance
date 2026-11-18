import { describe, expect, it } from 'vitest';
import {
  addAttachment,
  fitWithin,
  orphanBlobIds,
  pruneAttachmentMeta,
  removeAttachment,
} from '../../src/lib/domain/attachments';
import { accountBalance, potBalances } from '../../src/lib/domain/balances';
import { categoryStatuses, monthOverview, paySalary, setBudget } from '../../src/lib/domain/budget';
import { debtStatus } from '../../src/lib/domain/debts';
import { saveAccount } from '../../src/lib/domain/entities';
import { computeHints } from '../../src/lib/domain/hints';
import { checkInvariant } from '../../src/lib/domain/invariant';
import { materializeDue, saveRecurring } from '../../src/lib/domain/recurring';
import { refundable, refundInput, refundsOf } from '../../src/lib/domain/refunds';
import {
  saveSharedExpense,
  settlePerson,
  sharedShares,
  splitByWeights,
  splitEqually,
  whoOwesWhom,
} from '../../src/lib/domain/shared';
import { expensesByCategory, monthlyFlows } from '../../src/lib/domain/stats';
import { deleteTransaction, saveTransaction } from '../../src/lib/domain/transactions';
import { cat, pot, setup } from './helpers';

describe('Geteilte Kosten', () => {
  it('splits exactly', () => {
    expect(splitEqually(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEqually(-100, 3)).toEqual([-34, -33, -33]);
    expect(splitByWeights(1000, [2, 1, 1])).toEqual([500, 250, 250]);
    expect(splitByWeights(1001, [1, 1, 1]).reduce((a, b) => a + b)).toBe(1001);
  });

  it('90 CHF zu dritt, ich zahle → 30 Ausgabe, je 30 Umbuchung', () => {
    const { d, priv, roommate } = setup();
    const lea = saveAccount(d, { name: 'Lea', type: 'person', openingDate: '2026-01-01' }).id;
    const input = {
      date: '2026-02-01',
      total: 9000,
      categoryId: cat(d, 'Lebensmittel'),
      paidBy: { kind: 'me' as const, accountId: priv },
      participants: [roommate, lea],
      includeMe: true,
    };
    expect(sharedShares(input).me).toBe(3000);
    saveSharedExpense(d, input);
    expect(accountBalance(d, roommate)).toBe(3000);
    expect(accountBalance(d, lea)).toBe(3000);
    expect(monthlyFlows(d, ['2026-02'])[0]!.expense).toBe(3000);
    expect(whoOwesWhom(d).map((p) => p.balance)).toEqual([3000, 3000]);
    expect(checkInvariant(d).ok).toBe(true);
  });

  it('a person pays for me → I owe my share', () => {
    const { d, roommate } = setup();
    saveSharedExpense(d, {
      date: '2026-02-01',
      total: 6000,
      categoryId: cat(d, 'Restaurant'),
      paidBy: { kind: 'person', personId: roommate },
      participants: [roommate],
      includeMe: true,
    });
    expect(accountBalance(d, roommate)).toBe(-3000);
    expect(monthlyFlows(d, ['2026-02'])[0]!.expense).toBe(3000);
    expect(checkInvariant(d).ok).toBe(true);
  });

  it('settles balances in both directions', () => {
    const { d, priv, roommate } = setup();
    saveTransaction(d, {
      accountId: priv,
      date: '2026-02-01',
      amount: -6000,
      splits: [{ counterAccountId: roommate, amount: -6000 }],
    });
    settlePerson(d, roommate, priv, '2026-02-03', 2000);
    expect(accountBalance(d, roommate)).toBe(4000);
    settlePerson(d, roommate, priv, '2026-02-04');
    expect(accountBalance(d, roommate)).toBe(0);
    expect(accountBalance(d, priv)).toBe(100000);
    expect(settlePerson(d, roommate, priv, '2026-02-05')).toBeNull();
    // ich schulde
    saveTransaction(d, {
      accountId: roommate,
      date: '2026-02-06',
      amount: -1500,
      splits: [{ categoryId: cat(d, 'Ausgang'), amount: -1500 }],
    });
    settlePerson(d, roommate, priv, '2026-02-07');
    expect(accountBalance(d, roommate)).toBe(0);
    expect(accountBalance(d, priv)).toBe(98500);
    expect(monthlyFlows(d, ['2026-02'])[0]!.income).toBe(0);
    expect(checkInvariant(d).ok).toBe(true);
  });
});

describe('Schulden mit Raten', () => {
  it('debts are not budget-relevant; rates charge the monthly budget', () => {
    const { d, priv } = setup();
    const loan = saveAccount(d, {
      name: 'Studienkredit',
      type: 'debt',
      openingBalance: -50000,
      openingDate: '2026-01-01',
    });
    expect(loan.budgetRelevant).toBe(false);
    expect(potBalances(d).get(pot(d, 'buffer'))).toBe(600000); // Schuld drückt den Puffer nicht
    saveRecurring(d, {
      name: 'Rate',
      template: {
        accountId: priv,
        amount: -20000,
        payee: 'Rate',
        note: '',
        tagIds: [],
        splits: [{ counterAccountId: loan.id, amount: -20000, note: '' }],
      },
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=5',
      nextDate: '2026-01-05',
      isSubscription: false,
    });
    const s = debtStatus(d, loan.id, '2026-01-01');
    expect(s).toMatchObject({
      outstanding: 50000,
      monthlyRate: 20000,
      monthsLeft: 3,
      payoffMonth: '2026-03',
    });
    // Jan, Feb, Mär (gekürzt auf 100), danach beendet
    expect(materializeDue(d, '2026-06-30')).toBe(3);
    expect(accountBalance(d, loan.id)).toBe(0);
    expect(d.recurring[0]!.active).toBe(false);
    const rates = d.transactions.filter((t) => t.accountId === priv).map((t) => t.amount);
    expect(rates).toEqual([-20000, -20000, -10000]);
    expect(potBalances(d).get(pot(d, 'monthly'))).toBe(-50000);
    expect(monthOverview(d, '2026-01').otherCharges).toBe(20000);
    expect(checkInvariant(d).ok).toBe(true);
  });
});

describe('Rückerstattungen', () => {
  it('reduce the category expense and the budget usage', () => {
    const { d, priv } = setup();
    const shoes = saveTransaction(d, {
      accountId: priv,
      date: '2026-02-01',
      amount: -12000,
      payee: 'Schuhladen',
      splits: [
        { categoryId: cat(d, 'Kleidung'), amount: -9000 },
        { categoryId: cat(d, 'Hobby & Sport'), amount: -3000 },
      ],
    });
    setBudget(d, '2026-02', cat(d, 'Kleidung'), 10000);
    const input = refundInput(d, shoes.id, 4000, '2026-02-10');
    expect(input.refundOfId).toBe(shoes.id);
    expect(input.splits.map((s) => s.amount)).toEqual([3000, 1000]);
    saveTransaction(d, input);
    expect(refundsOf(d, shoes.id)).toHaveLength(1);
    expect(refundable(d, shoes.id)).toBe(8000);
    // geteilte Ausgabe: nur der eigene Anteil ist erstattbar
    const shared = saveTransaction(d, {
      accountId: priv,
      date: '2026-03-11',
      amount: -9000,
      splits: [
        { categoryId: cat(d, 'Lebensmittel'), amount: -4500 },
        { counterAccountId: d.accounts.find((a) => a.type === 'person')!.id, amount: -4500 },
      ],
    });
    expect(refundable(d, shared.id)).toBe(4500);
    const [feb] = monthlyFlows(d, ['2026-02']);
    expect(feb).toMatchObject({ income: 0, expense: 8000 });
    expect(expensesByCategory(d, '2026-02')).toEqual([
      { categoryId: cat(d, 'Kleidung'), amount: 6000 },
      { categoryId: cat(d, 'Freizeit'), amount: 2000 },
    ]);
    expect(categoryStatuses(d, '2026-02').get(cat(d, 'Kleidung'))!.spent).toBe(6000);
    deleteTransaction(d, shoes.id);
    expect(d.transactions[0]!.refundOfId).toBeUndefined();
  });
});

describe('Belege', () => {
  it('computes resize targets', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1200, 4800)).toEqual({ width: 400, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('keeps metadata consistent', () => {
    const { d, priv } = setup();
    const tx = saveTransaction(d, {
      accountId: priv,
      date: '2026-02-01',
      amount: -100,
      splits: [],
    });
    addAttachment(d, { id: 'a1', transactionId: tx.id, mime: 'image/webp', size: 10 });
    addAttachment(d, { id: 'a2', transactionId: tx.id, mime: 'image/webp', size: 10 });
    expect(d.transactions[0]!.attachmentIds).toEqual(['a1', 'a2']);
    removeAttachment(d, 'a1');
    expect(d.transactions[0]!.attachmentIds).toEqual(['a2']);
    expect(orphanBlobIds(d, ['a1', 'a2', 'x'])).toEqual(['a1', 'x']);
    // Bearbeiten behält die Belege
    saveTransaction(d, {
      id: tx.id,
      accountId: priv,
      date: '2026-02-01',
      amount: -200,
      splits: [],
    });
    expect(d.transactions[0]!.attachmentIds).toEqual(['a2']);
    deleteTransaction(d, tx.id);
    expect(d.attachments).toEqual([]);
    d.attachments.push({ id: 'z', transactionId: 'gone', mime: 'image/jpeg', size: 1 });
    expect(pruneAttachmentMeta(d)).toEqual(['z']);
  });
});

describe('Hinweise', () => {
  it('produces all hint kinds and respects dismissals', () => {
    const { d, priv } = setup();
    d.settings.salary = 400000; // Puffer 6000 → R = 1.5
    d.settings.lastBackupAt = '2026-01-01T10:00:00Z';
    paySalary(d, '2026-03-01');
    setBudget(d, '2026-03', cat(d, 'Lebensmittel'), 10000);
    setBudget(d, '2026-03', cat(d, 'Restaurant'), 10000);
    saveTransaction(d, {
      accountId: priv,
      date: '2026-03-02',
      amount: -8500,
      splits: [{ categoryId: cat(d, 'Lebensmittel'), amount: -8500 }],
    });
    saveTransaction(d, {
      accountId: priv,
      date: '2026-03-02',
      amount: -12000,
      splits: [{ categoryId: cat(d, 'Restaurant'), amount: -12000 }],
    });
    saveRecurring(d, {
      name: 'Streaming',
      template: { accountId: priv, amount: -1290, payee: 'S', note: '', tagIds: [], splits: [] },
      rrule: 'FREQ=MONTHLY',
      nextDate: '2026-03-15',
      isSubscription: true,
    });
    const hints = computeHints(d, '2026-03-10');
    const kinds = hints.map((h) => h.kind);
    expect(new Set(kinds)).toEqual(
      new Set([
        'backupOld',
        'budget80',
        'budgetOver',
        'bufferLow',
        'closingDue',
        'subscriptionDue',
      ]),
    );
    expect(hints[0]!.severity).toBe('danger');
    const b80 = hints.find((h) => h.kind === 'budget80')!;
    expect(b80.params.pct).toBe(85);
    expect(hints.find((h) => h.kind === 'closingDue')!.month).toBe('2026-01');
    const rest = computeHints(d, '2026-03-10', [b80.key]);
    expect(rest.some((h) => h.kind === 'budget80')).toBe(false);
    // Abo erst in 8 Tagen → kein Hinweis
    expect(computeHints(d, '2026-03-07').some((h) => h.kind === 'subscriptionDue')).toBe(false);
  });
});

describe('Hinweise: genau aufgebrauchtes Budget', () => {
  it('does not warn for fixed costs that exactly match the budget', () => {
    const { d, priv } = setup();
    setBudget(d, '2026-03', cat(d, 'Miete'), 95000);
    saveTransaction(d, {
      accountId: priv,
      date: '2026-03-02',
      amount: -95000,
      splits: [{ categoryId: cat(d, 'Miete'), amount: -95000 }],
    });
    expect(computeHints(d, '2026-03-10').some((h) => h.categoryId === cat(d, 'Miete'))).toBe(false);
  });
});
