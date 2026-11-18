import { expect, type Page } from '@playwright/test';

export const PASS = 'velo tanne kaffee nebel';

export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.hostname !== 'localhost') problems.push(`third-party request: ${r.url()}`);
  });
  return problems;
}

/** Tresor einrichten inkl. erzwungener erster Sicherung. */
export async function setupVault(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Willkommen' })).toBeVisible();
  await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
  await page.getByLabel('Passphrase wiederholen').fill(PASS);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Tresor anlegen' }).click();
  const finish = page.getByRole('button', { name: 'Los geht’s' });
  await expect(finish).toBeDisabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Sicherung herunterladen' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.finanz$/);
  await finish.click();
  await expect(page.getByRole('heading', { name: 'Konten' })).toBeVisible();
}

export async function createAccount(page: Page, name: string, opening: string): Promise<void> {
  await page.evaluate(() => (location.hash = '/accounts'));
  await page.getByRole('button', { name: /Neues Konto/ }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Anfangssaldo').fill(opening);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}

export async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => (location.hash = h), hash);
}
