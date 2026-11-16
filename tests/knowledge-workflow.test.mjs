import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openKnowledgeWorkflow} from '../scripts/knowledge-workflow.mjs';
import {createAnalysisControl} from '../scripts/analysis-control.mjs';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let n=0;n<100;n++){if(check())return;await wait(10)}throw Error('Timed out')}
const page={url:'https://www.idodo.com.tw/product1.html',title:'奶油餅乾',content:'奶油餅乾',images:[{url:'https://www.idodo.com.tw/a.jpg',context:{version:1,heading:'奶油餅乾',before:'商品成分',after:''}}],imageTextSources:[{url:'https://www.idodo.com.tw/a.jpg',status:'read',text:'成分：奶油、麵粉'}]};
test('failed refresh preserves previous facts and repeated extraction preserves cited IDs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'knowledge-refresh-'));let fail=false;
 const flow=openKnowledgeWorkflow({path:join(root,'data.sqlite'),control:createAnalysisControl(),library:{read:()=>({pages:[page]})},ask:async(_config,_prompt,content)=>{
  if(fail)throw Error('upstream unavailable');const data=JSON.parse(content);
  if('text' in data)return JSON.stringify({items:data.text.includes('成分')?[{scope:'product',category:'餅乾',product:'奶油餅乾',field:'成分',value:'奶油、麵粉',quote:'成分：奶油、麵粉'}]:[]});
  return JSON.stringify({pageType:'商品頁',readerQuestions:[],summary:'資料保留',findings:[]});
 }});
 const input={brand:'測試',domain:'idodo.com.tw',config:{provider:'local',model:'test'}};
 try{
  flow.start(input);await until(()=>!flow.busy);const before=flow.state('測試').facts;assert.equal(before.length,1);
  fail=true;flow.start(input);await until(()=>!flow.busy);assert.equal(flow.state('測試').job.status,'completed_with_errors');assert.deepEqual(flow.state('測試').facts,before);
  fail=false;flow.start(input);await until(()=>!flow.busy);assert.deepEqual(flow.state('測試').facts,before);
 }finally{flow.close();await rm(root,{recursive:true,force:true})}
});
test('image facts persist separately from HTML, with literal evidence and model recommendations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'knowledge-'));const control=createAnalysisControl();
 const flow=openKnowledgeWorkflow({path:join(root,'data.sqlite'),control,library:{read:()=>({pages:[page]})},ask:async(config,prompt,content)=>{const data=JSON.parse(content);if('text' in data)return JSON.stringify({items:data.text.includes('成分')?[{scope:'product',category:'餅乾',product:'奶油餅乾',field:'成分',value:'奶油、麵粉',quote:'成分：奶油、麵粉'},{scope:'product',category:'餅乾',product:'奶油餅乾',field:'認證',value:'有機',quote:'有機認證'}]:[]});if(prompt.includes('現在只做判斷'))return JSON.stringify({pageType:'產品成分頁',readerQuestions:['這款餅乾含哪些成分？'],summary:'圖片已有成分',findings:[{problem:'成分只有圖片',reason:'正文未列出',change:'新增文字成分段落',missing:'',factIds:[data.facts[0].id]}]});return JSON.stringify({summary:'圖片已有成分，正文沒有等價資訊。',suggestions:[{priority:'high',impact:'無法以文字查閱食用條件',problem:'成分只有圖片',reason:'可增強文字擷取',factIds:[data.facts[0].id],readerQuestion:'這款餅乾含哪些成分？',placement:'奶油餅乾產品頁成分區',format:'具名成分段落',action:'在產品名稱下補上對應的文字成分',missing:'',replacement:'奶油餅乾的成分為奶油、麵粉。',verification:'檢查 HTML 文字可取得此段'}]})}});
 try{flow.start({brand:'鴻鼎菓子',domain:'idodo.com.tw',config:{provider:'local',model:'test',apiKey:'secret'}});await until(()=>flow.state('鴻鼎菓子').job.status==='completed');const state=flow.state('鴻鼎菓子');assert.equal(state.facts.length,1);assert.equal(state.facts[0].kind,'image');assert.equal(state.facts[0].category,'餅乾');assert.equal(state.reports.length,1);assert.equal(state.reports[0].body.suggestions.length,1);assert.ok(!JSON.stringify(state).includes('secret'))}finally{flow.close();await rm(root,{recursive:true,force:true})}
});
test('pause aborts active inference, resume permits another request, stop preserves completed evidence',async()=>{
 const control=createAnalysisControl();let active=false;
 const fetch=control.wrap(async(url,{signal})=>new Promise((resolve,reject)=>{active=true;signal.addEventListener('abort',()=>reject(signal.reason),{once:true})}));
 const promise=assert.rejects(fetch('http://127.0.0.1:11434/api/chat',{}),{name:'AbortError'});await until(()=>active);control.pause();await promise;assert.equal(control.paused,true);
 let passed=false;const gate=control.checkpoint().then(()=>{passed=true});await wait(10);assert.equal(passed,false);control.resume();await gate;assert.equal(passed,true);
});

test('product page runs first and a failed diagnosis does not block remaining pages',async()=>{
 const root=await mkdtemp(join(tmpdir(),'knowledge-order-'));const calls=[];
 const promo={url:'https://www.idodo.com.tw/page24.html',title:'宣傳',content:'減油減糖'};
 const product={url:'https://www.idodo.com.tw/product546.html',title:'商品',content:'商品內容'};
 const flow=openKnowledgeWorkflow({path:join(root,'data.sqlite'),control:createAnalysisControl(),library:{read:()=>({pages:[promo,product]})},ask:async(config,prompt,content)=>{
  const data=JSON.parse(content);if('text' in data){calls.push(data.pageUrl);return '{"items":[]}'}
  if(data.url===product.url)throw Error('診斷引用錯誤');
  return JSON.stringify({pageType:'宣傳',readerQuestions:[],summary:'導向商品頁查核',findings:[]});
 }});
 try{flow.start({brand:'測試',domain:'idodo.com.tw',config:{provider:'local',model:'test'}});await until(()=>flow.state('測試').job.status==='completed_with_errors');assert.deepEqual(calls,[product.url,promo.url]);assert.equal(flow.state('測試').job.done,2);assert.equal(flow.state('測試').reports.length,1)}finally{flow.close();await rm(root,{recursive:true,force:true})}
});
