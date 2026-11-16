import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {createImageProgress} from '../scripts/image-progress.mjs';
import {singleImageProgress} from '../src/image-progress.js';
const id='12345678-1234-1234-1234-123456789abc';
test('image progress remains indeterminate until work is known and never completes a failure',()=>{
 const progress=createImageProgress();progress.start(id);assert.equal(progress.get(id).percent,null);
 progress.update(id,{stage:'第一輪',completed:0,total:5});assert.equal(progress.get(id).percent,0);
 progress.update(id,{completed:1});assert.equal(progress.get(id).percent,20);
 progress.update(id,{completed:0});assert.equal(progress.get(id).percent,20);
 progress.finish(id,false);assert.equal(progress.get(id).percent,20);assert.equal(progress.get(id).status,'failed');
});
test('local image reports two passes per actual region, then 100 only on success',async()=>{
 const previous=globalThis.fetch;const progress=createImageProgress();progress.start(id);const updates=[];let calls=0;
 globalThis.fetch=async url=>String(url).includes('/api/tags')?Response.json({models:[{name:'qwen3.6:35b'}]}):new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});
 try{
  const response=await worker.fetch(new Request('http://localhost/api/images/ocr',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'local',model:'qwen3.6:35b',pageUrl:'https://www.idodo.com.tw/product595.html',images:[{url:'https://www.idodo.com.tw/image.png'}]})}),{
   LOCAL_MODEL_ENABLED:true,LOCAL_MODEL:'qwen3.6:35b',
   PREPARE_VISION_IMAGE:async()=>({images:['overview','one','two'],regions:[{},{left:0,top:0,width:100,height:100},{left:0,top:100,width:100,height:100}]}),
   LOCAL_VISION_FETCH:async()=>{calls++;return Response.json({done:true,done_reason:'stop',message:{content:'成分：奶油'}})},
   IMAGE_PROGRESS:value=>{updates.push(value);progress.update(id,value)}
  });
  assert.equal(response.status,200,await response.clone().text());assert.equal(calls,4);
  assert.equal(progress.get(id).total,5);assert.equal(progress.get(id).completed,4);assert.equal(progress.get(id).percent,80);
  assert.ok(updates.some(v=>v.stage.includes('區域 2/2：第二輪校對')));
  progress.finish(id,response.ok);assert.equal(progress.get(id).percent,100);
 }finally{globalThis.fetch=previous}
});
test('single-image UI distinguishes unknown progress from measured zero',()=>{
 const e=s=>String(s).replaceAll('<','&lt;');
 const unknown=singleImageProgress({index:1,total:2,single:{percent:null,stage:'下載'}},e);
 assert.ok(!unknown.includes('value="0"'));assert.match(unknown,/無法量測/);
 const known=singleImageProgress({index:1,total:2,single:{percent:20,total:5,completed:1,stage:'<bad>'}},e);
 assert.match(known,/20%/);assert.match(known,/value="20"/);assert.ok(!known.includes('<bad>'));
});
