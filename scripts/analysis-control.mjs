import {AsyncLocalStorage} from 'node:async_hooks';
export function createAnalysisControl(){
 const context=new AsyncLocalStorage();let paused=false;const active=new Set(),waiters=new Set();
 return {get paused(){return paused},pause(){paused=true;for(const c of active)c.abort(new DOMException('Analysis paused','AbortError'))},resume(){paused=false;for(const done of waiters)done();waiters.clear()},
 async checkpoint(signal){signal?.throwIfAborted();while(paused)await new Promise((resolve,reject)=>{const finish=()=>{signal?.removeEventListener('abort',abort);waiters.delete(finish);resolve()};const abort=()=>{waiters.delete(finish);reject(signal.reason)};waiters.add(finish);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()});signal?.throwIfAborted()},
 run(signal,callback){return context.run(signal,callback)},
 wrap(fetchImpl){return async(url,options={})=>{
  const jobSignal=context.getStore(),local=/^http:\/\/127\.0\.0\.1:11434\/api\/(chat|generate)$/.test(String(url));
  if(!jobSignal&&!local)return fetchImpl(url,options);
  if(paused)throw new DOMException('Analysis paused','AbortError');
  const cancel=new AbortController();active.add(cancel);
  const signal=AbortSignal.any([cancel.signal,...[jobSignal,options.signal].filter(Boolean)]);
  try{const response=await fetchImpl(url,{...options,signal});const bytes=await response.arrayBuffer();return new Response(bytes,{status:response.status,headers:response.headers})}finally{active.delete(cancel)}
 }} };
}
