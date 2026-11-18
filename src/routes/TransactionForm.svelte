<script lang="ts">
  import { isDateInClosedMonth } from '../lib/domain/closing';
  import { budgetMonthOf, todayIso } from '../lib/domain/dates';
  import { categoryLabel, categoryTree, saveTag } from '../lib/domain/entities';
  import { formatMoney } from '../lib/domain/money';
  import {
    deleteTransaction,
    originOf,
    saveTransaction,
    toInput,
    validateTransaction,
    type SplitInput,
    type TransactionInput,
  } from '../lib/domain/transactions';
  import type { Id } from '../lib/domain/types';
  import { formatDate, formatMonth, t, type MessageKey } from '../lib/i18n/index.svelte';
  import { attachmentsOf } from '../lib/domain/attachments';
  import { uuidv7 } from '../lib/domain/ids';
  import { refundable, refundInput, refundsOf } from '../lib/domain/refunds';
  import Amount from '../lib/ui/Amount.svelte';
  import { router } from '../lib/router.svelte';
  import { lastUsed, session } from '../lib/state/session.svelte';
  import MoneyInput from '../lib/ui/MoneyInput.svelte';
  import { untrack } from 'svelte';

  interface Props {
    id?: string;
  }
  let { id }: Props = $props();

  type Mode = 'expense' | 'income' | 'transfer';
  interface Row {
    key: number;
    /** `c:<id>` für Kategorie, `a:<id>` für Konto */
    target: string;
    amount: number | null;
    potId: string;
  }

  const d = session.requireData();
  const initialId = untrack(() => id);
  const existingRaw = initialId ? d.transactions.find((x) => x.id === initialId) : undefined;
  const existing = existingRaw ? originOf(d, existingRaw) : undefined;
  const wasMirror = !!existingRaw && existing?.id !== existingRaw.id;

  const accounts = $derived(
    session.data!.accounts.filter((a) => !a.archived || a.id === existing?.accountId),
  );
  const pots = $derived(session.data!.pots);

  // ---------- Anfangszustand ----------
  let mode = $state<Mode>('expense');
  let amount = $state<number | null>(null);
  let accountId = $state<Id>('');
  let toAccountId = $state<Id>('');
  let categoryId = $state<Id>('');
  let potId = $state<Id>('');
  let date = $state(todayIso());
  let payee = $state('');
  let note = $state('');
  let tagIds = $state<Id[]>([]);
  let splitMode = $state(false);
  let rows = $state<Row[]>([]);
  let newTag = $state('');
  let errors = $state<string[]>([]);
  let rowKey = 0;
  /** ID der Buchung – bei neuen Buchungen schon vorab, damit Belege zugeordnet werden können. */
  const txId = existing?.id ?? uuidv7();
  /** Originalbuchung, falls dies eine Rückerstattung ist. */
  let refundOf = $state<string | undefined>(existing?.refundOfId);

  function init() {
    const q = router.route.query;
    const refundId = q.get('refund');
    if (!existing && refundId && d.transactions.some((x) => x.id === refundId)) {
      const input = refundInput(d, refundId, refundable(d, refundId), todayIso());
      refundOf = refundId;
      mode = 'expense';
      amount = input.amount || null;
      accountId = input.accountId;
      payee = input.payee ?? '';
      tagIds = [...(input.tagIds ?? [])];
      if (input.splits.length === 1) categoryId = input.splits[0]!.categoryId ?? '';
      else if (input.splits.length > 1) {
        splitMode = true;
        rows = input.splits.map((s) => ({
          key: rowKey++,
          target: `c:${s.categoryId}`,
          amount: Math.abs(s.amount),
          potId: s.potId ?? '',
        }));
      }
      return;
    }
    if (!existing) {
      const qMode = q.get('mode');
      if (qMode === 'income' || qMode === 'transfer') mode = qMode;
      accountId =
        q.get('account') ??
        (lastUsed.accountId && d.accounts.some((a) => a.id === lastUsed.accountId)
          ? lastUsed.accountId
          : (d.accounts.find((a) => !a.archived && a.budgetRelevant)?.id ?? ''));
      return;
    }
    const input = toInput(d, existing);
    amount = Math.abs(input.amount);
    accountId = input.accountId;
    date = input.date;
    payee = input.payee ?? '';
    note = input.note ?? '';
    tagIds = [...(input.tagIds ?? [])];
    const splits = input.splits;
    const onlyCounter = splits.length === 1 && !!splits[0]!.counterAccountId;
    if (onlyCounter) {
      mode = 'transfer';
      toAccountId = splits[0]!.counterAccountId!;
      potId = splits[0]!.potId ?? '';
      if (input.amount > 0) {
        // Ursprung ist ein Zufluss: Richtung umdrehen
        toAccountId = input.accountId;
        accountId = splits[0]!.counterAccountId!;
      }
      return;
    }
    mode = input.amount < 0 || refundOf ? 'expense' : 'income';
    if (splits.length === 1 && splits[0]!.categoryId) {
      categoryId = splits[0]!.categoryId;
      potId = splits[0]!.potId ?? '';
    } else if (splits.length > 0) {
      splitMode = true;
      rows = splits.map((s) => ({
        key: rowKey++,
        target: s.categoryId ? `c:${s.categoryId}` : `a:${s.counterAccountId}`,
        amount: Math.abs(s.amount),
        potId: s.potId ?? '',
      }));
    }
  }
  init();

  const sign = $derived(mode === 'income' || refundOf ? 1 : -1);
  const original = $derived(
    refundOf ? session.data!.transactions.find((x) => x.id === refundOf) : undefined,
  );
  const refunds = $derived(existing ? refundsOf(session.data!, existing.id) : []);
  const canRefund = $derived(!!existing && existing.amount < 0 && mode === 'expense' && !refundOf);

  // ---------- Belege ----------
  const attachments = $derived(attachmentsOf(session.data!, txId));
  let thumbs = $state<Record<string, string>>({});
  let photoBusy = $state(false);
  let photoError = $state<string | null>(null);

  $effect(() => {
    const ids = attachments.map((a) => a.id);
    let cancelled = false;
    for (const id of ids) {
      if (untrack(() => thumbs[id])) continue;
      void session.attachmentUrl(id).then((url) => {
        if (!url) return;
        if (cancelled) return URL.revokeObjectURL(url);
        thumbs[id] = url;
      });
    }
    return () => {
      cancelled = true;
    };
  });

  $effect(() => () => {
    for (const url of Object.values(untrack(() => thumbs))) URL.revokeObjectURL(url);
  });

  async function onPhoto(e: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(e.currentTarget.files ?? [])];
    e.currentTarget.value = '';
    photoBusy = true;
    photoError = null;
    try {
      for (const f of files) await session.addPhoto(txId, f);
    } catch (err) {
      photoError = t('att.error', { msg: err instanceof Error ? err.message : String(err) });
    } finally {
      photoBusy = false;
    }
  }

  async function removePhoto(id: string) {
    if (!confirm(t('att.remove') + '?')) return;
    if (thumbs[id]) URL.revokeObjectURL(thumbs[id]);
    delete thumbs[id];
    await session.removePhoto(id);
  }
  const categoryKind = $derived(mode === 'income' && !refundOf ? 'income' : 'expense');
  const tree = $derived(categoryTree(session.data!, categoryKind));

  /** Häufig genutzte Kategorien als Schnellauswahl. */
  const frequent = $derived.by(() => {
    const data = session.data!;
    const counts = new Map<Id, number>();
    for (const s of data.splits.slice(-400)) {
      if (s.categoryId) counts.set(s.categoryId, (counts.get(s.categoryId) ?? 0) + 1);
    }
    const ofKind = data.categories.filter((c) => c.kind === categoryKind && !c.archived);
    const leaves = ofKind.filter((c) => !ofKind.some((x) => x.parentId === c.id));
    return leaves.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)).slice(0, 8);
  });

  const payees = $derived(
    [...new Set(session.data!.transactions.map((x) => x.payee).filter(Boolean))].slice(-200),
  );

  const fromAcc = $derived(accounts.find((a) => a.id === accountId));
  const toAcc = $derived(accounts.find((a) => a.id === toAccountId));
  const crossesBudget = $derived(
    mode === 'transfer' && !!fromAcc && !!toAcc && fromAcc.budgetRelevant !== toAcc.budgetRelevant,
  );

  const rowsTotal = $derived(rows.reduce((a, r) => a + (r.amount ?? 0), 0));
  const remaining = $derived((amount ?? 0) - rowsTotal);

  function setMode(m: Mode) {
    if (m === mode) return;
    mode = m;
    categoryId = '';
    if (m === 'transfer') splitMode = false;
    rows = rows.map((r) => (r.target.startsWith('c:') ? { ...r, target: '' } : r));
  }

  function startSplit() {
    splitMode = true;
    rows = [
      { key: rowKey++, target: categoryId ? `c:${categoryId}` : '', amount: amount, potId },
      { key: rowKey++, target: '', amount: null, potId: '' },
    ];
  }

  function addRow() {
    rows.push({ key: rowKey++, target: '', amount: remaining > 0 ? remaining : null, potId: '' });
  }

  function removeRow(key: number) {
    rows = rows.filter((r) => r.key !== key);
    if (rows.length === 0) splitMode = false;
  }

  function toggleTag(tid: Id) {
    tagIds = tagIds.includes(tid) ? tagIds.filter((x) => x !== tid) : [...tagIds, tid];
  }

  function addTag() {
    if (!newTag.trim()) return;
    const tag = session.mutate((data) => saveTag(data, newTag));
    if (!tagIds.includes(tag.id)) tagIds = [...tagIds, tag.id];
    newTag = '';
  }

  function buildInput(): TransactionInput {
    const abs = amount ?? 0;
    let splits: SplitInput[] = [];
    let acc = accountId;
    let total = sign * abs;
    if (mode === 'transfer') {
      total = -abs;
      splits = [
        {
          counterAccountId: toAccountId,
          amount: -abs,
          ...(crossesBudget && potId ? { potId } : {}),
        },
      ];
      acc = accountId;
    } else if (splitMode) {
      splits = rows.map((r) => {
        const [kind, tid] = [r.target.slice(0, 1), r.target.slice(2)];
        return {
          amount: sign * (r.amount ?? 0),
          ...(kind === 'c' ? { categoryId: tid } : kind === 'a' ? { counterAccountId: tid } : {}),
          ...(r.potId ? { potId: r.potId } : {}),
        };
      });
    } else if (categoryId) {
      splits = [{ categoryId, amount: total, ...(potId ? { potId } : {}) }];
    }
    return {
      id: txId,
      attachmentIds: attachments.map((a) => a.id),
      accountId: acc,
      date,
      amount: total,
      payee,
      note,
      tagIds,
      ...(refundOf ? { refundOfId: refundOf } : {}),
      ...(existing?.recurringId ? { recurringId: existing.recurringId } : {}),
      splits,
    };
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const input = buildInput();
    const errs: string[] = validateTransaction(session.data!, input).map((x) =>
      t(`tx.err.${x}` as MessageKey),
    );
    if (mode === 'transfer' && !toAccountId) errs.push(t('tx.err.split-target-missing'));
    if (errs.length) {
      errors = [...new Set(errs)];
      return;
    }
    session.mutate((data) => saveTransaction(data, input));
    lastUsed.accountId = mode === 'income' || mode === 'expense' ? accountId : lastUsed.accountId;
    session.showToast(t('tx.saved'));
    router.back('/tx');
  }

  function remove() {
    if (!existing || !confirm(t('common.confirmDelete'))) return;
    session.mutate((data) => deleteTransaction(data, existing.id));
    void session.cleanupAttachments();
    router.go('/tx', { replace: true });
  }
</script>

<div class="head row between">
  <h1>{refundOf ? t('refund.title') : existing ? t('tx.edit') : t('tx.new')}</h1>
  <button type="button" class="btn ghost" onclick={() => router.back('/tx')}>
    {t('common.cancel')}
  </button>
</div>

{#if accounts.length === 0}
  <div class="notice warn">
    {t('tx.needAccount')} <a href="#/accounts">{t('account.new')}</a>
  </div>
{:else}
  <form class="card" onsubmit={submit} novalidate>
    {#if wasMirror}<p class="notice small">{t('tx.mirrorOf')}</p>{/if}

    {#if refundOf}
      <p class="notice ok">
        ↩ {original
          ? t('refund.of', {
              payee: original.payee || '—',
              date: formatDate(original.date),
              amount: formatMoney(original.amount),
            })
          : t('refund.title')}
        {#if original}<a href={`#/tx/${original.id}`}>→</a>{/if}
      </p>
    {:else}
      <div class="segmented" role="group" aria-label={t('tx.kind')}>
        {#each ['expense', 'income', 'transfer'] as const as m (m)}
          <button type="button" aria-pressed={mode === m} onclick={() => setMode(m)}>
            {t(`tx.${m}`)}
          </button>
        {/each}
      </div>
    {/if}

    <div class="field">
      <MoneyInput
        id="tx-amount"
        label={`${t('common.amount')} (${d.settings.currency})`}
        bind:value={amount}
        unsigned
        large
        autofocus={!existing}
      />
    </div>

    {#if mode === 'transfer'}
      <div class="grid-2">
        <div class="field">
          <label for="tx-from">{t('tx.fromAccount')}</label>
          <select id="tx-from" bind:value={accountId}>
            <option value="" disabled>–</option>
            {#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="tx-to">{t('tx.toAccount')}</label>
          <select id="tx-to" bind:value={toAccountId}>
            <option value="" disabled>–</option>
            {#each accounts.filter((a) => a.id !== accountId) as a (a.id)}
              <option value={a.id}>{a.name}</option>
            {/each}
          </select>
        </div>
      </div>
      {#if crossesBudget}
        <div class="field">
          <label for="tx-pot">{t('tx.pot')}</label>
          <select id="tx-pot" bind:value={potId}>
            <option value="">{t('tx.potDefault')} ({t('pot.buffer')})</option>
            {#each pots as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          </select>
        </div>
      {/if}
    {:else}
      <fieldset class="field plain">
        <legend class="lbl">{t('tx.account')}</legend>
        <div class="chips">
          {#each accounts as a (a.id)}
            <button
              type="button"
              class="chip"
              aria-pressed={accountId === a.id}
              onclick={() => (accountId = a.id)}
            >
              {a.name}
            </button>
          {/each}
        </div>
      </fieldset>

      {#if !splitMode}
        <fieldset class="field plain">
          <legend class="lbl">{t('tx.category')}</legend>
          <div class="chips">
            {#each frequent as c (c.id)}
              <button
                type="button"
                class="chip"
                aria-pressed={categoryId === c.id}
                onclick={() => (categoryId = categoryId === c.id ? '' : c.id)}
              >
                {c.name}
              </button>
            {/each}
          </div>
          <label for="tx-cat" class="visually-hidden">{t('tx.category')}</label>
          <select id="tx-cat" class="cat-select" bind:value={categoryId}>
            <option value="">– {t('category.uncategorized')} –</option>
            {#each tree as g (g.parent.id)}
              <optgroup label={g.parent.name}>
                <option value={g.parent.id}>{g.parent.name}</option>
                {#each g.children as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
              </optgroup>
            {/each}
          </select>
        </fieldset>
        {#if mode === 'expense' && pots.length > 2}
          <div class="field">
            <label for="tx-pot2">{t('tx.pot')}</label>
            <select id="tx-pot2" bind:value={potId}>
              <option value="">{t('tx.potDefault')} ({t('pot.monthly')})</option>
              {#each pots.filter((p) => p.kind !== 'monthly') as p (p.id)}
                <option value={p.id}>{p.name}</option>
              {/each}
            </select>
          </div>
        {/if}
        <button type="button" class="btn small" onclick={startSplit}>{t('tx.split')}</button>
      {:else}
        <fieldset class="field plain">
          <legend class="lbl">{t('tx.split')}</legend>
          {#each rows as r, i (r.key)}
            <div class="split-row">
              <div class="grow">
                <label for={`split-t-${r.key}`} class="visually-hidden">
                  {t('tx.splitTarget')}
                  {i + 1}
                </label>
                <select id={`split-t-${r.key}`} bind:value={r.target}>
                  <option value="" disabled>{t('tx.splitTarget')}</option>
                  {#each tree as g (g.parent.id)}
                    <optgroup label={g.parent.name}>
                      <option value={`c:${g.parent.id}`}>{g.parent.name}</option>
                      {#each g.children as c (c.id)}
                        <option value={`c:${c.id}`}>{c.name}</option>
                      {/each}
                    </optgroup>
                  {/each}
                  <optgroup label={t('nav.accounts')}>
                    {#each accounts.filter((a) => a.id !== accountId) as a (a.id)}
                      <option value={`a:${a.id}`}>→ {a.name}</option>
                    {/each}
                  </optgroup>
                </select>
              </div>
              <div class="amt">
                <MoneyInput
                  id={`split-a-${r.key}`}
                  label={`${t('common.amount')} ${i + 1}`}
                  bind:value={r.amount}
                  unsigned
                />
              </div>
              <button
                type="button"
                class="btn ghost small"
                aria-label={`${t('common.delete')} ${i + 1}`}
                onclick={() => removeRow(r.key)}
              >
                ✕
              </button>
            </div>
          {/each}
          <div class="row between">
            <button type="button" class="btn small" onclick={addRow}>{t('tx.splitAdd')}</button>
            <span class="small" class:neg={remaining !== 0} aria-live="polite">
              {t('tx.splitRemaining', { amount: formatMoney(remaining) })}
            </span>
          </div>
        </fieldset>
      {/if}
    {/if}

    <div class="grid-2 more">
      <div class="field">
        <label for="tx-date">{t('common.date')}</label>
        <input id="tx-date" type="date" bind:value={date} required />
      </div>
      <div class="field">
        <label for="tx-payee">{t('tx.payee')}</label>
        <input id="tx-payee" type="text" list="payees" autocomplete="off" bind:value={payee} />
        <datalist id="payees">
          {#each payees as p (p)}<option value={p}></option>{/each}
        </datalist>
      </div>
    </div>
    <div class="field">
      <label for="tx-note">{t('common.note')}</label>
      <input id="tx-note" type="text" bind:value={note} />
    </div>

    <fieldset class="field plain">
      <legend class="lbl">{t('tx.tags')}</legend>
      <div class="chips">
        {#each session.data!.tags as tag (tag.id)}
          <button
            type="button"
            class="chip"
            aria-pressed={tagIds.includes(tag.id)}
            onclick={() => toggleTag(tag.id)}
          >
            #{tag.name}
          </button>
        {/each}
        <span class="row">
          <label for="tx-newtag" class="visually-hidden">{t('tag.new')}</label>
          <input
            id="tx-newtag"
            class="tag-input"
            type="text"
            placeholder={t('tag.new')}
            bind:value={newTag}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
          />
          <button type="button" class="btn small" onclick={addTag} disabled={!newTag.trim()}>
            ＋
          </button>
        </span>
      </div>
    </fieldset>

    {#if isDateInClosedMonth(session.data!, date) || (existing && isDateInClosedMonth(session.data!, existing.date))}
      <p class="notice warn" role="note">
        ⚠ {t('close.closedWarn', {
          month: formatMonth(budgetMonthOf(date, session.data!.settings.monthStartDay)),
        })}
      </p>
    {/if}

    <fieldset class="field plain">
      <legend class="lbl">{t('att.title')}</legend>
      {#if attachments.length}
        <ul class="thumbs">
          {#each attachments as a (a.id)}
            <li>
              {#if thumbs[a.id]}
                <a href={thumbs[a.id]} target="_blank" rel="noopener" aria-label={t('att.open')}>
                  <img src={thumbs[a.id]} alt={t('att.title')} />
                </a>
              {:else}
                <span class="ph" aria-busy="true">…</span>
              {/if}
              <button
                type="button"
                class="btn ghost small"
                aria-label={t('att.remove')}
                onclick={() => removePhoto(a.id)}
              >
                ✕
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <label class="btn small photo">
        📷 {t('att.add')}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          class="visually-hidden"
          onchange={onPhoto}
        />
      </label>
      {#if photoBusy}<p class="hint" role="status">{t('att.processing')}</p>{/if}
      {#if photoError}<p class="error" role="alert">{photoError}</p>{/if}
      <p class="hint">{t('att.hint')}</p>
    </fieldset>

    {#if errors.length}
      <ul class="error" role="alert">
        {#each errors as e (e)}<li>{e}</li>{/each}
      </ul>
    {/if}

    <div class="row between actions">
      {#if existing}
        <button type="button" class="btn danger" onclick={remove}>{t('common.delete')}</button>
      {:else}
        <span></span>
      {/if}
      <button type="submit" class="btn primary">{t('common.save')}</button>
    </div>
    {#if existing && categoryId}
      <p class="hint">{categoryLabel(session.data!, categoryId)}</p>
    {/if}
  </form>

  {#if canRefund || refunds.length}
    <section class="card" aria-labelledby="ref-h">
      <h2 id="ref-h">{t('refund.list')}</h2>
      {#if refunds.length}
        <ul class="list">
          {#each refunds as r (r.id)}
            <li>
              <a class="list-item" href={`#/tx/${r.id}`}>
                <span class="grow">{formatDate(r.date)}</span>
                <Amount value={r.amount} />
              </a>
            </li>
          {/each}
        </ul>
      {/if}
      {#if canRefund && existing}
        <p class="small muted">
          {t('refund.refundable', { amount: formatMoney(refundable(session.data!, existing.id)) })}
        </p>
        <a class="btn" href={`#/tx/new?refund=${existing.id}`}>↩ {t('refund.create')}</a>
      {/if}
    </section>
  {/if}
{/if}

<style>
  .head h1 {
    margin: 0;
  }
  .head {
    margin-bottom: 12px;
  }
  fieldset.plain {
    border: none;
    padding: 0;
    margin: 0 0 14px;
    min-width: 0;
  }
  .lbl {
    font-size: 0.875rem;
    color: var(--muted);
    margin-bottom: 6px;
    padding: 0;
  }
  .cat-select {
    margin-top: 8px;
  }
  .split-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    margin-bottom: 8px;
  }
  .split-row .amt {
    width: 130px;
  }
  .split-row :global(label:not(.visually-hidden)) {
    position: absolute !important;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .more {
    margin-top: 12px;
  }
  .tag-input {
    width: 140px !important;
    min-height: 40px !important;
  }
  .actions {
    margin-top: 8px;
  }
  .thumbs {
    list-style: none;
    padding: 0;
    margin: 0 0 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .thumbs li {
    position: relative;
  }
  .thumbs img,
  .ph {
    display: grid;
    place-items: center;
    width: 88px;
    height: 88px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .thumbs button {
    position: absolute;
    top: 2px;
    right: 2px;
    background: var(--surface);
    min-height: 28px;
    padding: 0 8px;
  }
  .photo {
    cursor: pointer;
  }
</style>
