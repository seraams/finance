/**
 * CSV-Import mit frei konfigurierbarer Spaltenzuordnung.
 */
import { isIsoDate } from '../dates';
import { parseMoney } from '../money';
import type { CsvField, DateFormat, ImportProfile, IsoDate, Money } from '../types';

/** Eine eingelesene Zeile, bevor sie zur Buchung wird. */
export interface ImportedRow {
  /** Zeilennummer in der Datei (1-basiert), für Fehlermeldungen. */
  line: number;
  date: IsoDate;
  amount: Money;
  payee: string;
  note: string;
  /** Eindeutige Bankreferenz, falls vorhanden. */
  reference?: string;
}

export interface RowError {
  line: number;
  field: CsvField | 'row';
  value: string;
}

export interface CsvResult {
  rows: ImportedRow[];
  errors: RowError[];
}

/** Erkennt das Trennzeichen anhand der ersten Zeilen. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const candidates = [';', ',', '\t', '|'];
  let best = ';';
  let bestCount = -1;
  for (const c of candidates) {
    const n = parseCsv(sample, c).reduce((a, r) => a + (r.length > 1 ? r.length : 0), 0);
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

/** RFC-4180-artiger Parser (Anführungszeichen, verdoppelte Quotes, Zeilenumbrüche in Feldern). */
export function parseCsv(text: string, delimiter = ';'): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Parst ein Datum im angegebenen Format nach ISO. */
export function parseDate(value: string, format: DateFormat): IsoDate | null {
  const v = value.trim().split(/[ T]/)[0] ?? '';
  let y: string | undefined, m: string | undefined, d: string | undefined;
  const parts = v.split(/[./-]/);
  if (parts.length !== 3) return null;
  switch (format) {
    case 'yyyy-mm-dd':
      [y, m, d] = parts;
      break;
    case 'dd.mm.yyyy':
    case 'dd/mm/yyyy':
      [d, m, y] = parts;
      break;
    case 'mm/dd/yyyy':
      [m, d, y] = parts;
      break;
  }
  if (!y || !m || !d) return null;
  if (y.length === 2) y = `20${y}`;
  const iso = `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/** Errät das Datumsformat aus Beispielwerten. */
export function detectDateFormat(samples: string[]): DateFormat {
  const formats: DateFormat[] = ['dd.mm.yyyy', 'yyyy-mm-dd', 'dd/mm/yyyy', 'mm/dd/yyyy'];
  let best: DateFormat = 'dd.mm.yyyy';
  let bestScore = -1;
  for (const f of formats) {
    const score = samples.filter((s) => parseDate(s, f) !== null).length;
    if (score > bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best;
}

export interface CsvTable {
  header: string[];
  rows: string[][];
  /** Zeilennummer der ersten Datenzeile (1-basiert). */
  firstLine: number;
}

export function readTable(
  text: string,
  profile: Pick<ImportProfile, 'delimiter' | 'hasHeader' | 'skipRows'>,
): CsvTable {
  const delimiter = profile.delimiter || detectDelimiter(text);
  const all = parseCsv(text, delimiter);
  const skip = profile.skipRows ?? 0;
  const body = all.slice(skip);
  const hasHeader = profile.hasHeader ?? true;
  const width = Math.max(0, ...body.map((r) => r.length));
  const header = hasHeader
    ? (body[0] ?? []).map((h) => h.trim())
    : Array.from({ length: width }, (_, i) => String(i));
  return {
    header,
    rows: hasHeader ? body.slice(1) : body,
    firstLine: skip + (hasHeader ? 2 : 1),
  };
}

const HEADER_GUESSES: Record<CsvField, RegExp> = {
  date: /^(buchungs?datum|datum|date|booking date|transaction date|valuta)/i,
  amount: /^(betrag|amount|summe|umsatz)/i,
  debit: /^(belastung|soll|debit|lastschrift|ausgang)/i,
  credit: /^(gutschrift|haben|credit|eingang)/i,
  payee:
    /^(empfänger|auftraggeber|name|payee|gegenpartei|beschreibung|description|text|buchungstext)/i,
  note: /^(mitteilung|verwendungszweck|zahlungszweck|notiz|note|memo|details)/i,
  reference: /^(referenz|reference|transaktions-?id|id)$/i,
};

/** Schlägt eine Spaltenzuordnung anhand der Kopfzeile vor. */
export function guessMapping(header: string[]): Partial<Record<CsvField, string>> {
  const out: Partial<Record<CsvField, string>> = {};
  for (const field of Object.keys(HEADER_GUESSES) as CsvField[]) {
    const col = header.find(
      (h) => HEADER_GUESSES[field].test(h.trim()) && !Object.values(out).includes(h),
    );
    if (col !== undefined) out[field] = col;
  }
  if (out.amount && (out.debit || out.credit)) {
    delete out.debit;
    delete out.credit;
  }
  return out;
}

/** Wandelt Tabellenzeilen anhand des Profils in Import-Zeilen um. */
export function mapRows(table: CsvTable, profile: ImportProfile): CsvResult {
  const map = profile.columnMapping;
  const idx = (f: CsvField): number => {
    const col = map[f];
    if (col === undefined || col === '') return -1;
    return table.header.indexOf(col);
  };
  const cols = {
    date: idx('date'),
    amount: idx('amount'),
    debit: idx('debit'),
    credit: idx('credit'),
    payee: idx('payee'),
    note: idx('note'),
    reference: idx('reference'),
  };
  const format = profile.dateFormat ?? 'dd.mm.yyyy';
  const rows: ImportedRow[] = [];
  const errors: RowError[] = [];
  table.rows.forEach((r, i) => {
    const line = table.firstLine + i;
    const cell = (c: number) => (c >= 0 ? (r[c] ?? '').trim() : '');
    const rawDate = cell(cols.date);
    const date = parseDate(rawDate, format);
    if (!date) {
      errors.push({ line, field: 'date', value: rawDate });
      return;
    }
    let amount: Money | null;
    if (cols.amount >= 0) {
      amount = parseMoney(cell(cols.amount));
      if (amount === null) {
        errors.push({ line, field: 'amount', value: cell(cols.amount) });
        return;
      }
    } else {
      const debitRaw = cell(cols.debit);
      const creditRaw = cell(cols.credit);
      const debit = debitRaw ? parseMoney(debitRaw) : 0;
      const credit = creditRaw ? parseMoney(creditRaw) : 0;
      if (debit === null || credit === null || (!debitRaw && !creditRaw)) {
        errors.push({ line, field: 'amount', value: `${debitRaw}|${creditRaw}` });
        return;
      }
      amount = Math.abs(credit) - Math.abs(debit);
    }
    if (profile.invertSign) amount = -amount;
    if (amount === 0) {
      errors.push({ line, field: 'amount', value: '0' });
      return;
    }
    const reference = cell(cols.reference);
    rows.push({
      line,
      date,
      amount,
      payee: cell(cols.payee),
      note: cell(cols.note),
      ...(reference ? { reference } : {}),
    });
  });
  return { rows, errors };
}

/** Findet die Kopfzeile (Bank-Vorspann überspringen): erste Zeile mit Datums- und Betragsspalte. */
export function detectSkipRows(text: string, delimiter?: string): number {
  for (let skip = 0; skip <= 15; skip++) {
    const t = readTable(text, {
      ...(delimiter ? { delimiter } : {}),
      hasHeader: true,
      skipRows: skip,
    });
    if (t.header.length === 0) break;
    const m = guessMapping(t.header);
    if (m.date && (m.amount || m.debit || m.credit)) return skip;
  }
  return 0;
}
