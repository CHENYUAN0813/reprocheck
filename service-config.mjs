import { npmDraft } from './npm-config.mjs';
export const serviceScope = 'Configured service readiness, API responses and browser smoke checks only. Business workflows and model inference are not verified.';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => object(value) && Object.keys(value).every(key => fields.includes(key));
const path = value => typeof value === 'string' && value.length <= 200 && /^(?:\.|[\w-]+(?:[./][\w-]+)*)$/.test(value) && !value.split('/').includes('.git');
const urlPath = value => typeof value === 'string' && /^\/(?!\/)[\w./~-]*$/.test(value) && value.length <= 200;
const name = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(value);
const envKey = key => /^[A-Z][A-Z0-9_]{0,79}$/.test(key) && !/^(?:PATH|HOME|LD_|PYTHON|NODE_OPTIONS|BASH_ENV|ENV$)/.test(key);
export function validateServiceConfig(value) {
  const fail = () => { throw new Error('Invalid multi-service configuration'); };
  if (!exact(value, ['schemaVersion','repository','commit','services','browser']) || value.schemaVersion !== 1
    || !/^[A-Za-z0-9][\w.-]{0,99}\/[A-Za-z0-9][\w.-]{0,99}$/.test(value.repository ?? '')
    || !/^[a-f0-9]{40}$/i.test(value.commit ?? '') || !Array.isArray(value.services) || !value.services.length || value.services.length > 4) fail();
  const names = new Set(), ports = new Set();
  for (const service of value.services) {
    if (!exact(service, ['id','runtime','directory','install','test','build','start','port','readyPath','dependsOn','env','generatedEnv'])
      || !name(service.id) || names.has(service.id) || !['node','python'].includes(service.runtime) || !path(service.directory)
      || !Number.isInteger(service.port) || service.port < 1024 || service.port > 65535 || ports.has(service.port) || !urlPath(service.readyPath)
      || !Array.isArray(service.dependsOn) || service.dependsOn.some(id => !name(id)) || new Set(service.dependsOn).size !== service.dependsOn.length
      || !object(service.env) || Object.keys(service.env).length > 20 || Object.entries(service.env).some(([key,val]) => !envKey(key) || /SECRET|TOKEN|PASSWORD|API_KEY|SIGNING_KEY/.test(key) || typeof val !== 'string' || val.length > 500 || /[\r\n\0]/.test(val))
      || !Array.isArray(service.generatedEnv) || service.generatedEnv.length > 10 || service.generatedEnv.some(key => !envKey(key) || key in service.env)) fail();
    for (const task of ['install','test','build','start']) {
      const args = service[task];
      if (!Array.isArray(args) || args.length > 40 || args.some(arg => typeof arg !== 'string' || !arg.length || arg.length > 300 || /[\r\n\0]/.test(arg))
        || (['install','start'].includes(task) && !args.length) || (args.length && !(service.runtime === 'node' ? ['npm','node'] : ['python','pip']).includes(args[0]))) fail();
    }
    names.add(service.id); ports.add(service.port);
  }
  if (value.services.some(s => s.dependsOn.some(id => !names.has(id) || id === s.id))) fail();
  serviceOrder(value.services);
  if (value.browser !== null) {
    const b = value.browser;
    if (!exact(b, ['service','path','expectedText','requiredApi']) || !names.has(b.service) || !urlPath(b.path) || typeof b.expectedText !== 'string' || b.expectedText.length > 200
      || !Array.isArray(b.requiredApi) || b.requiredApi.length > 10 || b.requiredApi.some(a => !exact(a,['service','path']) || !names.has(a.service) || !urlPath(a.path))) fail();
  }
  return JSON.parse(JSON.stringify(value));
}
export function serviceOrder(services) {
  const result = [], pending = [...services];
  while (pending.length) {
    const index = pending.findIndex(s => s.dependsOn.every(id => result.some(done => done.id === id)));
    if (index < 0) throw new Error('Service dependencies contain a cycle or unknown service');
    result.push(pending.splice(index,1)[0]);
  }
  return result;
}
export function serviceDraft(report, files = [], readme = '') {
  const services = (report.nodeProject?.packages ?? []).filter(p => !p.error && p.installCommand).map((pkg,i) => {
    const c = npmDraft(report,pkg);
    const port = c.port + i;
    const startArgs = [...c.startArgs];
    const portIndex = startArgs.indexOf('--port');
    if (portIndex >= 0) startArgs[portIndex + 1] = String(port);
    const inlinePort = startArgs.findIndex(arg => arg.startsWith('--port='));
    if (inlinePort >= 0) startArgs[inlinePort] = `--port=${port}`;
    return { id: `web${i+1}`, runtime:'node', directory:c.directory, install:['npm',c.install,'--no-audit','--no-fund'],
      test:c.testScript ? ['npm','run',c.testScript] : [], build:c.buildScript ? ['npm','run',c.buildScript] : [],
      start:c.startScript ? ['npm','run',c.startScript,'--',...startArgs] : [], port, readyPath:'/', dependsOn:[], env:{}, generatedEnv:[] };
  });
  const matches = [...readme.matchAll(/(?:python\s+-m\s+)?uvicorn\s+([\w.]+:[\w]+)[^\r\n]*/g)];
  const entries = [...new Set(matches.map(m=>m[1]))].filter(entry => files.includes(entry.split(':')[0].replaceAll('.','/')+'.py'));
  const requirements = files.filter(f => /(?:^|\/)requirements\.txt$/.test(f));
  if (entries.length === 1 && requirements.length === 1) {
    services.unshift({id:'api',runtime:'python',directory:'.',install:['pip','install','-r',requirements[0]],test:[],build:[],
      start:['python','-m','uvicorn',entries[0],'--host','0.0.0.0','--port','8000'],port:8000,readyPath:'/openapi.json',dependsOn:[],env:{},generatedEnv:[]});
    for (const s of services.filter(s=>s.runtime==='node')) s.dependsOn=['api'];
  }
  const web = services.find(s=>s.runtime==='node');
  return { schemaVersion:1, repository:report.repository, commit:report.commit, services,
    browser:web ? {service:web.id,path:'/',expectedText:'',requiredApi:[]} : null };
}
