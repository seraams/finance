/**
 * Optionaler Kursabruf für Krypto über die öffentliche CoinGecko-API (CORS).
 * Standardmässig AUS. Übertragen werden nur die Münz-IDs und die Währung –
 * keine Mengen, keine Beträge. CoinGecko sieht aber die IP-Adresse.
 */
import type { Money } from '../domain/types';

export const COINGECKO_ORIGIN = 'https://api.coingecko.com';

export function coingeckoUrl(ids: string[], vsCurrency = 'chf'): string {
  const clean = [
    ...new Set(ids.map((i) => i.trim().toLowerCase()).filter((i) => /^[a-z0-9-]+$/.test(i))),
  ];
  const q = new URLSearchParams({ ids: clean.join(','), vs_currencies: vsCurrency.toLowerCase() });
  return `${COINGECKO_ORIGIN}/api/v3/simple/price?${q.toString()}`;
}

/** Wandelt die Antwort in Kurse pro ID (Rappen) um; unbekannte/ungültige Werte werden ignoriert. */
export function parseCoingecko(json: unknown, vsCurrency = 'chf'): Map<string, Money> {
  const out = new Map<string, Money>();
  if (!json || typeof json !== 'object') return out;
  const cur = vsCurrency.toLowerCase();
  for (const [id, v] of Object.entries(json as Record<string, unknown>)) {
    const price = (v as Record<string, unknown> | null)?.[cur];
    if (typeof price === 'number' && Number.isFinite(price) && price >= 0) {
      out.set(id, Math.round(price * 100));
    }
  }
  return out;
}

export async function fetchCryptoPrices(
  ids: string[],
  vsCurrency = 'chf',
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, Money>> {
  if (ids.length === 0) return new Map();
  const res = await fetchImpl(coingeckoUrl(ids, vsCurrency), {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseCoingecko(await res.json(), vsCurrency);
}
