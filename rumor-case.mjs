import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { rumorCase } from './examples/rumor-control.mjs';
export { rumorCase };

export async function prepareRumorSource(directory, command) {
  const cache = fileURLToPath(new URL('./.reprocheck/sources/rumor/', import.meta.url));
  if (!existsSync(join(cache, '.git'))) {
    mkdirSync(join(cache, '..'), { recursive: true });
    await command('git', ['clone', '--depth', '1', rumorCase.url, cache]);
  }
  const present = await command('git', ['-C', cache, 'cat-file', '-t', rumorCase.commit], { tolerate: true });
  if (present.code !== 0) await command('git', ['-C', cache, 'fetch', rumorCase.url, rumorCase.commit, '--depth', '1']);
  const tree = await command('git', ['-C', cache, 'ls-tree', '-r', rumorCase.commit]);
  const paths = tree.output.trim().split('\n').map(line => {
    const [metadata, path] = line.trim().split('\t');
    if (!/^100(?:644|755) blob [a-f0-9]{40}$/.test(metadata) || !/^[\w./-]+$/.test(path)
      || path.startsWith('/') || path.split('/').includes('..') || /(?:^|\/)\.env(?:\.|$)/i.test(path)) throw new Error('Unreviewed file type in pinned rumor source');
    return path;
  });
  const archive = join(directory, 'source.tar');
  await command('git', ['-C', cache, 'archive', '--format=tar', '--output', archive, rumorCase.commit, '--', ...paths]);
  return { archive, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') };
}
