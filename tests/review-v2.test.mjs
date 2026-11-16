import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewData,reviewFiles} from '../src/review-export.js';
test('review preserves complete model facts and provenance, excluding secrets',()=>{
 const quote='超商取貨 台灣本島 運費60元 滿1,500免運';
 const knowledge={facts:[{id:'f1',value:quote,quote,evidence_id:'e1'}],evidence:[{id:'e1',text:quote}],reports:[{body:{version:2,suggestions:[{factIds:['f1'],action:'新增配送對照表'}]}}],jobs:[{status:'completed'}],apiKey:'private-key-secret'};
 const review=buildReviewData({knowledge,analysis:{method:'模型診斷'},secrets:['private-key-secret']});
 const files=reviewFiles(review);const saved=JSON.parse(files.find(f=>f.name==='knowledge.json').data);
 assert.equal(review.schema,'agent-review-package/v2');assert.equal(saved.facts[0].value,quote);
 assert.equal(saved.evidence[0].id,saved.facts[0].evidence_id);
 assert.equal(saved.reports[0].body.suggestions[0].factIds[0],saved.facts[0].id);
 assert.ok(!JSON.stringify(files).includes('private-key-secret'));
 assert.equal(JSON.parse(files.find(f=>f.name==='summary.json').data).knowledgeIncluded,true);
});
test('missing knowledge is explicit instead of presenting legacy cards as model output',()=>{
 const files=reviewFiles(buildReviewData());
 assert.equal(JSON.parse(files.find(f=>f.name==='knowledge.json').data),null);
 assert.equal(JSON.parse(files.find(f=>f.name==='summary.json').data).knowledgeIncluded,false);
});
