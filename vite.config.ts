/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Basis-Pfad für GitHub Pages: /<REPO-NAME>/.
 * Reihenfolge: BASE_PATH → Repo-Name aus GITHUB_REPOSITORY → "finance".
 */
function pagesBase(): string {
  const explicit = process.env.BASE_PATH;
  if (explicit) return explicit.endsWith('/') ? explicit : `${explicit}/`;
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'finance';
  return `/${repo}/`;
}

/**
 * Erlaubte Ziele für fetch(): nur die eigene Herkunft und die optionale
 * Kurs-API (CoinGecko). Der Abruf ist standardmässig in den Einstellungen aus.
 */
const CONNECT_SRC = ["'self'", 'https://api.coingecko.com'];

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${CONNECT_SRC.join(' ')}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/**
 * Setzt die CSP als <meta>-Tag – nur im Produktions-Build, weil der
 * Vite-Dev-Server Styles per Inline-<style> einspeist.
 */
function cspPlugin(): Plugin {
  return {
    name: 'finanz-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!-- CSP -->',
        `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
      );
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? pagesBase() : '/',
  plugins: [
    svelte(),
    cspPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Finanzplaner',
        short_name: 'Finanzen',
        description: 'Persönlicher Finanzplaner – Daten verschlüsselt auf dem Gerät.',
        lang: 'de-CH',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f7f7f5',
        theme_color: '#2b6a59',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Nur statische App-Dateien – niemals Daten (die liegen verschlüsselt in IndexedDB).
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    // Chart.js ist gross; Warnschwelle anheben statt Code zu zerstückeln.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
}));
