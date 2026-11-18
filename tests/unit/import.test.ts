// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPreview, commitImport } from '../../src/lib/domain/import/apply';
import { CamtParseError, looksLikeCamt, parseCamt053 } from '../../src/lib/domain/import/camt053';
import {
  detectDateFormat,
  detectDelimiter,
  guessMapping,
  mapRows,
  parseCsv,
  parseDate,
  readTable,
} from '../../src/lib/domain/import/csv';
import { markDuplicates } from '../../src/lib/domain/import/dedupe';
import { saveRule } from '../../src/lib/domain/rules';
import type { ImportProfile } from '../../src/lib/domain/types';
import { cat, setup } from './helpers';

const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures', name), 'utf8');

describe('CSV-Parser', () => {
  it('handles quotes, escaped quotes, delimiters and newlines in fields', () => {
    const rows = parseCsv('a;"b;c";"say ""hi"""\r\n1;"multi\nline";3\n', ';');
    expect(rows).toEqual([
      ['a', 'b;c', 'say "hi"'],
      ['1', 'multi\nline', '3'],
    ]);
  });

  it('detects delimiter and date format', () => {
    expect(detectDelimiter(fixture('bank-semicolon.csv'))).toBe(';');
    expect(detectDelimiter(fixture('bank-comma.csv'))).toBe(',');
    expect(detectDateFormat(['02.03.2026', '15.03.2026'])).toBe('dd.mm.yyyy');
    expect(detectDateFormat(['2026-03-01'])).toBe('yyyy-mm-dd');
    expect(parseDate('31.02.2026', 'dd.mm.yyyy')).toBeNull();
    expect(parseDate('1.3.26', 'dd.mm.yyyy')).toBe('2026-03-01');
    expect(parseDate('03/15/2026', 'mm/dd/yyyy')).toBe('2026-03-15');
  });

  it('maps a Swiss bank export with debit/credit columns', () => {
    const text = fixture('bank-semicolon.csv');
    const table = readTable(text, { delimiter: ';', hasHeader: true, skipRows: 2 });
    const mapping = guessMapping(table.header);
    expect(mapping).toEqual({
      date: 'Buchungsdatum',
      debit: 'Belastung',
      credit: 'Gutschrift',
      payee: 'Buchungstext',
      note: 'Mitteilung',
      reference: 'Referenz',
    });
    const profile: ImportProfile = {
      id: 'p',
      name: 'Test',
      bank: 'Test',
      format: 'csv',
      columnMapping: mapping,
      dateFormat: 'dd.mm.yyyy',
    };
    const { rows, errors } = mapRows(table, profile);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      line: 4,
      date: '2026-03-02',
      amount: -4590,
      payee: 'MIGROS M BERN',
      note: 'Karte 1234',
      reference: 'REF-001',
    });
    expect(rows[2]!.amount).toBe(185000);
    expect(rows[2]!.note).toBe('Lohn März; Teil 1');
    expect(rows[3]!.note).toBe('Halbtax "Verlängerung"');
    expect(errors.map((e) => [e.line, e.field])).toEqual([
      [8, 'date'],
      [9, 'amount'],
    ]);
  });

  it('maps a single signed amount column and can invert the sign', () => {
    const table = readTable(fixture('bank-comma.csv'), { hasHeader: true });
    const profile: ImportProfile = {
      id: 'p',
      name: 'x',
      bank: 'x',
      format: 'csv',
      columnMapping: guessMapping(table.header),
      dateFormat: 'yyyy-mm-dd',
    };
    expect(mapRows(table, profile).rows.map((r) => r.amount)).toEqual([-450, -450, 1200]);
    expect(mapRows(table, { ...profile, invertSign: true }).rows[0]!.amount).toBe(450);
  });

  it('works without header using column numbers', () => {
    const table = readTable('01.03.2026;Kiosk;-3.20\n', { hasHeader: false, delimiter: ';' });
    const { rows } = mapRows(table, {
      id: 'p',
      name: 'x',
      bank: 'x',
      format: 'csv',
      columnMapping: { date: '0', payee: '1', amount: '2' },
    });
    expect(rows[0]).toMatchObject({ date: '2026-03-01', payee: 'Kiosk', amount: -320 });
  });
});

describe('camt.053-Parser', () => {
  it('parses booked entries, parties, references and closing balance', () => {
    const xml = fixture('camt053-sample.xml');
    expect(looksLikeCamt(xml)).toBe(true);
    const st = parseCamt053(xml);
    expect(st.iban).toBe('CH0000000000000000000');
    expect(st.currency).toBe('CHF');
    expect(st.closingBalance).toEqual({ amount: 271910, date: '2026-03-31' });
    expect(st.rows).toHaveLength(3); // PDNG ausgelassen
    expect(st.rows[0]).toMatchObject({
      date: '2026-03-02',
      amount: -4590,
      payee: 'Migros Erfunden',
      note: 'Einkauf Filiale Bern',
      reference: 'BANKREF-1',
    });
    expect(st.rows[1]).toMatchObject({
      date: '2026-03-25',
      amount: 185000,
      payee: 'Werkstudium Erfunden AG',
    });
    expect(st.rows[2]).toMatchObject({ amount: -8500, payee: 'Kartenbezug Erfunden' });
    const sum = st.rows.reduce((a, r) => a + r.amount, 0);
    expect(100000 + sum).toBe(st.closingBalance!.amount);
  });

  it('rejects invalid documents', () => {
    expect(() => parseCamt053('<not-xml')).toThrow(CamtParseError);
    expect(() => parseCamt053('<?xml version="1.0"?><Document/>')).toThrow(CamtParseError);
  });
});

describe('Duplikaterkennung', () => {
  it('uses the bank reference when available, else account/date/amount/text', () => {
    const { d, priv, savings } = setup();
    const rows = [
      { line: 1, date: '2026-03-01', amount: -450, payee: 'Coffee', note: '' },
      { line: 2, date: '2026-03-01', amount: -450, payee: 'Coffee', note: '' },
      { line: 3, date: '2026-03-02', amount: -100, payee: 'X', note: '', reference: 'R1' },
    ];
    const first = markDuplicates(d, priv, rows);
    // zwei gleiche Kaffees sind keine Duplikate voneinander
    expect(new Set(first.map((r) => r.hash)).size).toBe(3);
    expect(first.every((r) => !r.duplicate)).toBe(true);
    // gleiche Zeilen auf anderem Konto: andere Hashes
    expect(markDuplicates(d, savings, rows)[0]!.hash).not.toBe(first[0]!.hash);
    // Referenz geht vor Text
    const changedText = markDuplicates(d, priv, [{ ...rows[2]!, payee: 'Y' }]);
    expect(changedText[0]!.hash).toBe(first[2]!.hash);
  });

  it('import twice → second time everything is a duplicate', () => {
    const { d, priv } = setup();
    const st = parseCamt053(fixture('camt053-sample.xml'));
    const p1 = buildPreview(d, priv, st.rows);
    expect(p1.filter((p) => p.duplicate)).toHaveLength(0);
    expect(commitImport(d, priv, p1)).toBe(3);
    const p2 = buildPreview(d, priv, st.rows);
    expect(p2.every((p) => p.duplicate && !p.include)).toBe(true);
    expect(
      commitImport(
        d,
        priv,
        p2.map((p) => ({ ...p, include: true })),
      ),
    ).toBe(0);
    expect(d.transactions).toHaveLength(3);
  });

  it('suggests categories from rules in the preview', () => {
    const { d, priv } = setup();
    saveRule(d, { pattern: 'migros', categoryId: cat(d, 'Lebensmittel') });
    const st = parseCamt053(fixture('camt053-sample.xml'));
    const preview = buildPreview(d, priv, st.rows);
    expect(preview[0]!.categoryId).toBe(cat(d, 'Lebensmittel'));
    expect(preview[1]!.categoryId).toBeUndefined();
    commitImport(d, priv, preview);
    const tx = d.transactions.find((t) => t.payee === 'Migros Erfunden')!;
    expect(d.splits.find((s) => s.transactionId === tx.id)?.categoryId).toBe(
      cat(d, 'Lebensmittel'),
    );
    expect(tx.importHash).toBeTruthy();
  });
});
