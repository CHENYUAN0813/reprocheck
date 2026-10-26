import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewedCaseById, validateExecutionOptions } from './runner.mjs';
import { startScanService } from './scan-service.mjs';
import { handleApi } from './server.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const venv = join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const python = process.env.REPROCHECK_PYTHON || (existsSync(venv) ? venv : 'python');
const fixtures = JSON.parse(readFileSync(new URL('./test-fixtures/scan-contracts.json', import.meta.url)));
const originalFetch = globalThis.fetch;
const directory = mkdtempSync(join(tmpdir(), 'reprocheck-fastapi-'));
try {
  const fixturePath = join(directory, 'fixtures.json');
  writeFileSync(fixturePath, JSON.stringify(fixtures));
  const result = spawnSync(python, ['-m', 'backend.test_scan', fixturePath], { cwd: root, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, REPROCHECK_NODE: process.execPath, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }, timeout: 120_000 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.equal(result.status, 0, 'Python scanner contract/parity tests');

  const service = await startScanService();
  const server = createServer((request, response) => handleApi(request, response, service));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/scan`;
    for (const endpoint of ['scan', 'preflight', 'run']) {
      for (const input of [{ url: 'https://example.com/a/b' }, { url: 'https://github.com/a/b', executionOptions: { benchmarkId: 'unknown' } }]) {
        const result = await fetch(url.replace('/scan', `/${endpoint}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        assert.equal(result.status, 400);
        assert.equal(result.headers.get('cache-control'), 'no-store');
        assert.ok((await result.json()).error);
      }
    }
    const rejected = await fetch(url, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(rejected.status, 403);
    await service.close();
    for (const endpoint of ['scan', 'preflight', 'run']) {
      assert.equal((await fetch(url.replace('/scan', `/${endpoint}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 502);
    }
    console.log('PASS FastAPI service startup, local gateway, origin gate, shutdown and unavailable-service response');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await service.close();
  }

  // Exercise successful report forwarding without executing any repository code.
  let scanResult, received;
  const routing = createServer((request, response) => handleApi(request, response, {
    request: async input => { received = input; return scanResult; },
  }));
  try {
    await new Promise(resolve => routing.listen(0, '127.0.0.1', resolve));
    globalThis.fetch = (url, options) => {
      assert.ok(String(url).startsWith('http://127.0.0.1:'), 'Execution routes must not invoke the legacy GitHub scanner');
      return originalFetch(url, options);
    };
    const post = (endpoint, input) => fetch(`http://127.0.0.1:${routing.address().port}/api/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    for (const fixture of fixtures.filter(item => ['evaluation', 'saved-experiment', ...reviewedCaseById.keys()].includes(item.name))) {
      scanResult = { status: 200, body: fixture.expected };
      const preset = reviewedCaseById.get(fixture.name);
      const input = { ...fixture.input, commit: fixture.expected.commit,
        workflowId: preset ? preset.matrix ? 'paper-matrix' : preset.training ? 'training' : 'evaluation' : fixture.name === 'saved-experiment' ? 'training' : 'quick',
        executionOptions: fixture.input.executionOptions ?? { quickEntryId: fixture.expected.quickEntries[0].id } };
      const preflight = await post('preflight', input);
      assert.equal(preflight.status, 200, `${fixture.name}: ${await preflight.clone().text()}`);
      assert.equal((await preflight.json()).commit, input.commit);
      assert.deepEqual(received, input, 'Forward preset/config and commit without altering the request');
      const run = await post('run', input);
      assert.equal(run.status, 400);
      assert.match((await run.json()).error, /Explicit confirmation/);
      for (const endpoint of ['preflight', 'run']) {
        const changed = await post(endpoint, { ...input, commit: 'f'.repeat(40) });
        assert.equal(changed.status, 409);
        assert.match((await changed.json()).error, /changed after scanning/);
        const missing = await post(endpoint, { ...input, commit: undefined });
        assert.equal(missing.status, 400);
        assert.match((await missing.json()).error, /scanned commit is required/);
      }
    }
    for (const status of [400, 500, 502]) {
      scanResult = { status, body: { error: 'Scan service rejected request' } };
      for (const endpoint of ['scan', 'preflight', 'run']) {
        const rejected = await post(endpoint, { url: 'https://github.com/example/repo', confirmUnknownCode: true });
        assert.equal(rejected.status, status);
        assert.deepEqual(await rejected.json(), scanResult.body);
      }
    }
    console.log('PASS preflight/run reuse scan reports for presets and saved experiments; commit/consent gates and scan errors preserved without legacy fallback');
  } finally {
    globalThis.fetch = originalFetch;
    routing.closeAllConnections();
    await new Promise(resolve => routing.close(resolve));
  }
} finally {
  globalThis.fetch = originalFetch;
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  rmSync(directory, { recursive: true, force: true });
}
