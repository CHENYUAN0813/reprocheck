import { NpmConfiguration } from './NpmConfiguration.jsx';
import { npmDraft, validateNpmConfig, npmScope } from '../npm-config.mjs';
import { loadWorkspace, saveWorkspace, validRunId } from "./workspace-storage.mjs";
import { useLanguage } from "./language.jsx";
import { useEffect, useState } from 'react';
import { RunConsole } from './RunConsole.jsx';

export function WebEvidence({ job }) {
  const { t } = useLanguage();
  return <section className="execution-evidence">
    <h3>{t("Browser acceptance · ")}{t(job.verification.status)}</h3>
    <p>{t(job.workflowId === 'npm-project' ? npmScope : job.workflowId === 'rumor-control' ? 'Pinned Rumor Control: game actions, offline fallback and saved state. Live Ollama inference is not tested.' : job.workflowId === 'sydney-planner' ? 'Pinned Sydney planner · React + FastAPI + SQLite · Demo login. AI quality and Google OAuth are outside this acceptance.' : 'Built-in JS/TypeScript + SQLite fixture. Passing these assertions does not verify arbitrary applications or reproduce a paper.')}</p>
    {job.browser?.ai && <p>{t(job.workflowId === "rumor-control" ? "Live Ollama: " : "Live Gemini: ")}<strong>{t(job.browser.ai.status)}</strong>{job.browser.ai.httpStatus && ` · HTTP ${job.browser.ai.httpStatus}`}</p>}
    <ul>{job.browser?.checks?.map(check => <li key={check.name}>{t(check.status)} · {t(check.name)}</li>)}</ul>
    {job.diagnosis && <p role="alert">{job.diagnosis}</p>}
    <p>{t("Container cleanup: ")}{t(job.cleanup)}{job.cleanupError && ` · ${job.cleanupError}`}</p>
    {job.manualScreenshot && <details><summary>{t("Manual task persistence screenshot")}</summary><img src={job.manualScreenshot} alt={t("Saved manual task after editing and reloading")} style={{ width: '100%' }} /></details>}
    {job.screenshot && <a href={job.screenshot} target="_blank" rel="noreferrer"><img src={job.screenshot} alt={t("Application after the browser acceptance flow")} style={{ width: '100%', borderRadius: 12 }} /></a>}
    <a className="download-button" href={`/api/runs/${job.id}?download=1`}>{t("Download execution evidence")}</a>
  </section>;
}

export function WebVerification({ active, sourceReport }) {
  const { t } = useLanguage();
  const [restored] = useState(() => loadWorkspace("web"));
  const [restoring, setRestoring] = useState(() => validRunId(restored.runId));
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState(null);
  const [environmentError, setEnvironmentError] = useState('');
  const [selectedSource, setSelectedSource] = useState(restored.sourceKey ?? null);
  const [job, setJob] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(() => restored.pending ? 'The previous start request was interrupted. Check History & comparison before retrying; the task may already be running.' : '');
  const [busy, setBusy] = useState(false);
  const [caseId, setCaseId] = useState(() => ['sydney-planner', 'web-notes', 'rumor-control', 'npm-project'].includes(restored.caseId) ? restored.caseId : 'sydney-planner');
  const [liveAi, setLiveAi] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [npmConfig, setNpmConfig] = useState(() => { try { return validateNpmConfig(restored.npmConfig); } catch { return null; } });
  const npm = caseId === 'npm-project';
  const planner = caseId === 'sydney-planner';
  const rumor = caseId === 'rumor-control';
  const selected = info?.cases?.find(item => item.id === caseId);
  const running = job && job.status !== 'INTERRUPTED' && !job.finishedAt;
  useEffect(() => {
    if (restoring || busy || (restored.pending && !job)) return;
    saveWorkspace('web', { caseId, runId: job?.id ?? restored.runId, sourceKey: selectedSource, npmConfig });
  }, [caseId, job?.id, restoring, selectedSource, busy, npmConfig]);
  useEffect(() => {
    if (!validRunId(restored.runId)) return;
    let disposed = false;
    fetch(`/api/runs/${restored.runId}`, { signal: AbortSignal.timeout(15000) }).then(async response => {
      const value = await response.json();
      if (!response.ok || value.kind !== 'web') throw new Error(value.error || 'Unable to load the record');
      if (!disposed) setJob(value);
    }).catch(failure => { if (!disposed) setError(failure.message); })
      .finally(() => { if (!disposed) setRestoring(false); });
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (!active || running || busy || restoring) return;
    const pkg = sourceReport?.nodeProject?.packages?.find(pkg => !pkg.error && pkg.installCommand);
    const npmSource = pkg && `${sourceReport.repository}@${sourceReport.commit}`;
    if (npmSource && (selectedSource !== npmSource || !npmConfig)) {
      setSelectedSource(npmSource); setCaseId('npm-project'); setNpmConfig(npmDraft(sourceReport, pkg)); setConfirmed(false); setApiKey(''); return;
    }
    const match = info?.cases?.find(item => item.repository === sourceReport?.repository && item.commit === sourceReport?.commit);
    const sourceKey = match && `${match.repository}@${match.commit}`;
    if (match && selectedSource !== sourceKey) {
      setSelectedSource(sourceKey);
      setCaseId(match.id); setConfirmed(false); setApiKey('');
    }
  }, [active, sourceReport?.repository, sourceReport?.commit, info, restoring, selectedSource, running, busy, npmConfig]);
  async function refresh() {
    setChecking(true); setCheckedAt(null); setEnvironmentError('');
    try {
      const response = await fetch('/api/web', { signal: AbortSignal.timeout(15000) }); const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setInfo(value); setCheckedAt(new Date());
    } catch (failure) {
      setInfo(null);
      setEnvironmentError(failure.name === 'TimeoutError' ? 'Environment check timed out. Check the local server and Docker, then retry.' : failure.message);
    } finally { setChecking(false); }
  }
  useEffect(() => { if (active) refresh(); }, [active]);
  useEffect(() => {
    if (!running) return;
    let disposed = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/runs/${job.id}`); const value = await response.json();
        if (!response.ok) throw new Error(value.error);
        if (!disposed) { setJob(value); setError(''); }
      } catch (failure) { if (!disposed) setError(failure.message); }
    }, 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [job?.id, running]);
  async function run() {
    try { if (npm) validateNpmConfig(npmConfig); } catch (failure) { setError(failure.message); return; }
    setBusy(true); setError('');
    saveWorkspace('web', { caseId, sourceKey: selectedSource, npmConfig, pending: true });
    try {
      const response = await fetch('/api/web/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId, ...(npm ? { config: validateNpmConfig(npmConfig) } : {}), confirmUnknownCode: confirmed, ...(planner && liveAi ? { liveAi: true, geminiApiKey: apiKey } : {}) }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error); setJob(value); setApiKey('');
      saveWorkspace('web', { caseId, sourceKey: selectedSource, npmConfig, runId: value.id });
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function cancel() {
    try {
      const response = await fetch(`/api/runs/${job.id}`, { method: 'DELETE' });
      const value = await response.json(); if (!response.ok) throw new Error(value.error); setJob(value);
    } catch (failure) { setError(failure.message); }
  }
  return <section className="runner">
    <p className="eyebrow">{t("LOCAL DOCKER · WEB ACCEPTANCE")}</p>
    <h2>{t("Install → start → verify in a browser")}</h2>
    <label>{t("Execution mode")}<select value={caseId} disabled={restoring || running || busy} onChange={event => { setCaseId(event.target.value); setConfirmed(false); setApiKey(''); }}>{[{ id: 'npm-project', name: 'Configured npm application' }, ...(info?.cases ?? [{ id: 'sydney-planner', name: 'Sydney task planner' }, { id: 'web-notes', name: 'Built-in notes fixture' }, { id: 'rumor-control', name: 'Rumor Control · React + TypeScript + Vite' }])].map(item => <option key={item.id} value={item.id}>{t(item.name)}</option>)}</select></label>
    {npm && <NpmConfiguration value={npmConfig} disabled={running || busy || restoring} onError={setError} onChange={value => { setNpmConfig(value); setConfirmed(false); }} />}
    {!npm && <><p>{t(rumor ? 'Pinned public React/TypeScript game. Installs dependencies, runs tests, lint and build, then starts Vite. Ollama is unavailable inside this offline acceptance.' : planner ? 'Real private repository: React frontend + Python FastAPI backend + SQLite. Source is fetched on the host using your existing school GitHub CLI login; no repository credential enters Docker.' : 'Bundled JavaScript / TypeScript notes fixture. No GitHub Token needed.')}</p>
    {(planner || rumor) && <p>{t("Fixed commit: ")}<code>{info?.cases?.find(item => item.id === caseId)?.commit}</code>{planner && t(". Uses a disposable database and Demo login.")}</p>}
    <ol><li>{t("Install dependencies and build the frontend.")}</li><li>{t("Start the frontend and API; wait for readiness.")}</li><li>{t(rumor ? 'Chromium investigates evidence, submits it, verifies model-unavailable fallback, and reloads to check saved state.' : planner ? 'Chromium creates a task, edits its schedule, marks it completed, reloads, then deletes it and verifies persistence.' : 'Chromium creates a note, reloads, and checks the saved record.')}</li><li>{t("Save screenshot and evidence; remove temporary containers and database.")}</li></ol>
    {selected?.commands && <details open><summary>{t("Commands to execute")}</summary><ol>{selected.commands.map(command => <li key={command}><code>{command}</code></li>)}</ol></details>}
    {rumor && <p className="runner-note">{t("Live Ollama: NOT RUN. Passing fallback checks does not prove model inference works.")}</p>}
    {planner && <><label className="runner-confirm"><input type="checkbox" disabled={running || busy} checked={liveAi} onChange={event => setLiveAi(event.target.checked)} />{t(" Also verify live Gemini generation and saved tasks (uses your API quota)")}</label>
      {liveAi && <label>{t("Gemini API key")}<input type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} /><span className="hint">{t("Sent only to the local runner, then the planning backend. Not saved in history or browser storage. Re-enter for a live retry.")}</span></label>}</>}
    <p>{t("2 CPUs per container; ")}{t(planner || rumor ? '2 GB app / 1 GB browser' : '1 GB each')}{t(". Deadline: 10 minutes. No host mounts or published ports. Images stay cached. ")}{t(rumor ? 'Installation uses the network; tests and browser acceptance run offline. No host Ollama service is accessed.' : planner ? 'Installation uses the network; manual-only acceptance disconnects it before startup. Live mode sends only a synthetic planning prompt to Gemini.' : 'Runtime network is disabled.')}</p>
    </>}
    <p role="status" aria-live="polite">{checking ? t('Checking Docker browser environment…') : info ? <>{t(info.runtime.available ? 'Browser environment ready' : info.runtime.reason)}{checkedAt && <> · {t('Last checked:')} {checkedAt.toLocaleTimeString()}</>}</> : null}</p>
    {environmentError && <p role="alert" className="error">{t(environmentError)}</p>}
    <button type="button" className="download-button" onClick={refresh} disabled={checking}>{t(checking ? 'Checking environment…' : 'Check environment')}</button>
    <p className="hint">{t('This checks Docker and installed images only. To start acceptance, confirm below and click Run web verification.')}</p>
    {planner && info && !info.runtime.plannerAvailable && <p>{t("Run npm run setup:planner to install the Python/Node application image.")}</p>}
    {npm && info && !info.runtime.npmAvailable && <p>{t('Run npm run setup:web to update the npm browser image')}</p>}
    {rumor && info && !info.runtime.rumorAvailable && <p>{t("Run npm run setup:web to update the browser image for Rumor Control.")}</p>}
    <label className="runner-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t(npm ? "I confirm running the configured repository and its install scripts in temporary Docker containers." : " I confirm running this reviewed application and browser in temporary Docker containers.")}</label>
    <button type="button" className="download-button" onClick={run} disabled={(npm && (!npmConfig || !info?.runtime.npmAvailable)) || restoring || checking || !confirmed || !info?.runtime.available || (rumor && !info.runtime.rumorAvailable) || (planner && !info.runtime.plannerAvailable) || (planner && liveAi && !apiKey.trim()) || running || busy}>{t(busy ? 'Starting…' : job ? 'Retry in a clean environment' : 'Run web verification')}</button>
    {restoring && <p role="status">{t("Restoring the saved run; no new execution is started.")}</p>}
    {error && <p role="alert" className="error">{t(error)}</p>}
    {job && <div className="run-log"><p>{t("Saved run result; editing the configuration above does not change this evidence.")} <strong>{job.repository}</strong> · <code>{job.commit.slice(0, 12)}</code> · <code>{job.workflowId}</code></p><h3>{t("Run ")}{t(job.status)}</h3>
      {running && <button type="button" className="download-button" disabled={job.status !== 'RUNNING'} onClick={cancel}>{t(job.status === 'RUNNING' ? 'Cancel web run' : 'Cleaning up…')}</button>}
      <ol className="run-progress">{job.steps.map(step => <li key={step.name} className={`run-step-${step.status.toLowerCase()}`}><strong>{t(step.status)}</strong>{t(step.name)}</li>)}</ol>
      <RunConsole text={job.log} job={job} active={active} /><WebEvidence job={job} /></div>}
  </section>;
}
