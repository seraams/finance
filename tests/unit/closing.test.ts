import { describe, expect, it } from 'vitest';
import { accountBalance, bufferBalance, potBalances } from '../../src/lib/domain/balances';
import { categoryStatuses, paySalary, setBudget } from '../../src/lib/domain/budget';
import {
  closeMonth,
  distributeOverflowToGoals,
  isDateInClosedMonth,
  monthReport,
  nextMonthToClose,
  payReserves,
  personBalances,
  previewOverflow,
  previewRests,
  reconcileAccount,
  reopenMonth,
  reserveSchedule,
  settleRests,
  uncategorizedInMonth,
} from '../../src/lib/domain/closing';
import { savePot } from '../../src/lib/domain/entities';
import { checkInvariant } from '../../src/lib/domain/invariant';
import { saveTransaction } from '../../src/lib/domain/transactions';
import { cat, pot, setup } from './helpers';

function spend(
  d: ReturnType<typeof setup>['d'],
  acc: string,
  date: string,
  c: string,
  amount: number,
) {
  saveTransaction(d, {
    accountId: acc,
    date,
    amount: -amount,
    splits: [{ categoryId: cat(d, c), amount: -amount }],
  });
}

describe('Rücklagen', () => {
  it('computes r = (B − A) / n per month and books it from the monthly budget', () => {
    const { d } = setup();
    d.settings.salary = 300000;
    const res = savePot(d, {
      kind: 'reserve',
      name: 'Semestergebühren',
      targetAmount: 73000,
      targetDate: '2026-09-15',
    });
    paySalary(d, '2026-03-01');
    const [line] = reserveSchedule(d, '2026-03');
    expect(line).toMatchObject({ monthsLeft: 6, saved: 0, contribution: 12167, due: 12167 });
    payReserves(d, '2026-03', '2026-03-01');
    expect(potBalances(d).get(res.id)).toBe(12167);
    expect(reserveSchedule(d, '2026-03')[0]!.due).toBe(0);
    expect(payReserves(d, '2026-03', '2026-03-05')).toHaveLength(0);
    // nächster Monat: (73000 − 12167) / 5 = 12166.6 → 12167
    expect(reserveSchedule(d, '2026-04')[0]!.contribution).toBe(12167);
    expect(checkInvariant(d).ok).toBe(true);
  });

  it('due this month → n = 1; overdue → no contribution', () => {
    const { d } = setup();
    savePot(d, {
      kind: 'reserve',
      name: 'Steuern',
      targetAmount: 120000,
      targetDate: '2026-03-31',
    });
    expect(reserveSchedule(d, '2026-03')[0]).toMatchObject({ monthsLeft: 1, contribution: 120000 });
    expect(reserveSchedule(d, '2026-04')[0]).toMatchObject({ overdue: true, contribution: 0 });
  });
});

describe('Monatsabschluss', () => {
  it('runs all steps and keeps the invariant', () => {
    const { d, priv, roommate } = setup();
    d.settings.salary = 200000;
    d.settings.bufferMonths = 2;
    const goal = savePot(d, { kind: 'goal', name: 'Velo', weight: 1, targetAmount: 50000 });
    const food = cat(d, 'Lebensmittel');
    const clothes = cat(d, 'Kleidung');
    d.categories.find((c) => c.id === clothes)!.rolloverRest = true;
    paySalary(d, '2026-01-01');
    setBudget(d, '2026-01', food, 40000);
    setBudget(d, '2026-01', clothes, 10000);
    spend(d, priv, '2026-01-05', 'Lebensmittel', 45000); // überzogen um 50
    spend(d, priv, '2026-01-06', 'Kleidung', 4000); // Rest 60 → Übertrag
    saveTransaction(d, {
      accountId: priv,
      date: '2026-01-07',
      amount: -1500,
      payee: '?',
      splits: [],
    });
    saveTransaction(d, {
      accountId: priv,
      date: '2026-01-08',
      amount: -9000,
      splits: [
        { categoryId: food, amount: -3000 },
        { counterAccountId: roommate, amount: -6000 },
      ],
    });
    saveTransaction(d, {
      accountId: priv,
      date: '2026-01-25',
      amount: 600000,
      splits: [{ categoryId: cat(d, 'Lohn'), amount: 600000 }],
    });

    expect(nextMonthToClose(d, '2026-02-10')).toBe('2026-01');

    // 1. unkategorisiert
    const unc = uncategorizedInMonth(d, '2026-01');
    expect(unc.map((t) => t.amount)).toEqual([-1500]);

    // 2. Bankabgleich: Bank sagt 20 CHF weniger
    const app = accountBalance(d, priv, '2026-01-31');
    expect(reconcileAccount(d, priv, '2026-01-31', app - 2000)).toBe(-2000);
    expect(accountBalance(d, priv, '2026-01-31')).toBe(app - 2000);
    expect(reconcileAccount(d, priv, '2026-01-31', app - 2000)).toBe(0);

    // 3. Personen
    expect(personBalances(d)).toEqual([{ accountId: roommate, balance: 6000 }]);

    // 4. Reste
    // Monatsbudget: 2000 − 450 − 40 − 15 − 30 − 20 = 1445; Übertrag Kleidung 60
    const rests = previewRests(d, '2026-01');
    expect(rests.carried).toBe(6000);
    expect(rests.returned).toBe(144500 - 6000);
    expect(rests.overspentCategoryIds).toEqual([food]);
    settleRests(d, '2026-01');
    expect(potBalances(d, '2026-01-31').get(pot(d, 'monthly'))).toBe(6000);
    expect(settleRests(d, '2026-01').returned).toBe(0); // idempotent
    expect(categoryStatuses(d, '2026-02').get(clothes)!.carryIn).toBe(6000);

    // 5. Selbst-Gehalt für Februar
    paySalary(d, '2026-02-01');
    expect(potBalances(d).get(pot(d, 'monthly'))).toBe(206000);

    // 6. Überlauf: P = 6000 + 600000 + 600 − 2000(S Jan) + 1385 − 2000(S Feb) ... Ziel 4000
    const P = bufferBalance(d, '2026-02-01');
    const over = previewOverflow(d, '2026-02-01');
    expect(P).toBeGreaterThan(400000);
    expect(over.get(goal.id)).toBe(50000); // auf Zielbetrag begrenzt
    distributeOverflowToGoals(d, '2026-02-01');
    expect(potBalances(d).get(goal.id)).toBe(50000);
    expect(previewOverflow(d, '2026-02-01').size).toBe(0);

    // 7. Abschluss
    closeMonth(d, '2026-01', '2026-02-10');
    expect(isDateInClosedMonth(d, '2026-01-15')).toBe(true);
    expect(nextMonthToClose(d, '2026-02-10')).toBeUndefined();
    const report = monthReport(d, '2026-01');
    expect(report.income).toBe(600000);
    expect(report.overspentCategoryIds).toEqual([food]);

    expect(checkInvariant(d).ok).toBe(true);
    reopenMonth(d, '2026-01');
    expect(isDateInClosedMonth(d, '2026-01-15')).toBe(false);
  });

  it('covers a total overspend from the buffer', () => {
    const { d, priv } = setup();
    d.settings.salary = 10000;
    paySalary(d, '2026-01-01');
    spend(d, priv, '2026-01-05', 'Lebensmittel', 25000);
    const r = settleRests(d, '2026-01');
    expect(r.covered).toBe(15000);
    expect(potBalances(d, '2026-01-31').get(pot(d, 'monthly'))).toBe(0);
    expect(bufferBalance(d)).toBe(600000 - 10000 - 15000);
    expect(checkInvariant(d).ok).toBe(true);
  });
});
