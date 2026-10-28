export const batchScope = 'Selected batch commands and repository-reported JUnit tests only. Hardware inference, model quality and full-paper reproduction are not verified.';
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).every(k => keys.includes(k));
export const findDockerfiles = paths => paths.filter(p => /(?:^|\/)(?:Dockerfile(?:\.[\w-]+)?|[\w-]+\.Dockerfile)$/.test(p)).slice(0,20);
export const batchPath = v => typeof v === 'string' && v.length <= 200 && /^[\w./-]+$/.test(v) && !v.startsWith('/') && !v.split('/').some(p => p === '..' || p === '.git' || p === '');
export function validateBatchBuild(b) {
  if (!exact(b,['context','dockerfile','args']) || !batchPath(b.context) || !batchPath(b.dockerfile) || b.dockerfile === '.'
    || !object(b.args) || Object.keys(b.args).length > 10
    || Object.entries(b.args).some(([k,v]) => !/^[A-Z][A-Z0-9_]{0,79}$/.test(k) || /SECRET|TOKEN|PASSWORD|KEY|CREDENTIAL/.test(k) || typeof v !== 'string' || v.length > 500 || /[\r\n\0]/.test(v))) throw Error('Invalid image build configuration');
  return b;
}
export function validateBatchConfig(c) {
  const fail = () => { throw Error('Invalid batch test plan'); };
  if (!exact(c, ['schemaVersion','repository','commit','image','build','directory','env','commands','junit','timeoutMinutes','memoryMb']) || c.schemaVersion !== 1
    || !/^[A-Za-z0-9][\w.-]{0,99}\/[A-Za-z0-9][\w.-]{0,99}$/.test(c.repository ?? '') || !/^[a-f0-9]{40}$/.test(c.commit ?? '')
    || !(c.build ? c.image === '' : /^sha256:[a-f0-9]{64}$/.test(c.image ?? '')) || !batchPath(c.directory)
    || !Number.isInteger(c.timeoutMinutes) || c.timeoutMinutes < 1 || c.timeoutMinutes > 30
    || !Number.isInteger(c.memoryMb) || c.memoryMb < 512 || c.memoryMb > 8192
    || !(c.junit === null || batchPath(c.junit) && c.junit.endsWith('.xml'))
    || !object(c.env) || Object.keys(c.env).length > 20
    || Object.entries(c.env).some(([k,v]) => !/^[A-Z][A-Z0-9_]{0,79}$/.test(k) || /SECRET|TOKEN|PASSWORD|API_KEY|SIGNING_KEY/.test(k) || typeof v !== 'string' || v.length > 500 || /[\r\n\0]/.test(v))
    || !Array.isArray(c.commands) || !c.commands.length || c.commands.length > 8) fail();
  for (const a of c.commands) if (!Array.isArray(a) || !a.length || a.length > 80 || a.some(s => typeof s !== 'string' || !s.length || s.length > 500 || /[\r\n\0]/.test(s))) fail();
  if(c.build !== undefined) validateBatchBuild(c.build);
  return JSON.parse(JSON.stringify(c));
}
export function batchDraft(report) {
  return {schemaVersion:1,repository:report?.repository ?? '',commit:report?.commit ?? '',image:'',directory:'.',env:{},commands:[],junit:null,timeoutMinutes:10,memoryMb:2048};
}
