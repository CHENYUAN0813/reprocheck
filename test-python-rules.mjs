// Test-only adapters, never imported by the app or worker.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const venv = fileURLToPath(new URL(process.platform === 'win32' ? './.venv/Scripts/python.exe' : './.venv/bin/python', import.meta.url));
function rule(action, value) {
  const result = spawnSync(process.env.REPROCHECK_PYTHON || (existsSync(venv) ? venv : 'python'), ['-m', 'backend.test_rules'], {
    cwd: root, input: JSON.stringify({ action, value }), encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Python rule test failed');
  return JSON.parse(result.stdout);
}
export const buildEvaluationDraft = value => rule('evaluation', value);
export const discoverPaperProvenance = value => rule('provenance', value);
export const suggestCandidate = value => rule('suggestion', value);
export const buildPaperWorkflowDraft = value => rule('workflow', value);
export const buildProtocolLock = value => rule('lock', value);
export const buildPaperMatrixDraft = value => rule('matrix', value);
export const scanSources = value => rule('scan', value);
