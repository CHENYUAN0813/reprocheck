// Opt-in: real GitHub requests and reviewed Iris execution in bounded Docker.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startScanService } from './scan-service.mjs';
import { handleApi } from './server.mjs';
import { reviewedCaseById } from './examples/reviewed-cases.mjs';
import { getSavedRun } from './run-store.mjs';

const service = await startScanService();
let scans = 0;
const server = createServer((req, res) => handleApi(req, res, {
  request(input) { scans++; return service.request(input); },
}));
const active = new Set();
let base;
async function request(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(base + path, { method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.ok(response.ok, `${response.status}: ${result.error ?? 'API request failed'}`);
  return result;
}
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const preset = reviewedCaseById.get('bthowen-iris');
  const input = { url: `https://github.com/${preset.repository}`, commit: preset.commit,
    workflowId: 'evaluation', packageIndex: 'pypi', executionOptions: { benchmarkId: preset.id } };
  const report = await request('/api/scan', input);
  assert.equal(report.commit, preset.commit);
  assert.match(report.protocolLock.lockId, /^[a-f\d]{64}$/);
  const preview = await request('/api/preflight', input);
  assert.equal(preview.runnable, true, preview.reason);
  console.log('PASS real FastAPI scan and Docker preflight');

  const cancelled = await request('/api/run', { ...input, confirmUnknownCode: true });
  active.add(cancelled.id);
  assert.equal(cancelled.status, 'RUNNING');
  await request(`/api/runs/${cancelled.id}`, undefined, 'DELETE');
  assert.equal((await request(`/api/runs/${cancelled.id}`)).status, 'CANCELLED');
  assert.equal(getSavedRun(cancelled.id).status, 'CANCELLED');
  active.delete(cancelled.id);
  console.log(`PASS cancellation persisted: ${cancelled.id}`);

  let run = await request('/api/run', { ...input, confirmUnknownCode: true });
  active.add(run.id);
  assert.notEqual(run.id, cancelled.id);
  const deadline = Date.now() + 660_000;
  let stage;
  while (run.status === 'RUNNING' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    run = await request(`/api/runs/${run.id}`);
    if (stage !== run.currentStep?.id) {
      stage = run.currentStep?.id;
      console.log(`Stage: ${stage ?? 'container setup'}`);
    }
  }
  assert.equal(run.status, 'SUCCEEDED', `Run ${run.id}: ${run.status}; inspect saved logs`);
  active.delete(run.id);
  assert.equal(run.verification.status, 'VERIFIED');
  assert.equal(run.evaluation.status, 'MATCHED_REFERENCE');
  assert.equal(run.metric.value, 0.98);
  assert.equal(run.evaluation.output.data.correct, 49);
  assert.equal(run.evaluation.output.data.test_samples, 50);
  assert.ok(run.assets.every(asset => asset.status === 'PASSED'));
  assert.equal(run.referenceEvidence.status, 'PASSED');
  const saved = await request(`/api/runs/${run.id}?download=1`);
  assert.equal(saved.evaluation.status, 'MATCHED_REFERENCE');
  assert.equal(getSavedRun(run.id).evaluation.status, 'MATCHED_REFERENCE');
  assert.ok((await request('/api/runs')).runs.some(item => item.id === run.id));
  assert.equal(scans, 4, 'scan, preflight, initial run and retry must each use FastAPI');
  console.log(`PASS retry, persisted evidence and Iris 0.98 reference acceptance: ${run.id}`);
} finally {
  for (const id of active) await request(`/api/runs/${id}`, undefined, 'DELETE').catch(() => {});
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await service.close();
}
