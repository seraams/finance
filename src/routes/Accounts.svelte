<script lang="ts">
  import { accountBalances } from '../lib/domain/balances';
  import { todayIso } from '../lib/domain/dates';
  import {
    accountInUse,
    defaultBudgetRelevant,
    deleteAccount,
    saveAccount,
  } from '../lib/domain/entities';
  import { ACCOUNT_TYPES, type Account, type AccountType } from '../lib/domain/types';
  import { t, type MessageKey } from '../lib/i18n/index.svelte';
  import { session } from '../lib/state/session.svelte';
  import Amount from '../lib/ui/Amount.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import MoneyInput from '../lib/ui/MoneyInput.svelte';

  const data = $derived(session.data!);
  const balances = $derived(accountBalances(data));
  const active = $derived(data.accounts.filter((a) => !a.archived));
  const archived = $derived(data.accounts.filter((a) => a.archived));
  const budgetTotal = $derived(
    active.filter((a) => a.budgetRelevant).reduce((s, a) => s + (balances.get(a.id) ?? 0), 0),
  );
  const netWorth = $derived(data.accounts.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0));

  let open = $state(false);
  let editing = $state<Account | null>(null);
  let name = $state('');
  let type = $state<AccountType>('private');
  let opening = $state<number | null>(0);
  let openingDate = $state(todayIso());
  let budgetRelevant = $state(true);
  let isArchived = $state(false);
  let brTouched = $state(false);
  let error = $state<string | null>(null);

  function openNew() {
    editing = null;
    name = '';
    type = 'private';
    opening = 0;
    openingDate = todayIso();
    budgetRelevant = true;
    isArchived = false;
    brTouched = false;
    error = null;
    open = true;
  }

  function openEdit(a: Account) {
    editing = a;
    name = a.name;
    type = a.type;
    opening = a.openingBalance;
    openingDate = a.openingDate;
    budgetRelevant = a.budgetRelevant;
    isArchived = a.archived;
    brTouched = true;
    error = null;
    open = true;
  }

  function onTypeChange() {
    if (!brTouched) budgetRelevant = defaultBudgetRelevant(type);
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) {
      error = t('common.name');
      return;
    }
    session.mutate((d) =>
      saveAccount(d, {
        ...(editing ? { id: editing.id } : {}),
        name,
        type,
        openingBalance: opening ?? 0,
        openingDate,
        budgetRelevant,
        archived: isArchived,
      }),
    );
    open = false;
  }

  function remove() {
    if (!editing) return;
    const inUse = accountInUse(data, editing.id);
    if (inUse) {
      if (!confirm(`${t('account.inUse')}\n\n${t('account.deleteForce')}?`)) return;
    } else if (!confirm(t('common.confirmDelete'))) return;
    const id = editing.id;
    session.mutate((d) => deleteAccount(d, id, inUse));
    open = false;
  }
</script>

<div class="row between head">
  <h1>{t('account.title')}</h1>
  <button type="button" class="btn primary" onclick={openNew}>＋ {t('account.new')}</button>
</div>

{#if data.accounts.length === 0}
  <div class="card"><p class="muted">{t('account.empty')}</p></div>
{:else}
  <div class="cards">
    <div class="card">
      <div class="kpi-label">{t('account.budgetSum')}</div>
      <div class="kpi-value"><Amount value={budgetTotal} color={false} /></div>
    </div>
    <div class="card">
      <div class="kpi-label">{t('account.netWorth')}</div>
      <div class="kpi-value"><Amount value={netWorth} color={false} /></div>
    </div>
  </div>

  {#each [{ list: active, title: '' }, { list: archived, title: t('common.archived') }] as group (group.title)}
    {#if group.list.length}
      {#if group.title}<h2 class="sec">{group.title}</h2>{/if}
      <div class="card tight">
        <ul class="list">
          {#each group.list as a (a.id)}
            <li class="acc">
              <button type="button" class="list-item" onclick={() => openEdit(a)}>
                <span class="grow">
                  <span class="nm">{a.name}</span>
                  <span class="small muted">
                    {t(`account.type.${a.type}` as MessageKey)}{a.budgetRelevant
                      ? ''
                      : ' · ' + t('account.netWorth')}
                  </span>
                </span>
                <Amount value={balances.get(a.id) ?? 0} />
              </button>
              <a
                class="btn ghost small"
                href={`#/tx?account=${a.id}`}
                aria-label={`${t('nav.transactions')}: ${a.name}`}
              >
                ≡
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/each}
{/if}

<Dialog bind:open title={editing ? t('account.edit') : t('account.new')}>
  <form onsubmit={submit}>
    <div class="field">
      <label for="acc-name">{t('common.name')}</label>
      <input id="acc-name" type="text" bind:value={name} required />
    </div>
    <div class="field">
      <label for="acc-type">{t('account.type')}</label>
      <select id="acc-type" bind:value={type} onchange={onTypeChange}>
        {#each ACCOUNT_TYPES as ty (ty)}
          <option value={ty}>{t(`account.type.${ty}` as MessageKey)}</option>
        {/each}
      </select>
    </div>
    <div class="grid-2">
      <div class="field">
        <MoneyInput id="acc-opening" label={t('account.opening')} bind:value={opening} />
      </div>
      <div class="field">
        <label for="acc-date">{t('account.openingDate')}</label>
        <input id="acc-date" type="date" bind:value={openingDate} required />
      </div>
    </div>
    <div class="field">
      <label class="check">
        <input
          type="checkbox"
          bind:checked={budgetRelevant}
          onchange={() => (brTouched = true)}
        /><span>{t('account.budgetRelevant')}</span>
      </label>
      <p class="hint">{t('account.budgetRelevantHint')}</p>
    </div>
    {#if editing}
      <div class="field">
        <label class="check">
          <input type="checkbox" bind:checked={isArchived} /><span>{t('common.archived')}</span>
        </label>
      </div>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
    <div class="row between">
      {#if editing}
        <button type="button" class="btn danger" onclick={remove}>{t('common.delete')}</button>
      {:else}<span></span>{/if}
      <button type="submit" class="btn primary">{t('common.save')}</button>
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
  .tight {
    padding: 0 12px;
  }
  .acc {
    display: flex;
    align-items: center;
  }
  .nm {
    display: block;
    font-weight: 500;
  }
  .sec {
    margin-top: 16px;
    font-size: 0.9rem;
    color: var(--muted);
  }
</style>
