/**
 * Datenmodell des Finanzplaners.
 *
 * Konventionen:
 * - Beträge sind immer Ganzzahlen in Rappen (`Money`).
 * - Vorzeichen: negativ = Abfluss, positiv = Zufluss.
 * - Daten als ISO-Datum `YYYY-MM-DD`, Monate als `YYYY-MM`.
 * - IDs sind UUIDv7 (im Browser erzeugt).
 */

/** Betrag in Rappen (Ganzzahl). */
export type Money = number;
export type Id = string;
/** ISO-Datum `YYYY-MM-DD`. */
export type IsoDate = string;
/** Monat `YYYY-MM`. */
export type MonthKey = string;

export type AccountType =
  | 'private'
  | 'savings'
  | 'cash'
  | 'credit'
  | 'wallet'
  | 'person'
  | 'debt'
  | 'brokerage'
  | 'pension3a'
  | 'crypto';

export interface Account {
  id: Id;
  name: string;
  type: AccountType;
  currency: string;
  /** Zählt zur Budget-Invariante (Summe Konten = Summe Töpfe). */
  budgetRelevant: boolean;
  archived: boolean;
  /** Anfangssaldo am `openingDate`. */
  openingBalance: Money;
  openingDate: IsoDate;
}

export interface Transaction {
  id: Id;
  accountId: Id;
  date: IsoDate;
  amount: Money;
  payee: string;
  note: string;
  /**
   * Umbuchungsgruppe. Die Ursprungsbuchung hat `transferId === id`,
   * gespiegelte Gegenbuchungen tragen die ID der Ursprungsbuchung.
   */
  transferId?: Id;
  refundOfId?: Id;
  recurringId?: Id;
  importHash?: string;
  tagIds: Id[];
  attachmentIds: Id[];
}

export interface Split {
  id: Id;
  transactionId: Id;
  /** Genau eines von `categoryId` oder `counterAccountId` ist gesetzt. */
  categoryId?: Id;
  counterAccountId?: Id;
  /** Optionaler Topf, der statt des Standardtopfs belastet wird. */
  potId?: Id;
  amount: Money;
  note: string;
}

export type CategoryKind = 'income' | 'expense';

export interface Category {
  id: Id;
  parentId?: Id;
  name: string;
  kind: CategoryKind;
  /** true: Rest wird in den nächsten Monat übertragen; false: zurück in den Puffer. */
  rolloverRest: boolean;
  archived?: boolean;
}

export interface Tag {
  id: Id;
  name: string;
}

export type PotKind = 'buffer' | 'monthly' | 'goal' | 'reserve';

export interface Pot {
  id: Id;
  kind: PotKind;
  name: string;
  targetAmount?: Money;
  targetDate?: IsoDate;
  weight?: number;
}

export type PotMoveReason =
  | 'salary'
  | 'overflow'
  | 'rest'
  | 'reserve'
  | 'income'
  | 'overspend'
  | 'manual'
  | 'opening'
  | 'transfer';

export interface PotMove {
  id: Id;
  date: IsoDate;
  fromPotId?: Id;
  toPotId?: Id;
  /** Immer positiv; Richtung ergibt sich aus from/to. */
  amount: Money;
  reason: PotMoveReason;
  note?: string;
}

export interface Budget {
  month: MonthKey;
  categoryId: Id;
  amount: Money;
}

export interface RecurringTemplate {
  accountId: Id;
  amount: Money;
  payee: string;
  note: string;
  splits: Omit<Split, 'id' | 'transactionId'>[];
  tagIds: Id[];
}

export interface Recurring {
  id: Id;
  template: RecurringTemplate;
  /** RFC-5545-RRULE (Teilmenge), z. B. `FREQ=MONTHLY;INTERVAL=1`. */
  rrule: string;
  nextDate: IsoDate;
  /** Letztes mögliches Datum (inklusiv), optional. */
  endDate?: IsoDate;
  isSubscription: boolean;
  name: string;
  active: boolean;
}

export type CsvField = 'date' | 'amount' | 'debit' | 'credit' | 'payee' | 'note' | 'reference';
export type DateFormat = 'dd.mm.yyyy' | 'yyyy-mm-dd' | 'dd/mm/yyyy' | 'mm/dd/yyyy';

export interface ImportProfile {
  id: Id;
  name: string;
  bank: string;
  format: 'csv' | 'camt053';
  accountId?: Id;
  /** Feld → Spaltenname (bei Kopfzeile) bzw. Spaltennummer ab 0 (ohne). */
  columnMapping: Partial<Record<CsvField, string>>;
  delimiter?: string;
  dateFormat?: DateFormat;
  hasHeader?: boolean;
  /** Zeilen vor der Kopfzeile überspringen (Bank-Vorspann). */
  skipRows?: number;
  /** Vorzeichen umkehren (z. B. Kreditkartenauszüge). */
  invertSign?: boolean;
}

export interface Rule {
  id: Id;
  pattern: string;
  field: 'payee' | 'note' | 'any';
  categoryId: Id;
  priority: number;
}

export interface AttachmentMeta {
  id: Id;
  transactionId: Id;
  mime: string;
  size: number;
}

export interface Security {
  id: Id;
  isin?: string;
  ticker?: string;
  name: string;
  currency: string;
  kind: 'stock' | 'etf' | 'fund' | 'crypto' | 'other';
}

export interface Holding {
  id: Id;
  accountId: Id;
  securityId: Id;
  /** Stückzahl (darf gebrochen sein). */
  quantity: number;
  /** Kaufkurs pro Stück in Rappen. */
  costPrice: Money;
}

export interface Price {
  securityId: Id;
  date: IsoDate;
  /** Kurs pro Stück in Rappen. */
  price: Money;
}

export interface Snapshot {
  month: MonthKey;
  accountId: Id;
  balance: Money;
}

export interface MonthClosing {
  month: MonthKey;
  closedAt: string;
}

export type Language = 'de' | 'en';
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  /** Selbst-Gehalt S in Rappen pro Monat. */
  salary: Money;
  /** Ziel-Sparquote q in Prozent (z. B. 10). */
  savingsRatePct: number;
  /** Puffer-Ziel N in Monaten. */
  bufferMonths: number;
  language: Language;
  theme: Theme;
  autoLockMinutes: number;
  /** Tag (1–28), an dem ein Budgetmonat beginnt. */
  monthStartDay: number;
  currency: string;
  /** Phase 4: optionaler Kursabruf. Standard: aus. */
  priceFetchEnabled: boolean;
  /** Zeitpunkt der letzten verschlüsselten Sicherung (ISO). */
  lastBackupAt?: string;
}

export interface Dataset {
  formatVersion: number;
  createdAt: string;
  accounts: Account[];
  transactions: Transaction[];
  splits: Split[];
  categories: Category[];
  tags: Tag[];
  pots: Pot[];
  potMoves: PotMove[];
  budgets: Budget[];
  recurring: Recurring[];
  importProfiles: ImportProfile[];
  rules: Rule[];
  attachments: AttachmentMeta[];
  securities: Security[];
  holdings: Holding[];
  prices: Price[];
  snapshots: Snapshot[];
  monthClosings: MonthClosing[];
  settings: Settings;
}

/** Konten-Typen, die standardmässig nicht budgetrelevant sind (nur Vermögen). */
export const NON_BUDGET_ACCOUNT_TYPES: readonly AccountType[] = [
  'brokerage',
  'pension3a',
  'crypto',
];

export const ACCOUNT_TYPES: readonly AccountType[] = [
  'private',
  'savings',
  'cash',
  'credit',
  'wallet',
  'person',
  'debt',
  'brokerage',
  'pension3a',
  'crypto',
];
