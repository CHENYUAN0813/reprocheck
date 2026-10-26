import { useEffect, useState } from 'react';
import { validateServiceConfig, serviceOrder } from '../service-config.mjs';
import { useLanguage } from './language.jsx';
function ServiceEditor({service,onSave,onError}) {
  const {t}=useLanguage();
  const [draft,setDraft]=useState(service);
  const [commands,setCommands]=useState(() => Object.fromEntries(['install','test','build','start'].map(k=>[k,JSON.stringify(service[k])])));
  const [environment,setEnvironment]=useState(JSON.stringify(service.env));
  useEffect(()=>{setDraft(service);setEnvironment(JSON.stringify(service.env));setCommands(Object.fromEntries(['install','test','build','start'].map(k=>[k,JSON.stringify(service[k])])));},[service]);
  const edit=(key,value)=>setDraft({...draft,[key]:value});
  function save(){try{onSave({...draft,env:JSON.parse(environment),...Object.fromEntries(Object.entries(commands).map(([k,v])=>[k,JSON.parse(v)]))});}catch(e){onError(e.message);}}
  return <details><summary>{t('Edit this service')}</summary>
    <label>{t('Runtime')}<select value={draft.runtime} onChange={e=>edit('runtime',e.target.value)}><option value="node">Node.js</option><option value="python">Python</option></select></label>
    <label>{t('Working directory')}<input value={draft.directory} onChange={e=>edit('directory',e.target.value)} /></label>
    <p>{t('Commands are JSON argument arrays, for example ["npm","run","dev"]. Save changes to apply them.')}</p>
    {Object.entries(commands).map(([k,v])=><label key={k}>{t(k)}<input value={v} onChange={e=>setCommands({...commands,[k]:e.target.value})}/></label>)}
    <label>{t('Service port')}<input type="number" value={draft.port} onChange={e=>edit('port',Number(e.target.value))}/></label>
    <label>{t('Readiness path')}<input value={draft.readyPath} onChange={e=>edit('readyPath',e.target.value)}/></label>
    <label>{t('Depends on (comma separated IDs)')}<input value={draft.dependsOn.join(',')} onChange={e=>edit('dependsOn',e.target.value.split(',').map(s=>s.trim()).filter(Boolean))}/></label>
    <label>{t('Environment JSON (no credentials)')}<input value={environment} onChange={e=>setEnvironment(e.target.value)}/></label>
    <label>{t('Generated names (comma separated)')}<input value={draft.generatedEnv.join(',')} onChange={e=>edit('generatedEnv',e.target.value.split(',').map(s=>s.trim()).filter(Boolean))}/></label>
    <button type="button" onClick={save}>{t('Save service changes')}</button>
  </details>;
}
export function ServiceConfiguration({value,onChange,onError,disabled}) {
  const {t}=useLanguage();
  const [text,setText]=useState('');
  useEffect(()=>setText(JSON.stringify(value,null,2)),[value]);
  function apply(raw) { try { onChange(validateServiceConfig(JSON.parse(raw))); } catch(e) { onError(e.message); } }
  function download() {
    try {const data=validateServiceConfig(value);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='reprocheck-services.json';a.click();URL.revokeObjectURL(url);} catch(e){onError(e.message);}
  }
  let ordered = value?.services ?? [];
  try { ordered = serviceOrder(ordered); } catch {}
  return <fieldset className="npm-configuration" disabled={disabled}><legend>{t('Review multi-service plan')}</legend>
    <p>{t('Node.js 24 + Python 3.12. Services share one temporary container and localhost; the browser has a separate filesystem. Installation is online; execution is offline. No host mounts or published ports.')}</p>
    <p role="note">{t('This is a draft, not a complete interpretation of README. Confirm commands, directories, ports and environment. Plain environment values are saved: never enter credentials. generatedEnv creates disposable random values, not real provider keys. Model inference is not tested.')}</p>
    {!value?.services?.length && <p role="alert">{t('No supported service was identified. Import or edit a service plan before running.')}</p>}
    {ordered.map(s=><section key={s.id}><h3>{s.id} · {s.runtime}</h3><p>{t('Working directory')} <code>{s.directory}</code> · {t('Depends on')} {s.dependsOn.join(', ') || '—'}</p>
      <ol>{['install','test','build','start'].map(k=><li key={k}>{t(k)} {s[k]?.length ? <code>{JSON.stringify(s[k])}</code> : <span>{t('Not configured; not verified')}</span>}</li>)}</ol>
      <p>{t('Readiness URL')} <code>http://127.0.0.1:{s.port}{s.readyPath}</code></p>
      <p>{t('Environment variables')} <code>{JSON.stringify(s.env)}</code></p><p>{t('Generated ephemeral values')} <code>{s.generatedEnv.join(', ') || '—'}</code></p>
    <ServiceEditor service={s} onError={onError} onSave={next=>{const config={...value,services:value.services.map(item=>item.id===s.id?next:item)};onChange(validateServiceConfig(config));}} />
    </section>)}
    <p>{t('Browser checks')} <code>{JSON.stringify(value?.browser ?? null)}</code></p>
    <p>{t('Only the configured checks are verified. Add requiredApi entries to verify that the browser actually receives responses from the backend.')}</p>
    <details><summary>{t('Edit plan JSON / import / export')}</summary><label>{t('Service plan JSON')}<textarea rows={24} value={text} onChange={e=>setText(e.target.value)} /></label>
      <button type="button" onClick={()=>apply(text)}>{t('Apply plan')}</button><button type="button" onClick={download}>{t('Export plan')}</button>
      <label>{t('Import plan')}<input type="file" accept=".json,application/json" onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;if(f.size>24000){onError('Configuration too large');return;}apply(await f.text());}} /></label>
    </details></fieldset>;
}
