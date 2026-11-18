<script lang="ts">
  import { accountBalances } from '../lib/domain/balances';
  import { paySalary, previewSalary } from '../lib/domain/budget';
  import {
    closeMonth,
    distributeOverflowToGoals,
    isMonthClosed,
    monthReport,
    nextMonthStart,
    nextMonthToClose,
    payReserves,
    personBalances,
    previewOverflow,
    previewRests,
    reconcileAccount,
    reopenMonth,
    reserveSchedule,
    settleRests,
    uncategorizedInMonth,
  } from '../lib/domain/closing';
  import { addMonths, budgetMonthEnd, todayIso } from '../lib/domain/dates';
  import { categoryLabel, categoryTree } from '../lib/domain/entities';
  import { formatMoney } from '../lib/domain/money';
  import { saveTransaction, toInput } from '../lib/domain/transactions';
  import { formatDate, formatMonth, formatPercent, t } from '../lib/i18n/index.svelte';
  import { router } from '../lib/router.svelte';
  import { session } from '../lib/state/session.svelte';
  import Amount from '../lib/ui/Amount.svelte';
  import MoneyInput from '../lib/ui/MoneyInput.svelte';

  const today = todayIso();
  const data = $derived(session.data!);
  let month = $state(
    router.route.query.get('month') ?? nextMonthToClose(session.data!, todayIso()) ?? '',
  );
  let step = $state(1);
  let done = $state<Record<number, boolean>>({});

  const monthEnd = $derived(month ? budgetMonthEnd(month, data.settings.monthStartDay) : '');
  const nextStart = $derived(month ? nextMonthStart(data, month) : '');
  const nextMonth = $derived(month ? addMonths(month, 1) : '');
  const closed = $derived(month ? isMonthClosed(data, month) : false);

  // 1
  const uncategorized = $derived(month ? uncategorizedInMonth(data, month) : []);
  const tree = $derived(categoryTree(data));
  function categorize(txId: string, categoryId: string) {
    if (!categoryId) return;
    session.mutate((d) => {
      const tx = d.transactions.find((x) => x.id === txId);
      if (!tx) return;
      const input = toInput(d, tx);
      const covered = input.splits.reduce((a, s) => a + s.amount, 0);
      input.splits.push({ categoryId, amount: tx.amount - covered });
      saveTransaction(d, input);
    });
  }

  // 2
  const brAccounts = $derived(data.accounts.filter((a) => a.budgetRelevant && !a.archived));
  const balancesAtEnd = $derived(monthEnd ? accountBalances(data, monthEnd) : new Map());
  let bank = $state<Record<string, number | null>>({});
  function reconcile(accountId: string) {
    const v = bank[accountId];
    if (v === null || v === undefined) return;
    const diff = session.mutate((d) => reconcileAccount(d, accountId, monthEnd, v, t('close.s2')));
    if (diff !== 0) session.showToast(t('close.s2.fixed', { amount: formatMoney(diff) }));
  }

  // 3
  const persons = $derived(monthEnd ? personBalances(data, monthEnd) : []);

  // 4
  const rests = $derived(month ? previewRests(data, month) : null);
  const restsBooked = $derived(
    data.potMoves.some(
      (m) => m.note === `closing:${month}` && (m.reason === 'rest' || m.reason === 'overspend'),
    ),
  );

  // 5
  const salary = $derived(nextStart ? previewSalary(data, nextStart) : null);
  const reserves = $derived(nextMonth ? reserveSchedule(data, nextMonth) : []);
  const reservesDue = $derived(reserves.reduce((a, r) => a + r.due, 0));
  function pay() {
    session.mutate((d) => {
      paySalary(d, nextStart);
      payReserves(d, nextMonth, nextStart);
    });
    done[5] = true;
  }

  // 6
  const overflowShares = $derived(nextStart ? previewOverflow(data, nextStart) : new Map());
  const overflowTotal = $derived([...overflowShares.values()].reduce((a, v) => a + v, 0));

  // 7
  const report = $derived(month ? monthReport(data, month) : null);

  const stepTitles = $derived([
    t('close.s1'),
    t('close.s2'),
    t('close.s3'),
    t('close.s4'),
    t('close.s5', { month: nextMonth ? formatMonth(nextMonth) : '' }),
    t('close.s6'),
    t('close.s7'),
  ]);

  function finish() {
    session.mutate((d) => closeMonth(d, month, today));
    session.showToast(t('close.s7.done', { month: formatMonth(month) }));
  }

  function accName(id: string) {
    return data.accounts.find((a) => a.id === id)?.name ?? '?';
  }
</script>

<h1>{t('close.title')}</h1>

{#if !month}
  <div class="card"><p>✓ {t('close.none')}</p></div>
{:else}
  <div class="row between">
    <h2>{t('close.month', { month: formatMonth(month) })}</h2>
    {#if closed}<span class="small muted">✓ {t('close.done')}</span>{/if}
  </div>

  <ol class="steps" aria-label={t('close.title')}>
    {#each stepTitles as title, i (i)}
      <li>
        <button
          type="button"
          class="stepbtn"
          aria-current={step === i + 1 ? 'step' : undefined}
          onclick={() => (step = i + 1)}
        >
          <span class="num">{i + 1}</span><span class="lbl">{title}</span>
        </button>
      </li>
    {/each}
  </ol>

  <section class="card" aria-live="polite">
    <p class="small muted">{t('close.step', { n: step })}</p>
    <h3>{stepTitles[step - 1]}</h3>

    {#if step === 1}
      {#if uncategorized.length === 0}
        <p class="notice ok">✓ {t('close.s1.none')}</p>
      {:else}
        <p>{t('close.s1.hint')}</p>
        <ul class="list">
          {#each uncategorized as tx (tx.id)}
            <li class="unc">
              <div class="row between">
                <a href={`#/tx/${tx.id}`}>{tx.payee || tx.note || '—'}</a>
                <Amount value={tx.amount} />
              </div>
              <div class="small muted">{formatDate(tx.date)} · {accName(tx.accountId)}</div>
              <label for={`unc-${tx.id}`} class="visually-hidden">{t('tx.category')}</label>
              <select
                id={`unc-${tx.id}`}
                onchange={(e) => categorize(tx.id, e.currentTarget.value)}
              >
                <option value="">– {t('tx.category')} –</option>
                {#each tree as g (g.parent.id)}
                  <optgroup label={g.parent.name}>
                    <option value={g.parent.id}>{g.parent.name}</option>
                    {#each g.children as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
                  </optgroup>
                {/each}
              </select>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if step === 2}
      <p>{t('close.s2.hint', { date: formatDate(monthEnd) })}</p>
      <ul class="list">
        {#each brAccounts as a (a.id)}
          {@const app = balancesAtEnd.get(a.id) ?? 0}
          <li class="recon">
            <div class="grow">
              <strong>{a.name}</strong>
              <div class="small muted">{t('close.s2.app')}: {formatMoney(app)}</div>
            </div>
            <div class="bank">
              <MoneyInput
                id={`bank-${a.id}`}
                label={t('close.s2.bank')}
                value={bank[a.id] ?? null}
                onchange={(v) => (bank[a.id] = v)}
              />
            </div>
            {#if bank[a.id] !== undefined && bank[a.id] !== null}
              {#if bank[a.id] === app}
                <span class="small pos">✓ {t('close.s2.ok')}</span>
              {:else}
                <button type="button" class="btn small" onclick={() => reconcile(a.id)}>
                  {t('close.s2.fix')} ({formatMoney((bank[a.id] ?? 0) - app, { signed: true })})
                </button>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    {:else if step === 3}
      {#if persons.length === 0}
        <p class="notice ok">✓ {t('close.s3.none')}</p>
      {:else}
        <ul class="list">
          {#each persons as p (p.accountId)}
            <li class="row between item">
              <a href={`#/tx?account=${p.accountId}`}>{accName(p.accountId)}</a>
              <span>
                <span class="small muted">
                  {p.balance > 0 ? t('close.s3.owesMe') : t('close.s3.iOwe')}
                </span>
                <Amount value={Math.abs(p.balance)} color={false} />
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if step === 4 && rests}
      <dl class="kv">
        <dt>{t('close.s4.carried')}</dt>
        <dd>{formatMoney(rests.carried)}</dd>
        <dt>{t('close.s4.returned')}</dt>
        <dd>{formatMoney(rests.returned)}</dd>
        <dt>{t('close.s4.covered')}</dt>
        <dd class:neg={rests.covered > 0}>{formatMoney(rests.covered)}</dd>
      </dl>
      {#if rests.overspentCategoryIds.length}
        <p class="notice warn">
          ⚠ {t('close.s4.overspent')}: {rests.overspentCategoryIds
            .map((id) => categoryLabel(data, id))
            .join(', ')}
        </p>
      {/if}
      {#if restsBooked}
        <p class="notice ok">✓ {t('close.s4.done')}</p>
      {:else}
        <button
          type="button"
          class="btn primary"
          onclick={() => session.mutate((d) => settleRests(d, month))}
        >
          {t('close.s4.do')}
        </button>
      {/if}
    {:else if step === 5 && salary}
      {#if data.settings.salary <= 0}
        <p class="notice warn">{t('budget.noSalary')}</p>
      {:else if salary.amount > 0 || reservesDue > 0}
        {#if salary.startupPhase}
          <p class="notice warn">
            {t('budget.startup', {
              amount: formatMoney(salary.amount),
              missing: formatMoney(salary.shortfall),
            })}
          </p>
        {/if}
        <p>{t('budget.payAmount', { amount: formatMoney(salary.amount) })}</p>
        {#if reserves.length}
          <h4>{t('close.s5.reserves')}</h4>
          <ul class="small">
            {#each reserves as r (r.potId)}
              <li>
                {r.overdue
                  ? t('reserve.overdue', { name: r.name })
                  : t('reserve.line', {
                      name: r.name,
                      amount: formatMoney(r.due),
                      n: r.monthsLeft,
                    })}
              </li>
            {/each}
          </ul>
        {/if}
        <button type="button" class="btn primary" onclick={pay}>{t('close.s5.do')}</button>
      {:else}
        <p class="notice ok">✓ {t('budget.paid')}</p>
      {/if}
    {:else if step === 6}
      {#if overflowTotal === 0}
        <p class="notice">{t('close.s6.none')}</p>
      {:else}
        <ul class="list">
          {#each [...overflowShares] as [potId, amt] (potId)}
            <li class="row between item">
              <span>{data.pots.find((p) => p.id === potId)?.name}</span>
              <Amount value={amt} color={false} />
            </li>
          {/each}
        </ul>
        <button
          type="button"
          class="btn primary"
          onclick={() => session.mutate((d) => distributeOverflowToGoals(d, nextStart))}
        >
          {t('close.s6.do')} ({formatMoney(overflowTotal)})
        </button>
      {/if}
    {:else if step === 7 && report}
      <dl class="kv">
        <dt>{t('dash.income')}</dt>
        <dd>{formatMoney(report.income)}</dd>
        <dt>{t('dash.expense')}</dt>
        <dd>{formatMoney(report.expense)}</dd>
        <dt>{t('dash.net')}</dt>
        <dd><Amount value={report.income - report.expense} /></dd>
        <dt>{t('dash.savingsRate')}</dt>
        <dd>{formatPercent(report.savingsRate)}</dd>
        <dt>{t('dash.buffer')}</dt>
        <dd>{formatMoney(report.buffer)}</dd>
      </dl>
      {#if report.byCategory.length}
        <h4>{t('dash.byCategory')}</h4>
        <ul class="small cats">
          {#each report.byCategory as c (c.categoryId)}
            <li class="row between">
              <span>{categoryLabel(data, c.categoryId) || t('category.uncategorized')}</span><span
                class="amount"
              >
                {formatMoney(c.amount)}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if closed}
        <p class="notice ok">✓ {t('close.s7.done', { month: formatMonth(month) })}</p>
      {:else}
        <button type="button" class="btn primary" onclick={finish}>{t('close.s7.do')}</button>
      {/if}
    {/if}

    <div class="row between nav">
      <button type="button" class="btn" disabled={step === 1} onclick={() => step--}>
        {t('common.back')}
      </button>
      {#if step < 7}
        <button type="button" class="btn primary" onclick={() => step++}>{t('common.next')}</button>
      {:else if closed}
        <button
          type="button"
          class="btn"
          onclick={() => {
            month = nextMonthToClose(data, today) ?? '';
            step = 1;
          }}
        >
          {t('common.next')}
        </button>
      {/if}
    </div>
  </section>
{/if}

{#if data.monthClosings.length}
  <section class="card">
    <h2>{t('close.closedMonths')}</h2>
    <ul class="list">
      {#each [...data.monthClosings].sort((a, b) => (a.month < b.month ? 1 : -1)) as c (c.month)}
        <li class="row between item">
          <button
            type="button"
            class="btn ghost small"
            onclick={() => ((month = c.month), (step = 7))}
          >
            {formatMonth(c.month)}
          </button>
          <button
            type="button"
            class="btn ghost small"
            onclick={() =>
              confirm(t('close.reopen') + '?') && session.mutate((d) => reopenMonth(d, c.month))}
          >
            {t('close.reopen')}
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .steps {
    list-style: none;
    padding: 0;
    margin: 0 0 12px;
    display: flex;
    gap: 6px;
    overflow-x: auto;
  }
  .stepbtn {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 999px;
    padding: 6px 12px 6px 6px;
    min-height: 40px;
    cursor: pointer;
    white-space: nowrap;
  }
  .stepbtn[aria-current='step'] {
    border-color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }
  .num {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--surface-2);
    font-size: 0.85rem;
  }
  .stepbtn[aria-current='step'] .num {
    background: var(--accent);
    color: var(--accent-text);
  }
  @media (max-width: 700px) {
    .stepbtn:not([aria-current='step']) .lbl {
      display: none;
    }
    .stepbtn:not([aria-current='step']) {
      padding: 6px;
    }
  }
  .unc {
    padding: 10px 0;
  }
  .unc select {
    margin-top: 6px;
  }
  .recon {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-end;
    padding: 10px 0;
  }
  .bank {
    width: 160px;
  }
  .item {
    padding: 8px 0;
  }
  .kv {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
  }
  .kv dt {
    color: var(--muted);
  }
  .kv dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .cats {
    list-style: none;
    padding: 0;
  }
  .nav {
    margin-top: 16px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
</style>
