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

export function npmDraft(report, pkg) {
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
