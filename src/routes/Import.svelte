<script lang="ts">
  import { untrack } from 'svelte';
  import { accountBalances } from '../lib/domain/balances';
  import { categoryTree } from '../lib/domain/entities';
  import { uuidv7 } from '../lib/domain/ids';
  import { buildPreview, commitImport, type PreviewRow } from '../lib/domain/import/apply';
  import { looksLikeCamt, parseCamt053, type CamtStatement } from '../lib/domain/import/camt053';
  import {
    detectDateFormat,
    detectDelimiter,
    detectSkipRows,
    guessMapping,
    mapRows,
    readTable,
    type ImportedRow,
    type RowError,
  } from '../lib/domain/import/csv';
  import { formatMoney } from '../lib/domain/money';
  import type { CsvField, DateFormat, ImportProfile } from '../lib/domain/types';
  import { formatDate, t, type MessageKey } from '../lib/i18n/index.svelte';
  import { router } from '../lib/router.svelte';
  import { session } from '../lib/state/session.svelte';
  import Amount from '../lib/ui/Amount.svelte';

  const data = $derived(session.data!);
  const accounts = $derived(data.accounts.filter((a) => !a.archived));
  const TAB = '\t';
  const FIELDS: CsvField[] = ['date', 'amount', 'debit', 'credit', 'payee', 'note', 'reference'];
  const DATE_FORMATS: DateFormat[] = ['dd.mm.yyyy', 'yyyy-mm-dd', 'dd/mm/yyyy', 'mm/dd/yyyy'];

  let accountId = $state(
    session.data!.accounts.find((a) => !a.archived && a.type === 'private')?.id ??
      session.data!.accounts[0]?.id ??
      '',
  );
  let text = $state('');
  let fileName = $state('');
  let format = $state<'csv' | 'camt053' | null>(null);
  let parseError = $state<string | null>(null);
  let camt = $state<CamtStatement | null>(null);

  // CSV-Profil
  let profileId = $state('');
  let profileName = $state('');
  let delimiter = $state(';');
  let hasHeader = $state(true);
  let skipRows = $state(0);
  let dateFormat = $state<DateFormat>('dd.mm.yyyy');
  let invertSign = $state(false);
  let mapping = $state<Partial<Record<CsvField, string>>>({});

  const table = $derived(
    format === 'csv' && text ? readTable(text, { delimiter, hasHeader, skipRows }) : null,
  );

  const parsed = $derived.by((): { rows: ImportedRow[]; errors: RowError[] } => {
    if (format === 'camt053' && camt) return { rows: camt.rows, errors: [] };
    if (format === 'csv' && table) {
      return mapRows(table, {
        id: '',
        name: '',
        bank: '',
        format: 'csv',
        columnMapping: mapping,
        dateFormat,
        invertSign,
      });
    }
    return { rows: [], errors: [] };
  });

  let preview = $state<PreviewRow[]>([]);
  $effect(() => {
    const rows = parsed.rows;
    const acc = accountId;
    preview = acc
      ? untrack(() => buildPreview($state.snapshot(session.data!) as typeof data, acc, rows))
      : [];
  });

  const included = $derived(preview.filter((p) => p.include).length);
  const dupCount = $derived(preview.filter((p) => p.duplicate).length);
  const appBalance = $derived(accountBalances(data).get(accountId) ?? 0);

  function applyProfile(p: ImportProfile) {
    profileName = p.name;
    delimiter = p.delimiter ?? delimiter;
    hasHeader = p.hasHeader ?? true;
    skipRows = p.skipRows ?? 0;
    dateFormat = p.dateFormat ?? dateFormat;
    invertSign = p.invertSign ?? false;
    mapping = { ...p.columnMapping };
    if (p.accountId && data.accounts.some((a) => a.id === p.accountId)) accountId = p.accountId;
  }

  function autodetect() {
    delimiter = detectDelimiter(text);
    skipRows = detectSkipRows(text, delimiter);
    hasHeader = true;
    const tb = readTable(text, { delimiter, hasHeader, skipRows });
    mapping = guessMapping(tb.header);
    const dateCol = mapping.date ? tb.header.indexOf(mapping.date) : 0;
    dateFormat = detectDateFormat(tb.rows.slice(0, 20).map((r) => r[dateCol] ?? ''));
  }

  async function onFile(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    parseError = null;
    camt = null;
    format = null;
    if (!file) return;
    fileName = file.name;
    text = await file.text();
    try {
      if (looksLikeCamt(text) || /\.xml$/i.test(file.name)) {
        camt = parseCamt053(text);
        format = 'camt053';
      } else {
        format = 'csv';
        const saved = data.importProfiles.find((p) => p.id === profileId);
        if (saved) applyProfile(saved);
        else autodetect();
      }
    } catch (err) {
      parseError = t('import.parseError', {
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function onProfileChange() {
    const p = data.importProfiles.find((x) => x.id === profileId);
    if (p) applyProfile(p);
    else if (text) autodetect();
  }

  function saveProfile() {
    const name = profileName.trim() || fileName || 'CSV';
    const id = profileId || uuidv7();
    const profile: ImportProfile = {
      id,
      name,
      bank: name,
      format: 'csv',
      accountId,
      columnMapping: { ...mapping },
      delimiter,
      hasHeader,
      skipRows,
      dateFormat,
      invertSign,
    };
    session.mutate((d) => {
      const i = d.importProfiles.findIndex((p) => p.id === id);
      if (i >= 0) d.importProfiles[i] = profile;
      else d.importProfiles.push(profile);
    });
    profileId = id;
    session.showToast(t('import.profileSaved'));
  }

  function commit() {
    const rows = $state.snapshot(preview) as PreviewRow[];
    const n = session.mutate((d) => commitImport(d, accountId, rows));
    session.showToast(t('import.done', { n }));
    router.go(`/tx?account=${accountId}`);
  }

  const tree = $derived(categoryTree(data));
</script>

<h1>{t('import.title')}</h1>
<p class="muted">{t('import.intro')}</p>

<section class="card">
  <div class="grid-2">
    <div class="field">
      <label for="imp-acc">{t('import.account')}</label>
      <select id="imp-acc" bind:value={accountId}>
        {#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="imp-profile">{t('import.profile')}</label>
      <select id="imp-profile" bind:value={profileId} onchange={onProfileChange}>
        <option value="">{t('import.profileNew')}</option>
        {#each data.importProfiles as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
    </div>
  </div>
  <div class="field">
    <label for="imp-file">{t('import.file')}</label>
    <input
      id="imp-file"
      type="file"
      accept=".csv,.txt,.xml,text/csv,application/xml,text/xml"
      onchange={onFile}
    />
  </div>
  {#if parseError}<p class="error" role="alert">{parseError}</p>{/if}
  {#if format}<p class="small muted">
      {t('import.format', { f: format === 'csv' ? 'CSV' : 'camt.053' })}
    </p>{/if}
</section>

{#if format === 'csv' && table}
  <section class="card" aria-labelledby="map-h">
    <h2 id="map-h">{t('import.mapping')}</h2>
    <div class="opts">
      <div class="field">
        <label for="imp-delim">{t('import.delimiter')}</label>
        <select id="imp-delim" bind:value={delimiter}>
          <option value=";">;</option>
          <option value=",">,</option>
          <option value={TAB}>Tab</option>
          <option value="|">|</option>
        </select>
      </div>
      <div class="field">
        <label for="imp-skip">{t('import.skipRows')}</label>
        <input id="imp-skip" type="number" min="0" max="50" bind:value={skipRows} />
      </div>
      <div class="field">
        <label for="imp-df">{t('import.dateFormat')}</label>
        <select id="imp-df" bind:value={dateFormat}>
          {#each DATE_FORMATS as f (f)}<option value={f}>{f}</option>{/each}
        </select>
      </div>
    </div>
    <div class="row">
      <label class="check">
        <input type="checkbox" bind:checked={hasHeader} /><span>{t('import.hasHeader')}</span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={invertSign} /><span>{t('import.invert')}</span>
      </label>
    </div>
    <div class="opts mapping">
      {#each FIELDS as f (f)}
        <div class="field">
          <label for={`map-${f}`}>{t(`import.col.${f}` as MessageKey)}</label>
          <select
            id={`map-${f}`}
            value={mapping[f] ?? ''}
            onchange={(e) => {
              const v = e.currentTarget.value;
              mapping = { ...mapping, [f]: v };
              if (!v) delete mapping[f];
            }}
          >
            <option value="">{t('import.col.none')}</option>
            {#each table.header as h, i (i)}<option value={h}>
                {hasHeader ? h : `#${i + 1}`}
              </option>{/each}
          </select>
        </div>
      {/each}
    </div>
    <div class="row">
      <div class="grow">
        <label for="imp-pname" class="visually-hidden">{t('import.profileName')}</label>
        <input
          id="imp-pname"
          type="text"
          placeholder={t('import.profileName')}
          bind:value={profileName}
        />
      </div>
      <button type="button" class="btn" onclick={saveProfile}>{t('import.profileSave')}</button>
    </div>
  </section>
{/if}

{#if camt}
  {#if camt.closingBalance}
    <p class="notice small">
      {t('import.closing', {
        amount: formatMoney(camt.closingBalance.amount),
        app: formatMoney(appBalance),
      })}
    </p>
  {/if}
{/if}

{#if parsed.errors.length}
  <details class="notice warn">
    <summary>{t('import.errors', { n: parsed.errors.length })}</summary>
    <ul class="small">
      {#each parsed.errors.slice(0, 50) as e (e.line + e.field)}
        <li>{t('import.errorLine', { line: e.line, field: e.field, value: e.value })}</li>
      {/each}
    </ul>
  </details>
{/if}

{#if preview.length}
  <section class="card" aria-labelledby="prev-h">
    <div class="row between">
      <h2 id="prev-h">{t('import.preview')}</h2>
      <span class="small muted">
        {t('import.summary', {
          total: preview.length,
          new: preview.length - dupCount,
          dup: dupCount,
        })}
      </span>
    </div>
    <ul class="list">
      {#each preview as p, i (p.hash)}
        <li class="prow" class:dup={p.duplicate}>
          <input
            type="checkbox"
            aria-label={`${t('import.include')}: ${p.row.payee}`}
            bind:checked={preview[i]!.include}
          />
          <div class="grow">
            <div class="row between">
              <span class="payee">{p.row.payee || p.row.note}</span>
              <Amount value={p.row.amount} />
            </div>
            <div class="small muted">
              {formatDate(p.row.date)}{p.row.note && p.row.payee ? ` · ${p.row.note}` : ''}
              ·
              <span class:neg={p.duplicate}>
                {p.duplicate ? t('import.duplicate') : t('import.new')}
              </span>
            </div>
            <label for={`pc-${i}`} class="visually-hidden">{t('tx.category')}</label>
            <select id={`pc-${i}`} class="pcat" bind:value={preview[i]!.categoryId}>
              <option value={undefined}>– {t('category.uncategorized')} –</option>
              {#each tree as g (g.parent.id)}
                <optgroup label={g.parent.name}>
                  <option value={g.parent.id}>{g.parent.name}</option>
                  {#each g.children as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
                </optgroup>
              {/each}
            </select>
          </div>
        </li>
      {/each}
    </ul>
    <button
      type="button"
      class="btn primary block commit"
      disabled={included === 0}
      onclick={commit}
    >
      {t('import.commit', { n: included })}
    </button>
  </section>
{/if}

<style>
  .opts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0 12px;
  }
  .mapping {
    margin-top: 12px;
  }
  .prow {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 10px 0;
  }
  .prow input[type='checkbox'] {
    width: 22px;
    height: 22px;
    margin-top: 2px;
    accent-color: var(--accent);
  }
  .prow.dup {
    opacity: 0.6;
  }
  .payee {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pcat {
    margin-top: 6px;
    min-height: 36px;
    padding: 4px 8px;
  }
  .commit {
    margin-top: 12px;
  }
</style>
