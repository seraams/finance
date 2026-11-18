/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

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
 * Erlaubte Ziele für fetch(). Die optionale Kurs-API (Phase 4) wird hier
 * ergänzt, sobald es sie gibt. Bis dahin: nur 'self'.
 */
const CONNECT_SRC = ["'self'"];

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
  plugins: [svelte(), cspPlugin()],
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
