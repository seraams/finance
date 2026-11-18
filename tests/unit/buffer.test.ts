import { describe, expect, it } from 'vitest';
import {
  averageIncome,
  bufferTarget,
  distributeOverflow,
  lowerSalarySuggestion,
  overflow,
  reach,
  reserveContribution,
  salaryPayout,
  suggestSalary,
  warningLevel,
} from '../../src/lib/domain/buffer';

describe('Selbst-Gehalt S = (1 − q) × Ē₁₂', () => {
  it('uses the average of the last 12 months', () => {
    const incomes = Array(12).fill(400000); // 4000 CHF
    expect(suggestSalary(incomes, 10)).toBe(360000);
  });

  it('uses fewer months if not available', () => {
    expect(suggestSalary([300000, 500000], 10)).toBe(360000);
    expect(averageIncome([300000, 500000])).toBe(400000);
  });

  it('only uses the last 12 of more months', () => {
    const incomes = [10_000_000, ...Array(12).fill(200000)];
    expect(suggestSalary(incomes, 0)).toBe(200000);
  });

  it('rounds down to whole francs', () => {
    // Ē = 3333.33, × 0.9 = 2999.997 → 2999
    expect(suggestSalary([333333], 10)).toBe(299900);
  });

  it('handles empty history and extreme q', () => {
    expect(suggestSalary([], 10)).toBe(0);
    expect(suggestSalary([100000], 100)).toBe(0);
    expect(suggestSalary([100000], 0)).toBe(100000);
  });
});

describe('Puffer-Ziel, Reichweite, Überlauf', () => {
  it('P_Ziel = N × S', () => {
    expect(bufferTarget(300000, 5)).toBe(1500000);
    expect(bufferTarget(300000, 0)).toBe(0);
  });

  it('R = P / S', () => {
    expect(reach(900000, 300000)).toBe(3);
    expect(reach(150000, 300000)).toBe(0.5);
    expect(reach(100, 0)).toBe(Infinity);
    expect(reach(0, 0)).toBe(0);
  });

  it('warning levels', () => {
    expect(warningLevel(0.99)).toBe('red');
    expect(warningLevel(1)).toBe('yellow');
    expect(warningLevel(1.99)).toBe('yellow');
    expect(warningLevel(2)).toBe('ok');
    expect(lowerSalarySuggestion(500000, 300000)).toBe(250000);
    expect(lowerSalarySuggestion(900000, 300000)).toBe(300000);
    expect(lowerSalarySuggestion(-100, 300000)).toBe(0);
  });

  it('Ü = max(0, P − P_Ziel)', () => {
    expect(overflow(1600000, 1500000)).toBe(100000);
    expect(overflow(1400000, 1500000)).toBe(0);
  });
});

describe('Überlauf-Verteilung Üᵢ = Ü × wᵢ / Σw', () => {
  it('distributes proportionally', () => {
    const r = distributeOverflow(100000, [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 3 },
    ]);
    expect(r.get('a')).toBe(25000);
    expect(r.get('b')).toBe(75000);
  });

  it('sum is exact; rest goes to the largest weight', () => {
    const r = distributeOverflow(100, [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
      { id: 'c', weight: 2 },
    ]);
    // 25, 25, 50 → exact
    expect([...r.values()].reduce((a, b) => a + b)).toBe(100);
    const r2 = distributeOverflow(10, [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
      { id: 'c', weight: 1 },
    ]);
    // 3, 3, 3 + rest 1 → first with max weight (a)
    expect(r2.get('a')).toBe(4);
    expect(r2.get('b')).toBe(3);
    expect(r2.get('c')).toBe(3);
    const r3 = distributeOverflow(1001, [
      { id: 'a', weight: 2 },
      { id: 'b', weight: 5 },
      { id: 'c', weight: 3 },
    ]);
    expect(r3.get('a')).toBe(200);
    expect(r3.get('c')).toBe(300);
    expect(r3.get('b')).toBe(501);
  });

  it('ignores zero weights and handles edge cases', () => {
    expect(distributeOverflow(100, []).size).toBe(0);
    expect(distributeOverflow(0, [{ id: 'a', weight: 1 }]).size).toBe(0);
    const r = distributeOverflow(100, [
      { id: 'a', weight: 0 },
      { id: 'b', weight: 2 },
    ]);
    expect(r.has('a')).toBe(false);
    expect(r.get('b')).toBe(100);
  });

  it('is exact for many random cases', () => {
    for (let i = 0; i < 500; i++) {
      const amount = Math.floor(Math.random() * 1e7);
      const goals = Array.from({ length: 1 + (i % 6) }, (_, j) => ({
        id: String(j),
        weight: Math.random() * 10 + 0.01,
      }));
      const r = distributeOverflow(amount, goals);
      expect([...r.values()].reduce((a, b) => a + b, 0)).toBe(amount);
      expect([...r.values()].every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
    }
  });
});

describe('Rücklage r = (B − A) / n', () => {
  it('rounds up to Rappen', () => {
    expect(reserveContribution(100000, 0, 3)).toBe(33334);
    expect(reserveContribution(120000, 20000, 4)).toBe(25000);
  });
  it('n is at least 1', () => {
    expect(reserveContribution(100000, 40000, 0)).toBe(60000);
    expect(reserveContribution(100000, 40000, -3)).toBe(60000);
  });
  it('is 0 when fully saved', () => {
    expect(reserveContribution(100000, 100000, 5)).toBe(0);
    expect(reserveContribution(100000, 150000, 5)).toBe(0);
  });
});

describe('Anlaufphase', () => {
  it('pays full S if the buffer suffices', () => {
    expect(salaryPayout(300000, 900000)).toEqual({
      amount: 300000,
      startupPhase: false,
      shortfall: 0,
    });
  });
  it('pays min(S, P) if the buffer is smaller than S', () => {
    expect(salaryPayout(300000, 120000)).toEqual({
      amount: 120000,
      startupPhase: true,
      shortfall: 180000,
    });
  });
  it('never pays a negative amount', () => {
    expect(salaryPayout(300000, -5000).amount).toBe(0);
  });
});
