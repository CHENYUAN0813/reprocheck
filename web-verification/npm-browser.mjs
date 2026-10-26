import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const config = JSON.parse(process.argv[2]);
const url = `http://127.0.0.1:${config.port}${config.path}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
let error = null;
try {
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  if (!response?.ok()) throw new Error('Page returned a non-success HTTP status');
  checks.push({ name: 'Page responds successfully', status: 'PASS' });
  await page.waitForFunction(text => document.body?.innerText.trim() && (!text || document.body.innerText.includes(text)), config.expectedText, { timeout: 15000 });
  checks.push({ name: config.expectedText ? 'Configured text is visible' : 'Page has visible text', status: 'PASS' });
  if (errors.length) throw new Error(errors.join('; '));
  checks.push({ name: 'No uncaught browser exceptions during load', status: 'PASS' });
} catch (failure) { error = failure.message; }
try { await page.screenshot({ path: '/evidence/result.png', fullPage: true }); } catch {}
await writeFile('/evidence/result.json', JSON.stringify({ checks, error, passed: !error && checks.length === 3, scope: 'Page-load smoke checks only; business workflows and external services are not verified.' }));
await browser.close();
process.exitCode = error ? 1 : 0;
