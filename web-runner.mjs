import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { saveRun } from './run-store.mjs';
import { validateNpmConfig, npmCommands, npmScope } from './npm-config.mjs';
import { prepareNpmSource } from './npm-source.mjs';
import { plannerCase, preparePlannerSource, plannerStart } from './planner-case.mjs';
import { rumorCase, prepareRumorSource } from './rumor-case.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));
const image = 'reprocheck-web-browser:1';
const files = ['package.json', 'package-lock.json', 'server.ts', 'index.html'];
const active = new Map();
const credentials = new Map();
const LOG_LIMIT = 900_000;
export const webCase = {
  id: 'web-notes', name: 'Persistent notes · JS + TypeScript + SQLite',
  scope: 'Built-in acceptance fixture, not a third-party repository or paper reproduction.',
  commands: ['npm ci --no-audit --no-fund', 'npm start'],
  checks: ['Frontend loads', 'Create note through API', 'Reload and find note', 'Read note from API'],
};
export const webCases = [webCase, plannerCase, rumorCase];

export function validateWebRequest(input) {
  if (input?.caseId === 'npm-project') {
    if (Object.keys(input).some(key => !['caseId', 'config', 'confirmUnknownCode'].includes(key)) || input.confirmUnknownCode !== true) throw new Error('Explicit npm execution confirmation is required');
    validateNpmConfig(input.config);
    return;
  }
  if (!input || Object.keys(input).some(key => !['caseId', 'confirmUnknownCode', 'liveAi', 'geminiApiKey'].includes(key))
    || !webCases.some(item => item.id === input.caseId) || input.confirmUnknownCode !== true
    || (input.liveAi !== undefined && typeof input.liveAi !== 'boolean')
    || (input.geminiApiKey !== undefined && (typeof input.geminiApiKey !== 'string' || input.geminiApiKey.length > 512 || /[\r\n\0]/.test(input.geminiApiKey)))) {
    throw new Error('Choose a reviewed web case and explicitly confirm execution. Custom commands are not accepted.');
  }
  if (input.caseId !== plannerCase.id && (input.liveAi || input.geminiApiKey)) throw new Error('Only the planner case accepts live AI credentials');
  if (input.liveAi && !(input.geminiApiKey?.trim() || process.env.GEMINI_API_KEY)) throw new Error('A Gemini API key is required for live AI acceptance');
}

function log(job, text) {
  job.log += text;
  if (job.log.length > LOG_LIMIT) { job.log = job.log.slice(-LOG_LIMIT); job.logTruncated = true; }
}

function command(program, args, job = null, { timeout = 60_000, tolerate = false, input = null } = {}) {
  if (job && job.status !== 'RUNNING') return Promise.reject(new Error('Run is no longer active'));
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (input !== null) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    if (job) job.child = child;
    let output = '';
    let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, timeout);
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', chunk => { output = (output + chunk).slice(-LOG_LIMIT); if (job) log(job, chunk); });
    }
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (job?.child === child) job.child = null;
      if (!expired && (code === 0 || tolerate)) resolve({ code, output });
      else reject(new Error(expired ? `${program} operation timed out` : `${program} exited ${code}: ${output.slice(-1000)}`));
    });
  });
}
const docker = (args, job, options) => command('docker', args, job, options);

function record(job) {
  const { child, done, ...value } = job;
  const key = credentials.get(job.id);
  return redactWebEvidence(value, key);
}
export function redactWebEvidence(value, key) {
  // Replace string values only; a key such as "null" must not corrupt JSON syntax.
  return key ? JSON.parse(JSON.stringify(value, (_name, field) => typeof field === 'string' ? field.replaceAll(key, '[REDACTED]') : field)) : value;
}
function persist(job) {
  try { saveRun(record(job)); } catch (error) { job.persistenceError = error.message; }
}
export const getWebRun = id => active.has(id) ? record(active.get(id)) : null;
export const listWebRuns = () => [...active.values()].map(record);
export function cancelWebRun(id) {
  const job = active.get(id);
  if (!job) return null;
  if (job.status === 'RUNNING') {
    job.status = 'CANCELLED';
    job.child?.kill();
    persist(job);
  }
  return record(job);
}

export async function webRuntime() {
  try {
    const inspection = await docker(['image', 'inspect', image]);
    const rumorAvailable = JSON.parse(inspection.output)[0]?.Config?.Labels?.['org.reprocheck.rumor-acceptance'] === '1';
    const planner = await docker(['image', 'inspect', plannerCase.image], null, { tolerate: true });
    return { available: true, image, plannerAvailable: planner.code === 0, rumorAvailable, npmAvailable: JSON.parse(inspection.output)[0]?.Config?.Labels?.['org.reprocheck.npm-acceptance'] === '1' };
  } catch {
    return { available: false, image, reason: 'Start Docker Desktop, then run npm run setup:web once to install the browser image.' };
  }
}

async function execute(job, snapshot) {
  const planner = job.workflowId === plannerCase.id;
  const rumor = job.workflowId === rumorCase.id;
  const npm = job.workflowId === 'npm-project';
  const config = job.npmConfig;
  const working = npm && config.directory !== '.' ? '/tmp/project/' + config.directory : '/tmp/project';
  const remote = planner || rumor || npm;
  const app = `reprocheck-web-${job.id}`;
  const tester = `${app}-browser`;
  const directory = join(root, '.reprocheck', 'web', job.id);
  const source = join(directory, 'source');
  let step;
  const checkpoint = () => { if (job.status !== 'RUNNING') throw new Error('Run cancelled'); };
  const stage = async (name, operation) => {
    checkpoint();
    step = { name, status: 'RUNNING' }; job.steps.push(step); persist(job);
    await operation(); checkpoint(); step.status = 'SUCCEEDED'; persist(job);
  };
  const heartbeat = setInterval(() => persist(job), 1000);
  const deadline = setTimeout(() => { job.status = 'TIMED_OUT'; job.child?.kill(); }, 600_000);
  try {
    mkdirSync(source, { recursive: true });
    let archive;
    if (remote) await stage(planner ? 'Fetch pinned private source on host' : 'Fetch pinned public source on host', async () => {
      const runCommand = (program, args, options) => command(program, args, job, options);
      const result = npm ? await prepareNpmSource(directory, config, runCommand) : await (planner ? preparePlannerSource : prepareRumorSource)(directory, runCommand);
      archive = result.archive; job.sourceArchiveSha256 = result.sha256;
    });
    else for (const [name, content] of snapshot) writeFileSync(join(source, name), content);
    await stage('Prepare isolated environment', async () => {
      const inspection = await docker(['image', 'inspect', planner ? plannerCase.image : image, '--format', '{{.Id}}'], job);
      job.imageId = inspection.output.trim();
      job.browserImageId = (await docker(['image', 'inspect', image, '--format', '{{.Id}}'], job)).output.trim();
      await docker(['run', '-d', '--name', app, '--init', '--cpus', '2', '--memory', remote ? '2g' : '1g', '--pids-limit', '256',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--network', remote ? 'bridge' : 'none',
        '--workdir', '/tmp', job.imageId, 'timeout', '600', 'sleep', '600'], job);
      if (remote) {
        await docker(['cp', archive, `${app}:/tmp/source.tar`], job);
        await docker(['exec', app, 'sh', '-c', 'mkdir /tmp/project && tar --no-same-owner -xf /tmp/source.tar -C /tmp/project'], job);
      } else {
        await docker(['cp', source, `${app}:/tmp/source`], job);
        // Copy as the unprivileged runtime user; do not restore CHOWN capabilities.
        await docker(['exec', app, 'node', '-e', "require('node:fs').cpSync('/tmp/source','/tmp/project',{recursive:true})"], job);
      }
    });
    if (planner) {
      await stage('Install Python and locked npm dependencies; build frontend', async () => {
        await docker(['exec', '-w', '/tmp/project', app, 'sh', '-c', 'python -m venv /tmp/venv && /tmp/venv/bin/pip install --disable-pip-version-check -r Backend/requirements.txt python-dotenv requests && /tmp/venv/bin/pip freeze'], job, { timeout: 240_000 });
        await docker(['exec', '-w', '/tmp/project/Frontend', app, 'sh', '-c', 'npm ci --no-audit --no-fund && npm run build'], job, { timeout: 180_000 });
        if (!job.liveAi) await docker(['network', 'disconnect', 'bridge', app], job);
      });
    } else if (npm) {
      await stage('Install npm dependencies', () => docker(['exec', '-w', working, app, 'npm', config.install, '--no-audit', '--no-fund'], job, { timeout: 240_000 }));
      await docker(['network', 'disconnect', 'bridge', app], job);
      for (const [name, script] of [['Project tests', config.testScript], ['Project build', config.buildScript]]) {
        if (script) await stage(name, () => docker(['exec', '-w', working, app, 'npm', 'run', script], job, { timeout: 180_000 }));
        else { job.steps.push({ name, status: 'SKIPPED', reason: 'No script configured; not verified' }); persist(job); }
      }
    } else if (rumor) {
      await stage('Install locked dependencies', () => docker(['exec', '-w', '/tmp/project', app, 'npm', 'ci', '--no-audit', '--no-fund'], job, { timeout: 240_000 }));
      await docker(['network', 'disconnect', 'bridge', app], job);
      for (const task of ['test', 'lint', 'build']) await stage(`Run npm ${task}`, () => docker(['exec', '-w', '/tmp/project', app, 'npm', 'run', task], job, { timeout: 180_000 }));
    } else await stage('Install locked dependencies', () => docker(['exec', '-w', '/tmp/project', app, 'npm', 'ci', '--no-audit', '--no-fund'], job, { timeout: 120_000 }));
    await stage(npm ? 'Start configured service; wait for readiness' : 'Start frontend and API; wait for readiness', async () => {
      if (npm) {
        await docker(['exec', '-d', '-w', working, app, 'node', '-e', "const fs=require('node:fs');const child=require('node:child_process').spawn('npm',JSON.parse(process.argv[1]),{stdio:['ignore',fs.openSync('/tmp/app.log','a'),fs.openSync('/tmp/app.log','a')]});child.on('exit',code=>process.exit(code??1));", JSON.stringify(['run', config.startScript, '--', ...config.startArgs])], job);
      } else if (planner) {
        await docker(['exec', '-i', app, '/tmp/venv/bin/python', '-c', plannerStart], job, { input: JSON.stringify({ key: credentials.get(job.id) ?? 'offline-placeholder-no-provider-access', signingKey: randomUUID() + randomUUID() }) });
        await docker(['exec', '-d', '-w', '/tmp/project/Frontend', app, 'sh', '-c', 'npm run preview -- --host 0.0.0.0 --port 5173 --strictPort > /tmp/frontend.log 2>&1'], job);
      } else await docker(['exec', '-d', '-w', '/tmp/project', app, 'sh', '-c', rumor ? 'npm run dev -- --host 0.0.0.0 --port 5173 --strictPort > /tmp/app.log 2>&1' : 'npm start > /tmp/app.log 2>&1'], job);
      await docker(['exec', app, 'node', '--input-type=module', '-e',
        npm ? `for(let i=0;i<60;i++){try{if((await fetch(${JSON.stringify("http://127.0.0.1:" + config.port + config.path)},{signal:AbortSignal.timeout(1000)})).ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,500))}process.exit(1)` : rumor ? "for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:5173/')).ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,500))}process.exit(1)" : planner ? "for(let i=0;i<60;i++){try{const a=await fetch('http://127.0.0.1:8000/health');const b=await fetch('http://127.0.0.1:5173/');if(a.ok&&b.ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,500))}process.exit(1)" : "for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:3000/health');if(r.status===200 && await r.text()==='ready')process.exit(0)}catch{}await new Promise(r=>setTimeout(r,500))}process.exit(1)"], job);
    });
    await stage('Browser acceptance', async () => {
      // Separate filesystem: application code cannot write the browser's evidence files.
      await docker(['run', '--name', tester, '--init', '--cpus', '2', '--memory', '1g', '--pids-limit', '256',
        '--shm-size', '256m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--network', `container:${app}`, job.browserImageId, 'timeout', '240', 'node', npm ? '/opt/browser/npm-browser.mjs' : rumor ? '/opt/browser/rumor-browser.mjs' : planner ? '/opt/browser/planner-browser.mjs' : '/opt/browser/browser.mjs', ...(npm ? [JSON.stringify({ port: config.port, path: config.path, expectedText: config.expectedText })] : job.liveAi ? ['--live'] : [])], job, { timeout: 260_000, tolerate: true });
      await docker(['cp', `${tester}:/evidence/result.json`, join(directory, 'result.json')], job);
      const evidence = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
      job.browser = evidence;
      await docker(['cp', `${tester}:/evidence/result.png`, join(directory, 'result.png')], job);
      job.screenshot = `/api/web/runs/${job.id}/screenshot`;
      if (planner) {
        const copied = await docker(['cp', `${tester}:/evidence/manual.png`, join(directory, 'manual.png')], null, { tolerate: true });
        if (copied.code === 0) job.manualScreenshot = `/api/web/runs/${job.id}/screenshot?stage=manual`;
      }
      if (evidence.passed !== true || evidence.checks?.length !== (npm ? 3 : job.liveAi ? 5 : 4) || evidence.checks.some(check => check.status !== 'PASS')) {
        job.verification = { status: 'FAILED', scope: 'Browser assertions did not pass.' };
        throw new Error(evidence.error || 'Browser assertions did not pass');
      }
    });
    job.status = 'SUCCEEDED';
    job.verification = { status: 'VERIFIED', scope: npm ? npmScope : rumor ? rumorCase.scope : planner ? 'Recorded task operations and optional live generation/persistence; not Google login or AI quality.' : 'Only the four recorded browser assertions on the bundled notes application.' };
  } catch (error) {
    if (job.status === 'RUNNING') job.status = 'FAILED';
    if (step?.status === 'RUNNING') step.status = job.status;
    job.diagnosis = error.message;
  } finally {
    clearTimeout(deadline); clearInterval(heartbeat);
    try { const result = await docker(['exec', app, 'cat', '/tmp/app.log'], null, { tolerate: true }); log(job, '\nApplication log:\n' + result.output); } catch {}
    if (planner) try { const result = await docker(['exec', app, 'cat', '/tmp/frontend.log'], null, { tolerate: true }); log(job, '\nFrontend log:\n' + result.output); } catch {}
    try {
      await docker(['rm', '-f', tester, app], null, { tolerate: true });
      const remaining = await docker(['ps', '-a', '--filter', `name=${app}`, '--format', '{{.Names}}']);
      job.cleanup = remaining.output.trim() ? 'FAILED' : 'COMPLETE';
      if (job.cleanup === 'FAILED') job.cleanupError = 'Containers remain: ' + remaining.output;
    } catch (error) { job.cleanup = 'FAILED'; job.cleanupError = error.message; }
    job.finishedAt = new Date().toISOString(); persist(job);
    Object.assign(job, record(job));
    credentials.delete(job.id);
    if (!job.persistenceError) active.delete(job.id);
  }
}

export function startWebRun(input) {
  validateWebRequest(input);
  if (active.size) throw new Error('A web verification is already running or cleaning up');
  const planner = input.caseId === plannerCase.id;
  const rumor = input.caseId === rumorCase.id;
  const npm = input.caseId === 'npm-project';
  const config = npm ? validateNpmConfig(input.config) : null;
  const selected = npm ? { repository: config.repository, commit: config.commit, commands: npmCommands(config) } : webCases.find(item => item.id === input.caseId);
  const snapshot = planner || rumor || npm ? [] : files.map(name => [name, readFileSync(join(root, 'examples', 'web-notes', name))]);
  const hash = createHash('sha256');
  for (const [name, bytes] of snapshot) hash.update(name).update('\0').update(bytes);
  const job = { schemaVersion: 1, kind: 'web', id: randomUUID(), repository: selected.repository ?? 'Built-in / web-notes',
    commit: selected.commit ?? `sha256:${hash.digest('hex')}`, workflowId: input.caseId, status: 'RUNNING', liveAi: planner && input.liveAi === true,
    startedAt: new Date().toISOString(), finishedAt: null, steps: [], log: '', logTruncated: false,
    limits: { cpus: '2 per container', memory: planner || rumor || npm ? '2g app / 1g browser' : '1g per container', timeoutMinutes: 10 },
    verification: { status: 'INCOMPLETE' }, recipeUnavailableReason: 'Web fixture runs use a source snapshot and browser assertions, not a Python experiment recipe.',
    ...(npm ? { npmConfig: config } : {}),
    commands: selected.commands, cleanup: 'PENDING', browser: null };
  if (job.liveAi) credentials.set(job.id, input.geminiApiKey?.trim() || process.env.GEMINI_API_KEY);
  active.set(job.id, job); persist(job);
  job.done = execute(job, snapshot);
  return record(job);
}

export function webScreenshot(id, stage = null) {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) return null;
  try { return readFileSync(join(root, '.reprocheck', 'web', id, stage === 'manual' ? 'manual.png' : 'result.png')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
