import assert from 'node:assert/strict';
import { npmDraft, npmPlan, npmCommands, validateNpmConfig } from './npm-config.mjs';
import { prepareNpmSource } from './npm-source.mjs';
import { validateWebRequest, startWebRun, getWebRun, cancelWebRun, webScreenshot } from './web-runner.mjs';
import { getSavedRun } from './run-store.mjs';

const config = { schemaVersion: 1, repository: 'CHENYUAN0813/rumor-control', commit: 'b4775b30554f00b1deb9051279fc4facbd7d8ba0', directory: '.', install: 'ci', testScript: 'test', buildScript: 'build', startScript: 'dev', startArgs: ['--host', '0.0.0.0', '--port', '5173', '--strictPort'], port: 5173, path: '/', expectedText: '' };
const input = { caseId: 'npm-project', config, confirmUnknownCode: true };
validateWebRequest(input);
assert.deepEqual(validateNpmConfig(JSON.parse(JSON.stringify(config))), config);
for (const patch of [{ repository: [config.repository] }, { repository: '../other' }, { commit: [config.commit] }, { startScript: ['dev'] }, { directory: '../secret' }, { directory: '.git' }, { startScript: 'dev;echo secret' }, { startArgs: ['line\nnew'] }, { port: 80 }, { port: '5173' }, { path: '//example.com' }, { path: '/x?redirect=external' }, { unknown: true }]) assert.throws(() => validateNpmConfig({ ...config, ...patch }));
assert.throws(() => validateWebRequest({ ...input, confirmUnknownCode: false }));
assert.throws(() => validateWebRequest({ ...input, geminiApiKey: 'not-allowed' }));
const draft = npmDraft(config, { directory: '.', lockValid: true, scripts: [{ name: 'dev', command: 'vite' }, { name: 'test', command: 'node --test' }, { name: 'build', command: 'vite build' }] });
assert.deepEqual(draft, config);
assert.equal(npmCommands(config).length, 4);
const entry = path => `100644 blob ${'a'.repeat(40)}\t${path}\n`;
const manifest = { scripts: { dev: 'vite', test: 'node --test', build: 'vite build' } };
function mock(tree, pkg = manifest) { return async (_program, args) => ({ output: args.includes('ls-tree') ? tree : args.includes('show') ? JSON.stringify(pkg) : '' }); }
await assert.rejects(prepareNpmSource('.', config, mock(`120000 blob ${'a'.repeat(40)}\tlink\n`)), /symlink/);
await assert.rejects(prepareNpmSource('.', config, mock('x'.repeat(500001))), /size/);
await assert.rejects(prepareNpmSource('.', config, mock(entry('package.json'))), /lock file/);
await assert.rejects(prepareNpmSource('.', config, mock(entry('package.json'), { ...manifest, workspaces: ['apps/*'] })), /single npm/);
await assert.rejects(prepareNpmSource('.', config, mock(entry('package.json'), { scripts: { dev: 'vite' } })), /script not found/);
await assert.rejects(prepareNpmSource('.', { ...config, directory: 'apps/web' }, async (_program, args) => ({ output: args.includes('ls-tree') ? entry('package.json') + entry('apps/web/package.json') : args.includes('show') ? JSON.stringify(args.at(-1).endsWith(':package.json') ? { workspaces: ['apps/*'] } : manifest) : '' })), /workspaces/);
const planPkg = { directory: '.', lockValid: true, scripts: [{ name: 'dev', command: 'vite' }, { name: 'start', command: 'node server.js' }, { name: 'test', command: 'node --test' }, { name: 'build', command: 'vite build' }] };
const readmeReport = commands => ({ ...config, nodeProject: { manifestsFound: 1, commands: commands.map((command, i) => ({ command, evidence: { file: 'README.md', line: i + 1 } })) } });
const fromReadme = npmPlan(readmeReport(['npm install', 'npm run dev -- --port 5180 --host 0.0.0.0', 'npm test']), planPkg);
assert.equal(fromReadme.config.install, 'install');
assert.equal(fromReadme.config.port, 5180);
assert.equal(fromReadme.sources.startScript.evidence.line, 2);
assert.equal(npmPlan(readmeReport(['npm run dev', 'npm start']), planPkg).config.startScript, '');
assert.equal(npmPlan(readmeReport(['npm run missing', 'npm install && curl evil']), planPkg).warnings.length, 2);
assert.equal(npmPlan(readmeReport(['npm ci']), { ...planPkg, lockValid: false }).sources.install, undefined);
assert.equal(npmPlan(readmeReport(['npm start']), { ...planPkg, directory: 'app/' }).sources.startScript, undefined);
assert.equal(npmPlan({ ...readmeReport(['npm start']), nodeProject: { ...readmeReport(['npm start']).nodeProject, manifestsFound: 2 } }, planPkg).sources.startScript, undefined);
assert.equal(npmPlan(readmeReport(['npm.cmd run dev']), planPkg).sources.startScript.evidence.file, 'README.md');
console.log('PASS npm configuration, pinned source and declaration boundaries');

if (process.argv.includes('--docker')) {
  async function finished(id) {
    for (let i = 0; i < 660; i++) {
      const result = getWebRun(id) ?? getSavedRun(id);
      if (result.finishedAt) return result;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    cancelWebRun(id); throw new Error('Docker run exceeded deadline');
  }
  const cancelled = startWebRun(input);
  cancelWebRun(cancelled.id);
  assert.equal((await finished(cancelled.id)).cleanup, 'COMPLETE');
  const second = { ...config, repository: 'amannn/vite-react-starter', commit: '730072fb4865d1a7c71fbdba0d403161914b47e9', testScript: '' };
  for (const current of [config, second]) {
    const job = startWebRun({ ...input, config: current });
    console.log('RUN', current.repository, job.id);
    const result = await finished(job.id);
    assert.equal(result.status, 'SUCCEEDED', result.diagnosis + '\n' + result.log);
    assert.equal(result.verification.status, 'VERIFIED');
    assert.equal(result.cleanup, 'COMPLETE');
    assert.equal(result.browser.checks.length, 3);
    assert.deepEqual(result.npmConfig, current);
    assert.ok(webScreenshot(result.id)?.length > 1000);
    assert.equal(result.steps.find(step => step.name === 'Project tests').status, current.testScript ? 'SUCCEEDED' : 'SKIPPED');
    console.log('PASS install/tasks/readiness/browser/persist/cleanup', result.id);
  }
  const failed = await finished(startWebRun({ ...input, config: { ...second, expectedText: 'REPROCHECK_EXPECTED_TEXT_MUST_NOT_EXIST_94f8a' } }).id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.verification.status, 'FAILED');
  assert.equal(failed.cleanup, 'COMPLETE');
  console.log('PASS unmatched browser condition fails, never reports verified:', failed.id);
}
