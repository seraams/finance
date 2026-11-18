<script lang="ts">
  import { moneyToInput, parseMoney } from '../domain/money';

  interface Props {
    value: number | null;
    id: string;
    label: string;
    /** Nur positive Beträge (Vorzeichen bestimmt die Buchungsart). */
    unsigned?: boolean;
    large?: boolean;
    required?: boolean;
    autofocus?: boolean;
    placeholder?: string;
    onchange?: (v: number | null) => void;
  }

  let {
    value = $bindable(),
    id,
    label,
    unsigned = false,
    large = false,
    required = false,
    autofocus = false,
    placeholder = '0.00',
    onchange,
  }: Props = $props();

  let text = $state(value === null || value === undefined ? '' : moneyToInput(value));
  let invalid = $state(false);
  let el: HTMLInputElement | undefined = $state();

  // Externe Änderungen übernehmen, solange das Feld nicht fokussiert ist.
  $effect(() => {
    const v = value;
    if (el && document.activeElement === el) return;
    const parsed = parseMoney(text);
    if (parsed !== v) text = v === null || v === undefined ? '' : moneyToInput(v);
  });

  $effect(() => {
    if (autofocus) el?.focus();
  });

  function oninput() {
    const parsed = parseMoney(text);
    invalid = text.trim() !== '' && parsed === null;
    const v = parsed === null ? null : unsigned ? Math.abs(parsed) : parsed;
    value = v;
    onchange?.(v);
  }
</script>

<label for={id}>{label}</label>
<input
  bind:this={el}
  {id}
  type="text"
  inputmode="decimal"
  autocomplete="off"
  enterkeyhint="done"
  class:large
  {placeholder}
  {required}
  aria-invalid={invalid}
  bind:value={text}
  {oninput}
/>

<style>
  .large {
    font-size: 2rem;
    font-weight: 600;
    text-align: right;
    min-height: 64px;
    font-variant-numeric: tabular-nums;
  }
</style>
