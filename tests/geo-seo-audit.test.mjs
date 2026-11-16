import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeContent,parseCsvKeywords,toCsv} from '../src/engine.js';
import {buildKeywordInsights} from '../src/keyword-insights.js';
import {visibilitySummary} from '../src/workspace.js';
import {knowledgePanel} from '../src/knowledge-workflow.js';

test('SEO content checks keep missing evidence and schema drafts explicit',()=>{
 const report=analyzeContent({keyword:'曲奇',title:'曲奇商品資料',brand:'測試品牌',content:'沒有提供成分。'});
 assert.equal(report.status,'draft-unverified');
 assert.ok(report.checks.some(c=>!c.passed));
 assert.ok(report.faq.every(row=>row.answer.includes('未驗證')));
 assert.ok(report.disclaimer.includes('不代表'));
});
test('keyword coverage is separate from measured search demand',()=>{
 const report=buildKeywordInsights({query:'曲奇',pages:[{url:'https://example.com/product.html',title:'曲奇',content:'曲奇商品頁',source:'website_crawl'},{url:'https://example.com/about.html',title:'品牌',content:'品牌介紹',source:'website_crawl'}]});
 assert.equal(report.rows[0].volume,null);assert.equal(report.rows[0].position,null);
 assert.equal(report.rows[0].matchCount,1);assert.equal(report.totalPages,2);
});
test('search metrics ignore demo rows and preserve missing measurements',()=>{
 const result=visibilitySummary({daily:[{date:'2026-11-01',source:'demo',impressions:99999,clicks:999},{date:'2026-11-02',impressions:20,clicks:null}]});
 assert.equal(result.impressions.value,20);assert.equal(result.clicks.value,null);
});
test('CSV import and export preserve measured keyword data',()=>{
 const rows=parseCsvKeywords('keyword,volume,position\r\n曲奇,120,8\r\n');
 assert.equal(rows[0].keyword,'曲奇');assert.equal(rows[0].volume,120);
 assert.ok(toCsv([{keyword:'=UNTRUSTED()'}]).includes("'=UNTRUSTED()"));
});
test('product records and suggestions are collapsed and escape source text',()=>{
 const escape=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const html=knowledgePanel({facts:[{scope:'product',product:'<script>商品</script>',page_url:'https://example.com/product.html',field:'成分',value:'奶油',quote:'奶油'}],reports:[]},escape);
 assert.ok(html.includes('knowledge-section'));assert.ok(html.includes('knowledge-fact'));
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<details open'));
 assert.equal((html.match(/<details\b/g)||[]).length,(html.match(/<\/details>/g)||[]).length);
});
