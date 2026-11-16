import { crawlPublicPage, validatePublicUrl } from './public-fetch.js';

const webSearchResponseLimit = 512 * 1024;
const webSearchTimeLimit = 75_000;
const webSearchRequestLimit = 15_000;
const webSearchJinaEndpoint = 'https://s.jina.ai/';
const webSearchDuckEndpoint = 'https://html.duckduckgo.com/html/';

class WebSearchError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    if (status) this.status = status;
  }
}

export function validateSearchControls(args = {}) {
  const budgetMs = args.budgetMs === undefined ? webSearchTimeLimit : args.budgetMs;
  if (!Number.isInteger(budgetMs) || budgetMs < 1000 || budgetMs > webSearchTimeLimit) throw new WebSearchError('INVALID_SEARCH_INPUT', 'budgetMs 必須是 1000–75000 的整數。', 400);
  const values = args.excludeUrls === undefined ? [] : args.excludeUrls;
  if (!Array.isArray(values) || values.length > 100 || values.some(value => typeof value !== 'string') || values.reduce((sum, value) => sum + value.length, 0) > 28000) {
    throw new WebSearchError('INVALID_SEARCH_INPUT', 'excludeUrls 最多 100 個安全公開網址，合計不超過 28000 字元。', 400);
  }
  let excludeUrls;
  try { excludeUrls = [...new Set(values.map(value => validatePublicUrl(value).href))]; }
  catch { throw new WebSearchError('INVALID_SEARCH_INPUT', 'excludeUrls 只能包含安全公開 HTTPS 網址，不接受登入、私人網路或查詢參數。', 400); }
  return {budgetMs, excludeUrls};
}

function webSearchInput(args) {
  const validQuery = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value);
  if (!args || typeof args !== 'object' || Array.isArray(args) || !validQuery(args.query)) {
    throw new WebSearchError('INVALID_SEARCH_INPUT', '請輸入 1–500 字元的搜尋主題。', 400);
  }
  const maxPages = args.maxPages ?? 6;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 12) throw new WebSearchError('INVALID_SEARCH_INPUT', 'maxPages 必須是 1–12 的整數。', 400);
  if (args.queries !== undefined && (!Array.isArray(args.queries) || args.queries.length > 3 || args.queries.some(query => !validQuery(query)))) {
    throw new WebSearchError('INVALID_SEARCH_INPUT', 'queries 最多 3 組，每組須為 1–500 字元的搜尋文字。', 400);
  }
  const keywords = args.keywords ?? [];
  if (!Array.isArray(keywords) || keywords.length > 30 || keywords.some(word => typeof word !== 'string' || word.length > 300)) {
    throw new WebSearchError('INVALID_SEARCH_INPUT', 'keywords 必須是最多 30 個、每個不超過 300 字元的文字陣列。', 400);
  }
  const readerApiKey = args.readerApiKey;
  if (readerApiKey !== undefined && readerApiKey !== '' && (typeof readerApiKey !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(readerApiKey))) {
    throw new WebSearchError('INVALID_READER_KEY', 'Jina Reader 金鑰格式錯誤，請在「資料與 API」設定有效金鑰。', 400);
  }
  const query = args.query.trim();
  const queries = [...new Set([query, ...(args.queries ?? []).map(value => value.trim())])].slice(0, 3);
  return { query, queries, keywords, maxPages, readerApiKey, ...validateSearchControls(args) };
}

function webSearchText(value, length) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, length) : '';
}

function webSearchDecode(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[entity.toLowerCase()] ?? match;
    const number = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
  });
}

function webSearchHtmlText(value) {
  return webSearchDecode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function webSearchAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? webSearchDecode(match[1] ?? match[2] ?? '') : '';
}

function webSearchParseDuck(html) {
  if (/anomaly-modal|anomaly\.js|challenge-form|id=["']captcha|name=["']captcha/i.test(html)) {
    throw new WebSearchError('SEARCH_VERIFICATION_REQUIRED', '公開搜尋服務要求人工驗證，已停止搜尋。請在「資料與 API」設定 Jina Reader 金鑰後重試。');
  }
  const results = [];
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  for (let index = 0; index < anchors.length; index++) {
    const anchor = anchors[index];
    if (!webSearchAttribute(anchor[1], 'class').split(/\s+/).includes('result__a')) continue;
    let url = webSearchAttribute(anchor[1], 'href');
    if (!url) continue;
    try {
      const link = new URL(url, webSearchDuckEndpoint);
      if (['duckduckgo.com', 'www.duckduckgo.com', 'html.duckduckgo.com'].includes(link.hostname) && link.pathname === '/l/') url = link.searchParams.get('uddg') ?? '';
      else url = link.href;
    } catch { continue; }
    const nextResult = anchors.slice(index + 1).find(candidate => webSearchAttribute(candidate[1], 'class').split(/\s+/).includes('result__a'));
    const segment = html.slice(anchor.index + anchor[0].length, nextResult?.index ?? html.length);
    const snippet = segment.match(/<(?:a|div|span)\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i)?.[1] ?? '';
    results.push({ url, title: webSearchHtmlText(anchor[2]), snippet: webSearchHtmlText(snippet) });
    if (results.length >= 60) break;
  }
  if (!results.length && !/no-results|no results found|沒有找到|查無結果/i.test(html)) {
    throw new WebSearchError('SEARCH_INVALID_RESPONSE', '公開搜尋服務未回傳可辨識的搜尋結果。請設定 Jina Reader 金鑰或稍後再試。');
  }
  return results;
}

async function webSearchRead(response, signal) {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > webSearchResponseLimit) {
    await response.body?.cancel().catch(() => {});
    throw new WebSearchError('SEARCH_RESPONSE_TOO_LARGE', '搜尋服務回應超過 512 KiB，已停止讀取。');
  }
  if (!response.body) throw new WebSearchError('SEARCH_INVALID_RESPONSE', '搜尋服務未回傳內容。');
  const reader = response.body.getReader();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new WebSearchError('SEARCH_TIMEOUT', '搜尋逾時，請縮小搜尋範圍或稍後再試。');
      if (done) break;
      bytes += value.byteLength;
      if (bytes > webSearchResponseLimit) {
        await reader.cancel().catch(() => {});
        throw new WebSearchError('SEARCH_RESPONSE_TOO_LARGE', '搜尋服務回應超過 512 KiB，已停止讀取。');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

async function webSearchProvider(query, input, options, deadline) {
  const controller = new AbortController();
  const isJina = Boolean(input.readerApiKey);
  const url = isJina ? webSearchJinaEndpoint : `${webSearchDuckEndpoint}?q=${encodeURIComponent(query)}&kl=tw-tzh`;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new WebSearchError('SEARCH_TIMEOUT', '搜尋逾時，請縮小搜尋範圍或稍後再試。'));
    }, Math.max(1, Math.min(webSearchRequestLimit, options.requestTimeoutMs ?? webSearchRequestLimit, deadline - Date.now())));
  });
  try {
    return await Promise.race([(async () => {
      const response = await (options.fetchImpl ?? globalThis.fetch)(url, {
        method: isJina ? 'POST' : 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { Accept: isJina ? 'application/json' : 'text/html', DNT: '1', ...(isJina ? { 'Content-Type': 'application/json', Authorization: `Bearer ${input.readerApiKey}`, 'X-Respond-With': 'no-content' } : {}) },
        ...(isJina ? { body: JSON.stringify({ q: query, num: Math.min(20, input.maxPages * 2), gl: 'tw', hl: 'zh-tw' }) } : {}),
      });
      if ((response.url && response.url !== url) || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel().catch(() => {});
        throw new WebSearchError('SEARCH_REDIRECT', '搜尋服務回傳未驗證的轉址，已停止搜尋。');
      }
      if (response.status === 202 || [401, 402, 403, 429, 451].includes(response.status)) {
        await response.body?.cancel().catch(() => {});
        if (!isJina) throw new WebSearchError('SEARCH_VERIFICATION_REQUIRED', '公開搜尋服務暫時限制存取或要求驗證，已停止搜尋。請在「資料與 API」設定 Jina Reader 金鑰後重試。');
        throw new WebSearchError(response.status === 429 ? 'SEARCH_RATE_LIMIT' : 'SEARCH_AUTH_REQUIRED', response.status === 429 ? 'Jina 搜尋額度或速率受限，請稍後再試。' : 'Jina 搜尋需要有效且有可用額度的金鑰，請在「資料與 API」檢查 Jina Reader 金鑰。');
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new WebSearchError('SEARCH_UNAVAILABLE', '搜尋服務暫時無法使用，請稍後重試。');
      }
      const expectedType = isJina ? /^application\/json(?:;|$)/i : /^text\/html(?:;|$)/i;
      if (!expectedType.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel().catch(() => {});
        throw new WebSearchError('SEARCH_INVALID_RESPONSE', '搜尋服務回傳格式不符，請稍後重試。');
      }
      const body = await webSearchRead(response, controller.signal);
      if (!isJina) return webSearchParseDuck(body);
      let envelope;
      try { envelope = JSON.parse(body); } catch { throw new WebSearchError('SEARCH_INVALID_RESPONSE', 'Jina 搜尋回傳不完整的資料。'); }
      if (envelope?.code !== 200 || !Array.isArray(envelope.data)) throw new WebSearchError('SEARCH_INVALID_RESPONSE', 'Jina 搜尋未回傳有效的結果清單。');
      return envelope.data.slice(0, 60).filter(item => item && typeof item === 'object').map(item => ({ url: item.url, title: item.title, snippet: item.description ?? '' }));
    })(), timeout]);
  } catch (error) {
    if (error instanceof WebSearchError) throw error;
    throw new WebSearchError('SEARCH_UNAVAILABLE', '無法連接搜尋服務，請檢查網路或稍後重試。');
  } finally { clearTimeout(timer); }
}

/** Search real public results, then read at most 12 pages; never accept model-invented URLs. */
export async function searchWeb(args, options = {}) {
  const input = webSearchInput(args);
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(0, Math.min(input.budgetMs, options.totalTimeoutMs ?? input.budgetMs));
  const provider = input.readerApiKey ? 'jina' : 'duckduckgo';
  const endpoint = input.readerApiKey ? webSearchJinaEndpoint : webSearchDuckEndpoint;
  const failures = [];
  const batches = await Promise.all(input.queries.map(async query => {
    if (Date.now() >= deadline) {
      failures.push({url: endpoint, code: 'SEARCH_TOTAL_TIMEOUT', message: '已達本次搜尋時間上限，尚未發送搜尋請求。', query});
      return [];
    }
    try { return await webSearchProvider(query, input, options, deadline); }
    catch (error) {
      failures.push({ url: endpoint, code: error.code ?? 'SEARCH_UNAVAILABLE', message: error instanceof WebSearchError ? error.message : '搜尋服務暫時失敗。', query });
      return [];
    }
  }));
  const seen = new Set();
  const results = [];
  let skippedUnsafe = 0;
  let skippedExisting = 0;
  const excluded = new Set(input.excludeUrls);
  // Interleave queries so expanded terms can contribute within the shared page cap.
  const mostResults = Math.max(0, ...batches.map(batch => batch.length));
  for (let index = 0; index < mostResults; index++) {
    for (const batch of batches) {
      const item = batch[index];
      if (!item) continue;
      let url;
      try { url = validatePublicUrl(item.url).href; }
      catch { skippedUnsafe++; continue; }
      if (seen.has(url)) continue;
      seen.add(url);
      if (excluded.has(url)) skippedExisting++;
      results.push({ url, title: webSearchText(item.title, 300), snippet: webSearchText(item.snippet, 1200) });
    }
  }
  const selected = results.filter(result => !excluded.has(result.url)).slice(0, input.maxPages);
  if (!selected.length && !failures.length && !skippedExisting) failures.push({ url: endpoint, code: 'SEARCH_NO_RESULTS', message: '未找到符合公開 HTTPS 網址規則的搜尋結果，請調整搜尋文字。' });
  let providerLimited = failures.some(failure => ['SEARCH_VERIFICATION_REQUIRED', 'SEARCH_RATE_LIMIT', 'SEARCH_AUTH_REQUIRED'].includes(failure.code));
  const fetched = Array(selected.length);
  let next = 0;
  let attempted = 0;
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
    while (next < selected.length) {
      if (providerLimited) break;
      const index = next++;
      const result = selected[index];
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        failures.push({ url: result.url, code: 'SEARCH_TOTAL_TIMEOUT', message: '已達本次搜尋與讀取的時間上限，此頁尚未讀取。' });
        continue;
      }
      attempted++;
      const report = await crawlPublicPage({ url: result.url, keywords: input.keywords, readerApiKey: input.readerApiKey }, {
        fetchImpl: options.fetchImpl, includeContent: true, requestTimeoutMs: Math.max(1, Math.min(25_000, options.pageTimeoutMs ?? 25_000, remaining)),
      });
      const page = report.pages[0];
      if (page && excluded.has(page.url)) skippedExisting++;
      else fetched[index] = page;
      failures.push(...report.failures.map(failure => failure.code === 'PUBLIC_TIMEOUT' && Date.now() >= deadline
        ? {...failure, code: 'SEARCH_TOTAL_TIMEOUT', message: '已達本次搜尋與讀取時間上限，保留已取得的頁面。'} : failure));
      if (report.failures.some(failure => ['PUBLIC_READER_RATE_LIMIT', 'PUBLIC_READER_BLOCKED'].includes(failure.code))) providerLimited = true;
    }
  }));
  const uniquePages = new Map();
  for (const page of fetched.filter(Boolean)) if (!uniquePages.has(page.url)) uniquePages.set(page.url, page);
  const pages = [...uniquePages.values()];
  const exhausted = !pages.length && !failures.length && skippedExisting > 0;
  const budgetExhausted = failures.some(failure => ['SEARCH_TOTAL_TIMEOUT', 'SEARCH_TIMEOUT'].includes(failure.code)) && Date.now() >= deadline;
  const stopReason = providerLimited ? 'provider_limit' : budgetExhausted ? 'budget_exhausted' : exhausted ? 'existing_results' : failures.some(failure => failure.code === 'SEARCH_NO_RESULTS') ? 'no_results' : null;
  return {
    source: 'website_crawl', domain: selected.length ? `${new URL(selected[0].url).origin}/` : endpoint,
    generatedAt: new Date().toISOString(), pages, failures,
    coverage: { attempted, fetched: pages.length, limit: input.maxPages },
    search: { query: input.query, queries: input.queries, provider, results: results.slice(0, 60), skippedUnsafe, skippedExisting, exhausted, stopReason },
    notice: `本次使用 ${provider === 'jina' ? 'Jina Search' : 'DuckDuckGo 公開搜尋'}取得真實搜尋結果，再由 Jina Reader 讀取最多 ${input.maxPages} 個公開網頁；每頁保留最多 24000 字元及來源網址。搜尋字詞與網址會傳至對應服務。${skippedUnsafe ? `已略過 ${skippedUnsafe} 個不符合公開網址規則的結果。` : ''}${skippedExisting ? `已略過 ${skippedExisting} 個已保存來源。` : ''}${exhausted ? '本批候選來源均已保存，沒有新增頁面。' : ''}搜尋摘要不視為已讀取的內文；失敗頁面不會列為已取得資料。本次結果未量測搜尋排名、流量或 AI 推薦成效。`,
  };
}
