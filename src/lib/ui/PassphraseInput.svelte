<script lang="ts">
  interface Props {
    id: string;
    label: string;
    value: string;
    autocomplete?: 'current-password' | 'new-password';
    autofocus?: boolean;
    describedby?: string;
    invalid?: boolean;
  }
  let {
    id,
    label,
    value = $bindable(),
    autocomplete = 'current-password',
    autofocus = false,
    describedby,
    invalid = false,
  }: Props = $props();
  let show = $state(false);
  let el: HTMLInputElement | undefined = $state();
  $effect(() => {
    if (autofocus) el?.focus();
  });
</script>

<label for={id}>{label}</label>
<div class="pw">
  <input
    bind:this={el}
    {id}
    type={show ? 'text' : 'password'}
    {autocomplete}
    autocapitalize="off"
    spellcheck="false"
    aria-describedby={describedby}
    aria-invalid={invalid}
    bind:value
  />
  <button
    type="button"
    class="btn ghost small"
    aria-pressed={show}
    aria-label={show ? 'Passphrase verbergen / hide' : 'Passphrase anzeigen / show'}
    onclick={() => (show = !show)}
  >
    {show ? '🙈' : '👁'}
  </button>
</div>

<style>
  .pw {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .pw input {
    flex: 1;
  }
</style>
