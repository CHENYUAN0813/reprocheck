import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { startWebRun, getWebRun, cancelWebRun, validateWebRequest, webScreenshot, redactWebEvidence } from './web-runner.mjs';
import { getSavedRun } from './run-store.mjs';
import { plannerCase, preparePlannerSource } from './planner-case.mjs';

const input = { caseId: plannerCase.id, confirmUnknownCode: true };
validateWebRequest(input);
for (const invalid of [{ ...input, liveAi: 'yes' }, { ...input, geminiApiKey: 'a\nb' }, { ...input, url: 'https://example.com' }, { ...input, commit: 'other' }]) assert.throws(() => validateWebRequest(invalid));
assert.match(plannerCase.commit, /^[a-f0-9]{40}$/);
assert.equal(webScreenshot('../secret', 'manual'), null);
assert.deepEqual(redactWebEvidence({ log: 'secret-key', error: { message: 'xsecret-keyx' } }, 'secret-key'), { log: '[REDACTED]', error: { message: 'x[REDACTED]x' } });
assert.equal(redactWebEvidence({ log: 'quote"key' }, 'quote"key').log, '[REDACTED]');
assert.deepEqual(redactWebEvidence({ log: 'null', browser: null, enabled: false }, 'null'), { log: '[REDACTED]', browser: null, enabled: false });
await assert.rejects(() => preparePlannerSource('.', async (_program, args) => ({ code: 0, output: args.includes('ls-tree') ? `120000 blob ${'a'.repeat(40)}\tBackend/link\n` : '' })), /Unreviewed file type/);
console.log('PASS pinned planner config and credential input boundaries');

if (process.argv.includes('--docker')) {
  const cancelled = startWebRun(input);
  for (let i = 0; i < 60; i++) {
    const current = getWebRun(cancelled.id);
    if (current?.steps.at(-1)?.name.startsWith('Install')) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(cancelWebRun(cancelled.id).status, 'CANCELLED');
  for (let i = 0; i < 60 && getWebRun(cancelled.id)?.finishedAt == null && getWebRun(cancelled.id); i++) await new Promise(resolve => setTimeout(resolve, 500));
  const stopped = getWebRun(cancelled.id) ?? getSavedRun(cancelled.id);
  assert.equal(stopped.cleanup, 'COMPLETE');
  assert.equal(stopped.verification.status, 'INCOMPLETE');
  const job = startWebRun(input);
  let result;
  for (let i = 0; i < 620; i++) {
    result = getWebRun(job.id) ?? getSavedRun(job.id);
    if (result.finishedAt) break;
    if (i % 15 === 0) console.log(result.steps.at(-1)?.name ?? 'Preparing');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!result.finishedAt) cancelWebRun(job.id);
  assert.equal(result.status, 'SUCCEEDED', result.diagnosis + '\n' + result.log.slice(-2500));
  assert.equal(result.verification.status, 'VERIFIED');
  assert.equal(result.browser.checks.length, 4);
  assert.equal(result.browser.ai.status, 'NOT_REQUESTED');
  assert.equal(result.commit, plannerCase.commit);
  assert.match(result.sourceArchiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.cleanup, 'COMPLETE');
  assert.ok(webScreenshot(job.id, 'manual')?.length > 1000);
  assert.equal(execFileSync('docker', ['ps', '-a', '--filter', `name=reprocheck-web-${job.id}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).trim(), '');
  console.log(`PASS real private planner cancellation/retry, install, build, startup, CRUD, reload persistence, screenshots and cleanup: ${job.id}`);
}
