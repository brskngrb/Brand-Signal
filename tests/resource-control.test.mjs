import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createResourceController,normalizeResources,loadResources} from '../scripts/resource-control.mjs';
const url='http://127.0.0.1:11434/api/chat';
const options=()=>({method:'POST',body:JSON.stringify({model:'qwen3.5:27b',images:['unchanged'],options:{num_ctx:32768,num_predict:8192,temperature:0}})});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('normal and vision share a queue until body consumed; preserve quality and cooldown',async()=>{
 let time=0;const calls=[],delays=[];
 const gate=createResourceController({cooldownMs:1500},{now:()=>time,sleep:async ms=>{delays.push(ms);time+=ms}});
 const normal=gate.wrap(async(u,o)=>{calls.push(JSON.parse(o.body));return new Response('normal')});
 const vision=gate.wrap(async(u,o)=>{calls.push(JSON.parse(o.body));return new Response('vision')});
 const first=await normal(url,options());const pending=vision(url,options());await tick();assert.equal(calls.length,1);
 assert.equal(await first.text(),'normal');const second=await pending;assert.equal(await second.text(),'vision');
 assert.deepEqual(delays,[1500]);assert.equal(calls.length,2);
 for(const call of calls){assert.deepEqual(call.images,['unchanged']);assert.equal(call.model,'qwen3.5:27b');assert.equal(call.options.num_ctx,32768);assert.equal(call.options.num_predict,8192);assert.equal(call.options.temperature,0);assert.equal(call.options.num_batch,128);assert.ok(call.options.num_thread<=6);assert.equal(call.keep_alive,'60s')}
});
test('aborted queued request cannot overtake active request or deadlock successors',async()=>{
 let count=0;const gate=createResourceController({cooldownMs:0});const fetch=gate.wrap(async()=>{count++;return new Response('ok')});
 const first=await fetch(url,options());const abort=new AbortController();const rejected=assert.rejects(fetch(url,{...options(),signal:abort.signal}),{name:'AbortError'});abort.abort();await rejected;
 const third=fetch(url,options());await tick();assert.equal(count,1);await first.text();assert.equal(await (await third).text(),'ok');assert.equal(count,2);
});
test('transport failure and response cancellation release the queue',async()=>{
 let count=0;const fetch=createResourceController({cooldownMs:0}).wrap(async()=>{if(++count===1)throw Error('offline');return new Response('ok')});
 await assert.rejects(fetch(url,options()),/offline/);const second=await fetch(url,options());const third=fetch(url,options());await second.body.cancel();assert.equal(await (await third).text(),'ok');assert.equal(count,3);
});
test('cloud requests and model listing bypass inference gate unchanged',async()=>{
 const received=[];const fetch=createResourceController().wrap(async(u,o)=>{received.push([u,o]);return new Response('ok')});
 const cloud=options();await fetch('https://example.com/api/chat',cloud);const tags={method:'GET'};await fetch('http://127.0.0.1:11434/api/tags',tags);assert.equal(received[0][1],cloud);assert.equal(received[1][1],tags);
});
test('settings load UTF-8 BOM, retain edits and validate limits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agent-headroom-'));
 try{assert.equal((await loadResources(root)).numBatch,128);await mkdir(join(root,'.runtime'));await writeFile(join(root,'.runtime/resource-settings.json'),'\uFEFF'+JSON.stringify({cooldownMs:3000,numBatch:64}));const config=await loadResources(root);assert.equal(config.cooldownMs,3000);assert.equal(config.numBatch,64);assert.equal(normalizeResources({cpuThreads:99},16).cpuThreads,14);assert.equal(normalizeResources({gpuReserveMiB:0},16).gpuReserveMiB,256);assert.throws(()=>normalizeResources({numBatch:3.5}),/Invalid/)}finally{await rm(root,{recursive:true,force:true})}
});
