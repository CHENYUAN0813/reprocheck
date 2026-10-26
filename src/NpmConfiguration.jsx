import { npmCommands, validateNpmConfig } from '../npm-config.mjs';
import { useLanguage } from './language.jsx';

export function NpmConfiguration({ value, onChange, disabled, onError }) {
  const { t } = useLanguage();
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
    <legend>{t('Review npm execution configuration')}</legend>
    <p>{t('Single npm application, Node 24.14.0. Installation uses the network; tests, build and browser checks run offline. No host folders, ports or model services are connected.')}</p>
    <p>{t('2 CPUs per container; 2 GB app / 1 GB browser. Deadline: 10 minutes. Images stay cached.')}</p>
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
  </fieldset>;
}
