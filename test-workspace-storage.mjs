import assert from 'node:assert/strict';
import { loadWorkspace, saveWorkspace, savedPage, savedReport, validRunId } from './src/workspace-storage.mjs';
const data = new Map();
const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
const report = { repository: 'owner/repo', commit: 'a'.repeat(40), checks: [], workflows: [], summary: {} };
const id = 'a21246ec-9ef6-43fd-a7f1-37798da978e7';
assert.equal(saveWorkspace('app', { page: 'report', report }, storage), true);
assert.deepEqual(savedReport(loadWorkspace('app', storage).report), report);
assert.equal(savedReport({ ...report, commit: 'main' }), null);
assert.equal(savedReport({ ...report, checks: null }), null);
assert.equal(savedPage('report', report), 'report');
assert.equal(savedPage('configure', report), 'report');
assert.equal(savedPage('report', null), 'scan');
assert.equal(savedPage('run', null, id), 'run');
assert.equal(savedPage('run', null, '../invalid'), 'scan');
assert.equal(savedPage('web', null), 'web');
assert.equal(savedPage('history', null), 'history');
assert.equal(validRunId(id), true);
assert.equal(validRunId(undefined), false);
for (const invalid of ['{', 'null', '[]']) {
  storage.setItem('reprocheck.workspace.v1.app', invalid);
  assert.deepEqual(loadWorkspace('app', storage), {});
}
const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); } };
assert.deepEqual(loadWorkspace('app', denied), {});
assert.equal(saveWorkspace('app', {}, denied), false);
console.log('PASS workspace storage: report, navigation, run identity and storage failures');
