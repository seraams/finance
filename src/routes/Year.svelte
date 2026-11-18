<script lang="ts">
  import { categoryLabel } from '../lib/domain/entities';
  import { formatMoney } from '../lib/domain/money';
  import { yearReport } from '../lib/domain/networth';
  import { UNCATEGORIZED } from '../lib/domain/stats';
  import { formatMonth, formatPercent, t } from '../lib/i18n/index.svelte';
  import { session } from '../lib/state/session.svelte';
  import Amount from '../lib/ui/Amount.svelte';

  const data = $derived(session.data!);
  let year = $state(new Date().getFullYear());
  const report = $derived(yearReport(data, year));
  const maxCat = $derived(Math.max(1, ...report.byCategory.map((c) => c.amount)));
  const activeMonths = $derived(
    Math.max(1, report.rows.filter((r) => r.income !== 0 || r.expense !== 0).length),
  );
  const nwChange = $derived(
    report.netWorthStart !== null && report.netWorthEnd !== null
      ? report.netWorthEnd - report.netWorthStart
      : null,
  );
  const catName = (id: string) =>
    id === UNCATEGORIZED ? t('category.uncategorized') : categoryLabel(data, id);
</script>

<div class="row between head">
  <h1>{t('year.title')}</h1>
  <div class="row">
    <button
      type="button"
      class="btn small"
      aria-label={`${t('common.year')} −1`}
      onclick={() => year--}
    >
      ‹
    </button>
    <span class="yr" aria-live="polite">{year}</span>
    <button
      type="button"
      class="btn small"
      aria-label={`${t('common.year')} +1`}
      onclick={() => year++}
    >
      ›
    </button>
  </div>
</div>

<div class="cards three">
  <div class="card">
    <div class="kpi-label">{t('dash.net')}</div>
    <div class="kpi-value"><Amount value={report.net} /></div>
    <p class="small muted">
      {t('dash.income')}: {formatMoney(report.income)} · {t('dash.expense')}: {formatMoney(
        report.expense,
      )}
    </p>
  </div>
  <div class="card">
    <div class="kpi-label">{t('dash.savingsRate')}</div>
    <div class="kpi-value">{formatPercent(report.savingsRate)}</div>
    <p class="small muted">
      {#if report.bestMonth}{t('year.best')}: {formatMonth(report.bestMonth, 'short')}{/if}
      {#if report.worstMonth}· {t('year.worst')}: {formatMonth(report.worstMonth, 'short')}{/if}
    </p>
  </div>
  <div class="card">
    <div class="kpi-label">{t('year.netWorth')}</div>
    <div class="kpi-value">
      {report.netWorthEnd !== null ? formatMoney(report.netWorthEnd) : '–'}
    </div>
    {#if nwChange !== null}
      <p class="small">{t('year.change')}: <Amount value={nwChange} signed /></p>
    {/if}
  </div>
</div>

<section class="card tablecard" aria-labelledby="months-h">
  <h2 id="months-h">{t('common.month')}</h2>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th scope="col">{t('common.month')}</th>
          <th scope="col">{t('dash.income')}</th>
          <th scope="col">{t('dash.expense')}</th>
          <th scope="col">{t('dash.net')}</th>
          <th scope="col">{t('dash.savingsRate')}</th>
          <th scope="col">{t('year.netWorth')}</th>
          <th scope="col">{t('year.change')}</th>
        </tr>
      </thead>
      <tbody>
        {#each report.rows as r (r.month)}
          <tr>
            <th scope="row">{formatMonth(r.month, 'short')}</th>
            <td>{formatMoney(r.income)}</td>
            <td>{formatMoney(r.expense)}</td>
            <td><Amount value={r.net} /></td>
            <td>{formatPercent(r.savingsRate)}</td>
            <td>{r.netWorth !== null ? formatMoney(r.netWorth) : '–'}</td>
            <td>
              {#if r.netWorthChange !== null}<Amount value={r.netWorthChange} signed />{:else}–{/if}
            </td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{t('common.total')}</th>
          <td>{formatMoney(report.income)}</td>
          <td>{formatMoney(report.expense)}</td>
          <td><Amount value={report.net} /></td>
          <td>{formatPercent(report.savingsRate)}</td>
          <td>{report.netWorthEnd !== null ? formatMoney(report.netWorthEnd) : '–'}</td>
          <td>
            {#if nwChange !== null}<Amount value={nwChange} signed />{:else}–{/if}
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</section>

<section class="card" aria-labelledby="ycat-h">
  <h2 id="ycat-h">{t('year.byCategory')}</h2>
  {#if report.byCategory.length === 0}
    <p class="muted">{t('dash.noData')}</p>
  {:else}
    <ul class="catbars">
      {#each report.byCategory as c (c.categoryId)}
        <li>
          <div class="row between small">
            <span>{catName(c.categoryId)}</span>
            <span class="amount">
              {formatMoney(c.amount)}
              <span class="muted">
                · {formatPercent(report.expense > 0 ? c.amount / report.expense : null)} · {formatMoney(
                  Math.round(c.amount / activeMonths),
                )}
                {t('year.perMonth')}
              </span>
            </span>
          </div>
          <div class="hbar" aria-hidden="true">
            <span style:width={`${((c.amount / maxCat) * 100).toFixed(1)}%`}></span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .head {
    margin-bottom: 12px;
  }
  .head h1 {
    margin: 0;
  }
  .yr {
    font-weight: 600;
    min-width: 3em;
    text-align: center;
  }
  .cards {
    margin-bottom: var(--gap);
  }
  .catbars {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 10px;
  }
  .hbar {
    height: 8px;
    margin-top: 4px;
  }
  .hbar span {
    display: block;
    height: 100%;
    background: var(--chart-1);
    border-radius: 0 4px 4px 0;
    min-width: 2px;
  }
  tfoot th,
  tfoot td {
    font-weight: 600;
    border-bottom: none;
  }
</style>
