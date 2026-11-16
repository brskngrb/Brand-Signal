import {normalizeRetrievalBatches} from './retrieval-evidence.js';
// Rules and fixtures for AI的烘焙口袋名單：是否同意Cookies. Demo figures are simulated, not company facts.
import {normalizeObservationMetadata} from './observations.js';
const DAY = 86400000;
const NUMERIC_FIELDS = ['volume', 'difficulty', 'clicks', 'impressions', 'position', 'relevance'];
const DAILY_FIELDS = ['impressions', 'clicks', 'inquiries', 'aiVisits', 'aioImpressions'];
const atDate = (date) => new Date(`${date}T00:00:00Z`).getTime();
const dateString = (value) => new Date(value).toISOString().slice(0, 10);
const isMissing = (value) => value === null || value === undefined || value === '' || (typeof value === 'string' && !value.trim());
const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
const normalizeText = (value) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();

function numeric(value, field, context) {
  if (isMissing(value)) return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`${context}：${field} 必須是數字或空白。`);
  const clean = typeof value === 'string' ? value.trim() : value;
  if (typeof clean === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(clean)) throw new Error(`${context}：${field}「${value}」不是有效數字。`);
  const result = Number(clean);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${context}：${field} 必須是有限的非負數字。`);
  if (['difficulty', 'relevance'].includes(field) && result > 100) throw new Error(`${context}：${field} 必須介於 0–100。`);
  if (field === 'position' && result === 0) throw new Error(`${context}：position 必須大於 0，未知請留空。`);
  if (['volume', 'clicks', 'impressions', 'inquiries', 'aiVisits', 'aioImpressions'].includes(field) && !Number.isInteger(result)) throw new Error(`${context}：${field} 必須是整數。`);
  return result;
}

function validDate(value, context) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || !Number.isFinite(atDate(value)) || dateString(atDate(value)) !== value) throw new Error(`${context}：日期必須是有效的 YYYY-MM-DD。`);
  return value;
}

function validUrl(value, context, required = false) {
  if (isMissing(value)) {
    if (required) throw new Error(`${context}：請提供網址。`);
    return null;
  }
  try {
    const url = new URL(String(value).trim());
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('protocol');
    return url.href;
  } catch {
    throw new Error(`${context}：請使用有效的 http/https 網址。`);
  }
}

function boolean(value, field, context) {
  if (isMissing(value)) return null;
  if (typeof value !== 'boolean') throw new Error(`${context}：${field} 必須是 true、false 或 null。`);
  return value;
}

function normalizedKeyword(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`關鍵字第 ${index + 1} 筆不是物件。`);
  const keyword = String(row.keyword ?? '').trim();
  if (!keyword) throw new Error(`關鍵字第 ${index + 1} 筆：keyword 不可空白。`);
  const result = { ...row, id: isMissing(row.id) ? `kw-${index + 1}` : String(row.id), keyword, cluster: String(row.cluster ?? '').trim(), intent: String(row.intent ?? '').trim(), page: validUrl(row.page, `關鍵字「${keyword}」目標頁面`) };
  for (const field of NUMERIC_FIELDS) result[field] = numeric(row[field], field, `關鍵字「${keyword}」`);
  return result;
}

function uniqueKeywords(rows) {
  const seen = new Set();
  const ids = new Set();
  return rows.map((row, index) => {
    const keyword = normalizedKeyword(row, index);
    const key = normalizeText(keyword.keyword);
    if (seen.has(key)) throw new Error(`關鍵字「${keyword.keyword}」重複，請合併後匯入。`);
    if (ids.has(keyword.id)) throw new Error(`關鍵字 ID「${keyword.id}」重複。`);
    seen.add(key);
    ids.add(keyword.id);
    return keyword;
  });
}

/** Validate imported data. Missing measurements remain null; never imply zero. */
export function normalizeDataset(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('資料集必須是 JSON 物件。');
  if (!raw.brand || typeof raw.brand !== 'object' || !String(raw.brand.name ?? '').trim()) throw new Error('資料集需要 brand.name。');
  for (const collection of ['keywords', 'daily', 'observations', 'pages']) {
    if (raw[collection] !== undefined && !Array.isArray(raw[collection])) throw new Error(`${collection} 必須是陣列。`);
  }
  const brand = { ...raw.brand, name: String(raw.brand.name).trim(), domain: validUrl(raw.brand.domain, '品牌網域', true), competitors: Array.isArray(raw.brand.competitors) ? raw.brand.competitors : [] };
  // Additional owned domains may be explicitly configured; competitor domains never qualify.
  if (raw.brand.domains !== undefined && !Array.isArray(raw.brand.domains)) throw new Error('brand.domains 必須是網址陣列。');
  if (raw.brand.domains) brand.domains = raw.brand.domains.map((domain) => validUrl(domain, '其他品牌自有網域', true));
  const dates = new Set();
  const daily = (raw.daily ?? []).map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`每日資料第 ${index + 1} 筆不是物件。`);
    const date = validDate(row.date, `每日資料第 ${index + 1} 筆`);
    if (dates.has(date)) throw new Error(`每日資料日期 ${date} 重複，請先合併。`);
    dates.add(date);
    const result = { ...row, date };
    for (const field of DAILY_FIELDS) result[field] = numeric(row[field], field, `每日資料 ${date}`);
    return result;
  }).sort((a, b) => a.date.localeCompare(b.date));
  const observationIds = new Set();
  const observations = (raw.observations ?? []).map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`AI 觀測第 ${index + 1} 筆不是物件。`);
    const id = String(row.id ?? `obs-${index + 1}`);
    if (observationIds.has(id)) throw new Error(`AI 觀測 ID「${id}」重複。`);
    observationIds.add(id);
    const result = { ...row, ...normalizeObservationMetadata(row), id, date: validDate(row.date, `AI 觀測第 ${index + 1} 筆`), platform: String(row.platform ?? '').trim(), query: String(row.query ?? '').trim(), answer: String(row.answer ?? ''), source: String(row.source ?? 'import'), brandMentioned: boolean(row.brandMentioned, 'brandMentioned', `AI 觀測 ${id}`), recommended: boolean(row.recommended, 'recommended', `AI 觀測 ${id}`), citedUrl: validUrl(row.citedUrl, `AI 觀測 ${id} 引用網址`), citationChecked: row.citationChecked === undefined ? Object.hasOwn(row, 'citedUrl') : boolean(row.citationChecked, 'citationChecked', `AI 觀測 ${id}`) === true };
    if (!result.platform || !result.query) throw new Error(`AI 觀測 ${id}：platform 和 query 不可空白。`);
    return result;
  }).sort((a, b) => a.date.localeCompare(b.date));
  const pages = (raw.pages ?? []).map((page, index) => {
    if (!page || typeof page !== 'object') throw new Error(`頁面第 ${index + 1} 筆不是物件。`);
    const score = numeric(page.score, 'score', `頁面第 ${index + 1} 筆`);
    if (score !== null && score > 100) throw new Error(`頁面第 ${index + 1} 筆：score 必須介於 0–100。`);
    return { ...page, url: validUrl(page.url, `頁面第 ${index + 1} 筆`, true), title: String(page.title ?? ''), indexed: boolean(page.indexed, 'indexed', `頁面第 ${index + 1} 筆`), score, schema: page.schema ?? null, issues: Array.isArray(page.issues) ? page.issues.map(String) : [] };
  });
  return { ...raw, brand, keywords: uniqueKeywords(raw.keywords ?? []), daily, observations, pages, retrievalBatches:normalizeRetrievalBatches(raw.retrievalBatches,brand) };
}

function ownedCitation(url, brand) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return [brand.domain, ...(brand.domains ?? [])].some((domain) => {
      const owner = new URL(domain).hostname.toLowerCase().replace(/^www\./, '');
      return host === owner || host.endsWith(`.${owner}`);
    });
  } catch { return false; }
}

function sumKnown(rows, field) {
  const values = rows.map((row) => row[field]).filter((value) => typeof value === 'number' && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

const percentage = (numerator, denominator) => numerator === null || denominator === null ? null : denominator === 0 ? 0 : round(100 * numerator / denominator);

function aggregate(daily, observations, brand) {
  const result = {};
  for (const field of DAILY_FIELDS) {
    result[field] = sumKnown(daily, field);
    result[`${field}DaysKnown`] = daily.filter((row) => typeof row[field] === 'number' && Number.isFinite(row[field])).length;
  }
  result.aioDaysKnown = result.aioImpressionsDaysKnown;
  result.daysKnown = daily.length;
  const ctrDaily = daily.filter((row) => typeof row.clicks === 'number' && typeof row.impressions === 'number');
  result.ctr = percentage(sumKnown(ctrDaily, 'clicks'), sumKnown(ctrDaily, 'impressions'));
  result.ctrDaysKnown = ctrDaily.length;
  result.samples = observations.length;
  result.mentionSamples = observations.filter((row) => typeof row.brandMentioned === 'boolean').length;
  result.recommendationSamples = observations.filter((row) => typeof row.recommended === 'boolean').length;
  // Explicit null citedUrl records a checked answer with no citation; omitted is unknown.
  const citationObservations = observations.filter((row) => row.citationChecked === true || (row.citationChecked === undefined && Object.hasOwn(row, 'citedUrl')));
  result.citationSamples = citationObservations.length;
  result.mentions = observations.filter((row) => row.brandMentioned === true).length;
  result.recommendations = observations.filter((row) => row.recommended === true).length;
  result.citations = citationObservations.filter((row) => ownedCitation(row.citedUrl, brand)).length;
  result.mentionRate = result.mentionSamples ? percentage(result.mentions, result.mentionSamples) : observations.length ? null : 0;
  result.citationRate = result.citationSamples ? percentage(result.citations, result.citationSamples) : observations.length ? null : 0;
  result.recommendationRate = result.recommendationSamples ? percentage(result.recommendations, result.recommendationSamples) : observations.length ? null : 0;
  return result;
}

function keywordPosition(keywords) {
  const known = keywords.filter((row) => typeof row.position === 'number' && Number.isFinite(row.position));
  if (!known.length) return { position: null, positionMethod: 'unavailable', positionKeywordsKnown: 0 };
  const weighted = known.filter((row) => typeof row.impressions === 'number' && row.impressions > 0);
  if (weighted.length) return { position: round(weighted.reduce((sum, row) => sum + row.position * row.impressions, 0) / weighted.reduce((sum, row) => sum + row.impressions, 0)), positionMethod: 'impression-weighted-all-period', positionKeywordsKnown: weighted.length };
  return { position: round(known.reduce((sum, row) => sum + row.position, 0) / known.length), positionMethod: 'unweighted-all-period', positionKeywordsKnown: known.length };
}

/** Date windows use actual record dates and end on the newest observed date. */
export function computeMetrics(dataset, days = 30, { platform = 'all' } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 3660) throw new Error('區間天數必須是 1–3660 的整數。');
  const dailyRows = dataset.daily ?? [];
  const observationRows = dataset.observations ?? [];
  const dates = [...dailyRows, ...observationRows].map((row) => row.date).filter(Boolean).sort();
  // Platform filtering changes the observation sample, never the date anchor.
  const selectedObservations = platform === 'all' ? observationRows : observationRows.filter((row) => row.platform === platform);
  const newest = dates.at(-1);
  const end = newest ? atDate(newest) : null;
  const start = end === null ? null : end - (days - 1) * DAY;
  const previousEnd = start === null ? null : start - DAY;
  const previousStart = previousEnd === null ? null : previousEnd - (days - 1) * DAY;
  const within = (rows, from, through) => from === null ? [] : rows.filter((row) => atDate(row.date) >= from && atDate(row.date) <= through);
  const daily = within(dailyRows, start, end).sort((a, b) => a.date.localeCompare(b.date));
  const observations = within(selectedObservations, start, end).map((row) => ({ ...row, brandCitation: ownedCitation(row.citedUrl, dataset.brand) }));
  const previous = aggregate(within(dailyRows, previousStart, previousEnd), within(selectedObservations, previousStart, previousEnd), dataset.brand);
  // Keywords carry no dated history. They are deliberately not attributed to a chosen window.
  const position = keywordPosition(dataset.keywords ?? []);
  return { ...aggregate(daily, observations, dataset.brand), ...position, daily, observations, previous: { ...previous, position: null, positionMethod: 'unavailable-no-keyword-history' }, keywordPeriod: 'all-period', window: { days, start: start === null ? null : dateString(start), end: newest ?? null, previousStart: previousStart === null ? null : dateString(previousStart), previousEnd: previousEnd === null ? null : dateString(previousEnd) } };
}

/** Transparent prioritization heuristic, not a forecast of rank or AI inclusion. */
export function rankKeywords(keywords) {
  const knownVolumes = keywords.map((row) => row.volume).filter((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const maxVolume = Math.max(0, ...knownVolumes);
  return keywords.map((row) => {
    const missingMetrics = ['volume', 'position', 'difficulty', 'relevance'].filter((field) => typeof row[field] !== 'number' || !Number.isFinite(row[field]));
    if (missingMetrics.length) return { ...row, opportunity: null, missingMetrics, reason: `缺少 ${missingMetrics.join('、')}，未計算優化機會。`, suggestedAction: '先從 Search Console 或關鍵字研究資料補齊指標；未知值請留空。', components: null };
    const demand = maxVolume ? Math.log1p(row.volume) / Math.log1p(maxVolume) : 0;
    const positionOpportunity = row.position < 4 ? 0.2 : row.position <= 10 ? 0.8 : row.position <= 20 ? 1 : row.position <= 30 ? 0.6 : 0.3;
    const lowDifficulty = Math.max(0, Math.min(1, (100 - row.difficulty) / 100));
    const relevance = Math.max(0, Math.min(1, row.relevance / 100));
    const opportunity = round(100 * (0.35 * demand + 0.3 * positionOpportunity + 0.2 * lowDifficulty + 0.15 * relevance), 1);
    const reason = `需求 ${round(demand * 100, 1)}×35% + 排名機會 ${round(positionOpportunity * 100)}×30% + 低難度 ${round(lowDifficulty * 100)}×20% + 相關性 ${round(relevance * 100)}×15%；排名 ${row.position}。`;
    const suggestedAction = row.position <= 3 ? '維護資訊時效、補上可驗證來源與實際 FAQ，持續追蹤 CTR。' : row.position <= 20 ? '優先調整標題與摘要，補強回答搜尋意圖的段落、內部連結及可驗證來源。' : '先建立符合搜尋意圖的主題頁與內容群，核對產品事實後補入 FAQ 與結構化資料。';
    return { ...row, opportunity, missingMetrics, reason, suggestedAction, components: { demand: round(demand * 100, 2), positionOpportunity: round(positionOpportunity * 100), lowDifficulty: round(lowDifficulty * 100), relevance: round(relevance * 100), weights: { demand: 0.35, positionOpportunity: 0.3, lowDifficulty: 0.2, relevance: 0.15 } } };
  }).sort((a, b) => (b.opportunity ?? -1) - (a.opportunity ?? -1));
}

function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false, line = 1;
  const finishField = () => { row.push(field); field = ''; closed = false; };
  const finishRow = () => { finishField(); if (row.some((value) => value.trim())) rows.push(row); row = []; };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else { field += char; if (char === '\n') line++; }
      continue;
    }
    if (char === '"') {
      if (closed || field.trim()) throw new Error(`CSV 第 ${line} 行：引號必須從欄位開頭開始。`);
      field = ''; quoted = true;
    } else if (char === ',') finishField();
    else if (char === '\n' || char === '\r') {
      finishRow();
      if (char === '\r' && input[i + 1] === '\n') i++;
      line++;
    } else {
      if (closed && char.trim()) throw new Error(`CSV 第 ${line} 行：關閉引號後只能接逗號或換行。`);
      if (!closed) field += char;
    }
  }
  if (quoted) throw new Error(`CSV 第 ${line} 行：引號未關閉。`);
  if (field || row.length || closed) finishRow();
  return rows;
}

const HEADER_ALIASES = {
  id: 'id', source: 'source', 來源: 'source',
  keyword: 'keyword', query: 'keyword', queries: 'keyword', 'top queries': 'keyword', 關鍵字: 'keyword', 關鍵詞: 'keyword', 查詢: 'keyword', 熱門查詢: 'keyword',
  cluster: 'cluster', 主題群組: 'cluster', 主題群: 'cluster', 分群: 'cluster',
  intent: 'intent', 搜尋意圖: 'intent',
  volume: 'volume', 搜尋量: 'volume', 月搜尋量: 'volume',
  difficulty: 'difficulty', 難度: 'difficulty', 關鍵字難度: 'difficulty',
  clicks: 'clicks', 點擊數: 'clicks', 點擊: 'clicks', 點擊次數: 'clicks',
  impressions: 'impressions', 曝光數: 'impressions', 曝光: 'impressions', 曝光次數: 'impressions',
  position: 'position', 平均排名: 'position', 排名: 'position',
  relevance: 'relevance', 品牌相關性: 'relevance', 相關性: 'relevance',
  page: 'page', 目標頁面: 'page', 網址: 'page',
};

/** RFC-style quoted CSV with UTF-8/Traditional Chinese header support. */
export function parseCsvKeywords(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV 需要標題列及至少一筆關鍵字資料。');
  const headers = rows.shift().map((header) => HEADER_ALIASES[normalizeText(header)] ?? null);
  if (!headers.includes('keyword')) throw new Error('CSV 必須包含 keyword 或「關鍵字」標題欄位。');
  const known = headers.filter(Boolean);
  if (new Set(known).size !== known.length) throw new Error('CSV 標題欄位重複，請保留唯一欄位。');
  const keywords = rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`CSV 資料第 ${index + 1} 筆：欄位數 ${cells.length} 與標題列 ${headers.length} 不符。`);
    return Object.fromEntries(cells.flatMap((cell, column) => headers[column] ? [[headers[column], cell.trim()]] : []));
  });
  return uniqueKeywords(keywords);
}

/** Content heuristics only. Generated FAQ/schema are explicitly unverified drafts. */
export function analyzeContent({ keyword = '', title = '', description = '', content = '', url = '', brand = '' } = {}) {
  const term = normalizeText(keyword);
  const body = String(content ?? '');
  const plain = body.replace(/<[^>]+>/g, ' ').replace(/[#*_`]/g, ' ');
  const includesTerm = (text) => !!term && normalizeText(text).includes(term);
  const brandName = typeof brand === 'object' ? brand.name ?? '' : String(brand ?? '');
  const checks = [];
  const add = (label, passed, detail, action) => { checks.push({ label, passed: Boolean(passed), detail }); if (!passed) recommendations.push(action); };
  const recommendations = [];
  const charLength = (value) => Array.from(String(value).trim()).length;
  add('主關鍵字設定', !!term, term ? `主題：${keyword}` : '尚未填入主關鍵字。', '先設定一個符合目標搜尋意圖的主關鍵字。');
  add('標題包含主關鍵字', includesTerm(title), includesTerm(title) ? '標題有明確主題詞。' : '標題未包含主關鍵字。', '在自然且準確的標題中加入主關鍵字；不要堆砌同義詞。');
  add('標題長度', charLength(title) >= 10 && charLength(title) <= 60, `目前 ${charLength(title)} 字；10–60 字為本工具的參考值，實際顯示依裝置而異。`, '讓標題用 10–60 字清楚說明內容與讀者收益，完成後預覽搜尋結果。');
  add('摘要完整', includesTerm(description) && charLength(description) >= 40 && charLength(description) <= 160, `目前 ${charLength(description)} 字；需包含主題詞，40–160 字為參考值。`, '補上含主題詞的 40–160 字摘要，只描述頁面已確認的資訊。');
  add('正文回答主題', includesTerm(plain) && charLength(plain) >= 200, `正文 ${charLength(plain)} 字；檢查主題詞與基本內容深度，字數不代表排名保證。`, '補入直接回答搜尋意圖的正文、選購條件與已驗證資訊。');
  const headings = (body.match(/^#{1,6}\s+.+/gm) ?? []).length + (body.match(/<h[1-6](?:\s[^>]*)?>/gi) ?? []).length;
  add('可辨識標題層級', headings >= 2, `辨識到 ${headings} 個 Markdown/HTML 標題。`, '用 H2/H3 或 Markdown 標題整理兩個以上的子題，保持層級清楚。');
  const sentences = plain.split(/[。！？.!?\n]+/).map((value) => value.trim()).filter(Boolean);
  const average = sentences.length ? charLength(plain.replace(/\s+/g, '')) / sentences.length : 0;
  add('句子可讀性', sentences.length >= 3 && average <= 80, `句子平均約 ${round(average)} 字；只作文字結構檢查。`, '拆分過長句子，使用短段落、清單與直接答案，讓人與模型易於理解。');
  add('常見問題內容', /FAQ|常見問題|常見問答|問與答/i.test(body) && /[?？]|問[:：]|Q\s*[:：]/i.test(body), '檢查是否有 FAQ 區塊與問題句；不驗證答案正確性。', '新增來自真實客服或搜尋問題的 FAQ，核對每一項答案後才發布。');
  const links = body.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];
  add('可追溯資料來源', links.length > 0, `辨識到 ${links.length} 個網址；網址存在與來源品質尚未驗證。`, '為規格、成分、價格與服務條件補上官方可查核來源及更新日期。');
  add('品牌資訊', !!normalizeText(brandName) && normalizeText(`${title} ${plain}`).includes(normalizeText(brandName)), brandName ? `檢查品牌名稱「${brandName}」是否出現；不代表已確認品牌事實。` : '尚未指定品牌名稱。', '加上正確品牌名稱及清楚的品牌／商品資訊，避免宣稱未驗證優勢。');
  let urlValid = false;
  try { const parsed = new URL(url); urlValid = ['https:', 'http:'].includes(parsed.protocol); } catch { /* missing URL */ }
  add('頁面網址', urlValid, urlValid ? '網址格式有效；未執行抓取、索引或可存取性檢查。' : '未填入有效頁面網址。', '指定正式頁面網址，再以 Search Console 或實際抓取確認索引狀態。');
  const topic = String(keyword).trim() || '這項主題';
  const faq = [
    { question: `選擇${topic}時，應比較哪些條件？`, answer: '草稿／未驗證：請依官方已確認的規格、成分、尺寸、價格與使用情境填入比較條件，並附來源與更新日期。' },
    { question: `${topic}的保存、配送或購買資訊在哪裡查詢？`, answer: '草稿／未驗證：請填入正式商品頁、保存方式、配送範圍與最新條款的官方連結；尚未核對的資訊不要發布。' },
    { question: `${brandName || '品牌'}有哪些適合${topic}需求的選擇？`, answer: '草稿／未驗證：請核對現有商品與實際適用情境後列出選項；本工具未查證商品、庫存、成分或功效。' },
  ];
  recommendations.push('FAQ 與結構化資料為規則產生的未驗證草稿。只在 FAQ 答案已核實且同樣內容公開顯示於頁面時使用；結構化資料不保證搜尋展示或 AI 推薦。');
  const schema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) };
  return { score: Math.round(100 * checks.filter((check) => check.passed).length / checks.length), checks, recommendations, faq, schema, status: 'draft-unverified', disclaimer: '此分數僅評估可見文字與格式，不代表真實搜尋排名、AIO 曝光或模型推薦率。FAQ／schema 請查核後使用。' };
}

/** UTF-8 BOM CSV; spreadsheet-formula prefixes are neutralized for exported text. */
export function toCsv(rows) {
  if (!Array.isArray(rows) || !rows.length) return '\uFEFF';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `\uFEFF${[headers.map(escape).join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\r\n')}`;
}

export const emptyData = normalizeDataset({
  source: 'empty',
  brand: { name: '鴻鼎菓子', domain: 'https://www.idodo.com.tw', competitors: [] },
  keywords: [], daily: [], observations: [], pages: [],
});

// Remove legacy simulated records before normalization supplies default sources.
export function removeDemoData(raw) {
  if (!raw) return structuredClone(emptyData);
  const clean = {...raw, brand: {...raw.brand}};
  for (const key of ['keywords', 'daily', 'observations', 'pages']) {
    clean[key] = (raw[key] || []).filter(row => row.source !== 'demo' && (raw.source !== 'demo' || (row.source && row.source !== 'demo')));
  }
  if (raw.source === 'demo') clean.brand.competitors = (clean.brand.competitors || []).filter(name => !name.includes('（模擬）'));
  delete clean.notice;
  clean.source = ['keywords', 'daily', 'observations', 'pages'].some(key => clean[key].length) ? 'imported' : 'empty';
  return normalizeDataset(clean);
}
