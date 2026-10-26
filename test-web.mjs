import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { validateWebRequest, startWebRun, getWebRun, cancelWebRun, webScreenshot, webRuntime } from './web-runner.mjs';
import { getSavedRun } from './run-store.mjs';
import worker from './worker.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const input = { caseId: 'web-notes', confirmUnknownCode: true };
validateWebRequest(input);
for (const invalid of [null, {}, { ...input, confirmUnknownCode: false }, { ...input, caseId: '../../other' }, { ...input, command: 'anything' }]) {
  assert.throws(() => validateWebRequest(invalid));
}
assert.equal(webScreenshot('../secret'), null);
assert.equal(cancelWebRun('missing'), null);
assert.equal((await worker.fetch(new Request('https://example.com/api/web'), {})).status, 501);
console.log('PASS web request validation and hosted boundary');

if (process.argv.includes('--docker')) {
  assert.equal((await webRuntime()).available, true, 'Run npm run setup:web first');
  async function completed(id) {
    for (let i = 0; i < 180; i++) {
      const job = getWebRun(id) ?? getSavedRun(id);
      if (job.finishedAt) return job;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    cancelWebRun(id); throw new Error('Web verification did not finish in 3 minutes');
  }
  const cancelled = startWebRun(input);
  assert.throws(() => startWebRun(input), /already running/);
  assert.equal(cancelWebRun(cancelled.id).status, 'CANCELLED');
  const stopped = await completed(cancelled.id);
  assert.equal(stopped.status, 'CANCELLED');
  assert.equal(stopped.verification.status, 'INCOMPLETE');
  const retry = startWebRun(input);
  const result = await completed(retry.id);
  assert.equal(result.status, 'SUCCEEDED', result.diagnosis + '\n' + result.log);
  assert.equal(result.verification.status, 'VERIFIED');
  assert.equal(result.browser.checks.length, 4);
  assert.equal(result.cleanup, 'COMPLETE');
  assert.ok(webScreenshot(result.id)?.length > 1000);
  assert.ok(result.commit.startsWith('sha256:'));
  // Snapshot is copied synchronously; restore the tracked fixture before Docker starts.
  const frontend = new URL('./examples/web-notes/index.html', import.meta.url);
  const original = readFileSync(frontend, 'utf8');
  let broken;
  try {
    writeFileSync(frontend, original.replace('<button>Add note</button>', '<button>Broken action</button>'));
    broken = startWebRun(input);
  } finally { writeFileSync(frontend, original); }
  const failed = await completed(broken.id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.verification.status, 'FAILED');
  assert.equal(failed.browser.passed, false);
  assert.notEqual(failed.commit, result.commit);
  assert.ok(webScreenshot(failed.id));
  assert.equal(failed.cleanup, 'COMPLETE');
  for (const id of [cancelled.id, retry.id, broken.id]) {
    assert.equal(execFileSync('docker', ['ps', '-a', '--filter', `name=reprocheck-web-${id}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).trim(), '');
  }
  console.log(`PASS Docker cancellation, clean retry, four browser assertions, negative browser case, screenshot, history and cleanup: ${result.id}`);
}
