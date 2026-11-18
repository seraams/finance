<script lang="ts">
  import type { ChartConfiguration } from 'chart.js';
  import { accountBalances } from '../lib/domain/balances';
  import { todayIso } from '../lib/domain/dates';
  import {
    importPrices,
    INVESTMENT_ACCOUNT_TYPES,
    parsePriceCsv,
    positions,
    recordTrade,
    saveSecurity,
    setHolding,
    setPrice,
  } from '../lib/domain/investments';
  import { formatMoney } from '../lib/domain/money';
  import { netWorth, netWorthHistory } from '../lib/domain/networth';
  import type { Security, SecurityKind } from '../lib/domain/types';
  import {
    formatDate,
    formatMonth,
    formatPercent,
    t,
    type MessageKey,
  } from '../lib/i18n/index.svelte';
  import { fetchCryptoPrices } from '../lib/prices/coingecko';
  import { session } from '../lib/state/session.svelte';
  import Amount from '../lib/ui/Amount.svelte';
  import Chart from '../lib/ui/Chart.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import MoneyInput from '../lib/ui/MoneyInput.svelte';

  const KINDS: SecurityKind[] = ['etf', 'stock', 'fund', 'crypto', 'other'];
  const data = $derived(session.data!);
  const today = todayIso();
  const nw = $derived(netWorth(data));
  const history = $derived(netWorthHistory(data));
  const cash = $derived(accountBalances(data));
  const invAccounts = $derived(
    data.accounts.filter(
      (a) =>
        !a.archived &&
        ((INVESTMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type) ||
          data.holdings.some((h) => h.accountId === a.id && h.quantity !== 0)),
    ),
  );

  function parseQty(s: string): number | null {
    const v = Number(
      s
        .trim()
        .replace(/['’\s]/g, '')
        .replace(',', '.'),
    );
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  function fmtQty(q: number): string {
    return q.toLocaleString('de-CH', { maximumFractionDigits: 8 }).replace(/’/g, "'");
  }

  const historyChart = $derived.by((): ChartConfiguration => {
    void session.theme;
    const color = getComputedStyle(document.documentElement).getPropertyValue('--chart-1').trim();
    return {
      type: 'line',
      data: {
        labels: history.map((h) => formatMonth(h.month, 'short')),
        datasets: [
          {
            label: t('inv.total'),
            data: history.map((h) => h.total / 100),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0,
          },
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${t('inv.total')}: ${formatMoney(Math.round(Number(ctx.raw) * 100))}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { callback: (v) => formatMoney(Number(v) * 100, { whole: true }) } },
        },
      },
    };
  });

  // ---------- Wertpapier ----------
  let secOpen = $state(false);
  let secEditing = $state<Security | null>(null);
  let secName = $state('');
  let secKind = $state<SecurityKind>('etf');
  let secIsin = $state('');
  let secTicker = $state('');
  let secCg = $state('');
  let secError = $state<string | null>(null);

  function openSecurity(s?: Security) {
    secEditing = s ?? null;
    secName = s?.name ?? '';
    secKind = s?.kind ?? 'etf';
    secIsin = s?.isin ?? '';
    secTicker = s?.ticker ?? '';
    secCg = s?.coingeckoId ?? '';
    secError = null;
    secOpen = true;
  }

  function submitSecurity(e: SubmitEvent) {
    e.preventDefault();
    try {
      session.mutate((d) =>
        saveSecurity(d, {
          ...(secEditing ? { id: secEditing.id } : {}),
          name: secName,
          kind: secKind,
          isin: secIsin,
          ticker: secTicker,
          coingeckoId: secKind === 'crypto' ? secCg : '',
        }),
      );
      secOpen = false;
    } catch (err) {
      secError =
        err instanceof Error && err.message === 'Invalid ISIN' ? t('inv.invalidIsin') : String(err);
    }
  }

  // ---------- Kauf / Verkauf / Bestand ----------
  let tradeOpen = $state(false);
  let tradeMode = $state<'buy' | 'sell' | 'set'>('buy');
  let tAccount = $state('');
  let tSecurity = $state('');
  let tQty = $state('');
  let tPrice = $state<number | null>(null);
  let tFee = $state<number | null>(null);
  let tDate = $state(todayIso());
  let tBookCash = $state(true);
  let tError = $state<string | null>(null);

  function openTrade(accountId: string, mode: 'buy' | 'sell' | 'set' = 'buy', securityId = '') {
    tradeMode = mode;
    tAccount = accountId;
    tSecurity = securityId || data.securities[0]?.id || '';
    tQty = '';
    tPrice = null;
    tFee = null;
    tDate = todayIso();
    tBookCash = true;
    tError = null;
    tradeOpen = true;
  }

  function submitTrade(e: SubmitEvent) {
    e.preventDefault();
    const q = parseQty(tQty);
    if (!q || tPrice === null || !tSecurity) {
      tError = t('tx.err.amount-invalid');
      return;
    }
    const price = tPrice;
    try {
      if (tradeMode === 'set') {
        session.mutate((d) => {
          setHolding(d, tAccount, tSecurity, q, price);
          setPrice(d, tSecurity, tDate, price);
        });
      } else {
        const r = session.mutate((d) =>
          recordTrade(d, {
            accountId: tAccount,
            securityId: tSecurity,
            date: tDate,
            quantity: tradeMode === 'buy' ? q : -q,
            price,
            fee: tFee ?? 0,
            bookCash: tBookCash,
          }),
        );
        if (tradeMode === 'sell') {
          session.showToast(t('inv.realized', { amount: formatMoney(r.realized) }));
        }
      }
      tradeOpen = false;
    } catch (err) {
      tError = err instanceof Error ? err.message : String(err);
    }
  }

  // ---------- Kurse ----------
  let priceOpen = $state(false);
  let pSecurity = $state('');
  let pDate = $state(todayIso());
  let pValue = $state<number | null>(null);

  function openPrice(securityId: string) {
    pSecurity = securityId;
    pDate = todayIso();
    pValue = null;
    priceOpen = true;
  }

  function submitPrice(e: SubmitEvent) {
    e.preventDefault();
    if (pValue === null || !pSecurity) return;
    const v = pValue;
    session.mutate((d) => setPrice(d, pSecurity, pDate, v));
    priceOpen = false;
  }

  let importMsg = $state<string | null>(null);
  async function onPriceFile(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const { rows, errors } = parsePriceCsv(await file.text());
    const r = session.mutate((d) => importPrices(d, rows));
    importMsg = [
      t('inv.imported', { n: r.imported }),
      r.unknown.length ? t('inv.unknown', { keys: r.unknown.join(', ') }) : '',
      errors.length ? t('import.errors', { n: errors.length }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  const cryptoIds = $derived(
    data.securities.filter((s) => s.kind === 'crypto' && s.coingeckoId).map((s) => s.coingeckoId!),
  );
  let fetching = $state(false);
  async function fetchPrices() {
    if (!data.settings.priceFetchEnabled) {
      session.showToast(t('inv.fetchOff'));
      return;
    }
    fetching = true;
    try {
      const prices = await fetchCryptoPrices(cryptoIds, data.settings.currency);
      let n = 0;
      session.mutate((d) => {
        for (const s of d.securities) {
          const p = s.coingeckoId ? prices.get(s.coingeckoId) : undefined;
          if (p !== undefined) {
            setPrice(d, s.id, todayIso(), p);
            n++;
          }
        }
      });
      session.showToast(t('inv.fetched', { n }));
    } catch (err) {
      session.showToast(
        t('inv.fetchError', { msg: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      fetching = false;
    }
  }
</script>

<h1>{t('inv.title')}</h1>

<div class="cards kpis">
  <div class="card">
    <div class="kpi-label">{t('inv.total')}</div>
    <div class="kpi-value" data-testid="networth"><Amount value={nw.total} color={false} /></div>
  </div>
  <div class="card">
    <dl class="kv">
      <dt>{t('inv.liquid')}</dt>
      <dd>{formatMoney(nw.liquid)}</dd>
      <dt>{t('inv.investments')}</dt>
      <dd>{formatMoney(nw.investments)}</dd>
      <dt>{t('inv.debts')}</dt>
      <dd><Amount value={nw.debts} /></dd>
      {#if nw.other !== 0}
        <dt>{t('inv.other')}</dt>
        <dd>{formatMoney(nw.other)}</dd>
      {/if}
    </dl>
  </div>
</div>

{#if history.length > 1}
  <section class="card" aria-labelledby="hist-h">
    <h2 id="hist-h">{t('inv.history')}</h2>
    <Chart config={historyChart} label={t('inv.history')} height={240} />
    <p class="hint">{t('inv.historyHint')}</p>
  </section>
{/if}

<div class="row actions">
  <button type="button" class="btn" onclick={() => openSecurity()}>
    ＋ {t('inv.newSecurity')}
  </button>
  <label class="btn">
    ⇣ {t('inv.importPrices')}
    <input type="file" accept=".csv,text/csv" class="visually-hidden" onchange={onPriceFile} />
  </label>
  {#if cryptoIds.length}
    <button type="button" class="btn" disabled={fetching} onclick={fetchPrices}>
      ↻ {t('inv.fetch')}
    </button>
  {/if}
</div>
{#if importMsg}<p class="notice small" role="status">{importMsg}</p>{/if}

{#if invAccounts.length === 0}
  <div class="notice">{t('inv.noAccounts')} <a href="#/accounts">{t('account.new')}</a></div>
{/if}

{#each invAccounts as acc (acc.id)}
  {@const rows = positions(data, acc.id)}
  <section class="card" aria-labelledby={`acc-${acc.id}`}>
    <div class="row between">
      <h2 id={`acc-${acc.id}`}>{acc.name}</h2>
      <div class="row">
        <button
          type="button"
          class="btn small"
          disabled={data.securities.length === 0}
          onclick={() => openTrade(acc.id)}
        >
          {t('inv.trade')}
        </button>
        <button
          type="button"
          class="btn small ghost"
          disabled={data.securities.length === 0}
          onclick={() => openTrade(acc.id, 'set')}
        >
          {t('inv.setHolding')}
        </button>
      </div>
    </div>
    {#if rows.length === 0}
      <p class="muted small">{t('inv.noPositions')}</p>
    {:else}
      <ul class="list">
        {#each rows as r (r.holding.id)}
          <li class="position">
            <div class="row between">
              <button type="button" class="link" onclick={() => openSecurity(r.security)}>
                {r.security.name}
              </button>
              <Amount value={r.value} color={false} />
            </div>
            <div class="row between small muted">
              <span>
                {fmtQty(r.holding.quantity)} × {formatMoney(r.price)}
                · {r.priceDate
                  ? t('inv.priceDate', { date: formatDate(r.priceDate) })
                  : t('inv.noPrice')}
              </span>
              <span class:pos-gain={r.gain > 0} class:neg={r.gain < 0}>
                {formatMoney(r.gain, { signed: true })} ({formatPercent(r.gainPct, 1)})
              </span>
            </div>
            <div class="row small">
              <button
                type="button"
                class="btn ghost small"
                onclick={() => openPrice(r.security.id)}
              >
                {t('inv.setPrice')}
              </button>
              <button
                type="button"
                class="btn ghost small"
                onclick={() => openTrade(acc.id, 'sell', r.security.id)}
              >
                {t('inv.sell')}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="row between small cashrow">
      <span class="muted">{t('inv.cash')}</span><Amount value={cash.get(acc.id) ?? 0} />
    </p>
  </section>
{/each}

{#if data.securities.length}
  <section class="card" aria-labelledby="sec-h">
    <h2 id="sec-h">{t('inv.securities')}</h2>
    <ul class="list">
      {#each data.securities as s (s.id)}
        <li class="row between item">
          <button type="button" class="link" onclick={() => openSecurity(s)}>{s.name}</button>
          <span class="small muted">
            {t(`inv.kind.${s.kind}` as MessageKey)}{s.isin ? ` · ${s.isin}` : ''}{s.ticker
              ? ` · ${s.ticker}`
              : ''}
          </span>
          <button type="button" class="btn ghost small" onclick={() => openPrice(s.id)}>
            {t('inv.setPrice')}
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<Dialog bind:open={secOpen} title={secEditing ? secEditing.name : t('inv.newSecurity')}>
  <form onsubmit={submitSecurity}>
    <div class="field">
      <label for="sec-name">{t('common.name')}</label>
      <input id="sec-name" type="text" bind:value={secName} required />
    </div>
    <div class="grid-2">
      <div class="field">
        <label for="sec-kind">{t('inv.kind')}</label>
        <select id="sec-kind" bind:value={secKind}>
          {#each KINDS as k (k)}<option value={k}>{t(`inv.kind.${k}` as MessageKey)}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="sec-ticker">{t('inv.ticker')}</label>
        <input id="sec-ticker" type="text" autocapitalize="characters" bind:value={secTicker} />
      </div>
    </div>
    {#if secKind === 'crypto'}
      <div class="field">
        <label for="sec-cg">{t('inv.coingecko')}</label>
        <input id="sec-cg" type="text" autocapitalize="off" bind:value={secCg} />
      </div>
    {:else}
      <div class="field">
        <label for="sec-isin">{t('inv.isin')}</label>
        <input id="sec-isin" type="text" autocapitalize="characters" bind:value={secIsin} />
      </div>
    {/if}
    {#if secError}<p class="error" role="alert">{secError}</p>{/if}
    <div class="row end">
      <button type="submit" class="btn primary">{t('common.save')}</button>
    </div>
  </form>
</Dialog>

<Dialog bind:open={tradeOpen} title={tradeMode === 'set' ? t('inv.setHolding') : t('inv.trade')}>
  <form onsubmit={submitTrade}>
    {#if tradeMode !== 'set'}
      <div class="segmented" role="group" aria-label={t('inv.trade')}>
        <button
          type="button"
          aria-pressed={tradeMode === 'buy'}
          onclick={() => (tradeMode = 'buy')}
        >
          {t('inv.buy')}
        </button>
        <button
          type="button"
          aria-pressed={tradeMode === 'sell'}
          onclick={() => (tradeMode = 'sell')}
        >
          {t('inv.sell')}
        </button>
      </div>
    {/if}
    <div class="field">
      <label for="tr-sec">{t('inv.security')}</label>
      <select id="tr-sec" bind:value={tSecurity}>
        {#each data.securities as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
      </select>
    </div>
    <div class="grid-2">
      <div class="field">
        <label for="tr-qty">{t('inv.qty')}</label>
        <input id="tr-qty" type="text" inputmode="decimal" autocomplete="off" bind:value={tQty} />
      </div>
      <div class="field">
        <MoneyInput
          id="tr-price"
          label={tradeMode === 'set' ? t('inv.cost') : t('inv.price')}
          bind:value={tPrice}
          unsigned
        />
      </div>
      {#if tradeMode !== 'set'}
        <div class="field">
          <MoneyInput id="tr-fee" label={t('inv.fee')} bind:value={tFee} unsigned />
        </div>
      {/if}
      <div class="field">
        <label for="tr-date">{t('common.date')}</label>
        <input id="tr-date" type="date" bind:value={tDate} />
      </div>
    </div>
    {#if tradeMode !== 'set'}
      <label class="check">
        <input type="checkbox" bind:checked={tBookCash} /><span>{t('inv.bookCash')}</span>
      </label>
    {/if}
    {#if tError}<p class="error" role="alert">{tError}</p>{/if}
    <div class="row end submit">
      <button type="submit" class="btn primary">{t('common.save')}</button>
    </div>
  </form>
</Dialog>

<Dialog bind:open={priceOpen} title={t('inv.setPrice')}>
  <form onsubmit={submitPrice}>
    <p class="muted">{data.securities.find((s) => s.id === pSecurity)?.name}</p>
    <div class="grid-2">
      <div class="field">
        <MoneyInput id="pr-value" label={t('inv.price')} bind:value={pValue} unsigned autofocus />
      </div>
      <div class="field">
        <label for="pr-date">{t('common.date')}</label>
        <input id="pr-date" type="date" bind:value={pDate} max={today} />
      </div>
    </div>
    <div class="row end">
      <button type="submit" class="btn primary" disabled={pValue === null}>
        {t('common.save')}
      </button>
    </div>
  </form>
</Dialog>

<style>
  .kpis {
    margin-bottom: var(--gap);
  }
  .kv {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
    margin: 0;
  }
  .kv dt {
    color: var(--muted);
  }
  .kv dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .actions {
    margin-bottom: var(--gap);
  }
  .position {
    padding: 10px 0;
  }
  .pos-gain {
    color: var(--pos);
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .item {
    padding: 8px 0;
  }
  .cashrow {
    margin: 8px 0 0;
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }
  .submit {
    margin-top: 12px;
  }
</style>
