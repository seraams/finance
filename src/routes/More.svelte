<script lang="ts">
  import { i18n, t } from '../lib/i18n/index.svelte';
  import { session } from '../lib/state/session.svelte';
</script>

<h1>{t('nav.more')}</h1>
<div class="card">
  <ul class="list">
    <li><a class="list-item" href="#/closing">✓ {t('nav.closing')}</a></li>
    <li><a class="list-item" href="#/accounts">▭ {t('nav.accounts')}</a></li>
    <li><a class="list-item" href="#/invest">▲ {t('nav.invest')}</a></li>
    <li><a class="list-item" href="#/year">▦ {t('nav.year')}</a></li>
    <li><a class="list-item" href="#/shared">⇄ {t('nav.shared')}</a></li>
    <li><a class="list-item" href="#/recurring">↻ {t('nav.recurring')}</a></li>
    <li><a class="list-item" href="#/import">⇣ {t('nav.import')}</a></li>
    <li><a class="list-item" href="#/rules">⚑ {t('nav.rules')}</a></li>
    <li><a class="list-item" href="#/categories"># {t('nav.categories')}</a></li>
    <li><a class="list-item" href="#/settings">⚙ {t('nav.settings')}</a></li>
    <li><a class="list-item" href="#/data">⇅ {t('nav.data')}</a></li>
    <li>
      <button
        type="button"
        class="list-item"
        onclick={() => session.setTheme(session.theme === 'dark' ? 'light' : 'dark')}
      >
        ◐ {t('theme.toggle')}
      </button>
    </li>
    <li>
      <button
        type="button"
        class="list-item"
        onclick={() => session.setLanguage(i18n.lang === 'de' ? 'en' : 'de')}
      >
        🌐 {t('lang.toggle')} ({i18n.lang === 'de' ? 'English' : 'Deutsch'})
      </button>
    </li>
    <li>
      <button type="button" class="list-item" onclick={() => session.lock()}>
        🔒 {t('nav.lock')}
      </button>
    </li>
  </ul>
</div>
