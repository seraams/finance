import { describe, expect, it } from 'vitest';
import {
  annualCost,
  formatRrule,
  materializeDue,
  nextOccurrence,
  occurrences,
  parseRrule,
  saveRecurring,
  upcoming,
} from '../../src/lib/domain/recurring';
import {
  applyRules,
  applyRulesToUncategorized,
  patternFromPayee,
  saveRule,
  suggestRules,
} from '../../src/lib/domain/rules';
import { saveTransaction } from '../../src/lib/domain/transactions';
import { cat, setup } from './helpers';

describe('Auto-Regeln', () => {
  it('matches case- and accent-insensitive with priority', () => {
    const { d } = setup();
    saveRule(d, { pattern: 'Migros', categoryId: cat(d, 'Lebensmittel') });
    saveRule(d, { pattern: 'migros restaurant', categoryId: cat(d, 'Restaurant') });
    saveRule(d, { pattern: 'café', field: 'any', categoryId: cat(d, 'Ausgang'), priority: 5 });
    expect(applyRules(d.rules, { payee: 'MIGROS M BERN', note: '' })).toBe(cat(d, 'Lebensmittel'));
    expect(applyRules(d.rules, { payee: 'Migros Restaurant Bern', note: '' })).toBe(
      cat(d, 'Restaurant'),
    );
    expect(applyRules(d.rules, { payee: 'Migros', note: 'Cafe' })).toBe(cat(d, 'Ausgang'));
    expect(applyRules(d.rules, { payee: 'Coop', note: '' })).toBeUndefined();
  });

  it('derives patterns and suggests rules from manual categorisations', () => {
    expect(patternFromPayee('MIGROS M BERN 12.03.2026 Karte 1234')).toBe('migros');
    expect(patternFromPayee('SBB CFF FFS')).toBe('sbb cff');
    const { d, priv } = setup();
    for (const payee of ['SBB CFF FFS', 'SBB CFF FFS', 'Coop Pronto']) {
      saveTransaction(d, {
        accountId: priv,
        date: '2026-03-01',
        amount: -500,
        payee,
        splits: [
          { categoryId: cat(d, payee.startsWith('SBB') ? 'ÖV' : 'Lebensmittel'), amount: -500 },
        ],
      });
    }
    // uneinheitlich kategorisiert → kein Vorschlag
    saveTransaction(d, {
      accountId: priv,
      date: '2026-03-02',
      amount: -500,
      payee: 'Kiosk Muster',
      splits: [{ categoryId: cat(d, 'Lebensmittel'), amount: -500 }],
    });
    saveTransaction(d, {
      accountId: priv,
      date: '2026-03-03',
      amount: -500,
      payee: 'Kiosk Muster',
      splits: [{ categoryId: cat(d, 'Ausgang'), amount: -500 }],
    });
    const s = suggestRules(d);
    expect(s).toEqual([{ pattern: 'sbb cff', categoryId: cat(d, 'ÖV'), count: 2 }]);
    saveRule(d, { pattern: s[0]!.pattern, categoryId: s[0]!.categoryId });
    expect(suggestRules(d)).toEqual([]);
  });

  it('applies rules to uncategorised transactions', () => {
    const { d, priv } = setup();
    saveTransaction(d, {
      accountId: priv,
      date: '2026-03-01',
      amount: -990,
      payee: 'Netflix',
      splits: [],
    });
    saveRule(d, { pattern: 'netflix', categoryId: cat(d, 'Abos') });
    expect(applyRulesToUncategorized(d)).toBe(1);
    expect(applyRulesToUncategorized(d)).toBe(0);
  });
});

describe('Wiederkehrende Buchungen', () => {
  it('parses and formats RRULEs', () => {
    expect(parseRrule('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=31')).toEqual({
      freq: 'MONTHLY',
      interval: 3,
      byMonthDay: 31,
    });
    expect(formatRrule({ freq: 'WEEKLY', interval: 2 })).toBe('FREQ=WEEKLY;INTERVAL=2');
    expect(() => parseRrule('FREQ=HOURLY')).toThrow();
  });

  it('computes next dates with month-end clamping', () => {
    const monthly31 = parseRrule('FREQ=MONTHLY;BYMONTHDAY=31');
    expect(occurrences('2026-01-31', monthly31, '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    expect(nextOccurrence('2028-02-29', parseRrule('FREQ=YEARLY'))).toBe('2029-02-28');
    expect(nextOccurrence('2026-03-01', parseRrule('FREQ=WEEKLY;INTERVAL=2'))).toBe('2026-03-15');
  });

  it('books due occurrences once and computes annual cost', () => {
    const { d, priv } = setup();
    const rec = saveRecurring(d, {
      name: 'Streaming',
      template: {
        accountId: priv,
        amount: -1290,
        payee: 'Streaming Erfunden',
        note: '',
        tagIds: [],
        splits: [{ categoryId: cat(d, 'Abos'), amount: -1290, note: '' }],
      },
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
      nextDate: '2026-01-15',
      isSubscription: true,
    });
    expect(annualCost(rec)).toBe(15480);
    expect(materializeDue(d, '2026-03-20')).toBe(3);
    expect(rec.nextDate).toBe('2026-04-15');
    expect(materializeDue(d, '2026-03-20')).toBe(0);
    expect(d.transactions.filter((t) => t.recurringId === rec.id)).toHaveLength(3);
    expect(upcoming(d, '2026-04-10', 7).map((r) => r.id)).toEqual([rec.id]);
    expect(upcoming(d, '2026-04-01', 7)).toEqual([]);
  });

  it('stops at the end date and deactivates broken templates', () => {
    const { d, priv } = setup();
    const rec = saveRecurring(d, {
      name: 'Kurs',
      template: { accountId: priv, amount: -5000, payee: 'Kurs', note: '', tagIds: [], splits: [] },
      rrule: 'FREQ=WEEKLY',
      nextDate: '2026-03-02',
      endDate: '2026-03-16',
      isSubscription: false,
    });
    expect(materializeDue(d, '2026-12-31')).toBe(3);
    expect(rec.active).toBe(false);
    const rec2 = saveRecurring(d, {
      name: 'X',
      template: { accountId: priv, amount: -100, payee: 'X', note: '', tagIds: [], splits: [] },
      rrule: 'FREQ=MONTHLY',
      nextDate: '2026-03-01',
      isSubscription: false,
    });
    rec2.template.accountId = 'gone';
    expect(materializeDue(d, '2026-04-01')).toBe(0);
    expect(rec2.active).toBe(false);
  });
});
