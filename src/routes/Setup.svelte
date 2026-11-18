<script lang="ts">
  import {
    MIN_PASSPHRASE_LENGTH,
    passphraseStrength,
    WrongPassphraseError,
  } from '../lib/crypto/crypto';
  import { i18n, t, type MessageKey } from '../lib/i18n/index.svelte';
  import { session } from '../lib/state/session.svelte';
  import PassphraseInput from '../lib/ui/PassphraseInput.svelte';
  import { untrack } from 'svelte';

  interface Props {
    /** Schritt 2 (erste Sicherung) direkt anzeigen, z. B. nach Neuladen. */
    exportOnly?: boolean;
  }
  let { exportOnly = false }: Props = $props();

  let step = $state<'passphrase' | 'export' | 'restore'>(
    untrack(() => (exportOnly ? 'export' : 'passphrase')),
  );
  let pass = $state('');
  let pass2 = $state('');
  let ack = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let exported = $state(false);
  let restoreFile = $state<File | null>(null);
  let restorePass = $state('');

  const strength = $derived(passphraseStrength(pass));
  const tooShort = $derived(pass.length > 0 && pass.length < MIN_PASSPHRASE_LENGTH);
  const mismatch = $derived(pass2.length > 0 && pass !== pass2);
  const canCreate = $derived(
    pass.length >= MIN_PASSPHRASE_LENGTH && pass === pass2 && ack && !busy,
  );

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (!canCreate) return;
    busy = true;
    error = null;
    try {
      await session.create(pass);
      pass = '';
      pass2 = '';
      step = 'export';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function doExport() {
    busy = true;
    try {
      await session.downloadBackup();
      exported = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function finish() {
    await session.flush();
    session.onboarding = false;
    location.hash = '/accounts';
  }

  async function restore(e: SubmitEvent) {
    e.preventDefault();
    if (!restoreFile || !restorePass) return;
    busy = true;
    error = null;
    try {
      await session.restore(await restoreFile.text(), restorePass);
      restorePass = '';
      location.hash = '/';
    } catch (err) {
      error =
        err instanceof WrongPassphraseError
          ? t('data.wrongBackupPass')
          : t('data.importError', { msg: err instanceof Error ? err.message : String(err) });
    } finally {
      busy = false;
    }
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

    {#if step === 'passphrase'}
      <h2>{t('setup.title')}</h2>
      <p>{t('setup.intro')}</p>
      <form onsubmit={create} novalidate>
        <div class="field">
          <PassphraseInput
            id="pass"
            label={t('setup.passphrase')}
            bind:value={pass}
            autocomplete="new-password"
            autofocus
            describedby="pass-hint"
            invalid={tooShort}
          />
          <p class="hint" id="pass-hint">
            {t('setup.passphraseHint', { n: MIN_PASSPHRASE_LENGTH })}
          </p>
          {#if pass.length > 0}
            <p class="hint" aria-live="polite">
              {t('setup.strength')}: {t(`setup.strength${strength}` as MessageKey)}
            </p>
          {/if}
          {#if tooShort}<p class="error">{t('setup.tooShort')}</p>{/if}
        </div>
        <div class="field">
          <PassphraseInput
            id="pass2"
            label={t('setup.passphraseRepeat')}
            bind:value={pass2}
            autocomplete="new-password"
            invalid={mismatch}
          />
          {#if mismatch}<p class="error">{t('setup.mismatch')}</p>{/if}
        </div>
        <div class="notice danger" role="note">
          <strong>{t('setup.warningTitle')}</strong>
          <p>{t('setup.warning')}</p>
          <label class="check">
            <input type="checkbox" bind:checked={ack} />
            <span>{t('setup.acknowledge')}</span>
          </label>
        </div>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <button type="submit" class="btn primary block" disabled={!canCreate}>
          {busy ? t('setup.creating') : t('setup.create')}
        </button>
      </form>
      <p class="center">
        <button type="button" class="btn ghost" onclick={() => (step = 'restore')}>
          {t('setup.restore')}
        </button>
      </p>
    {:else if step === 'export'}
      <h2>{t('setup.exportTitle')}</h2>
      <p>{t('setup.exportText')}</p>
      <div class="notice warn">{t('setup.warning')}</div>
      <button type="button" class="btn primary block" onclick={doExport} disabled={busy}>
        {t('setup.exportButton')}
      </button>
      {#if exported}<p class="hint" role="status">✓ {t('setup.exportDone')}</p>{/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button type="button" class="btn block finish" disabled={!exported} onclick={finish}>
        {t('setup.finish')}
      </button>
    {:else}
      <h2>{t('data.restoreTitle')}</h2>
      <p>{t('data.restoreText')}</p>
      <form onsubmit={restore}>
        <div class="field">
          <label for="restore-file">{t('data.importFile')}</label>
          <input
            id="restore-file"
            type="file"
            accept=".finanz,application/octet-stream,application/json"
            onchange={(e) => (restoreFile = e.currentTarget.files?.[0] ?? null)}
          />
        </div>
        <div class="field">
          <PassphraseInput
            id="restore-pass"
            label={t('data.importPassphrase')}
            bind:value={restorePass}
          />
        </div>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="row end">
          <button type="button" class="btn" onclick={() => (step = 'passphrase')}>
            {t('common.back')}
          </button>
          <button type="submit" class="btn primary" disabled={!restoreFile || !restorePass || busy}>
            {t('data.importButton')}
          </button>
        </div>
      </form>
    {/if}
  </div>
</main>

<style>
  .auth {
    max-width: 480px;
    margin: 0 auto;
    padding: 24px 16px;
  }
  .center {
    text-align: center;
    margin-top: 12px;
  }
  .finish {
    margin-top: 12px;
  }
</style>
