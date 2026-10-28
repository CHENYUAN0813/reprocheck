import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { prepareBatchImage, buildSourcePaths } from './batch-image.mjs';
import { validateBatchConfig, findDockerfiles } from './batch-config.mjs';
import { readFileSync } from 'node:fs';
import { stopWebCommand } from './web-runner.mjs';
import { getSavedRun } from './run-store.mjs';

assert.deepEqual(findDockerfiles(['Dockerfile','ci/Dockerfile.cpu','app/web.Dockerfile','README.md']),['Dockerfile','ci/Dockerfile.cpu','app/web.Dockerfile']);
assert.deepEqual(buildSourcePaths({context:'ci',dockerfile:'Dockerfile'},['ci/Dockerfile']),{context:'ci',dockerfile:'Dockerfile',source:'ci/Dockerfile'});
assert.throws(()=>buildSourcePaths({context:'wrong',dockerfile:'Dockerfile'},['ci/Dockerfile']));
const plan=JSON.parse(readFileSync('examples/rhinoforge-batch.json'));
assert.deepEqual(validateBatchConfig(plan),plan);
for(const change of [c=>c.build.args={PASSWORD:'x'},c=>c.build.context='/host',c=>c.build.dockerfile='../../Dockerfile',c=>c.build.ssh=true,c=>c.build.args={X:'a\nb'}]){const c=structuredClone(plan);change(c);assert.throws(()=>validateBatchConfig(c));}
console.log('PASS build plans, Dockerfile discovery and context boundaries');

if(process.argv.includes('--docker')) {
  const directory=mkdtempSync(join(tmpdir(),'reprocheck-build-test-'));
  let cancelBuild=false;
  const command=(program,args,options={})=>new Promise((resolve,reject)=>{
    const child=spawn(program,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';let stopped=false;
    child.stdin.on('error',()=>{});child.stdin.end(options.input??undefined);
    for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output+=data;if(cancelBuild&&program==='docker'&&args[0]==='build'&&output.includes('build-cancel-marker')){cancelBuild=false;stopped=true;stopWebCommand(child);}});
    child.on('error',reject);child.on('close',code=>code===0&&!stopped||options.tolerate?resolve({code,output}):reject(Error(stopped?'cancelled':output)));
  });
  try {
    await command('git',['init',directory]);await command('git',['-C',directory,'config','core.autocrlf','false']);
    async function commit(contents){writeFileSync(join(directory,'Dockerfile'),contents);await command('git',['-C',directory,'add','Dockerfile']);await command('git',['-C',directory,'-c','user.name=Test','-c','user.email=test@example.com','commit','-m','build fixture']);return (await command('git',['-C',directory,'rev-parse','HEAD'])).output.trim();}
    const [runId]=JSON.parse(readFileSync('.reprocheck/batch-test-runs.json','utf8'));
    const tag=getSavedRun(runId)?.imageBuild?.cacheTag;
    assert.match(tag??'',/^reprocheck-batch:[a-f0-9]{64}$/,'Run node test-batch.mjs --docker first to prepare the test image');
    const base=`FROM ${tag}\n`;
    const commitId=await commit(base+`RUN echo build-cancel-marker-${Date.now()} && sleep 5\n`);
    const config={...plan,repository:'fixture/build',commit:commitId,build:{context:'.',dockerfile:'Dockerfile',args:{}}};
    const helpers={directory,checkout:directory,paths:['Dockerfile'],stage:async(_name,fn)=>fn(),command,docker:(args,options)=>command('docker',args,options)};
    cancelBuild=true;await assert.rejects(prepareBatchImage({batchConfig:config},helpers),/cancelled/);console.log('PASS cancel running Docker build');
    const retry={batchConfig:config};const id=await prepareBatchImage(retry,helpers);assert.match(id,/^sha256:/);assert.equal(retry.imageBuild.status,'BUILT');
    await new Promise(r=>setTimeout(r,1200));
    const cached={batchConfig:config};assert.equal(await prepareBatchImage(cached,helpers),id);assert.equal(cached.imageBuild.status,'REUSED');assert.equal(cached.imageBuild.contextSha256,retry.imageBuild.contextSha256);console.log('PASS retry and exact-plan cache reuse');
    const badCommit=await commit(base+'RUN exit 23\n');await assert.rejects(prepareBatchImage({batchConfig:{...config,commit:badCommit}},helpers));console.log('PASS build failure stops before execution');
  } finally {rmSync(directory,{recursive:true,force:true});}
}
