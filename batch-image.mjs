import { readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { createHash } from 'node:crypto';

export function buildSourcePaths(build, paths) {
  const context=posix.normalize(build.context);
  const dockerfile=posix.normalize(build.dockerfile);
  const source=posix.join(context,dockerfile);
  if(!paths.includes(source)) throw Error('Dockerfile not found inside the configured build context at the pinned commit');
  return {context,dockerfile,source};
}

export async function prepareBatchImage(job,{directory,checkout,paths,stage,docker,command}) {
  const c=job.batchConfig;
  if(!c.build) return c.image;
  const {context,dockerfile,source}=buildSourcePaths(c.build,paths);
  let imageId;
  await stage('Build or reuse dependency image',async()=>{
    const archive=join(directory,'build-context.tar');
    // Tree archives otherwise use the current time, making identical subdirectories miss the cache.
    await command('git',['-c','core.autocrlf=false','-c','core.eol=lf','-C',checkout,'archive','--format=tar','--mtime=1970-01-01T00:00:00Z','--output',archive,context==='.'?c.commit:`${c.commit}:${context}`]);
    if(statSync(archive).size>64*1024*1024) throw Error('Build context exceeds 64 MiB');
    const bytes=readFileSync(archive);
    const contextSha256=createHash('sha256').update(bytes).digest('hex');
    const args=Object.entries(c.build.args).sort(([a],[b])=>a.localeCompare(b));
    const key=createHash('sha256').update(JSON.stringify([c.repository,c.commit,contextSha256,dockerfile,args])).digest('hex');
    const tag=`reprocheck-batch:${key}`;
    job.imageBuild={dockerfile:source,context,contextSha256,args:Object.fromEntries(args),cacheTag:tag,status:'BUILDING'};
    const cached=await docker(['image','inspect','--format','{{.Id}}',tag],{tolerate:true,logOutput:false});
    if(cached.code===0 && /^sha256:[a-f0-9]{64}$/.test(cached.output.trim())) {
      imageId=cached.output.trim();job.imageBuild.status='REUSED';
    } else {
      // Send only the pinned Git archive, never a host checkout or its credentials.
      const iidfile=join(directory,'built-image.id');
      await docker(['build','--progress=plain','--file',dockerfile,'--tag',tag,'--iidfile',iidfile,...args.flatMap(([k,v])=>['--build-arg',`${k}=${v}`]),'-'],{input:bytes,timeout:c.timeoutMinutes*60000});
      imageId=readFileSync(iidfile,'utf8').trim();
      if(!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw Error('Build did not produce an immutable image ID');
      job.imageBuild.status='BUILT';
    }
    job.imageBuild.imageId=imageId;
  });
  return imageId;
}
