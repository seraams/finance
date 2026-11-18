<script lang="ts">
  import { todayIso } from '../lib/domain/dates';
  import { categoryTree } from '../lib/domain/entities';
  import { formatMoney } from '../lib/domain/money';
  import {
    saveSharedExpense,
    settlePerson,
    sharedShares,
    whoOwesWhom,
    type PersonBalance,
    type SharedExpenseInput,
  } from '../lib/domain/shared';
  import { t } from '../lib/i18n/index.svelte';
  import { session } from '../lib/state/session.svelte';
  import Amount from '../lib/ui/Amount.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import MoneyInput from '../lib/ui/MoneyInput.svelte';

  const data = $derived(session.data!);
  const persons = $derived(data.accounts.filter((a) => a.type === 'person' && !a.archived));
  const balances = $derived(whoOwesWhom(data));
  const myAccounts = $derived(
    data.accounts.filter((a) => !a.archived && a.type !== 'person' && a.budgetRelevant),
  );
  const tree = $derived(categoryTree(data, 'expense'));

  // ---------- Ausgleich ----------
  let settleOpen = $state(false);
  let settleFor = $state<PersonBalance | null>(null);
  let via = $state('');
  let settleAmount = $state<number | null>(null);

  function openSettle(p: PersonBalance) {
    settleFor = p;
    via = myAccounts.find((a) => a.type === 'wallet')?.id ?? myAccounts[0]?.id ?? '';
    settleAmount = Math.abs(p.balance);
    settleOpen = true;
  }

  function doSettle(e: SubmitEvent) {
    e.preventDefault();
    if (!settleFor || !via || !settleAmount) return;
    const pid = settleFor.accountId;
    const amt = settleAmount;
    session.mutate((d) => settlePerson(d, pid, via, todayIso(), amt, settleFor?.name ?? ''));
    settleOpen = false;
    session.showToast(t('shared.settled'));
  }

  // ---------- Geteilte Ausgabe ----------
  let total = $state<number | null>(null);
  let categoryId = $state('');
  let payee = $state('');
  let date = $state(todayIso());
  let paidBy = $state('me');
  let payAccount = $state(
    session.data!.accounts.find((a) => a.type === 'private' && !a.archived)?.id ?? '',
  );
  let participants = $state<string[]>([]);
  let includeMe = $state(true);
  let error = $state<string | null>(null);

  const input = $derived<SharedExpenseInput | null>(
    total && categoryId && (participants.length > 0 || paidBy !== 'me')
      ? {
          date,
          total,
          payee,
          categoryId,
          paidBy:
            paidBy === 'me'
              ? { kind: 'me', accountId: payAccount }
              : { kind: 'person', personId: paidBy },
          participants: [...new Set([...participants, ...(paidBy !== 'me' ? [paidBy] : [])])],
          includeMe,
        }
      : null,
  );
  const shares = $derived(input ? sharedShares(input) : null);

  function toggle(id: string) {
    participants = participants.includes(id)
      ? participants.filter((x) => x !== id)
      : [...participants, id];
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!input) {
      error = t('tx.err.amount-invalid');
      return;
    }
    const i = input;
    session.mutate((d) => saveSharedExpense(d, i));
    session.showToast(t('shared.saved'));
    total = null;
    payee = '';
    error = null;
  }
</script>

<h1>{t('shared.title')}</h1>

{#if persons.length === 0}
  <div class="notice">
    {t('shared.noPersons')} <a href="#/accounts">{t('account.new')}</a>
  </div>
{:else}
  <section class="card" aria-labelledby="who-h">
    <h2 id="who-h">{t('shared.balances')}</h2>
    {#if balances.length === 0}
      <p class="notice ok">✓ {t('shared.even')}</p>
    {:else}
      <ul class="list">
        {#each balances as p (p.accountId)}
          <li class="row between item">
            <a class="grow" href={`#/tx?account=${p.accountId}`}>
              {p.balance > 0
                ? t('shared.owesMe', { name: p.name })
                : t('shared.iOwe', { name: p.name })}
            </a>
            <Amount value={Math.abs(p.balance)} color={false} />
            <button type="button" class="btn small" onclick={() => openSettle(p)}>
              {t('shared.settle')}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card" aria-labelledby="new-h">
    <h2 id="new-h">{t('shared.new')}</h2>
    <form onsubmit={submit} novalidate>
      <div class="field">
        <MoneyInput id="sh-total" label={t('shared.total')} bind:value={total} unsigned large />
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="sh-paid">{t('shared.paidBy')}</label>
          <select id="sh-paid" bind:value={paidBy}>
            <option value="me">{t('shared.me')}</option>
            {#each persons as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          </select>
        </div>
        {#if paidBy === 'me'}
          <div class="field">
            <label for="sh-acc">{t('tx.account')}</label>
            <select id="sh-acc" bind:value={payAccount}>
              {#each myAccounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
            </select>
          </div>
        {/if}
      </div>
      <fieldset class="field plain">
        <legend class="lbl">{t('shared.participants')}</legend>
        <div class="chips">
          <button
            type="button"
            class="chip"
            aria-pressed={includeMe}
            onclick={() => (includeMe = !includeMe)}
          >
            {t('shared.me')}
          </button>
          {#each persons as p (p.id)}
            <button
              type="button"
              class="chip"
              aria-pressed={participants.includes(p.id) || paidBy === p.id}
              disabled={paidBy === p.id}
              onclick={() => toggle(p.id)}
            >
              {p.name}
            </button>
          {/each}
        </div>
      </fieldset>
      <div class="grid-2">
        <div class="field">
          <label for="sh-cat">{t('tx.category')}</label>
          <select id="sh-cat" bind:value={categoryId}>
            <option value="" disabled>–</option>
            {#each tree as g (g.parent.id)}
              <optgroup label={g.parent.name}>
                <option value={g.parent.id}>{g.parent.name}</option>
                {#each g.children as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
              </optgroup>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="sh-date">{t('common.date')}</label>
          <input id="sh-date" type="date" bind:value={date} />
        </div>
      </div>
      <div class="field">
        <label for="sh-payee">{t('tx.payee')}</label>
        <input id="sh-payee" type="text" bind:value={payee} />
      </div>
      {#if shares}
        <p class="notice small" aria-live="polite">
          {t('shared.preview', {
            me: formatMoney(shares.me),
            others: shares.others
              .map(
                (o) =>
                  `${persons.find((p) => p.id === o.personId)?.name ?? '?'} ${formatMoney(o.amount)}`,
              )
              .join(', '),
          })}
        </p>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button type="submit" class="btn primary" disabled={!input}>{t('common.save')}</button>
    </form>
  </section>
{/if}

<Dialog bind:open={settleOpen} title={t('shared.settle')}>
  <form onsubmit={doSettle}>
    {#if settleFor}
      <p>
        {settleFor.balance > 0
          ? t('shared.owesMe', { name: settleFor.name })
          : t('shared.iOwe', { name: settleFor.name })}: {formatMoney(Math.abs(settleFor.balance))}
      </p>
    {/if}
    <div class="grid-2">
      <div class="field">
        <label for="st-via">{t('shared.settleVia')}</label>
        <select id="st-via" bind:value={via}>
          {#each myAccounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <MoneyInput
          id="st-amount"
          label={t('shared.settleAmount')}
          bind:value={settleAmount}
          unsigned
        />
      </div>
    </div>
    <div class="row end">
      <button type="submit" class="btn primary" disabled={!via || !settleAmount}>
        {t('shared.settle')}
      </button>
    </div>
  </form>
</Dialog>

<style>
  .item {
    padding: 8px 0;
    flex-wrap: nowrap;
  }
  fieldset.plain {
    border: none;
    padding: 0;
    margin: 0 0 14px;
  }
  .lbl {
    font-size: 0.875rem;
    color: var(--muted);
    margin-bottom: 6px;
    padding: 0;
  }
</style>
