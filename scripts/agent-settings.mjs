import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {availableParallelism} from 'node:os';
import {normalizeResources} from './resource-control.mjs';

export const RESOURCE_PRESETS={
 eco:{cpuThreads:4,cpuAffinityPercent:25,numBatch:64,gpuReserveMiB:3072,cooldownMs:3000,keepAliveSeconds:30},
 balanced:{cpuThreads:6,cpuAffinityPercent:50,numBatch:128,gpuReserveMiB:2048,cooldownMs:1500,keepAliveSeconds:60},
 performance:{cpuThreads:12,cpuAffinityPercent:75,numBatch:256,gpuReserveMiB:1024,cooldownMs:250,keepAliveSeconds:120}
};
function readJson(file,fallback){try{return JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''))}catch(error){if(error.code==='ENOENT')return fallback;throw error}}
function atomicJson(file,value){const temp=file+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n','utf8');renameSync(temp,file)}

export function createAgentSettings({projectRoot,controller,onModel=()=>{},startupReserve=controller.config.gpuReserveMiB,pythonReady=true,managedOllama=process.env.AGENT_MANAGED_OLLAMA==='1'}){
 const runtime=resolve(projectRoot,'.runtime'),resourceFile=resolve(runtime,'resource-settings.json'),modelFile=resolve(runtime,'agent-model.json');
 const maximumThreads=Math.max(1,availableParallelism()-2);
 const describe=()=>{
  const resources=controller.config;
  const preset=Object.keys(RESOURCE_PRESETS).find(key=>JSON.stringify(normalizeResources(RESOURCE_PRESETS[key]))===JSON.stringify(resources))||'custom';
  return {available:true,transport:'agent.py',pythonReady,managedOllama,localModel:readJson(modelFile,{}).model||'qwen3.5:4b',resources,preset,maxThreads:maximumThreads,
   busy:controller.pending>0,restartRequired:resources.gpuReserveMiB!==startupReserve,
   presets:Object.fromEntries(Object.entries(RESOURCE_PRESETS).map(([key,value])=>[key,normalizeResources(value)]))};
 };
 return {describe,handle(incoming,outgoing){
  const route=incoming.url.split('?')[0];if(route!=='/api/agent/settings')return false;
  const send=(status,value)=>{outgoing.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});outgoing.end(JSON.stringify(value))};
  const origin=incoming.headers.origin;
  if(origin&&origin!==`http://${incoming.headers.host}`){send(403,{error:'僅接受本機同來源設定。'});return true}
  if(incoming.method==='GET'){try{send(200,describe())}catch{send(500,{error:'無法讀取 Agent 設定。'})}return true}
  if(incoming.method!=='PUT'){send(405,{error:'Method not allowed'});return true}
  // A custom header and JSON content type prevent cross-site form submissions.
  if(incoming.headers['x-agent-settings']!=='1'||!String(incoming.headers['content-type']).startsWith('application/json')){send(403,{error:'設定請求缺少驗證標頭。'});return true}
  void (async()=>{
   try{
    const chunks=[];let size=0;for await(const chunk of incoming){size+=chunk.length;if(size>4096){send(413,{error:'設定內容過大。'});return}chunks.push(chunk)}
    let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{send(400,{error:'設定格式錯誤。'});return}
    if(!input||typeof input!=='object'||typeof input.localModel!=='string'||!/^\w[\w.:/-]{0,127}$/.test(input.localModel)){send(400,{error:'本地模型名稱格式錯誤。'});return}
    const provided=input.resources;
    if(!provided||Object.keys(controller.config).some(key=>!Number.isInteger(provided[key]))){send(400,{error:'算力設定必須填入整數。'});return}
    const next=normalizeResources(provided);
    if(Object.keys(next).some(key=>next[key]!==provided[key])){send(400,{error:'算力設定超出允許範圍。'});return}
    if(controller.pending){send(409,{error:'Agent 正在分析，請完成或停止後再套用設定。'});return}
    // Synchronous atomic file replacement prevents an inference starting halfway through an update.
    const previous=controller.config,oldModel=readJson(modelFile,{}),hadResources=existsSync(resourceFile);
    mkdirSync(runtime,{recursive:true});
    try{
     atomicJson(resourceFile,next);atomicJson(modelFile,{...oldModel,model:input.localModel});controller.update(next);onModel(input.localModel);
    }catch(error){if(hadResources)atomicJson(resourceFile,previous);throw error}
    send(200,describe());
   }catch{send(500,{error:'Agent 設定儲存失敗；請確認資料夾可寫入。'})}
  })();return true;
 }};
}
