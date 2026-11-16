import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
// Deliberately synthetic tokens; never use a real user's credentials in tests.
const key='AQ.'+'test_fixture_'.repeat(4);
const request=(path,body)=>new Request('http://localhost'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const input={mode:'observe',brand:'測試',keyword:'測試',question:'測試',model:'gemini-3.8-flash',apiKey:key};
const success=()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'測試回應'}]}}]});
test('Gemini accepts dotted auth keys for text and images, using header only',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith('/image.png'))return new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}});
  calls++;assert.equal(options.headers['x-goog-api-key'],key);assert.ok(!String(url).includes(key));assert.ok(!options.body.includes(key));return success();
 };
 try{
  const text=await worker.fetch(request('/api/gemini',input),{});assert.equal(text.status,200);assert.ok(!(await text.text()).includes(key));
  const image=await worker.fetch(request('/api/images/ocr',{provider:'gemini',model:input.model,apiKey:key,pageUrl:'https://www.idodo.com.tw/product595.html',images:[{url:'https://www.idodo.com.tw/image.png'}]}),{});assert.equal(image.status,200);assert.equal(calls,2);
 }finally{globalThis.fetch=original}
});
test('malformed keys are rejected locally; upstream invalid key errors are not misreported as model errors',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({error:{message:key,details:[{reason:'API_KEY_INVALID'}]}},{status:400})};
 try{
  for(const apiKey of [key+'\n',key+' space',key+'\r\nx-injected: yes']){const r=await worker.fetch(request('/api/gemini',{...input,apiKey}),{});assert.equal(r.status,400)}
  assert.equal(calls,0);
  const r=await worker.fetch(request('/api/gemini',input),{});assert.equal(r.status,401);const body=await r.text();assert.match(body,/Google/);assert.ok(!body.includes(key));assert.equal(calls,1);
 }finally{globalThis.fetch=original}
});
