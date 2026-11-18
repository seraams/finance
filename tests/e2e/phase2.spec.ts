import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { collectProblems, createAccount, go, PASS, setupVault } from './helpers';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

test('camt.053-Import mit Vorschau und Duplikaterkennung', async ({ page }) => {
  const problems = collectProblems(page);
  await setupVault(page);
  await createAccount(page, 'Privatkonto', '1000');

  await go(page, '/import');
  await page.getByLabel('Datei').setInputFiles(fixture('camt053-sample.xml'));
  await expect(page.getByText('3 Zeilen · 3 neu · 0 Duplikate')).toBeVisible();
  await expect(page.getByText(/Schlusssaldo laut Bank: 2'719.10/)).toBeVisible();
  await page.getByRole('button', { name: '3 Buchungen importieren' }).click();
  await expect(page.getByTestId('tx-item')).toHaveCount(3);

  // Zweiter Import derselben Datei: alles Duplikate
  await go(page, '/import');
  await page.getByLabel('Datei').setInputFiles(fixture('camt053-sample.xml'));
  await expect(page.getByText('3 Zeilen · 0 neu · 3 Duplikate')).toBeVisible();
  await expect(page.getByRole('button', { name: '0 Buchungen importieren' })).toBeDisabled();

  // CSV mit Bank-Vorspann
  await go(page, '/import');
  await page.getByLabel('Datei').setInputFiles(fixture('bank-semicolon.csv'));
  await expect(page.getByLabel('Zeilen am Anfang überspringen')).toHaveValue('2');
  await expect(page.getByText('2 Zeilen konnten nicht gelesen werden')).toBeVisible();
  await expect(page.getByText(/4 Zeilen · 4 neu/)).toBeVisible();

  await go(page, '/closing');
  await expect(page.getByRole('heading', { name: 'Monatsabschluss' })).toBeVisible();

  expect(problems).toEqual([]);
});

test('offline nutzbar (PWA)', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service Worker nur in Chromium getestet');
  await setupVault(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entsperren' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
  await page.getByRole('button', { name: 'Entsperren' }).click();
  await expect(page.getByRole('heading', { name: 'Konten' })).toBeVisible();
  await context.setOffline(false);
});
