import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkInvariant } from '../../src/lib/domain/invariant';
import {
  accountValues,
  deleteSecurity,
  importPrices,
  isValidIsin,
  latestPrice,
  parsePriceCsv,
  positions,
  recordTrade,
  saveSecurity,
  setHolding,
  setPrice,
} from '../../src/lib/domain/investments';
import { netWorth, netWorthHistory, yearReport } from '../../src/lib/domain/networth';
import { updateSnapshots } from '../../src/lib/domain/snapshots';
import { monthlyFlows } from '../../src/lib/domain/stats';
import { saveTransaction } from '../../src/lib/domain/transactions';
import { uncategorizedInMonth } from '../../src/lib/domain/closing';
import { saveAccount } from '../../src/lib/domain/entities';
import { coingeckoUrl, fetchCryptoPrices, parseCoingecko } from '../../src/lib/prices/coingecko';
import { cat, setup } from './helpers';

describe('Wertpapiere und Positionen', () => {
  it('validates ISINs', () => {
    expect(isValidIsin('IE00B4L5Y983')).toBe(true);
    expect(isValidIsin('CH0038863350')).toBe(true);
    expect(isValidIsin('IE00B4L5Y984')).toBe(false);
    expect(isValidIsin('ABC')).toBe(false);
  });

  it('buys and sells with weighted average cost and cash bookings', () => {
    const { d, savings, depot } = setup();
    const etf = saveSecurity(d, {
      name: 'Welt-ETF',
      kind: 'etf',
      isin: 'ie00b4l5y983',
      ticker: 'iwda',
    });
    expect(etf.isin).toBe('IE00B4L5Y983');
    // Geld ins Depot (aus dem Puffer)
    saveTransaction(d, {
      accountId: savings,
      date: '2026-01-05',
      amount: -200000,
      splits: [{ counterAccountId: depot, amount: -200000 }],
    });
    recordTrade(d, {
      accountId: depot,
      securityId: etf.id,
      date: '2026-01-10',
      quantity: 10,
      price: 9000,
      fee: 500,
    });
    recordTrade(d, {
      accountId: depot,
      securityId: etf.id,
      date: '2026-02-10',
      quantity: 10,
      price: 10000,
    });
    const [pos] = positions(d, depot);
    expect(pos!.holding.quantity).toBe(20);
    expect(pos!.holding.costPrice).toBe(9525); // (90'500 + 100'000) / 20
    expect(pos!.price).toBe(10000);
    expect(pos!.value).toBe(200000);
    expect(pos!.gain).toBe(200000 - 190500);
    // Depotwert: Anfangssaldo 10'000 + 2'000 Einzahlung − Käufe + Marktwert
    expect(accountValues(d).get(depot)).toBe(1000000 + 200000 - 190500 + 200000);
    const sell = recordTrade(d, {
      accountId: depot,
      securityId: etf.id,
      date: '2026-03-01',
      quantity: -5,
      price: 11000,
    });
    expect(sell.realized).toBe(55000 - 5 * 9525);
    expect(positions(d, depot)[0]!.holding.quantity).toBe(15);
    expect(() =>
      recordTrade(d, {
        accountId: depot,
        securityId: etf.id,
        date: '2026-03-02',
        quantity: -100,
        price: 1,
      }),
    ).toThrow();
    // Käufe/Verkäufe sind keine Einnahmen/Ausgaben und nicht «unkategorisiert»
    expect(
      monthlyFlows(d, ['2026-01', '2026-02', '2026-03']).every(
        (f) => f.income === 0 && f.expense === 0,
      ),
    ).toBe(true);
    expect(uncategorizedInMonth(d, '2026-01')).toEqual([]);
    expect(checkInvariant(d).ok).toBe(true);
    expect(() => deleteSecurity(d, etf.id)).toThrow();
  });

  it('handles fractional crypto quantities', () => {
    const { d } = setup();
    const wallet = saveAccount(d, { name: 'Krypto', type: 'crypto', openingDate: '2026-01-01' });
    const btc = saveSecurity(d, { name: 'Bitcoin', kind: 'crypto', coingeckoId: 'Bitcoin' });
    expect(btc.coingeckoId).toBe('bitcoin');
    setHolding(d, wallet.id, btc.id, 0.0123, 5000000);
    setPrice(d, btc.id, '2026-03-01', 8123456);
    expect(positions(d, wallet.id)[0]!.value).toBe(Math.round(0.0123 * 8123456));
    recordTrade(d, {
      accountId: wallet.id,
      securityId: btc.id,
      date: '2026-03-02',
      quantity: 0.1,
      price: 8000000,
      bookCash: false,
    });
    expect(positions(d, wallet.id)[0]!.holding.quantity).toBe(0.1123);
  });

  it('uses the latest price up to a date', () => {
    const { d } = setup();
    const s = saveSecurity(d, { name: 'X', kind: 'stock' });
    setPrice(d, s.id, '2026-01-31', 100);
    setPrice(d, s.id, '2026-02-28', 120);
    setPrice(d, s.id, '2026-02-28', 125);
    expect(latestPrice(d, s.id)?.price).toBe(125);
    expect(latestPrice(d, s.id, '2026-02-15')?.price).toBe(100);
    expect(latestPrice(d, s.id, '2026-01-01')).toBeUndefined();
    expect(d.prices).toHaveLength(2);
  });
});

describe('Kurs-Import (CSV)', () => {
  it('imports by ISIN and reports unknown keys and bad rows', () => {
    const { d } = setup();
    const etf = saveSecurity(d, { name: 'Welt-ETF', kind: 'etf', isin: 'IE00B4L5Y983' });
    const text = readFileSync(join(__dirname, '../fixtures/prices.csv'), 'utf8');
    const { rows, errors } = parsePriceCsv(text);
    expect(rows).toHaveLength(3);
    expect(errors).toEqual([5]);
    const r = importPrices(d, rows);
    expect(r).toEqual({ imported: 2, unknown: ['XX0000000000'] });
    expect(latestPrice(d, etf.id)).toEqual({ securityId: etf.id, date: '2026-02-28', price: 9725 });
    expect(parsePriceCsv('a;b\n1;2').errors).toEqual([1]);
  });
});

describe('CoinGecko', () => {
  it('builds the URL without amounts and parses responses', async () => {
    const url = coingeckoUrl(['Bitcoin', 'ethereum', 'bitcoin', 'bad id!']);
    expect(url).toBe(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin%2Cethereum&vs_currencies=chf',
    );
    const prices = parseCoingecko({ bitcoin: { chf: 81234.567 }, ethereum: { usd: 1 }, x: null });
    expect([...prices]).toEqual([['bitcoin', 8123457]]);
    const fake = (async () =>
      new Response(JSON.stringify({ bitcoin: { chf: 1.5 } }))) as typeof fetch;
    expect((await fetchCryptoPrices(['bitcoin'], 'chf', fake)).get('bitcoin')).toBe(150);
    expect((await fetchCryptoPrices([], 'chf', fake)).size).toBe(0);
    const failing = (async () => new Response('x', { status: 429 })) as typeof fetch;
    await expect(fetchCryptoPrices(['bitcoin'], 'chf', failing)).rejects.toThrow('429');
  });
});

describe('Vermögen und Jahresübersicht', () => {
  it('includes holdings in snapshots and builds history and year report', () => {
    const { d, priv, depot } = setup();
    const loan = saveAccount(d, {
      name: 'Kredit',
      type: 'debt',
      openingBalance: -100000,
      openingDate: '2026-01-01',
    });
    const etf = saveSecurity(d, { name: 'ETF', kind: 'etf' });
    setHolding(d, depot, etf.id, 10, 10000);
    setPrice(d, etf.id, '2026-01-31', 10000);
    setPrice(d, etf.id, '2026-02-28', 12000);
    saveTransaction(d, {
      accountId: priv,
      date: '2026-01-25',
      amount: 300000,
      splits: [{ categoryId: cat(d, 'Lohn'), amount: 300000 }],
    });
    saveTransaction(d, {
      accountId: priv,
      date: '2026-02-03',
      amount: -50000,
      splits: [{ categoryId: cat(d, 'Miete'), amount: -50000 }],
    });
    updateSnapshots(d, '2026-03-05');
    const depotJan = d.snapshots.find((s) => s.accountId === depot && s.month === '2026-01')!;
    const depotFeb = d.snapshots.find((s) => s.accountId === depot && s.month === '2026-02')!;
    expect(depotJan.balance).toBe(1000000 + 100000);
    expect(depotFeb.balance).toBe(1000000 + 120000);
    const nw = netWorth(d);
    expect(nw).toEqual({
      liquid: 100000 + 300000 - 50000 + 500000,
      investments: 1120000,
      debts: -100000,
      other: 0,
      total: 850000 + 1120000 - 100000,
    });
    const hist = netWorthHistory(d);
    expect(hist.map((h) => h.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(hist[1]!.total - hist[0]!.total).toBe(-50000 + 20000);
    const y = yearReport(d, 2026);
    expect(y.income).toBe(300000);
    expect(y.expense).toBe(50000);
    expect(y.rows[1]!.netWorthChange).toBe(-30000);
    expect(y.rows[0]!.netWorthChange).toBeNull();
    expect(y.bestMonth).toBe('2026-01');
    expect(y.worstMonth).toBe('2026-02');
    expect(y.byCategory[0]).toEqual({ categoryId: cat(d, 'Wohnen'), amount: 50000 });
    expect(y.netWorthEnd).toBe(hist[2]!.total);
    expect(loan.budgetRelevant).toBe(false);
  });
});
