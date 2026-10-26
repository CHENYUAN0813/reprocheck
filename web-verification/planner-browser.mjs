import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const live = process.argv.includes('--live');
const checks = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => ['http://127.0.0.1:5173', 'http://127.0.0.1:8000'].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
const tasks = async () => {
  const response = await page.request.get('http://127.0.0.1:8000/api/tasks');
  if (!response.ok()) throw new Error('Task API failed');
  return response.json();
};
async function waitTask(predicate) {
  for (let i = 0; i < 40; i++) {
    const rows = await tasks(); if (predicate(rows)) return rows;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Persisted task state did not match the browser action');
}
let error = null;
let ai = { status: live ? 'PENDING' : 'NOT_REQUESTED' };
try {
  await page.goto('http://127.0.0.1:5173/#tasks');
  await page.getByLabel('New task title', { exact: true }).waitFor();
  checks.push({ name: 'React frontend and FastAPI ready in Demo mode', status: 'PASS' });
  const title = 'ReproCheck browser task';
  await page.getByLabel('New task title', { exact: true }).fill(title);
  await page.getByLabel('New task schedule', { exact: true }).fill('2026-12-10T10:00');
  await page.getByLabel('New task end time', { exact: true }).fill('2026-12-10T11:00');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await waitTask(rows => rows.some(row => row.title === title && row.scheduled_start === '2026-12-10T10:00:00'));
  checks.push({ name: 'Create manual task through frontend and API', status: 'PASS' });
  await page.getByRole('button', { name: `Edit ${title}`, exact: true }).click();
  await page.getByLabel(`Edit schedule for ${title}`, { exact: true }).fill('2026-12-10T12:00');
  await page.getByLabel(`Edit end time for ${title}`, { exact: true }).fill('2026-12-10T13:00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await waitTask(rows => rows.some(row => row.title === title && row.scheduled_start === '2026-12-10T12:00:00'));
  await page.getByRole('button', { name: `Complete ${title}`, exact: true }).click();
  await waitTask(rows => rows.some(row => row.title === title && row.status === 'completed'));
  await page.reload();
  await page.getByRole('button', { name: `Reopen ${title}`, exact: true }).waitFor();
  await waitTask(rows => rows.some(row => row.title === title && row.status === 'completed' && row.scheduled_start === '2026-12-10T12:00:00' && row.scheduled_end === '2026-12-10T13:00:00'));
  checks.push({ name: 'Edited schedule and completion survive reload', status: 'PASS' });
  await page.screenshot({ path: '/evidence/manual.png', fullPage: true });
  await page.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
  await waitTask(rows => !rows.some(row => row.title === title));
  await page.reload();
  await page.getByLabel('New task title', { exact: true }).waitFor();
  if ((await tasks()).some(row => row.title === title)) throw new Error('Deleted task returned after reload');
  checks.push({ name: 'Deletion persists after reload', status: 'PASS' });
  if (errors.length) throw new Error('Browser exceptions: ' + errors.join('; '));
  if (live) {
    ai.status = 'RUNNING';
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.getByLabel('Message planning assistant', { exact: true }).fill('Create a short plan with exactly two tasks for preparing a study session on 10 December 2026: review notes and solve practice questions.');
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/chat/' && r.request().method() === 'POST', { timeout: 120000 }),
      page.getByRole('button', { name: 'Send message', exact: true }).click(),
    ]);
    ai.httpStatus = response.status();
    if (!response.ok()) throw new Error(`Live planning API returned HTTP ${response.status()}; manual task checks passed`);
    const result = await response.json();
    if (!Array.isArray(result.tasks) || result.tasks.length === 0) throw new Error('AI returned no tasks');
    await page.getByRole('link', { name: 'Task Board', exact: true }).click();
    await page.reload();
    await page.getByLabel('New task title', { exact: true }).waitFor();
    const stored = await tasks();
    for (const task of result.tasks) {
      if (!stored.some(row => row.title === task.title)) throw new Error('Generated task was not saved');
      await page.getByRole('button', { name: `Edit ${task.title}`, exact: true }).waitFor();
    }
    ai = { status: 'PASSED', httpStatus: response.status(), taskCount: result.tasks.length, scope: 'Live generation and persistence, not planning-quality evaluation' };
    checks.push({ name: 'Live Gemini plan generates and survives reload', status: 'PASS' });
  }
} catch (failure) {
  error = failure.message;
  if (ai.status === 'RUNNING') ai.status = 'FAILED';
  else if (ai.status === 'PENDING') ai.status = 'NOT_RUN';
}
try { await page.screenshot({ path: '/evidence/result.png', fullPage: true }); } catch {}
await writeFile('/evidence/result.json', JSON.stringify({ checks, error, ai, passed: !error && checks.length === (live ? 5 : 4) }));
await browser.close();
process.exitCode = error ? 1 : 0;
