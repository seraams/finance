import { describe, expect, it } from 'vitest';
import { accountBalance, bufferBalance, potBalances } from '../../src/lib/domain/balances';
import { paySalary } from '../../src/lib/domain/budget';
import { deletePot, savePot } from '../../src/lib/domain/entities';
import { assignUnassigned, checkInvariant } from '../../src/lib/domain/invariant';
import { saveTransaction } from '../../src/lib/domain/transactions';
import { cat, pot, setup } from './helpers';

describe('Invariante: Σ budgetrelevante Konten = Σ Töpfe', () => {
  it('holds after setup (opening balances go to the buffer)', () => {
    const { d } = setup();
    const r = checkInvariant(d);
    expect(r.accountsTotal).toBe(600000); // Depot zählt nicht
    expect(r.potsTotal).toBe(600000);
    expect(r.ok).toBe(true);
    expect(bufferBalance(d)).toBe(600000);
  });

  it('holds for income, expenses, salary, transfers and shared costs', () => {
    const { d, priv, savings, depot, roommate } = setup();
    saveTransaction(d, {
      accountId: priv,
      date: '2026-01-25',
      amount: 450000,
      payee: 'Arbeitgeber',
      splits: [{ categoryId: cat(d, 'Lohn'), amount: 450000 }],
    });
    paySalary(d, '2026-02-01');
    saveTransaction(d, {
      accountId: priv,
      date: '2026-02-03',
      amount: -9000,
      payee: 'Migros',
      splits: [
        { categoryId: cat(d, 'Lebensmittel'), amount: -3000 },
        { counterAccountId: roommate, amount: -6000 },
      ],
    });
    // Umbuchung zwischen budgetrelevanten Konten
    saveTransaction(d, {
      accountId: priv,
      date: '2026-02-04',
      amount: -100000,
      splits: [{ counterAccountId: savings, amount: -100000 }],
    });
    // Ins Depot: muss aus einem Topf kommen (Standard: Puffer)
    saveTransaction(d, {
      accountId: savings,
      date: '2026-02-05',
      amount: -200000,
      splits: [{ counterAccountId: depot, amount: -200000 }],
    });
    // Unkategorisiert
    saveTransaction(d, { accountId: priv, date: '2026-02-06', amount: -1234, splits: [] });
    expect(checkInvariant(d).ok).toBe(true);
    expect(accountBalance(d, roommate)).toBe(6000);
    expect(accountBalance(d, depot)).toBe(1200000);
    const pots = potBalances(d);
    // Monatsbudget: Ausgaben 30 + 12.34 unkategorisiert, Puffer finanziert S nicht (S = 0)
    expect(pots.get(pot(d, 'monthly'))).toBe(-3000 - 1234);
    expect(pots.get(pot(d, 'buffer'))).toBe(600000 + 450000 - 200000);
  });

  it('moves the salary from buffer to monthly budget', () => {
    const { d } = setup();
    d.settings.salary = 250000;
    paySalary(d, '2026-01-01');
    expect(potBalances(d).get(pot(d, 'monthly'))).toBe(250000);
    expect(bufferBalance(d)).toBe(350000);
    expect(checkInvariant(d).ok).toBe(true);
  });

  it('expense paid from a goal charges the goal', () => {
    const { d, priv } = setup();
    const goal = savePot(d, { kind: 'goal', name: 'Velo', weight: 1 });
    d.potMoves.push({
      id: 'm1',
      date: '2026-01-02',
      fromPotId: pot(d, 'buffer'),
      toPotId: goal.id,
      amount: 80000,
      reason: 'manual',
    });
    saveTransaction(d, {
      accountId: priv,
      date: '2026-01-05',
      amount: -75000,
      splits: [{ categoryId: cat(d, 'Velo'), amount: -75000, potId: goal.id }],
    });
    expect(potBalances(d).get(goal.id)).toBe(5000);
    expect(potBalances(d).get(pot(d, 'monthly'))).toBe(0);
    expect(checkInvariant(d).ok).toBe(true);
  });

  it('detects and resolves an unassigned difference', () => {
    const { d } = setup();
    const goal = savePot(d, { kind: 'goal', name: 'Ferien' });
    d.potMoves.push({
      id: 'm1',
      date: '2026-01-02',
      fromPotId: pot(d, 'buffer'),
      toPotId: goal.id,
      amount: 30000,
      reason: 'manual',
    });
    deletePot(d, goal.id);
    const r = checkInvariant(d);
    expect(r.ok).toBe(false);
    expect(r.unassigned).toBe(30000);
    assignUnassigned(d, '2026-01-03');
    expect(checkInvariant(d).ok).toBe(true);
    expect(bufferBalance(d)).toBe(600000);
  });

  it('detects pots without coverage (negative difference)', () => {
    const { d } = setup();
    d.potMoves.push({
      id: 'x',
      date: '2026-01-02',
      toPotId: pot(d, 'buffer'),
      amount: 500,
      reason: 'manual',
    });
    expect(checkInvariant(d).unassigned).toBe(-500);
    assignUnassigned(d, '2026-01-02');
    expect(checkInvariant(d).ok).toBe(true);
  });

  it('respects the budgetRelevant flag of accounts', () => {
    const { d, depot } = setup();
    d.accounts.find((a) => a.id === depot)!.budgetRelevant = true;
    expect(checkInvariant(d).ok).toBe(true);
    expect(bufferBalance(d)).toBe(1600000);
  });

  it('respects asOf dates', () => {
    const { d, priv } = setup();
    saveTransaction(d, {
      accountId: priv,
      date: '2026-03-01',
      amount: -5000,
      splits: [{ categoryId: cat(d, 'Restaurant'), amount: -5000 }],
    });
    expect(checkInvariant(d, '2026-02-28').ok).toBe(true);
    expect(accountBalance(d, priv, '2026-02-28')).toBe(100000);
    expect(accountBalance(d, priv, '2026-03-01')).toBe(95000);
  });
});
