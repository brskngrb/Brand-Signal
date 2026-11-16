import test from 'node:test';import assert from 'node:assert/strict';
import {createOneClickJob} from '../scripts/one-click-job.mjs';
import {createAnalysisControl} from '../scripts/analysis-control.mjs';
import {prioritySuggestions,knowledgePanel} from '../src/knowledge-workflow.js';
import {settingsPage} from '../src/workspace.js';
const input={brand:'測試品牌',url:'https://www.idodo.com.tw/category.html',config:{provider:'gemini',model:'test-model',apiKey:'SECRET-DO-NOT-PERSIST'}};
const pages=[1,2].map(n=>({url:`https://www.idodo.com.tw/product${n}.html`,title:'商品'+n,images:[{url:'https://www.idodo.com.tw/shared.jpg',context:{before:'商品'+n}}]}));
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5))}throw Error('wait expired')};
test('one click collects, deduplicates shared images, saves each page and then analyzes without persisting credentials',async()=>{
 const order=[],saved=[],history=[];const flow=createOneClickJob({control:createAnalysisControl(),persist:s=>history.push(structuredClone(s)),collect:async()=>{order.push('collect');return pages},recognize:async()=>{order.push('ocr');return {url:pages[0].images[0].url,status:'read',text:'圖片來源文字'}},saveImages:async(d,u,images)=>saved.push({u,images}),analyze:async()=>{order.push('analyze');return {status:'completed'}}});
 flow.start(input);await flow.wait();assert.equal(flow.state().status,'completed');assert.deepEqual(order,['collect','ocr','analyze']);assert.equal(saved.length,2);assert.equal(flow.state().imagesDone,1);assert.ok(!JSON.stringify(history).includes(input.config.apiKey));
});
test('failed image preserves previous text, keeps subsequent work and marks partial completion',async()=>{
 const prior={...pages[0],imageTextSources:[{url:pages[0].images[0].url,status:'read',text:'舊資料'}]};let saved;
 const flow=createOneClickJob({control:createAnalysisControl(),collect:async()=>[prior],recognize:async()=>{throw Error('private SECRET')},saveImages:async(d,u,rows)=>saved=rows,analyze:async()=>({status:'completed'})});flow.start(input);await flow.wait();assert.equal(saved[0].text,'舊資料');assert.equal(flow.state().status,'completed_with_errors');assert.ok(!JSON.stringify(flow.state()).includes('SECRET'));
});
test('pause waits, resumes and stop prevents subsequent analysis',async()=>{
 const control=createAnalysisControl();let release,seen=false,analyzed=false;
 const flow=createOneClickJob({control,collect:async()=>pages,recognize:async()=>{seen=true;await new Promise(r=>release=r);return {url:pages[0].images[0].url,status:'read',text:'文字'}},saveImages:async()=>{},analyze:async()=>{analyzed=true}});
 flow.start(input);await until(()=>seen);flow.pause();release();await new Promise(r=>setTimeout(r,15));assert.equal(flow.state().status,'paused');assert.equal(analyzed,false);flow.stop();await flow.wait();assert.equal(analyzed,false);assert.equal(flow.state().status,'stopped');
});
test('restart marks interrupted job; invalid site does not start work',()=>{
 const flow=createOneClickJob({control:createAnalysisControl(),initial:{status:'running'}});assert.equal(flow.state().status,'interrupted');assert.throws(()=>flow.start({...input,url:'https://example.com/category.html'}));assert.equal(flow.busy,false);
});
test('priority cards use real evidence, cap at three distinct topics and avoid relabeling API reports as Codex',()=>{
 const facts=Array.from({length:4},(_,i)=>({id:'valid'+i,page_url:'https://example.com/'+i,quote:'商品條件原文',scope:'product'}));const reports=['成分對應不清','贈品條件不明','素食分類不一致','包裝尺寸'].map((problem,i)=>({page_url:'https://example.com/'+i,model:'real-api',body:{version:2,analysisPolicyVersion:3,productName:'商品'+i,summary:'摘要',suggestions:[{problem,reason:problem,priority:'high',impact:'影響購買條件判斷',readerQuestion:'購買疑問'+i,action:'核對包裝',factIds:['valid'+i],verification:'核對'}]}}));
 reports[3].body.suggestions[0].reason='此葷食商品的包裝尺寸方向不清';
 reports[1].body.suggestions[0]={...reports[1].body.suggestions[0],problem:'贈品條件只在圖片',priority:'high',impact:'讀者可能誤認保證附贈',impactType:'購買條件'};
 assert.equal(prioritySuggestions(reports,facts).length,3);assert.equal(prioritySuggestions(reports,[]).length,0);
 assert.ok(!prioritySuggestions(reports,facts).some(c=>c.suggestion.problem==='包裝尺寸'));
 assert.equal(prioritySuggestions([reports[3]],facts).length,0);
 const html=knowledgePanel({reports,facts},x=>String(x??''));assert.ok(!html.includes('Codex Astra'));assert.ok(!html.includes('模型診斷 v8.2'));assert.equal((html.match(/class="priority-card"/g)||[]).length,3);
 const settings=settingsPage({e:x=>x,icon:()=>'',model:'',libraryStatus:''});assert.ok(settings.includes('id="dev-enabled"'));assert.ok(!settings.includes('id="dev-enabled" checked'));
});
