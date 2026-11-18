import type { Language } from '../domain/types';
import { de, type MessageKey } from './de';
import { en } from './en';

const dictionaries: Record<Language, Record<MessageKey, string>> = { de, en };

class I18n {
  lang = $state<Language>('de');

  t = (key: MessageKey, params?: Record<string, string | number>): string => {
    let s: string = dictionaries[this.lang][key] ?? de[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
    }
    return s;
  };

  get locale(): string {
    return this.lang === 'de' ? 'de-CH' : 'en-CH';
  }

  set(lang: Language): void {
    this.lang = lang;
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }
}

export const i18n = new I18n();
export const t = i18n.t;
export type { MessageKey };

/** Monatsname, z. B. «März 2026». */
export function formatMonth(month: string, style: 'long' | 'short' = 'long'): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(i18n.locale, {
    month: style,
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function formatDate(date: string, withWeekday = false): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(i18n.locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withWeekday ? { weekday: 'short' } : {}),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatPercent(v: number | null, digits = 0): string {
  if (v === null || !Number.isFinite(v)) return '–';
  return new Intl.NumberFormat(i18n.locale, {
    style: 'percent',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(v);
}

export function formatNumber(v: number, digits = 1): string {
  return new Intl.NumberFormat(i18n.locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
    .format(v)
    .replace(/’/g, "'");
}
