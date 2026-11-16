import {improvementEligible} from './improvement-policy.js';
import {englishReports} from './analysis-en.js';
import {getLanguage} from './i18n.js';
const safeUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'#'}catch{return '#'}};
const isCodex=r=>/^Codex/i.test(r.model||'');
export function prioritySuggestions(reports=[],facts=[]){
 const latest=new Map();
 for(const r of [...reports].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))))if(!latest.has(r.page_url))latest.set(r.page_url,r);
 const candidates=[...latest.values()].filter(r=>r.body?.analysisPolicyVersion===3).flatMap(r=>(r.body.suggestions||[])
  .filter(s=>improvementEligible(s,facts,r.page_url)).map(s=>({report:r,suggestion:s,kind:s.impactType||'購買決策',score:s.priority==='high'?2:1}))).sort((a,b)=>b.score-a.score);
 const selected=[],seen=new Set();
 for(const c of candidates){const key=c.report.page_url+'|'+String(c.suggestion.readerQuestion).replace(/\s+/g,'');if(seen.has(key))continue;seen.add(key);selected.push(c);if(selected.length===3)break}return selected;
}
export function knowledgePanel(state,e){
 if(getLanguage()==='en'&&state){
  const names=new Map();
  const reports=(state.reports||[]).map(r=>{const copy=englishReports[r.id];if(!copy||JSON.stringify(r.body)!==JSON.stringify(JSON.parse(copy.sourceBody)))return r;names.set(r.page_url,copy.body.productName);return {...r,body:copy.body}});
  state={...state,reports,facts:(state.facts||[]).map(f=>({...f,product:names.get(f.page_url)||f.product}))};
 }
 const facts=state?.facts||[],reports=state?.reports||[],job=state?.job,pipeline=state?.pipeline;
 const names=new Map(facts.filter(f=>f.product).map(f=>[f.page_url,f.product]));
 const name=r=>r.body.productName||names.get(r.page_url)||'待確認商品名稱';
 const latest=[...new Map(reports.filter(r=>r.body?.version===2).map(r=>[r.page_url,r]).reverse()).values()];
 const selected=prioritySuggestions(reports,facts),groups=new Map();
 for(const f of facts){let context={};try{context=JSON.parse(f.context_json||'{}')}catch{}const label=f.product||context.pageTitle||'待確認商品名稱';const key=f.page_url||label;if(!groups.has(key))groups.set(key,{label,rows:[]});groups.get(key).rows.push(f)}
 const productFacts = rows => {
  const sections = new Map([['價格與規格',[]],['內容物',[]],['過敏原',[]],['保存與配送',[]],['其他資料',[]]]);
  for (const fact of rows) {
   const field = fact.field || '';
   const section = /過敏|allergen/i.test(field) ? '過敏原'
    : /成[份分]|內容物|配料|原料|ingredients/i.test(field) ? '內容物'
    : /保存|到貨|配送|運費|效期|期限/.test(field) ? '保存與配送'
    : /價格|售價|規格|尺寸|重量|淨重|入數|容量/.test(field) ? '價格與規格' : '其他資料';
   sections.get(section).push(fact);
  }
  return [...sections].filter(([,items])=>items.length).map(([title,items])=>
   `<section class="product-fact-section${title=== '價格與規格' ? ' product-specs' : ''}"><h4>${title}</h4><dl>${items.map(f=>
    `<div class="product-fact"><dt>${e(f.field)}${f.scope==='unassigned'?' · 待確認':''}</dt><dd><p data-original-source lang="zh-TW">${e(f.value)}</p></dd></div>`
   ).join('')}</dl></section>`
  ).join('');
 };
 const source=r=>isCodex(r)?'Codex Astra 測試分析':r.model||'模型分析';
 const evidenceHtml=(r,s)=>`<details><summary>查看支持證據</summary>${facts.filter(f=>(s.factIds||[]).includes(f.id)&&f.page_url===r.page_url).map(f=>`<p>${e(f.kind==='image'?'圖片轉錄（待核對）':'頁面文字')}：${e(f.quote)}</p><a href="${e(safeUrl(f.image_url||f.page_url))}" target="_blank" rel="noopener">查看原始來源</a>`).join('')||'<p>來源尚待重新核對。</p>'}</details>`;
 const card=(r,s)=>`${evidenceHtml(r,s)}<p>${e(s.reason)}</p>${s.impact?`<p><strong>影響：</strong>${e(s.impact)}</p>`:''}<p><strong>建議修改：</strong>${e(s.action)}</p>${s.replacement?`<p>${e(s.replacement)}</p>`:''}${s.missing?`<p>待確認：${e(s.missing)}</p>`:''}<p>完成後檢查：${e(s.verification)}</p><a href="${e(safeUrl(r.page_url))}" target="_blank" rel="noopener">查看商品來源</a>`;
 const pipelineActive=['running','paused'].includes(pipeline?.status);
 const current=pipelineActive||!job?pipeline:job;
 const states={idle:'尚未開始',running:'分析中',paused:'已暫停',stopped:'已停止',completed:'已完成',completed_with_errors:'已完成，部分內容待重試',failed:'未完成',interrupted:'服務重啟，請重新開始'};
 const active=pipelineActive||['running','paused'].includes(job?.status);
 return `<section class="card" id="knowledge-workflow"><div class="panel-body"><h2>商品資料與改善建議</h2><div class="toolbar"><button class="btn primary" data-action="one-click-start" ${active?'disabled':''}>${active?'分析進行中':'一鍵分析網站'}</button><button class="btn" data-action="knowledge-start" ${active?'disabled':''}>分析已保存資料</button><button class="btn" data-action="knowledge-pause">暫停</button><button class="btn" data-action="knowledge-resume">繼續</button><button class="btn" data-action="knowledge-stop">停止</button></div><p>自動收集商品、讀取圖片，並整理值得優先改善的內容。</p><p role="status">${current?`${e(states[current.status]||'處理中')}${pipelineActive?` · ${e(current.stage)}${current.imagesTotal?` · 圖片 ${current.imagesDone}/${current.imagesTotal}`:''}`:''}`:'設定模型後即可開始。'}${state?.paused?' · 已暫停':''}</p>${pipeline?.error?`<p>${e(pipeline.error)}</p>`:''}${pipelineActive&&pipeline.imageProgress?`<p>${e(pipeline.productName||'')} · ${e(pipeline.imageProgress.stage||'')}</p>`:''}${reports.some(isCodex)&&!reports.some(r=>['openai','gemini'].includes(r.body?.provider)||(!r.body?.provider&&/^(gpt-|gemini-)/i.test(r.model||'')))?'<p class="analysis-provenance">目前既有分析由 <strong>Codex Astra</strong> 代為分析測試，未使用付費 Astra API；後續新分析會標示實際使用的模型。</p>':''}
 ${getLanguage()==='en'?'<p class="muted">English analysis copy. Product names are descriptive translations, not verified official English names. Original evidence is retained in its source language.</p>':''}<h3 class="priority-heading">優先改善</h3><section class="priority-improvements" aria-label="優先改善">${selected.length?selected.map(({report:r,suggestion:s,kind})=>`<article class="priority-card"><small>SEO／GEO · ${e(kind)}</small><span class="priority-symbol" aria-hidden="true">↗</span><h4>${e(s.problem)}</h4><p><strong>${e(name(r))}</strong></p>${card(r,s)}<small>${e(source(r))}</small></article>`).join(''):'<p>目前沒有符合新規則且證據充分的優先改善；可按「分析已保存資料」重新評估。歷史報告保留於全部改善建議。</p>'}</section>
 <details class="knowledge-section"><summary>商品資料 · ${groups.size} 項</summary>${[...groups.values()].map(({label,rows})=>`<details><summary>${safeUrl(rows[0]?.page_url)==='#'?e(label):`<a href="${e(safeUrl(rows[0].page_url))}" target="_blank" rel="noopener">${e(label)}</a>`} · ${rows.length} 筆</summary>${productFacts(rows)}</details>`).join('')||'<p>尚無商品資料。</p>'}</details>
 <details class="knowledge-section"><summary>全部改善建議 · ${latest.length} 份</summary>${latest.map(r=>`<details><summary>${e(name(r))}</summary><small>${e(source(r))}</small><p>${e(r.body.summary)}</p>${r.body.imageCoverage?.passCompleted?`<p>圖片已辨識 ${e(r.body.imageCoverage.withText)}／${e(r.body.imageCoverage.total)} 張，文字仍需核對。</p>`:''}${(r.body.suggestions||[]).map(s=>`<details class="knowledge-suggestion"><summary>${e(s.problem)}</summary>${card(r,s)}</details>`).join('')}${r.body.limitations?.length?`<details class="knowledge-limitations"><summary>資料完整度</summary><ul>${r.body.limitations.map(x=>`<li>${e(x)}</li>`).join('')}</ul></details>`:''}</details>`).join('')||'<p>尚無分析結果。</p>'}</details><p class="muted">建議供內容修改參考，不代表搜尋排名或 AI 引用成效。</p></div></section>`;
}
