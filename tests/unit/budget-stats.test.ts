import { describe, expect, it } from 'vitest';
import {
  categoryStatuses,
  copyBudgetsFromPreviousMonth,
  monthOverview,
  paySalary,
  previewSalary,
  salaryPaidInMonth,
  setBudget,
} from '../../src/lib/domain/budget';
import { bufferBalance } from '../../src/lib/domain/balances';
import { checkInvariant } from '../../src/lib/domain/invariant';
import {
  expensesByCategory,
  incomeHistory,
  monthlyFlows,
  savingsRate,
  yearOverview,
} from '../../src/lib/domain/stats';
import { netWorthByMonth, updateSnapshots } from '../../src/lib/domain/snapshots';
import { saveTransaction } from '../../src/lib/domain/transactions';
import { cat, setup } from './helpers';

function spend(
  d: ReturnType<typeof setup>['d'],
  acc: string,
  date: string,
  c: string,
  amount: number,
) {
  saveTransaction(d, { accountId: acc, date, amount, splits: [{ categoryId: cat(d, c), amount }] });
}

describe('Selbst-Gehalt auszahlen', () => {
  it('pays S once per month', () => {
    const { d } = setup();
    d.settings.salary = 200000;
    expect(previewSalary(d, '2026-02-01').amount).toBe(200000);
    paySalary(d, '2026-02-01');
    expect(salaryPaidInMonth(d, '2026-02')).toBe(200000);
    expect(paySalary(d, '2026-02-15')).toBeNull();
    expect(bufferBalance(d)).toBe(400000);
  });

  it('pays only min(S, P) in the startup phase', () => {
    const { d } = setup();
    d.settings.salary = 800000; // Puffer 6000 CHF
    const p = previewSalary(d, '2026-02-01');
    expect(p.amount).toBe(600000);
    expect(p.startupPhase).toBe(true);
    paySalary(d, '2026-02-01');
    expect(bufferBalance(d)).toBe(0);
    // Nach neuem Einkommen kann der Rest nachgezahlt werden
    saveTransaction(d, {
      accountId: d.accounts[0]!.id,
      date: '2026-02-10',
      amount: 300000,
      splits: [{ categoryId: cat(d, 'Lohn'), amount: 300000 }],
    });
    expect(previewSalary(d, '2026-02-10').amount).toBe(200000);
    expect(checkInvariant(d).ok).toBe(true);
  });
});

describe('Monatsbudget pro Kategorie', () => {
  it('computes rest per category', () => {
    const { d, priv } = setup();
    setBudget(d, '2026-02', cat(d, 'Lebensmittel'), 40000);
    spend(d, priv, '2026-02-03', 'Lebensmittel', -12000);
    spend(d, priv, '2026-02-10', 'Lebensmittel', -8000);
    spend(d, priv, '2026-03-01', 'Lebensmittel', -5000);
    const s = categoryStatuses(d, '2026-02').get(cat(d, 'Lebensmittel'))!;
    expect(s).toMatchObject({ budget: 40000, spent: 20000, rest: 20000, carryIn: 0 });
    expect(s.usage).toBe(0.5);
  });

  it('carries positive rests only with rolloverRest', () => {
    const { d, priv } = setup();
    const id = cat(d, 'Kleidung');
    d.categories.find((c) => c.id === id)!.rolloverRest = true;
    setBudget(d, '2026-01', id, 10000);
    setBudget(d, '2026-02', id, 10000);
    setBudget(d, '2026-03', id, 10000);
    spend(d, priv, '2026-01-05', 'Kleidung', -3000); // Rest 70
    spend(d, priv, '2026-02-05', 'Kleidung', -25000); // 70+100−250 = −80 → nicht übertragen
    const feb = categoryStatuses(d, '2026-02').get(id)!;
    expect(feb.carryIn).toBe(7000);
    expect(feb.rest).toBe(-8000);
    const mar = categoryStatuses(d, '2026-03').get(id)!;
    expect(mar.carryIn).toBe(0);
    expect(mar.rest).toBe(10000);
    // ohne Übertrag
    const food = cat(d, 'Lebensmittel');
    setBudget(d, '2026-01', food, 10000);
    setBudget(d, '2026-02', food, 10000);
    expect(categoryStatuses(d, '2026-02').get(food)!.carryIn).toBe(0);
  });

  it('copies budgets and removes zero budgets', () => {
    const { d } = setup();
    setBudget(d, '2026-01', cat(d, 'Miete'), 90000);
    setBudget(d, '2026-01', cat(d, 'ÖV'), 5000);
    setBudget(d, '2026-02', cat(d, 'ÖV'), 6000);
    expect(copyBudgetsFromPreviousMonth(d, '2026-02')).toBe(1);
    expect(d.budgets.filter((b) => b.month === '2026-02')).toHaveLength(2);
    setBudget(d, '2026-02', cat(d, 'ÖV'), 0);
    expect(d.budgets.filter((b) => b.month === '2026-02')).toHaveLength(1);
  });

  it('expenses paid from another pot do not count against the monthly budget', () => {
    const { d, priv } = setup();
    const id = cat(d, 'Ferien');
    setBudget(d, '2026-02', id, 5000);
    saveTransaction(d, {
      accountId: priv,
      date: '2026-02-02',
      amount: -40000,
      splits: [{ categoryId: id, amount: -40000, potId: d.pots[0]!.id }],
    });
    expect(categoryStatuses(d, '2026-02').get(id)!.spent).toBe(0);
  });

  it('month overview', () => {
    const { d, priv } = setup();
    d.settings.salary = 300000;
    paySalary(d, '2026-02-01');
    setBudget(d, '2026-02', cat(d, 'Lebensmittel'), 50000);
    spend(d, priv, '2026-02-03', 'Lebensmittel', -10000);
    const o = monthOverview(d, '2026-02');
    expect(o.salaryPaid).toBe(300000);
    expect(o.monthlyPot).toBe(290000);
    expect(o.unbudgeted).toBe(290000 - 40000);
  });

  it('uses the configured month start day', () => {
    const { d, priv } = setup();
    d.settings.monthStartDay = 25;
    setBudget(d, '2026-02', cat(d, 'Lebensmittel'), 10000);
    spend(d, priv, '2026-03-20', 'Lebensmittel', -1000); // gehört zum Budgetmonat Februar
    expect(categoryStatuses(d, '2026-02').get(cat(d, 'Lebensmittel'))!.spent).toBe(1000);
  });
});

describe('Auswertungen', () => {
  it('monthly flows, categories and savings rate', () => {
    const { d, priv, savings } = setup();
    saveTransaction(d, {
      accountId: priv,
      date: '2026-01-25',
      amount: 400000,
      splits: [{ categoryId: cat(d, 'Lohn'), amount: 400000 }],
    });
    spend(d, priv, '2026-01-26', 'Miete', -100000);
    spend(d, priv, '2026-01-27', 'Lebensmittel', -30000);
    spend(d, priv, '2026-01-28', 'Restaurant', -10000);
    // Umbuchung zählt nicht
    saveTransaction(d, {
      accountId: priv,
      date: '2026-01-29',
      amount: -50000,
      splits: [{ counterAccountId: savings, amount: -50000 }],
    });
    // Rückerstattung senkt die Ausgabe
    spend(d, priv, '2026-01-30', 'Restaurant', 2000);
    const [jan] = monthlyFlows(d, ['2026-01']);
    expect(jan).toEqual({ month: '2026-01', income: 400000, expense: 138000 });
    const byCat = expensesByCategory(d, '2026-01');
    expect(byCat[0]).toEqual({ categoryId: cat(d, 'Wohnen'), amount: 100000 });
    expect(byCat[1]).toEqual({ categoryId: cat(d, 'Essen'), amount: 38000 });
    expect(savingsRate(400000, 138000)).toBeCloseTo(0.655);
    expect(savingsRate(0, 100)).toBeNull();
    const y = yearOverview(d, 2026);
    expect(y.rows).toHaveLength(12);
    expect(y.total.net).toBe(262000);
  });

  it('income history for the salary suggestion', () => {
    const { d, priv } = setup();
    for (const [date, amt] of [
      ['2026-01-25', 300000],
      ['2026-02-25', 500000],
      ['2026-03-25', 700000],
    ] as const) {
      saveTransaction(d, {
        accountId: priv,
        date,
        amount: amt,
        splits: [{ categoryId: cat(d, 'Lohn'), amount: amt }],
      });
    }
    expect(incomeHistory(d, '2026-03')).toEqual([300000, 500000]);
    expect(incomeHistory(d, '2026-01')).toEqual([300000]);
    expect(incomeHistory(d, '2027-06')).toHaveLength(12);
  });
});

describe('Snapshots', () => {
  it('stores month-end balances from the first month and freezes closed months', () => {
    const { d, priv } = setup();
    spend(d, priv, '2026-01-10', 'Miete', -10000);
    spend(d, priv, '2026-02-10', 'Miete', -20000);
    updateSnapshots(d, '2026-03-05');
    const privSnaps = d.snapshots
      .filter((s) => s.accountId === priv)
      .sort((a, b) => (a.month < b.month ? -1 : 1));
    expect(privSnaps.map((s) => [s.month, s.balance])).toEqual([
      ['2026-01', 90000],
      ['2026-02', 70000],
      ['2026-03', 70000],
    ]);
    // Abgeschlossener Monat bleibt eingefroren
    d.monthClosings.push({ month: '2026-01', closedAt: '2026-02-01T00:00:00Z' });
    spend(d, priv, '2026-01-15', 'Miete', -5000);
    expect(updateSnapshots(d, '2026-03-05')).toBeGreaterThan(0);
    const jan = d.snapshots.find((s) => s.accountId === priv && s.month === '2026-01')!;
    expect(jan.balance).toBe(90000);
    const feb = d.snapshots.find((s) => s.accountId === priv && s.month === '2026-02')!;
    expect(feb.balance).toBe(65000);
    // idempotent
    expect(updateSnapshots(d, '2026-03-05')).toBe(0);
    const nw = netWorthByMonth(d);
    expect(nw.get('2026-03')).toBe(65000 + 500000 + 1000000);
  });
});
