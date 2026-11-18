import { describe, expect, it } from 'vitest';
import { formatMoney, moneyToInput, parseMoney } from '../../src/lib/domain/money';

describe('parseMoney', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12,50', 1250],
    ['12,5', 1250],
    ["1'234.50", 123450],
    ['1’234.50', 123450],
    ['1 234,50', 123450],
    ['1.234,50', 123450],
    ['1,234.50', 123450],
    ['1.234.567', 123456700],
    ['-12.30', -1230],
    ['−7', -700],
    ['+3.05', 305],
    ['CHF 12.00', 1200],
    ['12.-', 1200],
    ['.5', 50],
    ['0.01', 1],
    ['0', 0],
  ])('%s → %d', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(['', 'abc', '12.345', '1.2.3', '12a', '--5', '1,2,3'])('rejects %j', (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it('never returns fractional Rappen', () => {
    for (const s of ['0.1', '0.29', '19.99', '1234.57']) {
      expect(Number.isInteger(parseMoney(s))).toBe(true);
    }
    expect(parseMoney('0.29')).toBe(29);
    expect(parseMoney('19.99')).toBe(1999);
  });
});

describe('formatMoney', () => {
  it('formats de-CH with apostrophes', () => {
    expect(formatMoney(123450)).toBe("1'234.50");
    expect(formatMoney(123456789)).toBe("1'234'567.89");
    expect(formatMoney(5)).toBe('0.05');
    expect(formatMoney(-1999)).toBe('−19.99');
    expect(formatMoney(1000, { currency: 'CHF' })).toBe('CHF 10.00');
    expect(formatMoney(1000, { signed: true })).toBe('+10.00');
    expect(formatMoney(123450, { whole: true })).toBe("1'235");
  });

  it('round-trips through moneyToInput', () => {
    for (const v of [0, 1, -1, 123450, -987654321]) {
      expect(parseMoney(moneyToInput(v))).toBe(v);
    }
  });
});
