const prefix = 'reprocheck.workspace.v1.';
export function loadWorkspace(key, storage) {
  try {
    const value = JSON.parse((storage ?? window.localStorage).getItem(prefix + key));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
export function saveWorkspace(key, value, storage) {
  try { (storage ?? window.localStorage).setItem(prefix + key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export const validRunId = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export function savedReport(value) {
  return value && /^[\w.-]+\/[\w.-]+$/.test(value.repository) && /^[a-f\d]{40}$/i.test(value.commit)
    && Array.isArray(value.checks) && Array.isArray(value.workflows) && value.summary ? value : null;
}
export function savedPage(value, report, runId) {
  if (['scan', 'web', 'history'].includes(value)) return value;
  if (value === 'run' && validRunId(runId)) return 'run';
  // Configuration review and execution consent must be renewed after reload.
  return report && ['report', 'configure'].includes(value) ? 'report' : 'scan';
}
