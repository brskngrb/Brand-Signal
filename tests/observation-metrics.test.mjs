import test from 'node:test';
import assert from 'node:assert/strict';
import {observationSummary,observationMethod} from '../src/observations.js';
const brand={name:'鴻鼎菓子',domain:'https://www.idodo.com.tw'};
const row=(id,yes)=>({id,source:'manual',platform:'ChatGPT',model:'recorded',answer:'saved answer',brandMentioned:yes,promptType:'unbranded',phase:'baseline',promptVersion:'v1',webMode:'enabled'});
test('mention denominator excludes unknown, failures, duplicates and conflicting IDs',()=>{
 const a=row('a',true),b=row('b',false);
 const s=observationSummary([a,{...a},b,row('c',null),{...row('d',true),status:'failed'},row('conflict',true),row('conflict',false)],brand);
 assert.deepEqual(s.mention,{yes:1,reviewed:2,percent:50});
});
test('zero valid answers is unknown; platforms and branded prompts stay separate',()=>{
 assert.equal(observationSummary([],brand).mention.percent,null);
 const s=observationSummary([row('a',false),{...row('b',true),promptType:'branded'},{...row('c',true),platform:'Gemini'}],brand);
 assert.deepEqual(s.mention,{yes:0,reviewed:1,percent:0});
 assert.equal(observationMethod({source:'codex_review',platform:'Codex'}),'codex');
});
