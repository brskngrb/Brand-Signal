import test from 'node:test';
import assert from 'node:assert/strict';
import {prioritySuggestions} from '../src/knowledge-workflow.js';
import {combinedEvidence} from '../scripts/combined-evidence.mjs';
import {validateDraft} from '../scripts/content-diagnosis.mjs';
const facts=Array.from({length:5},(_,i)=>({id:'f'+i,page_url:'https://example.com/product'+i,quote:'成分：牛奶',value:'牛奶',kind:'image',scope:'product'}));
const suggestion=i=>({priority:'high',impact:'影響食用條件確認',readerQuestion:'是否含奶'+i,problem:'成分文字不完整',factIds:['f'+i],reason:'圖片有列牛奶',placement:'商品區',format:'文字',action:'補充文字',replacement:'本商品含牛奶。',missing:'',verification:'對照包裝',impactType:'食用條件'});
const report=i=>({page_url:facts[i].page_url,created_at:'2026-11-15',body:{version:2,analysisPolicyVersion:3,suggestions:[suggestion(i)]}});
test('homepage caps supported suggestions at three; excludes legacy, cross-page and low-impact findings',()=>{
 assert.equal(prioritySuggestions(facts.map((_,i)=>report(i)),facts).length,3);
 for(const change of [{priority:'low'},{impact:''},{factIds:['f1']},{problem:'重量微小差距'}])assert.equal(prioritySuggestions([{...report(0),body:{...report(0).body,suggestions:[{...suggestion(0),...change}]}}],facts).length,0);
 assert.equal(prioritySuggestions([{...report(0),body:{version:2,suggestions:[suggestion(0)]}}],facts).length,0);
 assert.equal(prioritySuggestions([report(0),{...report(0),created_at:'2026-11-16',body:{version:2,analysisPolicyVersion:3,suggestions:[]}}],facts).length,0);
});
test('combined context retains image attribution, HTML and explicit incomplete coverage',()=>{
 const page={url:'https://example.com/product1',title:'商品',content:'成分入口'.repeat(2000),images:[{url:'https://example.com/a.jpg',context:{version:1,heading:'成分',before:'奶油口味',after:'保存方式'}},{url:'https://example.com/b.jpg'}],imageTextSources:[{url:'https://example.com/a.jpg',status:'read',text:'成分：牛奶',model:'Windows OCR'}]};
 const context=combinedEvidence(page,[{...facts[0],kind:'html'},facts[1]]);
 assert.equal(context.images[0].context.adjacentText.before,'奶油口味');
 assert.equal(context.images[0].text,'成分：牛奶');assert.equal(context.images[1].status,'unread');
 assert.equal(context.coverage.layoutVerified,false);assert.equal(context.coverage.htmlTruncated,true);
 assert.equal(context.facts.length,2);
});
test('drafts with unrelated or unassigned evidence cannot become priority advice',()=>{
 const assessment={findings:[{factIds:['f1']}]};
 assert.equal(validateDraft({summary:'測試',suggestions:[suggestion(0)]},assessment,facts).suggestions.length,0);
 assert.equal(validateDraft({summary:'測試',suggestions:[suggestion(0)]},{findings:[{factIds:['f0']}]},[{...facts[0],scope:'unassigned'}]).suggestions.length,0);
});
