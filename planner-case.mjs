import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const plannerCase = {
  id: 'sydney-planner', name: 'Sydney task planner · React + FastAPI + SQLite',
  repository: 'mkri3904/SOFT3888_F16_04_P28',
  url: 'https://github.sydney.edu.au/mkri3904/SOFT3888_F16_04_P28',
  commit: '49ffe892d6881f7d0e99c3cf2b5c801588bb5464',
  image: 'reprocheck-sydney-planner:1',
  scope: 'Private repository, pinned source; Demo login. Manual task acceptance and optional live Gemini acceptance are separate.',
  commands: ['pip install -r Backend/requirements.txt', 'npm ci', 'npm run build', 'uvicorn Backend.main:app --host 0.0.0.0 --port 8000', 'npm run preview -- --host 0.0.0.0 --port 5173 --strictPort'],
};

export async function preparePlannerSource(directory, command) {
  const cache = fileURLToPath(new URL('./.reprocheck/sources/planner/', import.meta.url));
  if (!existsSync(join(cache, '.git'))) {
    mkdirSync(join(cache, '..'), { recursive: true });
    await command('gh', ['repo', 'clone', plannerCase.url, cache, '--', '--depth', '1']);
  }
  const present = await command('git', ['-C', cache, 'cat-file', '-t', plannerCase.commit], { tolerate: true });
  if (present.code !== 0) {
    await command('git', ['-C', cache, 'fetch', plannerCase.url, plannerCase.commit, '--depth', '1']);
  }
  const tree = await command('git', ['-C', cache, 'ls-tree', '-r', plannerCase.commit, '--', 'Backend', 'Frontend']);
  const paths = tree.output.trim().split('\n').map(line => {
    const [metadata, path] = line.trim().split('\t');
    if (!/^100(?:644|755) blob [a-f0-9]{40}$/.test(metadata) || !/^(Backend|Frontend)\/[\w./-]+$/.test(path)
      || path.split('/').includes('..') || /(?:^|\/)\.env(?:\.|$)|\.(sqlite|db)$/i.test(path)) {
      throw new Error('Unreviewed file type in pinned project source');
    }
    return path;
  });
  const archive = join(directory, 'source.tar');
  await command('git', ['-C', cache, 'archive', '--format=tar', '--output', archive, plannerCase.commit, '--', ...paths]);
  return { archive, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') };
}

// Secret JSON arrives over stdin, never Docker arguments, Docker Config.Env or a file.
export const plannerStart = `
import json, os, subprocess, sys
config = json.load(sys.stdin)
env = dict(os.environ, AUTH_MODE='demo', DATABASE_URL='sqlite:////tmp/planner.sqlite',
           GEMINI_API_KEY=config['key'], REGENERATION_SIGNING_KEY=config['signingKey'])
with open('/tmp/app.log', 'ab') as log:
    subprocess.Popen([sys.executable, '-m', 'uvicorn', 'Backend.main:app', '--host', '0.0.0.0', '--port', '8000'],
                     cwd='/tmp/project', env=env, stdout=log, stderr=log, start_new_session=True)
`;
