import {readFile} from 'node:fs/promises';
import {availableParallelism} from 'node:os';
import {resolve} from 'node:path';
export const DEFAULT_RESOURCES=Object.freeze({cpuThreads:6,cpuAffinityPercent:50,numBatch:128,gpuReserveMiB:2048,cooldownMs:1500,keepAliveSeconds:60});
export function normalizeResources(value={},cpus=availableParallelism()){
 const limits={cpuThreads:[1,Math.max(1,cpus-2)],cpuAffinityPercent:[10,90],numBatch:[32,256],gpuReserveMiB:[256,8192],cooldownMs:[0,30000],keepAliveSeconds:[10,600]};
 return Object.fromEntries(Object.entries(DEFAULT_RESOURCES).map(([key,fallback])=>{
  const number=value[key]===undefined?fallback:Number(value[key]);
  if(!Number.isInteger(number))throw Error(`Invalid resource setting: ${key}`);
  return [key,Math.min(limits[key][1],Math.max(limits[key][0],number))];
 }));
}
export async function loadResources(projectRoot){
 try{return normalizeResources(JSON.parse((await readFile(resolve(projectRoot,'.runtime/resource-settings.json'),'utf8')).replace(/^\uFEFF/,'')))}
 catch(error){if(error.code==='ENOENT')return normalizeResources();throw error}
}
function abortable(promise,signal){
 if(!signal)return promise;
 if(signal.aborted)return Promise.reject(signal.reason||new DOMException('Aborted','AbortError'));
 return new Promise((resolve,reject)=>{const cancel=()=>reject(signal.reason||new DOMException('Aborted','AbortError'));signal.addEventListener('abort',cancel,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));});
}
// Both normal and vision transports share this gate. The slot remains occupied
// until the response is consumed/cancelled, rather than only until headers arrive.
export function createResourceController(settings,{now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 let config=normalizeResources(settings),pending=0;let tail=Promise.resolve(),finished=-Infinity;
 return {get config(){return {...config}},get pending(){return pending},update(next){if(pending)throw Error('Agent is busy');config=normalizeResources(next);return {...config}},wrap(fetchImpl){return async(url,options={})=>{
  const address=String(url);
  if(!/^http:\/\/127\.0\.0\.1:11434\/api\/(?:chat|generate)$/.test(address)||options.method!=='POST'||typeof options.body!=='string')return fetchImpl(url,options);
  const payload=JSON.parse(options.body);
  payload.options={...payload.options,num_thread:config.cpuThreads,num_batch:config.numBatch};
  payload.keep_alive=`${config.keepAliveSeconds}s`;
  pending++;
  const previous=tail;let unlock,started=false,released=false;
  const done=new Promise(resolve=>{unlock=resolve});tail=previous.catch(()=>{}).then(()=>done);
  const release=()=>{if(released)return;released=true;pending--;if(started)finished=now();unlock()};
  try{
   await abortable(previous,options.signal);
   const delay=Math.max(0,finished+config.cooldownMs-now());if(delay)await abortable(sleep(delay),options.signal);
   if(options.signal?.aborted)throw options.signal.reason;
   started=true;
   const response=await fetchImpl(url,{...options,body:JSON.stringify(payload)});
   if(!response.body){release();return response}
   const reader=response.body.getReader();
   const stream=new ReadableStream({
    async pull(controller){try{const part=await reader.read();if(part.done){release();controller.close()}else controller.enqueue(part.value)}catch(error){release();controller.error(error)}},
    async cancel(reason){try{await reader.cancel(reason)}finally{release()}}
   },{highWaterMark:0});
   return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(error){release();throw error}
  };
 }};
}
