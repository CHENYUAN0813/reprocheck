import { npmCommands, npmPlan, validateNpmConfig } from '../npm-config.mjs';
import { useLanguage } from './language.jsx';

export function NpmConfiguration({ value, onChange, disabled, onError, report }) {
  const { t } = useLanguage();
  const pkg = report?.repository === value?.repository && report?.commit === value?.commit
    ? report.nodeProject?.packages?.find(pkg => (pkg.directory.replace(/\/$/, '') || '.') === value.directory && !pkg.error) : null;
  const plan = pkg ? npmPlan(report, pkg) : null;
  const evidence = key => {
    const source = plan && value[key] === plan.config[key] && (key !== 'startScript' || JSON.stringify(value.startArgs) === JSON.stringify(plan.config.startArgs)) ? plan.sources[key] : null;
    return source ? <a href={`https://github.com/${value.repository}/blob/${value.commit}/${source.evidence.file}#L${source.evidence.line}`} target="_blank" rel="noreferrer">{source.evidence.file}:{source.evidence.line}</a>
      : <span>{t(plan && value[key] === plan.config[key] ? 'Suggested from package.json; review before running.' : 'Imported or edited configuration; review before running.')}</span>;
  };
  const edit = (key, next) => onChange({ ...value, [key]: next });
  function download() {
    try {
      const config = validateNpmConfig(value);
      const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'reprocheck-npm.json'; link.click(); URL.revokeObjectURL(url);
    } catch (error) { onError(error.message); }
  }
  async function upload(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 16000) throw new Error('Configuration file is too large');
      onChange(validateNpmConfig(JSON.parse(await file.text())));
    } catch (error) { onError(error.message); }
  }
  return <fieldset className="npm-configuration" disabled={disabled}>
    <legend>{t('Review the generated run plan')}</legend>
    <p>{t('Single npm application, Node 24.14.0. Installation uses the network; tests, build and browser checks run offline. No host folders, ports or model services are connected.')}</p>
    <p>{t('2 CPUs per container; 2 GB app / 1 GB browser. Deadline: 10 minutes. Images stay cached.')}</p>
    {value && <div className="npm-plan">
      <p>{t('Review these steps, then confirm execution below. Open advanced configuration only to change them.')}</p><p className="hint">{t('README links identify the source instruction. Container flags, verification order and browser checks are supplied by ReproCheck; this is not a verbatim README script.')}</p>
      <ol>
        <li><strong>{t('Install dependencies')}</strong><pre><code>npm {value.install} --no-audit --no-fund</code></pre>{evidence('install')}</li>
        <li><strong>{t('Project tests')}</strong>{value.testScript ? <><pre><code>npm run {value.testScript}</code></pre>{evidence('testScript')}</> : <p>{t('No script configured; not verified')}</p>}</li>
        <li><strong>{t('Project build')}</strong>{value.buildScript ? <><pre><code>npm run {value.buildScript}</code></pre>{evidence('buildScript')}</> : <p>{t('No script configured; not verified')}</p>}</li>
        <li><strong>{t('Start service')}</strong><pre><code>{npmCommands(value).at(-1)}</code></pre>{evidence('startScript')}</li>
        <li><strong>{t('Browser acceptance')}</strong><p><code>http://127.0.0.1:{value.port}{value.path}</code></p><p>{t('Browser checks cover successful HTTP response, visible text and uncaught exceptions during load only. They do not verify game actions, model inference or all business features.')}</p></li>
      </ol>
      {plan?.warnings.map((warning, i) => <p className="runner-note" key={i}>{t(warning.message)} {warning.command && <code>{warning.command}</code>}</p>)}
      {plan?.prerequisites.map(item => <p className="runner-note" key={item.name}>{item.name}: {t(item.message)} {t('External services are not started by this plan.')}</p>)}
      {plan && <button type="button" onClick={() => onChange(plan.config)}>{t('Regenerate from scanned instructions')}</button>}
    </div>}
    <details><summary>{t('Advanced configuration and import / export')}</summary>
    <label>{t('Import npm configuration')}<input type="file" accept="application/json,.json" onChange={upload} /></label>
    {value ? <>
      <p>{t('Fixed source:')} <strong>{value.repository}</strong> · <code>{value.commit}</code></p>
      <p>{t('Configuration import can select another pinned repository. Review the source before confirming.')}</p>
      <label>{t('Working directory')}<input value={value.directory} onChange={event => edit('directory', event.target.value)} /></label>
      <label>{t('Installation')}<select value={value.install} onChange={event => edit('install', event.target.value)}><option value="ci">npm ci</option><option value="install">npm install</option></select></label>
      {['testScript', 'buildScript', 'startScript'].map(key => <label key={key}>{t({testScript:'Test script (blank means not verified)',buildScript:'Build script (blank means skipped)',startScript:'Start script'}[key])}<input value={value[key]} onChange={event => edit(key, event.target.value)} /></label>)}
      <label>{t('Start arguments (one per line)')}<textarea value={value.startArgs.join('\n')} onChange={event => edit('startArgs', event.target.value.split('\n').filter(Boolean))} /></label>
      <label>{t('Service port')}<input type="number" min="1024" max="65535" value={value.port} onChange={event => edit('port', Number(event.target.value))} /></label>
      <label>{t('Readiness and browser path')}<input value={value.path} onChange={event => edit('path', event.target.value)} /></label>
      <label>{t('Expected page text (optional)')}<input value={value.expectedText} onChange={event => edit('expectedText', event.target.value)} /></label>
      <p>{t('Use finite test/build scripts, not watch mode. Start must bind the configured port. Network-dependent tasks may fail offline. Environment secrets and multiple services are not supported.')}</p>
      <details open><summary>{t('Commands to execute')}</summary><ol>{npmCommands(value).map((command,index) => <li key={index}><code>{command}</code></li>)}</ol></details>
      <p>{t('Browser checks cover successful HTTP response, visible text and uncaught exceptions during load only. They do not verify game actions, model inference or all business features.')}</p>
      <button type="button" onClick={download}>{t('Download npm configuration')}</button>
    </> : <p>{t('Scan an npm project first, or import a saved configuration.')}</p>}
    </details>
  </fieldset>;
}
