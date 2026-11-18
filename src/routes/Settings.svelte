<script lang="ts">
  import { MIN_PASSPHRASE_LENGTH, WrongPassphraseError } from '../lib/crypto/crypto';
  import { suggestSalary } from '../lib/domain/buffer';
  import { budgetMonthOf, todayIso } from '../lib/domain/dates';
  import { formatMoney } from '../lib/domain/money';
  import { incomeHistory } from '../lib/domain/stats';
  import type { Theme } from '../lib/domain/types';
  import { i18n, t } from '../lib/i18n/index.svelte';
  import { session } from '../lib/state/session.svelte';
  import MoneyInput from '../lib/ui/MoneyInput.svelte';
  import PassphraseInput from '../lib/ui/PassphraseInput.svelte';

  const data = $derived(session.data!);
  const s = $derived(data.settings);
  const suggestion = $derived(
    suggestSalary(
      incomeHistory(data, budgetMonthOf(todayIso(), s.monthStartDay)),
      s.savingsRatePct,
    ),
  );

  let salary = $state<number | null>(session.data!.settings.salary);
  const isDev = import.meta.env.DEV;

  function setSalary(v: number | null) {
    if (v === null) return;
    session.mutate((d) => (d.settings.salary = Math.max(0, v)));
  }

  function setNumber(
    key: 'savingsRatePct' | 'bufferMonths' | 'autoLockMinutes' | 'monthStartDay',
    raw: string,
    min: number,
    max: number,
  ) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    session.mutate((d) => (d.settings[key] = Math.min(max, Math.max(min, n))));
  }

  // ---------- Passphrase ----------
  let cur = $state('');
  let next = $state('');
  let next2 = $state('');
  let pwMsg = $state<string | null>(null);
  let pwErr = $state<string | null>(null);
  let busy = $state(false);

  async function changePass(e: SubmitEvent) {
    e.preventDefault();
    pwMsg = pwErr = null;
    if (next.length < MIN_PASSPHRASE_LENGTH) return void (pwErr = t('setup.tooShort'));
    if (next !== next2) return void (pwErr = t('setup.mismatch'));
    busy = true;
    try {
      await session.changePassphrase(cur, next);
      cur = next = next2 = '';
      pwMsg = t('settings.passphraseChanged');
    } catch (err) {
      pwErr = err instanceof WrongPassphraseError ? t('unlock.wrong') : String(err);
    } finally {
      busy = false;
    }
  }

  async function seed() {
    if (!import.meta.env.DEV || !confirm(t('settings.seedConfirm'))) return;
    const { createSeedDataset } = await import('../lib/domain/seed');
    const d = createSeedDataset(i18n.lang);
    d.settings.lastBackupAt = new Date().toISOString();
    await session.replaceData(d);
  }
</script>

<h1>{t('settings.title')}</h1>

<section class="card" aria-labelledby="bm-h">
  <h2 id="bm-h">{t('settings.budgetModel')}</h2>
  <div class="field">
    <MoneyInput
      id="set-salary"
      label={t('settings.salary')}
      bind:value={salary}
      unsigned
      onchange={setSalary}
    />
    {#if suggestion > 0 && suggestion !== s.salary}
      <button
        type="button"
        class="btn small sugg"
        onclick={() => {
          salary = suggestion;
          setSalary(suggestion);
        }}
      >
        {t('settings.salarySuggest', { amount: formatMoney(suggestion) })}
      </button>
    {/if}
  </div>
  <div class="grid-2">
    <div class="field">
      <label for="set-q">{t('settings.savingsRate')}</label>
      <input
        id="set-q"
        type="number"
        min="0"
        max="90"
        step="1"
        value={s.savingsRatePct}
        onchange={(e) => setNumber('savingsRatePct', e.currentTarget.value, 0, 90)}
      />
    </div>
    <div class="field">
      <label for="set-n">{t('settings.bufferMonths')}</label>
      <input
        id="set-n"
        type="number"
        min="1"
        max="36"
        step="1"
        value={s.bufferMonths}
        onchange={(e) => setNumber('bufferMonths', e.currentTarget.value, 1, 36)}
      />
    </div>
    <div class="field">
      <label for="set-start">{t('settings.monthStart')}</label>
      <input
        id="set-start"
        type="number"
        min="1"
        max="28"
        step="1"
        value={s.monthStartDay}
        onchange={(e) => setNumber('monthStartDay', e.currentTarget.value, 1, 28)}
      />
    </div>
  </div>
</section>

<section class="card" aria-labelledby="ui-h">
  <h2 id="ui-h">{t('settings.theme')} & {t('settings.language')}</h2>
  <div class="grid-2">
    <div class="field">
      <label for="set-lang">{t('settings.language')}</label>
      <select
        id="set-lang"
        value={i18n.lang}
        onchange={(e) => session.setLanguage(e.currentTarget.value as 'de' | 'en')}
      >
        <option value="de">Deutsch</option>
        <option value="en">English</option>
      </select>
    </div>
    <div class="field">
      <label for="set-theme">{t('settings.theme')}</label>
      <select
        id="set-theme"
        value={session.theme}
        onchange={(e) => session.setTheme(e.currentTarget.value as Theme)}
      >
        <option value="system">{t('settings.theme.system')}</option>
        <option value="light">{t('settings.theme.light')}</option>
        <option value="dark">{t('settings.theme.dark')}</option>
      </select>
    </div>
  </div>
</section>

<section class="card" aria-labelledby="net-h">
  <h2 id="net-h">{t('nav.invest')}</h2>
  <label class="check">
    <input
      type="checkbox"
      checked={s.priceFetchEnabled}
      onchange={(e) => {
        const on = e.currentTarget.checked;
        session.mutate((d) => (d.settings.priceFetchEnabled = on));
      }}
    /><span>{t('settings.priceFetch')}</span>
  </label>
  <p class="hint">{t('settings.priceFetchHint')}</p>
</section>

<section class="card" aria-labelledby="sec-h">
  <h2 id="sec-h">{t('settings.security')}</h2>
  <div class="field">
    <label for="set-lock">{t('settings.autoLock')}</label>
    <input
      id="set-lock"
      type="number"
      min="1"
      max="120"
      step="1"
      value={s.autoLockMinutes}
      onchange={(e) => setNumber('autoLockMinutes', e.currentTarget.value, 1, 120)}
    />
  </div>
  <h3>{t('settings.changePassphrase')}</h3>
  <form onsubmit={changePass}>
    <div class="field">
      <PassphraseInput id="pw-cur" label={t('settings.currentPassphrase')} bind:value={cur} />
    </div>
    <div class="grid-2">
      <div class="field">
        <PassphraseInput
          id="pw-new"
          label={t('settings.newPassphrase')}
          bind:value={next}
          autocomplete="new-password"
        />
      </div>
      <div class="field">
        <PassphraseInput
          id="pw-new2"
          label={t('setup.passphraseRepeat')}
          bind:value={next2}
          autocomplete="new-password"
        />
      </div>
    </div>
    {#if pwErr}<p class="error" role="alert">{pwErr}</p>{/if}
    {#if pwMsg}<p class="notice ok" role="status">
        {pwMsg} <a href="#/data">{t('nav.data')}</a>
      </p>{/if}
    <button type="submit" class="btn" disabled={busy || !cur || !next}>
      {t('settings.changePassphrase')}
    </button>
  </form>
</section>

{#if isDev}
  <section class="card" aria-labelledby="dev-h">
    <h2 id="dev-h">{t('settings.dev')}</h2>
    <button type="button" class="btn" onclick={seed}>{t('settings.seed')}</button>
  </section>
{/if}

<style>
  .sugg {
    margin-top: 8px;
  }
</style>
