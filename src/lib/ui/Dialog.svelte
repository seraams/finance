<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/index.svelte';

  interface Props {
    open: boolean;
    title: string;
    children: Snippet;
    onclose?: () => void;
  }
  let { open = $bindable(), title, children, onclose }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state();
  const titleId = `dlg-${Math.random().toString(36).slice(2)}`;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  function handleClose() {
    open = false;
    onclose?.();
  }
</script>

<dialog bind:this={dialog} aria-labelledby={titleId} onclose={handleClose}>
  {#if open}
    <div class="head">
      <h2 id={titleId}>{title}</h2>
      <button type="button" class="btn ghost small" onclick={() => (open = false)}>
        {t('common.close')}
      </button>
    </div>
    <div class="body">
      {@render children()}
    </div>
  {/if}
</dialog>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--surface);
  }
  .head h2 {
    margin: 0;
  }
  .body {
    padding: 16px;
  }
</style>
