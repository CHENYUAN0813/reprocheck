import assert from 'node:assert/strict';
import worker from './worker.mjs';
import { reviewedCaseById } from './examples/reviewed-cases.mjs';

const env = { SCAN_SERVICE_URL: 'https://scanner.example', SCAN_SERVICE_TOKEN: 'test-only-'.repeat(4) };
const input = { url: 'https://github.com/example/repo' };
const call = (body = input, settings = env, method = 'POST') => worker.fetch(new Request('https://reprocheck.test/api/scan', {
  method, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
}), settings);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://scanner.example/api/scan');
    assert.equal(options.headers.Authorization, `Bearer ${env.SCAN_SERVICE_TOKEN}`);
    assert.equal(options.redirect, 'error');
    const value = JSON.parse(options.body);
    assert.equal(value.secret, undefined);
    return Response.json({ repository: value.url, commit: value.pinnedCommit ?? 'a'.repeat(40) });
  };
  for (const preset of reviewedCaseById.values()) {
    const result = await call({ url: `https://github.com/${preset.repository}`, executionOptions: { benchmarkId: preset.id } });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).commit, preset.commit);
  }
  assert.equal((await call({ ...input, pinnedCommit: 'b'.repeat(40) })).status, 200);
  for (const status of [400, 502]) {
    globalThis.fetch = async () => Response.json({ error: 'scan rejected' }, { status });
    assert.equal((await call()).status, status);
  }
  for (const status of [401, 403, 500, 503]) {
    globalThis.fetch = async () => Response.json({ error: 'private diagnostic' }, { status });
    const result = await call();
    assert.equal(result.status, 502);
    assert.ok(!(await result.text()).includes('private diagnostic'));
  }
  globalThis.fetch = async () => { throw new Error('private network detail'); };
  assert.equal((await call()).status, 502);
  globalThis.fetch = async () => { assert.fail('Invalid requests must not fetch'); };
  assert.equal((await call(input, {})).status, 503);
  assert.equal((await call(input, { ...env, SCAN_SERVICE_URL: 'http://scanner.example' })).status, 503);
  assert.equal((await call(input, { ...env, SCAN_SERVICE_URL: 'not a URL' })).status, 503);
  assert.equal((await call(null)).status, 400);
  assert.equal((await call({ ...input, executionOptions: { benchmarkId: 'unknown' } })).status, 400);
  assert.equal((await call({ ...input, padding: 'x'.repeat(4096) })).status, 400);
  assert.equal((await call(undefined, env, 'GET')).status, 405);
  assert.equal((await call({ ...input, url: 'https://example.com/repo' })).status, 400);
  const preset = reviewedCaseById.values().next().value;
  assert.equal((await call({ ...input, executionOptions: { benchmarkId: preset.id }, pinnedCommit: 'f'.repeat(40) })).status, 400);
  console.log('PASS hosted Python forwarding, all presets, fixed commits, authentication header, failures and configuration gates');
} finally { globalThis.fetch = originalFetch; }
