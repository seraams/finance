<script lang="ts">
  import { onMount } from 'svelte';
  import { t, type MessageKey } from './lib/i18n/index.svelte';
  import { router } from './lib/router.svelte';
  import { session } from './lib/state/session.svelte';
  import Accounts from './routes/Accounts.svelte';
  import Budget from './routes/Budget.svelte';
  import Categories from './routes/Categories.svelte';
  import Closing from './routes/Closing.svelte';
  import Import from './routes/Import.svelte';
  import Recurring from './routes/Recurring.svelte';
  import Rules from './routes/Rules.svelte';
  import Dashboard from './routes/Dashboard.svelte';
  import Data from './routes/Data.svelte';
  import More from './routes/More.svelte';
  import Settings from './routes/Settings.svelte';
  import Shared from './routes/Shared.svelte';
  import Setup from './routes/Setup.svelte';
  import TransactionForm from './routes/TransactionForm.svelte';
  import Transactions from './routes/Transactions.svelte';
  import Unlock from './routes/Unlock.svelte';

  let initError = $state<string | null>(null);

  onMount(() => {
    session.init().catch((e: unknown) => {
      initError = e instanceof Error ? e.message : String(e);
    });
  });

  const seg = $derived(router.route.segments);
  const section = $derived(seg[0] ?? '');
  const needsFirstBackup = $derived(
    session.status === 'unlocked' && !!session.data && !session.data.settings.lastBackupAt,
  );

  const navItems: { path: string; key: MessageKey; icon: string; section: string }[] = [
    { path: '/', key: 'nav.dashboard', icon: '◎', section: '' },
    { path: '/tx', key: 'nav.transactions', icon: '≡', section: 'tx' },
    { path: '/budget', key: 'nav.budget', icon: '◐', section: 'budget' },
    { path: '/closing', key: 'nav.closing', icon: '✓', section: 'closing' },
    { path: '/accounts', key: 'nav.accounts', icon: '▭', section: 'accounts' },
    { path: '/shared', key: 'nav.shared', icon: '⇄', section: 'shared' },
    { path: '/recurring', key: 'nav.recurring', icon: '↻', section: 'recurring' },
    { path: '/import', key: 'nav.import', icon: '⇣', section: 'import' },
    { path: '/rules', key: 'nav.rules', icon: '⚑', section: 'rules' },
    { path: '/categories', key: 'nav.categories', icon: '#', section: 'categories' },
    { path: '/settings', key: 'nav.settings', icon: '⚙', section: 'settings' },
    { path: '/data', key: 'nav.data', icon: '⇅', section: 'data' },
  ];
  const mobileItems = $derived([navItems[0]!, navItems[1]!, navItems[2]!]);
  const moreActive = $derived(
    [
      'accounts',
      'categories',
      'settings',
      'data',
      'more',
      'import',
      'shared',
      'rules',
      'recurring',
      'closing',
    ].includes(section),
  );
</script>

{#if initError}
  <main class="auth"><div class="notice danger" role="alert">{initError}</div></main>
{:else if session.status === 'loading'}
  <main class="auth" aria-busy="true"><p class="muted">…</p></main>
{:else if session.status === 'setup'}
  <Setup />
{:else if session.status === 'locked'}
  <Unlock />
{:else if session.onboarding || needsFirstBackup}
  <Setup exportOnly />
{:else}
  <a
    class="skip-link"
    href="#main"
    onclick={(e) => {
      e.preventDefault();
      document.getElementById('main')?.focus();
    }}
  >
    {t('nav.skip')}
  </a>
  <div class="layout">
    <nav class="sidebar" aria-label={t('nav.main')}>
      <div class="brand">{t('app.name')}</div>
      <a class="btn primary new" href="#/tx/new">＋ {t('tx.new')}</a>
      <ul>
        {#each navItems as item (item.path)}
          <li>
            <a href={`#${item.path}`} aria-current={section === item.section ? 'page' : undefined}>
              <span aria-hidden="true">{item.icon}</span>
              {t(item.key)}
            </a>
          </li>
        {/each}
      </ul>
      <button type="button" class="btn ghost lock" onclick={() => session.lock()}>
        🔒 {t('nav.lock')}
      </button>
      <p class="save-state small muted" aria-live="polite">
        {#if session.saveState === 'error'}
          <span class="neg">{t('save.error', { msg: session.saveError ?? '' })}</span>
        {:else if session.saveState === 'idle'}
          ✓ {t('common.saved')}
        {:else}
          …
        {/if}
      </p>
    </nav>

    <main id="main" tabindex="-1">
      {#if section === ''}
        <Dashboard />
      {:else if section === 'tx' && seg[1] === 'new'}
        {#key router.route.path + router.route.query.toString()}
          <TransactionForm />
        {/key}
      {:else if section === 'tx' && seg[1]}
        {#key seg[1]}
          <TransactionForm id={seg[1]} />
        {/key}
      {:else if section === 'tx'}
        <Transactions />
      {:else if section === 'budget'}
        <Budget />
      {:else if section === 'accounts'}
        <Accounts />
      {:else if section === 'categories'}
        <Categories />
      {:else if section === 'settings'}
        <Settings />
      {:else if section === 'data'}
        <Data />
      {:else if section === 'shared'}
        <Shared />
      {:else if section === 'import'}
        <Import />
      {:else if section === 'rules'}
        <Rules />
      {:else if section === 'recurring'}
        {#key router.route.query.toString()}
          <Recurring />
        {/key}
      {:else if section === 'closing'}
        {#key router.route.query.toString()}
          <Closing />
        {/key}
      {:else if section === 'more'}
        <More />
      {:else}
        <Dashboard />
      {/if}
    </main>

    <nav class="tabbar" aria-label={t('nav.main')}>
      {#each mobileItems.slice(0, 2) as item (item.path)}
        <a href={`#${item.path}`} aria-current={section === item.section ? 'page' : undefined}>
          <span aria-hidden="true">{item.icon}</span>{t(item.key)}
        </a>
      {/each}
      <a href="#/tx/new" class="add" aria-label={t('tx.new')}><span aria-hidden="true">＋</span></a>
      <a href="#/budget" aria-current={section === 'budget' ? 'page' : undefined}>
        <span aria-hidden="true">◐</span>{t('nav.budget')}
      </a>
      <a href="#/more" aria-current={moreActive ? 'page' : undefined}>
        <span aria-hidden="true">⋯</span>{t('nav.more')}
      </a>
    </nav>
  </div>
{/if}

{#if session.toast}
  <div class="toast" role="status">{session.toast}</div>
{/if}

<style>
  .auth {
    max-width: 440px;
    margin: 0 auto;
    padding: 24px 16px;
  }
  .layout {
    min-height: 100dvh;
  }
  main {
    padding: 16px 16px calc(var(--nav-h) + 32px + env(safe-area-inset-bottom));
    max-width: 1100px;
    margin: 0 auto;
    outline: none;
  }
  .sidebar {
    display: none;
  }
  .tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(var(--nav-h) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    background: var(--surface);
    border-top: 1px solid var(--border);
    z-index: 50;
  }
  .tabbar a {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font-size: 0.75rem;
    color: var(--muted);
    text-decoration: none;
  }
  .tabbar a span {
    font-size: 1.25rem;
    line-height: 1;
  }
  .tabbar a[aria-current='page'] {
    color: var(--accent);
    font-weight: 600;
  }
  .tabbar .add span {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 1.6rem;
  }

  @media (min-width: 900px) {
    .layout {
      display: grid;
      grid-template-columns: 240px 1fr;
    }
    .tabbar {
      display: none;
    }
    main {
      padding: 24px 32px 48px;
      width: 100%;
    }
    .sidebar {
      display: flex;
      flex-direction: column;
      gap: 8px;
      position: sticky;
      top: 0;
      height: 100dvh;
      padding: 20px 12px;
      border-right: 1px solid var(--border);
      background: var(--surface);
    }
    .brand {
      font-weight: 700;
      font-size: 1.1rem;
      padding: 0 8px 8px;
    }
    .sidebar ul {
      list-style: none;
      margin: 8px 0;
      padding: 0;
      flex: 1;
    }
    .sidebar li a {
      display: block;
      padding: 10px 12px;
      border-radius: 8px;
      color: var(--text);
      text-decoration: none;
    }
    .sidebar li a:hover {
      background: var(--surface-2);
    }
    .sidebar li a[aria-current='page'] {
      background: var(--accent-soft);
      font-weight: 600;
    }
    .sidebar li a span {
      display: inline-block;
      width: 1.4em;
      color: var(--muted);
    }
    .lock {
      justify-content: flex-start;
    }
    .save-state {
      padding: 0 8px;
      margin: 0;
    }
  }
</style>
