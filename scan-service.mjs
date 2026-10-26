import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('.', import.meta.url));
const venvPython = fileURLToPath(new URL(process.platform === 'win32' ? './.venv/Scripts/python.exe' : './.venv/bin/python', import.meta.url));

export async function startScanService() {
  const child = spawn(process.env.REPROCHECK_PYTHON || (existsSync(venvPython) ? venvPython : 'python'), ['-m', 'backend'], {
    cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, REPROCHECK_NODE: process.execPath, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
  });
  let port, failed = false, exited = false;
  child.on('error', () => { failed = true; });
  child.on('exit', () => { exited = true; });
  let output = '';
  child.stdout.on('data', chunk => {
    output = (output + chunk).slice(-2000);
    port = Number(output.match(/REPROCHECK_SCAN_PORT=(\d+)/)?.[1]) || port;
  });
  // Never forward child diagnostics that could include local configuration.
  child.stderr.resume();
  child.stdin.on('error', () => {});
  const close = async () => {
    child.stdin.end();
    for (let i = 0; i < 100 && !exited && !failed; i++) await delay(100);
    if (!exited && !failed) child.kill();
  };
  const parentExit = () => child.stdin.end();
  process.once('exit', parentExit);
  child.once('exit', () => process.removeListener('exit', parentExit));
  for (let i = 0; i < 150 && !failed && !exited; i++) {
    if (port) {
      try {
        const result = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
        if (result.ok && (await result.json()).backend === 'fastapi') {
          return { port, close, request: async input => {
            try {
              const result = await fetch(`http://127.0.0.1:${port}/api/scan`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
                signal: AbortSignal.timeout(185_000),
              });
              return { status: result.status, body: await result.json() };
            } catch {
              return { status: 502, body: { error: 'Python scan service unavailable; restart the local server' } };
            }
          } };
        }
      } catch { /* Wait for Uvicorn to start listening on its reserved port. */ }
    }
    await delay(100);
  }
  await close();
  throw new Error('Unable to start FastAPI scanning. Install Python 3.11+ and run: python -m pip install -r backend/requirements.txt (or set REPROCHECK_PYTHON).');
}
