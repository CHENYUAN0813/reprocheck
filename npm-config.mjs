const scriptName = /^[A-Za-z0-9_][A-Za-z0-9_:.-]{0,79}$/;
export const npmScope = 'Configured npm tasks and basic browser smoke checks only. Business workflows, external services and model inference are not verified.';

export function validateNpmConfig(value) {
  const fields = ['schemaVersion', 'repository', 'commit', 'directory', 'install', 'testScript', 'buildScript', 'startScript', 'startArgs', 'port', 'path', 'expectedText'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))
    || value.schemaVersion !== 1 || typeof value.repository !== 'string' || !/^[A-Za-z0-9][\w.-]{0,99}\/[A-Za-z0-9][\w.-]{0,99}$/.test(value.repository)
    || typeof value.commit !== 'string' || !/^[a-f0-9]{40}$/i.test(value.commit)
    || typeof value.directory !== 'string' || value.directory.length > 200
    || !(value.directory === '.' || /^[\w.-]+(?:\/[\w.-]+)*$/.test(value.directory))
    || value.directory.split('/').some(part => part === '..' || part === '.git')
    || !['ci', 'install'].includes(value.install)
    || typeof value.startScript !== 'string' || !scriptName.test(value.startScript)
    || ![value.testScript, value.buildScript].every(name => name === '' || typeof name === 'string' && scriptName.test(name))
    || !Array.isArray(value.startArgs) || value.startArgs.length > 20
    || value.startArgs.some(arg => typeof arg !== 'string' || arg.length > 200 || /[\r\n\0]/.test(arg))
    || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535
    || typeof value.path !== 'string' || !/^\/(?!\/)[A-Za-z0-9_./~-]*$/.test(value.path) || value.path.length > 200
    || typeof value.expectedText !== 'string' || value.expectedText.length > 200) throw new Error('Invalid npm configuration');
  return JSON.parse(JSON.stringify(value));
}

function fallbackDraft(report, pkg) {
  const names = pkg.scripts.map(script => script.name);
  const start = ['dev', 'start', 'preview'].find(name => names.includes(name)) ?? '';
  const vite = pkg.scripts.some(script => script.name === start && /^vite(?:\s|$)/.test(script.command));
  return { schemaVersion: 1, repository: report.repository, commit: report.commit, directory: pkg.directory.replace(/\/$/, '') || '.',
    install: pkg.lockValid ? 'ci' : 'install', testScript: names.includes('test') ? 'test' : '', buildScript: names.includes('build') ? 'build' : '',
    startScript: start, startArgs: vite ? ['--host', '0.0.0.0', '--port', '5173', '--strictPort'] : [],
    port: vite ? 5173 : 3000, path: '/', expectedText: '' };
}

export function npmCommands(config) {
  return [`npm ${config.install} --no-audit --no-fund`, ...[config.testScript, config.buildScript].filter(Boolean).map(name => `npm run ${name}`),
    `npm run ${config.startScript}${config.startArgs.length ? ' -- ' + config.startArgs.map(arg => JSON.stringify(arg)).join(' ') : ''}`];
}

// Only standalone npm commands for a single root package can be attributed automatically.
export function npmPlan(report, pkg) {
  const config = fallbackDraft(report, pkg);
  const commands = report.nodeProject?.commands ?? [];
  const sources = {};
  const warnings = [];
  const choices = [];
  const installs = [];
  for (const item of commands) {
    const install = item.command.match(/^npm(?:\.cmd)?\s+(ci|install)\s*$/);
    const task = item.command.match(/^npm(?:\.cmd)?\s+(?:run\s+([\w:.-]+)|(start|test))(?:\s+--\s+([\w.=/:-]+(?:\s+[\w.=/:-]+)*))?\s*$/);
    if (config.directory !== '.' || report.nodeProject?.manifestsFound > 1 || (!install && !task)) {
      warnings.push({ message: 'README command needs manual review; it was not added to the plan.', ...item }); continue;
    }
    if (install) { installs.push({ value: install[1], item }); continue; }
    const name = task[1] ?? task[2];
    const script = pkg.scripts.find(script => script.name === name);
    if (!script || !['dev', 'start', 'preview', 'test', 'build'].includes(name)) {
      warnings.push({ message: 'README command needs manual review; it was not added to the plan.', ...item }); continue;
    }
    const args = task[3]?.trim().split(/\s+/) ?? [];
    if (['test', 'build'].includes(name)) {
      if (args.length) warnings.push({ message: 'README command needs manual review; it was not added to the plan.', ...item });
      else sources[name + 'Script'] = item;
    } else if (!choices.some(choice => choice.name === name && JSON.stringify(choice.args) === JSON.stringify(args))) choices.push({ name, args, item });
  }
  if (new Set(installs.map(entry => entry.value)).size === 1) {
    const entry = installs[0];
    if (entry.value !== 'ci' || pkg.lockValid) { config.install = entry.value; sources.install = entry.item; }
    else warnings.push({ ...entry.item, message: 'README requests npm ci but no valid lock file was found.' });
  } else if (installs.length) warnings.push({ message: 'README contains multiple installation methods; review the selected method.' });
  if (choices.length === 1) {
    config.startScript = choices[0].name;
    const script = pkg.scripts.find(script => script.name === config.startScript);
    const vite = /^vite(?:\s|$)/.test(script.command);
    config.startArgs = choices[0].args.length ? choices[0].args : vite ? ['--host', '0.0.0.0', '--port', '5173', '--strictPort'] : [];
    const args = config.startArgs;
    const port = args.find(arg => arg.startsWith('--port='))?.slice(7) ?? (args.includes('--port') ? args[args.indexOf('--port') + 1] : undefined);
    config.port = /^\d+$/.test(port ?? '') ? Number(port) : vite ? 5173 : 3000;
    sources.startScript = choices[0].item;
  } else if (choices.length > 1) {
    config.startScript = '';
    config.startArgs = [];
    warnings.push({ message: 'README has multiple service entries. Choose one in advanced configuration before running.' });
  }
  if (!config.startScript) warnings.push({ message: 'A startup script must be selected before running.' });
  if (config.startScript && !/^vite(?:\s|$)/.test(pkg.scripts.find(script => script.name === config.startScript)?.command ?? ''))
    warnings.push({ message: 'Service port is a suggested value. Confirm it against the project before running.' });
  return { config, sources, warnings, prerequisites: report.nodeProject?.prerequisites ?? [] };
}

export function npmDraft(report, pkg) { return npmPlan(report, pkg).config; }
