<script lang="ts">
  import { formatMoney } from '../domain/money';

  interface Props {
    value: number;
    signed?: boolean;
    color?: boolean;
    currency?: string;
    whole?: boolean;
  }
  let { value, signed = false, color = true, currency, whole = false }: Props = $props();
</script>

<span class="amount" class:pos={color && value > 0} class:neg={color && value < 0}>
  {formatMoney(value, { signed, ...(currency ? { currency } : {}), whole })}
</span>
