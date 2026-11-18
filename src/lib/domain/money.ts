import type { Money } from './types';

export type { Money };

/**
 * Parst eine Benutzereingabe in Rappen.
 *
 * Akzeptiert u. a. `12`, `12.5`, `12,50`, `1'234.50`, `1’234.50`, `1 234,50`,
 * `-12.30`, `CHF 12.00`, `1.234,50`, `1,234.50`.
 * Gibt `null` zurück, wenn die Eingabe keine gültige Zahl ist oder mehr als
 * zwei Nachkommastellen hat.
 */
export function parseMoney(input: string): Money | null {
  let s = input.trim();
  if (s === '') return null;
  s = s.replace(/^(CHF|Fr\.?|SFr\.?)\s*/i, '').replace(/\s*(CHF|Fr\.?)$/i, '');
  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  // Tausendertrennzeichen: Apostroph, typografischer Apostroph, Leerzeichen.
  s = s.replace(/['’\u00a0\u202f ]/g, '');
  if (s.endsWith('.-') || s.endsWith(',-') || s.endsWith('.–')) s = s.slice(0, -2);
  if (!/^[0-9.,]+$/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart: string;
  let fracPart = '';
  if (lastDot >= 0 && lastComma >= 0) {
    // Beide vorhanden: das letzte Zeichen ist der Dezimaltrenner.
    const decIdx = Math.max(lastDot, lastComma);
    const thousandSep = decIdx === lastDot ? ',' : '.';
    intPart = s.slice(0, decIdx).split(thousandSep).join('');
    fracPart = s.slice(decIdx + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    if (parts.length > 2) {
      // Mehrfach vorkommend → Tausendertrenner (z. B. 1.234.567)
      if (!parts.slice(1).every((p) => p.length === 3)) return null;
      intPart = parts.join('');
    } else {
      intPart = parts[0] ?? '';
      fracPart = parts[1] ?? '';
    }
  } else {
    intPart = s;
  }
  if (!/^[0-9]*$/.test(intPart) || !/^[0-9]*$/.test(fracPart)) return null;
  if (intPart === '' && fracPart === '') return null;
  if (fracPart.length > 2) return null;
  const francs = intPart === '' ? 0 : Number(intPart);
  const cents = Number(fracPart.padEnd(2, '0') || '0');
  const value = francs * 100 + cents;
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

export interface FormatOptions {
  /** Währungscode voranstellen, z. B. `CHF 1'234.50`. */
  currency?: string;
  /** Vorzeichen auch bei positiven Beträgen anzeigen. */
  signed?: boolean;
  /** Ohne Rappen, gerundet (für Diagrammachsen). */
  whole?: boolean;
}

/** Formatiert Rappen im Schweizer Format: `1'234.50`. */
export function formatMoney(amount: Money, opts: FormatOptions = {}): string {
  if (!Number.isFinite(amount)) return '–';
  const negative = amount < 0;
  const abs = Math.abs(Math.round(amount));
  let francs = Math.floor(abs / 100);
  const cents = abs % 100;
  if (opts.whole && cents >= 50) francs += 1;
  const grouped = String(francs).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  const body = opts.whole ? grouped : `${grouped}.${String(cents).padStart(2, '0')}`;
  const sign = negative ? '−' : opts.signed && amount > 0 ? '+' : '';
  const prefix = opts.currency ? `${opts.currency} ` : '';
  return `${sign}${prefix}${body}`;
}

/** Wandelt Rappen in einen Eingabestring ohne Tausendertrenner um (`1234.50`). */
export function moneyToInput(amount: Money): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${s}` : s;
}

export function sum(values: Iterable<Money>): Money {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Rundet auf ganze Franken ab (in Rappen). */
export function floorToFranc(amount: Money): Money {
  return Math.floor(amount / 100) * 100;
}
