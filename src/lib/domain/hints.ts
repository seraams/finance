/**
 * Hinweise in der App (es gibt keinen Server für Push-Benachrichtigungen).
 */
import { bufferBalance } from './balances';
import { reach } from './buffer';
import { categoryStatuses } from './budget';
import { nextMonthToClose } from './closing';
import { addDays, budgetMonthOf, monthDiff } from './dates';
import { upcoming } from './recurring';
import type { Dataset, Id, IsoDate, Money } from './types';

export type HintKind =
  'closingDue' | 'budget80' | 'budgetOver' | 'subscriptionDue' | 'bufferLow' | 'backupOld';

export interface Hint {
  /** Eindeutig je Zeitraum – für «ausblenden». */
  key: string;
  kind: HintKind;
  severity: 'info' | 'warn' | 'danger';
  /** Ziel innerhalb der App (Hash-Pfad). */
  link: string;
  params: Record<string, string | number>;
  /** Für Formatierung in der UI. */
  amount?: Money;
  date?: IsoDate;
  month?: string;
  categoryId?: Id;
}

export const BUDGET_WARN_THRESHOLD = 0.8;
export const SUBSCRIPTION_DAYS = 7;
export const BACKUP_MAX_DAYS = 30;

export function computeHints(
  d: Dataset,
  today: IsoDate,
  dismissed: readonly string[] = [],
): Hint[] {
  const hints: Hint[] = [];
  const start = d.settings.monthStartDay;
  const month = budgetMonthOf(today, start);

  // Monatsabschluss fällig
  const toClose = nextMonthToClose(d, today);
  if (toClose && d.accounts.length > 0) {
    const months = monthDiff(toClose, month);
    hints.push({
      key: `closingDue:${toClose}`,
      kind: 'closingDue',
      severity: months > 1 ? 'warn' : 'info',
      link: `/closing?month=${toClose}`,
      params: {},
      month: toClose,
    });
  }

  // Puffer unter 2 Monaten
  const S = d.settings.salary;
  if (S > 0) {
    const R = reach(bufferBalance(d, today), S);
    if (R < 2) {
      hints.push({
        key: `bufferLow:${month}`,
        kind: 'bufferLow',
        severity: R < 1 ? 'danger' : 'warn',
        link: '/',
        params: { r: Math.round(R * 10) / 10 },
      });
    }
  }

  // Budget zu 80 % verbraucht / überzogen
  for (const s of categoryStatuses(d, month).values()) {
    const available = s.budget + s.carryIn;
    // Genau aufgebraucht (z. B. Miete) ist geplant und kein Hinweis wert.
    if (available <= 0 || s.usage < BUDGET_WARN_THRESHOLD || s.rest === 0) continue;
    const over = s.usage > 1;
    hints.push({
      key: `${over ? 'budgetOver' : 'budget80'}:${s.categoryId}:${month}`,
      kind: over ? 'budgetOver' : 'budget80',
      severity: over ? 'danger' : 'warn',
      link: '/budget',
      params: { pct: Math.round(s.usage * 100) },
      categoryId: s.categoryId,
      amount: s.rest,
    });
  }

  // Abo in 7 Tagen fällig
  for (const r of upcoming(d, today, SUBSCRIPTION_DAYS)) {
    if (!r.isSubscription || r.nextDate < today) continue;
    hints.push({
      key: `subscriptionDue:${r.id}:${r.nextDate}`,
      kind: 'subscriptionDue',
      severity: 'info',
      link: '/recurring',
      params: { name: r.name },
      date: r.nextDate,
      amount: r.template.amount,
    });
  }

  // Sicherung älter als 30 Tage
  const last = d.settings.lastBackupAt?.slice(0, 10);
  if (last && addDays(last, BACKUP_MAX_DAYS) < today) {
    hints.push({
      key: `backupOld:${month}`,
      kind: 'backupOld',
      severity: 'info',
      link: '/data',
      params: {},
      date: last,
    });
  }

  const order = { danger: 0, warn: 1, info: 2 };
  return hints
    .filter((h) => !dismissed.includes(h.key))
    .sort((a, b) => order[a.severity] - order[b.severity]);
}
