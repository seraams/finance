<script lang="ts">
  import { addDays, todayIso } from '../lib/domain/dates';
  import { categoryLabel, categoryTree } from '../lib/domain/entities';
  import { formatMoney } from '../lib/domain/money';
  import {
    annualCost,
    deleteRecurring,
    formatRrule,
    parseRrule,
    saveRecurring,
    type Freq,
  } from '../lib/domain/recurring';
  import type { Recurring, RecurringTemplate } from '../lib/domain/types';
  import { formatDate, t, type MessageKey } from '../lib/i18n/index.svelte';
  import { session } from '../lib/state/session.svelte';
  import Amount from '../lib/ui/Amount.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import MoneyInput from '../lib/ui/MoneyInput.svelte';

  type Mode = 'expense' | 'income' | 'transfer';
  const FREQS: Freq[] = ['MONTHLY', 'YEARLY', 'WEEKLY', 'DAILY'];
  const data = $derived(session.data!);
  const list = $derived([...data.recurring].sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1)));
  const subsAnnual = $derived(
    data.recurring
      .filter((r) => r.active && r.isSubscription && r.template.amount < 0)
      .reduce((a, r) => a + annualCost(r), 0),
  );
  const fixedMonthly = $derived(
    Math.round(
      data.recurring
        .filter((r) => r.active && r.template.amount < 0)
        .reduce((a, r) => a + annualCost(r), 0) / 12,
    ),
  );
  const accounts = $derived(data.accounts.filter((a) => !a.archived));
  const soon = addDays(todayIso(), 7);

  let open = $state(false);
  let editing = $state<Recurring | null>(null);
  let name = $state('');
  let mode = $state<Mode>('expense');
  let amount = $state<number | null>(null);
  let accountId = $state('');
  let target = $state('');
  let payee = $state('');
  let freq = $state<Freq>('MONTHLY');
  let interval = $state(1);
  let nextDate = $state(todayIso());
  let endDate = $state('');
  let isSubscription = $state(false);
  let active = $state(true);
  let error = $state<string | null>(null);

  function openNew() {
    editing = null;
    name = payee = target = endDate = '';
    mode = 'expense';
    amount = null;
    accountId = accounts.find((a) => a.type === 'private')?.id ?? accounts[0]?.id ?? '';
    freq = 'MONTHLY';
    interval = 1;
    nextDate = todayIso();
    isSubscription = false;
    active = true;
    error = null;
    open = true;
  }

  function openEdit(r: Recurring) {
    editing = r;
    name = r.name;
    const s = r.template.splits[0];
    mode = s?.counterAccountId ? 'transfer' : r.template.amount > 0 ? 'income' : 'expense';
    amount = Math.abs(r.template.amount);
    accountId = r.template.accountId;
    target = s?.categoryId
      ? `c:${s.categoryId}`
      : s?.counterAccountId
        ? `a:${s.counterAccountId}`
        : '';
    payee = r.template.payee;
    const rule = parseRrule(r.rrule);
    freq = rule.freq;
    interval = rule.interval;
    nextDate = r.nextDate;
    endDate = r.endDate ?? '';
    isSubscription = r.isSubscription;
    active = r.active;
    error = null;
    open = true;
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const abs = amount ?? 0;
    const signed = mode === 'income' ? abs : -abs;
    const [kind, id] = [target.slice(0, 1), target.slice(2)];
    const template: RecurringTemplate = {
      accountId,
      amount: signed,
      payee,
      note: '',
      tagIds: [],
      splits:
        kind === 'c'
          ? [{ categoryId: id, amount: signed, note: '' }]
          : kind === 'a'
            ? [{ counterAccountId: id, amount: signed, note: '' }]
            : [],
    };
    const day = Number(nextDate.slice(8, 10));
    try {
      session.mutate((d) =>
        saveRecurring(d, {
          ...(editing ? { id: editing.id } : {}),
          name: name || payee,
          template,
          rrule: formatRrule({ freq, interval, byMonthDay: day }),
          nextDate,
          ...(endDate ? { endDate } : {}),
          isSubscription,
          active,
        }),
      );
      open = false;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function remove() {
    if (!editing || !confirm(t('common.confirmDelete'))) return;
    const id = editing.id;
    session.mutate((d) => deleteRecurring(d, id));
    open = false;
  }

  function describe(r: Recurring): string {
    const s = r.template.splits[0];
    if (s?.counterAccountId)
      return `→ ${data.accounts.find((a) => a.id === s.counterAccountId)?.name ?? '?'}`;
    return categoryLabel(data, s?.categoryId) || t('category.uncategorized');
  }

  function freqLabel(r: Recurring): string {
    const rule = parseRrule(r.rrule);
    const label = t(`rec.freq.${rule.freq}` as MessageKey);
    return rule.interval > 1 ? `${label} ×${rule.interval}` : label;
  }

  const tree = $derived(categoryTree(data, mode === 'income' ? 'income' : 'expense'));
</script>

<div class="row between head">
  <h1>{t('rec.title')}</h1>
  <button type="button" class="btn primary" onclick={openNew}>＋ {t('rec.new')}</button>
</div>

<div class="cards">
  <div class="card">
    <div class="kpi-label">{t('rec.annualTotal')}</div>
    <div class="kpi-value">{formatMoney(subsAnnual)}</div>
  </div>
  <div class="card">
    <div class="kpi-label">{t('rec.monthlyTotal')}</div>
    <div class="kpi-value">{formatMoney(fixedMonthly)}</div>
  </div>
</div>

<section class="card">
  {#if list.length === 0}
    <p class="muted">{t('rec.empty')}</p>
  {:else}
    <ul class="list">
      {#each list as r (r.id)}
        <li>
          <button type="button" class="list-item" onclick={() => openEdit(r)}>
            <span class="grow">
              <span class="nm" class:muted={!r.active}>
                {r.name}{#if r.isSubscription}<span class="badge">
                    {t('rec.subscription')}
                  </span>{/if}
              </span>
              <span class="small muted">
                {describe(r)} · {freqLabel(r)} ·
                <span class:soon={r.active && r.nextDate <= soon}>
                  {r.active ? formatDate(r.nextDate) : t('rec.inactive')}
                </span>{#if r.isSubscription}
                  &#32;· {t('rec.annual')}: {formatMoney(annualCost(r))}{/if}
              </span>
            </span>
            <Amount value={r.template.amount} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<Dialog bind:open title={editing ? t('rec.edit') : t('rec.new')}>
  <form onsubmit={submit}>
    <div class="segmented" role="group" aria-label={t('tx.kind')}>
      {#each ['expense', 'income', 'transfer'] as const as m (m)}
        <button type="button" aria-pressed={mode === m} onclick={() => ((mode = m), (target = ''))}>
          {t(`tx.${m}`)}
        </button>
      {/each}
    </div>
    <div class="field">
      <label for="rc-name">{t('rec.name')}</label>
      <input id="rc-name" type="text" bind:value={name} />
    </div>
    <div class="grid-2">
      <div class="field">
        <MoneyInput id="rc-amount" label={t('common.amount')} bind:value={amount} unsigned />
      </div>
      <div class="field">
        <label for="rc-acc">{mode === 'transfer' ? t('tx.fromAccount') : t('tx.account')}</label>
        <select id="rc-acc" bind:value={accountId}>
          {#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </div>
    </div>
    <div class="field">
      <label for="rc-target">{mode === 'transfer' ? t('tx.toAccount') : t('tx.category')}</label>
      <select id="rc-target" bind:value={target}>
        <option value="">–</option>
        {#if mode === 'transfer'}
          {#each accounts.filter((a) => a.id !== accountId) as a (a.id)}<option value={`a:${a.id}`}>
              {a.name}
            </option>{/each}
        {:else}
          {#each tree as g (g.parent.id)}
            <optgroup label={g.parent.name}>
              <option value={`c:${g.parent.id}`}>{g.parent.name}</option>
              {#each g.children as c (c.id)}<option value={`c:${c.id}`}>{c.name}</option>{/each}
            </optgroup>
          {/each}
        {/if}
      </select>
    </div>
    <div class="field">
      <label for="rc-payee">{t('tx.payee')}</label>
      <input id="rc-payee" type="text" bind:value={payee} />
    </div>
    <div class="grid-2">
      <div class="field">
        <label for="rc-freq">{t('rec.freq')}</label>
        <select id="rc-freq" bind:value={freq}>
          {#each FREQS as f (f)}<option value={f}>{t(`rec.freq.${f}` as MessageKey)}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="rc-int">{t('rec.interval')}</label>
        <input id="rc-int" type="number" min="1" max="60" step="1" bind:value={interval} />
      </div>
      <div class="field">
        <label for="rc-next">{t('rec.next')}</label>
        <input id="rc-next" type="date" bind:value={nextDate} required />
      </div>
      <div class="field">
        <label for="rc-end">{t('rec.end')}</label>
        <input id="rc-end" type="date" bind:value={endDate} />
      </div>
    </div>
    <div class="row">
      <label class="check">
        <input type="checkbox" bind:checked={isSubscription} /><span>{t('rec.subscription')}</span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={active} /><span>{t('rec.active')}</span>
      </label>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="row between actions">
      {#if editing}
        <button type="button" class="btn danger" onclick={remove}>{t('common.delete')}</button>
      {:else}<span></span>{/if}
      <button type="submit" class="btn primary" disabled={!amount || !accountId}>
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
  .cards {
    margin-bottom: var(--gap);
  }
  .nm {
    display: block;
    font-weight: 500;
  }
  .badge {
    font-size: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0 8px;
    margin-left: 8px;
    color: var(--muted);
    font-weight: 400;
  }
  .soon {
    color: var(--warn-text);
    font-weight: 600;
  }
  .actions {
    margin-top: 12px;
  }
</style>
