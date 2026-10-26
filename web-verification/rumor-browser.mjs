import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: {width:1440,height:900}, serviceWorkers:'block' });
page.setDefaultTimeout(15000);
const checks=[]; const exceptions=[]; let error=null;
page.on('pageerror', e=>exceptions.push(e.message));
await page.route('**/*', route=>new URL(route.request().url()).origin==='http://127.0.0.1:5173'?route.continue():route.abort());
const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('rumor-control-save-v1')));
try {
  await page.goto('http://127.0.0.1:5173/',{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'AI 谣言防控局',exact:true}).waitFor();
  assert.equal((await state()).round,0);
  checks.push({name:'Game loads at round zero',status:'PASS'});
  await page.getByRole('button',{name:'调查线索并运行本回合',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rumor-control-save-v1'))?.round===1);
  const investigated=await state();
  assert.equal(investigated.ownedEvidenceIds.length,1);
  assert.equal(investigated.playerActions[0].type,'调查');
  checks.push({name:'Investigation obtains evidence and advances round',status:'PASS'});
  const [response]=await Promise.all([
    page.waitForResponse(r=>r.url().endsWith('/api/generate')&&r.request().method()==='POST'),
    page.getByRole('button',{name:'提交线索并运行本回合',exact:true}).click(),
  ]);
  assert.ok(!response.ok(),'Offline service must not masquerade as live Ollama');
  await page.getByText('模型调用失败，本回合已使用规则决策',{exact:false}).waitFor();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rumor-control-save-v1'))?.round===2);
  const submitted=await state();
  assert.equal(submitted.modelFallbacks,1); assert.equal(submitted.modelSuccesses,0);
  assert.equal(submitted.playerActions[1].type,'提交');
  assert.ok(submitted.residents.some(r=>r.memories.some(m=>m.evidenceId===submitted.ownedEvidenceIds[0])));
  checks.push({name:'Submission falls back when Ollama is unavailable',status:'PASS',httpStatus:response.status()});
  await page.reload({waitUntil:'networkidle'});
  await page.getByText('已恢复本地存档',{exact:false}).waitFor();
  assert.deepEqual(await state(),submitted);
  assert.deepEqual(exceptions,[]);
  checks.push({name:'Game state survives reload',status:'PASS'});
} catch(e) {error=e.message;}
try {await page.screenshot({path:'/evidence/result.png',fullPage:true});} catch {}
await writeFile('/evidence/result.json',JSON.stringify({checks,error,passed:!error&&checks.length===4,ai:{status:'NOT_RUN',reason:'Live Ollama is not provisioned; only unavailable-service fallback is tested.'}}));
await browser.close();process.exitCode=error?1:0;
