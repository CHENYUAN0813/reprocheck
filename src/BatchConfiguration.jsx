import { useEffect, useState } from 'react';
import { validateBatchConfig, batchDraft, batchScope } from '../batch-config.mjs';
import { useLanguage } from './language.jsx';
export function BatchConfiguration({value,report,images=[],disabled,onChange,onError}) {
  const {t}=useLanguage();
  const [text,setText]=useState('');
  const [importStatus,setImportStatus]=useState(null);
  useEffect(()=>setText(JSON.stringify(value??batchDraft(report),null,2)),[value,report?.repository,report?.commit]);
  function apply(raw){try{onChange(validateBatchConfig(JSON.parse(raw)));onError('');}catch(e){onError(e.message);}}
  function download(){try{const c=validateBatchConfig(value);const url=URL.createObjectURL(new Blob([JSON.stringify(c,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='reprocheck-batch.json';a.click();URL.revokeObjectURL(url);}catch(e){onError(e.message);}}
  return <fieldset disabled={disabled} className="npm-configuration"><legend>{t('Review batch test plan')}</legend>
    <p>{t('Batch tasks finish after their commands exit. No service port or browser is required. Choose a local image or build dependencies from a reviewed Dockerfile at the pinned commit.')}</p>
    <p>{t('Test execution is offline, non-root, with a read-only image and temporary workspace. No host mounts, devices or credentials. Environment values are saved; never enter secrets.')}</p>
    <label>{t('Environment preparation')}<select value={value?.build?'build':'local'} onChange={e=>{const next={...(value??batchDraft(report)),image:''};if(e.target.value==='build')next.build={context:'.',dockerfile:'Dockerfile',args:{}};else delete next.build;onChange(next);}}><option value="local">{t('Reuse a local image')}</option><option value="build">{t('Build from repository Dockerfile')}</option></select></label>
    {value?.build ? <><p>{t('Image builds use network access and Docker builder resources, not the test container limits. Downloads and build cache use disk space. No host folders, credentials or secret build arguments are supplied.')}</p>
      {report?.repository===value.repository && report?.commit===value.commit && report?.dockerfiles?.length>0 && <label>{t('Dockerfiles found in this scan')}<select value="" onChange={e=>{if(!e.target.value)return;const parts=e.target.value.split('/');const dockerfile=parts.pop();onChange({...value,build:{context:parts.join('/')||'.',dockerfile,args:{}}});}}><option value="">{t('Select a Dockerfile to review')}</option>{report.dockerfiles.map(p=><option key={p} value={p}>{p}</option>)}</select></label>}
      <label>{t('Build context (repository-relative)')}<input value={value.build.context} onChange={e=>onChange({...value,build:{...value.build,context:e.target.value}})}/></label>
      <label>{t('Dockerfile (relative to build context)')}<input value={value.build.dockerfile} onChange={e=>onChange({...value,build:{...value.build,dockerfile:e.target.value}})}/></label>
      <a href={`https://github.com/${value.repository}/blob/${value.commit}/${[value.build.context,value.build.dockerfile].filter(x=>x!=='.').join('/')}`} target="_blank" rel="noreferrer">{t('Review pinned Dockerfile and dependency sources')}</a>
      <p>{t('Build arguments (edit in plan JSON)')} <code>{JSON.stringify(value.build.args)}</code></p>
      <p>{t('A matching previously built image is reused. Otherwise build logs appear before tests. Base tags and downloads can change; the resulting image ID is recorded.')}</p>
    </> : <label>{t('Local test image')}<select value={value?.image??''} onChange={e=>{const next={...(value??batchDraft(report)),image:e.target.value};onChange(next);}}><option value="">{t('Select a prepared image')}</option>{images.map(i=><option key={i.id} value={i.id}>{i.name} · {i.id.slice(7,19)}</option>)}</select></label>}
    {value && <><p>{t('Working directory')} <code>{value.directory}</code> · {value.memoryMb} MB · {value.timeoutMinutes} {t('minutes')}</p>
      <ol>{value.commands.map((a,i)=><li key={i}><code>{JSON.stringify(a)}</code></li>)}</ol>
      <p>{t('JUnit report path')} <code>{value.junit??'—'}</code></p></>}
    <label>{t('Import batch plan')}<input type="file" accept=".json,application/json" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;setImportStatus({name:f.name,loading:true});try{if(f.size>24000)throw Error('Configuration too large');const config=validateBatchConfig(JSON.parse(await f.text()));onChange(config);onError('');setImportStatus({name:f.name,config:JSON.stringify(config)});}catch(error){setImportStatus({name:f.name,error:error.message});onError(error.message);}}}/></label>
    {importStatus && <p role={importStatus.error?'alert':'status'}>{t(importStatus.loading?'Reading plan file…':importStatus.error?'Plan import failed':importStatus.config===JSON.stringify(value)?'Plan imported and applied':'Plan imported; current configuration has changed')} · {importStatus.name}{importStatus.error&&<> · {importStatus.error}</>}</p>}
    {value && <p>{t('Current plan target')}: <code>{value.repository} · {value.commit}</code></p>}
    <details open={!value?.commands?.length}><summary>{t('Edit plan JSON / import / export')}</summary><label>{t('Batch plan JSON')}<textarea rows={22} value={text} onChange={e=>setText(e.target.value)}/></label><button type="button" onClick={()=>apply(text)}>{t('Apply plan')}</button><button type="button" onClick={download}>{t('Export plan')}</button></details>
    <p>{t(batchScope)}</p>
  </fieldset>;
}
export function BatchEvidence({job}) {
  const {t}=useLanguage();const report=job.batch?.report;
  return <>{job.imageBuild && <><p>{t('Dependency image')}: {t(job.imageBuild.status)} · <code>{job.imageBuild.imageId??'—'}</code></p><p>{t('Build context (repository-relative)')}: <code>{job.imageBuild.context}</code> · <code>{job.imageBuild.dockerfile}</code></p></>}<p>{t(batchScope)}</p><p>{t('Command exit codes')} <code>{JSON.stringify(job.batch?.exitCodes??[])}</code></p>
    {report ? <><p>{t('Reported tests')}: {report.tests} · {t('PASS')}: {report.passed} · {t('FAIL')}: {report.failures} · {t('ERROR')}: {report.errors} · {t('SKIPPED')}: {report.skipped}</p>
      <details><summary>{t('Test case results')}</summary><ul>{report.cases.map((c,i)=><li key={i}>{t(c.status)} · {c.classname} · {c.name}</li>)}</ul>{report.casesTruncated&&<p>{t('Showing the first 200 cases; download JUnit for all cases.')}</p>}</details>
      <a className="download-button" href={job.batch.reportUrl}>{t('Download JUnit report')}</a></> : <p>{t('No valid JUnit report; test results are not verified.')}</p>}
    {job.batch?.reportError&&<p role="alert">{job.batch.reportError}</p>}
  </>;
}
