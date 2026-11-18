<script lang="ts">
  import { categoryLabel, categoryTree } from '../lib/domain/entities';
  import { filterTransactions, type TxKind } from '../lib/domain/transactions';
  import type { Transaction } from '../lib/domain/types';
  import { formatDate, t } from '../lib/i18n/index.svelte';
  import { router } from '../lib/router.svelte';
  import { session } from '../lib/state/session.svelte';
  import Amount from '../lib/ui/Amount.svelte';

  const q = router.route.query;
  let text = $state(q.get('q') ?? '');
  let accountId = $state(q.get('account') ?? '');
  let categoryId = $state(q.get('category') ?? '');
  let tagId = $state('');
  let kind = $state<'' | TxKind>('');
  let from = $state(q.get('from') ?? '');
  let to = $state(q.get('to') ?? '');
  let showFilters = $state(['account', 'category', 'from', 'to'].some((k) => q.has(k)));
  let limit = $state(100);

  const data = $derived(session.data!);
  const accounts = $derived(new Map(data.accounts.map((a) => [a.id, a])));
  const splitsByTx = $derived.by(() => {
    const m = new Map<string, typeof data.splits>();
    for (const s of data.splits) {
      const l = m.get(s.transactionId);
      if (l) l.push(s);
      else m.set(s.transactionId, [s]);
    }
    return m;
  });

  const results = $derived(
    filterTransactions(data, {
      ...(text ? { text } : {}),
      ...(accountId ? { accountId } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(tagId ? { tagId } : {}),
      ...(kind ? { kind } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
  );

  const grouped = $derived.by(() => {
    const groups: { date: string; items: Transaction[] }[] = [];
    for (const tx of results.slice(0, limit)) {
      const last = groups[groups.length - 1];
      if (last && last.date === tx.date) last.items.push(tx);
      else groups.push({ date: tx.date, items: [tx] });
    }
    return groups;
  });

  function describe(tx: Transaction): string {
    const splits = splitsByTx.get(tx.id) ?? [];
    if (splits.length === 0) return t('category.uncategorized');
    if (splits.length > 1) return `${t('tx.split')} (${splits.length})`;
    const s = splits[0]!;
    if (s.counterAccountId) {
      const name = accounts.get(s.counterAccountId)?.name ?? '?';
      return tx.amount < 0 ? t('tx.toCounter', { name }) : t('tx.fromCounter', { name });
    }
    return categoryLabel(data, s.categoryId) || t('category.uncategorized');
  }

  function reset() {
    text = accountId = categoryId = tagId = from = to = '';
    kind = '';
  }
</script>

<div class="row between head">
  <h1>{t('tx.title')}</h1>
  <a class="btn primary" href="#/tx/new">＋ {t('tx.new')}</a>
</div>

<div class="card">
  <div class="row">
    <div class="grow">
      <label for="tx-search" class="visually-hidden">{t('common.search')}</label>
      <input id="tx-search" type="search" placeholder={t('common.search')} bind:value={text} />
    </div>
    <button
      type="button"
      class="btn"
      aria-expanded={showFilters}
      aria-controls="tx-filters"
      onclick={() => (showFilters = !showFilters)}
    >
      {t('tx.filters')}
    </button>
  </div>
  {#if showFilters}
    <div id="tx-filters" class="filters">
      <div class="field">
        <label for="f-acc">{t('tx.account')}</label>
        <select id="f-acc" bind:value={accountId}>
          <option value="">{t('common.all')}</option>
          {#each data.accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="f-cat">{t('tx.category')}</label>
        <select id="f-cat" bind:value={categoryId}>
          <option value="">{t('common.all')}</option>
          {#each categoryTree(data, undefined, true) as g (g.parent.id)}
            <optgroup label={g.parent.name}>
              <option value={g.parent.id}>{g.parent.name}</option>
              {#each g.children as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
            </optgroup>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="f-kind">{t('tx.kind')}</label>
        <select id="f-kind" bind:value={kind}>
          <option value="">{t('common.all')}</option>
          <option value="expense">{t('tx.expense')}</option>
          <option value="income">{t('tx.income')}</option>
          <option value="transfer">{t('tx.transfer')}</option>
          <option value="mixed">{t('tx.kind.mixed')}</option>
          <option value="uncategorized">{t('tx.kind.uncategorized')}</option>
        </select>
      </div>
      {#if data.tags.length}
        <div class="field">
          <label for="f-tag">{t('tx.tags')}</label>
          <select id="f-tag" bind:value={tagId}>
            <option value="">{t('common.all')}</option>
            {#each data.tags as tag (tag.id)}<option value={tag.id}>#{tag.name}</option>{/each}
          </select>
        </div>
      {/if}
      <div class="field">
        <label for="f-from">{t('tx.from')}</label>
        <input id="f-from" type="date" bind:value={from} />
      </div>
      <div class="field">
        <label for="f-to">{t('tx.to')}</label>
        <input id="f-to" type="date" bind:value={to} />
      </div>
      <button type="button" class="btn small" onclick={reset}>✕ {t('common.all')}</button>
    </div>
  {/if}
</div>

<p class="small muted" aria-live="polite">{t('tx.count', { n: results.length })}</p>

{#if results.length === 0}
  <div class="card"><p class="muted">{t('tx.empty')}</p></div>
{:else}
  {#each grouped as g (g.date)}
    <h2 class="day">{formatDate(g.date, true)}</h2>
    <div class="card tight">
      <ul class="list">
        {#each g.items as tx (tx.id)}
          <li>
            <a class="list-item" href={`#/tx/${tx.id}`} data-testid="tx-item">
              <span class="grow">
                <span class="payee">
                  {#if tx.refundOfId}<span class="badge">
                      ↩ {t('refund.badge')}
                    </span>{/if}{tx.payee || describe(tx)}{#if tx.attachmentIds.length}<span
                      class="clip"
                      aria-label={t('att.title')}
                    >
                      📎
                    </span>{/if}
                </span>
                <span class="small muted sub">
                  {tx.payee ? describe(tx) + ' · ' : ''}{accounts.get(tx.accountId)?.name ??
                    ''}{#if tx.tagIds.length}
                    · {tx.tagIds
                      .map((id) => '#' + (data.tags.find((x) => x.id === id)?.name ?? ''))
                      .join(' ')}{/if}
                </span>
              </span>
              <Amount value={tx.amount} />
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
  {#if results.length > limit}
    <button type="button" class="btn block" onclick={() => (limit += 200)}>…</button>
  {/if}
{/if}

<style>
  .head {
    margin-bottom: 12px;
  }
  .head h1 {
    margin: 0;
  }
  .filters {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0 12px;
    margin-top: 12px;
    align-items: end;
  }
  .day {
    font-size: 0.85rem;
    color: var(--muted);
    font-weight: 600;
    margin: 16px 4px 6px;
  }
  .tight {
    padding: 0 12px;
  }
  .payee {
    display: block;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-size: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0 6px;
    margin-right: 6px;
    color: var(--muted);
    font-weight: 400;
  }
  .sub {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
