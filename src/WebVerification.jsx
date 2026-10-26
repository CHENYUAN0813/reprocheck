import { useLanguage } from "./language.jsx";
import { useEffect, useState } from 'react';
import { RunConsole } from './RunConsole.jsx';

export function WebEvidence({ job }) {
  const { t } = useLanguage();
  return <section className="execution-evidence">
    <h3>{t("Browser acceptance · ")}{t(job.verification.status)}</h3>
    <p>{t(job.workflowId === 'sydney-planner' ? 'Pinned Sydney planner · React + FastAPI + SQLite · Demo login. AI quality and Google OAuth are outside this acceptance.' : 'Built-in JS/TypeScript + SQLite fixture. Passing these assertions does not verify arbitrary applications or reproduce a paper.')}</p>
    {job.browser?.ai && <p>{t("Live Gemini: ")}<strong>{t(job.browser.ai.status)}</strong>{job.browser.ai.httpStatus && ` · HTTP ${job.browser.ai.httpStatus}`}</p>}
    <ul>{job.browser?.checks?.map(check => <li key={check.name}>{t(check.status)} · {t(check.name)}</li>)}</ul>
    {job.diagnosis && <p role="alert">{job.diagnosis}</p>}
    <p>{t("Container cleanup: ")}{t(job.cleanup)}{job.cleanupError && ` · ${job.cleanupError}`}</p>
    {job.manualScreenshot && <details><summary>{t("Manual task persistence screenshot")}</summary><img src={job.manualScreenshot} alt={t("Saved manual task after editing and reloading")} style={{ width: '100%' }} /></details>}
    {job.screenshot && <a href={job.screenshot} target="_blank" rel="noreferrer"><img src={job.screenshot} alt={t("Application after the browser acceptance flow")} style={{ width: '100%', borderRadius: 12 }} /></a>}
    <a className="download-button" href={`/api/runs/${job.id}?download=1`}>{t("Download execution evidence")}</a>
  </section>;
}

export function WebVerification({ active }) {
  const { t } = useLanguage();
  const [info, setInfo] = useState(null);
  const [job, setJob] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [caseId, setCaseId] = useState('sydney-planner');
  const [liveAi, setLiveAi] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const planner = caseId === 'sydney-planner';
  const running = job && job.status !== 'INTERRUPTED' && !job.finishedAt;
  async function refresh() {
    try {
      const response = await fetch('/api/web'); const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setInfo(value); setError('');
    } catch (failure) { setError(failure.message); }
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
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/web/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId, confirmUnknownCode: confirmed, ...(planner && liveAi ? { liveAi: true, geminiApiKey: apiKey } : {}) }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error); setJob(value); setApiKey('');
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
    <label>{t("Reviewed Web case")}<select value={caseId} disabled={running || busy} onChange={event => { setCaseId(event.target.value); setConfirmed(false); setApiKey(''); }}>{(info?.cases ?? [{ id: 'sydney-planner', name: 'Sydney task planner' }, { id: 'web-notes', name: 'Built-in notes fixture' }]).map(item => <option key={item.id} value={item.id}>{t(item.name)}</option>)}</select></label>
    <p>{t(planner ? 'Real private repository: React frontend + Python FastAPI backend + SQLite. Source is fetched on the host using your existing school GitHub CLI login; no repository credential enters Docker.' : 'Bundled JavaScript / TypeScript notes fixture. No GitHub Token needed.')}</p>
    {planner && <p>{t("Fixed commit: ")}<code>{info?.cases?.find(item => item.id === caseId)?.commit}</code>{t(". Uses a disposable database and Demo login.")}</p>}
    <ol><li>{t("Install dependencies and build the frontend.")}</li><li>{t("Start the frontend and API; wait for readiness.")}</li><li>{t(planner ? 'Chromium creates a task, edits its schedule, marks it completed, reloads, then deletes it and verifies persistence.' : 'Chromium creates a note, reloads, and checks the saved record.')}</li><li>{t("Save screenshot and evidence; remove temporary containers and database.")}</li></ol>
    {planner && <><label className="runner-confirm"><input type="checkbox" disabled={running || busy} checked={liveAi} onChange={event => setLiveAi(event.target.checked)} />{t(" Also verify live Gemini generation and saved tasks (uses your API quota)")}</label>
      {liveAi && <label>{t("Gemini API key")}<input type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} /><span className="hint">{t("Sent only to the local runner, then the planning backend. Not saved in history or browser storage. Re-enter for a live retry.")}</span></label>}</>}
    <p>{t("2 CPUs per container; ")}{t(planner ? '2 GB app / 1 GB browser' : '1 GB each')}{t(". Deadline: 10 minutes. No host mounts or published ports. Images stay cached. ")}{t(planner ? 'Installation uses the network; manual-only acceptance disconnects it before startup. Live mode sends only a synthetic planning prompt to Gemini.' : 'Runtime network is disabled.')}</p>
    {!info && !error && <p role="status">{t("Checking Docker browser environment…")}</p>}
    {info && <p role="status">{t(info.runtime.available ? 'Browser environment ready' : info.runtime.reason)}</p>}
    <button type="button" className="download-button" onClick={refresh}>{t("Check environment")}</button>
    {planner && info && !info.runtime.plannerAvailable && <p>{t("Run npm run setup:planner to install the Python/Node application image.")}</p>}
    <label className="runner-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t(" I confirm running this reviewed application and browser in temporary Docker containers.")}</label>
    <button type="button" className="download-button" onClick={run} disabled={!confirmed || !info?.runtime.available || (planner && !info.runtime.plannerAvailable) || (planner && liveAi && !apiKey.trim()) || running || busy}>{t(busy ? 'Starting…' : job ? 'Retry in a clean environment' : 'Run web verification')}</button>
    {error && <p role="alert" className="error">{t(error)}</p>}
    {job && <div className="run-log"><h3>{t("Run ")}{t(job.status)}</h3>
      {running && <button type="button" className="download-button" disabled={job.status !== 'RUNNING'} onClick={cancel}>{t(job.status === 'RUNNING' ? 'Cancel web run' : 'Cleaning up…')}</button>}
      <ol className="run-progress">{job.steps.map(step => <li key={step.name} className={`run-step-${step.status.toLowerCase()}`}><strong>{t(step.status)}</strong>{t(step.name)}</li>)}</ol>
      <RunConsole text={job.log} job={job} active={active} /><WebEvidence job={job} /></div>}
  </section>;
}
