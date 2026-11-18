/**
 * camt.053 (ISO 20022, Kontoauszug) – Parser auf Basis von DOMParser.
 * Unterstützt die gängigen Versionen (.001.02 bis .001.08), unabhängig vom Namensraum.
 */
import { isIsoDate } from '../dates';
import { parseMoney } from '../money';
import type { Money } from '../types';
import type { ImportedRow } from './csv';

export interface CamtStatement {
  iban?: string;
  currency?: string;
  /** Schlusssaldo laut Bank (CLBD), falls vorhanden. */
  closingBalance?: { amount: Money; date: string };
  rows: ImportedRow[];
}

type DomParserCtor = new () => { parseFromString(s: string, type: string): Document };

function children(el: Element | Document, name: string): Element[] {
  return Array.from(el.getElementsByTagNameNS('*', name));
}

/** Erstes Element entlang eines Pfads direkter Kinder (lokale Namen). */
function path(el: Element | undefined, ...names: string[]): Element | undefined {
  let cur: Element | undefined = el;
  for (const n of names) {
    if (!cur) return undefined;
    cur = Array.from(cur.children).find((c) => c.localName === n);
  }
  return cur;
}

function text(el: Element | undefined): string {
  return el?.textContent?.trim().replace(/\s+/g, ' ') ?? '';
}

function amountOf(el: Element | undefined): Money | null {
  const raw = text(el);
  if (!raw) return null;
  return parseMoney(raw);
}

function dateOf(el: Element | undefined): string {
  const v = text(path(el, 'Dt')) || text(path(el, 'DtTm')).slice(0, 10);
  return isIsoDate(v) ? v : '';
}

export class CamtParseError extends Error {}

export function parseCamt053(xml: string, Parser: DomParserCtor = DOMParser): CamtStatement {
  const doc = new Parser().parseFromString(xml, 'application/xml');
  if (children(doc, 'parsererror').length > 0 || doc.getElementsByTagName('parsererror').length) {
    throw new CamtParseError('Invalid XML');
  }
  const stmt = children(doc, 'Stmt')[0];
  if (!stmt) throw new CamtParseError('No camt.053 statement (Stmt) found');

  const acct = path(stmt, 'Acct');
  const iban = text(path(acct, 'Id', 'IBAN')) || undefined;
  const currency = text(path(acct, 'Ccy')) || undefined;

  let closingBalance: CamtStatement['closingBalance'];
  for (const bal of Array.from(stmt.children).filter((c) => c.localName === 'Bal')) {
    const code = text(path(bal, 'Tp', 'CdOrPrtry', 'Cd'));
    if (code !== 'CLBD') continue;
    const amt = amountOf(path(bal, 'Amt'));
    const sign = text(path(bal, 'CdtDbtInd')) === 'DBIT' ? -1 : 1;
    if (amt !== null) closingBalance = { amount: sign * amt, date: dateOf(path(bal, 'Dt')) };
  }

  const rows: ImportedRow[] = [];
  const entries = Array.from(stmt.children).filter((c) => c.localName === 'Ntry');
  entries.forEach((ntry, i) => {
    // Nur gebuchte Einträge (Status BOOK); fehlt der Status, gilt er als gebucht.
    const status = text(path(ntry, 'Sts', 'Cd')) || text(path(ntry, 'Sts'));
    if (status && status !== 'BOOK') return;
    const amt = amountOf(path(ntry, 'Amt'));
    if (amt === null) return;
    const debit = text(path(ntry, 'CdtDbtInd')) === 'DBIT';
    const reversal = text(path(ntry, 'RvslInd')) === 'true';
    const sign = (debit ? -1 : 1) * (reversal ? -1 : 1);
    const date = dateOf(path(ntry, 'BookgDt')) || dateOf(path(ntry, 'ValDt'));
    if (!date) return;

    const tx = children(ntry, 'TxDtls')[0];
    const party = (role: 'Dbtr' | 'Cdtr') => {
      const rp = tx ? path(tx, 'RltdPties', role) : undefined;
      return text(path(rp, 'Nm')) || text(path(rp, 'Pty', 'Nm'));
    };
    // Bei Abflüssen interessiert der Empfänger, bei Zuflüssen der Auftraggeber.
    const payee = (debit ? party('Cdtr') : party('Dbtr')) || text(path(ntry, 'AddtlNtryInf'));
    const ustrd = tx
      ? children(tx, 'Ustrd')
          .map((u) => text(u))
          .filter(Boolean)
      : [];
    const note = [
      ...ustrd,
      payee === text(path(ntry, 'AddtlNtryInf')) ? '' : text(path(ntry, 'AddtlNtryInf')),
    ]
      .filter(Boolean)
      .join(' · ');
    const reference =
      text(path(ntry, 'AcctSvcrRef')) ||
      (tx ? text(path(tx, 'Refs', 'AcctSvcrRef')) || text(path(tx, 'Refs', 'EndToEndId')) : '') ||
      undefined;
    rows.push({
      line: i + 1,
      date,
      amount: sign * amt,
      payee,
      note,
      ...(reference && reference !== 'NOTPROVIDED' ? { reference } : {}),
    });
  });

  return {
    ...(iban ? { iban } : {}),
    ...(currency ? { currency } : {}),
    ...(closingBalance ? { closingBalance } : {}),
    rows,
  };
}

export function looksLikeCamt(text: string): boolean {
  return (
    /<\?xml|<Document[\s>]/.test(text.slice(0, 2000)) && /camt\.05[34]/.test(text.slice(0, 4000))
  );
}
