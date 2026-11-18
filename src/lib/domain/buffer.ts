/**
 * Puffer-Modell: reine Formeln (siehe README, Abschnitt «Puffer-Modell»).
 *
 * Alle Beträge in Rappen. Keine Abhängigkeit zu UI oder Speicher.
 */
import { floorToFranc, sum } from './money';
import type { Id, Money } from './types';

/**
 * Vorschlag Selbst-Gehalt: S = (1 − q) × Ē₁₂.
 *
 * @param monthlyIncomes Einkommen der letzten (bis zu) 12 Monate.
 *   Sind es mehr als 12, werden nur die letzten 12 verwendet.
 * @param savingsRatePct Ziel-Sparquote q in Prozent (z. B. 10).
 * @returns Vorschlag, auf ganze Franken abgerundet. 0 ohne Daten.
 */
export function suggestSalary(monthlyIncomes: readonly Money[], savingsRatePct: number): Money {
  const recent = monthlyIncomes.slice(-12);
  if (recent.length === 0) return 0;
  const q = clamp(savingsRatePct, 0, 100);
  const avg = sum(recent) / recent.length;
  const raw = (avg * (100 - q)) / 100;
  // kleine Rundungsfehler von Gleitkommazahlen abfangen, dann abrunden
  return Math.max(0, floorToFranc(Math.floor(raw + 1e-9)));
}

/** Durchschnittseinkommen Ē der letzten (bis zu) 12 Monate, in Rappen (abgerundet). */
export function averageIncome(monthlyIncomes: readonly Money[]): Money {
  const recent = monthlyIncomes.slice(-12);
  if (recent.length === 0) return 0;
  return Math.floor(sum(recent) / recent.length);
}

/** Puffer-Ziel: P_Ziel = N × S. */
export function bufferTarget(salary: Money, bufferMonths: number): Money {
  return Math.round(Math.max(0, bufferMonths) * Math.max(0, salary));
}

/**
 * Reichweite R = P / S in Monaten.
 * Ohne Selbst-Gehalt (S ≤ 0) ist die Reichweite unendlich (bzw. 0 bei leerem Puffer).
 */
export function reach(buffer: Money, salary: Money): number {
  if (salary <= 0) return buffer > 0 ? Infinity : 0;
  return buffer / salary;
}

export type WarningLevel = 'ok' | 'yellow' | 'red';

/** Warnstufen: R < 1 → rot, R < 2 → gelb. */
export function warningLevel(r: number): WarningLevel {
  if (r < 1) return 'red';
  if (r < 2) return 'yellow';
  return 'ok';
}

/**
 * Vorschlag für ein tieferes Selbst-Gehalt bei Warnung: das S, mit dem der
 * aktuelle Puffer 2 Monate reichen würde (abgerundet auf Franken),
 * höchstens das aktuelle S.
 */
export function lowerSalarySuggestion(buffer: Money, salary: Money): Money {
  return Math.max(0, Math.min(salary, floorToFranc(Math.floor(Math.max(0, buffer) / 2))));
}

/** Überlauf Ü = max(0, P − P_Ziel). */
export function overflow(buffer: Money, target: Money): Money {
  return Math.max(0, buffer - target);
}

export interface WeightedGoal {
  id: Id;
  weight: number;
}

/**
 * Verteilt den Überlauf auf Sparziele im Verhältnis ihrer Gewichte:
 * Üᵢ = Ü × wᵢ / Σw. Jeder Anteil wird auf Rappen abgerundet, der Rest
 * geht an das Ziel mit dem grössten Gewicht (bei Gleichstand das erste).
 * Die Summe der Anteile ist exakt Ü. Ziele mit Gewicht ≤ 0 erhalten nichts.
 */
export function distributeOverflow(amount: Money, goals: readonly WeightedGoal[]): Map<Id, Money> {
  const result = new Map<Id, Money>();
  const eligible = goals.filter((g) => Number.isFinite(g.weight) && g.weight > 0);
  if (amount <= 0 || eligible.length === 0) return result;
  const totalWeight = eligible.reduce((a, g) => a + g.weight, 0);
  let distributed = 0;
  let largest = eligible[0]!;
  for (const g of eligible) {
    const share = Math.floor((amount * g.weight) / totalWeight);
    result.set(g.id, share);
    distributed += share;
    if (g.weight > largest.weight) largest = g;
  }
  const rest = amount - distributed;
  result.set(largest.id, (result.get(largest.id) ?? 0) + rest);
  return result;
}

/**
 * Rücklage-Beitrag pro Monat: r = (B − A) / n, auf Rappen aufgerundet.
 * n wird auf mindestens 1 gesetzt. Ist bereits alles angespart, ist r = 0.
 */
export function reserveContribution(target: Money, saved: Money, monthsUntilDue: number): Money {
  const n = Math.max(1, Math.floor(monthsUntilDue));
  const missing = target - saved;
  if (missing <= 0) return 0;
  return Math.ceil(missing / n);
}

export interface SalaryPayout {
  /** Tatsächlich auszuzahlender Betrag: min(S, P), nie negativ. */
  amount: Money;
  /** Anlaufphase: der Puffer reicht nicht für ein volles Selbst-Gehalt. */
  startupPhase: boolean;
  /** Fehlbetrag gegenüber S. */
  shortfall: Money;
}

/** Auszahlung Selbst-Gehalt mit Anlaufphase: ist P < S, nur min(S, P). */
export function salaryPayout(salary: Money, buffer: Money): SalaryPayout {
  const s = Math.max(0, salary);
  const amount = Math.max(0, Math.min(s, buffer));
  return { amount, startupPhase: amount < s, shortfall: s - amount };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
