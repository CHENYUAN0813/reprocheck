import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fetchPinnedSource, archivePinnedSource } from './npm-source.mjs';
import { batchScope } from './batch-config.mjs';
import { prepareBatchImage } from './batch-image.mjs';
const parser = fileURLToPath(new URL('./parse-junit.py',import.meta.url));
export function batchVerdict(exitCodes, report, expectedReport) {
  if (exitCodes.some(c=>c !== 0) || report && (report.failures || report.errors)) return 'FAILED';
  return expectedReport && report?.passed > 0 ? 'VERIFIED' : 'INCOMPLETE';
}
export async function executeBatchPlan(job,{directory,app,stage,docker,command}) {
  const c=job.batchConfig;
  let archive, checkout, paths;
  await stage('Fetch pinned public source on host',async()=>{
    ({checkout,paths}=await fetchPinnedSource(directory,c,command));
    if(c.directory!=='.' && !paths.some(p=>p.startsWith(c.directory+'/'))) throw Error('Batch directory not found');
    if(c.junit && paths.includes(posix.normalize(c.directory+'/'+c.junit))) throw Error('JUnit output must not be a committed source file');
    const result=await archivePinnedSource(directory,c,command,checkout);archive=result.archive;job.sourceArchiveSha256=result.sha256;
  });
  const imageId=await prepareBatchImage(job,{directory,checkout,paths,stage,docker,command});
  await stage('Prepare isolated batch environment',async()=>{
    const inspected=await docker(['image','inspect',imageId],{logOutput:false});
    const metadata=JSON.parse(inspected.output)[0];
    if(metadata.Id!==imageId || metadata.Os!=='linux' || Object.keys(metadata.Config?.Volumes??{}).length) throw Error('Use a local Linux image without declared volumes');
    job.imageId=metadata.Id;
    await docker(['run','-d','--name',app,'--init','--user','65534:65534','--read-only','--tmpfs',`/tmp:rw,nosuid,size=${c.memoryMb}m`,'--cpus','2','--memory',`${c.memoryMb}m`,'--pids-limit','256','--cap-drop','ALL','--security-opt','no-new-privileges','--network','none','--workdir','/tmp','--env','HOME=/tmp','--entrypoint','/bin/sh',job.imageId,'-c',`exec timeout ${c.timeoutMinutes*60} sleep ${c.timeoutMinutes*60}`]);
    if(statSync(archive).size>64*1024*1024) throw Error('Batch source archive exceeds 64 MiB');
    await docker(['exec','-i',app,'sh','-c','mkdir /tmp/project && tar --no-same-owner -xf - -C /tmp/project'],{input:readFileSync(archive)});
  });
  const cwd=posix.normalize('/tmp/project/'+c.directory);
  const codes=[];
  job.batch={exitCodes:codes,report:null,reportError:null,scope:batchScope};
  try {
    for(const [i,args] of c.commands.entries()) await stage(`Batch command ${i+1}`,async()=>{
      const result=await docker(['exec',...Object.entries(c.env).flatMap(([k,v])=>['--env',`${k}=${v}`]),'-w',cwd,app,...args],{timeout:c.timeoutMinutes*60000,tolerate:true});
      codes.push(result.code);
      if(result.code!==0) throw Error(`Batch command ${i+1} exited ${result.code}`);
    });
  } finally {
    // Evidence is independent of retained console text. Reports are self-reported by the tested repository.
    if(c.junit && job.status==='RUNNING') {
      try {
        const result=await docker(['exec',app,'python','-I','-c',"import os,sys,base64,stat; p=sys.argv[1]; assert os.path.realpath(p)==p; f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK); s=os.fstat(f); assert stat.S_ISREG(s.st_mode) and s.st_size<=262144; data=os.read(f,262145); assert len(data)<=262144; print(base64.b64encode(data).decode())",posix.normalize(cwd+'/'+c.junit)],{logOutput:false});
        const encoded=result.output.trim();
        if(!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length>349528) throw Error('Invalid bounded JUnit evidence');
        const bytes=Buffer.from(encoded,'base64');
        const parsed=await command('python',['-I',parser],{input:bytes,logOutput:false});
        job.batch.report=JSON.parse(parsed.output);
        job.batch.reportSha256=createHash('sha256').update(bytes).digest('hex');
        writeFileSync(join(directory,'junit.xml'),bytes);
        job.batch.reportUrl=`/api/web/runs/${job.id}/junit`;
      } catch(error) {job.batch.reportError=error.message;}
    }
  }
  const status=batchVerdict(codes,job.batch.report,Boolean(c.junit));
  job.verification={status,scope:batchScope};
  if(c.junit && !job.batch.report) throw Error('JUnit report missing or invalid: '+job.batch.reportError);
  if(status==='FAILED') throw Error('JUnit contains failed tests or errors');
}
export function batchReport(id) {
  if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))return null;
  try{return readFileSync(new URL(`./.reprocheck/web/${id}/junit.xml`,import.meta.url));}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
