/**
 * Auto-Regeln: «Text enthält X → Kategorie Y» und Vorschläge aus manuellen Kategorisierungen.
 */
import { isMirror } from './balances';
import { uuidv7 } from './ids';
import type { Dataset, Id, Rule } from './types';

export interface RuleTarget {
  payee: string;
  note: string;
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

export function ruleMatches(rule: Rule, t: RuleTarget): boolean {
  const pattern = norm(rule.pattern);
  if (!pattern) return false;
  const hay =
    rule.field === 'payee' ? t.payee : rule.field === 'note' ? t.note : `${t.payee} ${t.note}`;
  return norm(hay).includes(pattern);
}

/** Sortiert nach Priorität (höher zuerst), dann nach Musterlänge (spezifischer zuerst). */
export function sortedRules(rules: readonly Rule[]): Rule[] {
  return [...rules].sort((a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length);
}

/** Kategorie der ersten passenden Regel, sonst `undefined`. */
export function applyRules(
  rules: readonly Rule[],
  t: RuleTarget,
  validCategoryIds?: Set<Id>,
): Id | undefined {
  for (const r of sortedRules(rules)) {
    if (validCategoryIds && !validCategoryIds.has(r.categoryId)) continue;
    if (ruleMatches(r, t)) return r.categoryId;
  }
  return undefined;
}

export interface RuleInput {
  id?: Id;
  pattern: string;
  field?: Rule['field'];
  categoryId: Id;
  priority?: number;
}

export function saveRule(d: Dataset, input: RuleInput): Rule {
  const pattern = input.pattern.trim();
  if (!pattern) throw new Error('Pattern required');
  const existing = input.id ? d.rules.find((r) => r.id === input.id) : undefined;
  const rule: Rule = {
    id: existing?.id ?? uuidv7(),
    pattern,
    field: input.field ?? 'payee',
    categoryId: input.categoryId,
    priority: input.priority ?? 0,
  };
  if (existing) d.rules[d.rules.indexOf(existing)] = rule;
  else d.rules.push(rule);
  return rule;
}

export function deleteRule(d: Dataset, id: Id): void {
  d.rules = d.rules.filter((r) => r.id !== id);
}

/**
 * Leitet aus einem Empfängertext ein Regelmuster ab: entfernt Zahlen,
 * Datumsangaben und Kartenreferenzen. Behält das erste Wort, bei kurzen
 * Wörtern (unter 4 Zeichen) zusätzlich das zweite.
 * «MIGROS M BERN 12.03.2026 Karte 1234» → «migros», «SBB CFF FFS» → «sbb cff».
 */
export function patternFromPayee(payee: string): string {
  const words = norm(payee)
    .replace(/[0-9][0-9.,:/-]*/g, ' ')
    .replace(/[^a-z&' -]/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 2 && !['karte', 'card', 'nr', 'ag', 'gmbh', 'sa', 'ch'].includes(w));
  const first = words[0] ?? '';
  return first.length < 4 && words[1] ? `${first} ${words[1]}` : first;
}

export interface RuleSuggestion {
  pattern: string;
  categoryId: Id;
  /** Wie oft der Nutzer so kategorisiert hat. */
  count: number;
}

/**
 * Vorschläge aus manuellen Kategorisierungen: Empfänger, die mindestens
 * `minCount`-mal einheitlich derselben Kategorie zugeordnet wurden und noch
 * von keiner Regel erfasst werden.
 */
export function suggestRules(d: Dataset, minCount = 2): RuleSuggestion[] {
  const byPattern = new Map<string, Map<Id, number>>();
  const splitsByTx = new Map<Id, Id[]>();
  for (const s of d.splits) {
    if (!s.categoryId) continue;
    const l = splitsByTx.get(s.transactionId);
    if (l) l.push(s.categoryId);
    else splitsByTx.set(s.transactionId, [s.categoryId]);
  }
  for (const tx of d.transactions) {
    if (isMirror(tx) || !tx.payee) continue;
    const cats = splitsByTx.get(tx.id);
    if (!cats || cats.length !== 1) continue;
    if (applyRules(d.rules, { payee: tx.payee, note: tx.note })) continue;
    const pattern = patternFromPayee(tx.payee);
    if (pattern.length < 3) continue;
    let m = byPattern.get(pattern);
    if (!m) byPattern.set(pattern, (m = new Map()));
    m.set(cats[0]!, (m.get(cats[0]!) ?? 0) + 1);
  }
  const out: RuleSuggestion[] = [];
  for (const [pattern, cats] of byPattern) {
    if (cats.size !== 1) continue; // uneinheitlich → kein Vorschlag
    const [categoryId, count] = [...cats.entries()][0]!;
    if (count >= minCount) out.push({ pattern, categoryId, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Wendet Regeln auf alle unkategorisierten Buchungen an. Gibt die Anzahl zurück. */
export function applyRulesToUncategorized(d: Dataset): number {
  const valid = new Set(d.categories.map((c) => c.id));
  const hasSplits = new Set(d.splits.map((s) => s.transactionId));
  let n = 0;
  for (const tx of d.transactions) {
    if (isMirror(tx) || hasSplits.has(tx.id)) continue;
    const categoryId = applyRules(d.rules, tx, valid);
    if (!categoryId) continue;
    d.splits.push({ id: uuidv7(), transactionId: tx.id, categoryId, amount: tx.amount, note: '' });
    n++;
  }
  return n;
}
