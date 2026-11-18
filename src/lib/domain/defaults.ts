import { uuidv7 } from './ids';
import type { Category, Dataset, Language, Pot, Settings } from './types';

export const CURRENT_FORMAT_VERSION = 1;

export function defaultSettings(language: Language = 'de'): Settings {
  return {
    salary: 0,
    savingsRatePct: 10,
    bufferMonths: 5,
    language,
    theme: 'system',
    autoLockMinutes: 10,
    monthStartDay: 1,
    currency: 'CHF',
    priceFetchEnabled: false,
  };
}

type CatTree = [name: { de: string; en: string }, children: { de: string; en: string }[]];

const INCOME: CatTree[] = [
  [
    { de: 'Einkommen', en: 'Income' },
    [
      { de: 'Lohn', en: 'Salary' },
      { de: 'Nebenjob', en: 'Side job' },
      { de: 'Stipendium', en: 'Scholarship' },
      { de: 'Geschenke', en: 'Gifts' },
      { de: 'Zinsen', en: 'Interest' },
      { de: 'Sonstige Einnahmen', en: 'Other income' },
    ],
  ],
];

const EXPENSE: CatTree[] = [
  [
    { de: 'Wohnen', en: 'Housing' },
    [
      { de: 'Miete', en: 'Rent' },
      { de: 'Nebenkosten', en: 'Utilities' },
      { de: 'Internet & Handy', en: 'Internet & phone' },
    ],
  ],
  [
    { de: 'Essen', en: 'Food' },
    [
      { de: 'Lebensmittel', en: 'Groceries' },
      { de: 'Restaurant', en: 'Restaurants' },
    ],
  ],
  [
    { de: 'Mobilität', en: 'Transport' },
    [
      { de: 'ÖV', en: 'Public transport' },
      { de: 'Velo', en: 'Bike' },
    ],
  ],
  [
    { de: 'Gesundheit', en: 'Health' },
    [
      { de: 'Krankenkasse', en: 'Health insurance' },
      { de: 'Arzt & Apotheke', en: 'Doctor & pharmacy' },
    ],
  ],
  [
    { de: 'Bildung', en: 'Education' },
    [
      { de: 'Semestergebühren', en: 'Tuition' },
      { de: 'Material', en: 'Supplies' },
    ],
  ],
  [
    { de: 'Freizeit', en: 'Leisure' },
    [
      { de: 'Ausgang', en: 'Going out' },
      { de: 'Hobby & Sport', en: 'Hobbies & sports' },
      { de: 'Ferien', en: 'Holidays' },
    ],
  ],
  [{ de: 'Abos', en: 'Subscriptions' }, []],
  [{ de: 'Steuern', en: 'Taxes' }, []],
  [{ de: 'Kleidung', en: 'Clothing' }, []],
  [{ de: 'Sonstiges', en: 'Miscellaneous' }, []],
];

export function defaultCategories(language: Language): Category[] {
  const out: Category[] = [];
  const add = (trees: CatTree[], kind: Category['kind']) => {
    for (const [name, children] of trees) {
      const parent: Category = { id: uuidv7(), name: name[language], kind, rolloverRest: false };
      out.push(parent);
      for (const child of children) {
        out.push({
          id: uuidv7(),
          parentId: parent.id,
          name: child[language],
          kind,
          rolloverRest: false,
        });
      }
    }
  };
  add(INCOME, 'income');
  add(EXPENSE, 'expense');
  return out;
}

export function defaultPots(language: Language): Pot[] {
  return [
    { id: uuidv7(), kind: 'buffer', name: language === 'de' ? 'Puffer' : 'Buffer' },
    { id: uuidv7(), kind: 'monthly', name: language === 'de' ? 'Monatsbudget' : 'Monthly budget' },
  ];
}

/** Leerer Datenbestand mit Standardkategorien und den beiden Pflicht-Töpfen. */
export function createEmptyDataset(language: Language = 'de', now: Date = new Date()): Dataset {
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    createdAt: now.toISOString(),
    accounts: [],
    transactions: [],
    splits: [],
    categories: defaultCategories(language),
    tags: [],
    pots: defaultPots(language),
    potMoves: [],
    budgets: [],
    recurring: [],
    importProfiles: [],
    rules: [],
    attachments: [],
    securities: [],
    holdings: [],
    prices: [],
    snapshots: [],
    monthClosings: [],
    settings: defaultSettings(language),
  };
}
