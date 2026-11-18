<script lang="ts">
  import { WrongPassphraseError } from '../lib/crypto/crypto';
  import type { Dataset, Id } from '../lib/domain/types';
  import { t } from '../lib/i18n/index.svelte';
  import {
    isEncryptedBackup,
    plainJsonExport,
    readEncryptedBackup,
    readPlainJson,
    transactionsCsv,
  } from '../lib/storage/backup';
  import { dateStamp, downloadText } from '../lib/storage/download';
  import { session } from '../lib/state/session.svelte';
  import PassphraseInput from '../lib/ui/PassphraseInput.svelte';

  let plainOk = $state(false);
  let file = $state<File | null>(null);
  let fileText = $state('');
  let encrypted = $state(false);
  let pass = $state('');
  let msg = $state<string | null>(null);
  let err = $state<string | null>(null);
  let busy = $state(false);

  async function backup() {
    busy = true;
    try {
      await session.downloadBackup();
    } finally {
      busy = false;
    }
  }

  function snapshot(): Dataset {
    return $state.snapshot(session.requireData()) as Dataset;
  }

  function json() {
    if (!plainOk) return;
    downloadText(
      `finanzplaner-${dateStamp()}.json`,
      plainJsonExport(snapshot()),
      'application/json',
    );
  }

  function csv() {
    if (!plainOk) return;
    downloadText(
      `finanzplaner-${dateStamp()}.csv`,
      transactionsCsv(snapshot()),
      'text/csv;charset=utf-8',
    );
  }

  async function pick(e: Event & { currentTarget: HTMLInputElement }) {
    file = e.currentTarget.files?.[0] ?? null;
    msg = err = null;
    fileText = file ? await file.text() : '';
    try {
      encrypted = isEncryptedBackup(JSON.parse(fileText));
    } catch {
      encrypted = false;
    }
  }

  async function doImport(e: SubmitEvent) {
    e.preventDefault();
    if (!fileText || !confirm(t('data.importConfirm'))) return;
    busy = true;
    msg = err = null;
    try {
      let dataset: Dataset;
      let attachments = new Map<Id, Uint8Array<ArrayBuffer>>();
      if (encrypted) {
        const r = await readEncryptedBackup(fileText, pass);
        dataset = r.dataset;
        attachments = r.attachments;
      } else {
        dataset = readPlainJson(fileText);
      }
      dataset.settings.lastBackupAt ??= new Date().toISOString();
      await session.replaceData(dataset, attachments);
      pass = '';
      msg = t('data.imported', { n: dataset.transactions.length });
    } catch (e2) {
      err =
        e2 instanceof WrongPassphraseError
          ? t('data.wrongBackupPass')
          : t('data.importError', { msg: e2 instanceof Error ? e2.message : String(e2) });
    } finally {
      busy = false;
    }
  }
</script>

<h1>{t('data.title')}</h1>

<section class="card" aria-labelledby="bk-h">
  <h2 id="bk-h">{t('data.backup')}</h2>
  <p>{t('data.backupText')}</p>
  {#if session.data?.settings.lastBackupAt}
    <p class="small muted">✓ {new Date(session.data.settings.lastBackupAt).toLocaleString()}</p>
  {/if}
  <button type="button" class="btn primary" onclick={backup} disabled={busy}>
    {t('data.backupButton')}
  </button>
</section>

<section class="card" aria-labelledby="pl-h">
  <h2 id="pl-h">{t('data.plain')}</h2>
  <div class="notice danger" role="note">{t('data.plainWarn')}</div>
  <label class="check">
    <input type="checkbox" bind:checked={plainOk} /><span>{t('data.plainConfirm')}</span>
  </label>
  <div class="row actions">
    <button type="button" class="btn" disabled={!plainOk} onclick={json}>{t('data.json')}</button>
    <button type="button" class="btn" disabled={!plainOk} onclick={csv}>{t('data.csv')}</button>
  </div>
</section>

<section class="card" aria-labelledby="im-h">
  <h2 id="im-h">{t('data.import')}</h2>
  <p>{t('data.importText')}</p>
  <form onsubmit={doImport}>
    <div class="field">
      <label for="imp-file">{t('data.importFile')}</label>
      <input
        id="imp-file"
        type="file"
        accept=".finanz,.json,application/json,application/octet-stream"
        onchange={pick}
      />
    </div>
    {#if encrypted}
      <div class="field">
        <PassphraseInput id="imp-pass" label={t('data.importPassphrase')} bind:value={pass} />
      </div>
    {/if}
    {#if err}<p class="error" role="alert">{err}</p>{/if}
    {#if msg}<p class="notice ok" role="status">{msg}</p>{/if}
    <button type="submit" class="btn danger" disabled={!file || busy || (encrypted && !pass)}>
      {t('data.importButton')}
    </button>
  </form>
</section>

<style>
  .actions {
    margin-top: 12px;
  }
</style>
