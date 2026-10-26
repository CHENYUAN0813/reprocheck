import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fetchPinnedSource, archivePinnedSource } from './npm-source.mjs';
import { serviceOrder, serviceScope } from './service-config.mjs';
export const serviceImage = 'reprocheck-services:1';
export async function executeServicePlan(job, { directory, app, tester, stage, docker, command, registerSecrets }) {
  const config = job.serviceConfig;
  let archive;
  await stage('Fetch pinned public source on host', async () => {
    const { checkout, paths } = await fetchPinnedSource(directory,config,command);
    for (const s of config.services) {
      if (s.directory !== '.' && !paths.some(p=>p.startsWith(s.directory+'/'))) throw new Error(`Missing service directory: ${s.directory}`);
      if (s.runtime === 'node') {
        const manifestPath = (s.directory === '.' ? '' : s.directory+'/')+'package.json';
        if (!paths.includes(manifestPath)) throw new Error(`Missing ${manifestPath}`);
        const pkg = JSON.parse((await command('git',['-C',checkout,'show',`${config.commit}:${manifestPath}`])).output);
        if (pkg.workspaces || pkg.packageManager && !String(pkg.packageManager).startsWith('npm@')) throw new Error('Only npm packages without workspaces are supported');
        const parents=s.directory==='.'?[]:s.directory.split('/');
        for(let depth=0;depth<parents.length;depth++) {
          const parentPath=[...parents.slice(0,depth),'package.json'].join('/');
          if(paths.includes(parentPath)) {
            const parent=JSON.parse((await command('git',['-C',checkout,'show',`${config.commit}:${parentPath}`])).output);
            if(parent.workspaces) throw new Error('npm workspaces are not supported yet');
          }
        }
        for (const args of [s.test,s.build,s.start]) {
          if (args[0] === 'npm' && args[1] === 'run' && typeof pkg.scripts?.[args[2]] !== 'string') throw new Error(`Missing npm script: ${args[2]}`);
        }
      }
    }
    const result = await archivePinnedSource(directory,config,command,checkout); archive=result.archive; job.sourceArchiveSha256=result.sha256;
  });
  await stage('Prepare isolated environment',async()=>{
    job.imageId=(await docker(['image','inspect',serviceImage,'--format','{{.Id}}'])).output.trim();
    job.browserImageId=(await docker(['image','inspect','reprocheck-web-browser:1','--format','{{.Id}}'])).output.trim();
    await docker(['run','-d','--name',app,'--init','--cpus','2','--memory','2g','--pids-limit','256','--cap-drop','ALL','--security-opt','no-new-privileges','--network','bridge','--workdir','/tmp',job.imageId,'timeout','600','sleep','600']);
    await docker(['cp',archive,`${app}:/tmp/source.tar`]);
    await docker(['exec',app,'sh','-c','mkdir /tmp/project && tar --no-same-owner -xf /tmp/source.tar -C /tmp/project']);
  });
  const ordered=serviceOrder(config.services);
  const cwd=s=>'/tmp/project'+(s.directory==='.'?'':'/'+s.directory);
  const environments = new Map(ordered.map(s=>[s.id,{...s.env,...Object.fromEntries(s.generatedEnv.map(k=>[k,randomBytes(32).toString('hex')]))}]));
  registerSecrets(ordered.flatMap(s=>s.generatedEnv.map(k=>environments.get(s.id)[k])));
  const argsFor=(s,args)=>s.runtime==='python' ? [`/tmp/venv-${s.id}/bin/${args[0]}`,...args.slice(1)] : args;
  // Environment values travel through stdin, not host process arguments. Generated secrets never enter records.
  const invoke=async(s,args,background=false)=>docker(['exec','-i','-w',cwd(s),app,'python','-c',
    "import json,os,subprocess,sys; c=json.load(sys.stdin); env=dict(os.environ,**c['env']); log=open(c['log'],'a') if c['background'] else None; p=subprocess.Popen(c['args'],env=env,stdout=log,stderr=log,start_new_session=c['background']); sys.exit(0 if c['background'] else p.wait())"],
    {input:JSON.stringify({env:environments.get(s.id),args:argsFor(s,args),background,log:`/tmp/${s.id}.log`}),timeout:240000});
  for (const s of ordered) await stage(`${s.id}: install`,async()=>{
    if(s.runtime==='python') await docker(['exec',app,'python','-m','venv',`/tmp/venv-${s.id}`]);
    await invoke(s,s.install);
  });
  await docker(['network','disconnect','bridge',app]);
  for(const s of ordered) for(const task of ['test','build']) {
    if(s[task].length) await stage(`${s.id}: ${task}`,()=>invoke(s,s[task]));
    else job.steps.push({name:`${s.id}: ${task}`,status:'SKIPPED',reason:'Not configured; not verified'});
  }
  for(const s of ordered) await stage(`${s.id}: start and API readiness`,async()=>{
    await invoke(s,s.start,true);
    await docker(['exec',app,'node','--input-type=module','-e',
      `for(let i=0;i<90;i++){try{const r=await fetch(${JSON.stringify(`http://127.0.0.1:${s.port}${s.readyPath}`)},{redirect:'error',signal:AbortSignal.timeout(1000)});if(r.ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,500))}process.exit(1)`]);
  });
  if(config.browser) await stage('Browser acceptance',async()=>{
    const b=config.browser, service=config.services.find(s=>s.id===b.service);
    const browserConfig={port:service.port,path:b.path,expectedText:b.expectedText,allowedPorts:config.services.map(s=>s.port),
      requiredApi:b.requiredApi.map(a=>({port:config.services.find(s=>s.id===a.service).port,path:a.path}))};
    await docker(['run','--name',tester,'--init','--cpus','2','--memory','1g','--pids-limit','256','--shm-size','256m','--cap-drop','ALL','--security-opt','no-new-privileges','--network',`container:${app}`,job.browserImageId,'timeout','120','node','/opt/browser/npm-browser.mjs',JSON.stringify(browserConfig)],{timeout:140000,tolerate:true});
    await docker(['cp',`${tester}:/evidence/result.json`,join(directory,'result.json')]);
    job.browser=JSON.parse(readFileSync(join(directory,'result.json'),'utf8'));
    await docker(['cp',`${tester}:/evidence/result.png`,join(directory,'result.png')]);
    job.screenshot=`/api/web/runs/${job.id}/screenshot`;
    if(job.browser.passed!==true || job.browser.checks?.length!==3+b.requiredApi.length || job.browser.checks.some(c=>c.status!=='PASS')) throw new Error(job.browser.error || 'Browser verification failed');
  });
  else job.steps.push({name:'Browser acceptance',status:'SKIPPED',reason:'API-only plan; no browser configured'});
  job.verification={status:'VERIFIED',scope:serviceScope};
}
