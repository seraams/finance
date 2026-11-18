import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { collectProblems, createAccount, go, setupVault } from './helpers';

const icon = fileURLToPath(new URL('../../public/pwa-512.png', import.meta.url));

test('geteilte Kosten, Ausgleich, Rückerstattung, Beleg und Hinweise', async ({ page }) => {
  const problems = collectProblems(page);
  await setupVault(page);
  await createAccount(page, 'Privatkonto', '1000');
  await page.getByRole('button', { name: /Neues Konto/ }).click();
  await page.getByLabel('Name').fill('Lea');
  await page.getByLabel('Typ').selectOption('person');
  await page.getByRole('button', { name: 'Speichern' }).click();

  // Geteilte Ausgabe: 90 CHF zu zweit, ich zahle
  await go(page, '/shared');
  await page.getByLabel('Gesamtbetrag').fill('90');
  await page.getByRole('button', { name: 'Lea' }).click();
  await page.getByLabel('Kategorie').selectOption({ label: 'Lebensmittel' });
  await page.getByLabel('Empfänger / Auftraggeber').fill('Migros');
  await expect(page.getByText(/Mein Anteil: 45.00 · andere: Lea 45.00/)).toBeVisible();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Lea schuldet dir')).toBeVisible();

  // Ausgleich
  await page.getByRole('button', { name: 'Ausgleichen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ausgleichen' }).click();
  await expect(page.getByText('Alles ausgeglichen.')).toBeVisible();

  // Rückerstattung zur Ausgabe
  await go(page, '/tx');
  await page.getByTestId('tx-item').filter({ hasText: 'Migros' }).first().click();
  await page.getByRole('link', { name: /Rückerstattung erfassen/ }).click();
  await expect(page.getByRole('heading', { name: 'Rückerstattung' })).toBeVisible();
  const refundAmount = page.getByRole('textbox', { name: 'Betrag (CHF)' });
  await expect(refundAmount).toHaveValue('45.00'); // nur mein Anteil ist erstattbar
  await refundAmount.fill('5');
  await expect(refundAmount).toHaveValue('5');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await go(page, '/tx');
  await expect(page.getByTestId('tx-item').filter({ hasText: 'Rückerstattung' })).toHaveCount(1);

  // Beleg anhängen (verkleinert + verschlüsselt)
  await page.getByTestId('tx-item').filter({ hasText: 'Rückerstattung' }).click();
  await page.locator('input[type=file]').setInputFiles(icon);
  await expect(page.getByRole('img', { name: 'Belege' })).toBeVisible();
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open('finanzplaner');
      r.onsuccess = () => res(r.result);
    });
    return new Promise<string>((res) => {
      const r = db.transaction('attachments').objectStore('attachments').getAll();
      r.onsuccess = () => res(JSON.stringify(r.result));
    });
  });
  expect(stored).toContain('ciphertext');
  expect(stored).not.toContain('RIFF'); // kein WebP-Klartext
  await page.getByRole('button', { name: 'Speichern' }).click();

  // Hinweise: Budget zu 80 % verbraucht
  await go(page, '/budget');
  await page.getByRole('button', { name: /Budget für Lebensmittel/ }).click();
  await page.getByRole('dialog').getByLabel('Betrag').fill('45');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await go(page, '/');
  const hint = page.getByRole('link', { name: /Lebensmittel: 89 % des Budgets verbraucht/ });
  await expect(hint).toBeVisible();
  await page.getByRole('button', { name: /Ausblenden: Essen › Lebensmittel/ }).click();
  await expect(hint).toHaveCount(0);

  expect(problems).toEqual([]);
});
