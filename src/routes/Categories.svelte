<script lang="ts">
  import {
    categoryInUse,
    categoryTree,
    deleteCategory,
    deleteTag,
    saveCategory,
    saveTag,
  } from '../lib/domain/entities';
  import type { Category, CategoryKind, Tag } from '../lib/domain/types';
  import { t } from '../lib/i18n/index.svelte';
  import { session } from '../lib/state/session.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';

  const data = $derived(session.data!);
  let kindTab = $state<CategoryKind>('expense');
  const tree = $derived(categoryTree(data, kindTab, true));

  let open = $state(false);
  let editing = $state<Category | null>(null);
  let name = $state('');
  let parentId = $state('');
  let rollover = $state(false);
  let archived = $state(false);
  let error = $state<string | null>(null);

  function openNew(parent?: Category) {
    editing = null;
    name = '';
    parentId = parent?.id ?? '';
    rollover = false;
    archived = false;
    error = null;
    open = true;
  }

  function openEdit(c: Category) {
    editing = c;
    name = c.name;
    parentId = c.parentId ?? '';
    rollover = c.rolloverRest;
    archived = !!c.archived;
    error = null;
    open = true;
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    try {
      session.mutate((d) =>
        saveCategory(d, {
          ...(editing ? { id: editing.id } : {}),
          name,
          kind: kindTab,
          ...(parentId ? { parentId } : {}),
          rolloverRest: rollover,
          archived,
        }),
      );
      open = false;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function remove() {
    if (!editing) return;
    const id = editing.id;
    if (data.categories.some((c) => c.parentId === id)) {
      error = t('category.hasChildren');
      return;
    }
    const msg = categoryInUse(data, id) ? t('category.inUse') : t('common.confirmDelete');
    if (!confirm(msg)) return;
    session.mutate((d) => deleteCategory(d, id));
    open = false;
  }

  // ---------- Tags ----------
  let newTag = $state('');
  function addTag(e: SubmitEvent) {
    e.preventDefault();
    if (!newTag.trim()) return;
    session.mutate((d) => saveTag(d, newTag));
    newTag = '';
  }
  function renameTag(tag: Tag) {
    const n = prompt(t('common.name'), tag.name);
    if (n && n.trim()) session.mutate((d) => saveTag(d, n, tag.id));
  }
  function removeTag(tag: Tag) {
    if (confirm(t('common.confirmDelete'))) session.mutate((d) => deleteTag(d, tag.id));
  }
</script>

<div class="row between head">
  <h1>{t('category.title')}</h1>
  <button type="button" class="btn primary" onclick={() => openNew()}>
    ＋ {t('category.new')}
  </button>
</div>

<div class="segmented" role="group" aria-label={t('category.kind')}>
  <button type="button" aria-pressed={kindTab === 'expense'} onclick={() => (kindTab = 'expense')}>
    {t('category.expense')}
  </button>
  <button type="button" aria-pressed={kindTab === 'income'} onclick={() => (kindTab = 'income')}>
    {t('category.income')}
  </button>
</div>

<div class="card tight">
  <ul class="list">
    {#each tree as g (g.parent.id)}
      <li>
        <div class="cat-row">
          <button type="button" class="list-item parent" onclick={() => openEdit(g.parent)}>
            <span class="grow" class:muted={g.parent.archived}>{g.parent.name}</span>
            {#if g.parent.rolloverRest}<span class="small muted">↻</span>{/if}
          </button>
          <button
            type="button"
            class="btn ghost small"
            aria-label={`${t('category.newSub')}: ${g.parent.name}`}
            onclick={() => openNew(g.parent)}
          >
            ＋
          </button>
        </div>
        {#if g.children.length}
          <ul class="list sub">
            {#each g.children as c (c.id)}
              <li>
                <button type="button" class="list-item" onclick={() => openEdit(c)}>
                  <span class="grow" class:muted={c.archived}>{c.name}</span>
                  {#if c.rolloverRest}<span class="small muted">↻</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<h2>{t('tag.title')}</h2>
<div class="card">
  <form class="row" onsubmit={addTag}>
    <div class="grow">
      <label for="new-tag" class="visually-hidden">{t('tag.new')}</label>
      <input id="new-tag" type="text" placeholder={t('tag.new')} bind:value={newTag} />
    </div>
    <button type="submit" class="btn" disabled={!newTag.trim()}>{t('common.add')}</button>
  </form>
  {#if data.tags.length === 0}
    <p class="muted small tagempty">{t('tag.empty')}</p>
  {:else}
    <ul class="list">
      {#each data.tags as tag (tag.id)}
        <li class="row">
          <span class="grow">#{tag.name}</span>
          <button type="button" class="btn ghost small" onclick={() => renameTag(tag)}>
            {t('common.edit')}
          </button>
          <button type="button" class="btn ghost small danger" onclick={() => removeTag(tag)}>
            {t('common.delete')}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<Dialog bind:open title={editing ? editing.name : t('category.new')}>
  <form onsubmit={submit}>
    <div class="field">
      <label for="cat-name">{t('common.name')}</label>
      <input id="cat-name" type="text" bind:value={name} required />
    </div>
    <div class="field">
      <label for="cat-parent">{t('category.parent')}</label>
      <select id="cat-parent" bind:value={parentId}>
        <option value="">{t('category.noParent')}</option>
        {#each data.categories.filter((c) => !c.parentId && c.kind === kindTab && c.id !== editing?.id) as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
    </div>
    {#if kindTab === 'expense'}
      <div class="field">
        <label class="check">
          <input type="checkbox" bind:checked={rollover} /><span>{t('category.rollover')}</span>
        </label>
        <p class="hint">{t('category.rolloverHint')}</p>
      </div>
    {/if}
    {#if editing}
      <div class="field">
        <label class="check">
          <input type="checkbox" bind:checked={archived} /><span>{t('common.archived')}</span>
        </label>
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
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
  .tight {
    padding: 0 12px;
  }
  .cat-row {
    display: flex;
    align-items: center;
  }
  .parent {
    font-weight: 600;
  }
  .sub {
    padding-left: 20px;
    border-top: 1px solid var(--border);
  }
  .sub .list-item {
    min-height: 44px;
  }
  .tagempty {
    margin-top: 12px;
  }
  .list > li.row {
    padding: 6px 0;
  }
</style>
