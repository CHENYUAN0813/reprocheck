import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const checks = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
page.setDefaultTimeout(15000);
const consoleErrors = [];
page.on('pageerror', error => consoleErrors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3000' ? route.continue() : route.abort());
let error = null;
try {
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  checks.push({ name: 'Frontend loads', status: 'PASS' });
  const text = 'Verified persistent note';
  await page.getByLabel('Note', { exact: true }).fill(text);
  const [saved] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/notes') && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Add note', exact: true }).click(),
  ]);
  if (saved.status() !== 201) throw new Error('API did not confirm creation');
  await page.getByRole('listitem').filter({ hasText: text }).waitFor();
  checks.push({ name: 'Form creates a record through HTTP API', status: 'PASS' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('listitem').filter({ hasText: text }).waitFor();
  checks.push({ name: 'Record survives page reload', status: 'PASS' });
  const notes = await (await page.request.get('http://127.0.0.1:3000/api/notes')).json();
  if (!notes.some(note => note.text === text)) throw new Error('Record absent from API');
  if (consoleErrors.length) throw new Error('Browser JavaScript errors: ' + consoleErrors.join('; '));
  checks.push({ name: 'API returns record; no browser exceptions', status: 'PASS' });
} catch (failure) { error = failure.message; }
try { await page.screenshot({ path: '/evidence/result.png', fullPage: true }); } catch {}
await writeFile('/evidence/result.json', JSON.stringify({ checks, error, passed: !error && checks.length === 4 }));
await browser.close();
process.exitCode = error ? 1 : 0;
