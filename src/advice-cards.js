import {imageTranscript} from './image-evidence.js';
import {renderMarkdown,markdownInline} from './markdown.js';
import {analysisSignature} from './analysis.js';

const clean = (value, limit = 600) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, limit) : '';

function safeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return '';
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    if ([...url.searchParams.keys()].some(key => /^(?:api[-_]?key|access[-_]?token|token|secret|password|authorization|jina[-_]?api[-_]?key)$/i.test(key))) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function sourceRecord(source) {
  const url = safeSourceUrl(source?.url);
  if (!url) return null;
  // These are saved source words, never a model-provided excerpt or URL.
  const excerpt = [source.excerpt, source.content, source.description, source.text].map(value => clean(value, 1200)).find(Boolean) || '';
  return {url, title: clean(source.title, 160) || url, excerpt,evidenceText:[...new Set([source.excerpt,source.content,source.description,source.text,imageTranscript(source)].filter(Boolean))].join('\n')};
}

function uniqueSources(sources) {
  const seen = new Set();
  return sources.filter(source => source && !seen.has(source.url) && seen.add(source.url)).slice(0, 3);
}

export function parseAdviceResponse(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 100000) return {summary:'',cards:[]};
  const input = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const value = JSON.parse(input);
    return value && !Array.isArray(value) ? {summary:clean(value.summary,2000),cards:Array.isArray(value.cards)?value.cards.slice(0,12):[]} : {summary:'',cards:[]};
  } catch { return {summary:clean(text,2000),cards:[]}; }
}

function sourceEvidence(raw, sources) {
  const excerpts = sources.filter(source => source.evidenceText||source.excerpt);
  if (!excerpts.length) return sources.length ? '待補來源原文：目前只保存了來源連結，尚無可對照的摘錄。' : '待補證據：這項建議尚未對應到已保存的來源，需先收集及核對資料。';
  // A model's interpretation is not evidence. Only verbatim saved text can
  // enter this field; unsupported counts and absence claims stay in raw output.
  const proposed = clean(raw, 300).replace(/^[「“"]|[」”"]$/g, '');
  if(proposed){const compact=value=>String(value||'').replace(/[|\s]/g,'');const match=sources.find(source=>compact(source.evidenceText||source.excerpt).includes(compact(proposed)));if(match){const text=match.evidenceText||match.excerpt;const index=text.indexOf(proposed);match.excerpt=index>=0?text.slice(Math.max(0,index-100),index+1100):proposed;return proposed}}
  return '待核對證據：模型提出的依據未對應到所引來源原文，請展開來源確認後再採用。';
}

function cardRecord(value, sources, kind, evidenceType = 'source') {
  const title = clean(value?.title, 100), action = clean(value?.action, 600), verify = clean(value?.verify, 400);
  if (!title || !action || !verify) return null;
  const evidence = kind === 'model' && evidenceType !== 'workspace' ? sourceEvidence(value.evidence, sources) : clean(value.evidence, 600) || '待補證據：請先收集並核對相關資料。';
  const card = {title, evidence, action, verify, sources:sources.map(({evidenceText,...source})=>source), kind, evidenceType, ...(clean(value?.draft,6000)?{draft:clean(value.draft,6000)}:{}),targetUrl:safeSourceUrl(value?.targetUrl),pending:clean(value?.pending,1000)};
  return {id: `advice-${analysisSignature(card).replace(':', '-')}`, ...card};
}

/** Sources retain their input indices so sourceIds always refer to the exact
 * numbered sample the model received. Invalid entries do not shift numbering.
 * Legacy/malformed model text remains the caller's responsibility to preserve
 * in an expandable original-answer section; it never becomes a fake model card.
 */
export function buildAdviceCards({text = '', sources = [], directions = []} = {}) {
  const allowed = (Array.isArray(sources) ? sources : []).map(sourceRecord);
  const byUrl = new Map(allowed.filter(Boolean).map(source => [source.url, source]));
  const facts = Array.isArray(directions) ? directions : [];
  const factText = value => clean(value, 600).replace(/^[「“"]|[」”"]$/g, '').replace(/\s+/g, '');
  const factSources = fact => uniqueSources((Array.isArray(fact?.sources) ? fact.sources : []).map(source => byUrl.get(safeSourceUrl(source?.url))).filter(Boolean));
  const model = parseAdviceResponse(text).cards.map(value => {
    // Counts are trusted only when they exactly match a current, computed fact.
    // Do not attach a model-selected unrelated website to that workspace fact.
    const fact = facts.find(fact => factText(fact.evidence).length > 10 && factText(fact.evidence) === factText(value?.evidence));
    if (fact) return cardRecord({...value, evidence:fact.evidence}, factSources(fact), 'model', 'workspace');
    const matched = uniqueSources((Array.isArray(value?.sourceIds) ? value.sourceIds : []).flatMap(id => Number.isInteger(id) && id > 0 && id <= allowed.length && allowed[id - 1] ? [allowed[id - 1]] : []));
    return cardRecord(value, matched, 'model');
  }).filter(Boolean);
  const fallback = (Array.isArray(directions) ? directions : []).map(value => {
    const matched = uniqueSources((Array.isArray(value?.sources) ? value.sources : []).map(source => byUrl.get(safeSourceUrl(source?.url))).filter(Boolean));
    return cardRecord(value, matched, 'rules', 'workspace');
  }).filter(Boolean);
  // Keep verified source text and computed facts ahead of unsupported drafts.
  // The caller retains the complete model answer in its expandable disclosure.
  const actionable=fallback.filter(card=>card.draft&&card.targetUrl&&card.sources.length);
  const grounded = model.filter(card => !/^(?:待補|待核對)/.test(card.evidence)).map(card=>{
    const draft=actionable.find(fact=>card.sources.some(source=>source.url===fact.targetUrl));
    return !card.draft&&draft?cardRecord({...card,draft:draft.draft,targetUrl:draft.targetUrl,pending:draft.pending},card.sources,'model',card.evidenceType):card;
  });
  const candidates = grounded.length?grounded:actionable.length?[...actionable,...fallback]:fallback.length ? fallback : model;
  const seen = new Set();
  return candidates.filter(card => {
    const key = [card.title, card.action, card.verify].join('|').replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

/** A complete, plain-text copy for one task or Agent follow-up. */
export function adviceCardText(card) {
  if (!card) return '';
  return [card.title, `${card.kind === 'model' ? '模型建議草稿' : '內容比對建議'}；採用前需核對來源。`, `證據：${card.evidence}`, `建議：${card.action}`, ...(card.draft?[`建議新文（待品牌核對）：\n${card.draft}`]:[]), ...(card.targetUrl?[`修改頁面：${card.targetUrl}`]:[]), `驗證：${card.verify}`, ...(card.sources || []).map(source => `來源：${source.title}\n${source.url}${source.excerpt ? '\n保存摘錄（待核對）：' + source.excerpt : '\n待補來源原文。'}`)].join('\n\n');
}

export function adviceCardsMarkup({e, icon = () => '', cards = [], running = false, taskIds = []}) {
  const saved = taskIds instanceof Set ? taskIds : new Set(Array.isArray(taskIds) ? taskIds : []);
  const brief = (value, limit) => value.length > limit ? value.slice(0, limit) + '…' : value;
  return `<div class="advice-cards">${cards.map((card, index) => `<article class="advice-card" aria-labelledby="${e(card.id)}-title"><div class="advice-card-heading"><span class="advice-card-number">${index + 1}</span><h3 id="${e(card.id)}-title">${markdownInline(card.title)}</h3></div><p class="advice-card-kind muted">${card.kind === 'model' ? '模型建議 · 待核對' : '內容比對 · 目前樣本'}</p><div class="advice-card-step"><h4>具體修改</h4><div class="markdown-body">${renderMarkdown(card.action)}</div></div>${card.draft?`<div class="advice-card-draft"><h4>建議新增文字 · 待品牌核對</h4><pre>${e(card.draft)}</pre>${card.targetUrl?`<a href="${e(card.targetUrl)}" target="_blank" rel="noopener noreferrer">修改此頁 ↗</a>`:''}</div>`:''}<p class="advice-evidence-preview ${/^待補|^待核對/.test(card.evidence)?'advice-card-missing':''}">依據：${e(brief(card.evidence,100))}</p><details class="advice-card-details"><summary>依據與驗證${card.sources.length?` · ${card.sources.length} 個來源`:''}</summary><div class="advice-card-step advice-card-evidence"><h4>資料依據</h4><div class="markdown-body">${renderMarkdown(card.evidence)}</div>${card.sources.length ? `<details class="advice-card-sources"><summary>來源原文</summary>${card.sources.map(source => `<div class="advice-card-source"><a href="${e(source.url)}" target="_blank" rel="noopener noreferrer">${e(source.title)} ↗</a>${source.excerpt ? `<blockquote>${e(source.excerpt)}</blockquote>` : '<p class="muted">待補原文，請開啟來源核對。</p>'}</div>`).join('')}</details>` : card.evidenceType==='workspace'?'<p class="muted">依目前工作區紀錄。</p>':'<p class="muted advice-card-missing">尚無對應來源。</p>'}</div><div class="advice-card-step"><h4>如何驗證</h4><div class="markdown-body">${renderMarkdown(card.verify)}</div></div></details><div class="advice-card-actions"><button class="btn small" data-action="create-advice-pack" data-card-id="${e(card.id)}" ${running?'disabled':''}>建立修改包</button><button class="btn small" data-action="ask-advice-card" data-card-id="${e(card.id)}" ${running ? 'disabled' : ''}>追問 ${icon('arrow')}</button><button class="btn small" data-action="advice-card-task" data-card-id="${e(card.id)}" ${running || saved.has(card.id) ? 'disabled' : ''}>${saved.has(card.id) ? '已加入待辦' : '加入待辦'}</button></div></article>`).join('')}</div>`;
}
