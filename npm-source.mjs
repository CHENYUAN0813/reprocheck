import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export async function prepareNpmSource(directory, config, command) {
  const checkout = join(directory, 'checkout');
  const url = `https://github.com/${config.repository}.git`;
  await command('git', ['init', checkout]);
  await command('git', ['-C', checkout, 'fetch', '--depth', '1', url, config.commit]);
  const tree = await command('git', ['-C', checkout, 'ls-tree', '-r', config.commit]);
  // shortcut: reject large trees before the command output retention limit; stream validation if larger projects are supported.
  if (tree.output.length > 500000) throw new Error('Repository tree exceeds the supported size');
  const paths = tree.output.trim().split('\n').map(line => {
    const [meta, path] = line.trim().split('\t');
    if (!/^100(?:644|755) blob [a-f0-9]{40}$/.test(meta) || !/^[\w./-]+$/.test(path)
      || path.startsWith('/') || path.split('/').some(part => ['..', '.git'].includes(part))) throw new Error('Unsupported source path, symlink or submodule');
    return path;
  });
  const prefix = config.directory === '.' ? '' : config.directory + '/';
  const manifestPath = prefix + 'package.json';
  if (!paths.includes(manifestPath)) throw new Error('Configured package.json is absent at the pinned commit');
  const manifest = JSON.parse((await command('git', ['-C', checkout, 'show', `${config.commit}:${manifestPath}`])).output);
  // npm may resolve an enclosing workspace even when its child package declares none.
  const parents = config.directory === '.' ? [] : config.directory.split('/');
  for (let depth = 0; depth < parents.length; depth++) {
    const parentPath = [...parents.slice(0, depth), 'package.json'].join('/');
    if (paths.includes(parentPath)) {
      const parent = JSON.parse((await command('git', ['-C', checkout, 'show', `${config.commit}:${parentPath}`])).output);
      if (parent.workspaces) throw new Error('This runner supports a single npm package, not workspaces');
    }
  }
  if (manifest.workspaces || manifest.packageManager && (typeof manifest.packageManager !== 'string' || !manifest.packageManager.startsWith('npm@'))) throw new Error('This runner supports a single npm package, not workspaces or other package managers');
  for (const name of [config.testScript, config.buildScript, config.startScript].filter(Boolean)) {
    if (typeof manifest.scripts?.[name] !== 'string' || !manifest.scripts[name].trim()) throw new Error(`Configured script not found: ${name}`);
  }
  if (config.install === 'ci' && !['package-lock.json', 'npm-shrinkwrap.json'].some(name => paths.includes(prefix + name))) throw new Error('npm ci requires a committed lock file');
  const archive = join(directory, 'source.tar');
  await command('git', ['-C', checkout, 'archive', '--format=tar', '--output', archive, config.commit]);
  return { archive, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') };
}
