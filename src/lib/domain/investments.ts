/**
 * Vermögen: Wertpapiere, Positionen (Stückzahl, Kaufkurs) und Kurse.
 *
 * Wert eines Anlagekontos = Geldsaldo (Buchungen) + Marktwert der Positionen.
 * Ein Kauf erhöht die Position und senkt den Geldsaldo um denselben Betrag
 * (Buchung mit `holdingId`, zählt nicht als Ausgabe). Ein Verkauf umgekehrt.
 */
import { accountBalances } from './balances';
import { isIsoDate } from './dates';
import { uuidv7 } from './ids';
import { detectDelimiter, parseCsv, parseDate, detectDateFormat } from './import/csv';
import { parseMoney } from './money';
import type {
  Dataset,
  Holding,
  Id,
  IsoDate,
  Money,
  Price,
  Security,
  SecurityKind,
  Transaction,
} from './types';

export const INVESTMENT_ACCOUNT_TYPES = ['brokerage', 'pension3a', 'crypto'] as const;

// ---------- Wertpapiere ----------

export interface SecurityInput {
  id?: Id;
  name: string;
  kind: SecurityKind;
  isin?: string;
  ticker?: string;
  currency?: string;
  coingeckoId?: string;
}

export function isValidIsin(isin: string): boolean {
  const s = isin.trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return false;
  // Luhn über die in Ziffern umgewandelten Zeichen
  const digits = s
    .split('')
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join('');
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export function saveSecurity(d: Dataset, input: SecurityInput): Security {
  const name = input.name.trim();
  if (!name) throw new Error('Name required');
  const isin = input.isin?.trim().toUpperCase() || undefined;
  if (isin && !isValidIsin(isin)) throw new Error('Invalid ISIN');
  const existing = input.id ? d.securities.find((s) => s.id === input.id) : undefined;
  const sec: Security = {
    id: existing?.id ?? uuidv7(),
    name,
    kind: input.kind,
    currency: input.currency ?? existing?.currency ?? d.settings.currency,
    ...(isin ? { isin } : {}),
    ...(input.ticker?.trim() ? { ticker: input.ticker.trim().toUpperCase() } : {}),
    ...(input.coingeckoId?.trim() ? { coingeckoId: input.coingeckoId.trim().toLowerCase() } : {}),
  };
  if (existing) d.securities[d.securities.indexOf(existing)] = sec;
  else d.securities.push(sec);
  return sec;
}

export function deleteSecurity(d: Dataset, id: Id): void {
  if (d.holdings.some((h) => h.securityId === id && h.quantity !== 0)) {
    throw new Error('Security has holdings');
  }
  d.holdings = d.holdings.filter((h) => h.securityId !== id);
  d.prices = d.prices.filter((p) => p.securityId !== id);
  d.securities = d.securities.filter((s) => s.id !== id);
}

// ---------- Kurse ----------

/** Setzt den Kurs eines Wertpapiers an einem Tag (ersetzt einen vorhandenen). */
export function setPrice(d: Dataset, securityId: Id, date: IsoDate, price: Money): void {
  if (!isIsoDate(date) || !Number.isSafeInteger(price) || price < 0)
    throw new Error('Invalid price');
  const i = d.prices.findIndex((p) => p.securityId === securityId && p.date === date);
  if (i >= 0) d.prices[i]!.price = price;
  else d.prices.push({ securityId, date, price });
}

/** Letzter bekannter Kurs bis `asOf` (inklusiv). */
export function latestPrice(d: Dataset, securityId: Id, asOf?: IsoDate): Price | undefined {
  let best: Price | undefined;
  for (const p of d.prices) {
    if (p.securityId !== securityId || (asOf && p.date > asOf)) continue;
    if (!best || p.date > best.date) best = p;
  }
  return best;
}

// ---------- Positionen ----------

/** Marktwert einer Position; ohne Kurs gilt der Kaufkurs. */
export function holdingValue(d: Dataset, h: Holding, asOf?: IsoDate): Money {
  const price = latestPrice(d, h.securityId, asOf)?.price ?? h.costPrice;
  return Math.round(h.quantity * price);
}

/** Marktwert aller Positionen je Konto. */
export function holdingsValueByAccount(d: Dataset, asOf?: IsoDate): Map<Id, Money> {
  const out = new Map<Id, Money>();
  for (const h of d.holdings) {
    if (h.quantity === 0) continue;
    out.set(h.accountId, (out.get(h.accountId) ?? 0) + holdingValue(d, h, asOf));
  }
  return out;
}

/** Wert je Konto: Geldsaldo + Marktwert der Positionen. */
export function accountValues(d: Dataset, asOf?: IsoDate): Map<Id, Money> {
  const out = accountBalances(d, asOf);
  for (const [acc, v] of holdingsValueByAccount(d, asOf)) out.set(acc, (out.get(acc) ?? 0) + v);
  return out;
}

export interface PositionRow {
  holding: Holding;
  security: Security;
  price: Money;
  priceDate?: IsoDate;
  value: Money;
  cost: Money;
  gain: Money;
  /** Gewinn in Prozent der Kosten, `null` ohne Kosten. */
  gainPct: number | null;
}

export function positions(d: Dataset, accountId?: Id, asOf?: IsoDate): PositionRow[] {
  const secs = new Map(d.securities.map((s) => [s.id, s]));
  const rows: PositionRow[] = [];
  for (const h of d.holdings) {
    if (accountId && h.accountId !== accountId) continue;
    if (h.quantity === 0) continue;
    const security = secs.get(h.securityId);
    if (!security) continue;
    const p = latestPrice(d, h.securityId, asOf);
    const price = p?.price ?? h.costPrice;
    const value = Math.round(h.quantity * price);
    const cost = Math.round(h.quantity * h.costPrice);
    rows.push({
      holding: h,
      security,
      price,
      ...(p ? { priceDate: p.date } : {}),
      value,
      cost,
      gain: value - cost,
      gainPct: cost > 0 ? (value - cost) / cost : null,
    });
  }
  return rows.sort((a, b) => b.value - a.value);
}

export interface TradeInput {
  accountId: Id;
  securityId: Id;
  date: IsoDate;
  /** Positiv = Kauf, negativ = Verkauf (Stück). */
  quantity: number;
  /** Kurs pro Stück in Rappen. */
  price: Money;
  /** Gebühren in Rappen (positiv), erhöhen beim Kauf die Kosten. */
  fee?: Money;
  /** Geldfluss im Konto buchen (Standard: ja). */
  bookCash?: boolean;
}

export interface TradeResult {
  holding: Holding;
  transaction?: Transaction;
  /** Realisierter Gewinn beim Verkauf (Erlös − Kostenbasis), sonst 0. */
  realized: Money;
}

const EPS = 1e-9;

/**
 * Kauf oder Verkauf. Kauf: gewichteter durchschnittlicher Kaufkurs (inkl.
 * Gebühren). Verkauf: Kaufkurs pro Stück bleibt, Menge sinkt.
 */
export function recordTrade(d: Dataset, input: TradeInput): TradeResult {
  if (!Number.isFinite(input.quantity) || input.quantity === 0)
    throw new Error('Quantity required');
  if (!Number.isSafeInteger(input.price) || input.price < 0) throw new Error('Invalid price');
  if (!d.accounts.some((a) => a.id === input.accountId)) throw new Error('Account missing');
  if (!d.securities.some((s) => s.id === input.securityId)) throw new Error('Security missing');
  const fee = Math.max(0, input.fee ?? 0);
  let h = d.holdings.find(
    (x) => x.accountId === input.accountId && x.securityId === input.securityId,
  );
  if (!h) {
    if (input.quantity < 0) throw new Error('Nothing to sell');
    h = {
      id: uuidv7(),
      accountId: input.accountId,
      securityId: input.securityId,
      quantity: 0,
      costPrice: 0,
    };
    d.holdings.push(h);
  }
  const gross = Math.round(Math.abs(input.quantity) * input.price);
  let realized = 0;
  let cash: Money;
  if (input.quantity > 0) {
    const totalCost = h.quantity * h.costPrice + gross + fee;
    h.quantity = roundQty(h.quantity + input.quantity);
    h.costPrice = Math.round(totalCost / h.quantity);
    cash = -(gross + fee);
  } else {
    const sell = -input.quantity;
    if (sell > h.quantity + EPS) throw new Error('Not enough quantity');
    realized = gross - fee - Math.round(sell * h.costPrice);
    h.quantity = roundQty(h.quantity - sell);
    if (Math.abs(h.quantity) < EPS) h.quantity = 0;
    cash = gross - fee;
  }
  setPrice(d, input.securityId, input.date, input.price);
  let transaction: Transaction | undefined;
  if (input.bookCash !== false && cash !== 0) {
    const sec = d.securities.find((s) => s.id === input.securityId)!;
    transaction = {
      id: uuidv7(),
      accountId: input.accountId,
      date: input.date,
      amount: cash,
      payee: sec.name,
      note: `${input.quantity > 0 ? '+' : ''}${input.quantity}`,
      holdingId: h.id,
      tagIds: [],
      attachmentIds: [],
    };
    d.transactions.push(transaction);
  }
  return { holding: h, ...(transaction ? { transaction } : {}), realized };
}

/** Stückzahlen auf 10 Nachkommastellen runden (Gleitkomma-Rauschen vermeiden). */
function roundQty(q: number): number {
  return Math.round(q * 1e10) / 1e10;
}

/** Position direkt setzen (z. B. Übernahme eines bestehenden Depots, ohne Geldfluss). */
export function setHolding(
  d: Dataset,
  accountId: Id,
  securityId: Id,
  quantity: number,
  costPrice: Money,
): Holding {
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Invalid quantity');
  let h = d.holdings.find((x) => x.accountId === accountId && x.securityId === securityId);
  if (!h) {
    h = { id: uuidv7(), accountId, securityId, quantity, costPrice };
    d.holdings.push(h);
  } else {
    h.quantity = quantity;
    h.costPrice = costPrice;
  }
  return h;
}

// ---------- Kurs-Import (CSV) ----------

export interface PriceRow {
  line: number;
  key: string;
  date: IsoDate;
  price: Money;
}

/**
 * Liest Kurse aus CSV. Erwartet eine Kopfzeile mit Datum, ISIN oder Ticker
 * und Kurs (Spaltennamen deutsch oder englisch).
 */
export function parsePriceCsv(text: string): { rows: PriceRow[]; errors: number[] } {
  const delimiter = detectDelimiter(text);
  const all = parseCsv(text, delimiter);
  const header = (all[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const cDate = col(/^(datum|date)$/);
  const cKey = col(/^(isin|ticker|symbol|valor)$/);
  const cPrice = col(/^(kurs|price|preis|close|schlusskurs)$/);
  const rows: PriceRow[] = [];
  const errors: number[] = [];
  if (cDate < 0 || cKey < 0 || cPrice < 0) return { rows, errors: [1] };
  const body = all.slice(1);
  const fmt = detectDateFormat(body.slice(0, 20).map((r) => r[cDate] ?? ''));
  body.forEach((r, i) => {
    const date = parseDate(r[cDate] ?? '', fmt);
    const price = parseMoney(r[cPrice] ?? '');
    const key = (r[cKey] ?? '').trim().toUpperCase();
    if (!date || price === null || price < 0 || !key) errors.push(i + 2);
    else rows.push({ line: i + 2, key, date, price });
  });
  return { rows, errors };
}

/** Übernimmt Kurse; Zuordnung über ISIN oder Ticker. Gibt die Anzahl zurück. */
export function importPrices(
  d: Dataset,
  rows: PriceRow[],
): { imported: number; unknown: string[] } {
  const byKey = new Map<string, Id>();
  for (const s of d.securities) {
    if (s.isin) byKey.set(s.isin.toUpperCase(), s.id);
    if (s.ticker) byKey.set(s.ticker.toUpperCase(), s.id);
  }
  let imported = 0;
  const unknown = new Set<string>();
  for (const r of rows) {
    const id = byKey.get(r.key);
    if (!id) {
      unknown.add(r.key);
      continue;
    }
    setPrice(d, id, r.date, r.price);
    imported++;
  }
  return { imported, unknown: [...unknown] };
}
