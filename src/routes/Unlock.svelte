<script lang="ts">
  import { i18n, t } from '../lib/i18n/index.svelte';
  import { session } from '../lib/state/session.svelte';
  import PassphraseInput from '../lib/ui/PassphraseInput.svelte';

  let pass = $state('');
  let busy = $state(false);
  let message = $state<string | null>(null);
  let now = $state(Date.now());
  let showForgot = $state(false);
  let resetWord = $state('');

  const waitSec = $derived(Math.ceil(Math.max(0, session.lockedUntil - now) / 1000));

  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(id);
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!pass || busy) return;
    busy = true;
    message = null;
    try {
      const r = await session.unlock(pass);
      if (r === 'ok') pass = '';
      else if (r === 'wrong') {
        message = t('unlock.wrong');
        now = Date.now();
      }
    } catch (err) {
      message = t('common.error', { msg: err instanceof Error ? err.message : String(err) });
    } finally {
      busy = false;
    }
  }

  async function reset() {
    if (resetWord.trim() !== t('unlock.resetWord')) return;
    await session.wipe();
  }
</script>

<main class="auth" id="main">
  <div class="card">
    <div class="row between">
      <h1>{t('app.name')}</h1>
      <button
        type="button"
        class="btn ghost small"
        aria-label={t('lang.toggle')}
        onclick={() => session.setLanguage(i18n.lang === 'de' ? 'en' : 'de')}
      >
        {i18n.lang === 'de' ? 'EN' : 'DE'}
      </button>
    </div>
    <p class="muted">🔒 {t('lock.locked')}</p>
    <form onsubmit={submit}>
      <div class="field">
        <PassphraseInput
          id="unlock-pass"
          label={t('setup.passphrase')}
          bind:value={pass}
          autofocus
          invalid={!!message}
        />
      </div>
      <div aria-live="polite">
        {#if waitSec > 0}
          <p class="error">{t('unlock.wait', { s: waitSec })}</p>
        {:else if message}
          <p class="error">{message}</p>
        {/if}
        {#if session.failedAttempts > 0}
          <p class="hint">{t('unlock.attempts', { n: session.failedAttempts })}</p>
        {/if}
      </div>
      <button type="submit" class="btn primary block" disabled={busy || waitSec > 0 || !pass}>
        {busy ? t('unlock.working') : t('unlock.button')}
      </button>
    </form>
    <p class="forgot">
      <button
        type="button"
        class="btn ghost small"
        aria-expanded={showForgot}
        onclick={() => (showForgot = !showForgot)}
      >
        {t('unlock.forgot')}
      </button>
    </p>
    {#if showForgot}
      <div class="notice danger">
        <p>{t('unlock.forgotText')}</p>
        <label for="reset-word">{t('unlock.resetConfirm')}</label>
        <input id="reset-word" type="text" autocomplete="off" bind:value={resetWord} />
        <button
          type="button"
          class="btn danger block reset"
          disabled={resetWord.trim() !== t('unlock.resetWord')}
          onclick={reset}
        >
          {t('unlock.reset')}
        </button>
      </div>
    {/if}
  </div>
</main>

<style>
  .auth {
    max-width: 440px;
    margin: 0 auto;
    padding: 24px 16px;
    min-height: 80dvh;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .forgot {
    text-align: center;
    margin: 12px 0 0;
  }
  .reset {
    margin-top: 8px;
  }
</style>
