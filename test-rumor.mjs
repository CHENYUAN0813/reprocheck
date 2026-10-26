import assert from 'node:assert/strict';
import { rumorCase, prepareRumorSource } from './rumor-case.mjs';
import { validateWebRequest, startWebRun, getWebRun, cancelWebRun, webScreenshot } from './web-runner.mjs';
import { getSavedRun } from './run-store.mjs';
const input={caseId:rumorCase.id,confirmUnknownCode:true};
validateWebRequest(input);
for(const value of [{...input,confirmUnknownCode:false},{...input,liveAi:true},{...input,geminiApiKey:'secret'},{...input,commit:'changed'},{...input,command:'npm start'}]) assert.throws(()=>validateWebRequest(value));
await assert.rejects(prepareRumorSource('.',async(_program,args)=>({code:0,output:args.includes('ls-tree')?`120000 blob ${'a'.repeat(40)}\tsrc/link\n`:''})),/Unreviewed/);
console.log('PASS pinned rumor case and credential/source boundaries');
if(process.argv.includes('--docker')) {
  async function completed(id) {
    for(let i=0;i<660;i++) {
      const job=getWebRun(id)??getSavedRun(id);
      if(job.finishedAt) return job;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    cancelWebRun(id);throw Error('Run deadline exceeded');
  }
  const cancelled=startWebRun(input);
  assert.equal(cancelWebRun(cancelled.id).status,'CANCELLED');
  assert.equal((await completed(cancelled.id)).cleanup,'COMPLETE');
  const job=startWebRun(input);
  console.log('Rumor run: '+job.id);
  const result=await completed(job.id);
  assert.equal(result.status,'SUCCEEDED',result.diagnosis+'\n'+result.log);
  assert.equal(result.commit,rumorCase.commit);
  assert.equal(result.verification.status,'VERIFIED');
  assert.equal(result.cleanup,'COMPLETE');
  assert.equal(result.browser.checks.length,4);
  assert.equal(result.browser.ai.status,'NOT_RUN');
  assert.ok(webScreenshot(result.id)?.length>1000);
  for(const name of ['Run npm test','Run npm lint','Run npm build']) assert.ok(result.steps.some(s=>s.name===name&&s.status==='SUCCEEDED'));
  console.log('PASS rumor installation, tests/lint/build, Vite readiness, Chromium actions, offline fallback, reload, cancellation/retry and cleanup: '+job.id);
}
