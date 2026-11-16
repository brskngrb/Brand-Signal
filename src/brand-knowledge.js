import {imageTranscript,withoutLegacyOcr,IMAGE_READER_VERSION} from './image-evidence.js';
import {classifySource, normalizeBaseline, isReadableSource} from './source-baseline.js';

// These are literal source clues, not inferred product claims or verified certifications.
export const KNOWLEDGE_TOPICS = [
  {id: 'product', label: '商品、規格與價格', terms: /價格|售價|原價|優惠價|規格|內容物|淨重|公克|重量|入數|NT\$|TWD|\d+\s*元/i, check: '核對品名、份量與價格日期'},
  {id: 'ingredients', label: '成分與過敏原', terms: /成分|原料|過敏原|無添加|添加物|奶素|蛋奶素|全素|ingredients|allergen/i, check: '確認適用品項及標示來源'},
  {id: 'storage', label: '保存與配送', terms: /保存|保鮮|有效日期|賞味|冷藏|冷凍|常溫|配送|宅配|運費|到貨|出貨|交期|shelf life|storage|shipping/i, check: '核對期限、溫度、運費與交期'},
  {id: 'purchase', label: '購買與企業採購', terms: /企業|採購|大量訂購|大宗|團購|客製|訂購|購買|門市|通路|發票|最低訂購|bulk|wholesale/i, check: '核對門檻、聯絡方式與訂購條件'},
  {id: 'awards', label: '獎項與驗證依據', terms: /獎項|得獎|獲獎|金獎|銀獎|銅獎|標章|認證|驗證|檢驗|潔淨|award|certificat/i, check: '核對年度、授予單位及適用品項'},
];

const text = (value, max = 20000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : '';
const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 40) : typeof value === 'string' ? [value] : [];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const safeUrl = value => {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007F]/.test(value)) return '';
  try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''; if ([...url.searchParams.keys()].some(key => /^(?:api[-_]?key|access[-_]?token|token|secret|password|authorization|jina[-_]?api[-_]?key)$/i.test(key))) return ''; url.hash = ''; return url.href; } catch { return ''; }
};
function hash(value) {
  let first = 2166136261, second = 5381;
  for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index); first = Math.imul(first ^ code, 16777619); second = Math.imul(second, 33) ^ code; }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}
function sourceParts(page) {
  // Prefer fetched text. Schema type names alone never become product evidence.
  // A short revisit can retain older full text, so date each clue by its actual source field.
  const latestAt = date(page.fetchedAt) || date(page.retrievedAt);
  return [
    {content: text(withoutLegacyOcr(page.excerpt), 6000), retrievedAt: date(page.retrievedAt) || latestAt},
    {content: text(withoutLegacyOcr(page.content), 24000), retrievedAt: date(page.contentFetchedAt) || latestAt},
    ...(page.imageTextSources||[]).filter(r=>r.status==='read'&&r.version===IMAGE_READER_VERSION&&r.text).map(r=>({content:text(r.text,48000),retrievedAt:date(r.recognizedAt)||date(page.imageTextFetchedAt),origin:'圖片辨識，待對照原圖',imageUrl:safeUrl(r.url)})),
    ...[page.description, ...list(page.h1), ...list(page.h2), page.title].map(value => ({content: text(value, 2000), retrievedAt: latestAt})),
  ].filter(part => part.content);
}
function sourceSnippet(content, terms) {
  const match = terms.exec(content);
  if (!match) return '';
  const start = Math.max(0, match.index - 45), end = Math.min(content.length, match.index + 155);
  const priorBreak = content.lastIndexOf('\n', match.index), nextBreak = content.indexOf('\n', match.index);
  const from = priorBreak >= start ? priorBreak + 1 : start;
  const to = nextBreak >= 0 && nextBreak <= end ? nextBreak : end;
  return `${from > 0 && content[from - 1] !== '\n' ? '…' : ''}${content.slice(from, to).trim()}${to < content.length && content[to] !== '\n' ? '…' : ''}`;
}

export function buildBrandKnowledge({pages = [], baseline = {}, reviews = {}} = {}) {
  const brand = normalizeBaseline(baseline), seen = new Set();
  const sources = (Array.isArray(pages) ? pages : []).flatMap(page => {
    const url = safeUrl(page?.url);
    if (!url || seen.has(url) || !isReadableSource(page)) return [];
    seen.add(url);
    const parts = sourceParts(page);
    if (!parts.length) return [];
    return [{url, title: text(page.title, 200) || new URL(url).hostname, parts, classification: classifySource({url}, brand), fingerprint: hash(JSON.stringify([url, parts.map(part => part.content), list(page.structuredData)]))}];
  }).slice(0, 100);
  const reviewMap = reviews && typeof reviews === 'object' && !Array.isArray(reviews) ? reviews : {};
  const allEvidence = [];
  const rows = KNOWLEDGE_TOPICS.map(topic => {
    const matches = sources.flatMap(source => {
      const part = source.parts.find(part => topic.terms.test(part.content));
      if (!part) return [];
      const excerpt = sourceSnippet(part.content, topic.terms);
      const id = `${topic.id}-${hash(source.url)}`, fingerprint = `${source.fingerprint}-${hash(excerpt)}`;
      const review = Object.prototype.hasOwnProperty.call(reviewMap, id) ? reviewMap[id] : null;
      const reviewedAt = review?.fingerprint === fingerprint ? date(review.reviewedAt) : null;
      return [{id, fieldId: topic.id, field: topic.label, url: source.url, title: source.title, excerpt, origin:part.origin||'網頁文字',imageUrl:part.imageUrl||'', retrievedAt: part.retrievedAt, scope: source.classification.scope, kind: source.classification.kind, fingerprint, reviewed: !!reviewedAt, reviewedAt}];
    });
    const official = matches.filter(item => item.scope === '指定品牌'), external = matches.filter(item => item.scope === '非指定品牌');
    // Keep a small inspectable sample. Aggregate counts explicitly describe clues, not verified facts.
    const evidence = [...official.slice(0, 2), ...external.slice(0, 1)];
    allEvidence.push(...evidence);
    return {id: topic.id, label: topic.label, check: topic.check, officialCount: official.length, externalCount: external.length, reviewedCount: evidence.filter(item => item.reviewed).length, status: official.length ? '已有' : '官網樣本未找到，待補來源', evidence};
  });
  return {
    brand: {name: brand.name, domain: brand.domain}, rows, evidence: allEvidence,
    summary: {samplePages: sources.length, officialPages: sources.filter(source => source.classification.scope === '指定品牌').length, externalPages: sources.filter(source => source.classification.scope === '非指定品牌').length, totalFields: rows.length, fieldsWithOfficialClues: rows.filter(row => row.officialCount > 0).length, missingOfficialFields: rows.filter(row => !row.officialCount).map(row => row.label), reviewedEvidence: allEvidence.filter(item => item.reviewed).length, displayedEvidence: allEvidence.length},
    notice: '依已收集頁面的關鍵詞擷取內容線索，未找到不代表官網沒有。外站資訊不能替代官網；人工核對摘錄不等於產品認證或食安驗證。',
  };
}

export function reviewKnowledgeEvidence({knowledge, reviews = {}, evidenceId, reviewed = true, now = new Date().toISOString()}) {
  const evidence = knowledge?.evidence?.find(item => item.id === evidenceId);
  if (!evidence) throw Error('此筆來源已變更，請重新載入後核對。');
  const next = Object.fromEntries(Object.entries(reviews && typeof reviews === 'object' && !Array.isArray(reviews) ? reviews : {}).filter(([key, value]) => /^[a-z]+-[a-z0-9]+$/.test(key) && value && typeof value.fingerprint === 'string' && date(value.reviewedAt)).slice(-500));
  if (!reviewed) { delete next[evidenceId]; return next; }
  const reviewedAt = date(now);
  if (!reviewedAt) throw Error('核對時間無效。');
  next[evidenceId] = {fingerprint: evidence.fingerprint, reviewedAt};
  return next;
}

export function knowledgeAgentContext(knowledge) {
  return {
    method: '五類品牌知識的原文線索比對，非事實自動驗證；未找到只代表目前官網樣本缺少線索。不得把非指定品牌資訊當作指定品牌事實，或宣稱內部知識整理提高外部 AI 推薦率。',
    summary: knowledge.summary,
    rows: knowledge.rows.map(row => ({field: row.label, officialCluePages: row.officialCount, externalReferencePages: row.externalCount, check: row.check, evidence: row.evidence.slice(0, 2).map(item => ({url: item.url, excerpt: item.excerpt, origin:item.origin, scope: item.scope, retrievedAt: item.retrievedAt, review: item.reviewed ? '已人工核對摘錄' : '未核對'}))})),
  };
}

export function brandKnowledgePanel({e = escapeHtml, knowledge, disabled = false}) {
  const timestamp = value => value ? new Date(value).toLocaleDateString('zh-TW', {timeZone: 'Asia/Taipei'}) : '日期未提供';
  const rows = knowledge.rows.map(row => `<details class="knowledge-row" id="knowledge-topic-${e(row.id)}"><summary class="knowledge-row-heading"><span>${e(row.label)}</span><span class="knowledge-row-meta"><span class="tag ${row.officialCount ? '' : 'gray'}">${row.officialCount ? `官網線索 ${row.officialCount} 頁` : '待補官網來源'}</span><span class="muted">已核對 ${row.reviewedCount} / ${row.evidence.length}</span></span></summary><div class="knowledge-row-body"><p class="muted">${e(row.check)}</p>${row.evidence.length ? row.evidence.map(item => `<article class="knowledge-evidence"><div class="source-badges"><span class="source-badge ${item.scope === '指定品牌' ? 'is-brand' : 'is-external'}">${e(item.scope === '指定品牌' ? '指定品牌 · 官網內容線索' : '非指定品牌 · 僅供參考')}</span><span class="muted">${e(item.origin||'網頁文字')} · 讀取 ${e(timestamp(item.retrievedAt))}</span></div><p class="knowledge-excerpt">${e(item.excerpt)}</p><div class="toolbar"><a href="${e(item.url)}" target="_blank" rel="noopener noreferrer">${e(item.title)} ↗</a><button type="button" class="text-link" data-knowledge-review="${e(item.id)}" data-reviewed="${item.reviewed}" aria-label="${e(`${item.reviewed ? '取消' : '標記'}人工核對：${row.label}，${item.title}`)}" ${disabled ? 'disabled' : ''}>${item.reviewed ? '已核對 · 取消' : '標記已核對'}</button></div><small class="muted knowledge-source-url">${e(item.url)}</small>${item.reviewed ? `<small class="muted">核對日期 ${e(timestamp(item.reviewedAt))}</small>` : ''}</article>`).join('') : '<p class="muted">目前樣本未找到線索，請補充來源。</p>'}${!row.officialCount && row.externalCount ? '<p class="muted">僅有外站線索，待補官網依據。</p>' : ''}</div></details>`).join('');
  return `<details class="card baseline-details knowledge-panel" id="brand-knowledge"><summary>品牌知識與來源 <span class="muted">${knowledge.summary.fieldsWithOfficialClues} / ${knowledge.summary.totalFields} 類官網線索 · ${knowledge.summary.reviewedEvidence} 筆已核對</span></summary><div class="panel-body"><div class="knowledge-rows">${rows}</div><details class="knowledge-method"><summary>查核說明</summary><p class="muted">${e(knowledge.notice)} 來源內容變更後需重新核對。</p></details></div></details>`;
}
