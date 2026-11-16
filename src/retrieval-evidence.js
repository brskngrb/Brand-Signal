import {auditedRetrieval} from './retrieval-baseline.js';

const host = value => {try {const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.hostname.replace(/^www\./,''):''}catch{return ''}};
const owned = (url,domain) => {const h=host(url),d=host(domain);return !!d&&(h===d||h.endsWith('.'+d))};
export function normalizeRetrievalBatches(rows=[],brand={}) {
  if(!Array.isArray(rows))throw Error('retrievalBatches 必須是陣列。');
  const ids=new Set();
  return rows.filter(row=>row&&typeof row==='object'&&row.id&&!ids.has(String(row.id))&&ids.add(String(row.id))).map(row=>({
    id:String(row.id),observedAt:String(row.observedAt||''),tool:String(row.tool||'未記錄'),domain:String(row.domain||''),
    queries:(Array.isArray(row.queries)?row.queries:[]).filter(q=>q&&q.query&&q.mode==='unbranded').map(q=>({
      query:String(q.query),mode:'unbranded',sources:(Array.isArray(q.sources)?q.sources:[]).filter(s=>s&&host(s.url)).map(s=>({title:String(s.title||s.url),url:new URL(s.url).href,officialDomain:owned(s.url,brand.domain),pageVerification:String(s.pageVerification||'search_result_only')}))
    }))
  }));
}
export function attachAuditedRetrieval(dataset) {
  if(host(dataset.brand?.domain)!=='idodo.com.tw')return dataset;
  const seed={id:'chat-search-2026-10-27-v1',observedAt:auditedRetrieval.observedAt,tool:'本次對話網路搜尋工具',domain:'https://www.idodo.com.tw/',queries:auditedRetrieval.observations};
  return {...dataset,retrievalBatches:normalizeRetrievalBatches([seed,...(dataset.retrievalBatches||[])],dataset.brand)};
}
export function retrievalSummary(dataset={}) {
  const batches=normalizeRetrievalBatches(dataset.retrievalBatches||[],dataset.brand).filter(b=>host(b.domain)===host(dataset.brand?.domain));
  const latest=batches.sort((a,b)=>a.observedAt.localeCompare(b.observedAt)).at(-1);
  const queries=latest?.queries||[],hits=queries.filter(q=>q.sources.some(s=>s.officialDomain)).length;
  return {latest,queries,total:queries.length,hits,percent:queries.length?Math.round(hits/queries.length*100):null};
}
export function retrievalPanel({e,dataset}) {
  const s=retrievalSummary(dataset);if(!s.total)return '';
  return `<div class="retrieval-evidence"><p><strong>外部搜尋命中率 ${s.percent}%</strong> · ${s.hits} / ${s.total} 題找到官網 · ${e(s.latest.observedAt)}</p><details class="quiet-details"><summary>查看題目與來源</summary><p class="muted">${e(s.latest.tool)}單次觀測；查詢未指定品牌，但對話已有品牌背景。這是搜尋命中，尚未計入 AI 推薦率；不是 Google 排名或盲測。</p>${s.queries.map(q=>`<details class="quiet-details"><summary>${q.sources.some(x=>x.officialDomain)?'✓ 找到官網':'未找到官網'} · ${e(q.query)}</summary><p class="muted">${q.sources.length} 筆回傳來源；同一題找到多頁仍只算一次命中。未找到不代表全文未提及品牌。</p><ul>${q.sources.map(x=>`<li><a href="${e(x.url)}" target="_blank" rel="noopener noreferrer">${e(x.title)}</a> ${x.officialDomain?'· 官網':''}${x.pageVerification==='open_failed_404'?' · 開啟失敗（404）':''}</li>`).join('')}</ul></details>`).join('')}</details></div>`;
}
