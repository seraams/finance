import { expect, test } from '@playwright/test';
import { collectProblems, PASS, setupVault } from './helpers';

test('einrichten, Buchung erfassen, sperren, entsperren – Buchung ist noch da', async ({
  page,
}) => {
  const problems = collectProblems(page);

  // 1. Einrichten (inkl. erzwungener Sicherung)
  await setupVault(page);

  // 2. Konto anlegen
  await page.getByRole('button', { name: /Neues Konto/ }).click();
  await page.getByLabel('Name').fill('Privatkonto');
  await page.getByLabel('Anfangssaldo').fill("1'000.00");
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Privatkonto').first()).toBeVisible();

  // 3. Buchung erfassen (Schnelleingabe)
  await page.goto('./#/tx/new');
  const amount = page.getByLabel(/Betrag/);
  await expect(amount).toHaveAttribute('inputmode', 'decimal');
  await amount.fill('12,50');
  await page.getByRole('button', { name: 'Lebensmittel' }).click();
  await page.getByLabel('Empfänger / Auftraggeber').fill('Bäckerei Erfunden');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.goto('./#/tx');
  await expect(page.getByTestId('tx-item')).toHaveCount(1);
  await expect(page.getByTestId('tx-item')).toContainText('Bäckerei Erfunden');
  await expect(page.getByTestId('tx-item')).toContainText('−12.50');

  // Nichts im Klartext in IndexedDB oder localStorage
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('finanzplaner');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const vault = await new Promise<unknown>((res) => {
      const r = db.transaction('vault').objectStore('vault').get('main');
      r.onsuccess = () => res(r.result);
    });
    return JSON.stringify(vault) + JSON.stringify(localStorage);
  });
  expect(stored).not.toContain('Bäckerei');
  expect(stored).not.toContain('Privatkonto');

  // 4. Sperren
  await page.goto('./#/more');
  await page
    .getByRole('button', { name: /Sperren/ })
    .last()
    .click();
  await expect(page.getByRole('button', { name: 'Entsperren' })).toBeVisible();
  await expect(page.getByText('Bäckerei Erfunden')).toHaveCount(0);

  // Falsche Passphrase
  await page.getByLabel('Passphrase', { exact: true }).fill('falsch falsch falsch');
  await page.getByRole('button', { name: 'Entsperren' }).click();
  await expect(page.getByText('Falsche Passphrase.')).toBeVisible();

  // 5. Neu laden und entsperren
  await page.reload();
  await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
  await page.getByRole('button', { name: 'Entsperren' }).click();
  await page.goto('./#/tx');
  await expect(page.getByTestId('tx-item')).toContainText('Bäckerei Erfunden');

  // Dashboard rendert (Diagramme, CSP)
  await page.goto('./#/');
  await expect(page.getByTestId('buffer')).toContainText("1'000.00");

  expect(problems).toEqual([]);
});
