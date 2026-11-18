import { expect, test } from '@playwright/test';
import { collectProblems, go, setupVault } from './helpers';

test('Depot: Wertpapier, Kauf, Kurs, Vermögen und Jahresübersicht', async ({ page }) => {
  const problems = collectProblems(page);
  await setupVault(page);
  await page.getByRole('button', { name: /Neues Konto/ }).click();
  await page.getByLabel('Name').fill('Depot');
  await page.getByLabel('Typ').selectOption('brokerage');
  await page.getByLabel('Anfangssaldo').fill('2000');
  await page.getByRole('button', { name: 'Speichern' }).click();

  await go(page, '/invest');
  await page.getByRole('button', { name: /Wertpapier anlegen/ }).click();
  await page.getByLabel('Name').fill('Welt-ETF');
  await page.getByLabel('ISIN').fill('IE00B4L5Y984');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Ungültige ISIN.')).toBeVisible();
  await page.getByLabel('ISIN').fill('IE00B4L5Y983');
  await page.getByRole('button', { name: 'Speichern' }).click();

  await page.getByRole('button', { name: 'Kauf / Verkauf' }).click();
  await page.getByLabel('Stück').fill('10');
  await page.getByLabel('Kurs', { exact: true }).fill('90');
  await page.getByLabel('Gebühren').fill('5');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  // 2000 − 905 Geld + 900 Marktwert
  await expect(page.getByTestId('networth')).toHaveText("1'995.00");

  await page.getByRole('button', { name: 'Kurs eintragen' }).first().click();
  await page.getByRole('dialog').getByLabel('Kurs').fill('100');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('networth')).toHaveText("2'095.00");
  await expect(page.getByText(/\+95.00 \(10.5\s?%\)/)).toBeVisible();

  await go(page, '/year');
  await expect(page.getByRole('heading', { name: 'Jahresübersicht' })).toBeVisible();
  await expect(page.locator('tfoot')).toContainText("2'095.00");

  expect(problems).toEqual([]);
});

test('Krypto-Kursabruf nur nach Einwilligung', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://api.coingecko.com/**', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ json: { bitcoin: { chf: 80000.5 } } });
  });
  await setupVault(page);
  await page.getByRole('button', { name: /Neues Konto/ }).click();
  await page.getByLabel('Name').fill('Wallet');
  await page.getByLabel('Typ').selectOption('crypto');
  await page.getByRole('button', { name: 'Speichern' }).click();

  await go(page, '/invest');
  await page.getByRole('button', { name: /Wertpapier anlegen/ }).click();
  await page.getByLabel('Name').fill('Bitcoin');
  await page.getByLabel('Art').selectOption('crypto');
  await page.getByLabel(/CoinGecko-ID/).fill('bitcoin');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('button', { name: /Bestand erfassen/ }).click();
  await page.getByLabel('Stück').fill('0,5');
  await page.getByLabel('Kaufkurs').fill('50000');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('networth')).toHaveText("25'000.00");

  // Ausgeschaltet: keine Anfrage
  await page.getByRole('button', { name: /Krypto-Kurse abrufen/ }).click();
  await expect(page.getByText('Der Kursabruf ist ausgeschaltet (Einstellungen).')).toBeVisible();
  expect(requests).toEqual([]);

  await go(page, '/settings');
  await page.getByLabel(/Krypto-Kurse online abrufen/).check();
  await go(page, '/invest');
  await page.getByRole('button', { name: /Krypto-Kurse abrufen/ }).click();
  await expect(page.getByTestId('networth')).toHaveText("40'000.25");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain('ids=bitcoin');
  expect(requests[0]).not.toMatch(/0[.,]5|25000/); // keine Mengen/Beträge
});
