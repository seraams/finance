import { describe, expect, it } from 'vitest';
import { isUuidV7, uuidv7 } from '../../src/lib/domain/ids';
import {
  addMonths,
  budgetMonthEnd,
  budgetMonthOf,
  budgetMonthStart,
  isIsoDate,
  monthDiff,
  monthRange,
} from '../../src/lib/domain/dates';

describe('uuidv7', () => {
  it('produces valid, unique, time-ordered ids', () => {
    const ids = Array.from({ length: 1000 }, () => uuidv7());
    expect(ids.every(isUuidV7)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('encodes the timestamp', () => {
    const id = uuidv7(Date.UTC(2026, 0, 1));
    const ms = parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    expect(ms).toBe(Date.UTC(2026, 0, 1));
  });
});

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });

  it('computes months', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 14)).toBe('2028-01');
    expect(monthDiff('2025-11', '2026-02')).toBe(3);
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('respects the configured month start day', () => {
    expect(budgetMonthOf('2026-03-24', 25)).toBe('2026-02');
    expect(budgetMonthOf('2026-03-25', 25)).toBe('2026-03');
    expect(budgetMonthOf('2026-01-10', 15)).toBe('2025-12');
    expect(budgetMonthStart('2026-03', 25)).toBe('2026-03-25');
    expect(budgetMonthEnd('2026-03', 25)).toBe('2026-04-24');
    expect(budgetMonthEnd('2026-02', 1)).toBe('2026-02-28');
  });
});
