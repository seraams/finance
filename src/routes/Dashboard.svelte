<script lang="ts">
  import type { ChartConfiguration } from 'chart.js';
  import { bufferBalance } from '../lib/domain/balances';
  import {
    bufferTarget,
    lowerSalarySuggestion,
    overflow,
    reach,
    suggestSalary,
    warningLevel,
  } from '../lib/domain/buffer';
  import { monthOverview } from '../lib/domain/budget';
  import { budgetMonthOf, todayIso } from '../lib/domain/dates';
  import { formatMoney } from '../lib/domain/money';
  import { assignUnassigned, checkInvariant } from '../lib/domain/invariant';
  import {
    expensesByCategory,
    incomeHistory,
    lastMonths,
    monthlyFlows,
    savingsRate,
    UNCATEGORIZED,
  } from '../lib/domain/stats';
  import { categoryLabel } from '../lib/domain/entities';
  import { computeHints, type Hint } from '../lib/domain/hints';
  import {
    formatDate,
    formatMonth,
    formatNumber,
    formatPercent,
    t,
  } from '../lib/i18n/index.svelte';
  import { netWorth } from '../lib/domain/networth';
  import { session } from '../lib/state/session.svelte';
  import Amount from '../lib/ui/Amount.svelte';
  import Chart from '../lib/ui/Chart.svelte';

  const data = $derived(session.data!);
  const today = todayIso();
  const month = $derived(budgetMonthOf(today, data.settings.monthStartDay));
  const S = $derived(data.settings.salary);
  const P = $derived(bufferBalance(data, today));
  const R = $derived(reach(P, S));
  const level = $derived(S > 0 ? warningLevel(R) : 'ok');
  const target = $derived(bufferTarget(S, data.settings.bufferMonths));
  const over = $derived(S > 0 ? overflow(P, target) : 0);
  const overview = $derived(monthOverview(data, month, today));
  const invariant = $derived(checkInvariant(data));
  const suggestion = $derived(
    suggestSalary(incomeHistory(data, month), data.settings.savingsRatePct),
  );

  const months12 = $derived(lastMonths(month, 12));
  const flows = $derived(monthlyFlows(data, months12));
  const income12 = $derived(flows.reduce((a, f) => a + f.income, 0));
  const expense12 = $derived(flows.reduce((a, f) => a + f.expense, 0));
  const byCat = $derived(expensesByCategory(data, month));
  const maxCat = $derived(Math.max(1, ...byCat.map((c) => c.amount)));
  const catName = (id: string) =>
    id === UNCATEGORIZED
      ? t('category.uncategorized')
      : (data.categories.find((c) => c.id === id)?.name ?? '?');

  const nw = $derived(netWorth(data));

  function cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  const flowChart = $derived.by((): ChartConfiguration => {
    void session.theme;
    return {
      type: 'bar',
      data: {
        labels: flows.map((f) => formatMonth(f.month, 'short')),
        datasets: [
          {
            label: t('dash.income'),
            data: flows.map((f) => f.income / 100),
            backgroundColor: cssVar('--chart-1'),
            borderRadius: 4,
            borderSkipped: 'start',
            maxBarThickness: 18,
          },
          {
            label: t('dash.expense'),
            data: flows.map((f) => f.expense / 100),
            backgroundColor: cssVar('--chart-2'),
            borderRadius: 4,
            borderSkipped: 'start',
            maxBarThickness: 18,
          },
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { boxWidth: 12, boxHeight: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${formatMoney(Math.round(Number(ctx.raw) * 100))}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { callback: (v) => formatMoney(Number(v) * 100, { whole: true }) },
          },
        },
      },
    };
  });

  const hints = $derived(computeHints(data, today, data.settings.dismissedHints ?? []));

  function hintText(h: Hint): string {
    const p = h.params;
    switch (h.kind) {
      case 'closingDue':
        return t('hints.closingDue', { month: formatMonth(h.month ?? '') });
      case 'budget80':
      case 'budgetOver':
        return t(`hints.${h.kind}`, {
          category: categoryLabel(data, h.categoryId),
          pct: p.pct ?? 0,
        });
      case 'subscriptionDue':
        return t('hints.subscriptionDue', {
          name: String(p.name ?? ''),
          date: formatDate(h.date ?? today),
          amount: formatMoney(Math.abs(h.amount ?? 0)),
        });
      case 'bufferLow':
        return t('hints.bufferLow', { r: formatNumber(Number(p.r ?? 0), 1) });
      case 'backupOld':
        return t('hints.backupOld', { date: formatDate(h.date ?? today) });
    }
  }

  function dismiss(key: string) {
    session.mutate((d) => {
      const list = d.settings.dismissedHints ?? [];
      d.settings.dismissedHints = [...list.slice(-199), key];
    });
  }

  function assign() {
    session.mutate((d) => assignUnassigned(d, today));
  }
</script>

<h1>{t('dash.title')}</h1>

{#if hints.length}
  <section class="hints" aria-labelledby="hints-h">
    <h2 id="hints-h" class="visually-hidden">{t('hints.title')}</h2>
    <ul>
      {#each hints as h (h.key)}
        <li
          class="notice hint-item"
          class:warn={h.severity === 'warn'}
          class:danger={h.severity === 'danger'}
        >
          <span aria-hidden="true">{h.severity === 'info' ? 'ℹ' : '⚠'}</span>
          <a class="grow" href={`#${h.link}`}>{hintText(h)}</a>
          <button
            type="button"
            class="btn ghost small"
            aria-label={`${t('hints.dismiss')}: ${hintText(h)}`}
            onclick={() => dismiss(h.key)}
          >
            ✕
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if data.accounts.length === 0}
  <div class="notice ok">
    {t('dash.welcome')} <a href="#/accounts">{t('account.new')}</a>
  </div>
{/if}

{#if !invariant.ok}
  <div class="notice warn" role="status">
    <strong>{t('dash.unassigned', { amount: formatMoney(invariant.unassigned) })}</strong>
    <p class="small">{t('dash.unassignedHint')}</p>
    <button type="button" class="btn small" onclick={assign}>{t('dash.assignToBuffer')}</button>
  </div>
{/if}

<div class="cards three">
  <section class="card" aria-labelledby="buf-h">
    <h2 id="buf-h" class="kpi-label">{t('dash.buffer')}</h2>
    <div class="kpi-value" data-testid="buffer"><Amount value={P} color={false} /></div>
    <p class="reach" class:neg={level === 'red'}>
      {t('dash.reach')}:
      <strong>
        {S > 0 ? t('dash.reachValue', { r: formatNumber(R, 1) }) : t('dash.reachInfinite')}
      </strong>
    </p>
    {#if S > 0}
      <div
        class="bar"
        class:warn={level === 'yellow'}
        class:over={level === 'red'}
        aria-hidden="true"
      >
        <span style:width={`${Math.min(100, target > 0 ? (P / target) * 100 : 0).toFixed(1)}%`}
        ></span>
      </div>
      <p class="small muted">
        {t('dash.target', { amount: formatMoney(target), n: data.settings.bufferMonths })}
      </p>
      {#if over > 0}<p class="small">{t('dash.overflow', { amount: formatMoney(over) })}</p>{/if}
    {/if}
    {#if level !== 'ok'}
      <div
        class="notice"
        class:warn={level === 'yellow'}
        class:danger={level === 'red'}
        role="note"
      >
        <span aria-hidden="true">⚠</span>
        {level === 'red' ? t('dash.warnRed') : t('dash.warnYellow')}
        {t('dash.suggestLower', { amount: formatMoney(lowerSalarySuggestion(P, S)) })}
      </div>
    {/if}
  </section>

  <section class="card" aria-labelledby="rest-h">
    <h2 id="rest-h" class="kpi-label">{t('dash.restBudget')}</h2>
    <div class="kpi-value"><Amount value={overview.monthlyPot} /></div>
    <p class="small muted">{formatMonth(month)}</p>
    <p class="small">
      {t('budget.spent')}: {formatMoney(overview.spent)} · {t('budget.salaryPaid')}: {formatMoney(
        overview.salaryPaid,
      )}
    </p>
    <a class="small" href="#/budget">{t('nav.budget')} →</a>
  </section>

  <section class="card" aria-labelledby="sr-h">
    <h2 id="sr-h" class="kpi-label">{t('dash.savingsRate12')}</h2>
    <div class="kpi-value">{formatPercent(savingsRate(income12, expense12))}</div>
    <p class="small muted">
      {t('dash.income')}: {formatMoney(income12)} · {t('dash.expense')}: {formatMoney(expense12)}
    </p>
    {#if suggestion > 0}
      <p class="small">{t('dash.salarySuggestion', { amount: formatMoney(suggestion) })}</p>
    {/if}
  </section>
</div>

<div class="cards charts">
  <section class="card" aria-labelledby="cat-h">
    <h2 id="cat-h">{t('dash.byCategory')} · {formatMonth(month)}</h2>
    {#if byCat.length === 0}
      <p class="muted">{t('dash.noData')}</p>
    {:else}
      <ul class="catbars">
        {#each byCat as c (c.categoryId)}
          <li>
            <div class="row between small">
              <span>{catName(c.categoryId)}</span>
              <span class="amount">{formatMoney(c.amount)}</span>
            </div>
            <div class="hbar" aria-hidden="true">
              <span style:width={`${((c.amount / maxCat) * 100).toFixed(1)}%`}></span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card" aria-labelledby="flow-h">
    <h2 id="flow-h">{t('dash.incomeVsExpense')}</h2>
    {#if income12 === 0 && expense12 === 0}
      <p class="muted">{t('dash.noData')}</p>
    {:else}
      <Chart config={flowChart} label={t('dash.incomeVsExpense')} height={260} />
    {/if}
  </section>
</div>

<section class="card" aria-labelledby="nw-h">
  <div class="row between">
    <h2 id="nw-h">{t('dash.netWorth')}</h2>
    <a class="small" href="#/invest">{t('dash.more')}</a>
  </div>
  <div class="kpi-value" data-testid="dash-networth"><Amount value={nw.total} color={false} /></div>
  <p class="small muted">
    {t('inv.liquid')}: {formatMoney(nw.liquid)} · {t('inv.investments')}: {formatMoney(
      nw.investments,
    )}{#if nw.debts !== 0}
      · {t('inv.debts')}: {formatMoney(nw.debts)}{/if}
  </p>
  <a class="btn small" href="#/year">{t('dash.yearOverview')} →</a>
</section>

<style>
  .cards {
    margin-bottom: var(--gap);
  }
  .hints ul {
    list-style: none;
    padding: 0;
    margin: 0 0 var(--gap);
  }
  .hint-item {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    padding: 6px 6px 6px 14px;
  }
  .hint-item a {
    color: inherit;
  }
  .reach {
    margin: 4px 0 8px;
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
</style>
