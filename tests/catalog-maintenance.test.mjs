import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {crawlBrand} from '../worker/crawl.js';
import {createCatalogJob} from '../scripts/catalog-job.mjs';
import {clearCollectedData} from '../scripts/data-maintenance.mjs';
import {openLibrary} from '../scripts/local-library.mjs';
import {openKnowledgeWorkflow} from '../scripts/knowledge-workflow.mjs';
import {createAnalysisControl} from '../scripts/analysis-control.mjs';
const html=text=>new Response(text,{headers:{'content-type':'text/html'}});
test('unlimited catalog exceeds previous page, queue and clock limits without duplication',async()=>{
 let clock=0;const saved=[];
 const result=await crawlBrand({url:'https://www.idodo.com.tw/category.html'},{unlimited:true,now:()=>clock+=100000,onPage:p=>saved.push(p.url),fetchImpl:async(url,options)=>url.endsWith('robots.txt')?new Response('User-agent: *\nAllow: /'):options.method==='POST'?Response.json({product_list:Array.from({length:270},(_,ID)=>({ID:ID+1}))}):url.endsWith('category.html')?html("<script>get_product_list</script>"):html('<p>商品成分奶油</p><a href="category.html">總覽</a>')});
 assert.equal(result.pages.length,271);assert.equal(new Set(saved).size,271);assert.equal(result.catalog.complete,true);assert.equal(result.coverage.limit,null);
});
test('manual stop aborts a pending request while keeping pages already saved',async()=>{
 let pending;const started=new Promise(r=>pending=r);const saved=[];
 const job=createCatalogJob({library:{saveCrawl:(domain,crawl)=>{saved.push(...crawl.pages);return {saved:1}}},fetchImpl:async(url,options)=>{
  if(url.endsWith('robots.txt'))return new Response('User-agent: *\nAllow: /');
  if(url.endsWith('category.html'))return html('<p>商品</p><a href="product1.html">商品</a>');
  pending();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 }});
 job.start('https://www.idodo.com.tw/category.html');await started;job.stop();await job.wait();assert.equal(job.state().status,'stopped');assert.equal(saved.length,1);assert.equal(job.state().fetched,1);
});
test('clear creates readable backups before deleting both databases and preserves settings',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agent-clear-'));let library,knowledge;
 try{
  library=openLibrary(join(root,'data/web-knowledge.sqlite'));
  knowledge=openKnowledgeWorkflow({path:join(root,'data/product-knowledge.sqlite'),library,control:createAnalysisControl(),ask:async()=>''});
  library.saveCrawl('idodo.com.tw',{source:'website_crawl',pages:[{url:'https://www.idodo.com.tw/product1.html',title:'產品',content:'成分：奶油'}]});
  const k=new DatabaseSync(join(root,'data/product-knowledge.sqlite'));k.prepare('INSERT INTO reports VALUES(?,?,?,?,?,?)').run('1','brand','url','model','{}','2026-11-06');k.close();
  await mkdir(join(root,'.runtime'));await writeFile(join(root,'.runtime/agent-model.json'),'keep');
  const result=clearCollectedData(root);assert.equal(library.readAll('idodo.com.tw').pages.length,0);assert.equal(knowledge.state('brand').reports.length,0);
  const w=new DatabaseSync(join(result.backup,'web-knowledge.sqlite'),{readOnly:true});assert.equal(w.prepare('SELECT COUNT(*) n FROM web_pages').get().n,1);w.close();
  const b=new DatabaseSync(join(result.backup,'product-knowledge.sqlite'),{readOnly:true});assert.equal(b.prepare('SELECT COUNT(*) n FROM reports').get().n,1);b.close();
  assert.equal(await readFile(join(root,'.runtime/agent-model.json'),'utf8'),'keep');
 }finally{knowledge?.close();library?.close();await rm(root,{recursive:true,force:true})}
});
