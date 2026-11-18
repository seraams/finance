<script lang="ts">
  import { categoryLabel, categoryTree } from '../lib/domain/entities';
  import {
    applyRulesToUncategorized,
    deleteRule,
    saveRule,
    sortedRules,
    suggestRules,
    type RuleSuggestion,
  } from '../lib/domain/rules';
  import type { Rule } from '../lib/domain/types';
  import { t } from '../lib/i18n/index.svelte';
  import { session } from '../lib/state/session.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';

  const data = $derived(session.data!);
  const rules = $derived(sortedRules(data.rules));
  const suggestions = $derived(suggestRules(data));
  const tree = $derived(categoryTree(data));

  let open = $state(false);
  let editing = $state<Rule | null>(null);
  let pattern = $state('');
  let field = $state<Rule['field']>('payee');
  let categoryId = $state('');
  let priority = $state(0);

  function openNew(s?: RuleSuggestion) {
    editing = null;
    pattern = s?.pattern ?? '';
    field = 'payee';
    categoryId = s?.categoryId ?? '';
    priority = 0;
    open = true;
  }

  function openEdit(r: Rule) {
    editing = r;
    pattern = r.pattern;
    field = r.field;
    categoryId = r.categoryId;
    priority = r.priority;
    open = true;
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!pattern.trim() || !categoryId) return;
    session.mutate((d) =>
      saveRule(d, { ...(editing ? { id: editing.id } : {}), pattern, field, categoryId, priority }),
    );
    open = false;
  }

  function remove() {
    if (!editing || !confirm(t('common.confirmDelete'))) return;
    const id = editing.id;
    session.mutate((d) => deleteRule(d, id));
    open = false;
  }

  function accept(s: RuleSuggestion) {
    session.mutate((d) => saveRule(d, { pattern: s.pattern, categoryId: s.categoryId }));
  }

  function applyAll() {
    const n = session.mutate((d) => applyRulesToUncategorized(d));
    session.showToast(t('rules.applied', { n }));
  }
</script>

<div class="row between head">
  <h1>{t('rules.title')}</h1>
  <button type="button" class="btn primary" onclick={() => openNew()}>＋ {t('rules.new')}</button>
</div>
<p class="muted">{t('rules.intro')}</p>

{#if suggestions.length}
  <section class="card" aria-labelledby="sug-h">
    <h2 id="sug-h">{t('rules.suggestions')}</h2>
    <ul class="list">
      {#each suggestions as s (s.pattern)}
        <li class="row between item">
          <span class="grow">
            {t('rules.suggestion', {
              pattern: s.pattern,
              category: categoryLabel(data, s.categoryId),
              n: s.count,
            })}
          </span>
          <button type="button" class="btn small" onclick={() => accept(s)}>
            {t('rules.accept')}
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="card">
  {#if rules.length === 0}
    <p class="muted">{t('rules.empty')}</p>
  {:else}
    <ul class="list">
      {#each rules as r (r.id)}
        <li>
          <button type="button" class="list-item" onclick={() => openEdit(r)}>
            <span class="grow">
              <strong>«{r.pattern}»</strong>
              <span class="small muted">
                · {t(`rules.field.${r.field}`)}{r.priority ? ` · ${r.priority}` : ''}
              </span>
            </span>
            <span class="small">→ {categoryLabel(data, r.categoryId)}</span>
          </button>
        </li>
      {/each}
    </ul>
    <button type="button" class="btn apply" onclick={applyAll}>{t('rules.apply')}</button>
  {/if}
</section>

<Dialog bind:open title={editing ? t('common.edit') : t('rules.new')}>
  <form onsubmit={submit}>
    <div class="field">
      <label for="r-pattern">{t('rules.pattern')}</label>
      <input id="r-pattern" type="text" bind:value={pattern} required />
    </div>
    <div class="grid-2">
      <div class="field">
        <label for="r-field">{t('rules.field')}</label>
        <select id="r-field" bind:value={field}>
          <option value="payee">{t('rules.field.payee')}</option>
          <option value="note">{t('rules.field.note')}</option>
          <option value="any">{t('rules.field.any')}</option>
        </select>
      </div>
      <div class="field">
        <label for="r-prio">{t('rules.priority')}</label>
        <input id="r-prio" type="number" step="1" bind:value={priority} />
      </div>
    </div>
    <div class="field">
      <label for="r-cat">{t('tx.category')}</label>
      <select id="r-cat" bind:value={categoryId} required>
        <option value="" disabled>–</option>
        {#each tree as g (g.parent.id)}
          <optgroup label={g.parent.name}>
            <option value={g.parent.id}>{g.parent.name}</option>
            {#each g.children as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </optgroup>
        {/each}
      </select>
    </div>
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
    margin-bottom: 4px;
  }
  .head h1 {
    margin: 0;
  }
  .item {
    padding: 8px 0;
  }
  .apply {
    margin-top: 12px;
  }
</style>
