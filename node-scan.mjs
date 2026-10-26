// Static declarations only: npm scripts never enter the Python execution workflows.
const excluded = /(?:^|\/)(?:node_modules|vendor|\.git|\.venv|dist|build)\//;
export const projectFiles = paths => paths.filter(path => !excluded.test(path));
export const packagePaths = paths => projectFiles(paths).filter(path => /(?:^|\/)package\.json$/.test(path))
  .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

export function detectProjectType(paths, pythonDependencies) {
  const files = projectFiles(paths);
  const node = packagePaths(files).length > 0 || files.some(path => /\.(?:[cm]?[jt]sx?)$/.test(path));
  const python = projectFiles(pythonDependencies).length > 0 || files.some(path => /\.(?:py|ipynb)$/.test(path));
  return python ? node ? 'mixed' : 'python' : node ? 'node' : 'unknown';
}

function parseObject(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
  return value;
}

export async function scanNodeProject(filePaths, readme, readmeText, readFile) {
  const all = packagePaths(filePaths);
  const checks = [];
  const add = (id, status, message, file, suggestion = null) => checks.push({ id: `${id}:${checks.length}`, status, message, evidence: file ? { file } : null, suggestion });
  const packages = await Promise.all(all.slice(0, 5).map(async path => {
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    let manifest;
    try { manifest = parseObject(await readFile(path)); }
    catch (error) {
      if (!(error instanceof SyntaxError) && error.message !== 'Expected JSON object') throw error;
      return { path, directory: directory || '.', error: 'Invalid package.json', scripts: [] };
    }
    const lockPath = ['npm-shrinkwrap.json', 'package-lock.json'].map(name => directory + name).find(name => filePaths.includes(name));
    let lockValid = false;
    if (lockPath) {
      try {
        const lock = parseObject(await readFile(lockPath));
        lockValid = [1, 2, 3].includes(lock.lockfileVersion) && !!(lock.packages || lock.dependencies);
      } catch (error) { if (!(error instanceof SyntaxError) && error.message !== 'Expected JSON object') throw error; }
    }
    const versionPath = ['.nvmrc', '.node-version'].map(name => directory + name).find(name => filePaths.includes(name));
    const version = versionPath ? (await readFile(versionPath)).trim() : typeof manifest.engines?.node === 'string' ? manifest.engines.node : null;
    const manager = typeof manifest.packageManager === 'string' ? manifest.packageManager : null;
    const otherManager = manager && !manager.startsWith('npm@') || ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'].some(name => filePaths.includes(directory + name));
    const scripts = Object.entries(manifest.scripts && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts) ? manifest.scripts : {})
      .filter(([, command]) => typeof command === 'string' && command.trim())
      .map(([name, command]) => ({ name, command, invocation: !otherManager && /^[\w:.-]+$/.test(name) ? `npm run ${name}` : null,
        kind: ['dev', 'start', 'preview'].includes(name) ? 'service' : ['test', 'build', 'lint', 'typecheck'].includes(name) ? 'task' : 'unknown' }));
    const dependencyCount = Object.keys(manifest.dependencies ?? {}).length + Object.keys(manifest.devDependencies ?? {}).length;
    return { path, directory: directory || '.', scripts, dependencyCount, lockPath: lockPath ?? null, lockValid,
      nodeVersion: version || null, versionPath: versionPath ?? null, packageManager: manager,
      installCommand: otherManager ? null : lockValid ? 'npm ci' : 'npm install',
      recommendedScript: scripts.find(script => script.name === 'test')?.name ?? scripts.find(script => script.name === 'build')?.name ?? null };
  }));
  if (!all.length) add('node_manifest', 'WARN', 'JavaScript/TypeScript source found, but package.json was not found', null, 'Provide package.json or document a buildless application');
  for (const pkg of packages) {
    if (pkg.error) { add('node_manifest', 'FAIL', `Invalid package.json: ${pkg.path}`, pkg.path, 'Fix the manifest JSON before installing dependencies'); continue; }
    add('node_manifest', 'PASS', `Node dependency manifest found: ${pkg.path}`, pkg.path);
    add('node_lock', pkg.lockValid ? 'PASS' : 'WARN', pkg.lockValid ? `npm lock file parsed: ${pkg.lockPath}` : `npm lock file missing or invalid: ${pkg.path}`, pkg.lockPath ?? pkg.path,
      pkg.lockValid ? null : 'Review the package manager and commit its lock file; manifest/lock consistency is not executed');
    add('node_version', pkg.nodeVersion ? 'PASS' : 'WARN', pkg.nodeVersion ? `Node.js requirement declared: ${pkg.nodeVersion}` : `Node.js requirement not declared: ${pkg.path}`, pkg.versionPath ?? pkg.path,
      pkg.nodeVersion ? null : 'Declare engines.node, .nvmrc or .node-version; this does not prove runtime compatibility');
    add('node_scripts', pkg.scripts.length ? 'PASS' : 'WARN', pkg.scripts.length ? `npm scripts declared (not executed): ${pkg.scripts.map(script => script.name).join(', ')}` : `No npm scripts declared: ${pkg.path}`, pkg.path,
      pkg.scripts.length ? null : 'Document how to test, build or start this application');
  }
  if (all.length > packages.length) add('node_coverage', 'WARN', 'Only the first five package manifests were inspected', null, 'Review remaining workspace manifests manually');
  const commands = readmeText.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^\s*(?:\$\s*)?(npm(?:\.cmd)?\s+(?:install|ci|test|start|run\s+[\w:.-]+)(?:\s+.*)?)\s*$/);
    return match ? [{ command: match[1].trim(), evidence: { file: readme, line: index + 1 } }] : [];
  });
  const installation = commands.find(item => /^npm(?:\.cmd)?\s+(?:install|ci)\b/.test(item.command));
  const run = commands.find(item => /^npm(?:\.cmd)?\s+(?:run|test|start)\b/.test(item.command));
  for (const [id, found, label] of [['node_install_instructions', installation, 'installation'], ['node_run_instructions', run, 'run/test']]) {
    add(id, found ? 'PASS' : 'WARN', found ? `npm ${label} command documented in README` : `npm ${label} command not automatically recognized in README`, found ? readme : null,
      found ? null : 'Review README and package.json scripts; detection is not execution');
    if (found) checks.at(-1).evidence = { ...found.evidence, text: found.command };
  }
  const ollamaLine = readmeText.split(/\r?\n/).findIndex(line => /\bollama\b/i.test(line));
  const prerequisites = ollamaLine < 0 ? [] : [{ name: 'Ollama', evidence: { file: readme, line: ollamaLine + 1 },
    message: 'Ollama is referenced in README; review local service, model download and fallback instructions. Availability was not tested.' }];
  return { checks, packages, commands, prerequisites, manifestsFound: all.length, manifestsInspected: packages.length, executionSupported: false };
}
