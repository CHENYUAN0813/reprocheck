import assert from 'node:assert/strict';
import { scan } from './scan.mjs';
import worker from './worker.mjs';
import { scanNodeProject, detectProjectType } from './node-scan.mjs';
import { buildPreflight } from './runner.mjs';
import { translateCheck } from './src/i18n.mjs';
const sha = 'a'.repeat(40);
const manifest = JSON.stringify({ scripts: {dev:'vite',test:'node --test',build:'tsc -b && vite build'}, dependencies: {react:'^19'}, engines:{node:'>=22'} });
const files = {'README.md':'npm.cmd install\nnpm.cmd run dev\nnpm.cmd test\nOllama local model', 'package.json':manifest, 'package-lock.json':JSON.stringify({lockfileVersion:3,packages:{}}), 'src/main.tsx':'', 'test/game.test.ts':''};
const read = path => Promise.resolve(files[path]);
assert.equal(detectProjectType(Object.keys(files), []), 'node');
assert.equal(detectProjectType(['train.py'], []), 'python');
assert.equal(detectProjectType(['train.py','package.json'], []), 'mixed');
assert.equal(detectProjectType(['README.md','node_modules/x/a.py','dist/a.js'], ['vendor/requirements.txt']), 'unknown');
const node = await scanNodeProject(Object.keys(files), 'README.md', files['README.md'], read);
assert.equal(node.packages[0].installCommand,'npm ci');
assert.equal(node.packages[0].scripts.find(x=>x.name==='dev').kind,'service');
assert.equal(node.packages[0].recommendedScript,'test');
assert.equal(node.commands.length,3);
assert.equal(node.prerequisites[0].name,'Ollama');
assert.equal(node.executionSupported,false);
assert.ok(translateCheck(node.checks[0],'zh').startsWith('已找到 Node'));
const invalid = await scanNodeProject(['package.json'],null,'',async()=>'{');
assert.equal(invalid.checks[0].status,'FAIL');
const buildless = await scanNodeProject(['app.js'],null,'',async()=>{throw Error('unexpected read')});
assert.ok(buildless.checks.every(x=>x.status!=='FAIL'));
const yarn = await scanNodeProject(['package.json','yarn.lock'],null,'',async()=>manifest);
assert.equal(yarn.packages[0].installCommand,null);
const badLock = await scanNodeProject(['package.json','package-lock.json'],null,'',async path=>path==='package.json'?manifest:'{}');
assert.equal(badLock.packages[0].lockValid,false);
assert.equal(badLock.packages[0].installCommand,'npm install');
const nested = await scanNodeProject(Array.from({length:6},(_,i)=>`packages/${i}/package.json`),null,'',async()=>manifest);
assert.equal(nested.packages.length,5);
assert.ok(nested.checks.some(x=>x.id.startsWith('node_coverage')));
assert.equal(new Set(nested.checks.map(x=>x.id)).size,nested.checks.length);
await assert.rejects(scanNodeProject(['package.json'],null,'',async()=>{throw Error('upstream 401')}),/401/);
const originalFetch=globalThis.fetch;
async function fixtureScan(contents) {
  globalThis.fetch=async input=>{
    const url=new URL(input); const p=url.pathname;
    let value;
    if(p.endsWith('/commits/'+sha)) value={sha,commit:{tree:{sha:'tree'}}};
    else if(p.endsWith('/git/trees/tree')) value={tree:Object.keys(contents).map(path=>({path,type:'blob'}))};
    else if(p.includes('/contents/')) {assert.equal(url.searchParams.get('ref'),sha);const path=decodeURIComponent(p.split('/contents/')[1]);assert.ok(path in contents,path);value={content:Buffer.from(contents[path]).toString('base64')};}
    else value={default_branch:'main'};
    return {ok:true,json:async()=>value};
  };
  return scan('https://github.com/test/repo',undefined,sha);
}
try {
 const report=await fixtureScan(files);
 assert.equal(report.projectType,'node');assert.equal(report.summary.failures,0);
 assert.ok(!report.checks.some(x=>['dependencies','python_version','random_seed','dataset_instructions'].includes(x.id)));
 assert.deepEqual(report.workflows,[]);
 const hosted = await worker.fetch(new Request('https://reprocheck.test/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://github.com/test/repo',pinnedCommit:sha})}),{});
 assert.equal(hosted.status,200);assert.deepEqual(await hosted.json(),report);
 assert.throws(()=>buildPreflight(report,'quick'),/valid reproduction workflow/);
 const unknown=await fixtureScan({'README.md':'Plain documentation'});
 assert.equal(unknown.status,'UNSUPPORTED');assert.equal(unknown.summary.failures,0);
 const python=await fixtureScan({'README.md':'pip install -r requirements.txt\npython train.py','requirements.txt':'numpy==2.0.0','train.py':'print(1)'});
 assert.equal(python.projectType,'python');assert.ok(python.workflows.length);
 const mixed=await fixtureScan({...files,'requirements.txt':'numpy==2.0.0','train.py':'print(1)'});
 assert.equal(mixed.projectType,'mixed');assert.ok(mixed.nodeProject);assert.ok(mixed.checks.some(x=>x.id==='random_seed'));
} finally {globalThis.fetch=originalFetch;}
console.log('PASS stack-aware scan: pinned files, npm.cmd, services, invalid manifests, coverage, unknown/mixed/Python, and execution gate');
