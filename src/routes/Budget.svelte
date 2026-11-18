<script lang="ts">
  import { potBalances } from '../lib/domain/balances';
  import {
    categoryStatuses,
    copyBudgetsFromPreviousMonth,
    getBudget,
    monthOverview,
    paySalary,
    previewSalary,
    setBudget,
  } from '../lib/domain/budget';
  import { addMonths, budgetMonthOf, budgetMonthStart, todayIso } from '../lib/domain/dates';
  import { categoryTree, deletePot, savePot } from '../lib/domain/entities';
  import { uuidv7 } from '../lib/domain/ids';
  import { formatMoney } from '../lib/domain/money';
  import type { Category, Pot } from '../lib/domain/types';
  import { formatMonth, t } from '../lib/i18n/index.svelte';
  import { session } from '../lib/state/session.svelte';
  import Amount from '../lib/ui/Amount.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import MoneyInput from '../lib/ui/MoneyInput.svelte';

  const data = $derived(session.data!);
  const today = todayIso();
  const currentMonth = $derived(budgetMonthOf(today, data.settings.monthStartDay));
  let month = $state(budgetMonthOf(todayIso(), session.data!.settings.monthStartDay));

  const payDate = $derived(
    month === currentMonth ? today : budgetMonthStart(month, data.settings.monthStartDay),
  );
  const preview = $derived(previewSalary(data, payDate));
  const overview = $derived(monthOverview(data, month));
  const statuses = $derived(categoryStatuses(data, month));
  const tree = $derived(categoryTree(data, 'expense'));
  const balances = $derived(potBalances(data));

  function pay() {
    session.mutate((d) => paySalary(d, payDate));
  }

  // ---------- Budget bearbeiten ----------
  let budgetOpen = $state(false);
  let budgetCat = $state<Category | null>(null);
  let budgetValue = $state<number | null>(null);

  function editBudget(c: Category) {
    budgetCat = c;
    budgetValue = getBudget(data, month, c.id);
    budgetOpen = true;
  }

  function saveBudget(e: SubmitEvent) {
    e.preventDefault();
    if (!budgetCat) return;
    const id = budgetCat.id;
    session.mutate((d) => setBudget(d, month, id, Math.max(0, budgetValue ?? 0)));
    budgetOpen = false;
  }

  function copyPrev() {
    const n = session.mutate((d) => copyBudgetsFromPreviousMonth(d, month));
    session.showToast(t('budget.copied', { n }));
  }

  // ---------- Töpfe ----------
  let potOpen = $state(false);
  let editingPot = $state<Pot | null>(null);
  let potKind = $state<'goal' | 'reserve'>('goal');
  let potName = $state('');
  let potTarget = $state<number | null>(null);
  let potDate = $state('');
  let potWeight = $state(1);

  function newPot() {
    editingPot = null;
    potKind = 'goal';
    potName = '';
    potTarget = null;
    potDate = '';
    potWeight = 1;
    potOpen = true;
  }

  function editPot(p: Pot) {
    editingPot = p;
    potKind = p.kind === 'reserve' ? 'reserve' : 'goal';
    potName = p.name;
    potTarget = p.targetAmount ?? null;
    potDate = p.targetDate ?? '';
    potWeight = p.weight ?? 1;
    potOpen = true;
  }

  function submitPot(e: SubmitEvent) {
    e.preventDefault();
    if (!potName.trim()) return;
    session.mutate((d) =>
      savePot(d, {
        ...(editingPot ? { id: editingPot.id } : {}),
        kind: potKind,
        name: potName,
        ...(potTarget !== null ? { targetAmount: potTarget } : {}),
        ...(potDate ? { targetDate: potDate } : {}),
        weight: potWeight,
      }),
    );
    potOpen = false;
  }

  function removePot() {
    if (!editingPot || !confirm(t('common.confirmDelete'))) return;
    const id = editingPot.id;
    session.mutate((d) => deletePot(d, id));
    potOpen = false;
  }

  let moveOpen = $state(false);
  let moveFrom = $state('');
  let moveTo = $state('');
  let moveAmount = $state<number | null>(null);

  function openMove(p?: Pot) {
    moveFrom = data.pots.find((x) => x.kind === 'buffer')?.id ?? '';
    moveTo = p?.id ?? '';
    moveAmount = null;
    moveOpen = true;
  }

  function submitMove(e: SubmitEvent) {
    e.preventDefault();
    if (!moveFrom || !moveTo || moveFrom === moveTo || !moveAmount || moveAmount <= 0) return;
    const amount = moveAmount;
    session.mutate((d) =>
      d.potMoves.push({
        id: uuidv7(),
        date: today,
        fromPotId: moveFrom,
        toPotId: moveTo,
        amount,
        reason: 'manual',
      }),
    );
    moveOpen = false;
    session.showToast(t('budget.moveDone'));
  }

  function potLabel(p: Pot): string {
    if (p.kind === 'buffer') return t('pot.buffer');
    if (p.kind === 'monthly') return t('pot.monthly');
    return p.name;
  }

  function barClass(usage: number): string {
    if (usage > 1) return 'over';
    if (usage >= 0.8) return 'warn';
    return '';
  }

  function barWidth(usage: number): string {
    return `${Math.min(100, Math.max(0, usage * 100)).toFixed(1)}%`;
  }
</script>

<div class="row between head">
  <h1>{t('budget.title')}</h1>
  <div class="row month-nav">
    <button
      type="button"
      class="btn small"
      aria-label={t('budget.prevMonth')}
      onclick={() => (month = addMonths(month, -1))}
    >
      ‹
    </button>
    <span class="month" aria-live="polite">{formatMonth(month)}</span>
    <button
      type="button"
      class="btn small"
      aria-label={t('budget.nextMonth')}
      onclick={() => (month = addMonths(month, 1))}
    >
      ›
    </button>
  </div>
</div>

<div class="cards">
  <section class="card" aria-labelledby="salary-h">
    <h2 id="salary-h">{t('budget.salary')}</h2>
    {#if data.settings.salary <= 0}
      <p class="notice warn">{t('budget.noSalary')} <a href="#/settings">{t('nav.settings')}</a></p>
    {:else}
      <p class="row between">
        <span class="muted">S</span><Amount value={data.settings.salary} color={false} />
      </p>
      <p class="row between">
        <span class="muted">{t('budget.salaryPaid')}</span><Amount
          value={overview.salaryPaid}
          color={false}
        />
      </p>
      {#if preview.amount > 0}
        {#if preview.startupPhase}
          <p class="notice warn" role="note">
            {t('budget.startup', {
              amount: formatMoney(preview.amount),
              missing: formatMoney(preview.shortfall),
            })}
          </p>
        {/if}
        <button type="button" class="btn primary block" onclick={pay}>
          {t('budget.payAmount', { amount: formatMoney(preview.amount) })}
        </button>
      {:else if overview.salaryPaid >= data.settings.salary}
        <p class="notice ok">✓ {t('budget.paid')}</p>
      {:else}
        <p class="notice danger">
          {t('budget.startup', { amount: formatMoney(0), missing: formatMoney(preview.shortfall) })}
        </p>
      {/if}
    {/if}
  </section>

  <section class="card" aria-labelledby="pot-h">
    <h2 id="pot-h">{t('budget.monthlyPot')}</h2>
    <div class="kpi-value"><Amount value={overview.monthlyPot} /></div>
    <dl class="kv">
      <dt>{t('budget.budgeted')}</dt>
      <dd><Amount value={overview.budgeted} color={false} /></dd>
      <dt>{t('budget.spent')}</dt>
      <dd><Amount value={overview.spent} color={false} /></dd>
      <dt>{t('budget.unbudgeted')}</dt>
      <dd><Amount value={overview.unbudgeted} /></dd>
    </dl>
  </section>
</div>

<section class="card cats" aria-labelledby="cats-h">
  <div class="row between">
    <h2 id="cats-h">{t('category.title')}</h2>
    <button type="button" class="btn small" onclick={copyPrev}>{t('budget.copyPrev')}</button>
  </div>
  <ul class="list">
    {#each tree as g (g.parent.id)}
      {#each [g.parent, ...g.children] as c (c.id)}
        {@const s = statuses.get(c.id)}
        {@const available = (s?.budget ?? 0) + (s?.carryIn ?? 0)}
        <li>
          <button
            type="button"
            class="list-item cat"
            class:child={!!c.parentId}
            onclick={() => editBudget(c)}
            aria-label={t('budget.edit', { name: c.name })}
          >
            <span class="grow">
              <span class="row between">
                <span class:strong={!c.parentId}>{c.name}</span>
                <span class="small">
                  {#if available > 0 || (s?.spent ?? 0) !== 0}
                    <Amount value={s?.rest ?? 0} />
                    <span class="muted">/ {formatMoney(available)}</span>
                  {:else}
                    <span class="muted">–</span>
                  {/if}
                </span>
              </span>
              {#if available > 0 || (s?.spent ?? 0) > 0}
                <span class="bar {barClass(s?.usage ?? 0)}" aria-hidden="true">
                  <span style:width={barWidth(s?.usage ?? 0)}></span>
                </span>
                {#if (s?.carryIn ?? 0) > 0}
                  <span class="small muted">{t('budget.carry')}: {formatMoney(s!.carryIn)}</span>
                {/if}
                {#if (s?.rest ?? 0) < 0}
                  <span class="small neg">{t('budget.overspent')}</span>
                {/if}
              {/if}
            </span>
          </button>
        </li>
      {/each}
    {/each}
  </ul>
</section>

<section class="card" aria-labelledby="pots-h">
  <div class="row between">
    <h2 id="pots-h">{t('budget.pots')}</h2>
    <div class="row">
      <button type="button" class="btn small" onclick={() => openMove()}>
        {t('budget.potMove')}
      </button>
      <button type="button" class="btn small" onclick={newPot}>＋ {t('budget.newGoal')}</button>
    </div>
  </div>
  <ul class="list">
    {#each data.pots as p (p.id)}
      <li>
        <button
          type="button"
          class="list-item"
          onclick={() => (p.kind === 'goal' || p.kind === 'reserve' ? editPot(p) : openMove(p))}
        >
          <span class="grow">
            <span class="strong">{potLabel(p)}</span>
            <span class="small muted">
              {p.kind === 'goal'
                ? t('budget.goal')
                : p.kind === 'reserve'
                  ? t('budget.reserve')
                  : ''}
              {#if p.targetAmount}· {t('budget.target')}: {formatMoney(p.targetAmount)}{/if}
            </span>
          </span>
          <Amount value={balances.get(p.id) ?? 0} />
        </button>
      </li>
    {/each}
  </ul>
</section>

<Dialog bind:open={budgetOpen} title={t('budget.edit', { name: budgetCat?.name ?? '' })}>
  <form onsubmit={saveBudget}>
    <p class="muted">{formatMonth(month)}</p>
    <div class="field">
      <MoneyInput
        id="budget-amount"
        label={t('common.amount')}
        bind:value={budgetValue}
        unsigned
        autofocus
      />
    </div>
    <div class="row end">
      <button type="submit" class="btn primary">{t('common.save')}</button>
    </div>
  </form>
</Dialog>

<Dialog bind:open={potOpen} title={editingPot ? editingPot.name : t('budget.newGoal')}>
  <form onsubmit={submitPot}>
    <div class="segmented" role="group" aria-label={t('category.kind')}>
      <button type="button" aria-pressed={potKind === 'goal'} onclick={() => (potKind = 'goal')}>
        {t('budget.goal')}
      </button>
      <button
        type="button"
        aria-pressed={potKind === 'reserve'}
        onclick={() => (potKind = 'reserve')}
      >
        {t('budget.reserve')}
      </button>
    </div>
    <div class="field">
      <label for="pot-name">{t('common.name')}</label>
      <input id="pot-name" type="text" bind:value={potName} required />
    </div>
    <div class="grid-2">
      <div class="field">
        <MoneyInput id="pot-target" label={t('budget.target')} bind:value={potTarget} unsigned />
      </div>
      <div class="field">
        <label for="pot-date">{t('budget.targetDate')}</label>
        <input id="pot-date" type="date" bind:value={potDate} />
      </div>
    </div>
    {#if potKind === 'goal'}
      <div class="field">
        <label for="pot-weight">{t('budget.weight')}</label>
        <input id="pot-weight" type="number" min="0" step="1" bind:value={potWeight} />
      </div>
    {/if}
    <div class="row between">
      {#if editingPot}
        <button type="button" class="btn danger" onclick={removePot}>{t('common.delete')}</button>
      {:else}<span></span>{/if}
      <button type="submit" class="btn primary">{t('common.save')}</button>
    </div>
  </form>
</Dialog>

<Dialog bind:open={moveOpen} title={t('budget.potMove')}>
  <form onsubmit={submitMove}>
    <div class="grid-2">
      <div class="field">
        <label for="mv-from">{t('budget.from')}</label>
        <select id="mv-from" bind:value={moveFrom}>
          {#each data.pots as p (p.id)}<option value={p.id}>{potLabel(p)}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="mv-to">{t('budget.to')}</label>
        <select id="mv-to" bind:value={moveTo}>
          <option value="" disabled>–</option>
          {#each data.pots.filter((p) => p.id !== moveFrom) as p (p.id)}
            <option value={p.id}>{potLabel(p)}</option>
          {/each}
        </select>
      </div>
    </div>
    <div class="field">
      <MoneyInput id="mv-amount" label={t('common.amount')} bind:value={moveAmount} unsigned />
    </div>
    <div class="row end">
      <button type="submit" class="btn primary" disabled={!moveTo || !moveAmount}>
        {t('common.save')}
      </button>
    </div>
  </form>
</Dialog>

<style>
  .head {
    margin-bottom: 12px;
  }
  .head h1 {
    margin: 0;
  }
  .month {
    min-width: 9em;
    text-align: center;
    font-weight: 600;
  }
  .cards {
    margin-bottom: var(--gap);
  }
  .kv {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
    margin: 12px 0 0;
  }
  .kv dt {
    color: var(--muted);
  }
  .kv dd {
    margin: 0;
    text-align: right;
  }
  .cat {
    flex-direction: column;
    align-items: stretch;
    min-height: 52px;
  }
  .cat .bar {
    display: block;
    margin-top: 6px;
  }
  .child {
    padding-left: 20px;
  }
  .strong {
    font-weight: 600;
    display: block;
  }
</style>
