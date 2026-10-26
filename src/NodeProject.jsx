import { useLanguage } from './language.jsx';

export function NodeProject({ report }) {
  const { t } = useLanguage();
  const project = report.nodeProject;
  if (!project) return null;
  return <section className="runner" aria-label={t('JavaScript / TypeScript declarations')}>
    <p className="eyebrow">{t('JavaScript / TypeScript declarations')}</p>
    <h2>{t('Review installation, tasks and services')}</h2>
    <p>{t('These scripts are declarations, not verified execution results. Review scripts and lifecycle hooks before running them. Use the service plan to review and execute supported Node.js/Python applications.')}</p>
    <p className="hint">{t('Lock files are parsed, not installed. Version requirements are declarations, not compatibility checks. Workspace and lock consistency require manual review.')}</p>
    {project.packages.map(pkg => <div className="runner-result" key={pkg.path}>
      <h3>{pkg.path}</h3>
      <a href={`https://github.com/${report.repository}/blob/${report.commit}/${pkg.path.split('/').map(encodeURIComponent).join('/')}`} target="_blank" rel="noreferrer">{t('View pinned manifest')}</a>
      <dl className="evaluation-summary"><dt>{t('Working directory')}</dt><dd><code>{pkg.directory}</code></dd>
        <dt>Node.js</dt><dd>{pkg.nodeVersion ?? t('Not declared')}</dd>
        <dt>{t('Package manager')}</dt><dd>{pkg.packageManager ?? t(pkg.lockValid ? 'npm lock found; manager version not declared' : 'Not declared')}</dd></dl>
      {pkg.error ? <p role="alert">{t(pkg.error)}</p> : <>
        <h4>{t('Installation candidate')}</h4>
        {pkg.installCommand ? <pre><code>{pkg.installCommand}</code></pre> : <p>{t('Review the declared package manager; no npm installation command is recommended.')}</p>}
        {pkg.recommendedScript && <p className="hint">{t('Suggested first task (not executed):')} <code>{pkg.recommendedScript}</code></p>}
        <details><summary>{t('Review declared scripts')} ({pkg.scripts.length})</summary>{pkg.scripts.map(script => <div key={script.name}>
          <h4>{script.name} · {t(script.kind === 'service' ? 'Service entry · readiness and browser checks required' : script.kind === 'task' ? 'Task entry · review watch mode and exit behavior' : 'Unclassified script · review manually')}</h4>
          {script.invocation && <pre><code>{script.invocation}</code></pre>}
          <p className="hint">{t('Declared script body')}</p><pre><code>{script.command}</code></pre>
        </div>)}</details>
      </>}
    </div>)}
    {project.commands.length > 0 && <details><summary>{t('npm commands documented in README')}</summary>
      {project.commands.map(item => <p key={item.evidence.line}><code>{item.command}</code> · <a href={`https://github.com/${report.repository}/blob/${report.commit}/${item.evidence.file}#L${item.evidence.line}`} target="_blank" rel="noreferrer">{item.evidence.file}:{item.evidence.line}</a></p>)}
    </details>}
    {project.prerequisites.map(item => <div className="runner-note" key={item.name}><strong>{item.name}</strong><p>{t(item.message)}</p>
      <a href={`https://github.com/${report.repository}/blob/${report.commit}/${item.evidence.file}#L${item.evidence.line}`} target="_blank" rel="noreferrer">{item.evidence.file}:{item.evidence.line}</a></div>)}
    <p className="hint">{t('Manifest coverage:')} {project.manifestsInspected} / {project.manifestsFound}</p>
  </section>;
}
