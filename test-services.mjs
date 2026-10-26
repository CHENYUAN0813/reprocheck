import assert from 'node:assert/strict';
import { validateServiceConfig, serviceOrder, serviceDraft } from './service-config.mjs';
import { validateWebRequest, redactWebEvidence } from './web-runner.mjs';
const python={id:'api',runtime:'python',directory:'.',install:['pip','install','-r','Backend/requirements.txt'],test:[],build:[],start:['python','-m','uvicorn','Backend.main:app','--host','0.0.0.0','--port','8000'],port:8000,readyPath:'/health',dependsOn:[],env:{AUTH_MODE:'demo'},generatedEnv:['REGENERATION_SIGNING_KEY','GEMINI_API_KEY']};
const node={id:'web',runtime:'node',directory:'Frontend',install:['npm','ci'],test:['npm','run','test'],build:['npm','run','build'],start:['npm','run','dev','--','--host','0.0.0.0','--port','5173','--strictPort'],port:5173,readyPath:'/',dependsOn:['api'],env:{},generatedEnv:[]};
export const config={schemaVersion:1,repository:'CHENYUAN0813/ai-task-planner',commit:'0f8aba6eaff9bc05a3b3eeeb0ec6b1c35a70ebf9',services:[node,python],browser:{service:'web',path:'/',expectedText:'Dashboard',requiredApi:[{service:'api',path:'/auth/config'}]}};
assert.deepEqual(serviceOrder(config.services).map(s=>s.id),['api','web']);
assert.deepEqual(validateServiceConfig(JSON.parse(JSON.stringify(config))),config);
validateWebRequest({caseId:'multi-service',config,confirmUnknownCode:true});
assert.throws(()=>validateWebRequest({caseId:'multi-service',config,confirmUnknownCode:false}));
for(const mutate of [c=>c.services[0].dependsOn=['missing'],c=>c.services[1].dependsOn=['web'],c=>c.services[0].port=8000,c=>c.services[0].directory='../escape',c=>c.services[0].start=['sh','-c','echo hi'],c=>c.services[0].env={NODE_OPTIONS:'--require /host'},c=>c.services[0].env={GEMINI_API_KEY:'do-not-save'},c=>c.browser.path='//evil.test',c=>c.browser.requiredApi=[{service:'missing',path:'/'}],c=>c.services[0].start=['npm','run','dev\ninvalid']]) {
 const c=structuredClone(config);mutate(c);assert.throws(()=>validateServiceConfig(c));
}
const draft=serviceDraft({repository:config.repository,commit:config.commit,nodeProject:{packages:[]}},['Backend/main.py','Backend/requirements.txt'],'python -m uvicorn Backend.main:app --reload');
assert.equal(draft.services[0].runtime,'python');assert.equal(draft.browser,null);validateServiceConfig(draft);
assert.equal(serviceDraft({repository:config.repository,commit:config.commit},['Backend/main.py','Backend/requirements.txt'],'uvicorn other:app').services.length,0);
assert.equal(redactWebEvidence({log:'first second'},['first','second']).log,'[REDACTED] [REDACTED]');
console.log('PASS multi-service validation, dependency ordering, draft extraction and redaction');
if(process.argv.includes('--docker')) {
 const { startWebRun, getWebRun }=await import('./web-runner.mjs');
 const { getSavedRun }=await import('./run-store.mjs');
 const job=startWebRun({caseId:'multi-service',config,confirmUnknownCode:true});
 console.log('RUN',job.id);
 let record;
 for(let i=0;i<650;i++) { await new Promise(r=>setTimeout(r,1000));record=getWebRun(job.id) ?? getSavedRun(job.id);if(i%20===0)console.log(record?.steps?.at(-1)?.name,record?.status);if(record?.finishedAt)break; }
 console.log(JSON.stringify({id:job.id,status:record?.status,diagnosis:record?.diagnosis,cleanup:record?.cleanup,checks:record?.browser?.checks}));
 assert.equal(record.status,'SUCCEEDED');assert.equal(record.cleanup,'COMPLETE');assert.equal(record.browser.checks.length,4);
}

if(process.argv.includes('--docker-regression')) {
  const { startWebRun, getWebRun, cancelWebRun }=await import('./web-runner.mjs');
  const { getSavedRun }=await import('./run-store.mjs');
  const single={...structuredClone(config),repository:'amannn/vite-react-starter',commit:'730072fb4865d1a7c71fbdba0d403161914b47e9',services:[{...node,directory:'.',dependsOn:[],test:[]}],browser:{service:'web',path:'/',expectedText:'',requiredApi:[]}};
  async function finish(id) {for(let i=0;i<650;i++){const r=getWebRun(id)??getSavedRun(id);if(r?.finishedAt)return r;await new Promise(r=>setTimeout(r,1000));}cancelWebRun(id);throw Error('timeout');}
  const cancelled=startWebRun({caseId:'multi-service',config:single,confirmUnknownCode:true});
  for(let i=0;i<60;i++){if(getWebRun(cancelled.id)?.steps.some(s=>s.name==='Prepare isolated environment'))break;await new Promise(r=>setTimeout(r,500));}
  cancelWebRun(cancelled.id); const stopped=await finish(cancelled.id);assert.equal(stopped.status,'CANCELLED');assert.equal(stopped.cleanup,'COMPLETE');console.log('PASS cancel/cleanup',stopped.id);
  for(const negative of [false,true]) {
    const c=structuredClone(single);if(negative)c.browser.requiredApi=[{service:'web',path:'/not-requested-by-browser'}];
    const r=await finish(startWebRun({caseId:'multi-service',config:c,confirmUnknownCode:true}).id);
    console.log('RESULT',r.id,r.status,r.diagnosis??'');assert.equal(r.status,negative?'FAILED':'SUCCEEDED');assert.equal(r.cleanup,'COMPLETE');
    assert.equal(r.verification.status,negative?'FAILED':'VERIFIED');assert.equal(r.steps.find(s=>s.name==='web: test').status,'SKIPPED');
  }
}

if(process.argv.includes('--docker-api')) {
 const {startWebRun,getWebRun}=await import('./web-runner.mjs'); const {getSavedRun}=await import('./run-store.mjs');
 const c={...structuredClone(config),services:[python],browser:null};const job=startWebRun({caseId:'multi-service',config:c,confirmUnknownCode:true});
 console.log('API RUN',job.id);let r;for(let i=0;i<650;i++){await new Promise(resolve=>setTimeout(resolve,1000));r=getWebRun(job.id)??getSavedRun(job.id);if(r?.finishedAt)break;}
 console.log('API RESULT',r.id,r.status,r.diagnosis??'');assert.equal(r.status,'SUCCEEDED');assert.equal(r.cleanup,'COMPLETE');assert.equal(r.steps.at(-1).status,'SKIPPED');assert.equal(r.browser,null);
}
