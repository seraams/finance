/**
 * Anlegen, Ändern und Löschen von Konten, Kategorien, Tags und Töpfen.
 * Alle Funktionen mutieren den übergebenen Datenbestand.
 */
import { uuidv7 } from './ids';
import { deleteTransaction } from './transactions';
import {
  NON_BUDGET_ACCOUNT_TYPES,
  type Account,
  type AccountType,
  type Category,
  type CategoryKind,
  type Dataset,
  type Id,
  type IsoDate,
  type Money,
  type Pot,
  type Tag,
} from './types';

export function defaultBudgetRelevant(type: AccountType): boolean {
  return !NON_BUDGET_ACCOUNT_TYPES.includes(type);
}

export interface AccountInput {
  id?: Id;
  name: string;
  type: AccountType;
  currency?: string;
  budgetRelevant?: boolean;
  archived?: boolean;
  openingBalance?: Money;
  openingDate: IsoDate;
}

export function saveAccount(d: Dataset, input: AccountInput): Account {
  const name = input.name.trim();
  if (!name) throw new Error('Account name required');
  const existing = input.id ? d.accounts.find((a) => a.id === input.id) : undefined;
  const acc: Account = {
    id: existing?.id ?? uuidv7(),
    name,
    type: input.type,
    currency: input.currency ?? existing?.currency ?? d.settings.currency,
    budgetRelevant: input.budgetRelevant ?? defaultBudgetRelevant(input.type),
    archived: input.archived ?? false,
    openingBalance: input.openingBalance ?? 0,
    openingDate: input.openingDate,
  };
  if (existing) d.accounts[d.accounts.indexOf(existing)] = acc;
  else d.accounts.push(acc);
  return acc;
}

export function accountInUse(d: Dataset, id: Id): boolean {
  return (
    d.transactions.some((t) => t.accountId === id) ||
    d.splits.some((s) => s.counterAccountId === id)
  );
}

/** Löscht ein Konto. Mit `force` werden auch alle zugehörigen Buchungen gelöscht. */
export function deleteAccount(d: Dataset, id: Id, force = false): void {
  if (accountInUse(d, id)) {
    if (!force) throw new Error('Account has transactions');
    const affected = d.transactions
      .filter(
        (t) =>
          t.accountId === id ||
          d.splits.some((s) => s.transactionId === t.id && s.counterAccountId === id),
      )
      .map((t) => t.id);
    for (const txId of affected) deleteTransaction(d, txId);
  }
  d.accounts = d.accounts.filter((a) => a.id !== id);
  d.snapshots = d.snapshots.filter((s) => s.accountId !== id);
  d.holdings = d.holdings.filter((h) => h.accountId !== id);
}

export interface CategoryInput {
  id?: Id;
  name: string;
  kind: CategoryKind;
  parentId?: Id;
  rolloverRest?: boolean;
  archived?: boolean;
}

/** Kategorien haben genau zwei Ebenen: Hauptkategorie und Unterkategorie. */
export function saveCategory(d: Dataset, input: CategoryInput): Category {
  const name = input.name.trim();
  if (!name) throw new Error('Category name required');
  const existing = input.id ? d.categories.find((c) => c.id === input.id) : undefined;
  let parentId = input.parentId;
  if (parentId) {
    const parent = d.categories.find((c) => c.id === parentId);
    if (!parent) throw new Error('Parent not found');
    if (parent.parentId) throw new Error('Only two levels allowed');
    if (parent.id === existing?.id) throw new Error('Category cannot be its own parent');
    if (existing && d.categories.some((c) => c.parentId === existing.id)) {
      throw new Error('Category with children cannot become a child');
    }
    if (parent.kind !== input.kind) parentId = undefined;
  }
  const cat: Category = {
    id: existing?.id ?? uuidv7(),
    name,
    kind: input.kind,
    rolloverRest: input.rolloverRest ?? existing?.rolloverRest ?? false,
    ...(parentId ? { parentId } : {}),
    ...(input.archived ? { archived: true } : {}),
  };
  if (existing) {
    d.categories[d.categories.indexOf(existing)] = cat;
    // Art an Unterkategorien weitergeben
    for (const c of d.categories) if (c.parentId === cat.id) c.kind = cat.kind;
  } else {
    d.categories.push(cat);
  }
  return cat;
}

export function categoryInUse(d: Dataset, id: Id): boolean {
  return d.splits.some((s) => s.categoryId === id) || d.budgets.some((b) => b.categoryId === id);
}

/**
 * Löscht eine Kategorie. Unterkategorien müssen vorher gelöscht werden.
 * Splits auf diese Kategorie werden entfernt (die Beträge gelten dann als
 * unkategorisiert), Budgets und Regeln ebenso.
 */
export function deleteCategory(d: Dataset, id: Id): void {
  if (d.categories.some((c) => c.parentId === id)) throw new Error('Category has children');
  d.splits = d.splits.filter((s) => s.categoryId !== id);
  d.budgets = d.budgets.filter((b) => b.categoryId !== id);
  d.rules = d.rules.filter((r) => r.categoryId !== id);
  d.categories = d.categories.filter((c) => c.id !== id);
}

/** Kategorien als Baum: Hauptkategorien in Eingabereihenfolge, je mit Kindern. */
export function categoryTree(
  d: Dataset,
  kind?: CategoryKind,
  includeArchived = false,
): { parent: Category; children: Category[] }[] {
  const visible = d.categories.filter(
    (c) => (!kind || c.kind === kind) && (includeArchived || !c.archived),
  );
  return visible
    .filter((c) => !c.parentId)
    .map((parent) => ({ parent, children: visible.filter((c) => c.parentId === parent.id) }));
}

export function categoryLabel(d: Dataset, id: Id | undefined): string {
  if (!id) return '';
  const c = d.categories.find((x) => x.id === id);
  if (!c) return '';
  const p = c.parentId ? d.categories.find((x) => x.id === c.parentId) : undefined;
  return p ? `${p.name} › ${c.name}` : c.name;
}

export function saveTag(d: Dataset, name: string, id?: Id): Tag {
  const n = name.trim();
  if (!n) throw new Error('Tag name required');
  const existing = id
    ? d.tags.find((t) => t.id === id)
    : d.tags.find((t) => t.name.toLowerCase() === n.toLowerCase());
  if (existing) {
    existing.name = n;
    return existing;
  }
  const tag: Tag = { id: uuidv7(), name: n };
  d.tags.push(tag);
  return tag;
}

export function deleteTag(d: Dataset, id: Id): void {
  d.tags = d.tags.filter((t) => t.id !== id);
  for (const tx of d.transactions) {
    if (tx.tagIds.includes(id)) tx.tagIds = tx.tagIds.filter((t) => t !== id);
  }
}

export interface PotInput {
  id?: Id;
  kind: 'goal' | 'reserve';
  name: string;
  targetAmount?: Money;
  targetDate?: IsoDate;
  weight?: number;
}

export function savePot(d: Dataset, input: PotInput): Pot {
  const name = input.name.trim();
  if (!name) throw new Error('Pot name required');
  const existing = input.id ? d.pots.find((p) => p.id === input.id) : undefined;
  if (existing && (existing.kind === 'buffer' || existing.kind === 'monthly')) {
    existing.name = name;
    return existing;
  }
  const pot: Pot = {
    id: existing?.id ?? uuidv7(),
    kind: input.kind,
    name,
    ...(input.targetAmount !== undefined ? { targetAmount: input.targetAmount } : {}),
    ...(input.targetDate ? { targetDate: input.targetDate } : {}),
    ...(input.weight !== undefined ? { weight: input.weight } : {}),
  };
  if (existing) d.pots[d.pots.indexOf(existing)] = pot;
  else d.pots.push(pot);
  return pot;
}

/**
 * Löscht einen Topf. Puffer und Monatsbudget sind Pflicht.
 * Ein verbleibender Saldo wird dadurch «nicht zugeordnet» und muss neu verteilt werden.
 */
export function deletePot(d: Dataset, id: Id): void {
  const pot = d.pots.find((p) => p.id === id);
  if (!pot) return;
  if (pot.kind === 'buffer' || pot.kind === 'monthly') throw new Error('Required pot');
  d.pots = d.pots.filter((p) => p.id !== id);
  for (const s of d.splits) if (s.potId === id) delete s.potId;
}
