import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateBatchConfig } from './batch-config.mjs';
import { batchVerdict } from './batch-runner.mjs';
import { validateWebRequest, startWebRun, getWebRun, cancelWebRun } from './web-runner.mjs';
import { getSavedRun } from './run-store.mjs';
import { archivePinnedSource } from './npm-source.mjs';
const config=JSON.parse(readFileSync('examples/rhinoforge-batch.json','utf8'));
assert.deepEqual(validateBatchConfig(config),config);
validateWebRequest({caseId:'batch',config,confirmUnknownCode:true,confirmImageBuild:true});
assert.throws(()=>validateWebRequest({caseId:'batch',config,confirmUnknownCode:false}));
for(const mutate of [c=>c.image='python:latest',c=>c.build.context='../host',c=>c.build.dockerfile='../Dockerfile',c=>c.build.args={API_KEY:'secret'},c=>c.directory='../host',c=>c.junit='/tmp/report.xml',c=>c.env={TOKEN:'secret'},c=>c.timeoutMinutes=31,c=>c.memoryMb=99999,c=>c.commands=[],c=>c.commands=[['python','bad\narg']],c=>c.mount='/host']) {
  const c=structuredClone(config);mutate(c);assert.throws(()=>validateBatchConfig(c));
}
assert.throws(()=>validateWebRequest({caseId:'batch',config,confirmUnknownCode:true}));
function parse(xml,valid=true){const r=spawnSync('python',['-I','parse-junit.py'],{input:xml,encoding:'utf8',windowsHide:true});assert.equal(r.status,valid?0:1,r.stderr);return valid?JSON.parse(r.stdout):null;}
const report=parse('<testsuites><testsuite tests="3" failures="1" skipped="1" errors="0"><testcase name="pass"/><testcase name="fail"><failure>bad</failure></testcase><testcase name="skip"><skipped/></testcase></testsuite></testsuites>');
assert.equal(report.passed,1);assert.equal(batchVerdict([0],report,true),'FAILED');
assert.equal(batchVerdict([1],{passed:3},true),'FAILED');
assert.equal(batchVerdict([0],{passed:0,skipped:3},true),'INCOMPLETE');
assert.equal(batchVerdict([0],null,false),'INCOMPLETE');
assert.equal(batchVerdict([0],{passed:3,skipped:1},true),'VERIFIED');
for(const xml of ['<!DOCTYPE testsuite [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuite/>','<testsuite tests="2"><testcase/></testsuite>','<testsuite><testcase><failure/><skipped/></testcase></testsuite>','<testsuite>','x'.repeat(262145)])parse(xml,false);
assert.equal(parse('<testsuites><testsuite tests="1"><testsuite><testcase/></testsuite></testsuite></testsuites>').passed,1);
// A user's global autocrlf setting must not corrupt Linux entry scripts in archives.
const dir=mkdtempSync(join(tmpdir(),'reprocheck-archive-'));
try {
 const git=args=>{const r=spawnSync('git',args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout;};
 git(['init',dir]);git(['-C',dir,'config','core.autocrlf','false']);writeFileSync(join(dir,'run.sh'),'#!/bin/sh\necho ok\n');git(['-C',dir,'add','run.sh']);git(['-C',dir,'-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture']);
 const commit=git(['-C',dir,'rev-parse','HEAD']).trim();git(['-C',dir,'config','core.autocrlf','true']);
 const {archive}=await archivePinnedSource(dir,{commit},async(_program,args)=>({output:git(args)}),dir);
 const bytes=readFileSync(archive);assert.ok(bytes.includes(Buffer.from('#!/bin/sh\necho ok\n')));assert.ok(!bytes.includes(Buffer.from('#!/bin/sh\r\n')));
} finally {rmSync(dir,{recursive:true,force:true});}
console.log('PASS batch validation, consent, JUnit trust boundaries, verdicts and archive line endings');

if(process.argv.includes('--docker')) {
 const ids=[];
 async function finish(input,cancel=false){const j=startWebRun({caseId:'batch',config:input,confirmUnknownCode:true,confirmImageBuild:true});ids.push(j.id);console.log('RUN',j.id,input.repository);let didCancel=false;
  for(let i=0;i<950;i++){await new Promise(r=>setTimeout(r,1000));const r=getWebRun(j.id)||getSavedRun(j.id);if(cancel&&!didCancel&&r.steps.some(s=>s.name==='Batch command 1'&&s.status==='RUNNING')){cancelWebRun(j.id);didCancel=true;}if(r.finishedAt){assert.equal(r.cleanup,'COMPLETE');console.log('RESULT',r.id,r.status,r.verification.status,r.batch?.report?.tests,r.diagnosis??'');return r;}}
  cancelWebRun(j.id);throw Error('Test timed out');}
 const rhino=await finish(config);assert.equal(rhino.batch.report.tests,39);assert.equal(rhino.status,rhino.batch.report.failures?'FAILED':'SUCCEEDED');
 const cached=await finish(config);assert.equal(cached.imageBuild.status,'REUSED');assert.equal(cached.imageBuild.contextSha256,rhino.imageBuild.contextSha256);assert.equal(cached.imageId,rhino.imageId);
 const second=JSON.parse(readFileSync('examples/iniconfig-batch.json','utf8'));second.image=rhino.imageId;const success=await finish(second);assert.equal(success.status,'SUCCEEDED');assert.equal(success.verification.status,'VERIFIED');assert.ok(success.batch.report.passed>0);
 const xml='<testsuite tests="1"><testcase name="retained"/></testsuite>';
 const noisy={...second,commands:[['python','-c',`from pathlib import Path; Path('result.xml').write_text(${JSON.stringify(xml)}); print('x'*1000000)`]],junit:'result.xml'};
 const long=await finish(noisy);assert.equal(long.logTruncated,true);assert.equal(long.batch.report.passed,1);assert.equal(long.verification.status,'VERIFIED');
 const nonzero=await finish({...noisy,commands:[['python','-c',`from pathlib import Path; Path('result.xml').write_text(${JSON.stringify(xml)}); raise SystemExit(1)`]]});assert.equal(nonzero.status,'FAILED');assert.equal(nonzero.verification.status,'FAILED');assert.equal(nonzero.batch.report.passed,1);
 const missing=await finish({...second,junit:'absent.xml'});assert.equal(missing.status,'FAILED');assert.equal(missing.batch.report,null);
 const stopped=await finish({...second,commands:[['python','-c','import time; time.sleep(120)']],junit:null},true);assert.equal(stopped.status,'CANCELLED');
 const retry=await finish(second);assert.equal(retry.status,'SUCCEEDED');
 writeFileSync('.reprocheck/batch-test-runs.json',JSON.stringify(ids,null,2));
}
