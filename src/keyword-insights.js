// Content coverage uses saved page text. Imported search metrics remain separate.
import {isReadableSource} from './source-baseline.js';
const MAX_PAGES = 100;
const MAX_TERMS = 20;
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
const clean = (value, max = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) : '';
const list = value => Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
const round = value => Math.round(value * 10) / 10;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function measuredNumber(value, positive = false) {
  if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  return Number.isFinite(number) && (positive ? number > 0 : number >= 0) ? number : null;
}

function matches(text, term) {
  const haystack = normalize(text);
  const needle = normalize(term);
  if (!needle) return false;
  // Standalone Latin terms do not match unrelated words, e.g. tea in steak.
  if (/^[a-z0-9][a-z0-9 ._-]*$/i.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9_])${escaped}(?=$|[^a-z0-9_])`, 'iu').test(haystack);
  }
  return haystack.includes(needle);
}

function normalizedPages(input) {
  const seen = new Set();
  return (Array.isArray(input) ? input : []).flatMap(page => {
    if (!page || typeof page !== 'object' || !isReadableSource(page)) return [];
    const url = safeUrl(page.url || page.finalUrl);
    if (!url) return [];
    const identity = new URL(url);
    identity.hash = '';
    if (seen.has(identity.href)) return [];
    seen.add(identity.href);
    return [{
      url,
      title: clean(page.title),
      description: clean(page.description, 2000),
      h1: list(page.h1).map(value => clean(value)).filter(Boolean),
      h2: list(page.h2).map(value => clean(value)).filter(Boolean),
      keywordMatches: list(page.keywordMatches).map(value => clean(value, 80)).filter(Boolean),
      content: clean(page.content || page.excerpt, 100000),
      retrievedAt: clean(page.retrievedAt, 50) || null,
    }];
  }).slice(0, MAX_PAGES);
}

function keywordHistory(history, keyword) {
  const byDate = new Map();
  for (const point of (Array.isArray(history) ? history : [])) {
    if (!point || normalize(point.keyword) !== normalize(keyword)) continue;
    if (typeof point.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(point.date)) continue;
    const time = Date.parse(`${point.date}T00:00:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== point.date) continue;
    const totalPages = measuredNumber(point.totalPages, true);
    const matchCount = measuredNumber(point.matchCount);
    if (!Number.isInteger(totalPages) || !Number.isInteger(matchCount) || matchCount > totalPages) continue;
    byDate.set(point.date, { date: point.date, totalPages, matchCount, coveragePercent: round(matchCount / totalPages * 100) });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
}

function excerptAround(page, keyword) {
  const source = page.content || page.description || [...page.h1, ...page.h2].join(' ');
  // Use the original text for display; normalization is used only for matching.
  const offset = source.toLocaleLowerCase().indexOf(keyword.toLocaleLowerCase());
  const start = offset >= 0 ? Math.max(0, offset - 45) : 0;
  return `${start ? '…' : ''}${source.slice(start, start + 180)}${source.length > start + 180 ? '…' : ''}`;
}

export function buildKeywordInsights({ pages = [], keywords = [], query = '', history = [] } = {}) {
  const savedPages = normalizedPages(pages);
  const imported = new Map();
  for (const value of Array.isArray(keywords) ? keywords : []) {
    const row = typeof value === 'string' ? { keyword: value } : value;
    const keyword = clean(row?.keyword, 80);
    if (keyword && !imported.has(normalize(keyword))) imported.set(normalize(keyword), { ...row, keyword });
  }
  const watchTerms = (typeof query === 'string' ? query.slice(0, 2000) : '').split(/[,，、;；\r\n]+/).map(value => clean(value, 80)).filter(Boolean);
  const terms = [];
  const seen = new Set();
  const add = (value, source) => {
    const keyword = clean(value, 80);
    if (!keyword || seen.has(normalize(keyword)) || terms.length >= MAX_TERMS) return;
    seen.add(normalize(keyword));
    terms.push({ keyword, source });
  };
  watchTerms.forEach(value => add(value, 'watch'));
  imported.forEach(value => add(value.keyword, 'imported'));
  if (!terms.length) {
    savedPages.forEach(page => page.keywordMatches.forEach(value => add(value, 'page')));
    savedPages.forEach(page => [...page.h1, ...page.h2].filter(value => value.length >= 2 && value.length <= 48 && !/^(?:最高人氣|社群分享|熱門商品|最新消息|關於我們|聯絡我們|首頁)$/.test(value)).forEach(value => add(value, 'page')));
  }
  const rows = terms.map(({ keyword, source }) => {
    const metric = imported.get(normalize(keyword)) || {};
    const relatedPages = savedPages.filter(page => matches([page.title, page.description, ...page.h1, ...page.h2, page.content].join(' '), keyword)).map(page => ({
      url: page.url,
      title: page.title || new URL(page.url).hostname,
      excerpt: excerptAround(page, keyword),
      retrievedAt: page.retrievedAt,
      titleMatch: matches(page.title, keyword) || page.h1.some(heading => matches(heading, keyword)),
    }));
    const points = keywordHistory(history, keyword);
    return {
      keyword, source, pages: relatedPages, matchCount: relatedPages.length,
      titleMatchCount: relatedPages.filter(page => page.titleMatch).length,
      coveragePercent: savedPages.length ? round(relatedPages.length / savedPages.length * 100) : 0,
      volume: measuredNumber(metric.volume), position: measuredNumber(metric.position, true),
      clicks: measuredNumber(metric.clicks), impressions: measuredNumber(metric.impressions),
      page: safeUrl(metric.page), history: points,
      coverageChange: points.length >= 2 ? round(points.at(-1).coveragePercent - points.at(-2).coveragePercent) : null,
    };
  });
  const suggestions = [];
  if (!savedPages.length) suggestions.push({ title: '先建立網頁資料', detail: '在首頁遍歷網站並儲存頁面，即可比對關鍵字與實際內容。', keyword: '', sources: [] });
  else if (!rows.length) suggestions.push({ title: '加入想追蹤的關鍵字', detail: '輸入商品、送禮需求或採購主題，開始比較已存網頁的內容涵蓋。', keyword: '', sources: [] });
  else {
    const uncovered = rows.find(row => row.matchCount === 0);
    if (uncovered) suggestions.push({ title: `確認「${uncovered.keyword}」的內容缺口`, detail: `這次分析的 ${savedPages.length} 頁尚未找到此詞。先確認它是否符合品牌服務，再補充相關頁面或擴大抓取範圍。`, keyword: uncovered.keyword, sources: [] });
    const missingTitle = rows.find(row => row.matchCount > 0 && row.titleMatchCount === 0);
    if (missingTitle) suggestions.push({ title: `讓「${missingTitle.keyword}」的頁面主題更清楚`, detail: `已有 ${missingTitle.matchCount} 頁提到此詞，但已儲存的標題與 H1 尚未找到。可查核來源頁面是否適合更明確地說明主題。`, keyword: missingTitle.keyword, sources: missingTitle.pages.slice(0, 3) });
    const thin = rows.find(row => row.matchCount > 0 && row.coveragePercent < 30 && row !== missingTitle);
    if (thin) suggestions.push({ title: `檢查「${thin.keyword}」的相關資訊是否完整`, detail: `目前 ${thin.matchCount}／${savedPages.length} 頁涵蓋此詞。可先檢查相關頁面的商品、價格及常見問題是否足以回答需求。`, keyword: thin.keyword, sources: thin.pages.slice(0, 3) });
    if (!suggestions.length) suggestions.push({ title: '從已涵蓋的主題檢查內容品質', detail: `目前 ${rows.length} 個追蹤詞皆有對應頁面。可逐頁查核資訊完整度與更新時間，再搭配匯入的搜尋資料評估優先順序。`, keyword: rows[0].keyword, sources: rows[0].pages.slice(0, 3) });
  }
  return {
    rows, totalPages: savedPages.length,
    matchedPages: new Set(rows.flatMap(row => row.pages.map(page => page.url))).size,
    keywordCount: rows.length, uncoveredCount: rows.filter(row => row.matchCount === 0).length,
    suggestions, keywordSource: terms.length && terms.every(term => term.source === 'page') ? 'page' : 'watch',
    historyDates: new Set(rows.flatMap(row => row.history.map(point => point.date))).size,
    trendLabel: '累積更多日期資料後顯示變化',
  };
}

// Exact fact lookups use measured rows so model wording cannot change denominators.
export function keywordFactsAnswer(question, insights) {
  if (typeof question !== 'string' || !insights?.totalPages || !insights.rows?.length) return null;
  if (!/(?:目前|追蹤|上方|這些)/.test(question) || !/關鍵字/.test(question) || !/(?:頁數|幾頁|多少頁)/.test(question) || !/(?:列出|哪些|幾頁|多少|各自)/.test(question)) return null;
  if (/(?:建議|策略|原因|為什麼|如何|趨勢|分析|搜尋|抓取|新增|不要|不用|翻譯|假設)/.test(question)) return null;
  const rows=insights.rows;
  const seen=new Set();
  return {
    text: `目前分析 ${insights.totalPages} 個已存頁面，各追蹤詞的相關頁數如下：\n\n`+rows.map(row=>`${row.keyword}：${row.matchCount} 頁（內容涵蓋率 ${row.coveragePercent}%）${row.brandMatchCount!==undefined?`，指定品牌 ${row.brandMatchCount} 頁／非指定品牌 ${row.otherMatchCount} 頁`:''}`).join('\n')+'\n\n以上為已存網頁的內容比對，並非搜尋量或搜尋熱度。',
    sources: rows.flatMap(row=>row.pages).filter(page=>{if(seen.has(page.url))return false;seen.add(page.url);return true}).slice(0,6).map(page=>({url:page.url,title:page.title,retrievedAt:page.retrievedAt})),
  };
}

function historyPanel(row, e) {
  const points = row?.history || [];
  if (points.length < 2) return `<div class="kw-history"><h3>已存網頁內容涵蓋變化</h3><p class="kw-note">累積更多日期資料後顯示變化</p></div>`;
  const width = 600, height = 100, padding = 10;
  const coordinates = points.map((point, index) => ({ ...point, x: padding + index / (points.length - 1) * (width - padding * 2), y: height - padding - point.coveragePercent / 100 * (height - padding * 2) }));
  return `<div class="kw-history"><h3>已存網頁內容涵蓋變化</h3><p class="kw-note">各日頁面樣本數可能不同；此圖呈現內容涵蓋，不代表搜尋需求或排名變化。</p><svg class="kw-history-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(row.keyword)}的已存網頁內容涵蓋變化，明細如下"><line x1="10" x2="590" y1="90" y2="90" stroke="currentColor" opacity="0.12"/><line x1="10" x2="590" y1="50" y2="50" stroke="currentColor" opacity="0.08"/><polyline points="${coordinates.map(point => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2"/>${coordinates.map(point => `<circle cx="${point.x}" cy="${point.y}" r="3" fill="currentColor"><title>${e(point.date)}：${point.coveragePercent}%（${point.matchCount}／${point.totalPages} 頁）</title></circle>`).join('')}</svg><ol class="kw-history-samples">${points.map(point => `<li><strong>${e(point.date.slice(5))}</strong><span>${point.coveragePercent}%</span><small>${point.matchCount}／${point.totalPages} 頁</small></li>`).join('')}</ol></div>`;
}

export function keywordInsightsPanel({ e = escapeHtml, icon = () => '', insights = buildKeywordInsights(), keywordDraft = '', selectedKeyword = '', loading = false } = {}) {
  const active = insights.rows.find(row => normalize(row.keyword) === normalize(selectedKeyword)) || insights.rows[0];
  const hasImportedMetrics = insights.rows.some(row => row.volume !== null || row.position !== null);
  const metric = value => value === null ? '—' : e(value.toLocaleString('zh-TW', { maximumFractionDigits: 2 }));
  return `<section class="card keyword-workspace"><div class="card-head"><div><h2>內容涵蓋分析</h2></div></div><div class="panel-body"><div class="keyword-toolbar"><form id="keyword-watch-form" class="kw-form"><div class="field"><label for="keyword-watch-input">追蹤關鍵字</label><input id="keyword-watch-input" value="${e(keywordDraft)}" placeholder="例如：餅乾禮盒、企業採購、中秋送禮" maxlength="2000" ${loading ? 'disabled' : ''}><small>以逗號分隔，最多 20 個。</small></div><button class="btn primary" type="submit" ${loading ? 'disabled' : ''}>${icon('search')}更新分析</button></form></div><div class="kw-summary"><div class="kw-summary-item"><strong>${insights.totalPages}</strong><span>分析頁面</span></div><div class="kw-summary-item"><strong>${insights.keywordCount}</strong><span>追蹤關鍵字</span></div><div class="kw-summary-item"><strong>${insights.matchedPages}</strong><span>有對應內容的頁面</span></div></div><p class="kw-note">目前分析已載入的 ${insights.totalPages} 頁，最多 100 頁。內容涵蓋率＝提及此詞的頁數 ÷ 分析頁數。${insights.keywordSource === 'page' ? '目前主題取自頁面標題與已辨識詞，可在上方調整。' : ''}</p>${insights.rows.length ? `<div class="kw-table-wrap"><table class="kw-table"><thead><tr><th scope="col">關鍵字</th><th scope="col">相關頁面</th>${insights.rows.some(row=>row.brandMatchCount!==undefined)?'<th scope="col">指定品牌 / 非指定品牌</th>':''}<th scope="col">內容涵蓋</th>${hasImportedMetrics ? '<th scope="col">匯入搜尋量</th><th scope="col">匯入平均排名</th>' : ''}</tr></thead><tbody>${insights.rows.map(row => `<tr><td><button type="button" class="kw-keyword ${active === row ? 'is-selected' : ''}" data-keyword-focus="${e(row.keyword)}" aria-pressed="${active === row}">${e(row.keyword)}</button></td><td>${row.matchCount} 頁</td>${row.brandMatchCount!==undefined?`<td>${row.brandMatchCount} / ${row.otherMatchCount} 頁</td>`:''}<td><div class="kw-coverage"><div class="kw-bar" aria-hidden="true"><span style="width:${row.coveragePercent}%"></span></div><span>${row.coveragePercent}%</span></div></td>${hasImportedMetrics ? `<td>${metric(row.volume)}</td><td>${metric(row.position)}</td>` : ''}</tr>`).join('')}</tbody></table></div><p class="kw-note">${hasImportedMetrics ? '搜尋量與排名僅顯示已匯入的數值；空白項目尚無量測資料。' : '尚未匯入搜尋量與排名資料；頁面提及次數不代表搜尋熱度。'}</p>${historyPanel(active, e)}<details class="kw-detail"><summary>「${e(active.keyword)}」的相關頁面 · ${active.matchCount} 頁</summary>${active.pages.length ? `<div class="kw-source-links">${active.pages.slice(0, 8).map(page => `<a class="kw-source" href="${e(page.url)}" target="_blank" rel="noopener noreferrer"><strong>${e(page.title)} ↗</strong><small>${e(page.url)}</small>${page.scope?`<span class="source-badge ${page.scope==='指定品牌'?'is-brand':'is-external'}">${e(page.scope)}${page.scope==='非指定品牌'?' · '+e(page.kind):''}</span>`:''}${page.excerpt ? `<p>${e(page.excerpt)}</p>` : ''}</a>`).join('')}</div>${active.pages.length > 8 ? '<p class="kw-note">此處顯示前 8 個來源。</p>' : ''}` : '<p class="kw-empty">已載入的頁面尚未找到此詞；可新增相關來源或調整關鍵字。</p>'}</details>` : '<div class="kw-empty">加入想追蹤的關鍵字，或先在首頁遍歷網站。</div>'}</div></section>`;
}
