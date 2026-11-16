import {crawlBrand} from '../worker/crawl.js';
export function createCatalogJob({library,fetchImpl=globalThis.fetch}){
 let job=null,abort=null,completion=Promise.resolve();
 const state=()=>job?{...job,pages:undefined}: {status:'idle',fetched:0};
 return {state,get busy(){return ['running','stopping'].includes(job?.status)},pages:()=>job?.pages||[],
 start(url){if(this.busy)throw Error('商品收集中，請先停止。');const u=new URL(url);if(u.protocol!=='https:'||!['www.idodo.com.tw','idodo.com.tw'].includes(u.hostname)||u.port||u.username||u.password||u.search||!/^\/(?:category\d*|product\d+)\.html$/.test(u.pathname))throw Error('請提供官方商品或分類網址。');
 abort=new AbortController();job={status:'running',url:u.href,fetched:0,pending:1,pages:[],error:'',failures:[]};const current=job;
 completion=(async()=>{try{const result=await crawlBrand({url:u.href},{unlimited:true,includeContent:true,fetchImpl,signal:abort.signal,onProgress:p=>Object.assign(current,{currentUrl:p.url,pending:p.pending}),onPage:page=>{try{const saved=library.saveCrawl(u.origin,{source:'website_crawl',pages:[page],generatedAt:new Date().toISOString()});if(saved.saved!==1)throw Error('未保存');current.pages.push(page);current.fetched++;}catch{const error=Error('資料庫保存失敗，收集已停止；已保存資料保留。');error.code='SAVE_FAILED';throw error}}});current.failures=result.failures;current.pending=result.catalog?.pending||0;current.status=abort.signal.aborted?'stopped':result.failures.length||result.pages.some(p=>p.catalog?.status==='failed')?'completed_with_errors':'completed';}catch(e){current.status=abort.signal.aborted?'stopped':'failed';current.error=e.message}})();return state()},
 reset(){if(this.busy)throw Error('請先停止商品收集。');job=null},
 stop(){if(this.busy){job.status='stopping';abort.abort()}return state()},wait:()=>completion};
}
