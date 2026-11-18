/**
 * Demo-Daten für die Entwicklung (frei erfunden). Wird nur im Dev-Build
 * angeboten, damit sich das Dashboard testen lässt.
 */
import { paySalary, setBudget } from './budget';
import { addMonths, budgetMonthOf, budgetMonthStart, todayIso } from './dates';
import { createEmptyDataset } from './defaults';
import { saveAccount, savePot, saveTag } from './entities';
import { saveSecurity, setHolding, setPrice } from './investments';
import { saveRecurring } from './recurring';
import { saveRule } from './rules';
import { saveTransaction } from './transactions';
import type { Dataset, Id, Language } from './types';

/** Deterministischer Zufall, damit die Demo reproduzierbar ist. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function createSeedDataset(lang: Language = 'de', today = todayIso()): Dataset {
  const d = createEmptyDataset(lang);
  const rand = rng(42);
  const r = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const byName = (de: string, en: string): Id => {
    const c = d.categories.find((x) => x.name === (lang === 'de' ? de : en));
    if (!c) throw new Error(de);
    return c.id;
  };
  const currentMonth = budgetMonthOf(today);
  const start = addMonths(currentMonth, -13);
  const openingDate = budgetMonthStart(start);

  const priv = saveAccount(d, {
    name: 'Privatkonto',
    type: 'private',
    openingBalance: 420000,
    openingDate,
  }).id;
  const savings = saveAccount(d, {
    name: 'Sparkonto',
    type: 'savings',
    openingBalance: 800000,
    openingDate,
  }).id;
  const cash = saveAccount(d, {
    name: lang === 'de' ? 'Portemonnaie' : 'Wallet',
    type: 'cash',
    openingBalance: 8000,
    openingDate,
  }).id;
  const twint = saveAccount(d, {
    name: 'Twint',
    type: 'wallet',
    openingBalance: 0,
    openingDate,
  }).id;
  const mate = saveAccount(d, {
    name: lang === 'de' ? 'Mitbewohnerin Lea' : 'Flatmate Lea',
    type: 'person',
    openingBalance: 0,
    openingDate,
  }).id;
  const depot = saveAccount(d, {
    name: 'Depot',
    type: 'brokerage',
    openingBalance: 1200000,
    openingDate,
  }).id;
  const p3a = saveAccount(d, {
    name: 'Säule 3a',
    type: 'pension3a',
    openingBalance: 0,
    openingDate,
  }).id;
  const cryptoAcc = saveAccount(d, {
    name: 'Krypto-Wallet',
    type: 'crypto',
    openingBalance: 0,
    openingDate,
  }).id;

  const travel = saveTag(d, lang === 'de' ? 'Ferien' : 'Holiday');
  savePot(d, {
    kind: 'goal',
    name: lang === 'de' ? 'Neues Velo' : 'New bike',
    targetAmount: 150000,
    weight: 1,
  });
  savePot(d, {
    kind: 'goal',
    name: lang === 'de' ? 'Reise' : 'Trip',
    targetAmount: 300000,
    weight: 2,
  });
  savePot(d, {
    kind: 'reserve',
    name: lang === 'de' ? 'Semestergebühren' : 'Tuition',
    targetAmount: 73000,
  });

  d.settings.salary = 280000;
  const spend = (
    date: string,
    acc: Id,
    cat: Id,
    amount: number,
    payee: string,
    tagIds: Id[] = [],
  ) =>
    saveTransaction(d, {
      accountId: acc,
      date,
      amount: -amount,
      payee,
      tagIds,
      splits: [{ categoryId: cat, amount: -amount }],
    });

  for (let i = 0; i <= 13; i++) {
    const m = addMonths(start, i);
    const day = (n: number) => {
      const s = `${m}-${String(n).padStart(2, '0')}`;
      return s <= today ? s : null;
    };
    const income = r(250000, 480000);
    const d25 = day(25);
    if (d25)
      saveTransaction(d, {
        accountId: priv,
        date: d25,
        amount: income,
        payee: 'Werkstudium AG',
        splits: [{ categoryId: byName('Nebenjob', 'Side job'), amount: income }],
      });
    const d1 = day(1);
    if (d1) paySalary(d, d1);
    const d2 = day(2);
    if (d2) {
      spend(d2, priv, byName('Miete', 'Rent'), 95000, 'Wohngenossenschaft');
      spend(d2, priv, byName('Krankenkasse', 'Health insurance'), 31500, 'Krankenkasse Muster');
      spend(d2, priv, byName('Internet & Handy', 'Internet & phone'), 3990, 'Telco');
    }
    for (let w = 0; w < 4; w++) {
      const dd = day(3 + w * 7);
      if (!dd) continue;
      const total = r(4000, 12000);
      if (w === 1) {
        const mine = Math.round(total / 2);
        saveTransaction(d, {
          accountId: priv,
          date: dd,
          amount: -total,
          payee: 'Migros',
          splits: [
            { categoryId: byName('Lebensmittel', 'Groceries'), amount: -mine },
            { counterAccountId: mate, amount: -(total - mine) },
          ],
        });
        const back = day(5 + w * 7);
        if (back)
          saveTransaction(d, {
            accountId: mate,
            date: back,
            amount: -(total - mine),
            payee: 'Lea',
            splits: [{ counterAccountId: twint, amount: -(total - mine) }],
          });
      } else {
        spend(
          dd,
          w % 2 ? cash : priv,
          byName('Lebensmittel', 'Groceries'),
          total,
          w % 2 ? 'Coop' : 'Migros',
        );
      }
      if (rand() > 0.5)
        spend(dd, twint, byName('Restaurant', 'Restaurants'), r(1500, 6000), 'Mensa');
      if (rand() > 0.7) spend(dd, priv, byName('Ausgang', 'Going out'), r(2000, 8000), 'Bar');
    }
    const d10 = day(10);
    if (d10) spend(d10, priv, byName('ÖV', 'Public transport'), 4900, 'SBB');
    const d15 = day(15);
    if (d15 && i % 6 === 2)
      spend(d15, priv, byName('Semestergebühren', 'Tuition'), 73000, 'Universität');
    if (d15 && i % 5 === 3)
      spend(d15, priv, byName('Ferien', 'Holidays'), r(20000, 60000), 'Bahnreise', [travel.id]);
    if (d15 && i % 3 === 0)
      spend(d15, priv, byName('Kleidung', 'Clothing'), r(3000, 12000), 'Kleiderladen');
    const d20 = day(20);
    if (d20 && i % 4 === 1) {
      saveTransaction(d, {
        accountId: priv,
        date: d20,
        amount: -50000,
        payee: 'Sparen',
        splits: [{ counterAccountId: savings, amount: -50000 }],
      });
    }
    if (d20 && i % 6 === 4) {
      saveTransaction(d, {
        accountId: savings,
        date: d20,
        amount: -100000,
        payee: 'ETF',
        splits: [{ counterAccountId: depot, amount: -100000 }],
      });
    }
  }

  const budgetPlan: [string, string, number][] = [
    ['Miete', 'Rent', 95000],
    ['Krankenkasse', 'Health insurance', 31500],
    ['Internet & Handy', 'Internet & phone', 4000],
    ['Lebensmittel', 'Groceries', 40000],
    ['Restaurant', 'Restaurants', 12000],
    ['Ausgang', 'Going out', 8000],
    ['ÖV', 'Public transport', 4900],
    ['Kleidung', 'Clothing', 5000],
  ];
  for (let i = 0; i <= 13; i++) {
    const m = addMonths(start, i);
    for (const [de, en, amt] of budgetPlan) setBudget(d, m, byName(de, en), amt);
  }
  const nextMonth = budgetMonthStart(addMonths(currentMonth, 1));
  const rec = (
    name: string,
    catDe: string,
    catEn: string,
    amount: number,
    rrule: string,
    next: string,
    sub: boolean,
  ) =>
    saveRecurring(d, {
      name,
      template: {
        accountId: priv,
        amount: -amount,
        payee: name,
        note: '',
        tagIds: [],
        splits: [{ categoryId: byName(catDe, catEn), amount: -amount, note: '' }],
      },
      rrule,
      nextDate: next,
      isSubscription: sub,
    });
  rec(
    'Wohngenossenschaft',
    'Miete',
    'Rent',
    95000,
    'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=2',
    nextMonth.slice(0, 8) + '02',
    false,
  );
  rec(
    'Krankenkasse Muster',
    'Krankenkasse',
    'Health insurance',
    31500,
    'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=2',
    nextMonth.slice(0, 8) + '02',
    false,
  );
  rec(
    'Streaming Erfunden',
    'Abos',
    'Subscriptions',
    1290,
    'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=20',
    `${currentMonth}-20` > today ? `${currentMonth}-20` : nextMonth.slice(0, 8) + '20',
    true,
  );
  rec(
    'Cloudspeicher',
    'Abos',
    'Subscriptions',
    2900,
    'FREQ=YEARLY;INTERVAL=1;BYMONTHDAY=5',
    `${addMonths(currentMonth, 4)}-05`,
    true,
  );
  const loan = saveAccount(d, {
    name: lang === 'de' ? 'Studienkredit' : 'Student loan',
    type: 'debt',
    openingBalance: -300000,
    openingDate,
  }).id;
  saveRecurring(d, {
    name: lang === 'de' ? 'Rate Studienkredit' : 'Student loan rate',
    template: {
      accountId: priv,
      amount: -25000,
      payee: 'Rate',
      note: '',
      tagIds: [],
      splits: [{ counterAccountId: loan, amount: -25000, note: '' }],
    },
    rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28',
    nextDate: `${currentMonth}-28` > today ? `${currentMonth}-28` : nextMonth.slice(0, 8) + '28',
    isSubscription: false,
  });
  // Anlagen (erfundene Kurse)
  const world = saveSecurity(d, { name: 'Welt-ETF (Demo)', kind: 'etf', ticker: 'WELT' });
  const ch = saveSecurity(d, { name: 'Schweiz-ETF (Demo)', kind: 'etf', ticker: 'SCHW' });
  const fund3a = saveSecurity(d, { name: '3a-Fonds (Demo)', kind: 'fund', ticker: 'VORS' });
  const btc = saveSecurity(d, { name: 'Bitcoin', kind: 'crypto', coingeckoId: 'bitcoin' });
  setHolding(d, depot, world.id, 80, 9000);
  setHolding(d, depot, ch.id, 40, 11000);
  setHolding(d, p3a, fund3a.id, 55, 15500);
  setHolding(d, cryptoAcc, btc.id, 0.05, 5500000);
  let w = 9000,
    c = 11000,
    f = 15500,
    b = 5500000;
  for (let i = 0; i <= 13; i++) {
    const m = addMonths(start, i);
    const dt = `${m}-15` <= today ? `${m}-15` : today;
    w = Math.round(w * (1 + (rand() - 0.42) * 0.06));
    c = Math.round(c * (1 + (rand() - 0.45) * 0.04));
    f = Math.round(f * (1 + (rand() - 0.4) * 0.03));
    b = Math.round(b * (1 + (rand() - 0.45) * 0.2));
    setPrice(d, world.id, dt, w);
    setPrice(d, ch.id, dt, c);
    setPrice(d, fund3a.id, dt, f);
    setPrice(d, btc.id, dt, b);
  }
  saveRule(d, { pattern: 'migros', categoryId: byName('Lebensmittel', 'Groceries') });
  saveRule(d, { pattern: 'coop', categoryId: byName('Lebensmittel', 'Groceries') });
  saveRule(d, { pattern: 'sbb', categoryId: byName('ÖV', 'Public transport') });
  return d;
}
