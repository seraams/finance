/**
 * Versioniertes Speicherformat. Jede Migration hebt den Bestand um genau
 * eine Version an. Neue Migrationen werden hinten angehängt.
 */
import { CURRENT_FORMAT_VERSION, defaultPots, defaultSettings } from '../domain/defaults';
import type { Dataset } from '../domain/types';

type Raw = Record<string, unknown>;
type Migration = (d: Raw) => Raw;

const ARRAY_KEYS = [
  'accounts',
  'transactions',
  'splits',
  'categories',
  'tags',
  'pots',
  'potMoves',
  'budgets',
  'recurring',
  'importProfiles',
  'rules',
  'attachments',
  'securities',
  'holdings',
  'prices',
  'snapshots',
  'monthClosings',
] as const;

/** migrations[i] hebt von Version i auf i + 1. */
const migrations: Migration[] = [
  // 0 → 1: Vor-Versionen ohne formatVersion; fehlende Felder ergänzen.
  (d) => {
    const out: Raw = { ...d };
    for (const k of ARRAY_KEYS) if (!Array.isArray(out[k])) out[k] = [];
    out.createdAt ??= new Date().toISOString();
    const accounts = out.accounts as Raw[];
    for (const a of accounts) {
      a.openingBalance ??= 0;
      a.openingDate ??= '1970-01-01';
      a.archived ??= false;
      a.currency ??= 'CHF';
    }
    for (const t of out.transactions as Raw[]) {
      t.tagIds ??= [];
      t.attachmentIds ??= [];
      t.payee ??= '';
      t.note ??= '';
    }
    return out;
  },
];

export class UnsupportedFormatError extends Error {
  constructor(version: number) {
    super(`Data format version ${version} is newer than this app supports`);
  }
}

export function migrate(raw: unknown): Dataset {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid dataset');
  let d = raw as Raw;
  let version = typeof d.formatVersion === 'number' ? d.formatVersion : 0;
  if (version > CURRENT_FORMAT_VERSION) throw new UnsupportedFormatError(version);
  while (version < CURRENT_FORMAT_VERSION) {
    const m = migrations[version];
    if (!m) throw new Error(`Missing migration ${version}`);
    d = m(d);
    version++;
    d.formatVersion = version;
  }
  return normalize(d as unknown as Dataset);
}

/** Stellt Pflichtbestandteile sicher (z. B. Puffer- und Monatsbudget-Topf). */
function normalize(d: Dataset): Dataset {
  const lang = d.settings?.language ?? 'de';
  d.settings = { ...defaultSettings(lang), ...(d.settings ?? {}) };
  const [buffer, monthly] = defaultPots(lang);
  if (!d.pots.some((p) => p.kind === 'buffer')) d.pots.unshift(buffer!);
  if (!d.pots.some((p) => p.kind === 'monthly')) d.pots.splice(1, 0, monthly!);
  return d;
}
