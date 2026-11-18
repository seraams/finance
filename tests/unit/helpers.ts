import { createEmptyDataset } from '../../src/lib/domain/defaults';
import { saveAccount } from '../../src/lib/domain/entities';
import type { AccountType, Dataset, Id } from '../../src/lib/domain/types';

export function cat(d: Dataset, name: string): Id {
  const c = d.categories.find((x) => x.name === name);
  if (!c) throw new Error(`category ${name} missing`);
  return c.id;
}

export function pot(d: Dataset, kind: 'buffer' | 'monthly'): Id {
  return d.pots.find((p) => p.kind === kind)!.id;
}

export function setup(): {
  d: Dataset;
  priv: Id;
  savings: Id;
  depot: Id;
  roommate: Id;
} {
  const d = createEmptyDataset('de');
  const mk = (name: string, type: AccountType, openingBalance = 0) =>
    saveAccount(d, { name, type, openingBalance, openingDate: '2026-01-01' }).id;
  return {
    d,
    priv: mk('Privatkonto', 'private', 100000),
    savings: mk('Sparkonto', 'savings', 500000),
    depot: mk('Depot', 'brokerage', 1000000),
    roommate: mk('Mitbewohner Max', 'person'),
  };
}
